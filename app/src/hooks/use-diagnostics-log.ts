import { useCallback, useEffect, useRef, useState } from 'react';

import { diffDiagnostics } from '@/lib/diagnostics-log';
import type { DiagnosticsPayload } from '@/types/diagnostics';

import { DIAGNOSTICS_STALE_AFTER_MS, type DiagnosticsError } from './use-diagnostics';

const MAX_LOG_LINES = 200;

const clock = (): string => new Date().toLocaleTimeString('es-BO', { hour12: false });

interface Params {
  diagnostics: DiagnosticsPayload | null;
  isStale: boolean;
  error: DiagnosticsError | null;
}

/**
 * Historial de eventos para la consola. Registra:
 *  - cambios entre dos diagnósticos consecutivos (estados, modo, riego),
 *  - cuando dejan de llegar mensajes del dispositivo y cuando se reanudan,
 *  - fallos de comunicación con el servidor y su recuperación.
 */
export function useDiagnosticsLog({ diagnostics, isStale, error }: Params): string[] {
  const [logs, setLogs] = useState<string[]>([]);

  const prevDiagnostics = useRef<DiagnosticsPayload | null>(null);
  const prevStale = useRef(false);
  const prevErrorKind = useRef<string | null>(null);

  const push = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    const time = clock();
    setLogs((old) => [...old, ...lines.map((line) => `${time} ${line}`)].slice(-MAX_LOG_LINES));
  }, []);

  useEffect(() => {
    if (!diagnostics) return;
    push(diffDiagnostics(prevDiagnostics.current, diagnostics));
    prevDiagnostics.current = diagnostics;
  }, [diagnostics, push]);

  useEffect(() => {
    if (isStale === prevStale.current) return;
    prevStale.current = isStale;
    push(
      isStale
        ? [
            `[ALERTA] Sin mensajes nuevos del dispositivo (más de ${DIAGNOSTICS_STALE_AFTER_MS / 1000} s)`,
          ]
        : ['[OK] Mensajes del dispositivo reanudados'],
    );
  }, [isStale, push]);

  useEffect(() => {
    const kind = error?.kind ?? null;
    if (kind === prevErrorKind.current) return;
    const hadError = prevErrorKind.current !== null;
    prevErrorKind.current = kind;
    if (error) push([`[ALERTA] ${error.message}`]);
    else if (hadError) push(['[OK] Comunicación con el servidor restablecida']);
  }, [error, push]);

  return logs;
}
