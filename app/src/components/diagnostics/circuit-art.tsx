import { memo } from 'react';
import { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { COLORES } from '@/constants/riego-colors';
import type { ComponentKey } from '@/types/diagnostics';

import type { CardState } from './card-model';

/** Tamaño del lienzo. Todo el dibujo se escala a partir de estas medidas. */
export const VB_W = 360;
export const VB_H = 456;

/** Dónde va la luz de cada pieza (en coordenadas del lienzo). */
export const LED_POSITIONS: Record<ComponentKey, { x: number; y: number }> = {
  sensor: { x: 160, y: 100 },
  esp32: { x: 213, y: 216 },
  wiring: { x: 312, y: 160 },
  relay: { x: 180, y: 300 },
  battery: { x: 119.5, y: 360 },
  pump: { x: 240.5, y: 360 },
};

const LABEL = { fontSize: 10, fontWeight: '600', fill: COLORES.tintaSuave, textAnchor: 'middle' } as const;

/** Piezas fijas: no dependen de los datos, por eso se dibujan una sola vez. */
function ArtBase() {
  return (
    <G>
      <Rect x={0} y={0} width={VB_W} height={VB_H} rx={18} fill="#EAF1ED" />

      {/* Sensor de humedad en la tierra */}
      <Rect x={44} y={58} width={14} height={60} rx={3} fill="#CDBF98" />
      <Rect x={78} y={58} width={14} height={60} rx={3} fill="#CDBF98" />
      <Rect x={18} y={98} width={102} height={30} rx={9} fill="#7A5230" />
      <Rect x={18} y={98} width={102} height={8} rx={4} fill="#8C6239" />
      <Rect x={24} y={18} width={88} height={42} rx={6} fill="#1E293B" />
      <Rect x={104} y={30} width={8} height={16} rx={1.5} fill="#E5B94B" />
      <SvgText x={64} y={43} fontSize={9} fontWeight="700" fill="#CBD5E1" textAnchor="middle">
        SENSOR
      </SvgText>
      <SvgText x={68} y={143} {...LABEL}>
        Sensor de humedad
      </SvgText>

      {/* Protoboard */}
      <Rect x={30} y={150} width={300} height={122} rx={10} fill="#F3EFE4" stroke="#D8D2C0" strokeWidth={1.5} />
      <Rect x={30} y={204} width={300} height={12} fill="#E2DCC9" />
      <Path d="M44 157 H316" stroke="#E11D48" strokeWidth={1.5} />
      <Path d="M44 163 H316" stroke="#2563EB" strokeWidth={1.5} />
      <Path d="M44 259 H316" stroke="#2563EB" strokeWidth={1.5} />
      <Path d="M44 265 H316" stroke="#E11D48" strokeWidth={1.5} />
      {[176, 184, 192, 228, 236, 244].map((y) => (
        <Path
          key={y}
          d={`M44 ${y} H316`}
          stroke="#B8B2A0"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="0.1 8"
        />
      ))}
      <SvgText x={250} y={143} {...LABEL}>
        Protoboard + ESP32
      </SvgText>

      {/* ESP32 */}
      <Rect x={90} y={168} width={180} height={84} rx={6} fill="#111827" />
      <Path d="M100 173 H260" stroke="#E5B94B" strokeWidth={5} strokeDasharray="4 3.2" />
      <Path d="M100 247 H260" stroke="#E5B94B" strokeWidth={5} strokeDasharray="4 3.2" />
      <Rect x={82} y={196} width={16} height={28} rx={2} fill="#CBD5E1" />
      <Rect x={168} y={180} width={90} height={46} rx={3} fill="#9CA3AF" />
      <Rect x={168} y={180} width={90} height={9} rx={3} fill="#CBD5E1" />
      <SvgText x={213} y={204} fontSize={11} fontWeight="800" fill="#111827" textAnchor="middle">
        ESP32
      </SvgText>
      <SvgText x={128} y={214} fontSize={8} fill="#94A3B8" textAnchor="middle">
        DevKit
      </SvgText>

      {/* Pilas 4xAA */}
      <Rect x={12} y={334} width={94} height={96} rx={9} fill="#1F2937" />
      {[0, 1, 2, 3].map((i) => (
        <G key={i}>
          <Rect x={20} y={342 + i * 22} width={78} height={17} rx={6} fill="#374151" />
          <Rect x={20} y={342 + i * 22} width={14} height={17} rx={6} fill="#F59E0B" />
          <SvgText x={64} y={354 + i * 22} fontSize={8} fill="#E5E7EB" textAnchor="middle">
            AA 1.5V
          </SvgText>
        </G>
      ))}
      <Rect x={104} y={354} width={6} height={12} rx={1} fill="#DC2626" />
      <Circle cx={59} cy={432} r={4} fill="#9CA3AF" />
      <SvgText x={59} y={326} {...LABEL}>
        Pilas 4×AA
      </SvgText>

      {/* Módulo relé */}
      <Rect x={133} y={334} width={94} height={96} rx={6} fill="#2563EB" />
      <Rect x={147} y={346} width={46} height={38} rx={3} fill="#1E3A8A" />
      <Rect x={199} y={346} width={20} height={10} rx={2} fill="#111827" />
      <Path d="M158 340 H202" stroke="#E5B94B" strokeWidth={4} strokeDasharray="4 3" />
      <Rect x={127} y={350} width={10} height={20} rx={2} fill="#22C55E" />
      <Rect x={223} y={350} width={10} height={20} rx={2} fill="#22C55E" />
      <SvgText x={180} y={410} fontSize={11} fontWeight="800" fill="#DBEAFE" textAnchor="middle">
        RELÉ
      </SvgText>

      {/* Bomba en su vaso */}
      <Path d="M256 342 H346 L338 432 H264 Z" fill="#CFEFF2" stroke="#9DB0AB" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M258.7 372 H343.3 L338 432 H264 Z" fill="#7CD3DC" opacity={0.55} />
      <Rect x={284} y={384} width={36} height={28} rx={7} fill="#E5E7EB" stroke="#94A3B8" strokeWidth={1.5} />
      <Rect x={318} y={392} width={10} height={8} rx={2} fill="#94A3B8" />
      <Circle cx={296} cy={398} r={4} fill="#94A3B8" />
      <SvgText x={301} y={334} {...LABEL}>
        Bomba de agua
      </SvgText>
    </G>
  );
}

export const SchematicArt = memo(ArtBase);

/* -------------------------------------------------------------------------- */
/*  Cables: cambian de color según el estado de la pieza a la que sirven       */
/* -------------------------------------------------------------------------- */

export interface WireStates {
  /** Sensor -> ESP32. */
  sensor: CardState;
  /** ESP32 -> relé (señal de control). */
  signal: CardState;
  /** Pilas (+) -> relé. */
  plus: CardState;
  /** Relé -> bomba. */
  load: CardState;
  /** Bomba (−) -> pilas (−). */
  minus: CardState;
}

const WIRE_PATHS: Record<keyof WireStates, string> = {
  sensor: 'M112 38 H160 V172',
  signal: 'M180 252 V334',
  plus: 'M106 360 H133',
  load: 'M227 360 H254 H270 V395 H284',
  minus: 'M302 412 V446 H59 V434',
};

const WIRE_STYLE: Record<CardState, { color: string; dashed: boolean }> = {
  ok: { color: '#475569', dashed: false },
  active: { color: COLORES.agua, dashed: false },
  warning: { color: COLORES.aviso, dashed: false },
  error: { color: '#DC2626', dashed: true },
  unknown: { color: COLORES.reposo, dashed: true },
};

interface SchematicWiresProps {
  states: WireStates;
  /** Estado del protoboard: si falla se resalta su contorno. */
  wiring: CardState;
}

export function SchematicWires({ states, wiring }: SchematicWiresProps) {
  return (
    <G>
      {wiring === 'error' ? (
        <Rect
          x={30}
          y={150}
          width={300}
          height={122}
          rx={10}
          fill="none"
          stroke="#DC2626"
          strokeWidth={2.5}
          strokeDasharray="8 6"
        />
      ) : null}
      {(Object.keys(WIRE_PATHS) as (keyof WireStates)[]).map((id) => {
        const { color, dashed } = WIRE_STYLE[states[id]];
        return (
          <Path
            key={id}
            d={WIRE_PATHS[id]}
            fill="none"
            stroke={color}
            strokeWidth={states[id] === 'active' ? 4.5 : 3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dashed ? '7 6' : undefined}
          />
        );
      })}
    </G>
  );
}
