import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { COMPONENT_TITLES, statusLabel } from '@/constants/diagnostics';
import {
  isOfflineDiagnostics,
  type ComponentKey,
  type DiagnosticsPayload,
} from '@/types/diagnostics';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * ok       -> el componente reporta ok:true
 * warning  -> ok:true pero con una condición a revisar (sonda al aire)
 * error    -> ok:false
 * active   -> relé activo o bomba en marcha
 * unknown  -> el dispositivo no reportó este componente (está desconectado)
 */
export type CardState = 'ok' | 'warning' | 'error' | 'active' | 'unknown';

export interface CardModel {
  key: ComponentKey;
  title: string;
  icon: IconName;
  state: CardState;
  primary: string;
  lines: string[];
}

const BASE_ICONS: Record<ComponentKey, IconName> = {
  esp32: 'chip',
  sensor: 'water-percent',
  relay: 'electric-switch',
  battery: 'battery',
  pump: 'water-pump',
  wiring: 'connection',
};

const batteryIcon = (level: number): IconName => {
  if (level >= 90) return 'battery';
  if (level >= 60) return 'battery-70';
  if (level >= 30) return 'battery-40';
  return 'battery-10';
};

export function buildCardModel(key: ComponentKey, payload: DiagnosticsPayload): CardModel {
  const title = COMPONENT_TITLES[key];
  const icon = BASE_ICONS[key];

  // Mensaje de última voluntad: el dispositivo solo informa que se desconectó.
  if (isOfflineDiagnostics(payload)) {
    if (key === 'esp32') {
      return {
        key,
        title,
        icon,
        state: 'error',
        primary: 'Desconectado',
        lines: ['Sin conexión con el broker'],
      };
    }
    return { key, title, icon, state: 'unknown', primary: '—', lines: ['Sin lectura'] };
  }

  const c = payload.components;

  switch (key) {
    case 'esp32':
      return {
        key,
        title,
        icon,
        state: c.esp32.ok ? 'ok' : 'error',
        primary: c.esp32.ok ? 'En línea' : 'Falla',
        lines: [`Red: ${c.esp32.wifi}`, `Señal: ${c.esp32.rssi} dBm`],
      };

    case 'sensor': {
      const { ok, status, moisture, adc } = c.sensor;
      return {
        key,
        title,
        icon,
        state: !ok ? 'error' : status === 'CONECTADO_EN_AIRE' ? 'warning' : 'ok',
        primary: ok ? `${moisture}%` : 'Falla',
        lines: [statusLabel(key, status), `ADC ${adc}`],
      };
    }

    case 'relay': {
      const { ok, status, active, adc } = c.relay;
      return {
        key,
        title,
        icon,
        state: !ok ? 'error' : active ? 'active' : 'ok',
        primary: !ok ? 'Falla' : active ? 'Activo' : 'En espera',
        lines: [statusLabel(key, status), `ADC ${adc}`],
      };
    }

    case 'battery': {
      const { ok, status, level, adc } = c.battery;
      return {
        key,
        title,
        icon: ok ? batteryIcon(level) : 'battery-off-outline',
        state: ok ? 'ok' : 'error',
        primary: ok ? `${level}%` : 'Falla',
        lines: [statusLabel(key, status), `Nivel estimado · ADC ${adc}`],
      };
    }

    case 'pump': {
      const { ok, status, running, adc } = c.pump;
      return {
        key,
        title,
        icon,
        state: !ok ? 'error' : running ? 'active' : 'ok',
        primary: !ok ? 'Falla' : running ? 'En marcha' : 'Detenida',
        lines: [
          statusLabel(key, status),
          // El firmware solo puede comprobar la conexión de la bomba mientras bombea.
          ok && !running ? 'Se verifica al encender' : `ADC ${adc}`,
        ],
      };
    }

    case 'wiring':
      return {
        key,
        title,
        icon,
        state: c.wiring.ok ? 'ok' : 'error',
        primary: c.wiring.ok ? 'Completo' : 'Incompleto',
        lines: [statusLabel(key, c.wiring.status)],
      };
  }
}
