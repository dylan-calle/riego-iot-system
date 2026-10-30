import { COMPONENT_ORDER, COMPONENT_TITLES } from '@/constants/diagnostics';
import {
  isFullDiagnostics,
  isOfflineDiagnostics,
  type DiagnosticsFull,
  type DiagnosticsPayload,
} from '@/types/diagnostics';

/** Líneas `[ALERTA] ...` para cada componente que reporta ok:false. */
function failingComponents(payload: DiagnosticsFull): string[] {
  return COMPONENT_ORDER.filter((key) => !payload.components[key].ok).map(
    (key) => `[ALERTA] ${COMPONENT_TITLES[key]}: ${payload.components[key].status}`,
  );
}

/**
 * Compara dos diagnósticos consecutivos y devuelve una línea por cada cambio
 * detectado. Solo describe lo que dicen los datos (valores y estados del
 * firmware), sin suponer causas. Las lecturas continuas, como el porcentaje de
 * humedad, no generan líneas mientras no cambie un estado.
 */
export function diffDiagnostics(
  prev: DiagnosticsPayload | null,
  next: DiagnosticsPayload,
): string[] {
  const out: string[] = [];

  if (isOfflineDiagnostics(next)) {
    if (prev === null || !isOfflineDiagnostics(prev)) {
      out.push(`[ALERTA] ${next.deviceId} desconectado (mensaje de última voluntad del broker)`);
    }
    return out;
  }

  if (prev === null) {
    out.push(
      `[INFO] Diagnóstico recibido de ${next.deviceId} · modo ${next.mode} · umbral ${next.thresholdMin}%-${next.thresholdMax}%`,
    );
    out.push(...failingComponents(next));
    return out;
  }

  if (!isFullDiagnostics(prev)) {
    out.push(`[OK] ${next.deviceId} en línea`);
    out.push(...failingComponents(next));
    return out;
  }

  if (prev.generalStatus !== next.generalStatus) {
    out.push(
      next.generalStatus === 'ALL_OK'
        ? '[OK] Sistema operativo'
        : '[ALERTA] Falla de hardware detectada',
    );
  }
  if (prev.mode !== next.mode) {
    out.push(`[INFO] Modo ${prev.mode} -> ${next.mode}`);
  }
  if (prev.thresholdMin !== next.thresholdMin || prev.thresholdMax !== next.thresholdMax) {
    out.push(
      `[INFO] Umbral ${prev.thresholdMin}%-${prev.thresholdMax}% -> ${next.thresholdMin}%-${next.thresholdMax}%`,
    );
  }

  const relayChanged = prev.components.relay.active !== next.components.relay.active;
  const pumpChanged = prev.components.pump.running !== next.components.pump.running;

  for (const key of COMPONENT_ORDER) {
    const before = prev.components[key];
    const after = next.components[key];
    const title = COMPONENT_TITLES[key];

    if (before.ok !== after.ok) {
      out.push(`[${after.ok ? 'OK' : 'ALERTA'}] ${title}: ${after.status}`);
    } else if (before.status !== after.status) {
      // El cambio de estado del relé y de la bomba al activarse ya se informa abajo.
      if ((key === 'relay' && relayChanged) || (key === 'pump' && pumpChanged)) continue;
      out.push(`[INFO] ${title}: ${before.status} -> ${after.status}`);
    }
  }

  if (relayChanged) {
    out.push(
      `[RIEGO] Relé ${next.components.relay.active ? 'activado' : 'desactivado'} · modo ${next.mode} · humedad ${next.components.sensor.moisture}% · umbral mín ${next.thresholdMin}%`,
    );
  }
  if (pumpChanged) {
    out.push(`[RIEGO] Bomba ${next.components.pump.running ? 'en marcha' : 'detenida'}`);
  }

  return out;
}
