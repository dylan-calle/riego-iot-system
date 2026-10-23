import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

const API_URL = "https://api.riego.pipexapp.com/irrigation/pump";

const COLORES = {
  fondo: "#F1F5F2",
  tinta: "#12302F",
  tintaSuave: "#5C706E",
  agua: "#1FA7B5",
  reposo: "#9DB0AB",
  tierra: "#8A6240",
  tierraClara: "#E6D9CB",
  alerta: "#C2571A",
  alertaClara: "#FBEBDD",
  linea: "#D5DFDB",
};

type EventoRiego = {
  id: number;
  deviceId: number;
  mode: string;
  status: string;
  activatedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  soilHumidityBefore: number | null;
  soilHumidityAfter: number | null;
};

type EstadoBomba = {
  pumpState: string;
  lastEvent: EventoRiego | null;
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "2026-10-21 18:37:28.71557-04" -> "21 oct, 18:37"
const formatearFecha = (fecha: string | null) => {
  if (!fecha) return "Sin dato";
  const [dia, hora] = fecha.slice(0, 16).split(" ");
  const [, mes, d] = dia.split("-");
  return `${parseInt(d, 10)} ${MESES[parseInt(mes, 10) - 1]}, ${hora}`;
};

// 404 -> "6 min 44 s"
const formatearDuracion = (segundos: number | null) => {
  if (segundos === null || segundos === undefined) return "Sin dato";
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return min > 0 ? `${min} min ${seg} s` : `${seg} s`;
};

const traducir = (valor: string) => {
  const mapa: Record<string, string> = {
    AUTOMATIC: "Automático",
    MANUAL: "Manual",
    COMPLETED: "Completado",
    RUNNING: "En curso",
    FAILED: "Con error",
  };
  return mapa[valor] ?? valor;
};

const haceCuanto = (ultima: number | null, ahora: number) => {
  if (!ultima) return "Sin datos";
  const s = Math.max(0, Math.round((ahora - ultima) / 1000));
  if (s < 60) return `Actualizado hace ${s} s`;
  return `Actualizado hace ${Math.floor(s / 60)} min`;
};

function BarraHumedad({ etiqueta, valor }: { etiqueta: string; valor: number | null }) {
  const porcentaje = valor === null || valor === undefined ? 0 : Math.min(100, Math.max(0, valor));
  return (
    <View style={styles.barraFila}>
      <View style={styles.barraTextos}>
        <Text style={styles.barraEtiqueta}>{etiqueta}</Text>
        <Text style={styles.barraValor}>
          {valor === null || valor === undefined ? "Sin dato" : `${valor} %`}
        </Text>
      </View>
      <View style={styles.barraFondo}>
        <View style={[styles.barraRelleno, { width: `${porcentaje}%` }]} />
      </View>
    </View>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={styles.fila}>
      <Text style={styles.filaEtiqueta}>{etiqueta}</Text>
      <Text style={styles.filaValor}>{valor}</Text>
    </View>
  );
}

export default function Index() {
  const [estado, setEstado] = useState<EstadoBomba | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ultima, setUltima] = useState<number | null>(null);
  const [ahora, setAhora] = useState(Date.now());

  const pulso = useRef(new Animated.Value(0)).current;
  const controlEnCurso = useRef(false);
  const encendida = estado?.pumpState === "ON";
  const estadoConocido =
    estado?.pumpState === "ON" || estado?.pumpState === "OFF";

  const cargarEstado = useCallback(async () => {
    try {
      const respuesta = await fetch(API_URL, { method: "GET" });
      if (!respuesta.ok) {
        throw new Error("Error HTTP " + respuesta.status);
      }
      const datos: EstadoBomba = await respuesta.json();
      setEstado(datos);
      setUltima(Date.now());
      setError("");
    } catch (e: any) {
      setError(e.message ?? "No se pudo conectar con el servidor");
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  const handleTogglePump = async (targetCommand: "ON" | "OFF") => {
    if (controlEnCurso.current) return;

    controlEnCurso.current = true;
    setIsSubmitting(true);
    try {
      const respuesta = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: targetCommand,
          deviceCode: "esp32-01",
        }),
      });

      if (!respuesta.ok) {
        throw new Error(`Error HTTP ${respuesta.status}`);
      }

      setEstado((actual) => ({
        pumpState: targetCommand,
        lastEvent: actual?.lastEvent ?? null,
      }));
      await cargarEstado();
    } catch (error: unknown) {
      const detalle =
        error instanceof Error ? error.message : "Error desconocido";
      Alert.alert(
        "Error",
        `No se pudo comunicar con la bomba. Verifique el broker MQTT. (${detalle})`,
      );
    } finally {
      controlEnCurso.current = false;
      setIsSubmitting(false);
    }
  };

  // Consulta al backend cada 5 segundos
  useEffect(() => {
    cargarEstado();
    const intervalo = setInterval(cargarEstado, 5000);
    return () => clearInterval(intervalo);
  }, [cargarEstado]);

  // Reloj para el texto "Actualizado hace..."
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, []);

  // Onda que late solo cuando la bomba está encendida
  useEffect(() => {
    if (!encendida) {
      pulso.setValue(0);
      return;
    }
    const animacion = Animated.loop(
      Animated.timing(pulso, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    animacion.start();
    return () => animacion.stop();
  }, [encendida, pulso]);

  if (cargando) {
    return (
      <View style={styles.centro}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={COLORES.agua} />
      </View>
    );
  }

  const colorEstado = encendida ? COLORES.agua : COLORES.reposo;
  const evento = estado?.lastEvent;

  const escala = pulso.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const opacidad = pulso.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <ScrollView
      style={styles.pantalla}
      contentContainerStyle={styles.contenido}
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          tintColor={COLORES.agua}
          onRefresh={() => {
            setRefrescando(true);
            cargarEstado();
          }}
        />
      }
    >
      <StatusBar barStyle="dark-content" />

      {/* Encabezado */}
      <Text style={styles.titulo}>Riego</Text>
      <View style={styles.conexion}>
        <View
          style={[
            styles.punto,
            { backgroundColor: error ? COLORES.alerta : COLORES.agua },
          ]}
        />
        <Text style={styles.conexionTexto}>{haceCuanto(ultima, ahora)}</Text>
      </View>

      {/* Aviso sin conexión */}
      {error ? (
        <View style={styles.aviso}>
          <Text style={styles.avisoTitulo}>Sin conexión con el servidor</Text>
          <Text style={styles.avisoTexto}>
            {estado
              ? "Se muestran los últimos datos recibidos. Se reintenta cada 5 segundos."
              : "Revisa tu internet. Se reintenta cada 5 segundos."}
          </Text>
        </View>
      ) : null}

      {/* Protagonista: la bomba */}
      <View style={styles.heroZona}>
        {encendida ? (
          <Animated.View
            style={[
              styles.onda,
              { backgroundColor: colorEstado, opacity: opacidad, transform: [{ scale: escala }] },
            ]}
          />
        ) : null}
        <View style={[styles.circulo, { borderColor: colorEstado }]}>
          <Text style={styles.heroEtiqueta}>Bomba</Text>
          <Text style={[styles.heroEstado, { color: encendida ? COLORES.agua : COLORES.tintaSuave }]}>
            {estado ? (encendida ? "Encendida" : "Apagada") : "Sin datos"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting || !estadoConocido }}
          disabled={isSubmitting || !estadoConocido}
          onPress={() => handleTogglePump(encendida ? "OFF" : "ON")}
          style={({ pressed }) => [
            styles.botonBomba,
            encendida ? styles.botonApagar : styles.botonEncender,
            (pressed || isSubmitting) && styles.botonPresionado,
            (isSubmitting || !estadoConocido) && styles.botonDeshabilitado,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORES.fondo} />
          ) : (
            <Text style={styles.textoBotonBomba}>
              {encendida ? "Apagar bomba" : "Encender bomba"}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Último riego */}
      <View style={styles.seccion}>
        <View style={styles.seccionCabecera}>
          <Text style={styles.seccionTitulo}>Último riego</Text>
          {evento ? (
            <View style={styles.insignia}>
              <Text style={styles.insigniaTexto}>{traducir(evento.mode)}</Text>
            </View>
          ) : null}
        </View>

        {evento ? (
          <>
            <Fila etiqueta="Estado" valor={traducir(evento.status)} />
            <Fila etiqueta="Inicio" valor={formatearFecha(evento.activatedAt)} />
            <Fila etiqueta="Fin" valor={formatearFecha(evento.stoppedAt)} />
            <Fila etiqueta="Duración" valor={formatearDuracion(evento.durationSeconds)} />
          </>
        ) : (
          <Text style={styles.vacio}>
            Todavía no hay riegos registrados. Aparecerán aquí cuando la bomba se active.
          </Text>
        )}
      </View>

      {/* Humedad del suelo */}
      {evento ? (
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>Humedad del suelo</Text>
          <BarraHumedad etiqueta="Antes del riego" valor={evento.soilHumidityBefore} />
          <BarraHumedad etiqueta="Después del riego" valor={evento.soilHumidityAfter} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.fondo },
  contenido: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 48 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORES.fondo },

  titulo: { fontSize: 38, fontWeight: "800", color: COLORES.tinta, letterSpacing: -1 },
  conexion: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  punto: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  conexionTexto: { fontSize: 14, color: COLORES.tintaSuave },

  aviso: {
    marginTop: 20,
    backgroundColor: COLORES.alertaClara,
    borderLeftWidth: 4,
    borderLeftColor: COLORES.alerta,
    padding: 14,
    borderRadius: 6,
  },
  avisoTitulo: { fontSize: 15, fontWeight: "700", color: COLORES.alerta, marginBottom: 2 },
  avisoTexto: { fontSize: 14, color: COLORES.tinta, lineHeight: 20 },

  heroZona: { alignItems: "center", justifyContent: "center", height: 360, marginVertical: 8 },
  onda: { position: "absolute", width: 210, height: 210, borderRadius: 105 },
  circulo: {
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORES.fondo,
  },
  heroEtiqueta: { fontSize: 15, color: COLORES.tintaSuave, marginBottom: 4 },
  heroEstado: { fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
  botonBomba: {
    minWidth: 180,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  botonEncender: { backgroundColor: COLORES.agua },
  botonApagar: { backgroundColor: COLORES.alerta },
  botonPresionado: { opacity: 0.82 },
  botonDeshabilitado: { opacity: 0.55 },
  textoBotonBomba: { color: COLORES.fondo, fontSize: 16, fontWeight: "700" },

  seccion: { marginTop: 24 },
  seccionCabecera: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seccionTitulo: { fontSize: 20, fontWeight: "700", color: COLORES.tinta, marginBottom: 6 },
  insignia: {
    backgroundColor: COLORES.tinta,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
  },
  insigniaTexto: { color: COLORES.fondo, fontSize: 13, fontWeight: "600" },

  fila: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORES.linea,
  },
  filaEtiqueta: { fontSize: 16, color: COLORES.tintaSuave },
  filaValor: { fontSize: 16, fontWeight: "600", color: COLORES.tinta },

  barraFila: { marginTop: 14 },
  barraTextos: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  barraEtiqueta: { fontSize: 15, color: COLORES.tintaSuave },
  barraValor: { fontSize: 15, fontWeight: "700", color: COLORES.tinta },
  barraFondo: { height: 10, borderRadius: 5, backgroundColor: COLORES.tierraClara, overflow: "hidden" },
  barraRelleno: { height: 10, borderRadius: 5, backgroundColor: COLORES.tierra },

  vacio: { fontSize: 15, color: COLORES.tintaSuave, lineHeight: 22, marginTop: 6 },
  nota: { textAlign: "center", color: COLORES.tintaSuave, fontSize: 13, marginTop: 32 },
});