#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiMulti.h>
#include <PubSubClient.h>

WiFiMulti wifiMulti;

// ==========================================
// 1. CONFIGURACIÓN DE REDES WI-FI
// ==========================================
void cargarRedesWiFi() {
  wifiMulti.addAP("WifiDeTuCasa", "Contrasenia");
  wifiMulti.addAP("WifiDeTuCelu", "Contrasenia");
}

// ==========================================
// 2. CONFIGURACIÓN MQTT Y TÓPICOS (Sprints 2, 3 y 4)
// ==========================================
const char* mqtt_server = "mqtt.riego.pipexapp.com";
const int mqtt_port = 8883;
const char* mqtt_user = "esp32";
const char* mqtt_pass = "esp32device";

const char* topic_moisture      = "home/garden/moisture";         // PB-06: Humedad y umbral[cite: 2]
const char* topic_pump_cmd      = "home/garden/pump/command";     // PB-12 / PB-14: Comando ON/OFF/AUTO[cite: 2]
const char* topic_pump_status   = "home/garden/pump/status";      // PB-13: Estado de la bomba[cite: 2]
const char* topic_device_status = "home/garden/status";           // PB-18: Estado general ONLINE/OFFLINE
const char* topic_diagnostics   = "home/garden/diagnostics";      // PB-18 (Docente): Diagnóstico en vivo del circuito
const char* topic_threshold_cfg = "home/garden/config/threshold"; // PB-21: Cambiar umbral desde la App

// ==========================================
// 3. PINES DEL CIRCUITO Y DE DIAGNÓSTICO
// ==========================================
const int PIN_SENSOR_HUMEDAD = 34; // Cable Amarillo -> AO del sensor
const int PIN_RELE           = 26; // Cable Rojo -> IN1 del relé
const int PIN_LED_PRUEBA     = 2;  // LED azul interno del ESP32[cite: 2]

// Pines de Diagnóstico Físico (PB-18 Docente)
const int PIN_DIAG_RELE      = 35; // Conectado a IN2 del módulo relé
const int PIN_DIAG_BATERIA   = 32; // Conectado al divisor de 10k + 10k de las pilas (Columna 10)
const int PIN_DIAG_BOMBA     = 33; // Conectado a la resistencia Shunt de 1 ohm de la bomba

const int VALOR_AIRE_SECO   = 4095;   
const int VALOR_AGUA_MOJADO = 1300; 

// Variables de Riego Automático (Sprint 4: PB-19, PB-20, PB-21)
int umbralHumedadMin = 30;         // PB-19: Activa bomba si humedad < 30%
int umbralHumedadMax = 65;         // PB-20: Apaga bomba cuando humedad >= 65%
bool modoAutomaticoActivo = true;  
bool bombaEncendida = false;
bool controlManualActivo = false;

unsigned long tiempoEncendidoBomba = 0;
const unsigned long TIEMPO_MAX_RIEGO_MS = 30000; // 30s máximo continuo por seguridad

WiFiClientSecure espClient;
PubSubClient client(espClient);

unsigned long lastMsg = 0;
const long interval = 3000; // Reporta cada 3 segundos para ver cambios en tiempo real

// ==========================================
// ACTIVAR / DESACTIVAR RELÉ Y BOMBA (PB-13)
// ==========================================
void controlarBomba(bool encender) {
  if (bombaEncendida == encender) return;
  bombaEncendida = encender;

  if (encender) {
    tiempoEncendidoBomba = millis();
    digitalWrite(PIN_LED_PRUEBA, HIGH);
    pinMode(PIN_RELE, OUTPUT);
    digitalWrite(PIN_RELE, LOW); // Activa relé
    client.publish(topic_pump_status, "ON", true);
    Serial.println(">>> [ACTUADOR] Relé ACTIVADO (Bomba ENCENDIDA) <<<");
  } else {
    digitalWrite(PIN_LED_PRUEBA, LOW);
    pinMode(PIN_RELE, INPUT);    // Desactiva relé
    client.publish(topic_pump_status, "OFF", true);
    Serial.println(">>> [ACTUADOR] Relé DESACTIVADO (Bomba APAGADA) <<<");
  }
}

// ==========================================
// RADIOGRAFÍA DEL CIRCUITO EN TIEMPO REAL (PB-18 DOCENTE)
// ==========================================
void publicarDiagnosticoCircuito(int adcSensor, int humedadPct) {
  // 1. Sensor de Humedad (Pin 34)
  bool sensorConectado = (adcSensor >= 150);
  bool sondaEnTierra   = (adcSensor < 3950 && sensorConectado);
  String estadoSensor  = !sensorConectado ? "DESCONECTADO" : (sondaEnTierra ? "OK_EN_TIERRA" : "CONECTADO_EN_AIRE");

  // 2. Módulo Relé (Pin 35 conectado a IN2)
  int adcRele = analogRead(PIN_DIAG_RELE);
  bool releConectado = (adcRele > 400); // Si el relé tiene VCC y GND, IN2 entrega voltaje al pin 35
  String estadoRele  = !releConectado ? "DESCONECTADO" : (bombaEncendida ? "ACTIVO_CERRADO" : "OK_EN_ESPERA");

  // 3. Porta Pilas / Batería (Pin 32 con divisor 10k/10k calibrado para pilas de 1.5V)
  int adcBateria = analogRead(PIN_DIAG_BATERIA);
  bool bateriaConectada = (adcBateria > 150); // Detecta desde 1.0V hasta 6.0V. Si sacas una pila cae a 0.
  int nivelBateriaPct   = bateriaConectada ? constrain(map(adcBateria, 400, 3400, 20, 100), 0, 100) : 0;
  String estadoBateria  = bateriaConectada ? "CONECTADA_OK" : "DESCONECTADA_O_SIN_PILAS";

  // 4. Bomba de Agua (Pin 33 en resistencia Shunt de 1 ohm)
  int adcBomba = analogRead(PIN_DIAG_BOMBA);
  bool bombaConectada = true;
  String estadoBomba  = "EN_ESPERA";

  if (!releConectado || !bateriaConectada) {
    bombaConectada = false;
    estadoBomba = "SIN_ENERGIA_PREVIA";
  } else if (bombaEncendida) {
    // Cuando la bomba gira, pasa corriente por la resistencia de 1 ohm y sube la lectura en G33
    if (adcBomba > 25) {
      bombaConectada = true;
      estadoBomba = "BOMBEANDO_OK";
    } else {
      bombaConectada = false;
      estadoBomba = "CABLE_BOMBA_SUELTO";
    }
  }

  // 5. Estado general del cableado en el Protoboard
  bool cablesOk = (sensorConectado && releConectado && bateriaConectada && bombaConectada);

  // Construir JSON de diagnóstico para el Frontend
  String jsonDiag = "{";
  jsonDiag += "\"deviceId\":\"esp32-01\",";
  jsonDiag += "\"generalStatus\":\"" + String(cablesOk ? "ALL_OK" : "FALLO_DETECTADO") + "\",";
  jsonDiag += "\"mode\":\"" + String(controlManualActivo ? "MANUAL" : "AUTO") + "\",";
  jsonDiag += "\"thresholdMin\":" + String(umbralHumedadMin) + ",";
  jsonDiag += "\"thresholdMax\":" + String(umbralHumedadMax) + ",";
  jsonDiag += "\"components\":{";
  jsonDiag +=   "\"esp32\":{\"ok\":true,\"status\":\"ONLINE\",\"wifi\":\"" + WiFi.SSID() + "\",\"rssi\":" + String(WiFi.RSSI()) + "},";
  jsonDiag +=   "\"sensor\":{\"ok\":" + String(sensorConectado ? "true" : "false") + ",\"status\":\"" + estadoSensor + "\",\"adc\":" + String(adcSensor) + ",\"moisture\":" + String(humedadPct) + "},";
  jsonDiag +=   "\"relay\":{\"ok\":" + String(releConectado ? "true" : "false") + ",\"status\":\"" + estadoRele + "\",\"adc\":" + String(adcRele) + ",\"active\":" + String(bombaEncendida ? "true" : "false") + "},";
  jsonDiag +=   "\"battery\":{\"ok\":" + String(bateriaConectada ? "true" : "false") + ",\"status\":\"" + estadoBateria + "\",\"adc\":" + String(adcBateria) + ",\"level\":" + String(nivelBateriaPct) + "},";
  jsonDiag +=   "\"pump\":{\"ok\":" + String(bombaConectada ? "true" : "false") + ",\"status\":\"" + estadoBomba + "\",\"adc\":" + String(adcBomba) + ",\"running\":" + String(bombaEncendida ? "true" : "false") + "},";
  jsonDiag +=   "\"wiring\":{\"ok\":" + String(cablesOk ? "true" : "false") + ",\"status\":\"" + String(cablesOk ? "CIRCUITO_COMPLETO" : "COMPONENTE_DESCONECTADO") + "\"}";
  jsonDiag += "}";
  jsonDiag += "}";

  client.publish(topic_diagnostics, jsonDiag.c_str(), true);
  Serial.print("[DIAG] ");
  Serial.println(jsonDiag);
}

// ==========================================
// CALLBACK: COMANDOS Y UMBRAL MQTT (PB-12, PB-14 y PB-21)
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

  if (String(topic) == topic_pump_cmd) {
    if (message.equalsIgnoreCase("ON") || message == "1") {
      controlManualActivo = true;
      controlarBomba(true);
    } else if (message.equalsIgnoreCase("OFF") || message == "0") {
      controlManualActivo = false;
      controlarBomba(false);
    } else if (message.equalsIgnoreCase("AUTO")) {
      controlManualActivo = false;
      Serial.println(">>> Modo automático reactivado <<<");
    }
  }

  // PB-21: Modificar y guardar umbral desde la App
  if (String(topic) == topic_threshold_cfg) {
    int nuevoUmbral = message.toInt();
    if (nuevoUmbral >= 5 && nuevoUmbral <= 95) {
      umbralHumedadMin = nuevoUmbral;
      umbralHumedadMax = constrain(nuevoUmbral + 15, 10, 100);
      Serial.print(">>> [PB-21] Nuevo umbral actualizado: ");
      Serial.print(umbralHumedadMin);
      Serial.println("% <<<");
    }
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

void reconnect() {
  while (!client.connected()) {
    if (wifiMulti.run() != WL_CONNECTED) {
      delay(1000);
      continue;
    }
    Serial.print("Conectando al Broker MQTT...");
    String clientId = "ESP32-Riego-G25";
    const char* willPayload = "{\"deviceId\":\"esp32-01\",\"generalStatus\":\"OFFLINE\",\"components\":{\"esp32\":{\"ok\":false,\"status\":\"OFFLINE\"}}}";

    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass, topic_diagnostics, 1, true, willPayload)) {
      Serial.println("¡Conectado!");
      client.publish(topic_device_status, "{\"deviceId\":\"esp32-01\",\"status\":\"ONLINE\"}", true);
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
  pinMode(PIN_RELE, INPUT);

  // Configurar resistencias PULLDOWN internas en los 4 pines de diagnóstico:
  // Si cualquier cable se desconecta, el pin cae a 0 inmediato sin ruido flotante.
  pinMode(PIN_SENSOR_HUMEDAD, INPUT_PULLDOWN);
  pinMode(PIN_DIAG_RELE, INPUT_PULLDOWN);
  pinMode(PIN_DIAG_BATERIA, INPUT_PULLDOWN);
  pinMode(PIN_DIAG_BOMBA, INPUT_PULLDOWN);

  // Buffer ampliado para que el JSON completo de diagnóstico se envíe sin cortarse
  client.setBufferSize(1024);

  setup_wifi();
  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  unsigned long now = millis();

  // Protección PB-20: Apagado de seguridad tras 30s continuos
  if (bombaEncendida && (now - tiempoEncendidoBomba >= TIEMPO_MAX_RIEGO_MS)) {
    Serial.println("[SEGURIDAD PB-20] Tiempo máximo continuo alcanzado (30s) -> Apagando bomba");
    controlManualActivo = false;
    controlarBomba(false);
  }

  if (now - lastMsg >= interval) {
    lastMsg = now;
    
    int adcSensor = analogRead(PIN_SENSOR_HUMEDAD);
    bool sensorConectado = (adcSensor >= 150);
    int humedad = sensorConectado ? constrain(map(adcSensor, VALOR_AIRE_SECO, VALOR_AGUA_MOJADO, 0, 100), 0, 100) : 0;

    // PB-19 y PB-20: Regla automática de riego y apagado automático
    if (modoAutomaticoActivo && !controlManualActivo && sensorConectado) {
      if (humedad < umbralHumedadMin && !bombaEncendida) {
        Serial.println("[AUTO PB-19] Humedad menor al umbral -> Activando riego automático");
        controlarBomba(true);
      } else if (humedad >= umbralHumedadMax && bombaEncendida) {
        Serial.println("[AUTO PB-20] Humedad óptima alcanzada -> Apagando bomba automáticamente");
        controlarBomba(false);
      }
    } else if (!sensorConectado && bombaEncendida && !controlManualActivo) {
      Serial.println("[ALERTA HARDWARE] Sensor desconectado -> Deteniendo riego por seguridad");
      controlarBomba(false);
    }

    String payloadMoisture = "{\"deviceId\":\"esp32-01\",\"moisture\":" + String(humedad) + ",\"threshold\":" + String(umbralHumedadMin) + "}";
    client.publish(topic_moisture, payloadMoisture.c_str());
    client.publish(topic_device_status, "{\"deviceId\":\"esp32-01\",\"status\":\"ONLINE\"}", true);

    publicarDiagnosticoCircuito(adcSensor, humedad);
  }
}