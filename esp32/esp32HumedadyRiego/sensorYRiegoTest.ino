#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiMulti.h>
#include <PubSubClient.h>

WiFiMulti wifiMulti;

void cargarRedesWiFi() {
  wifiMulti.addAP("ITA-B2-P6-D1", "Itauba2026P6D1Waos");
  wifiMulti.addAP("FabriWifi", "Fabri2004");
}

const char* mqtt_server = "mqtt.riego.pipexapp.com";
const int mqtt_port = 8883;
const char* mqtt_user = "esp32";
const char* mqtt_pass = "esp32device";

const char* topic_moisture      = "home/garden/moisture";
const char* topic_pump_cmd      = "home/garden/pump/command";
const char* topic_pump_status   = "home/garden/pump/status";
const char* topic_device_status = "home/garden/status";
const char* topic_diagnostics   = "home/garden/diagnostics";
const char* topic_threshold_cfg = "home/garden/config/threshold";

const int PIN_SENSOR_HUMEDAD = 34; 
const int PIN_RELE           = 26; 
const int PIN_LED_PRUEBA     = 2;  

const int PIN_DIAG_RELE      = 35; 
const int PIN_DIAG_BATERIA   = 32; 
const int PIN_DIAG_BOMBA     = 33; 

const int PIN_TRIG = 13; 
const int PIN_ECHO = 27; 

const float DISTANCIA_TANQUE_LLENO_CM = 3;  
const float DISTANCIA_TANQUE_VACIO_CM = 8.5; 

const int VALOR_AIRE_SECO   = 4095;   
const int VALOR_AGUA_MOJADO = 1300; 

int umbralHumedadMin = 30;         
int umbralHumedadMax = 65;         
bool modoAutomaticoActivo = true;  
bool bombaEncendida = false;
bool controlManualActivo = false;

int nivelAguaPct = 100;
bool hayAguaSuficiente = true;

unsigned long tiempoEncendidoBomba = 0;
const unsigned long TIEMPO_MAX_RIEGO_MS = 30000; 

WiFiClientSecure espClient;
PubSubClient client(espClient);

unsigned long lastMsg = 0;
const long interval = 3000; 

void medirNivelAgua() {
  long sumaDuracion = 0;
  int lecturasValidas = 0;

  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    long d = pulseIn(PIN_ECHO, HIGH, 30000); 
    if (d > 0) {
      sumaDuracion += d;
      lecturasValidas++;
    }
    delay(10); 
  }

  if (lecturasValidas == 0) {
      hayAguaSuficiente = false;
      nivelAguaPct = 0;
      return;
  }

  long duracionPromedio = sumaDuracion / lecturasValidas;
  float distanciaCm = duracionPromedio * 0.034 / 2;
  int distanciaInt = round(distanciaCm);

  int nivelBruto = map(distanciaInt, DISTANCIA_TANQUE_VACIO_CM, DISTANCIA_TANQUE_LLENO_CM, 0, 100);
  nivelAguaPct = constrain(nivelBruto, 0, 100); 
  hayAguaSuficiente = (nivelAguaPct > 10);
}

void controlarBomba(bool encender) {
  if (encender && !hayAguaSuficiente) {
      Serial.println("[BLOQUEO] Intento de encender bomba rechazado: Tanque sin agua (<10%).");
      return;
  }

  if (bombaEncendida == encender) return;
  bombaEncendida = encender;

  if (encender) {
    tiempoEncendidoBomba = millis();
    digitalWrite(PIN_LED_PRUEBA, HIGH);
    pinMode(PIN_RELE, OUTPUT);
    digitalWrite(PIN_RELE, LOW); 
    client.publish(topic_pump_status, "ON", true);
    Serial.println(">>> [ACTUADOR] Relé ACTIVADO (Bomba ENCENDIDA) <<<");
  } else {
    digitalWrite(PIN_LED_PRUEBA, LOW);
    pinMode(PIN_RELE, INPUT);    
    client.publish(topic_pump_status, "OFF", true);
    Serial.println(">>> [ACTUADOR] Relé DESACTIVADO (Bomba APAGADA) <<<");
  }
}

void publicarDiagnosticoCircuito(int adcSensor, int humedadPct) {
  bool sensorConectado = (adcSensor >= 150);
  bool sondaEnTierra   = (adcSensor < 3950 && sensorConectado);
  String estadoSensor  = !sensorConectado ? "DESCONECTADO" : (sondaEnTierra ? "OK_EN_TIERRA" : "CONECTADO_EN_AIRE");

  int adcRele = analogRead(PIN_DIAG_RELE);
  bool releConectado = (adcRele > 400);
  String estadoRele  = !releConectado ? "DESCONECTADO" : (bombaEncendida ? "ACTIVO_CERRADO" : "OK_EN_ESPERA");

  int adcBateria = analogRead(PIN_DIAG_BATERIA);
  bool bateriaConectada = (adcBateria > 150);
  int nivelBateriaPct   = bateriaConectada ? constrain(map(adcBateria, 400, 3400, 20, 100), 0, 100) : 0;
  String estadoBateria  = bateriaConectada ? "CONECTADA_OK" : "DESCONECTADA_O_SIN_PILAS";

  int adcBomba = analogRead(PIN_DIAG_BOMBA);
  bool bombaConectada = true;
  String estadoBomba  = "EN_ESPERA";

  if (!releConectado || !bateriaConectada) {
    bombaConectada = false;
    estadoBomba = "SIN_ENERGIA_PREVIA";
  } else if (!hayAguaSuficiente) {
    bombaConectada = true;
    estadoBomba = "BLOQUEADA_SIN_AGUA"; 
  } else if (bombaEncendida) {
    if (adcBomba > 25) {
      bombaConectada = true;
      estadoBomba = "BOMBEANDO_OK";
    } else {
      bombaConectada = false;
      estadoBomba = "CABLE_BOMBA_SUELTO";
    }
  }

  String estadoTanque = hayAguaSuficiente ? "NIVEL_OK" : "NIVEL_CRITICO_BAJO";
  bool cablesOk = (sensorConectado && releConectado && bateriaConectada && bombaConectada);

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
  jsonDiag +=   "\"waterTank\":{\"ok\":" + String(hayAguaSuficiente ? "true" : "false") + ",\"status\":\"" + estadoTanque + "\",\"level\":" + String(nivelAguaPct) + "},";
  jsonDiag +=   "\"wiring\":{\"ok\":" + String(cablesOk ? "true" : "false") + ",\"status\":\"" + String(cablesOk ? "CIRCUITO_COMPLETO" : "COMPONENTE_DESCONECTADO") + "\"}";
  jsonDiag += "}";
  jsonDiag += "}";

  client.publish(topic_diagnostics, jsonDiag.c_str(), true);
  Serial.print("[DIAG] ");
  Serial.println(jsonDiag);
}

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

  if (String(topic) == topic_threshold_cfg) {
    int nuevoUmbral = message.toInt();
    if (nuevoUmbral >= 5 && nuevoUmbral <= 95) {
      umbralHumedadMin = nuevoUmbral;
      umbralHumedadMax = constrain(nuevoUmbral + 15, 10, 100);
      Serial.print(">>> Nuevo umbral actualizado: ");
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

  pinMode(PIN_SENSOR_HUMEDAD, INPUT_PULLDOWN);
  pinMode(PIN_DIAG_RELE, INPUT_PULLDOWN);
  pinMode(PIN_DIAG_BATERIA, INPUT_PULLDOWN);
  pinMode(PIN_DIAG_BOMBA, INPUT_PULLDOWN);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

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

  if (bombaEncendida && (now - tiempoEncendidoBomba >= TIEMPO_MAX_RIEGO_MS)) {
    Serial.println("[SEGURIDAD PB-20] Tiempo máximo continuo alcanzado -> Apagando bomba");
    controlManualActivo = false;
    controlarBomba(false);
  }

  if (now - lastMsg >= interval) {
    lastMsg = now;
    
    medirNivelAgua();

    int adcSensor = analogRead(PIN_SENSOR_HUMEDAD);
    bool sensorConectado = (adcSensor >= 150);
    int humedad = sensorConectado ? constrain(map(adcSensor, VALOR_AIRE_SECO, VALOR_AGUA_MOJADO, 0, 100), 0, 100) : 0;

    if (bombaEncendida && !hayAguaSuficiente) {
        Serial.println("[EMERGENCIA] Tanque vacío detectado -> Apagando bomba");
        controlManualActivo = false;
        controlarBomba(false);
    } 
    else if (!sensorConectado && bombaEncendida && !controlManualActivo) {
        Serial.println("[ALERTA HARDWARE] Sensor humedad desconectado -> Deteniendo riego por seguridad");
        controlarBomba(false);
    }

    if (modoAutomaticoActivo && !controlManualActivo && sensorConectado) {
      if (humedad < umbralHumedadMin && !bombaEncendida && hayAguaSuficiente) {
        Serial.println("[AUTO PB-19] Humedad menor al umbral -> Activando riego automático");
        controlarBomba(true);
      } else if (humedad >= umbralHumedadMax && bombaEncendida) {
        Serial.println("[AUTO PB-20] Humedad óptima alcanzada -> Apagando bomba automáticamente");
        controlarBomba(false);
      }
    }

    String payloadMoisture = "{\"deviceId\":\"esp32-01\",\"moisture\":" + String(humedad) + ",\"threshold\":" + String(umbralHumedadMin) + "}";
    client.publish(topic_moisture, payloadMoisture.c_str());
    client.publish(topic_device_status, "{\"deviceId\":\"esp32-01\",\"status\":\"ONLINE\"}", true);

    publicarDiagnosticoCircuito(adcSensor, humedad);
  }
}