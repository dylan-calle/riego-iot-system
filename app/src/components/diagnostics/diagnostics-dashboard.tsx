import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { COMPONENT_ORDER } from '@/constants/diagnostics';
import { COLORES } from '@/constants/riego-colors';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import { useDiagnosticsLog } from '@/hooks/use-diagnostics-log';

import { buildCardModel } from './card-model';
import { ComponentCard } from './component-card';
import { DiagnosticsBanner } from './diagnostics-banner';
import { EventConsole } from './event-console';

interface DiagnosticsDashboardProps {
  /** JWT del usuario si el backend lo exige. Lo provee quien maneja la autenticación. */
  token?: string | null;
}

const formatTime = (date: Date): string => date.toLocaleTimeString('es-BO', { hour12: false });

export default function DiagnosticsDashboard({ token = null }: DiagnosticsDashboardProps) {
  const { diagnostics, receivedAt, isStale, isLoading, error } = useDiagnostics({ token });
  const logs = useDiagnosticsLog({ diagnostics, isStale, error });

  const cards = useMemo(
    () =>
      diagnostics ? COMPONENT_ORDER.map((key) => buildCardModel(key, diagnostics)) : [],
    [diagnostics],
  );

  // Parpadeo suave de las tarjetas en falla (se desactiva si el sistema pide menos movimiento).
  const blink = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const hasFailure = !isStale && cards.some((card) => card.state === 'error');

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!hasFailure || reduceMotion) {
      blink.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(blink, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasFailure, reduceMotion, blink]);

  const showEmpty = !isLoading && !diagnostics && !error;

  return (
    <View style={styles.seccion}>
      <Text style={styles.titulo}>Estado del circuito</Text>

      <View style={styles.conexion}>
        <View
          style={[
            styles.punto,
            { backgroundColor: error || isStale ? COLORES.alerta : COLORES.agua },
          ]}
        />
        <Text style={styles.conexionTexto}>
          {receivedAt
            ? `Último mensaje del dispositivo: ${formatTime(receivedAt)}`
            : isLoading
              ? 'Conectando...'
              : 'Sin mensajes del dispositivo'}
        </Text>
      </View>

      {error ? (
        <View style={styles.aviso}>
          <Text style={styles.avisoTexto}>
            {error.kind === 'unauthorized'
              ? 'El diagnóstico requiere iniciar sesión. Usa «Iniciar sesión» en la parte superior de la pantalla.'
              : error.kind === 'forbidden'
                ? error.message
                : `${error.message} ${diagnostics ? 'Se muestran los últimos datos recibidos. ' : ''}Se reintenta cada 3 segundos.`}
          </Text>
        </View>
      ) : null}

      {isStale && diagnostics ? (
        <View style={styles.aviso}>
          <Text style={styles.avisoTexto}>
            No llegan mensajes nuevos del ESP32. Se muestra el último diagnóstico recibido y los
            estados pueden no coincidir con el circuito real. Revisa que esté encendido y conectado.
          </Text>
        </View>
      ) : null}

      {isLoading && !diagnostics ? (
        <ActivityIndicator style={styles.cargando} size="large" color={COLORES.agua} />
      ) : null}

      {showEmpty ? (
        <Text style={styles.nota}>
          Aún no llega ningún diagnóstico del ESP32. Aparecerá cuando el dispositivo publique en
          home/garden/diagnostics.
        </Text>
      ) : null}

      {diagnostics ? (
        <>
          <View style={styles.bloque}>
            <DiagnosticsBanner payload={diagnostics} dimmed={isStale} />
          </View>

          <View style={styles.grid}>
            {cards.map((card) => (
              <View key={card.key} style={styles.celda}>
                <ComponentCard model={card} blink={blink} dimmed={isStale} />
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.bloque}>
        <EventConsole logs={logs} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seccion: { marginTop: 24 },
  titulo: { fontSize: 20, fontWeight: '700', color: COLORES.tinta, marginBottom: 6 },
  conexion: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  punto: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  conexionTexto: { fontSize: 13, color: COLORES.tintaSuave },
  aviso: {
    marginBottom: 12,
    backgroundColor: COLORES.alertaClara,
    borderLeftWidth: 4,
    borderLeftColor: COLORES.alerta,
    padding: 12,
    borderRadius: 6,
  },
  avisoTexto: { fontSize: 14, color: COLORES.tinta, lineHeight: 20 },
  cargando: { marginVertical: 24 },
  nota: { fontSize: 13, color: COLORES.tintaSuave, lineHeight: 18, marginVertical: 12 },
  bloque: { marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 7 },
  celda: { width: '50%', padding: 5 },
});
