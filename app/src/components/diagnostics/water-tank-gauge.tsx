import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { statusLabel } from '@/constants/diagnostics';
import { COLORES } from '@/constants/riego-colors';
import type { WaterTankComponent } from '@/types/diagnostics';

const ALTO_TANQUE = 140;
/** Por debajo de este nivel el firmware bloquea la bomba. */
const NIVEL_MINIMO = 10;

interface WaterTankGaugeProps {
  tank: WaterTankComponent;
  /** true cuando dejaron de llegar mensajes del ESP32: se atenúa. */
  dimmed?: boolean;
}

export function WaterTankGauge({ tank, dimmed = false }: WaterTankGaugeProps) {
  const level = Math.min(100, Math.max(0, tank.level));
  const nivel = useRef(new Animated.Value(level)).current;

  // El tanque sube o baja suavemente cada vez que llega una lectura nueva.
  useEffect(() => {
    Animated.timing(nivel, {
      toValue: level,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [level, nivel]);

  const color = tank.ok ? COLORES.agua : COLORES.alerta;
  const altura = nivel.interpolate({ inputRange: [0, 100], outputRange: [0, ALTO_TANQUE] });

  return (
    <View style={[styles.cuerpo, dimmed && styles.dimmed]}>
      <View
        style={styles.tanque}
        accessible
        accessibilityLabel={`Nivel de agua del tanque: ${level} por ciento`}
      >
        <Animated.View style={[styles.relleno, { height: altura, backgroundColor: color }]} />
        <View style={[styles.marca, { bottom: (ALTO_TANQUE * NIVEL_MINIMO) / 100 }]} />
      </View>

      <View style={styles.info}>
        <Text style={styles.valor}>{`${level} %`}</Text>
        <Text style={[styles.estado, { color }]}>{statusLabel('waterTank', tank.status)}</Text>
        <Text style={styles.detalle}>
          {tank.ok
            ? 'La bomba puede regar.'
            : 'La bomba queda bloqueada hasta que suba el nivel.'}
        </Text>
        <Text style={styles.nota}>
          El HC-SR04 mide la distancia hasta el agua. La raya marca el {NIVEL_MINIMO} %, el mínimo
          para regar.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cuerpo: { flexDirection: 'row', alignItems: 'flex-end' },
  dimmed: { opacity: 0.5 },
  tanque: {
    width: 72,
    height: ALTO_TANQUE,
    borderRadius: 14,
    backgroundColor: '#E1E9E5',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  relleno: { width: '100%' },
  marca: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORES.tinta,
    opacity: 0.4,
  },
  info: { flex: 1, paddingLeft: 18 },
  valor: { fontSize: 44, fontWeight: '800', color: COLORES.tinta, letterSpacing: -1.5 },
  estado: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  detalle: { fontSize: 13, color: COLORES.tintaSuave, marginTop: 2 },
  nota: { fontSize: 11, color: COLORES.tintaSuave, marginTop: 8, lineHeight: 15 },
});
