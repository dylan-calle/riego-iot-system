#include <WiFi.h>
#include <PubSubClient.h>

// ==========================================
// 1. CONFIGURACIÓN DE TU RED WI-FI (Cambia esto)
// ==========================================
const char* ssid = "ITA-B2-P6-D1";         // Pon aquí el nombre de tu WiFi (Red 2.4GHz)
const char* password = "ITA%707%2P6-1";   // Pon aquí la contraseña de tu WiFi

// ==========================================
// 2. CONFIGURACIÓN DEL BROKER MQTT (Datos de tu compañero)
// ==========================================
const char* mqtt_server = "mqtt.riego.pipexapp.com";
const int mqtt_port = 1883;
const char* mqtt_user = "esp32";
const char* mqtt_pass = "esp32device";
const char* mqtt_topic = "test/message";

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastMsg = 0;
const long interval = 5000; // Intervalo de 5 segundos (5000 milisegundos)

// Función para conectar al Wi-Fi
void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Conectando a la red WiFi: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("¡WiFi conectado exitosamente!");
  Serial.print("Dirección IP asignada al ESP32: ");
  Serial.println(WiFi.localIP());
}

// Función para reconectar al Broker MQTT en caso de desconexión
void reconnect() {
  while (!client.connected()) {
    Serial.print("Intentando conexión MQTT con el VPS...");
    
    // Creamos un ID de cliente único para el ESP32
    String clientId = "ESP32Client-Grupo25-";
    clientId += String(random(0xffff), HEX);
    
    // Intentamos conectar usando el usuario y contraseña que te pasaron
    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("¡Conectado al Broker MQTT!");
    } else {
      Serial.print("Falló la conexión, código de error rc=");
      Serial.print(client.state());
      Serial.println(" -> Intentando de nuevo en 5 segundos...");
      delay(5000);
    }
  }
}

void setup() {
  // Iniciamos el monitor serie para ver los mensajes en la PC
  Serial.begin(115200);
  
  // Conectamos al WiFi y configuramos el servidor MQTT
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  // Si no está conectado al broker MQTT, se reconecta
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Enviar el mensaje cada 5 segundos sin bloquear el microcontrolador
  unsigned long now = millis();
  if (now - lastMsg >= interval) {
    lastMsg = now;
    
    // Mensaje que pide tu compañero (o puedes cambiarlo a "Hello from my ESP32")
    const char* payload = "Hello from my computer";
    
    Serial.print("Publicando en [");
    Serial.print(mqtt_topic);
    Serial.print("]: ");
    Serial.println(payload);
    
    // Equivalente a mosquitto_pub -t 'test/message' -m 'Hello from my computer'
    if (client.publish(mqtt_topic, payload)) {
      Serial.println("-> ¡Mensaje enviado al VPS con éxito!");
    } else {
      Serial.println("-> Error al enviar el mensaje.");
    }
  }
}