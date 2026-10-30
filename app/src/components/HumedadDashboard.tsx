import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

const API_URL =
  "https://api.riego.pipexapp.com/humidity/latest?deviceCode=esp32-01";
const ALTO_TANQUE = 200;
const MAX_EDAD_LECTURA_MS = 30_000;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const COLORES = {
  tinta: "#12302F",
  tintaSuave: "#5C706E",
  agua: "#1FA7B5",
  bien: "#2E9E4F",
  seco: "#C98A1B",
  critico: "#C2571A",
  criticoClaro: "#FBEBDD",
  tanque: "#E1E9E5",
  linea: "#9DB0AB",
};

type Lectura = {
  humidity: number;
  status?: string;
  minThreshold?: number;
  maxThreshold?: number;
  timestamp?: string;
};

const NIVELES: Record<string, { titulo: string; detalle: string; color: string }> = {
  CRITICAL_DRY: { titulo: "Suelo muy seco", detalle: "Necesita riego ahora", color: COLORES.critico },
  DRY: { titulo: "Suelo seco", detalle: "Conviene regar pronto", color: COLORES.seco },
  OPTIMAL: { titulo: "Humedad óptima", detalle: "No necesita riego", color: COLORES.bien },
  SATURATED: { titulo: "Suelo saturado", detalle: "No hace falta regar", color: COLORES.agua },
};

const estadoPorValor = (h: number) =>
  h < 30 ? "CRITICAL_DRY" : h < 45 ? "DRY" : h <= 70 ? "OPTIMAL" : "SATURATED";

// Busca la lectura dentro de lo que devuelva el backend (con o sin "data")
function extraerLectura(json: any): Lectura | null {
  const d = json?.data ?? json;
  const h = d?.humidity ?? d?.reading?.humidity ?? d?.latest?.humidity;
  if (typeof h !== "number") return null;
  return {
    humidity: h,
    status: d.status ?? d.soilStatus,
    minThreshold: d.minThreshold,
    maxThreshold: d.maxThreshold,
    timestamp: d.timestamp ?? d.createdAt ?? d.reading?.timestamp,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const parsearFechaLectura = (timestamp: string) => {
  const normalizada = timestamp
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  return new Date(normalizada);
};
const formatearFecha = (d: Date) =>
  `${d.getDate()} ${MESES[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

type HumedadDashboardProps = {
  token: string | null;
  hasPermission: boolean;
};

export default function HumedadDashboard({ token, hasPermission }: HumedadDashboardProps) {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [vacio, setVacio] = useState(false);
  const [error, setError] = useState("");
  const [ultimaConsulta, setUltimaConsulta] = useState<number | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const nivel = useRef(new Animated.Value(0)).current;

  // Consulta al backend cada 5 segundos
  useEffect(() => {
    if (!token || !hasPermission) {
      setLectura(null);
      setVacio(false);
      setError("");
      setUltimaConsulta(null);
      return;
    }

    let activo = true;
    const consultar = async () => {
      try {
        const respuesta = await fetch(API_URL, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!respuesta.ok) throw new Error("Error HTTP " + respuesta.status);
        const nueva = extraerLectura(await respuesta.json());
        if (!activo) return;
        setLectura(nueva);
        setVacio(nueva === null);
        setError("");
        setUltimaConsulta(Date.now());
      } catch (e: unknown) {
        if (activo) {
          setError(e instanceof Error ? e.message : "No se pudo conectar con el servidor");
        }
      }
    };
    consultar();
    const intervalo = setInterval(consultar, 5000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, [hasPermission, token]);

  // Reloj para "Actualizado hace..."
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, []);

  // Anima el nivel del tanque
  useEffect(() => {
    if (!lectura) return;
    Animated.timing(nivel, {
      toValue: Math.min(100, Math.max(0, lectura.humidity)),
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [lectura, nivel]);

  const clave = lectura
    ? lectura.status && NIVELES[lectura.status]
      ? lectura.status
      : estadoPorValor(lectura.humidity)
    : null;
  const info = clave ? NIVELES[clave] : null;
  const color = info?.color ?? COLORES.linea;
  const min = lectura?.minThreshold ?? 30;
  const max = lectura?.maxThreshold ?? 70;

  const fechaLectura = lectura?.timestamp ? parsearFechaLectura(lectura.timestamp) : null;
  const fechaValida = fechaLectura && !isNaN(fechaLectura.getTime());
  const edadLecturaMs = fechaValida ? ahora - fechaLectura.getTime() : null;
  const lecturaActual =
    edadLecturaMs !== null &&
    edadLecturaMs >= -MAX_EDAD_LECTURA_MS &&
    edadLecturaMs <= MAX_EDAD_LECTURA_MS;
  const minutosSinDatos =
    edadLecturaMs !== null && edadLecturaMs > 0
      ? Math.floor(edadLecturaMs / 60000)
      : null;
  const sensorInactivo = Boolean(lectura) && !lecturaActual;

  const segundos = ultimaConsulta ? Math.max(0, Math.round((ahora - ultimaConsulta) / 1000)) : null;
  const hace =
    segundos === null
      ? "Conectando..."
      : segundos < 60
      ? `Actualizado hace ${segundos} s`
      : `Actualizado hace ${Math.floor(segundos / 60)} min`;

  const altura = nivel.interpolate({ inputRange: [0, 100], outputRange: [0, ALTO_TANQUE] });

  return (
    <View style={styles.seccion}>
      <Text style={styles.titulo}>Humedad del suelo</Text>

      {!token || !hasPermission ? (
        <Text style={styles.nota}>
          {!token
            ? "Inicia sesión para consultar las lecturas del sensor."
            : "Tu cuenta no tiene permiso para consultar la humedad."}
        </Text>
      ) : (
        <>
          <View style={styles.cuerpo}>
            {lecturaActual ? (
              <View style={styles.tanque}>
                <Animated.View
                  style={[styles.relleno, { height: altura, backgroundColor: color }]}
                />
                <View style={[styles.marca, { bottom: (ALTO_TANQUE * min) / 100 }]} />
                <View style={[styles.marca, { bottom: (ALTO_TANQUE * max) / 100 }]} />
              </View>
            ) : null}

            <View style={styles.info}>
              <Text style={styles.valor}>
                {lecturaActual && lectura
                  ? `${Number(lectura.humidity.toFixed(1))} %`
                  : "--"}
              </Text>
              <Text style={[styles.estado, { color: lecturaActual ? color : COLORES.critico }]}>
                {lecturaActual
                  ? info?.titulo ?? "Esperando datos"
                  : lectura
                    ? "Sin lectura reciente"
                    : "Esperando datos"}
              </Text>
              {lecturaActual && info ? <Text style={styles.detalle}>{info.detalle}</Text> : null}
              <Text style={styles.hace}>
                {lecturaActual ? hace : "Esperando una lectura reciente del sensor"}
              </Text>
            </View>
          </View>

          {lectura && fechaValida ? (
            <Text style={styles.nota}>
              {lecturaActual ? "Lectura del sensor" : "Último dato guardado (no actual)"}
              {`: ${Number(lectura.humidity.toFixed(1))} % · ${formatearFecha(fechaLectura)}`}
            </Text>
          ) : null}

          {vacio ? (
            <Text style={styles.nota}>
              Aún no hay lecturas del sensor. Aparecerán cuando el ESP32 envíe datos.
            </Text>
          ) : null}

          {sensorInactivo ? (
            <View style={styles.aviso}>
              <Text style={styles.avisoTexto}>
                {minutosSinDatos === null
                  ? "No se puede confirmar cuándo se tomó este dato. Revisa que el ESP32 esté encendido y conectado."
                  : `El sensor no envía datos hace ${minutosSinDatos} min. El valor anterior se muestra solo como referencia.`}
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text style={styles.error}>
              No se pudo actualizar la humedad ({error}). Se reintenta cada 5 segundos.
            </Text>
          ) : null}

          {lecturaActual ? (
            <Text style={styles.nota}>
              Las rayas del tanque marcan {min} % (mínimo) y {max} % (máximo).
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  seccion: { marginTop: 24 },
  titulo: { fontSize: 20, fontWeight: "700", color: COLORES.tinta, marginBottom: 12 },
  cuerpo: { flexDirection: "row", alignItems: "flex-end" },
  tanque: {
    width: 84,
    height: ALTO_TANQUE,
    borderRadius: 18,
    backgroundColor: COLORES.tanque,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  relleno: { width: "100%" },
  marca: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORES.tinta,
    opacity: 0.35,
  },
  info: { flex: 1, paddingLeft: 24, paddingBottom: 4 },
  valor: { fontSize: 60, fontWeight: "800", color: COLORES.tinta, letterSpacing: -2 },
  estado: { fontSize: 20, fontWeight: "700", marginTop: 2 },
  detalle: { fontSize: 15, color: COLORES.tintaSuave, marginTop: 2 },
  hace: { fontSize: 13, color: COLORES.tintaSuave, marginTop: 14 },
  nota: { fontSize: 13, color: COLORES.tintaSuave, marginTop: 12, lineHeight: 18 },
  aviso: {
    marginTop: 12,
    backgroundColor: COLORES.criticoClaro,
    borderLeftWidth: 4,
    borderLeftColor: COLORES.critico,
    padding: 12,
    borderRadius: 6,
  },
  avisoTexto: { fontSize: 14, color: COLORES.tinta, lineHeight: 20 },
  error: { color: COLORES.critico, fontSize: 14, marginTop: 12, lineHeight: 20 },
});