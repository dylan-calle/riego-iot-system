import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg from 'react-native-svg';

import { COMPONENT_ORDER } from '@/constants/diagnostics';
import { COLORES } from '@/constants/riego-colors';
import type { ComponentKey, DiagnosticsPayload } from '@/types/diagnostics';

import { buildCardModel, type CardModel, type CardState } from './card-model';
import {
  LED_POSITIONS,
  SchematicArt,
  SchematicWires,
  VB_H,
  VB_W,
  type WireStates,
} from './circuit-art';

const LED_COLOR: Record<CardState, string> = {
  ok: COLORES.bien,
  active: COLORES.bien,
  warning: COLORES.aviso,
  error: '#DC2626',
  unknown: COLORES.reposo,
};

const STATE_TEXT: Record<CardState, string> = {
  ok: 'Funcionando',
  active: 'Funcionando · activo',
  warning: 'Funciona, con aviso',
  error: 'Falla',
  unknown: 'Sin lectura',
};

/** Qué revisar cuando una pieza falla o avisa (según los estados que emite el firmware). */
const HINTS: Partial<Record<ComponentKey, Partial<Record<CardState, string>>>> = {
  esp32: { error: 'El ESP32 perdió la conexión con el broker. Revisa su alimentación y el Wi-Fi.' },
  sensor: {
    error: 'Revisa los 3 cables del sensor: alimentación, tierra y señal.',
    warning: 'La sonda está fuera de la tierra: el porcentaje no refleja la humedad del suelo.',
  },
  relay: { error: 'Revisa la alimentación del relé y el cable de señal que viene del ESP32.' },
  battery: { error: 'Revisa que las 4 pilas estén puestas y bien conectadas.' },
  pump: { error: 'Revisa el cable de la bomba y que el relé y las pilas tengan energía.' },
  wiring: { error: 'Algún componente reporta desconexión: mira las otras luces en rojo.' },
};

const BUBBLE_MAX_WIDTH = 236;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Valor animado (1 -> 0.35) para el parpadeo de las luces rojas. */
function useBlink(enabled: boolean): Animated.Value {
  const value = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduceMotion(v);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!enabled || reduceMotion) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.35,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, reduceMotion, value]);

  return value;
}

function deriveWireStates(m: Record<ComponentKey, CardModel>): WireStates {
  const pumpActive = m.pump.state === 'active';
  const power: CardState =
    m.battery.state === 'error' || m.battery.state === 'unknown'
      ? m.battery.state
      : pumpActive
        ? 'active'
        : 'ok';
  return {
    sensor: m.sensor.state,
    signal: m.relay.state,
    plus: power,
    load: m.pump.state,
    minus: m.pump.state,
  };
}

interface LedProps {
  componentKey: ComponentKey;
  model: CardModel;
  selected: boolean;
  blinking: boolean;
  blink: Animated.Value;
  onPress: (key: ComponentKey) => void;
}

function Led({ componentKey, model, selected, blinking, blink, onPress }: LedProps) {
  const { x, y } = LED_POSITIONS[componentKey];
  const color = LED_COLOR[model.state];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${model.title}: ${STATE_TEXT[model.state]}. Toca para ver el detalle.`}
      onPress={() => onPress(componentKey)}
      style={[
        styles.ledTouch,
        { left: `${(x / VB_W) * 100}%`, top: `${(y / VB_H) * 100}%` },
      ]}
    >
      <Animated.View
        style={[
          styles.led,
          { backgroundColor: color, shadowColor: color },
          selected && styles.ledSelected,
          blinking && { opacity: blink },
        ]}
      />
    </Pressable>
  );
}

interface CalloutProps {
  model: CardModel;
  width: number;
  onClose: () => void;
}

function Callout({ model, width, onClose }: CalloutProps) {
  const { x, y } = LED_POSITIONS[model.key];
  const scale = width / VB_W;
  const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, width - 16);
  const left = clamp(x * scale - bubbleWidth / 2, 8, width - bubbleWidth - 8);
  const below = y < VB_H / 2;
  const color = LED_COLOR[model.state];
  const hint = HINTS[model.key]?.[model.state];

  return (
    <View
      style={[
        styles.bubble,
        { width: bubbleWidth, left },
        below ? { top: y * scale + 16 } : { bottom: (VB_H - y) * scale + 16 },
      ]}
    >
      <View
        style={[
          styles.pointer,
          { left: clamp(x * scale - left - 6, 14, bubbleWidth - 26) },
          below ? styles.pointerTop : styles.pointerBottom,
        ]}
      />

      <View style={styles.bubbleHeader}>
        <MaterialCommunityIcons name={model.icon} size={20} color={color} />
        <Text style={styles.bubbleTitle} numberOfLines={1}>
          {model.title}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Cerrar detalle"
        >
          <MaterialCommunityIcons name="close" size={18} color={COLORES.tintaSuave} />
        </Pressable>
      </View>

      <View style={[styles.chip, { backgroundColor: `${color}22` }]}>
        <View style={[styles.chipDot, { backgroundColor: color }]} />
        <Text style={[styles.chipText, { color }]}>{STATE_TEXT[model.state]}</Text>
      </View>

      <Text style={styles.bubblePrimary}>{model.primary}</Text>
      {model.lines.map((line) => (
        <Text key={line} style={styles.bubbleLine}>
          {line}
        </Text>
      ))}
      {hint ? <Text style={styles.bubbleHint}>{hint}</Text> : null}
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

interface CircuitSchematicProps {
  diagnostics: DiagnosticsPayload;
  /** true cuando dejaron de llegar mensajes del ESP32: se atenúa y no parpadea. */
  isStale?: boolean;
}

export function CircuitSchematic({ diagnostics, isStale = false }: CircuitSchematicProps) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<ComponentKey | null>(null);

  const models = useMemo(
    () =>
      Object.fromEntries(
        COMPONENT_ORDER.map((key) => [key, buildCardModel(key, diagnostics)]),
      ) as Record<ComponentKey, CardModel>,
    [diagnostics],
  );
  const wireStates = useMemo(() => deriveWireStates(models), [models]);

  const hasFailure = !isStale && COMPONENT_ORDER.some((key) => models[key].state === 'error');
  const blink = useBlink(hasFailure);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const toggle = (key: ComponentKey) => setSelected((current) => (current === key ? null : key));

  return (
    <View>
      <View style={styles.legend}>
        <LegendItem color={LED_COLOR.ok} label="Funciona" />
        <LegendItem color={LED_COLOR.error} label="Falla" />
        <LegendItem color={LED_COLOR.warning} label="Aviso" />
        <LegendItem color={LED_COLOR.unknown} label="Sin lectura" />
      </View>
      <Text style={styles.legendHint}>Toca una luz para ver el estado de esa pieza.</Text>

      <View style={styles.scene} onLayout={onLayout}>
        <View style={[StyleSheet.absoluteFill, isStale && styles.stale]} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}>
            <SchematicArt />
            <SchematicWires states={wireStates} wiring={models.wiring.state} />
          </Svg>
        </View>

        {/* Tocar fuera de una luz cierra la ventanita. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setSelected(null)}
          accessible={false}
        />

        {COMPONENT_ORDER.map((key) => (
          <Led
            key={key}
            componentKey={key}
            model={models[key]}
            selected={selected === key}
            blinking={hasFailure && models[key].state === 'error'}
            blink={blink}
            onPress={toggle}
          />
        ))}

        {selected && width > 0 ? (
          <Callout model={models[selected]} width={width} onClose={() => setSelected(null)} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { fontSize: 12, color: COLORES.tintaSuave },
  legendHint: { fontSize: 12, color: COLORES.tintaSuave, marginBottom: 10 },

  scene: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    aspectRatio: VB_W / VB_H,
  },
  stale: { opacity: 0.5 },

  ledTouch: {
    position: 'absolute',
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  led: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  ledSelected: { transform: [{ scale: 1.3 }], borderColor: COLORES.tinta },

  bubble: {
    position: 'absolute',
    backgroundColor: COLORES.tarjeta,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORES.linea,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  pointer: {
    position: 'absolute',
    width: 12,
    height: 12,
    backgroundColor: COLORES.tarjeta,
    borderColor: COLORES.linea,
    transform: [{ rotate: '45deg' }],
  },
  pointerTop: { top: -7, borderTopWidth: 1, borderLeftWidth: 1 },
  pointerBottom: { bottom: -7, borderBottomWidth: 1, borderRightWidth: 1 },
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  bubbleTitle: { flex: 1, marginLeft: 8, fontSize: 14, fontWeight: '700', color: COLORES.tinta },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 6,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chipText: { fontSize: 12, fontWeight: '700' },
  bubblePrimary: { fontSize: 22, fontWeight: '800', color: COLORES.tinta, letterSpacing: -0.5 },
  bubbleLine: { fontSize: 12, color: COLORES.tintaSuave, lineHeight: 17, marginTop: 1 },
  bubbleHint: {
    fontSize: 12,
    color: COLORES.tinta,
    lineHeight: 17,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORES.linea,
  },
});
