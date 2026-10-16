# Firmware ESP32 - Sistema de Riego Inteligente (Grupo 25)

## Historias de Usuario implementadas
- **PB-01:** Configuración de entorno ESP32 (Arduino IDE) y conexión Wi-Fi/MQTT.
- **PB-06:** Publicación periódica de humedad del suelo mediante MQTT.
- **PB-07:** Definición de estructura de tópicos MQTT.
- **PB-12:** Suscripción y recepción bidireccional de comandos `ON`/`OFF` para la bomba.
- **PB-13:** Control de salida digital para módulo Relé y actuador (probado inicialmente con indicador LED en GPIO 2).

## Estructura de Tópicos MQTT (PB-07)

| Tópico | Dirección | Formato Payload | Descripción |
| :--- | :--- | :--- | :--- |
| `home/garden/moisture` | ESP32 -> Broker | `{"deviceId":"esp32-01","moisture":45}` | Lectura de humedad (%) enviada cada 5s |
| `home/garden/pump/command` | Broker -> ESP32 | `ON` / `OFF` | Comando para encender o apagar el relé de la bomba |
| `home/garden/pump/status` | ESP32 -> Broker | `ON` / `OFF` | Confirmación del estado actual del relé |