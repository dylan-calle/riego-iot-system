import type { ComponentKey } from '@/types/diagnostics';

export const COMPONENT_ORDER: ComponentKey[] = [
  'esp32',
  'sensor',
  'relay',
  'battery',
  'pump',
  'wiring',
];

export const COMPONENT_TITLES: Record<ComponentKey, string> = {
  esp32: 'ESP32',
  sensor: 'Sensor de humedad',
  relay: 'Módulo relé',
  battery: 'Batería',
  pump: 'Bomba de agua',
  wiring: 'Cableado',
};

/**
 * Texto legible para cada `status` que emite el firmware.
 * Si llega un valor que no está aquí, se muestra tal cual (ver statusLabel).
 */
const STATUS_LABELS: Record<ComponentKey, Record<string, string>> = {
  esp32: {
    ONLINE: 'En línea',
    OFFLINE: 'Desconectado',
  },
  sensor: {
    DESCONECTADO: 'Sensor desconectado',
    OK_EN_TIERRA: 'Sonda en la tierra',
    CONECTADO_EN_AIRE: 'Sonda al aire, fuera de la tierra',
  },
  relay: {
    DESCONECTADO: 'Relé desconectado',
    ACTIVO_CERRADO: 'Contacto cerrado',
    OK_EN_ESPERA: 'En espera',
  },
  battery: {
    CONECTADA_OK: 'Pilas conectadas',
    DESCONECTADA_O_SIN_PILAS: 'Sin pilas o desconectada',
  },
  pump: {
    EN_ESPERA: 'En espera',
    SIN_ENERGIA_PREVIA: 'Sin energía: revisa relé y pilas',
    BOMBEANDO_OK: 'Bombeando',
    CABLE_BOMBA_SUELTO: 'Cable de la bomba suelto',
  },
  wiring: {
    CIRCUITO_COMPLETO: 'Circuito completo',
    COMPONENTE_DESCONECTADO: 'Algún componente desconectado',
  },
};

export function statusLabel(key: ComponentKey, status: string): string {
  return STATUS_LABELS[key][status] ?? status;
}
