import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { COMPONENT_ORDER } from '@/constants/diagnostics';
import { COLORES } from '@/constants/riego-colors';
import { isOfflineDiagnostics, type DiagnosticsPayload } from '@/types/diagnostics';

import type { IconName } from './card-model';

interface DiagnosticsBannerProps {
  payload: DiagnosticsPayload;
  /** true cuando los datos están desactualizados. */
  dimmed: boolean;
}

function Badge({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.badge}>
      <MaterialCommunityIcons name={icon} size={14} color="#FFFFFF" />
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function DiagnosticsBanner({ payload, dimmed }: DiagnosticsBannerProps) {
  let background: string = COLORES.bien;
  let icon: IconName = 'check-circle';
  let title = 'Sistema operativo';
  let detail = payload.deviceId;

  if (isOfflineDiagnostics(payload)) {
    background = COLORES.tintaSuave;
    icon = 'wifi-off';
    title = 'Dispositivo desconectado';
    detail = `${payload.deviceId} · el ESP32 perdió la conexión con el broker`;
  } else if (payload.generalStatus === 'FALLO_DETECTADO') {
    const fallas = COMPONENT_ORDER.filter((key) => !payload.components[key].ok).length;
    background = COLORES.alerta;
    icon = 'alert-octagon';
    title = '¡Falla de hardware detectada!';
    detail = `${payload.deviceId} · ${fallas} ${fallas === 1 ? 'componente con falla' : 'componentes con falla'}`;
  }

  return (
    <View
      accessible
      accessibilityRole="summary"
      style={[styles.banner, { backgroundColor: background }, dimmed && styles.dimmed]}
    >
      <View style={styles.top}>
        <MaterialCommunityIcons name={icon} size={38} color="#FFFFFF" />
        <View style={styles.texts}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      </View>

      {!isOfflineDiagnostics(payload) ? (
        <View style={styles.badges}>
          <Badge icon={payload.mode === 'AUTO' ? 'autorenew' : 'hand-back-right'} label={`Modo ${payload.mode}`} />
          <Badge icon="arrow-collapse-down" label={`Mín ${payload.thresholdMin}%`} />
          <Badge icon="arrow-collapse-up" label={`Máx ${payload.thresholdMax}%`} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 16, padding: 16 },
  dimmed: { opacity: 0.6 },
  top: { flexDirection: 'row', alignItems: 'center' },
  texts: { flex: 1, marginLeft: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  detail: { color: 'rgba(255,255,255,0.88)', fontSize: 13, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 4,
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginLeft: 4 },
});
