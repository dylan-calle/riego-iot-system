#include <WiFi.h>
#include <WiFiMulti.h>
#include <PubSubClient.h>

WiFiMulti wifiMulti;

// ==========================================
// 1. CONFIGURACIÓN DE REDES WI-FI (CASA Y CELULAR)
// ==========================================
void cargarRedesWiFi() {
  // Red 1: Wi-Fi de tu casa
  wifiMulti.addAP("WIFICASITA", "CONTRASEÑA");
  
  // Red 2: Zona Wi-Fi (Hotspot) de tu celular para el día de la defensa
  wifiMulti.addAP("WIFICELU", "CONTRASEÑA");
}

// ==========================================
// 2. CONFIGURACIÓN MQTT Y TÓPICOS (HU PB-07)
// ==========================================
const char* mqtt_server = "mqtt.riego.pipexapp.com";
const int mqtt_port = 1883;
const char* mqtt_user = "esp32";
const char* mqtt_pass = "esp32device";

const char* topic_moisture    = "home/garden/moisture";     // ESP32 publica humedad (PB-06)
const char* topic_pump_cmd    = "home/garden/pump/command"; // ESP32 escucha ON/OFF (PB-12)
const char* topic_pump_status = "home/garden/pump/status";  // ESP32 confirma estado del relé

// ==========================================
// 3. PINES DE HARDWARE (HU PB-06 y PB-13)
// ==========================================
const int PIN_SENSOR_HUMEDAD = 34; 
const int PIN_RELE = 26;           
const int PIN_LED_PRUEBA = 2;      

bool MODO_SIMULACION_SENSOR = true; // Cambiar a 'false' cuando conectes el sensor físico

const int VALOR_AIRE_SECO = 3200;  
const int VALOR_AGUA_MOJADO = 1400; 

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastMsg = 0;
const long interval = 5000; 

void controlarBomba(bool encender) {
  if (encender) {
    digitalWrite(PIN_LED_PRUEBA, HIGH); 
    digitalWrite(PIN_RELE, LOW);        
    client.publish(topic_pump_status, "ON");
    Serial.println(">>> [ACTUADOR] Relé ACTIVADO (Bomba ENCENDIDA) <<<");
  } else {
    digitalWrite(PIN_LED_PRUEBA, LOW);  
    digitalWrite(PIN_RELE, HIGH);       
    client.publish(topic_pump_status, "OFF");
    Serial.println(">>> [ACTUADOR] Relé DESACTIVADO (Bomba APAGADA) <<<");
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  message.trim();

  Serial.print("Mensaje recibido en topic [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(message);

  if (String(topic) == topic_pump_cmd) {
    if (message.equalsIgnoreCase("ON") || message == "1") {
      controlarBomba(true);
    } else if (message.equalsIgnoreCase("OFF") || message == "0") {
      controlarBomba(false);
    }
  }
}

int obtenerPorcentajeHumedad() {
  if (MODO_SIMULACION_SENSOR) {
    return random(30, 81);
  } else {
    int lecturaCruda = analogRead(PIN_SENSOR_HUMEDAD);
    int porcentaje = map(lecturaCruda, VALOR_AIRE_SECO, VALOR_AGUA_MOJADO, 0, 100);
    return constrain(porcentaje, 0, 100);
  }
}

void setup_wifi() {
  delay(10);
  WiFi.mode(WIFI_STA);
  cargarRedesWiFi();

  Serial.println("\nBuscando red WiFi disponible (Casa o Celular)...");
  while (wifiMulti.run() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n¡WiFi conectado!");
  Serial.print("Conectado a la red: ");
  Serial.println(WiFi.SSID());
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void reconnect() {
  while (!client.connected()) {
    // Si se cayó el WiFi, reconecta a cualquiera de las redes guardadas
    if (wifiMulti.run() != WL_CONNECTED) {
      Serial.println("Reconectando WiFi...");
      delay(1000);
      continue;
    }

    Serial.print("Conectando al Broker MQTT...");
    String clientId = "ESP32-Riego-G25-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("¡Conectado!");
      client.subscribe(topic_pump_cmd);
      Serial.print("Suscrito a: ");
      Serial.println(topic_pump_cmd);
    } else {
      Serial.print("Error rc=");
      Serial.print(client.state());
      Serial.println(" Reintentando en 5s...");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_PRUEBA, OUTPUT);
  pinMode(PIN_RELE, OUTPUT);
  
  digitalWrite(PIN_LED_PRUEBA, LOW);
  digitalWrite(PIN_RELE, HIGH);

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  unsigned long now = millis();
  if (now - lastMsg >= interval) {
    lastMsg = now;
    int humedad = obtenerPorcentajeHumedad();
    String payload = "{\"deviceId\":\"esp32-01\",\"moisture\":" + String(humedad) + "}";

    Serial.print("Publicando en [");
    Serial.print(topic_moisture);
    Serial.print("]: ");
    Serial.println(payload);

    client.publish(topic_moisture, payload.c_str());
  }
}