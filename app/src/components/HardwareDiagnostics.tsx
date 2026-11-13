import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import { DiagnosticsFull } from '@/types/diagnostics';
import { CircuitSchematic } from '@/components/diagnostics/circuit-schematic';
import { WaterTankGauge } from '@/components/diagnostics/water-tank-gauge';

const COLORES = {
  ok: '#2E9E4F',       // Verde
  alerta: '#C2571A',   // Rojo
  activo: '#1FA7B5',   // Azul/Agua
  aviso: '#C98A1B',    // Ámbar
  fondoCard: '#FFFFFF',
  bordeNormal: '#D5DFDB',
  textoOscuro: '#12302F',
  textoGris: '#5C706E',
  terminalBg: '#0F172A',
  terminalText: '#4ADE80', // Verde consola
};

// Un "FALLO_DETECTADO" solo se muestra si dura al menos este tiempo. Al encender o apagar
// la bomba el firmware reporta un fallo momentáneo (1-2 s) que no es un fallo real.
const GRACIA_FALLO_MS = 4500;

interface HardwareDiagnosticsProps {
  token: string | null;
  enabled: boolean;
}

export default function HardwareDiagnostics({ token, enabled }: HardwareDiagnosticsProps) {
  const { diagnostics, isLoading, error, isStale } = useDiagnostics({
    token,
    enabled,
    intervalMs: 3000,
  });

  // Diagnóstico que realmente se muestra: mientras un fallo sea reciente (posible parpadeo
  // al encender/apagar la bomba) se mantiene la última lectura sana en pantalla.
  const [vista, setVista] = useState<typeof diagnostics>(null);
  const ultimoSanoRef = useRef<typeof diagnostics>(null);
  const inicioFalloRef = useRef<number | null>(null);

  useEffect(() => {
    if (!diagnostics || diagnostics.generalStatus !== 'FALLO_DETECTADO') {
      inicioFalloRef.current = null;
      if (diagnostics && diagnostics.generalStatus !== 'OFFLINE') ultimoSanoRef.current = diagnostics;
      setVista(diagnostics);
      return;
    }

    if (inicioFalloRef.current === null) inicioFalloRef.current = Date.now();
    const transcurrido = Date.now() - inicioFalloRef.current;

    // Fallo que persiste (o sin lectura sana previa): se muestra tal cual
    if (transcurrido >= GRACIA_FALLO_MS || !ultimoSanoRef.current) {
      setVista(diagnostics);
      return;
    }

    // Fallo reciente: se mantiene la última lectura sana y, si no llega una lectura nueva
    // antes de que se cumpla el tiempo, se muestra el fallo.
    const temporizador = setTimeout(() => setVista(diagnostics), GRACIA_FALLO_MS - transcurrido);
    return () => clearTimeout(temporizador);
  }, [diagnostics]);

  const mostrado = vista ?? diagnostics;

  // Estado para la Consola (Logs)
  const [logs, setLogs] = useState<string[]>(['[SISTEMA] Iniciando monitoreo de hardware...']);
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Referencias para detectar cambios y disparar logs
  const prevPumpRef = useRef<boolean | null>(null);
  const prevSensorOkRef = useRef<boolean | null>(null);
  const prevTankOkRef = useRef<boolean | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  const addLog = (msg: string) => {
    const hora = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${hora}] ${msg}`].slice(-30)); // Mantiene los últimos 30
  };

  // Efecto para simular eventos en la terminal cuando cambian los datos
  useEffect(() => {
    if (!mostrado || mostrado.generalStatus === 'OFFLINE') return;
    const diag = mostrado as DiagnosticsFull;

    // Detectar fallos generales
    if (diag.generalStatus !== prevStatusRef.current) {
      if (diag.generalStatus === 'FALLO_DETECTADO') addLog('[ALERTA] Falla de hardware detectada en el circuito.');
      if (diag.generalStatus === 'ALL_OK' && prevStatusRef.current === 'FALLO_DETECTADO') addLog('[INFO] Circuito restablecido. Todo OK.');
      prevStatusRef.current = diag.generalStatus;
    }

    // Detectar cambios en la Bomba
    const pumpRunning = diag.components.pump.running;
    if (pumpRunning !== prevPumpRef.current && prevPumpRef.current !== null) {
      if (pumpRunning) addLog('>>> [ACTUADOR] Relé ACTIVADO (Bomba ENCENDIDA) <<<');
      else addLog('>>> [ACTUADOR] Relé DESACTIVADO (Bomba APAGADA) <<<');
    }
    prevPumpRef.current = pumpRunning;

    // Detectar desconexión del sensor
    const sensorOk = diag.components.sensor.ok;
    if (sensorOk !== prevSensorOkRef.current && prevSensorOkRef.current !== null) {
      if (!sensorOk) addLog('[HARDWARE ERROR] Sensor de humedad desconectado.');
      else addLog('[HARDWARE OK] Sensor reconectado.');
    }
    prevSensorOkRef.current = sensorOk;

    // Detectar nivel crítico del tanque (la bomba se bloquea sola)
    const tank = diag.components.waterTank;
    if (tank.ok !== prevTankOkRef.current && prevTankOkRef.current !== null) {
      if (!tank.ok) addLog(`[ALERTA] Tanque sin agua (nivel ${tank.level}%): la bomba queda bloqueada.`);
      else addLog(`[OK] Tanque con agua (nivel ${tank.level}%): la bomba puede regar.`);
    }
    prevTankOkRef.current = tank.ok;

  }, [mostrado]);

  if (!enabled || !token) return null;

  if (isLoading && !mostrado) {
    return (
      <View style={styles.cargandoContainer}>
        <ActivityIndicator size="small" color={COLORES.activo} />
        <Text style={styles.textoCargando}>Cargando diagnóstico...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.errorContainer]}>
        <Text style={styles.errorTexto}>Error de Diagnóstico: {error.message}</Text>
      </View>
    );
  }

  if (!mostrado || mostrado.generalStatus === 'OFFLINE') {
    return (
      <View>
        {mostrado ? (
          <View style={styles.esquema}>
            <CircuitSchematic diagnostics={mostrado} isStale={isStale} />
          </View>
        ) : null}
        <View style={[styles.container, { backgroundColor: COLORES.alerta }]}>
          <Text style={styles.tituloHeader}>ESP32 FUERA DE LÍNEA</Text>
          <Text style={{ color: '#fff' }}>El equipo no está reportando telemetría.</Text>
        </View>
      </View>
    );
  }

  const diag = mostrado as DiagnosticsFull;
  const isFallo = diag.generalStatus === 'FALLO_DETECTADO';
  // El firmware no incluye el tanque en generalStatus: se avisa aparte para no mostrar "todo OK".
  const sinAgua = !isFallo && !diag.components.waterTank.ok;

  // Función auxiliar para renderizar cada Tarjeta del Grid
  const renderCard = (
    titulo: string,
    isOk: boolean,
    isActive: boolean,
    statusText: string,
    extraA: string,
    extraB?: string,
    isWarning = false
  ) => {
    const borderColor = !isOk
      ? COLORES.alerta
      : isWarning
        ? COLORES.aviso
        : isActive
          ? COLORES.activo
          : COLORES.ok;
    return (
      <View style={[styles.card, { borderColor, borderWidth: !isOk || isActive || isWarning ? 2 : 1 }]}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitulo}>{titulo}</Text>
          <View style={[styles.statusDot, { backgroundColor: borderColor }]} />
        </View>
        <Text style={[styles.cardStatus, { color: borderColor }]}>{statusText}</Text>
        <Text style={styles.cardData}>{extraA}</Text>
        {extraB && <Text style={styles.cardData}>{extraB}</Text>}
      </View>
    );
  };

  return (
    <>
      <View style={styles.esquema}>
        <CircuitSchematic diagnostics={diag} isStale={isStale} />
      </View>

      <View style={styles.container}>
        {/* 1. Header de Estado General */}
        <View style={[styles.header, { backgroundColor: isFallo ? COLORES.alerta : sinAgua ? COLORES.aviso : COLORES.ok }]}>
          <Text style={styles.tituloHeader}>
            {isFallo
            ? '¡FALLA DE HARDWARE DETECTADA!'
            : sinAgua
              ? 'ATENCIÓN: TANQUE SIN AGUA'
              : 'SISTEMA DE HARDWARE OK'}
          </Text>
          <View style={styles.badgesRow}>
            <View style={styles.badge}><Text style={styles.badgeText}>Modo: {diag.mode}</Text></View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Umbral: {diag.thresholdMin}% - {diag.thresholdMax}%</Text>
            </View>
            {isStale && <View style={[styles.badge, { backgroundColor: '#F59E0B' }]}><Text style={styles.badgeText}>Datos Atrasados</Text></View>}
          </View>
        </View>

        {/* Nivel de agua del tanque (sensor HC-SR04) */}
        <View style={styles.tanqueSeccion}>
          <Text style={styles.tanqueTitulo}>Nivel de agua del tanque</Text>
          <WaterTankGauge tank={diag.components.waterTank} dimmed={isStale} />
        </View>

        {/* 2. Grid de Componentes */}
        <View style={styles.grid}>
          {renderCard(
            'ESP32 / Wi-Fi',
            diag.components.esp32.ok,
            false,
            diag.components.esp32.status,
            `Red: ${diag.components.esp32.wifi}`,
            `Señal: ${diag.components.esp32.rssi} dBm`
          )}
          {renderCard(
            'Sensor Humedad',
            diag.components.sensor.ok,
            false,
            diag.components.sensor.status,
            `Humedad: ${diag.components.sensor.moisture}%`,
            `ADC: ${diag.components.sensor.adc}`,
            diag.components.sensor.status === 'CONECTADO_EN_AIRE'
          )}
          {renderCard(
            'Módulo Relé',
            diag.components.relay.ok,
            diag.components.relay.active,
            diag.components.relay.status,
            diag.components.relay.active ? 'Contacto cerrado: pasa energía a la bomba' : 'Contacto abierto: sin energía a la bomba'
          )}
          {renderCard(
            'Pilas / Batería',
            diag.components.battery.ok,
            false,
            diag.components.battery.status,
            `Carga: ${diag.components.battery.level}%`,
            `ADC Divisor: ${diag.components.battery.adc}`
          )}
          {renderCard(
            'Bomba de Agua',
            diag.components.pump.ok,
            diag.components.pump.running,
            diag.components.pump.status,
            diag.components.pump.status === 'BLOQUEADA_SIN_AGUA'
              ? 'Bloqueada: tanque sin agua'
              : diag.components.pump.running
                ? 'Motor en marcha'
                : 'Motor detenido',
            undefined,
            diag.components.pump.status === 'BLOQUEADA_SIN_AGUA'
          )}
          {renderCard(
            'Tanque de Agua',
            diag.components.waterTank.ok,
            false,
            diag.components.waterTank.status,
            `Nivel: ${diag.components.waterTank.level}%`,
            'Sensor HC-SR04'
          )}
          {renderCard(
            'Protoboard',
            diag.components.wiring.ok,
            false,
            diag.components.wiring.status,
            diag.components.wiring.ok ? 'Todas las conexiones OK' : 'Revise cables puente'
          )}
        </View>

        {/* 3. Consola de Eventos (Logs) */}
        <View style={styles.terminalContainer}>
          <View style={styles.terminalHeader}>
            <Text style={styles.terminalTitle}>TERMINAL DE DIAGNÓSTICO LIVE</Text>
          </View>
          <ScrollView 
            ref={scrollViewRef}
            style={styles.terminalScroll}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          >
            {logs.map((log, i) => (
              <Text key={i} style={styles.terminalLine}>{log}</Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tanqueSeccion: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  tanqueTitulo: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORES.textoOscuro,
    marginBottom: 10,
  },
  esquema: {
    marginTop: 24,
  },
  container: {
    marginTop: 24,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORES.fondoCard,
    borderWidth: 1,
    borderColor: COLORES.bordeNormal,
  },
  cargandoContainer: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoCargando: {
    marginTop: 8,
    color: COLORES.textoGris,
  },
  errorContainer: {
    padding: 16,
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  errorTexto: {
    color: '#B91C1C',
    fontWeight: 'bold',
  },
  header: {
    padding: 16,
    alignItems: 'center',
  },
  tituloHeader: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
    justifyContent: 'space-between',
  },
  card: {
    width: '48%', // Dos columnas
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitulo: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORES.textoOscuro,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardStatus: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
  },
  cardData: {
    fontSize: 11,
    color: COLORES.textoGris,
    marginTop: 2,
  },
  terminalContainer: {
    height: 180,
    backgroundColor: COLORES.terminalBg,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  terminalHeader: {
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  terminalTitle: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  terminalScroll: {
    padding: 12,
  },
  terminalLine: {
    color: COLORES.terminalText,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    marginBottom: 4,
  }
});