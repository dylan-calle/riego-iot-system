import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { COLORES } from '@/constants/riego-colors';

import type { CardModel, CardState } from './card-model';

const STATE_COLOR: Record<CardState, string> = {
  ok: COLORES.bien,
  warning: COLORES.aviso,
  error: COLORES.alerta,
  active: COLORES.agua,
  unknown: COLORES.reposo,
};

interface ComponentCardProps {
  model: CardModel;
  /** Valor animado compartido (1 -> 0.45) para el parpadeo de las tarjetas en falla. */
  blink: Animated.Value;
  /** true cuando los datos están desactualizados: la tarjeta se atenúa y no parpadea. */
  dimmed: boolean;
}

function ComponentCardBase({ model, blink, dimmed }: ComponentCardProps) {
  const color = STATE_COLOR[model.state];
  const blinking = model.state === 'error' && !dimmed;

  return (
    <Animated.View
      accessible
      accessibilityLabel={`${model.title}: ${model.primary}. ${model.lines.join('. ')}`}
      style={[
        styles.card,
        { borderColor: color },
        dimmed && styles.dimmed,
        blinking && { opacity: blink },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: `${color}22` }]}>
          <MaterialCommunityIcons name={model.icon} size={22} color={color} />
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {model.title}
        </Text>
      </View>

      <Text style={[styles.primary, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {model.primary}
      </Text>

      {model.lines.map((line) => (
        <Text key={line} style={styles.line} numberOfLines={2}>
          {line}
        </Text>
      ))}
    </Animated.View>
  );
}

export const ComponentCard = memo(ComponentCardBase);

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORES.tarjeta,
    borderRadius: 16,
    borderWidth: 2,
    padding: 12,
    minHeight: 148,
  },
  dimmed: { opacity: 0.5 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: COLORES.tinta,
  },
  primary: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 },
  line: { fontSize: 12, color: COLORES.tintaSuave, lineHeight: 17 },
});
