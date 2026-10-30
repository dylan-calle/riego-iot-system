import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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
  fondo: "#F1F5F2",
  tinta: "#12302F",
  tintaSuave: "#5C706E",
  agua: "#1FA7B5",
  alerta: "#C2571A",
  alertaClara: "#FBEBDD",
  bien: "#2E9E4F",
  linea: "#D5DFDB",
  blanco: "#FFFFFF",
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
    const mensaje = Array.isArray(datos.message)
      ? datos.message.join("\n")
      : datos.message;
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
      style={[
        styles.chip,
        activo && styles.chipActivo,
        deshabilitado && styles.deshabilitado,
      ]}
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
  const [confirmacion, setConfirmacion] = useState<{
    texto: string;
    onOk: () => void;
  } | null>(null);

  // Formulario de usuario
  const [fNombre, setFNombre] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fRolId, setFRolId] = useState<number | null>(null);

  // Formulario de rol
  const [rNombre, setRNombre] = useState("");
  const [rDescripcion, setRDescripcion] = useState("");
  const [rPermisos, setRPermisos] = useState<string[]>([]);

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
      void cargar();
    }
  }, [visible, sinAcceso, cargar]);

  /** Ejecuta una acción de escritura, muestra errores y recarga la lista */
  const ejecutar = async (accion: () => Promise<unknown>) => {
    setGuardando(true);
    setError("");
    try {
      await accion();
      setVista({ tipo: "lista" });
      await cargar();
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

    void ejecutar(async () => {
      if (editando) {
        // 1) Cambio de rol: usa PUT /users/:id/role (ruta que el servidor ya tenía)
        if (fRolId !== null && fRolId !== editando.roleId) {
          await llamar(apiBase, token, `/users/${editando.id}/role`, "PUT", { roleId: fRolId });
        }
        // 2) Nombre, correo o contraseña: solo si cambiaron
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
    });
  };

  const pedirEliminarUsuario = (u: UsuarioAdmin) =>
    setConfirmacion({
      texto: `¿Eliminar al usuario ${u.email}? Esta acción no se puede deshacer.`,
      onOk: () => void ejecutar(() => llamar(apiBase, token, `/users/${u.id}`, "DELETE")),
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
    void ejecutar(() =>
      editando
        ? llamar(apiBase, token, `/roles/${editando.id}`, "PUT", cuerpo)
        : llamar(apiBase, token, "/roles", "POST", cuerpo),
    );
  };

  const pedirEliminarRol = (r: RolAdmin) =>
    setConfirmacion({
      texto: `¿Eliminar el rol ${r.name}? Los usuarios que lo tengan quedarán sin rol.`,
      onOk: () => void ejecutar(() => llamar(apiBase, token, `/roles/${r.id}`, "DELETE")),
    });

  // ---------- Render ----------
  const renderLista = () => (
    <>
      <View style={styles.pestanas}>
        {puedeVerUsuarios ? (
          <Chip texto="Usuarios" activo={pestana === "usuarios"} onPress={() => setPestana("usuarios")} />
        ) : null}
        {puedeVerRoles ? (
          <Chip texto="Roles" activo={pestana === "roles"} onPress={() => setPestana("roles")} />
        ) : null}
      </View>

      {pestana === "usuarios" && puedeVerUsuarios ? (
        <>
          {puedeGestionarUsuarios ? (
            <Pressable style={styles.botonPrimario} onPress={() => abrirUsuario(null)}>
              <Text style={styles.botonPrimarioTexto}>+ Nuevo usuario</Text>
            </Pressable>
          ) : null}
          {usuarios.map((u) => {
            const esYo = u.id === usuario.id;
            const bloqueado = u.role === "ADMIN" && !esAdmin; // un no-admin no toca a un ADMIN
            return (
              <View key={u.id} style={styles.tarjeta}>
                <View style={styles.tarjetaFila}>
                  <View style={styles.tarjetaTextos}>
                    <Text style={styles.tarjetaTitulo}>
                      {u.name ?? u.email}
                      {esYo ? "  (tú)" : ""}
                    </Text>
                    <Text style={styles.tarjetaSub}>{u.email}</Text>
                  </View>
                  <View style={styles.rolBadge}>
                    <Text style={styles.rolBadgeTexto}>{u.role}</Text>
                  </View>
                </View>
                {puedeGestionarUsuarios && !bloqueado ? (
                  <View style={styles.acciones}>
                    <Pressable style={styles.botonSecundario} onPress={() => abrirUsuario(u)}>
                      <Text style={styles.botonSecundarioTexto}>Editar</Text>
                    </Pressable>
                    {!esYo ? (
                      <Pressable style={styles.botonPeligro} onPress={() => pedirEliminarUsuario(u)}>
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
            <Pressable style={styles.botonPrimario} onPress={() => abrirRol(null)}>
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
              <Text style={styles.permisosTexto}>
                {r.name === "ADMIN"
                  ? "Acceso total al sistema"
                  : r.permissions.length > 0
                    ? r.permissions.map((p) => ETIQUETAS_PERMISOS[p] ?? p).join(" · ")
                    : "Sin permisos"}
              </Text>
              {puedeGestionarRoles && r.name !== "ADMIN" ? (
                <View style={styles.acciones}>
                  <Pressable style={styles.botonSecundario} onPress={() => abrirRol(r)}>
                    <Text style={styles.botonSecundarioTexto}>Editar</Text>
                  </Pressable>
                  <Pressable style={styles.botonPeligro} onPress={() => pedirEliminarRol(r)}>
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

  const renderFormUsuario = () => {
    if (vista.tipo !== "usuario") return null;
    const editando = vista.editando;
    // Un no-admin no puede ofrecer el rol ADMIN
    const rolesDisponibles = roles.filter((r) => esAdmin || r.name !== "ADMIN");
    return (
      <>
        <Text style={styles.formTitulo}>{editando ? "Editar usuario" : "Nuevo usuario"}</Text>

        <Text style={styles.etiqueta}>Nombre</Text>
        <TextInput style={styles.input} value={fNombre} onChangeText={setFNombre} placeholder="Nombre" />

        <Text style={styles.etiqueta}>Correo</Text>
        <TextInput
          style={styles.input}
          value={fEmail}
          onChangeText={setFEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="correo@ejemplo.com"
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
      </>
    );
  };

  const renderFormRol = () => {
    if (vista.tipo !== "rol") return null;
    const editando = vista.editando;
    return (
      <>
        <Text style={styles.formTitulo}>{editando ? "Editar rol" : "Nuevo rol"}</Text>

        <Text style={styles.etiqueta}>Nombre</Text>
        <TextInput
          style={styles.input}
          value={rNombre}
          onChangeText={setRNombre}
          autoCapitalize="characters"
          placeholder="EJ: TECNICO"
        />

        <Text style={styles.etiqueta}>Descripción</Text>
        <TextInput
          style={styles.input}
          value={rDescripcion}
          onChangeText={setRDescripcion}
          placeholder="Para qué sirve este rol"
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
      </>
    );
  };

  const renderBotonesForm = (onGuardar: () => void) => (
    <>
      {error ? <Text style={[styles.errorTexto, styles.errorForm]}>{error}</Text> : null}
    <View style={styles.acciones}>
      <Pressable
        style={[styles.botonPrimario, styles.botonFlex, guardando && styles.deshabilitado]}
        disabled={guardando}
        onPress={onGuardar}
      >
        {guardando ? (
          <ActivityIndicator color={COLORES.blanco} />
        ) : (
          <Text style={styles.botonPrimarioTexto}>Guardar</Text>
        )}
      </Pressable>
      <Pressable
        style={[styles.botonSecundario, styles.botonFlex]}
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.pantalla}>
        <View style={styles.cabecera}>
          <Text style={styles.titulo}>Administración</Text>
          <Pressable onPress={onClose} style={styles.botonSecundario}>
            <Text style={styles.botonSecundarioTexto}>Cerrar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.contenido} keyboardShouldPersistTaps="handled">
          {error ? (
            <View style={styles.errorCaja}>
              <Text style={styles.errorTexto}>{error}</Text>
            </View>
          ) : null}

          {confirmacion ? (
            <View style={styles.errorCaja}>
              <Text style={styles.errorTexto}>{confirmacion.texto}</Text>
              <View style={styles.acciones}>
                <Pressable
                  style={styles.botonPeligro}
                  onPress={() => {
                    const ok = confirmacion.onOk;
                    setConfirmacion(null);
                    ok();
                  }}
                >
                  <Text style={styles.botonPeligroTexto}>Sí, eliminar</Text>
                </Pressable>
                <Pressable style={styles.botonSecundario} onPress={() => setConfirmacion(null)}>
                  <Text style={styles.botonSecundarioTexto}>Cancelar</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {sinAcceso ? (
            <Text style={styles.vacio}>Tu cuenta no tiene permisos de administración.</Text>
          ) : cargando && vista.tipo === "lista" ? (
            <ActivityIndicator size="large" color={COLORES.agua} style={styles.cargando} />
          ) : vista.tipo === "lista" ? (
            renderLista()
          ) : vista.tipo === "usuario" ? (
            renderFormUsuario()
          ) : (
            renderFormRol()
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.fondo },
  cabecera: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  titulo: { fontSize: 26, fontWeight: "800", color: COLORES.tinta },
  contenido: { paddingHorizontal: 20, paddingBottom: 48 },
  cargando: { marginTop: 40 },
  vacio: { color: COLORES.tintaSuave, fontSize: 14, marginTop: 12 },

  pestanas: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: COLORES.blanco,
    borderWidth: 1,
    borderColor: COLORES.linea,
  },
  chipActivo: { backgroundColor: COLORES.tinta, borderColor: COLORES.tinta },
  chipTexto: { color: COLORES.tinta, fontSize: 13, fontWeight: "600" },
  chipTextoActivo: { color: COLORES.fondo },

  tarjeta: {
    backgroundColor: COLORES.blanco,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORES.linea,
  },
  tarjetaFila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tarjetaTextos: { flex: 1, marginRight: 8 },
  tarjetaTitulo: { fontSize: 16, fontWeight: "700", color: COLORES.tinta },
  tarjetaSub: { fontSize: 13, color: COLORES.tintaSuave, marginTop: 2 },
  permisosTexto: { fontSize: 12, color: COLORES.tintaSuave, marginTop: 8, lineHeight: 18 },
  rolBadge: {
    backgroundColor: COLORES.tinta,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  rolBadgeTexto: { color: COLORES.fondo, fontSize: 11, fontWeight: "800" },

  acciones: { flexDirection: "row", gap: 8, marginTop: 12 },
  botonFlex: { flex: 1 },
  botonPrimario: {
    backgroundColor: COLORES.agua,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  botonPrimarioTexto: { color: COLORES.blanco, fontWeight: "800", fontSize: 15 },
  botonSecundario: {
    backgroundColor: "#E2ECE9",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  botonSecundarioTexto: { color: COLORES.tinta, fontWeight: "700", fontSize: 14 },
  botonPeligro: {
    backgroundColor: COLORES.alertaClara,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  botonPeligroTexto: { color: COLORES.alerta, fontWeight: "700", fontSize: 14 },
  deshabilitado: { opacity: 0.5 },

  errorCaja: {
    backgroundColor: COLORES.alertaClara,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorTexto: { color: COLORES.alerta, fontSize: 14, fontWeight: "600" },
  errorForm: { marginTop: 16 },

  formTitulo: { fontSize: 20, fontWeight: "800", color: COLORES.tinta, marginBottom: 8 },
  etiqueta: { fontSize: 13, fontWeight: "700", color: COLORES.tintaSuave, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: COLORES.blanco,
    borderWidth: 1,
    borderColor: COLORES.linea,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORES.tinta,
  },
});