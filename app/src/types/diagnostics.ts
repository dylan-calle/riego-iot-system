/**
 * Tipos del diagnóstico de hardware.
 *
 * Reflejan el JSON que publica el firmware
 * (esp32/esp32HumedadyRiego/sensorYRiegoTest.ino) en `home/garden/diagnostics`
 * y que el backend entrega, sin transformar, en GET /irrigation/diagnostics.
 */

export type DeviceMode = 'AUTO' | 'MANUAL';

// Valores de `status` que emite el firmware para cada componente.
export type Esp32Status = 'ONLINE';
export type SensorStatus = 'DESCONECTADO' | 'OK_EN_TIERRA' | 'CONECTADO_EN_AIRE';
export type RelayStatus = 'DESCONECTADO' | 'ACTIVO_CERRADO' | 'OK_EN_ESPERA';
export type BatteryStatus = 'CONECTADA_OK' | 'DESCONECTADA_O_SIN_PILAS';
export type PumpStatus =
  | 'EN_ESPERA'
  | 'SIN_ENERGIA_PREVIA'
  | 'BOMBEANDO_OK'
  | 'CABLE_BOMBA_SUELTO';
export type WiringStatus = 'CIRCUITO_COMPLETO' | 'COMPONENTE_DESCONECTADO';

export interface Esp32Component {
  ok: boolean;
  status: Esp32Status;
  wifi: string;
  rssi: number;
}

export interface SensorComponent {
  ok: boolean;
  status: SensorStatus;
  adc: number;
  moisture: number;
}

export interface RelayComponent {
  ok: boolean;
  status: RelayStatus;
  adc: number;
  active: boolean;
}

export interface BatteryComponent {
  ok: boolean;
  status: BatteryStatus;
  adc: number;
  level: number;
}

export interface PumpComponent {
  ok: boolean;
  status: PumpStatus;
  adc: number;
  running: boolean;
}

export interface WiringComponent {
  ok: boolean;
  status: WiringStatus;
}

export interface DiagnosticsComponents {
  esp32: Esp32Component;
  sensor: SensorComponent;
  relay: RelayComponent;
  battery: BatteryComponent;
  pump: PumpComponent;
  wiring: WiringComponent;
}

export type ComponentKey = keyof DiagnosticsComponents;

/** Mensaje normal del ESP32 (cada 3 s). */
export interface DiagnosticsFull {
  deviceId: string;
  generalStatus: 'ALL_OK' | 'FALLO_DETECTADO';
  mode: DeviceMode;
  thresholdMin: number;
  thresholdMax: number;
  components: DiagnosticsComponents;
}

/**
 * Mensaje de última voluntad (LWT) que el broker publica cuando el ESP32 se
 * desconecta. Es PARCIAL: solo trae `components.esp32`.
 */
export interface DiagnosticsOffline {
  deviceId: string;
  generalStatus: 'OFFLINE';
  components: {
    esp32: { ok: false; status: 'OFFLINE' };
  };
}

export type DiagnosticsPayload = DiagnosticsFull | DiagnosticsOffline;

export const isOfflineDiagnostics = (
  payload: DiagnosticsPayload,
): payload is DiagnosticsOffline => payload.generalStatus === 'OFFLINE';

export const isFullDiagnostics = (
  payload: DiagnosticsPayload,
): payload is DiagnosticsFull => payload.generalStatus !== 'OFFLINE';

/** Respuesta de GET /irrigation/diagnostics. */
export interface DiagnosticsResponse {
  hasData: boolean;
  deviceCode: string;
  /** Momento en que el BACKEND recibió el mensaje (ISO 8601). */
  receivedAt: string | null;
  /** true si el broker lo entregó como mensaje retenido (posible dato viejo). */
  retained: boolean | null;
  data: DiagnosticsPayload | null;
}

/* -------------------------------------------------------------------------- */
/*  Validación en tiempo de ejecución                                          */
/* -------------------------------------------------------------------------- */

type FieldType = 'string' | 'number' | 'boolean';

// Campos obligatorios (además de `ok` y `status`) de cada componente.
const COMPONENT_FIELDS = {
  esp32: { wifi: 'string', rssi: 'number' },
  sensor: { adc: 'number', moisture: 'number' },
  relay: { adc: 'number', active: 'boolean' },
  battery: { adc: 'number', level: 'number' },
  pump: { adc: 'number', running: 'boolean' },
  wiring: {},
} as const satisfies Record<ComponentKey, Record<string, FieldType>>;

const COMPONENT_KEYS = Object.keys(COMPONENT_FIELDS) as ComponentKey[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isValidComponent(key: ComponentKey, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.ok !== 'boolean' || typeof value.status !== 'string') return false;

  const fields: Record<string, FieldType> = COMPONENT_FIELDS[key];
  return Object.entries(fields).every(([field, type]) => typeof value[field] === type);
}

function isDiagnosticsPayload(value: unknown): value is DiagnosticsPayload {
  if (!isRecord(value)) return false;
  if (typeof value.deviceId !== 'string' || typeof value.generalStatus !== 'string') {
    return false;
  }

  // El mensaje LWT es parcial: solo exige components.esp32.
  if (value.generalStatus === 'OFFLINE') {
    return isRecord(value.components) && isRecord(value.components.esp32);
  }

  if (value.generalStatus !== 'ALL_OK' && value.generalStatus !== 'FALLO_DETECTADO') {
    return false;
  }
  if (value.mode !== 'AUTO' && value.mode !== 'MANUAL') return false;
  if (typeof value.thresholdMin !== 'number' || typeof value.thresholdMax !== 'number') {
    return false;
  }

  const components = value.components;
  if (!isRecord(components)) return false;
  return COMPONENT_KEYS.every((key) => isValidComponent(key, components[key]));
}

/**
 * Valida la respuesta del backend. Devuelve null si el formato no coincide con
 * lo que publica el firmware, para no mostrar datos incorrectos en pantalla.
 */
export function parseDiagnosticsResponse(value: unknown): DiagnosticsResponse | null {
  if (!isRecord(value)) return null;
  if (typeof value.hasData !== 'boolean' || typeof value.deviceCode !== 'string') {
    return null;
  }

  if (!value.hasData) {
    return {
      hasData: false,
      deviceCode: value.deviceCode,
      receivedAt: null,
      retained: null,
      data: null,
    };
  }

  if (typeof value.receivedAt !== 'string' || !isDiagnosticsPayload(value.data)) {
    return null;
  }

  return {
    hasData: true,
    deviceCode: value.deviceCode,
    receivedAt: value.receivedAt,
    retained: typeof value.retained === 'boolean' ? value.retained : null,
    data: value.data,
  };
}
