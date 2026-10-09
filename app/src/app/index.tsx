import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

const API_URL = "https://api.riego.pipexapp.com";

export default function App() {
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const obtenerMensaje = async () => {
      try {
        const respuesta = await fetch(API_URL, { method: "GET" });
        if (!respuesta.ok) {
          throw new Error("Error HTTP " + respuesta.status);
        }
        const texto = await respuesta.text();
        setMensaje(texto);
      } catch (e) {
        setError(e.message || "No se pudo conectar con el servidor");
      } finally {
        setCargando(false);
      }
    };

    obtenerMensaje();
  }, []);

  return (
    <View style={styles.container}>
      {cargando ? (
        <ActivityIndicator size="large" />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <Text style={styles.texto}>{mensaje}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  texto: { fontSize: 32, fontWeight: "bold" },
  error: { fontSize: 18, color: "red", textAlign: "center", padding: 20 },
});