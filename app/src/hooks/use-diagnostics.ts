import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { API_BASE_URL, DEFAULT_DEVICE_CODE } from '@/constants/api';
import { parseDiagnosticsResponse, type DiagnosticsPayload } from '@/types/diagnostics';

/** El firmware publica el diagnóstico cada 3 s. */
export const DIAGNOSTICS_POLL_MS = 3000;
/** Sin mensajes nuevos durante este tiempo (5 publicaciones) el dato se considera desactualizado. */
export const DIAGNOSTICS_STALE_AFTER_MS = 15000;
const REQUEST_TIMEOUT_MS = 8000;

export type DiagnosticsErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'server'
  | 'invalid-response';

export interface DiagnosticsError {
  kind: DiagnosticsErrorKind;
  message: string;
}

export interface UseDiagnosticsOptions {
  /** JWT del usuario (el endpoint requiere el permiso pump:read). */
  token?: string | null;
  deviceCode?: string;
  intervalMs?: number;
  /** false pausa las consultas (p. ej. cuando la pantalla no está visible). */
  enabled?: boolean;
}

export interface UseDiagnosticsResult {
  /** Último diagnóstico válido. Se conserva si una consulta posterior falla. */
  diagnostics: DiagnosticsPayload | null;
  /** Momento en que el backend recibió ese diagnóstico. */
  receivedAt: Date | null;
  /** El broker lo entregó como retenido (puede ser un dato viejo). */
  retained: boolean;
  /** No llegan mensajes nuevos hace más de DIAGNOSTICS_STALE_AFTER_MS, o el dato es retenido. */
  isStale: boolean;
  /** true hasta la primera respuesta (éxito o error). */
  isLoading: boolean;
  error: DiagnosticsError | null;
  refresh: () => Promise<void>;
}

interface Snapshot {
  data: DiagnosticsPayload | null;
  receivedAt: string | null;
  retained: boolean;
  /** Reloj de este teléfono: cuándo cambió por última vez `receivedAt`. */
  changedAt: number;
}

/**
 * Consulta GET /irrigation/diagnostics en bucle.
 * - Una sola petición a la vez (la siguiente se agenda al terminar la anterior).
 * - Se pausa con la app en segundo plano y se cancela al desmontar.
 * - Con 401/403 deja de consultar hasta que cambie el token.
 * - El estado "desactualizado" se mide con el reloj del teléfono (cuándo dejó de
 *   cambiar `receivedAt`), así que no depende de que su hora coincida con la del servidor.
 */
export function useDiagnostics(options: UseDiagnosticsOptions = {}): UseDiagnosticsResult {
  const {
    token = null,
    deviceCode = DEFAULT_DEVICE_CODE,
    intervalMs = DIAGNOSTICS_POLL_MS,
    enabled = true,
  } = options;

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<DiagnosticsError | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [now, setNow] = useState(() => Date.now());

  const inFlight = useRef<Promise<boolean> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Hace una consulta. Devuelve true si conviene seguir consultando. */
  const request = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    abortRef.current = controller;

    const fail = (err: DiagnosticsError, keepPolling: boolean) => {
      setError(err);
      setIsLoading(false);
      return keepPolling;
    };

    const run: Promise<boolean> = (async () => {
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const url = `${API_BASE_URL}/irrigation/diagnostics?deviceCode=${encodeURIComponent(deviceCode)}`;
        const response = await fetch(url, { headers, signal: controller.signal });

        if (response.status === 401) {
          return fail({ kind: 'unauthorized', message: 'Inicia sesión para ver el diagnóstico.' }, false);
        }
        if (response.status === 403) {
          return fail(
            { kind: 'forbidden', message: 'Tu usuario no tiene permiso para ver el diagnóstico.' },
            false,
          );
        }
        if (!response.ok) {
          return fail({ kind: 'server', message: `Error HTTP ${response.status}` }, true);
        }

        let json: unknown;
        try {
          json = await response.json();
        } catch (e) {
          if (controller.signal.aborted) throw e;
          return fail({ kind: 'invalid-response', message: 'El servidor no devolvió un JSON válido.' }, true);
        }

        const body = parseDiagnosticsResponse(json);
        if (!body) {
          return fail(
            {
              kind: 'invalid-response',
              message: 'El servidor devolvió un diagnóstico con un formato inesperado.',
            },
            true,
          );
        }

        setSnapshot((prev) => ({
          data: body.data,
          receivedAt: body.receivedAt,
          retained: body.retained ?? false,
          changedAt:
            prev !== null && prev.receivedAt === body.receivedAt ? prev.changedAt : Date.now(),
        }));
        setError(null);
        setIsLoading(false);
        return true;
      } catch {
        // Cancelada por nosotros (desmontar, segundo plano, cambio de token): sin error.
        if (controller.signal.aborted && !timedOut) return true;
        return fail(
          {
            kind: 'network',
            message: timedOut
              ? 'El servidor tardó demasiado en responder.'
              : 'No se pudo conectar con el servidor.',
          },
          true,
        );
      } finally {
        clearTimeout(timeout);
        // Solo libera si no empezó otra petición mientras esta terminaba.
        if (abortRef.current === controller) inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, [token, deviceCode]);

  // Bucle de consultas.
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loop = async (id: number) => {
      const keepPolling = await request();
      if (id !== generation || !keepPolling) return;
      timer = setTimeout(() => void loop(id), intervalMs);
    };

    const start = () => {
      clearTimeout(timer);
      generation += 1;
      void loop(generation);
    };

    const stop = () => {
      generation += 1;
      clearTimeout(timer);
      abortRef.current?.abort();
      inFlight.current = null;
    };

    if (AppState.currentState === 'active') start();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      subscription.remove();
      stop();
    };
  }, [enabled, intervalMs, request]);

  // Reloj para calcular "desactualizado".
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  const refresh = useCallback(async () => {
    await request();
  }, [request]);

  const diagnostics = snapshot?.data ?? null;
  const isStale =
    snapshot !== null &&
    diagnostics !== null &&
    (snapshot.retained || now - snapshot.changedAt > DIAGNOSTICS_STALE_AFTER_MS);

  return {
    diagnostics,
    receivedAt: snapshot?.receivedAt ? new Date(snapshot.receivedAt) : null,
    retained: snapshot?.retained ?? false,
    isStale,
    isLoading,
    error,
    refresh,
  };
}
