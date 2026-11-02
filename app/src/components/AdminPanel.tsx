import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/**
 * Panel de administración de usuarios y roles.
 * Qué ve/hace cada persona depende de sus permisos (los mismos que valida el backend):
 *   users:read   -> ve la lista de usuarios
 *   users:manage -> crea, edita, elimina usuarios y les cambia el rol
 *   roles:read   -> ve la lista de roles
 *   roles:manage -> crea, edita y elimina roles
 * El backend vuelve a validar todo: ocultar un botón aquí es solo comodidad.
 */

const COLORES = {
  fondo: "#F3F7F5",
  tarjeta: "#FFFFFF",
  tinta: "#12302F",
  tintaSuave: "#5C706E",
  agua: "#1FA7B5",
  aguaClara: "#E3F4F6",
  reposo: "#9DB0AB",
  reposoClaro: "#EEF3F1",
  alerta: "#C2571A",
  alertaClara: "#FBEBDD",
  bien: "#2E9E4F",
  bienClara: "#E2F3E7",
  linea: "#E0E8E4",
};

const ETIQUETAS_PERMISOS: Record<string, string> = {
  "humidity:read": "Ver humedad",
  "humidity:create": "Registrar lecturas de humedad",
  "pump:read": "Ver estado de la bomba",
  "pump:control": "Encender / apagar la bomba",
  "roles:read": "Ver roles",
  "roles:manage": "Crear, editar y eliminar roles",
  "permissions:read": "Ver lista de permisos",
  "users:read": "Ver usuarios",
  "users:manage": "Crear, editar y eliminar usuarios",
};

type UsuarioSesion = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  roleId: number | null;
  permissions: string[];
};

type UsuarioAdmin = {
  id: number;
  email: string;
  name: string | null;
  roleId: number | null;
  role: string;
};

type RolAdmin = {
  id: number;
  name: string;
  description: string | null;
  permissions: string[];
};

type PermisoCatalogo = { action: string; description: string };

type Vista =
  | { tipo: "lista" }
  | { tipo: "usuario"; editando: UsuarioAdmin | null }
  | { tipo: "rol"; editando: RolAdmin | null };

type Props = {
  visible: boolean;
  onClose: () => void;
  apiBase: string;
  token: string;
  usuario: UsuarioSesion;
};

async function llamar<T>(
  apiBase: string,
  token: string,
  ruta: string,
  metodo: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  cuerpo?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (cuerpo !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${apiBase}${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!res.ok) {
    const mensaje = Array.isArray(datos.message) ? datos.message.join("\n") : datos.message;
    // Nest responde "Cannot DELETE /users/5" cuando la ruta no existe en el servidor
    if (res.status === 404 && typeof mensaje === "string" && mensaje.startsWith("Cannot ")) {
      throw new Error(
        "El servidor todavía no tiene esta función (ruta no encontrada). Hay que actualizar el backend.",
      );
    }
    throw new Error(mensaje ?? `Error HTTP ${res.status}`);
  }
  return datos as T;
}

function Chip({
  texto,
  activo,
  onPress,
  deshabilitado,
}: {
  texto: string;
  activo: boolean;
  onPress: () => void;
  deshabilitado?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado}
      style={[styles.chip, activo && styles.chipActivo, deshabilitado && styles.deshabilitado]}
    >
      <Text style={[styles.chipTexto, activo && styles.chipTextoActivo]}>
        {activo ? "✓ " : ""}
        {texto}
      </Text>
    </Pressable>
  );
}

export default function AdminPanel({ visible, onClose, apiBase, token, usuario }: Props) {
  const esAdmin = usuario.role === "ADMIN";
  const can = (permiso: string) => esAdmin || usuario.permissions.includes(permiso);

  const puedeVerUsuarios = can("users:read");
  const puedeGestionarUsuarios = can("users:manage");
  const puedeVerRoles = can("roles:read");
  const puedeGestionarRoles = can("roles:manage");
  const sinAcceso = !puedeVerUsuarios && !puedeVerRoles;

  const [pestana, setPestana] = useState<"usuarios" | "roles">(
    puedeVerUsuarios ? "usuarios" : "roles",
  );
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [roles, setRoles] = useState<RolAdmin[]>([]);
  const [catalogo, setCatalogo] = useState<PermisoCatalogo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    texto: string;
    onOk: () => void;
  } | null>(null);
  const exitoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Formulario de usuario
  const [fNombre, setFNombre] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fRolId, setFRolId] = useState<number | null>(null);

  // Formulario de rol
  const [rNombre, setRNombre] = useState("");
  const [rDescripcion, setRDescripcion] = useState("");
  const [rPermisos, setRPermisos] = useState<string[]>([]);

  const avisarExito = (mensaje: string) => {
    if (exitoTimer.current) clearTimeout(exitoTimer.current);
    setExito(mensaje);
    exitoTimer.current = setTimeout(() => setExito(""), 4000);
  };

  useEffect(
    () => () => {
      if (exitoTimer.current) clearTimeout(exitoTimer.current);
    },
    [],
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      if (puedeVerUsuarios) {
        const u = await llamar<{ data: UsuarioAdmin[] }>(apiBase, token, "/users");
        setUsuarios(u.data);
      }
      try {
        const r = await llamar<{ data: RolAdmin[] }>(apiBase, token, "/roles");
        setRoles(r.data);
      } catch {
        setRoles([]); // sin roles:read no se pueden listar
      }
      try {
        const p = await llamar<{ permissions: PermisoCatalogo[] }>(
          apiBase,
          token,
          "/auth/available-permissions",
        );
        setCatalogo(p.permissions);
      } catch {
        setCatalogo([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los datos.");
    } finally {
      setCargando(false);
    }
  }, [apiBase, token, puedeVerUsuarios]);

  useEffect(() => {
    if (visible && !sinAcceso) {
      setVista({ tipo: "lista" });
      setConfirmacion(null);
      setExito("");
      void cargar();
    }
  }, [visible, sinAcceso, cargar]);

  /** Ejecuta una acción de escritura, muestra errores y recarga la lista */
  const ejecutar = async (accion: () => Promise<unknown>, mensajeOk: string) => {
    setGuardando(true);
    setError("");
    try {
      await accion();
      setVista({ tipo: "lista" });
      await cargar();
      avisarExito(mensajeOk);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
    } finally {
      setGuardando(false);
    }
  };

  // ---------- Usuarios ----------
  const abrirUsuario = (u: UsuarioAdmin | null) => {
    setError("");
    setFNombre(u?.name ?? "");
    setFEmail(u?.email ?? "");
    setFPassword("");
    setFRolId(u?.roleId ?? roles.find((r) => r.name === "VIEWER")?.id ?? null);
    setVista({ tipo: "usuario", editando: u });
  };

  const guardarUsuario = () => {
    if (vista.tipo !== "usuario") return;
    const editando = vista.editando;
    const email = fEmail.trim().toLowerCase();
    if (!email || (!editando && fPassword.length < 6)) {
      setError(
        editando
          ? "El correo es obligatorio."
          : "Correo y contraseña (mínimo 6 caracteres) son obligatorios.",
      );
      return;
    }
    if (editando && fPassword && fPassword.length < 6) {
      setError("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }

    void ejecutar(
      async () => {
        if (editando) {
          // 1) Cambio de rol: PUT /users/:id/role
          if (fRolId !== null && fRolId !== editando.roleId) {
            await llamar(apiBase, token, `/users/${editando.id}/role`, "PUT", { roleId: fRolId });
          }
          // 2) Nombre, correo o contraseña: PUT /users/:id (solo si cambiaron)
          const cambios: Record<string, unknown> = {};
          if (email !== editando.email) cambios.email = email;
          if (fNombre.trim() !== (editando.name ?? "")) cambios.name = fNombre.trim();
          if (fPassword) cambios.password = fPassword;
          if (Object.keys(cambios).length > 0) {
            await llamar(apiBase, token, `/users/${editando.id}`, "PUT", cambios);
          }
          return;
        }
        const nuevo: Record<string, unknown> = { email, password: fPassword };
        if (fNombre.trim()) nuevo.name = fNombre.trim();
        if (fRolId !== null) nuevo.roleId = fRolId;
        return llamar(apiBase, token, "/users", "POST", nuevo);
      },
      editando ? "Usuario actualizado." : "Usuario creado.",
    );
  };

  const pedirEliminarUsuario = (u: UsuarioAdmin) =>
    setConfirmacion({
      titulo: "Eliminar usuario",
      texto: `¿Eliminar a ${u.name ?? u.email} (${u.email})? Esta acción no se puede deshacer.`,
      onOk: () =>
        void ejecutar(
          () => llamar(apiBase, token, `/users/${u.id}`, "DELETE"),
          "Usuario eliminado.",
        ),
    });

  // ---------- Roles ----------
  const abrirRol = (r: RolAdmin | null) => {
    setError("");
    setRNombre(r?.name ?? "");
    setRDescripcion(r?.description ?? "");
    setRPermisos(r?.permissions ?? []);
    setVista({ tipo: "rol", editando: r });
  };

  const alternarPermiso = (accion: string) =>
    setRPermisos((actuales) =>
      actuales.includes(accion) ? actuales.filter((a) => a !== accion) : [...actuales, accion],
    );

  const guardarRol = () => {
    if (vista.tipo !== "rol") return;
    const editando = vista.editando;
    const nombre = rNombre.trim();
    if (!nombre) {
      setError("El nombre del rol es obligatorio.");
      return;
    }
    const cuerpo = { name: nombre, description: rDescripcion.trim(), permissions: rPermisos };
    void ejecutar(
      () =>
        editando
          ? llamar(apiBase, token, `/roles/${editando.id}`, "PUT", cuerpo)
          : llamar(apiBase, token, "/roles", "POST", cuerpo),
      editando ? "Rol actualizado." : "Rol creado.",
    );
  };

  const pedirEliminarRol = (r: RolAdmin) =>
    setConfirmacion({
      titulo: "Eliminar rol",
      texto: `¿Eliminar el rol ${r.name}? Los usuarios que lo tengan quedarán sin rol.`,
      onOk: () =>
        void ejecutar(() => llamar(apiBase, token, `/roles/${r.id}`, "DELETE"), "Rol eliminado."),
    });

  // ---------- Render ----------
  const renderLista = () => (
    <>
      <View style={styles.pestanas}>
        {puedeVerUsuarios ? (
          <Pressable
            style={[styles.pestana, pestana === "usuarios" && styles.pestanaActiva]}
            onPress={() => setPestana("usuarios")}
          >
            <Text style={[styles.pestanaTexto, pestana === "usuarios" && styles.pestanaTextoActivo]}>
              Usuarios ({usuarios.length})
            </Text>
          </Pressable>
        ) : null}
        {puedeVerRoles ? (
          <Pressable
            style={[styles.pestana, pestana === "roles" && styles.pestanaActiva]}
            onPress={() => setPestana("roles")}
          >
            <Text style={[styles.pestanaTexto, pestana === "roles" && styles.pestanaTextoActivo]}>
              Roles ({roles.length})
            </Text>
          </Pressable>
        ) : null}
      </View>

      {pestana === "usuarios" && puedeVerUsuarios ? (
        <>
          {puedeGestionarUsuarios ? (
            <Pressable
              style={({ pressed }) => [styles.botonPrimario, pressed && styles.presionado]}
              onPress={() => abrirUsuario(null)}
            >
              <Text style={styles.botonPrimarioTexto}>+ Nuevo usuario</Text>
            </Pressable>
          ) : null}
          {usuarios.map((u) => {
            const esYo = u.id === usuario.id;
            const bloqueado = u.role === "ADMIN" && !esAdmin; // un no-admin no toca a un ADMIN
            const inicial = (u.name ?? u.email).trim().charAt(0).toUpperCase();
            return (
              <View key={u.id} style={styles.tarjeta}>
                <View style={styles.tarjetaFila}>
                  <View style={[styles.avatar, esYo && styles.avatarYo]}>
                    <Text style={styles.avatarTexto}>{inicial}</Text>
                  </View>
                  <View style={styles.tarjetaTextos}>
                    <Text style={styles.tarjetaTitulo} numberOfLines={1}>
                      {u.name ?? u.email}
                      {esYo ? "  (tú)" : ""}
                    </Text>
                    <Text style={styles.tarjetaSub} numberOfLines={1}>
                      {u.email}
                    </Text>
                  </View>
                  <View style={[styles.rolBadge, u.role === "ADMIN" && styles.rolBadgeAdmin]}>
                    <Text style={[styles.rolBadgeTexto, u.role === "ADMIN" && styles.rolBadgeTextoAdmin]}>
                      {u.role}
                    </Text>
                  </View>
                </View>
                {puedeGestionarUsuarios && !bloqueado ? (
                  <View style={styles.acciones}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.botonSecundario,
                        styles.botonFlex,
                        pressed && styles.presionado,
                      ]}
                      onPress={() => abrirUsuario(u)}
                    >
                      <Text style={styles.botonSecundarioTexto}>Editar</Text>
                    </Pressable>
                    {!esYo ? (
                      <Pressable
                        style={({ pressed }) => [
                          styles.botonPeligro,
                          styles.botonFlex,
                          pressed && styles.presionado,
                        ]}
                        onPress={() => pedirEliminarUsuario(u)}
                      >
                        <Text style={styles.botonPeligroTexto}>Eliminar</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          {usuarios.length === 0 && !cargando ? (
            <Text style={styles.vacio}>No hay usuarios para mostrar.</Text>
          ) : null}
        </>
      ) : null}

      {pestana === "roles" && puedeVerRoles ? (
        <>
          {puedeGestionarRoles ? (
            <Pressable
              style={({ pressed }) => [styles.botonPrimario, pressed && styles.presionado]}
              onPress={() => abrirRol(null)}
            >
              <Text style={styles.botonPrimarioTexto}>+ Nuevo rol</Text>
            </Pressable>
          ) : null}
          {roles.map((r) => (
            <View key={r.id} style={styles.tarjeta}>
              <View style={styles.tarjetaFila}>
                <View style={styles.tarjetaTextos}>
                  <Text style={styles.tarjetaTitulo}>{r.name}</Text>
                  {r.description ? <Text style={styles.tarjetaSub}>{r.description}</Text> : null}
                </View>
              </View>
              {r.name === "ADMIN" ? (
                <Text style={styles.permisosTexto}>Acceso total al sistema</Text>
              ) : r.permissions.length > 0 ? (
                <View style={styles.permisosFila}>
                  {r.permissions.map((p) => (
                    <View key={p} style={styles.permisoPill}>
                      <Text style={styles.permisoPillTexto}>{ETIQUETAS_PERMISOS[p] ?? p}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.permisosTexto}>Sin permisos</Text>
              )}
              {puedeGestionarRoles && r.name !== "ADMIN" ? (
                <View style={styles.acciones}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.botonSecundario,
                      styles.botonFlex,
                      pressed && styles.presionado,
                    ]}
                    onPress={() => abrirRol(r)}
                  >
                    <Text style={styles.botonSecundarioTexto}>Editar</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.botonPeligro,
                      styles.botonFlex,
                      pressed && styles.presionado,
                    ]}
                    onPress={() => pedirEliminarRol(r)}
                  >
                    <Text style={styles.botonPeligroTexto}>Eliminar</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </>
  );

  const renderBotonesForm = (onGuardar: () => void) => (
    <>
      {error ? (
        <View style={[styles.errorCaja, styles.errorForm]}>
          <Text style={styles.errorTexto}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.acciones}>
        <Pressable
          style={({ pressed }) => [
            styles.botonPrimario,
            styles.botonFlex,
            (guardando || pressed) && styles.presionado,
          ]}
          disabled={guardando}
          onPress={onGuardar}
        >
          {guardando ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.botonPrimarioTexto}>Guardar</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.botonSecundario,
            styles.botonFlex,
            pressed && styles.presionado,
          ]}
          disabled={guardando}
          onPress={() => {
            setError("");
            setVista({ tipo: "lista" });
          }}
        >
          <Text style={styles.botonSecundarioTexto}>Cancelar</Text>
        </Pressable>
      </View>
    </>
  );

  const renderFormUsuario = () => {
    if (vista.tipo !== "usuario") return null;
    const editando = vista.editando;
    // Un no-admin no puede ofrecer el rol ADMIN
    const rolesDisponibles = roles.filter((r) => esAdmin || r.name !== "ADMIN");
    return (
      <View style={styles.formTarjeta}>
        <Text style={styles.formTitulo}>{editando ? "Editar usuario" : "Nuevo usuario"}</Text>

        <Text style={styles.etiqueta}>Nombre</Text>
        <TextInput
          style={styles.input}
          value={fNombre}
          onChangeText={setFNombre}
          placeholder="Nombre"
          placeholderTextColor={COLORES.reposo}
        />

        <Text style={styles.etiqueta}>Correo</Text>
        <TextInput
          style={styles.input}
          value={fEmail}
          onChangeText={setFEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="correo@ejemplo.com"
          placeholderTextColor={COLORES.reposo}
        />

        <Text style={styles.etiqueta}>
          {editando ? "Nueva contraseña (déjala vacía para no cambiarla)" : "Contraseña"}
        </Text>
        <TextInput
          style={styles.input}
          value={fPassword}
          onChangeText={setFPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="Mínimo 6 caracteres"
          placeholderTextColor={COLORES.reposo}
        />

        <Text style={styles.etiqueta}>Rol</Text>
        <View style={styles.chips}>
          {rolesDisponibles.map((r) => (
            <Chip key={r.id} texto={r.name} activo={fRolId === r.id} onPress={() => setFRolId(r.id)} />
          ))}
        </View>
        {rolesDisponibles.length === 0 ? (
          <Text style={styles.vacio}>
            No se pudo cargar la lista de roles (hace falta el permiso roles:read para elegir rol).
          </Text>
        ) : null}

        {renderBotonesForm(guardarUsuario)}
      </View>
    );
  };

  const renderFormRol = () => {
    if (vista.tipo !== "rol") return null;
    const editando = vista.editando;
    return (
      <View style={styles.formTarjeta}>
        <Text style={styles.formTitulo}>{editando ? "Editar rol" : "Nuevo rol"}</Text>

        <Text style={styles.etiqueta}>Nombre</Text>
        <TextInput
          style={styles.input}
          value={rNombre}
          onChangeText={setRNombre}
          autoCapitalize="characters"
          placeholder="EJ: TECNICO"
          placeholderTextColor={COLORES.reposo}
        />

        <Text style={styles.etiqueta}>Descripción</Text>
        <TextInput
          style={styles.input}
          value={rDescripcion}
          onChangeText={setRDescripcion}
          placeholder="Para qué sirve este rol"
          placeholderTextColor={COLORES.reposo}
        />

        <Text style={styles.etiqueta}>Permisos</Text>
        <View style={styles.chips}>
          {catalogo.map((p) => (
            <Chip
              key={p.action}
              texto={ETIQUETAS_PERMISOS[p.action] ?? p.action}
              activo={rPermisos.includes(p.action)}
              onPress={() => alternarPermiso(p.action)}
            />
          ))}
        </View>

        {renderBotonesForm(guardarRol)}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.pantalla}>
        <View style={styles.cabecera}>
          <View>
            <Text style={styles.titulo}>Administración</Text>
            <Text style={styles.subtitulo}>Usuarios, roles y permisos</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.botonCerrar, pressed && styles.presionado]}
          >
            <Text style={styles.botonSecundarioTexto}>Cerrar</Text>
          </Pressable>
        </View>

        {/* Mensajes fijos: siempre visibles aunque la lista esté desplazada */}
        {exito ? (
          <View style={styles.exitoCaja}>
            <Text style={styles.exitoTexto}>✓  {exito}</Text>
          </View>
        ) : null}
        {error && vista.tipo === "lista" ? (
          <View style={[styles.errorCaja, styles.errorFijo]}>
            <Text style={styles.errorTexto}>{error}</Text>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.contenido}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.columna}>
            {sinAcceso ? (
              <Text style={styles.vacio}>Tu cuenta no tiene permisos de administración.</Text>
            ) : cargando && vista.tipo === "lista" && usuarios.length === 0 && roles.length === 0 ? (
              <ActivityIndicator size="large" color={COLORES.agua} style={styles.cargando} />
            ) : vista.tipo === "lista" ? (
              renderLista()
            ) : vista.tipo === "usuario" ? (
              renderFormUsuario()
            ) : (
              renderFormRol()
            )}
          </View>
        </ScrollView>

        {/* Confirmación centrada en pantalla (antes aparecía arriba y no se veía) */}
        {confirmacion ? (
          <View style={styles.confirmFondo}>
            <View style={styles.confirmCaja}>
              <Text style={styles.confirmTitulo}>{confirmacion.titulo}</Text>
              <Text style={styles.confirmTexto}>{confirmacion.texto}</Text>
              <View style={styles.acciones}>
                <Pressable
                  style={({ pressed }) => [
                    styles.botonSecundario,
                    styles.botonFlex,
                    pressed && styles.presionado,
                  ]}
                  onPress={() => setConfirmacion(null)}
                >
                  <Text style={styles.botonSecundarioTexto}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.botonEliminarFuerte,
                    styles.botonFlex,
                    pressed && styles.presionado,
                  ]}
                  onPress={() => {
                    const ok = confirmacion.onOk;
                    setConfirmacion(null);
                    ok();
                  }}
                >
                  <Text style={styles.botonEliminarFuerteTexto}>Sí, eliminar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {/* Indicador mientras se ejecuta una acción de la lista (p. ej. eliminar) */}
        {guardando && vista.tipo === "lista" ? (
          <View style={styles.guardandoFondo} pointerEvents="none">
            <ActivityIndicator size="large" color={COLORES.agua} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const sombraSuave = {
  shadowColor: "#12302F",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.fondo },
  cabecera: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "web" ? 24 : 56,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  titulo: { fontSize: 26, fontWeight: "800", color: COLORES.tinta, letterSpacing: -0.5 },
  subtitulo: { fontSize: 13, color: COLORES.tintaSuave, marginTop: 2 },
  botonCerrar: {
    backgroundColor: COLORES.tarjeta,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORES.linea,
  },
  contenido: { paddingHorizontal: 20, paddingBottom: 56, alignItems: "center" },
  columna: { width: "100%", maxWidth: 600 },
  cargando: { marginTop: 40 },
  vacio: { color: COLORES.tintaSuave, fontSize: 14, marginTop: 14, lineHeight: 20 },
  presionado: { opacity: 0.8 },
  deshabilitado: { opacity: 0.5 },

  // Pestañas
  pestanas: {
    flexDirection: "row",
    backgroundColor: COLORES.reposoClaro,
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  pestana: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: "center" },
  pestanaActiva: { backgroundColor: COLORES.tarjeta, ...sombraSuave },
  pestanaTexto: { fontSize: 14, fontWeight: "700", color: COLORES.tintaSuave },
  pestanaTextoActivo: { color: COLORES.tinta },

  // Chips (selección de rol / permisos)
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: COLORES.tarjeta,
    borderWidth: 1,
    borderColor: COLORES.linea,
  },
  chipActivo: { backgroundColor: COLORES.tinta, borderColor: COLORES.tinta },
  chipTexto: { color: COLORES.tinta, fontSize: 13, fontWeight: "600" },
  chipTextoActivo: { color: "#FFFFFF" },

  // Tarjetas de usuario / rol
  tarjeta: {
    backgroundColor: COLORES.tarjeta,
    borderRadius: 18,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  tarjetaFila: { flexDirection: "row", alignItems: "center" },
  tarjetaTextos: { flex: 1, marginRight: 8 },
  tarjetaTitulo: { fontSize: 16, fontWeight: "700", color: COLORES.tinta },
  tarjetaSub: { fontSize: 13, color: COLORES.tintaSuave, marginTop: 2 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORES.reposo,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarYo: { backgroundColor: COLORES.agua },
  avatarTexto: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  rolBadge: {
    backgroundColor: COLORES.aguaClara,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
  },
  rolBadgeAdmin: { backgroundColor: COLORES.tinta },
  rolBadgeTexto: { color: COLORES.agua, fontSize: 11, fontWeight: "800" },
  rolBadgeTextoAdmin: { color: "#FFFFFF" },
  permisosTexto: { fontSize: 13, color: COLORES.tintaSuave, marginTop: 10, lineHeight: 18 },
  permisosFila: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  permisoPill: {
    backgroundColor: COLORES.reposoClaro,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  permisoPillTexto: { fontSize: 12, color: COLORES.tintaSuave, fontWeight: "600" },

  // Botones
  acciones: { flexDirection: "row", gap: 10, marginTop: 14 },
  botonFlex: { flex: 1 },
  botonPrimario: {
    backgroundColor: COLORES.agua,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  botonPrimarioTexto: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  botonSecundario: {
    backgroundColor: COLORES.reposoClaro,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  botonSecundarioTexto: { color: COLORES.tinta, fontWeight: "700", fontSize: 14 },
  botonPeligro: {
    backgroundColor: COLORES.alertaClara,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  botonPeligroTexto: { color: COLORES.alerta, fontWeight: "700", fontSize: 14 },
  botonEliminarFuerte: {
    backgroundColor: COLORES.alerta,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  botonEliminarFuerteTexto: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },

  // Mensajes
  errorCaja: {
    backgroundColor: COLORES.alertaClara,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORES.alerta,
  },
  errorFijo: { marginHorizontal: 20, marginBottom: 10 },
  errorTexto: { color: COLORES.alerta, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  errorForm: { marginTop: 16 },
  exitoCaja: {
    backgroundColor: COLORES.bienClara,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: COLORES.bien,
  },
  exitoTexto: { color: COLORES.bien, fontSize: 14, fontWeight: "700" },

  // Formularios
  formTarjeta: {
    backgroundColor: COLORES.tarjeta,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORES.linea,
    ...sombraSuave,
  },
  formTitulo: { fontSize: 20, fontWeight: "800", color: COLORES.tinta, marginBottom: 4 },
  etiqueta: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORES.tintaSuave,
    marginTop: 14,
    marginBottom: 6,
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

  // Confirmación de eliminación
  confirmFondo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(18, 48, 47, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 100,
  },
  confirmCaja: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: COLORES.tarjeta,
    borderRadius: 22,
    padding: 22,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  confirmTitulo: { fontSize: 20, fontWeight: "800", color: COLORES.tinta, marginBottom: 8 },
  confirmTexto: { fontSize: 15, color: COLORES.tintaSuave, lineHeight: 22 },

  guardandoFondo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(243, 247, 245, 0.6)",
    zIndex: 90,
  },
});