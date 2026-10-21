#include <WiFi.h>
#include <WiFiMulti.h>
#include <PubSubClient.h>

WiFiMulti wifiMulti;

// ==========================================
// 1. CONFIGURACIÓN DE REDES WI-FI (CASA Y CELULAR)
// ==========================================
void cargarRedesWiFi() {
  wifiMulti.addAP("WifiDeTuCasa", "Contrasenia");
  wifiMulti.addAP("WifiDeTuCelular", "Contrasenia");
}

// ==========================================
// 2. CONFIGURACIÓN MQTT Y TÓPICOS (PB-07, PB-18, PB-21)
// ==========================================
const char* mqtt_server = "mqtt.riego.pipexapp.com";
const int mqtt_port = 1883;
const char* mqtt_user = "esp32";
const char* mqtt_pass = "esp32device";

// Estructura completa de Tópicos (Sprints 2, 3 y 4)
const char* topic_moisture      = "home/garden/moisture";         // Publica humedad (PB-06)
const char* topic_pump_cmd      = "home/garden/pump/command";     // Escucha ON/OFF manual (PB-12, PB-14)
const char* topic_pump_status   = "home/garden/pump/status";      // Publica estado bomba ON/OFF (PB-13)
const char* topic_device_status = "home/garden/status";           // Estado ONLINE/OFFLINE + Heartbeat (PB-18)
const char* topic_threshold_cfg = "home/garden/config/threshold"; // Recibe nuevo umbral desde la App (PB-21)

// ==========================================
// 3. PINES Y PARÁMETROS DE RIEGO (PB-13, PB-19, PB-20)
// ==========================================
const int PIN_SENSOR_HUMEDAD = 34; // Cable Amarillo (AO del sensor)
const int PIN_RELE = 26;           // Cable Rojo (IN1 del relé)
const int PIN_LED_PRUEBA = 2;      // LED azul interno del ESP32

bool MODO_SIMULACION_SENSOR = false; 

const int VALOR_AIRE_SECO = 4095;   
const int VALOR_AGUA_MOJADO = 1300; 

// Variables para Riego Automático (Sprint 4: PB-19, PB-20, PB-21)
int umbralHumedad = 30;            // Umbral por defecto (30%): si baja de 30% riega, si sube se apaga
bool modoAutomaticoActivo = true;  // true = evalúa umbral automáticamente en el ESP32
bool bombaEncendida = false;
bool controlManualActivo = false;  // Evita que el modo automático apague la bomba si el usuario la prendió manual

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastMsg = 0;
const long interval = 5000; 

// ==========================================
// FUNCIÓN PARA ACTIVAR/DESACTIVAR RELÉ Y BOMBA (PB-13)
// ==========================================
void controlarBomba(bool encender) {
  if (bombaEncendida == encender) return; // Evita repetir el clic si ya está en ese estado
  bombaEncendida = encender;

  if (encender) {
    digitalWrite(PIN_LED_PRUEBA, HIGH);
    pinMode(PIN_RELE, OUTPUT);
    digitalWrite(PIN_RELE, LOW); // Activa relé y enciende bomba
    client.publish(topic_pump_status, "ON", true);
    Serial.println(">>> [ACTUADOR] Relé ACTIVADO (Bomba ENCENDIDA) <<<");
  } else {
    digitalWrite(PIN_LED_PRUEBA, LOW);
    pinMode(PIN_RELE, INPUT);    // Desactiva relé y apaga bomba
    client.publish(topic_pump_status, "OFF", true);
    Serial.println(">>> [ACTUADOR] Relé DESACTIVADO (Bomba APAGADA) <<<");
  }
}

// ==========================================
// CALLBACK: RECIBIR COMANDOS Y UMBRAL MQTT (PB-12 y PB-21)
// ==========================================
void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  message.trim();

  Serial.print("Mensaje recibido en [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(message);

  // 1. Comando de encendido/apagado de bomba (PB-12 / PB-14)
  if (String(topic) == topic_pump_cmd) {
    if (message.equalsIgnoreCase("ON") || message == "1") {
      controlManualActivo = true;
      controlarBomba(true);
    } else if (message.equalsIgnoreCase("OFF") || message == "0") {
      controlManualActivo = false;
      controlarBomba(false);
    } else if (message.equalsIgnoreCase("AUTO")) {
      controlManualActivo = false;
      Serial.println("Modo automático reactivado.");
    }
  }

  // 2. Configuración de nuevo umbral desde la App (PB-21 - Sprint 4)
  if (String(topic) == topic_threshold_cfg) {
    int nuevoUmbral = message.toInt();
    if (nuevoUmbral > 0 && nuevoUmbral <= 100) {
      umbralHumedad = nuevoUmbral;
      Serial.print(">>> [CONFIG PB-21] Nuevo umbral de humedad guardado: ");
      Serial.print(umbralHumedad);
      Serial.println("% <<<");
    }
  }
}

int obtenerPorcentajeHumedad() {
  if (MODO_SIMULACION_SENSOR) {
    return random(30, 81);
  } else {
    int lecturaCruda = analogRead(PIN_SENSOR_HUMEDAD);
    int porcentaje = map(lecturaCruda, VALOR_AIRE_SECO, VALOR_AGUA_MOJADO, 0, 100);
    porcentaje = constrain(porcentaje, 0, 100);

    Serial.print("[SENSOR] ADC: ");
    Serial.print(lecturaCruda);
    Serial.print(" | Humedad: ");
    Serial.print(porcentaje);
    Serial.print("% (Umbral: ");
    Serial.print(umbralHumedad);
    Serial.println("%)");

    return porcentaje;
  }
}

void setup_wifi() {
  delay(10);
  WiFi.mode(WIFI_STA);
  cargarRedesWiFi();

  Serial.println("\nBuscando red WiFi disponible...");
  while (wifiMulti.run() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n¡WiFi conectado!");
  Serial.print("Red: ");
  Serial.println(WiFi.SSID());
}

// ==========================================
// CONEXIÓN MQTT CON LAST WILL (PB-18 - SPRINT 3)
// ==========================================
void reconnect() {
  while (!client.connected()) {
    if (wifiMulti.run() != WL_CONNECTED) {
      delay(1000);
      continue;
    }

    Serial.print("Conectando al Broker MQTT...");
    String clientId = "ESP32-Riego-G25";

    // Last Will (PB-18): Si el ESP32 pierde corriente, el broker avisa que está OFFLINE
    const char* willPayload = "{\"deviceId\":\"esp32-01\",\"status\":\"OFFLINE\"}";

    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass, topic_device_status, 1, true, willPayload)) {
      Serial.println("¡Conectado!");
      
      // Publicar estado ONLINE al conectar (PB-18)
      client.publish(topic_device_status, "{\"deviceId\":\"esp32-01\",\"status\":\"ONLINE\"}", true);

      // Suscribirse a comandos de bomba (PB-12) y cambio de umbral (PB-21)
      client.subscribe(topic_pump_cmd);
      client.subscribe(topic_threshold_cfg);
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
  digitalWrite(PIN_LED_PRUEBA, LOW);
  pinMode(PIN_RELE, INPUT); // Inicia apagado

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
    
    // 1. Leer humedad (PB-06)
    int humedad = obtenerPorcentajeHumedad();

    // 2. Lógica de Riego Automático por Umbral (Sprint 4: PB-19 y PB-20)
    if (modoAutomaticoActivo && !controlManualActivo) {
      if (humedad < umbralHumedad && !bombaEncendida) {
        Serial.println("[AUTO PB-19] Humedad debajo del umbral -> Iniciando riego automático");
        controlarBomba(true);
      } else if (humedad >= umbralHumedad && bombaEncendida) {
        Serial.println("[AUTO PB-20] Humedad alcanzó el umbral -> Apagando bomba automáticamente");
        controlarBomba(false);
      }
    }

    // 3. Publicar humedad y umbral actual por MQTT (PB-06)
    String payloadMoisture = "{\"deviceId\":\"esp32-01\",\"moisture\":" + String(humedad) + ",\"threshold\":" + String(umbralHumedad) + "}";
    client.publish(topic_moisture, payloadMoisture.c_str());

    // 4. Publicar Heartbeat de estado ONLINE (PB-18 - Sprint 3)
    client.publish(topic_device_status, "{\"deviceId\":\"esp32-01\",\"status\":\"ONLINE\"}", true);
  }
}