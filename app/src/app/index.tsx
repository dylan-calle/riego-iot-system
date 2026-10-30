import { useCallback, useEffect, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";

import AdminPanel from "../components/AdminPanel";
import HumedadDashboard from "../components/HumedadDashboard";
import {
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API_URL = "https://api.riego.pipexapp.com/irrigation/pump";
const API_BASE = API_URL.replace("/irrigation/pump", "");
const TOKEN_STORAGE_KEY = "riego-iot.access-token";

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
  bien: "#2E9E4F",
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
  deviceStatus?: string;
  lastSeenAt?: string | null;
  diagnostics?: {
    generalStatus?: string;
    components?: {
      pump?: {
        ok?: boolean;
        status?: string;
        running?: boolean;
      };
    };
  } | null;
  diagnosticsReceivedAt?: string | null;
  lastEvent: EventoRiego | null;
};

type Usuario = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  roleId: number | null;
  permissions: string[];
};

type AuthResponse = {
  success: boolean;
  accessToken: string;
  user: Usuario;
};

const guardarToken = (token: string) =>
  Platform.OS === "web"
    ? Promise.resolve()
    : SecureStore.setItemAsync(TOKEN_STORAGE_KEY, token);

const borrarToken = () =>
  Platform.OS === "web"
    ? Promise.resolve()
    : SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);

const obtenerToken = () =>
  Platform.OS === "web"
    ? Promise.resolve(null)
    : SecureStore.getItemAsync(TOKEN_STORAGE_KEY);

const mensajeDeError = (datos: { message?: string | string[] }, fallback: string) =>
  Array.isArray(datos.message) ? datos.message.join("\n") : datos.message ?? fallback;

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

  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [sesionLista, setSesionLista] = useState(false);
  const [modalLoginVisible, setModalLoginVisible] = useState(false);
  const [modoAutenticacion, setModoAutenticacion] = useState<"login" | "registro">("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [autenticando, setAutenticando] = useState(false);
  const [adminVisible, setAdminVisible] = useState(false);

  const pulso = useRef(new Animated.Value(0)).current;
  const controlEnCurso = useRef(false);
  const heartbeatMs = estado?.lastSeenAt ? Date.parse(estado.lastSeenAt) : Number.NaN;
  const equipoConectado =
    estado?.deviceStatus === "ONLINE" &&
    Number.isFinite(heartbeatMs) &&
    ahora - heartbeatMs >= -30_000 &&
    ahora - heartbeatMs <= 30_000;
  const diagnosticoMs = estado?.diagnosticsReceivedAt
    ? Date.parse(estado.diagnosticsReceivedAt)
    : Number.NaN;
  const diagnosticoReciente =
    equipoConectado &&
    Number.isFinite(diagnosticoMs) &&
    ahora - diagnosticoMs >= -15_000 &&
    ahora - diagnosticoMs <= 15_000;
  const bombaReportada = estado?.diagnostics?.components?.pump;
  const bombaFuncionando =
    estado?.pumpState === "ON" &&
    diagnosticoReciente &&
    bombaReportada?.ok === true &&
    bombaReportada.status === "BOMBEANDO_OK";
  const falloBomba =
    estado?.pumpState === "ON" &&
    diagnosticoReciente &&
    bombaReportada?.ok === false;
  const encendida = equipoConectado && estado?.pumpState === "ON";
  const puedeLeerBomba = usuario?.permissions.includes("pump:read") ?? false;
  const puedeControlarBomba = usuario?.permissions.includes("pump:control") ?? false;
  const puedeLeerHumedad = usuario?.permissions.includes("humidity:read") ?? false;
  // Muestra el botón "Administración" solo si la cuenta tiene algún permiso de usuarios/roles
  const puedeAdministrar =
    usuario !== null &&
    (usuario.role === "ADMIN" ||
      ["users:read", "users:manage", "roles:read", "roles:manage"].some((p) =>
        usuario.permissions.includes(p),
      ));
  const estadoConocido =
    equipoConectado && (estado?.pumpState === "ON" || estado?.pumpState === "OFF");

  const cargarEstado = useCallback(async () => {
    if (!sesionLista) return;
    if (!token || !puedeLeerBomba) {
      setEstado(null);
      setCargando(false);
      setRefrescando(false);
      return;
    }

    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const respuesta = await fetch(API_URL, { method: "GET", headers });
      if (!respuesta.ok) {
        if (respuesta.status === 401) {
          await borrarToken();
          setToken(null);
          setUsuario(null);
          throw new Error("La sesión expiró. Inicia sesión nuevamente.");
        }
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
  }, [puedeLeerBomba, sesionLista, token]);

  const handleTogglePump = async (targetCommand: "ON" | "OFF") => {
    if (!puedeControlarBomba) {
      setModalLoginVisible(true);
      return;
    }
    if (controlEnCurso.current) return;

    controlEnCurso.current = true;
    setIsSubmitting(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const respuesta = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          command: targetCommand,
          deviceCode: "esp32-01",
        }),
      });

      if (!respuesta.ok) {
        if (respuesta.status === 401) {
          await borrarToken();
          setToken(null);
          setUsuario(null);
          setModoAutenticacion("login");
          setModalLoginVisible(true);
          throw new Error("La sesión expiró. Inicia sesión nuevamente.");
        }
        if (respuesta.status === 403) {
          throw new Error("Tu cuenta no tiene permiso para controlar la bomba.");
        }
        const detalle = (await respuesta.json()) as { message?: string | string[] };
        throw new Error(
          mensajeDeError(detalle, `Error HTTP ${respuesta.status}`),
        );
      }

      let confirmado = false;
      let falloDetectado = false;
      for (let intento = 0; intento < 10; intento += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        const estadoRespuesta = await fetch(API_URL, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!estadoRespuesta.ok) {
          throw new Error(`No se pudo verificar el estado de la bomba (${estadoRespuesta.status}).`);
        }

        const nuevoEstado: EstadoBomba = await estadoRespuesta.json();
        setEstado(nuevoEstado);
        setUltima(Date.now());
        const heartbeat = nuevoEstado.lastSeenAt
          ? Date.parse(nuevoEstado.lastSeenAt)
          : Number.NaN;
        const conectado =
          nuevoEstado.deviceStatus === "ONLINE" &&
          Number.isFinite(heartbeat) &&
          Date.now() - heartbeat >= -30_000 &&
          Date.now() - heartbeat <= 30_000;

        if (!conectado) {
          break;
        }
        if (nuevoEstado.pumpState === targetCommand) {
          if (targetCommand === "OFF") {
            confirmado = true;
            break;
          }

          const diagnosticoRecibido = nuevoEstado.diagnosticsReceivedAt
            ? Date.parse(nuevoEstado.diagnosticsReceivedAt)
            : Number.NaN;
          const diagnosticoVigente =
            Number.isFinite(diagnosticoRecibido) &&
            Date.now() - diagnosticoRecibido >= -15_000 &&
            Date.now() - diagnosticoRecibido <= 15_000;
          const bomba = nuevoEstado.diagnostics?.components?.pump;
          if (diagnosticoVigente && bomba?.ok === true && bomba.status === "BOMBEANDO_OK") {
            confirmado = true;
            break;
          }
          if (diagnosticoVigente && bomba?.ok === false) {
            falloDetectado = true;
            break;
          }
        }
      }

      if (!confirmado) {
        Alert.alert(
          falloDetectado ? "Fallo detectado en la bomba" : "Sin confirmación de la bomba",
          falloDetectado
            ? "El ESP32 activó el relé, pero su diagnóstico indica que la bomba no está funcionando. Revisa la bomba, los cables y la alimentación."
            : targetCommand === "ON"
              ? "El comando se envió, pero no se confirmó que la bomba esté bombeando. Verifica el ESP32 y espera una lectura de diagnóstico."
              : "El comando se envió, pero el ESP32 no confirmó el cambio de estado.",
        );
        return;
      }

      Alert.alert(
        targetCommand === "ON" ? "Bomba funcionando" : "Bomba apagada",
        targetCommand === "ON"
          ? "El ESP32 confirmó el relé y detectó corriente en la bomba."
          : "El ESP32 confirmó que el relé se apagó.",
      );
    } catch (error: unknown) {
      const detalle =
        error instanceof Error ? error.message : "Error desconocido";
      Alert.alert(
        "Error",
        `No se pudo comunicar con la bomba. (${detalle})`,
      );
    } finally {
      controlEnCurso.current = false;
      setIsSubmitting(false);
    }
  };

  const handleAutenticacion = async () => {
    const email = loginEmail.trim().toLowerCase();
    if (!email || !loginPassword || (modoAutenticacion === "registro" && !nombre.trim())) {
      Alert.alert(
        "Campos requeridos",
        modoAutenticacion === "registro"
          ? "Completa tu nombre, correo y contraseña."
          : "Ingresa tu correo y contraseña.",
      );
      return;
    }

    setAutenticando(true);
    try {
      const endpoint = modoAutenticacion === "registro" ? "register" : "login";
      const body =
        modoAutenticacion === "registro"
          ? { name: nombre.trim(), email, password: loginPassword }
          : { email, password: loginPassword };
      const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as AuthResponse & { message?: string | string[] };
      if (!res.ok) {
        throw new Error(
          mensajeDeError(
            data,
            modoAutenticacion === "registro"
              ? "No se pudo crear la cuenta."
              : "Correo o contraseña incorrectos.",
          ),
        );
      }
      if (!data.accessToken || !data.user || !Array.isArray(data.user.permissions)) {
        throw new Error("El servidor devolvió una respuesta de autenticación inválida.");
      }

      await guardarToken(data.accessToken);
      setToken(data.accessToken);
      setUsuario(data.user);
      setModalLoginVisible(false);
      setLoginPassword("");
      setNombre("");
      setError("");
      Alert.alert(
        modoAutenticacion === "registro" ? "Cuenta creada" : "Sesión iniciada",
        `Bienvenido ${data.user.name ?? data.user.email} (${data.user.role})`,
      );
    } catch (err: unknown) {
      const detalle =
        err instanceof Error ? err.message : "No se pudo completar la autenticación.";
      Alert.alert("Error de autenticación", detalle);
    } finally {
      setAutenticando(false);
    }
  };

  const handleLogout = async () => {
    try {
      await borrarToken();
      setAdminVisible(false);
      setToken(null);
      setUsuario(null);
      setEstado(null);
      setError("");
    } catch (err: unknown) {
      const detalle =
        err instanceof Error ? err.message : "No se pudo cerrar la sesión de forma segura.";
      Alert.alert("Error", detalle);
    }
  };

  useEffect(() => {
    let activo = true;
    const restaurarSesion = async () => {
      try {
        const tokenGuardado = await obtenerToken();
        if (!activo || !tokenGuardado) return;

        const respuesta = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${tokenGuardado}` },
        });
        if (respuesta.status === 401) {
          await borrarToken();
          return;
        }
        const datos = (await respuesta.json()) as {
          user?: Usuario;
          message?: string | string[];
        };
        if (!respuesta.ok) {
          throw new Error(mensajeDeError(datos, `Error HTTP ${respuesta.status}`));
        }
        if (!datos.user || !Array.isArray(datos.user.permissions)) {
          throw new Error("El servidor devolvió un perfil de usuario inválido.");
        }

        if (activo) {
          setToken(tokenGuardado);
          setUsuario(datos.user);
        }
      } catch (err: unknown) {
        if (activo) {
          const detalle =
            err instanceof Error ? err.message : "No se pudo validar la sesión guardada.";
          setError(`No se pudo validar la sesión guardada. ${detalle}`);
        }
      } finally {
        if (activo) setSesionLista(true);
      }
    };

    void restaurarSesion();
    return () => {
      activo = false;
    };
  }, []);

  // Consulta al backend cada 5 segundos
  useEffect(() => {
    if (!sesionLista) return;
    cargarEstado();
    const intervalo = setInterval(cargarEstado, 5000);
    return () => clearInterval(intervalo);
  }, [cargarEstado, sesionLista]);

  // Reloj para el texto "Actualizado hace..."
  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, []);

  // Onda que late solo cuando la bomba está encendida
  useEffect(() => {
    if (!bombaFuncionando) {
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
  }, [bombaFuncionando, pulso]);

  if (cargando) {
    return (
      <View style={styles.centro}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={COLORES.agua} />
      </View>
    );
  }

  const colorEstado = bombaFuncionando
    ? COLORES.agua
    : falloBomba
      ? COLORES.alerta
      : COLORES.reposo;
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
      <View style={styles.cabeceraFila}>
        <View>
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
        </View>

        {/* Auth info / login button */}
        {usuario ? (
          <View style={styles.usuarioPill}>
            <View style={styles.rolBadge}>
              <Text style={styles.rolBadgeTexto}>{usuario.role}</Text>
            </View>
            <Text style={styles.usuarioEmail} numberOfLines={1}>
              {usuario.email}
            </Text>
            <Pressable onPress={handleLogout} style={styles.logoutBtn}>
              <Text style={styles.logoutBtnTexto}>Salir</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setModoAutenticacion("login");
              setModalLoginVisible(true);
            }}
            style={styles.loginPill}
          >
            <Text style={styles.loginPillTexto}>🔑 Iniciar sesión</Text>
          </Pressable>
        )}
      </View>

      {/* Administración de usuarios y roles (solo con permisos) */}
      {puedeAdministrar ? (
        <Pressable onPress={() => setAdminVisible(true)} style={styles.adminBtn}>
          <Text style={styles.adminBtnTexto}>⚙️ Administrar usuarios y roles</Text>
        </Pressable>
      ) : null}

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
        {bombaFuncionando ? (
          <Animated.View
            style={[
              styles.onda,
              { backgroundColor: colorEstado, opacity: opacidad, transform: [{ scale: escala }] },
            ]}
          />
        ) : null}
        <View style={[styles.circulo, { borderColor: colorEstado }]}>
          <Text style={styles.heroEtiqueta}>Bomba</Text>
          <Text style={[styles.heroEstado, { color: colorEstado }]}>
            {equipoConectado
              ? estado?.pumpState === "ON"
                ? falloBomba
                  ? "Fallo detectado"
                  : bombaFuncionando
                    ? "Bombeando"
                    : "Relé activado"
                : estado?.pumpState === "OFF"
                  ? "Apagada"
                  : "Sin confirmación"
              : "Sin conexión"}
          </Text>
        </View>
        <Text
          style={[
            styles.estadoDispositivo,
            { color: equipoConectado && !falloBomba ? COLORES.bien : COLORES.alerta },
          ]}
        >
          {!equipoConectado
            ? "ESP32 desconectado"
            : falloBomba
              ? "ESP32 conectado · bomba no detectada"
              : bombaFuncionando
                ? "ESP32 conectado · corriente detectada"
                : encendida
                  ? "ESP32 conectado · verificando bomba"
                  : "ESP32 conectado"}
        </Text>
        {!token ? (
          <Pressable
            style={[styles.botonBomba, styles.botonEncender]}
            onPress={() => {
              setModoAutenticacion("login");
              setModalLoginVisible(true);
            }}
          >
            <Text style={styles.textoBotonBomba}>Inicia sesión para controlar</Text>
          </Pressable>
        ) : !puedeControlarBomba || !puedeLeerBomba ? (
          <Text style={styles.permisoTexto}>
            {puedeControlarBomba
              ? "Tu cuenta no tiene permiso para consultar el estado de la bomba."
              : "Tu cuenta puede consultar el estado, pero no controlar la bomba."}
          </Text>
        ) : !equipoConectado ? (
          <View style={[styles.botonBomba, styles.botonDeshabilitado, styles.botonNoDisponible]}>
            <Text style={styles.textoBotonBomba}>Bomba no disponible</Text>
          </View>
        ) : (
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
              <View style={styles.esperandoConfirmacion}>
                <ActivityIndicator color={COLORES.fondo} />
                <Text style={styles.textoBotonBomba}>Esperando confirmación</Text>
              </View>
            ) : (
              <Text style={styles.textoBotonBomba}>
                {encendida ? "Apagar bomba" : "Encender bomba"}
              </Text>
            )}
          </Pressable>
        )}
      </View>
      <HumedadDashboard token={token} hasPermission={puedeLeerHumedad} />
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

      {/* Panel de administración */}
      {usuario && token ? (
        <AdminPanel
          visible={adminVisible}
          onClose={() => setAdminVisible(false)}
          apiBase={API_BASE}
          token={token}
          usuario={usuario}
        />
      ) : null}

      {/* Modal de Inicio de Sesión */}
      <Modal
        visible={modalLoginVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalLoginVisible(false)}
      >
        <View style={styles.modalFondo}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalContenedor}>
              <Text style={styles.modalTitulo}>
                {modoAutenticacion === "registro" ? "Crear cuenta" : "Iniciar sesión"}
              </Text>
              <Text style={styles.modalSubtitulo}>
                {modoAutenticacion === "registro"
                  ? "Tu cuenta nueva tendrá acceso de solo lectura."
                  : "Accede para consultar el riego; las acciones dependen de tus permisos."}
              </Text>

              {modoAutenticacion === "registro" ? (
                <>
                  <Text style={styles.inputLabel}>Nombre</Text>
                  <TextInput
                    style={styles.input}
                    value={nombre}
                    onChangeText={setNombre}
                    autoCapitalize="words"
                    placeholder="Tu nombre"
                    placeholderTextColor={COLORES.reposo}
                    editable={!autenticando}
                  />
                </>
              ) : null}

              <Text style={styles.inputLabel}>Correo electrónico</Text>
              <TextInput
                style={styles.input}
                value={loginEmail}
                onChangeText={setLoginEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="tu@correo.com"
                placeholderTextColor={COLORES.reposo}
                editable={!autenticando}
              />

              <Text style={styles.inputLabel}>Contraseña</Text>
              <TextInput
                style={styles.input}
                value={loginPassword}
                onChangeText={setLoginPassword}
                secureTextEntry
                autoComplete={modoAutenticacion === "registro" ? "new-password" : "current-password"}
                placeholder={
                  modoAutenticacion === "registro" ? "Mínimo 6 caracteres" : "Tu contraseña"
                }
                placeholderTextColor={COLORES.reposo}
                editable={!autenticando}
              />

              <View style={styles.modalBotones}>
                <Pressable
                  style={[styles.modalBoton, styles.botonCancelar]}
                  onPress={() => setModalLoginVisible(false)}
                  disabled={autenticando}
                >
                  <Text style={styles.botonCancelarTexto}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalBoton, styles.botonEntrar]}
                  onPress={handleAutenticacion}
                  disabled={autenticando}
                >
                  {autenticando ? (
                    <ActivityIndicator color={COLORES.fondo} size="small" />
                  ) : (
                    <Text style={styles.botonEntrarTexto}>
                      {modoAutenticacion === "registro" ? "Crear cuenta" : "Ingresar"}
                    </Text>
                  )}
                </Pressable>
              </View>
              <Pressable
                onPress={() =>
                  setModoAutenticacion((modo) => (modo === "login" ? "registro" : "login"))
                }
                disabled={autenticando}
                style={styles.cambiarModo}
              >
                <Text style={styles.cambiarModoTexto}>
                  {modoAutenticacion === "registro"
                    ? "¿Ya tienes cuenta? Inicia sesión"
                    : "¿No tienes cuenta? Regístrate"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.fondo },
  contenido: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 48 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORES.fondo },

  cabeceraFila: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  titulo: { fontSize: 38, fontWeight: "800", color: COLORES.tinta, letterSpacing: -1 },
  conexion: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  punto: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  conexionTexto: { fontSize: 14, color: COLORES.tintaSuave },

  usuarioPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E2ECE9",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    maxWidth: 200,
  },
  rolBadge: {
    backgroundColor: COLORES.tinta,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 6,
  },
  rolBadgeTexto: {
    color: COLORES.fondo,
    fontSize: 10,
    fontWeight: "800",
  },
  usuarioEmail: {
    fontSize: 12,
    color: COLORES.tinta,
    fontWeight: "600",
    maxWidth: 90,
  },
  logoutBtn: {
    marginLeft: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: COLORES.alertaClara,
    borderRadius: 8,
  },
  logoutBtnTexto: {
    fontSize: 11,
    color: COLORES.alerta,
    fontWeight: "700",
  },
  adminBtn: {
    marginTop: 16,
    backgroundColor: COLORES.tinta,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  adminBtnTexto: {
    color: COLORES.fondo,
    fontSize: 14,
    fontWeight: "700",
  },
  loginPill: {
    backgroundColor: COLORES.tinta,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignSelf: "flex-start",
  },
  loginPillTexto: {
    color: COLORES.fondo,
    fontSize: 12,
    fontWeight: "700",
  },
  permisoTexto: {
    marginTop: 18,
    color: COLORES.tintaSuave,
    fontSize: 14,
    textAlign: "center",
  },
  estadoDispositivo: {
    marginTop: -18,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: "700",
  },
  botonNoDisponible: {
    backgroundColor: COLORES.reposo,
  },
  esperandoConfirmacion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  modalFondo: {
    flex: 1,
    backgroundColor: "rgba(18, 48, 47, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalScroll: {
    flex: 1,
    width: "100%",
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContenedor: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: COLORES.fondo,
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  modalTitulo: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORES.tinta,
    marginBottom: 4,
  },
  modalSubtitulo: {
    fontSize: 14,
    color: COLORES.tintaSuave,
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORES.tinta,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORES.linea,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORES.tinta,
  },
  modalBotones: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 24,
  },
  modalBoton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 90,
    alignItems: "center",
  },
  botonCancelar: {
    backgroundColor: COLORES.linea,
  },
  botonCancelarTexto: {
    color: COLORES.tinta,
    fontWeight: "700",
    fontSize: 14,
  },
  botonEntrar: {
    backgroundColor: COLORES.agua,
  },
  botonEntrarTexto: {
    color: COLORES.fondo,
    fontWeight: "700",
    fontSize: 14,
  },
  cambiarModo: {
    alignSelf: "center",
    paddingTop: 18,
    paddingBottom: 4,
  },
  cambiarModoTexto: {
    color: COLORES.agua,
    fontWeight: "700",
    fontSize: 14,
  },

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