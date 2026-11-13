import { useCallback, useEffect, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";

import AdminPanel from "../components/AdminPanel";
import HumedadDashboard from "../components/HumedadDashboard";
import HardwareDiagnostics from "../components/HardwareDiagnostics";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
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
const DEVICE_CODE = "esp32-01";

const COLORES = {
  fondo: "#F3F7F5",
  tarjeta: "#FFFFFF",
  tinta: "#12302F",
  tintaSuave: "#5C706E",
  agua: "#1FA7B5",
  aguaClara: "#E3F4F6",
  reposo: "#9DB0AB",
  reposoClaro: "#EEF3F1",
  tierra: "#8A6240",
  tierraClara: "#EFE5DA",
  alerta: "#C2571A",
  alertaClara: "#FBEBDD",
  aviso: "#B87A12",
  avisoClara: "#FBF1DA",
  bien: "#2E9E4F",
  bienClara: "#E2F3E7",
  linea: "#E0E8E4",
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
  // El backend lo envía en true cuando el tanque de la bomba está vacío
  tankEmpty?: boolean;
  deviceStatus?: string;
  lastSeenAt?: string | null;
  diagnostics?: {
    generalStatus?: string;
    waterTank?: { ok?: boolean; status?: string; level?: number };
    components?: {
      pump?: {
        ok?: boolean;
        status?: string;
        running?: boolean;
      };
      waterTank?: { ok?: boolean; status?: string; level?: number };
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

type TipoAviso = "ok" | "error" | "info";
type Aviso = { tipo: TipoAviso; titulo: string; texto?: string };

// ---------------------------------------------------------------------------
// Almacenamiento del token (en la web usamos localStorage para no perder la sesión)
// ---------------------------------------------------------------------------
const almacenWeb = (): any => {
  try {
    return (globalThis as any).localStorage ?? null;
  } catch {
    return null;
  }
};

const guardarToken = async (token: string) => {
  if (Platform.OS === "web") {
    almacenWeb()?.setItem(TOKEN_STORAGE_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, token);
};

const borrarToken = async () => {
  if (Platform.OS === "web") {
    almacenWeb()?.removeItem(TOKEN_STORAGE_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
};

const obtenerToken = async (): Promise<string | null> => {
  if (Platform.OS === "web") {
    return almacenWeb()?.getItem(TOKEN_STORAGE_KEY) ?? null;
  }
  return SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
};

const mensajeDeError = (datos: { message?: string | string[] }, fallback: string) =>
  Array.isArray(datos.message) ? datos.message.join("\n") : datos.message ?? fallback;

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Convierte fechas como "2026-10-21 18:37:28.71557-04" (formato de Postgres)
 * en milisegundos. Date.parse() directo devuelve NaN en celular (Hermes/Safari),
 * y eso hacía que la app creyera que el ESP32 estaba desconectado.
 */
const parsearFecha = (valor?: string | null): number => {
  if (!valor) return Number.NaN;
  const normalizada = valor
    .trim()
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(normalizada);
};

// "2026-10-21 18:37:28.71557-04" -> "21 oct, 18:37"
const formatearFecha = (fecha: string | null) => {
  const ms = parsearFecha(fecha);
  if (!Number.isFinite(ms)) return "Sin dato";
  const d = new Date(ms);
  return `${d.getDate()} ${MESES[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// ---------------------------------------------------------------------------
// Estado de la bomba
// ---------------------------------------------------------------------------
/**
 * El backend ya valida si el ESP32 está en línea (deviceStatus), así que aquí
 * confiamos en ese dato y solo comprobamos que NUESTRA última consulta sea
 * reciente (reloj del celular contra reloj del celular, sin desfases).
 * La frescura del diagnóstico se mide contra el latido del propio servidor.
 */
function analizarEstado(e: EstadoBomba | null, datosFrescos: boolean) {
  const conectado = datosFrescos && e?.deviceStatus === "ONLINE";
  const latido = parsearFecha(e?.lastSeenAt);
  const diagnostico = parsearFecha(e?.diagnosticsReceivedAt);
  const diagnosticoVigente =
    conectado &&
    Number.isFinite(latido) &&
    Number.isFinite(diagnostico) &&
    Math.abs(latido - diagnostico) <= 30_000;
  const bomba = e?.diagnostics?.components?.pump;
  const encendida = conectado && e?.pumpState === "ON";
  const bombeando =
    encendida && diagnosticoVigente && bomba?.ok === true && bomba.status === "BOMBEANDO_OK";
  const fallo = encendida && diagnosticoVigente && bomba?.ok === false;
  const estadoConocido = conectado && (e?.pumpState === "ON" || e?.pumpState === "OFF");
  return { conectado, encendida, bombeando, fallo, estadoConocido };
}

/**
 * true si el tanque de agua de la bomba está vacío. Usa el dato del backend (tankEmpty)
 * y, como respaldo, el diagnóstico del propio ESP32 (nivel crítico o bomba bloqueada
 * sin agua), siempre que sea reciente.
 */
function tanqueSinAgua(e: EstadoBomba | null, datosFrescos: boolean) {
  if (!e || !datosFrescos || e.deviceStatus !== "ONLINE") return false;
  if (e.tankEmpty === true) return true;

  const latido = parsearFecha(e.lastSeenAt);
  const diagnostico = parsearFecha(e.diagnosticsReceivedAt);
  const vigente =
    Number.isFinite(latido) &&
    Number.isFinite(diagnostico) &&
    Math.abs(latido - diagnostico) <= 30_000;
  if (!vigente) return false;

  const d: any = e.diagnostics;
  const tanque = d?.waterTank ?? d?.components?.waterTank;
  return (
    tanque?.status === "NIVEL_CRITICO_BAJO" || d?.components?.pump?.status === "BLOQUEADA_SIN_AGUA"
  );
}

// ---------------------------------------------------------------------------
// Componentes pequeños
// ---------------------------------------------------------------------------
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

function Fila({ etiqueta, valor, ultima }: { etiqueta: string; valor: string; ultima?: boolean }) {
  return (
    <View style={[styles.fila, ultima && styles.filaUltima]}>
      <Text style={styles.filaEtiqueta}>{etiqueta}</Text>
      <Text style={styles.filaValor}>{valor}</Text>
    </View>
  );
}

function Dato({
  icono,
  etiqueta,
  valor,
  color,
}: {
  icono: string;
  etiqueta: string;
  valor: string;
  color: string;
}) {
  return (
    <View style={styles.dato}>
      <Text style={styles.datoIcono}>{icono}</Text>
      <Text style={styles.datoEtiqueta}>{etiqueta}</Text>
      <Text style={[styles.datoValor, { color }]} numberOfLines={2}>
        {valor}
      </Text>
    </View>
  );
}

function Notificacion({ aviso, onCerrar }: { aviso: Aviso; onCerrar: () => void }) {
  const paleta = {
    ok: { fondo: COLORES.bienClara, borde: COLORES.bien, texto: COLORES.bien, icono: "✓" },
    error: { fondo: COLORES.alertaClara, borde: COLORES.alerta, texto: COLORES.alerta, icono: "!" },
    info: { fondo: COLORES.avisoClara, borde: COLORES.aviso, texto: COLORES.aviso, icono: "i" },
  }[aviso.tipo];
  return (
    <Pressable
      onPress={onCerrar}
      style={[styles.toast, { backgroundColor: paleta.fondo, borderColor: paleta.borde }]}
    >
      <View style={[styles.toastIcono, { backgroundColor: paleta.borde }]}>
        <Text style={styles.toastIconoTexto}>{paleta.icono}</Text>
      </View>
      <View style={styles.toastTextos}>
        <Text style={[styles.toastTitulo, { color: paleta.texto }]}>{aviso.titulo}</Text>
        {aviso.texto ? <Text style={styles.toastTexto}>{aviso.texto}</Text> : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------
export default function Index() {
  const [estado, setEstado] = useState<EstadoBomba | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ultima, setUltima] = useState<number | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [sesionLista, setSesionLista] = useState(false);
  const [modalLoginVisible, setModalLoginVisible] = useState(false);
  const [modoAutenticacion, setModoAutenticacion] = useState<"login" | "registro">("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [errorAuth, setErrorAuth] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [autenticando, setAutenticando] = useState(false);
  const [adminVisible, setAdminVisible] = useState(false);

  const pulso = useRef(new Animated.Value(0)).current;
  const controlEnCurso = useRef(false);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const datosFrescos = ultima !== null && ahora - ultima <= 20_000;
  const { conectado: equipoConectado, encendida, bombeando: bombaFuncionando, fallo: falloBomba, estadoConocido } =
    analizarEstado(estado, datosFrescos);

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

  const mostrarAviso = useCallback((tipo: TipoAviso, titulo: string, texto?: string) => {
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    setAviso({ tipo, titulo, texto });
    avisoTimer.current = setTimeout(() => setAviso(null), 6000);
  }, []);

  useEffect(
    () => () => {
      if (avisoTimer.current) clearTimeout(avisoTimer.current);
    },
    [],
  );

  const abrirLogin = (modo: "login" | "registro") => {
    setErrorAuth("");
    setModoAutenticacion(modo);
    setModalLoginVisible(true);
  };

  const cerrarSesionExpirada = async () => {
    await borrarToken();
    setToken(null);
    setUsuario(null);
    setEstado(null);
  };

  const cargarEstado = useCallback(async () => {
    if (!sesionLista) return;
    if (!token || !puedeLeerBomba) {
      setEstado(null);
      setCargando(false);
      setRefrescando(false);
      return;
    }

    try {
      const respuesta = await fetch(`${API_URL}?deviceCode=${DEVICE_CODE}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
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

  const handleTogglePump = async (comando: "ON" | "OFF") => {
    if (!token) {
      abrirLogin("login");
      return;
    }
    if (!puedeControlarBomba) {
      mostrarAviso("error", "Sin permiso", "Tu cuenta no tiene permiso para controlar la bomba.");
      return;
    }
    if (controlEnCurso.current) return;

    // Con el tanque vacío ni siquiera se envía el comando: se avisa el motivo real
    if (comando === "ON" && tanqueSinAgua(estado, datosFrescos)) {
      mostrarAviso(
        "error",
        "Tanque sin agua",
        "El tanque de la bomba está vacío. Rellénalo para poder regar.",
      );
      return;
    }

    controlEnCurso.current = true;
    setIsSubmitting(true);
    try {
      const respuesta = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ command: comando, deviceCode: DEVICE_CODE }),
      });

      if (!respuesta.ok) {
        if (respuesta.status === 401) {
          await cerrarSesionExpirada();
          abrirLogin("login");
          throw new Error("La sesión expiró. Inicia sesión nuevamente.");
        }
        if (respuesta.status === 403) {
          throw new Error("Tu cuenta no tiene permiso para controlar la bomba.");
        }
        if (respuesta.status === 409) {
          // El backend rechaza el encendido porque el tanque está vacío
          const motivo = (await respuesta.json().catch(() => ({}))) as {
            message?: string | string[];
          };
          mostrarAviso(
            "error",
            "Tanque sin agua",
            mensajeDeError(motivo, "El tanque de agua está vacío. Rellénalo para poder regar."),
          );
          return;
        }
        const detalle = (await respuesta.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        throw new Error(mensajeDeError(detalle, `Error HTTP ${respuesta.status}`));
      }

      // Esperamos hasta 10 s a que el ESP32 confirme el cambio
      let confirmado = false;
      let falloDetectado = false;
      let releActivo = false;
      let desconectado = false;
      let sinAgua = false;

      for (let intento = 0; intento < 10; intento += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        const estadoRespuesta = await fetch(`${API_URL}?deviceCode=${DEVICE_CODE}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!estadoRespuesta.ok) {
          throw new Error(`No se pudo verificar el estado de la bomba (${estadoRespuesta.status}).`);
        }

        const nuevoEstado: EstadoBomba = await estadoRespuesta.json();
        setEstado(nuevoEstado);
        setUltima(Date.now());

        const a = analizarEstado(nuevoEstado, true);
        if (!a.conectado) {
          desconectado = true;
          break;
        }
        // El firmware rechaza el ON si no hay agua: se corta la espera y se avisa el motivo
        if (comando === "ON" && tanqueSinAgua(nuevoEstado, true)) {
          sinAgua = true;
          break;
        }
        if (nuevoEstado.pumpState !== comando) continue;

        if (comando === "OFF") {
          confirmado = true;
          break;
        }
        releActivo = true;
        if (a.bombeando) {
          confirmado = true;
          break;
        }
        if (a.fallo) {
          falloDetectado = true;
          break;
        }
      }

      if (sinAgua) {
        mostrarAviso(
          "error",
          "Tanque sin agua",
          "La bomba no se encendió porque el tanque está vacío. Rellénalo para poder regar.",
        );
      } else if (confirmado) {
        mostrarAviso(
          "ok",
          comando === "ON" ? "Bomba funcionando" : "Bomba apagada",
          comando === "ON"
            ? "El ESP32 confirmó el relé y detectó corriente en la bomba."
            : "El ESP32 confirmó que el relé se apagó.",
        );
      } else if (falloDetectado) {
        mostrarAviso(
          "error",
          "Fallo detectado en la bomba",
          "El relé se activó, pero el diagnóstico indica que la bomba no está funcionando. Revisa la bomba, los cables y la alimentación.",
        );
      } else if (releActivo) {
        mostrarAviso(
          "info",
          "Relé activado",
          "El ESP32 encendió el relé, pero aún no llegó el diagnóstico que confirma que la bomba bombea.",
        );
      } else if (desconectado) {
        mostrarAviso("error", "ESP32 desconectado", "El comando se envió pero el equipo se desconectó.");
      } else {
        mostrarAviso(
          "error",
          "Sin confirmación",
          comando === "ON"
            ? "El comando se envió, pero el ESP32 no confirmó que la bomba esté encendida."
            : "El comando se envió, pero el ESP32 no confirmó el cambio de estado.",
        );
      }
    } catch (err: unknown) {
      const detalle = err instanceof Error ? err.message : "Error desconocido";
      mostrarAviso("error", "No se pudo controlar la bomba", detalle);
    } finally {
      controlEnCurso.current = false;
      setIsSubmitting(false);
    }
  };

  const handleAutenticacion = async () => {
    const email = loginEmail.trim().toLowerCase();
    if (!email || !loginPassword || (modoAutenticacion === "registro" && !nombre.trim())) {
      setErrorAuth(
        modoAutenticacion === "registro"
          ? "Completa tu nombre, correo y contraseña."
          : "Ingresa tu correo y contraseña.",
      );
      return;
    }

    setErrorAuth("");
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
      const data = (await res.json().catch(() => ({}))) as AuthResponse & {
        message?: string | string[];
      };
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
      setCargando(true);
      mostrarAviso(
        "ok",
        modoAutenticacion === "registro" ? "Cuenta creada" : "Sesión iniciada",
        `Bienvenido ${data.user.name ?? data.user.email} (${data.user.role})`,
      );
    } catch (err: unknown) {
      setErrorAuth(
        err instanceof Error ? err.message : "No se pudo completar la autenticación.",
      );
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
      mostrarAviso(
        "error",
        "No se pudo cerrar la sesión",
        err instanceof Error ? err.message : "Inténtalo de nuevo.",
      );
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

  // Onda que late solo cuando la bomba está bombeando
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
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    animacion.start();
    return () => animacion.stop();
  }, [bombaFuncionando, pulso]);

  if (cargando) {
    return (
      <View style={styles.centro}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={COLORES.agua} />
        <Text style={styles.centroTexto}>Conectando con el sistema de riego…</Text>
      </View>
    );
  }

  // ---- Sin sesión: solo se muestra la pantalla de inicio de sesión ----
  if (!usuario) {
    const esRegistro = modoAutenticacion === "registro";
    return (
      <KeyboardAvoidingView
        style={styles.loginRaiz}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <StatusBar barStyle="light-content" />
        <ScrollView
          contentContainerStyle={styles.loginScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.loginCabecera}>
            <View style={styles.loginLogo}>
              <Text style={styles.loginLogoIcono}>💧</Text>
            </View>
            <Text style={styles.loginMarca}>Riego</Text>
            <Text style={styles.loginLema}>Control inteligente de tu sistema de riego</Text>
          </View>

          <View style={styles.loginFormZona}>
            <View style={styles.loginFormTarjeta}>
              <Text style={styles.modalTitulo}>{esRegistro ? "Crear cuenta" : "Bienvenido"}</Text>
              <Text style={styles.modalSubtitulo}>
                {esRegistro
                  ? "Tu cuenta nueva tendrá acceso de solo lectura."
                  : "Inicia sesión para ver y controlar tu riego."}
              </Text>

              <View style={styles.segmento}>
                {(["login", "registro"] as const).map((modo) => (
                  <Pressable
                    key={modo}
                    disabled={autenticando}
                    onPress={() => {
                      setErrorAuth("");
                      setModoAutenticacion(modo);
                    }}
                    style={[styles.segmentoOpcion, modoAutenticacion === modo && styles.segmentoActivo]}
                  >
                    <Text
                      style={[
                        styles.segmentoTexto,
                        modoAutenticacion === modo && styles.segmentoTextoActivo,
                      ]}
                    >
                      {modo === "login" ? "Ingresar" : "Registrarme"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {esRegistro ? (
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
              <View style={styles.passwordFila}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  secureTextEntry={!verPassword}
                  autoCapitalize="none"
                  autoComplete={esRegistro ? "new-password" : "current-password"}
                  placeholder={esRegistro ? "Mínimo 6 caracteres" : "Tu contraseña"}
                  placeholderTextColor={COLORES.reposo}
                  editable={!autenticando}
                  onSubmitEditing={handleAutenticacion}
                  returnKeyType="go"
                />
                <Pressable onPress={() => setVerPassword((v) => !v)} style={styles.passwordOjo}>
                  <Text style={styles.passwordOjoTexto}>{verPassword ? "Ocultar" : "Mostrar"}</Text>
                </Pressable>
              </View>

              {errorAuth ? (
                <View style={styles.errorAuthCaja}>
                  <Text style={styles.errorAuthTexto}>{errorAuth}</Text>
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.botonEntrar,
                  (pressed || autenticando) && styles.presionado,
                ]}
                onPress={handleAutenticacion}
                disabled={autenticando}
              >
                {autenticando ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.botonEntrarTexto}>
                    {esRegistro ? "Crear cuenta" : "Ingresar"}
                  </Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.loginPie}>Riego IoT · ESP32</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ---- Valores derivados para la tarjeta de la bomba ----
  const bombaEnReleSinVerificar = encendida && !bombaFuncionando && !falloBomba;
  const colorEstado = bombaFuncionando
    ? COLORES.agua
    : falloBomba
      ? COLORES.alerta
      : bombaEnReleSinVerificar
        ? COLORES.aviso
        : COLORES.reposo;

  const textoEstado = !token
    ? "Sin sesión"
    : !puedeLeerBomba
      ? "Sin acceso"
      : !equipoConectado
        ? "Sin conexión"
        : falloBomba
          ? "Fallo detectado"
          : bombaFuncionando
            ? "Bombeando"
            : estado?.pumpState === "ON"
              ? "Relé activado"
              : estado?.pumpState === "OFF"
                ? "Apagada"
                : "Sin confirmación";

  const textoDispositivo = !equipoConectado
    ? "ESP32 desconectado"
    : falloBomba
      ? "ESP32 conectado · bomba no detectada"
      : bombaFuncionando
        ? "ESP32 conectado · corriente detectada"
        : encendida
          ? "ESP32 conectado · verificando bomba"
          : "ESP32 conectado";

  const colorDispositivo = !equipoConectado || falloBomba ? COLORES.alerta : COLORES.bien;
  const fondoDispositivo = !equipoConectado || falloBomba ? COLORES.alertaClara : COLORES.bienClara;

  const evento = estado?.lastEvent;
  const escala = pulso.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const opacidad = pulso.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });
  const inicial = (usuario?.name ?? usuario?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <View style={styles.raiz}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.pantalla}
        contentContainerStyle={styles.contenido}
        showsVerticalScrollIndicator={false}
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
        <View style={styles.columna}>
          {/* Encabezado */}
          <View style={styles.cabeceraFila}>
            <View style={styles.cabeceraTextos}>
              <Text style={styles.titulo}>Riego</Text>
              <Text style={styles.subtitulo}>Panel de control · {DEVICE_CODE}</Text>
            </View>
            <View style={styles.conexion}>
              <View
                style={[styles.punto, { backgroundColor: error ? COLORES.alerta : COLORES.agua }]}
              />
              <Text style={styles.conexionTexto}>{haceCuanto(ultima, ahora)}</Text>
            </View>
          </View>

          {/* Sesión */}
          {usuario ? (
            <View style={styles.sesionTarjeta}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTexto}>{inicial}</Text>
              </View>
              <View style={styles.sesionTextos}>
                <Text style={styles.sesionNombre} numberOfLines={1}>
                  {usuario.name ?? usuario.email}
                </Text>
                <View style={styles.sesionSub}>
                  <View style={styles.rolBadge}>
                    <Text style={styles.rolBadgeTexto}>{usuario.role}</Text>
                  </View>
                  <Text style={styles.sesionEmail} numberOfLines={1}>
                    {usuario.email}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => [styles.salirBtn, pressed && styles.presionado]}
              >
                <Text style={styles.salirBtnTexto}>Salir</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Administración (solo con permisos) */}
          {puedeAdministrar ? (
            <Pressable
              onPress={() => setAdminVisible(true)}
              style={({ pressed }) => [styles.adminBtn, pressed && styles.presionado]}
            >
              <Text style={styles.adminBtnTexto}>⚙️  Administrar usuarios y roles</Text>
            </Pressable>
          ) : null}

          {/* Aviso sin conexión */}
          {error ? (
            <View style={styles.aviso}>
              <Text style={styles.avisoTitulo}>Sin conexión con el servidor</Text>
              <Text style={styles.avisoTexto}>
                {estado
                  ? "Se muestran los últimos datos recibidos. Se reintenta cada 5 segundos."
                  : error}
              </Text>
            </View>
          ) : null}

          {/* Protagonista: la bomba */}
          <View style={styles.heroTarjeta}>
            <View style={styles.heroZona}>
              {bombaFuncionando ? (
                <Animated.View
                  style={[
                    styles.onda,
                    {
                      backgroundColor: colorEstado,
                      opacity: opacidad,
                      transform: [{ scale: escala }],
                    },
                  ]}
                />
              ) : null}
              <View
                style={[
                  styles.circulo,
                  { borderColor: colorEstado, backgroundColor: COLORES.reposoClaro },
                ]}
              >
                <Text style={styles.heroIcono}>💧</Text>
                <Text style={styles.heroEtiqueta}>Bomba</Text>
                <Text style={[styles.heroEstado, { color: colorEstado }]} numberOfLines={2}>
                  {textoEstado}
                </Text>
              </View>
            </View>

            {token && puedeLeerBomba ? (
              <View style={[styles.chipDispositivo, { backgroundColor: fondoDispositivo }]}>
                <View style={[styles.punto, { backgroundColor: colorDispositivo }]} />
                <Text style={[styles.chipDispositivoTexto, { color: colorDispositivo }]}>
                  {textoDispositivo}
                </Text>
              </View>
            ) : null}

            {token && puedeLeerBomba && !equipoConectado ? (
              <Text style={styles.pista}>
                Revisa que el ESP32 esté encendido y conectado a internet.
              </Text>
            ) : null}

            {!token ? (
              <Pressable
                style={({ pressed }) => [
                  styles.botonBomba,
                  styles.botonEncender,
                  pressed && styles.presionado,
                ]}
                onPress={() => abrirLogin("login")}
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
              <View style={[styles.botonBomba, styles.botonNoDisponible]}>
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
                  (pressed || isSubmitting) && styles.presionado,
                  (isSubmitting || !estadoConocido) && styles.botonDeshabilitado,
                ]}
              >
                {isSubmitting ? (
                  <View style={styles.esperandoConfirmacion}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.textoBotonBomba}>Esperando confirmación…</Text>
                  </View>
                ) : (
                  <Text style={styles.textoBotonBomba}>
                    {encendida ? "Apagar bomba" : "Encender bomba"}
                  </Text>
                )}
              </Pressable>
            )}
          </View>

          {/* Resumen rápido */}
          <View style={styles.datosFila}>
            <Dato icono="💧" etiqueta="Bomba" valor={textoEstado} color={colorEstado} />
            <Dato
              icono="📡"
              etiqueta="ESP32"
              valor={equipoConectado ? "Conectado" : "Sin conexión"}
              color={equipoConectado ? COLORES.bien : COLORES.alerta}
            />
          </View>

          <View style={styles.tarjetaExterna}>
            <HumedadDashboard token={token} hasPermission={puedeLeerHumedad} />
          </View>
          <HardwareDiagnostics token={token} enabled={puedeLeerBomba} />

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
                <Fila etiqueta="Duración" valor={formatearDuracion(evento.durationSeconds)} ultima />
                {evento.soilHumidityBefore !== null || evento.soilHumidityAfter !== null ? (
                  <>
                    <Text style={styles.subseccion}>Humedad del suelo en ese riego</Text>
                    <BarraHumedad etiqueta="Antes" valor={evento.soilHumidityBefore} />
                    <BarraHumedad etiqueta="Después" valor={evento.soilHumidityAfter} />
                  </>
                ) : null}
              </>
            ) : (
              <Text style={styles.vacio}>
                Todavía no hay riegos registrados. Aparecerán aquí cuando la bomba se active.
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Notificación flotante (reemplaza a Alert, que no funciona en la web) */}
      {aviso ? (
        <View style={styles.toastZona} pointerEvents="box-none">
          <Notificacion aviso={aviso} onCerrar={() => setAviso(null)} />
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

    </View>
  );
}

const sombraSuave = {
  shadowColor: "#12302F",
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: COLORES.fondo },
  pantalla: { flex: 1, backgroundColor: COLORES.fondo },
  contenido: {
    paddingTop: Platform.OS === "web" ? 112 : 60, // en web, deja espacio para la barra "Expo Starter"
    paddingHorizontal: 20,
    paddingBottom: 56,
    alignItems: "center",
  },
  columna: { width: "100%", maxWidth: 560 },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORES.fondo,
    gap: 14,
  },
  centroTexto: { fontSize: 14, color: COLORES.tintaSuave },
  presionado: { opacity: 0.8 },

  // Encabezado
  cabeceraFila: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  cabeceraTextos: { flexShrink: 1 },
  titulo: { fontSize: 36, fontWeight: "800", color: COLORES.tinta, letterSpacing: -1 },
  subtitulo: { fontSize: 14, color: COLORES.tintaSuave, marginTop: 2 },
  conexion: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORES.tarjeta,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORES.linea,
  },
  punto: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  conexionTexto: { fontSize: 12, color: COLORES.tintaSuave, fontWeight: "600" },

  // Sesión
  sesionTarjeta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORES.tarjeta,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORES.tinta,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarTexto: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  sesionTextos: { flex: 1, marginRight: 8 },
  sesionNombre: { fontSize: 15, fontWeight: "700", color: COLORES.tinta },
  sesionSub: { flexDirection: "row", alignItems: "center", marginTop: 3, gap: 6 },
  sesionEmail: { fontSize: 12, color: COLORES.tintaSuave, flexShrink: 1 },
  rolBadge: {
    backgroundColor: COLORES.aguaClara,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  rolBadgeTexto: { color: COLORES.agua, fontSize: 10, fontWeight: "800" },
  salirBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORES.alertaClara,
    borderRadius: 12,
  },
  salirBtnTexto: { fontSize: 13, color: COLORES.alerta, fontWeight: "700" },

  loginTarjeta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORES.tarjeta,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  loginIcono: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORES.aguaClara,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  loginIconoTexto: { fontSize: 20 },
  flecha: { fontSize: 28, color: COLORES.reposo, marginTop: -4 },

  adminBtn: {
    marginTop: 12,
    backgroundColor: COLORES.tinta,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
  },
  adminBtnTexto: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },

  aviso: {
    marginTop: 16,
    backgroundColor: COLORES.alertaClara,
    borderLeftWidth: 4,
    borderLeftColor: COLORES.alerta,
    padding: 14,
    borderRadius: 12,
  },
  avisoTitulo: { fontSize: 15, fontWeight: "700", color: COLORES.alerta, marginBottom: 2 },
  avisoTexto: { fontSize: 14, color: COLORES.tinta, lineHeight: 20 },

  // Tarjeta de la bomba
  heroTarjeta: {
    marginTop: 18,
    backgroundColor: COLORES.tarjeta,
    borderRadius: 28,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  heroZona: { alignItems: "center", justifyContent: "center", height: 240, width: "100%" },
  onda: { position: "absolute", width: 190, height: 190, borderRadius: 95 },
  circulo: {
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  heroIcono: { fontSize: 28, marginBottom: 2 },
  heroEtiqueta: { fontSize: 13, color: COLORES.tintaSuave, marginBottom: 2 },
  heroEstado: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
    textAlign: "center",
    paddingHorizontal: 18,
  },
  chipDispositivo: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginTop: 4,
  },
  chipDispositivoTexto: { fontSize: 13, fontWeight: "700" },
  botonBomba: {
    width: "100%",
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    paddingHorizontal: 24,
    borderRadius: 18,
  },
  botonEncender: { backgroundColor: COLORES.agua },
  botonApagar: { backgroundColor: COLORES.alerta },
  botonNoDisponible: { backgroundColor: COLORES.reposo },
  botonDeshabilitado: { opacity: 0.55 },
  textoBotonBomba: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  esperandoConfirmacion: { flexDirection: "row", alignItems: "center", gap: 10 },
  permisoTexto: {
    marginTop: 18,
    color: COLORES.tintaSuave,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },


  // Resumen rápido
  datosFila: { flexDirection: "row", gap: 10, marginTop: 14 },
  dato: {
    flex: 1,
    backgroundColor: COLORES.tarjeta,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  datoIcono: { fontSize: 18, marginBottom: 6 },
  datoEtiqueta: { fontSize: 12, color: COLORES.tintaSuave, fontWeight: "600" },
  datoValor: { fontSize: 14, fontWeight: "800", marginTop: 2 },
  pista: {
    fontSize: 13,
    color: COLORES.tintaSuave,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 10,
    paddingHorizontal: 12,
  },
  tarjetaExterna: {
    marginTop: 20,
    backgroundColor: COLORES.tarjeta,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  subseccion: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORES.tintaSuave,
    marginTop: 18,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // Secciones
  seccion: {
    marginTop: 24,
    backgroundColor: COLORES.tarjeta,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  seccionCabecera: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  seccionTitulo: { fontSize: 18, fontWeight: "700", color: COLORES.tinta, marginBottom: 4 },
  insignia: {
    backgroundColor: COLORES.aguaClara,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  insigniaTexto: { color: COLORES.agua, fontSize: 12, fontWeight: "700" },

  fila: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORES.linea,
  },
  filaUltima: { borderBottomWidth: 0 },
  filaEtiqueta: { fontSize: 15, color: COLORES.tintaSuave },
  filaValor: { fontSize: 15, fontWeight: "600", color: COLORES.tinta },

  barraFila: { marginTop: 14 },
  barraTextos: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  barraEtiqueta: { fontSize: 14, color: COLORES.tintaSuave },
  barraValor: { fontSize: 14, fontWeight: "700", color: COLORES.tinta },
  barraFondo: { height: 10, borderRadius: 5, backgroundColor: COLORES.tierraClara, overflow: "hidden" },
  barraRelleno: { height: 10, borderRadius: 5, backgroundColor: COLORES.tierra },

  vacio: { fontSize: 14, color: COLORES.tintaSuave, lineHeight: 22, marginTop: 6 },

  // Notificación flotante
  toastZona: {
    position: "absolute",
    top: Platform.OS === "web" ? 108 : 52,
    left: 16,
    right: 16,
    alignItems: "center",
    zIndex: 50,
  },
  toast: {
    width: "100%",
    maxWidth: 520,
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  toastIcono: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 1,
  },
  toastIconoTexto: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  toastTextos: { flex: 1 },
  toastTitulo: { fontSize: 15, fontWeight: "800" },
  toastTexto: { fontSize: 13, color: COLORES.tinta, marginTop: 2, lineHeight: 18 },


  // Pantalla de inicio de sesión
  loginRaiz: { flex: 1, backgroundColor: COLORES.fondo },
  loginScroll: { flexGrow: 1, alignItems: "center", paddingBottom: 40 },
  loginCabecera: {
    width: "100%",
    backgroundColor: COLORES.tinta,
    alignItems: "center",
    paddingTop: Platform.OS === "web" ? 128 : 96,
    paddingBottom: 96,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  loginLogo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORES.agua,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  loginLogoIcono: { fontSize: 38 },
  loginMarca: { fontSize: 40, fontWeight: "800", color: "#FFFFFF", letterSpacing: -1 },
  loginLema: { fontSize: 15, color: "#B9D3CF", marginTop: 6, textAlign: "center" },
  loginFormZona: { width: "100%", maxWidth: 440, paddingHorizontal: 20, marginTop: -56 },
  loginFormTarjeta: {
    backgroundColor: COLORES.tarjeta,
    borderRadius: 26,
    padding: 24,
    shadowColor: "#12302F",
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  loginPie: { textAlign: "center", color: COLORES.reposo, fontSize: 12, marginTop: 22 },
  passwordFila: { flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, paddingRight: 84 },
  passwordOjo: { position: "absolute", right: 6, paddingVertical: 8, paddingHorizontal: 10 },
  passwordOjoTexto: { color: COLORES.agua, fontWeight: "700", fontSize: 13 },

  // Modal de acceso (estilos reutilizados por el formulario)
  modalFondo: {
    flex: 1,
    backgroundColor: "rgba(18, 48, 47, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalScroll: { flex: 1, width: "100%" },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContenedor: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: COLORES.tarjeta,
    borderRadius: 26,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  modalTitulo: { fontSize: 24, fontWeight: "800", color: COLORES.tinta, marginBottom: 4 },
  modalSubtitulo: { fontSize: 14, color: COLORES.tintaSuave, marginBottom: 18, lineHeight: 20 },
  segmento: {
    flexDirection: "row",
    backgroundColor: COLORES.reposoClaro,
    borderRadius: 14,
    padding: 4,
    marginBottom: 6,
  },
  segmentoOpcion: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: "center" },
  segmentoActivo: { backgroundColor: COLORES.tarjeta, ...sombraSuave },
  segmentoTexto: { fontSize: 14, fontWeight: "700", color: COLORES.tintaSuave },
  segmentoTextoActivo: { color: COLORES.tinta },
  inputLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORES.tinta,
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: COLORES.fondo,
    borderWidth: 1,
    borderColor: COLORES.linea,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORES.tinta,
  },
  errorAuthCaja: {
    backgroundColor: COLORES.alertaClara,
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  errorAuthTexto: { color: COLORES.alerta, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  botonEntrar: {
    backgroundColor: COLORES.agua,
    minHeight: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
  },
  botonEntrarTexto: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  cancelarLink: { alignSelf: "center", paddingTop: 16, paddingBottom: 2 },
  cancelarLinkTexto: { color: COLORES.tintaSuave, fontWeight: "700", fontSize: 14 },
});