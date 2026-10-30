import { useRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const LOG_COLORS = {
  alerta: '#FF8A5B',
  ok: '#4ADE80',
  riego: '#FACC15',
  info: '#22D3EE',
  neutro: '#9CA3AF',
} as const;

// Las líneas tienen el formato "HH:MM:SS [NIVEL] mensaje".
function colorFor(line: string): string {
  if (line.includes('[ALERTA]')) return LOG_COLORS.alerta;
  if (line.includes('[OK]')) return LOG_COLORS.ok;
  if (line.includes('[RIEGO]')) return LOG_COLORS.riego;
  if (line.includes('[INFO]')) return LOG_COLORS.info;
  return LOG_COLORS.neutro;
}

interface EventConsoleProps {
  logs: string[];
  height?: number;
}

export function EventConsole({ logs, height = 220 }: EventConsoleProps) {
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View style={[styles.terminal, { height }]}>
      <View style={styles.titleBar}>
        <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
        <View style={[styles.dot, { backgroundColor: '#FACC15' }]} />
        <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
        <Text style={styles.titleText}>eventos · home/garden/diagnostics</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {logs.length === 0 ? (
          <Text style={[styles.line, { color: LOG_COLORS.neutro }]}>
            $ esperando mensajes del dispositivo...
          </Text>
        ) : (
          logs.map((line, index) => (
            <Text key={`${index}-${line}`} style={[styles.line, { color: colorFor(line) }]}>
              {line}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  terminal: {
    backgroundColor: '#050B0A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#16302D',
    overflow: 'hidden',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0E1F1D',
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  titleText: { marginLeft: 6, color: '#9CA3AF', fontFamily: MONO, fontSize: 11 },
  scroll: { flex: 1 },
  content: { padding: 12 },
  line: { fontFamily: MONO, fontSize: 12, lineHeight: 18 },
});
