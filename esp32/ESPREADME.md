# Firmware ESP32 - Sistema de Riego Inteligente (Grupo 25)

Este directorio contiene el código fuente y la documentación técnica del microcontrolador **ESP32** para la adquisición de datos de humedad del suelo, comunicación mediante el protocolo **MQTT** y control del sistema de actuación (módulo relé y bomba sumergible).

---

## 📋 Historias de Usuario Implementadas

### Sprint 1
- **PB-01:** Configuración del microcontrolador ESP32, entorno de desarrollo (Arduino IDE), soporte multi-red Wi-Fi (`WiFiMulti`) y validación de conexión al broker MQTT en el VPS.

### Sprint 2
- **PB-06:** Lectura analógica del sensor de humedad del suelo, calibración a escala porcentual (`0%` a `100%`) y publicación periódica (cada 5 segundos) mediante MQTT.
- **PB-07:** Definición e implementación de la estructura oficial de tópicos MQTT para sensores, actuadores, estado y configuración.
- **PB-12:** Suscripción y recepción bidireccional de comandos MQTT (`ON`, `OFF`, `AUTO`) para la activación y desactivación remota de la bomba de riego.
- **PB-13:** Integración física y lógica del módulo Relé y la mini bomba sumergible de 5V DC con el ESP32 (incluyendo indicador visual en el LED interno `GPIO 2`).

### Sprint 3
- **PB-18:** Implementación del estado de conexión del dispositivo en tiempo real (`ONLINE` / `OFFLINE`) utilizando **MQTT Last Will and Testament (LWT)** y envío periódico de **Heartbeat** cada 5 segundos.

### Sprint 4 (Adelantado en Firmware)
- **PB-19:** Implementación de regla automática de riego (activación autónoma del relé y la bomba cuando la humedad medida es inferior al umbral configurado).
- **PB-20:** Implementación de apagado automático de la bomba al alcanzar o superar el umbral de humedad establecido, evitando el riego continuo innecesario.
- **PB-21:** Suscripción a tópico de configuración para modificar y actualizar dinámicamente el umbral de humedad (`threshold`) desde la aplicación móvil sin reprogramar el ESP32.

---

## 📡 Estructura de Tópicos MQTT (PB-07, PB-18, PB-21)

| Tópico | Dirección | Formato Payload | Retain | Descripción |
| :--- | :--- | :--- | :---: | :--- |
| `home/garden/moisture` | ESP32 $\rightarrow$ Broker | `{"deviceId":"esp32-01","moisture":45,"threshold":30}` | No | Lectura actual de humedad (%) y umbral activo enviada cada 5s (PB-06) |
| `home/garden/pump/command` | Broker $\rightarrow$ ESP32 | `ON` / `OFF` / `AUTO` | No | Comando para encender/apagar la bomba manualmente o volver a modo automático (PB-12, PB-14) |
| `home/garden/pump/status` | ESP32 $\rightarrow$ Broker | `ON` / `OFF` | Sí | Confirmación del estado actual del relé y la bomba de agua (PB-13) |
| `home/garden/status` | ESP32 $\rightarrow$ Broker | `{"deviceId":"esp32-01","status":"ONLINE"}` *(o `"OFFLINE"`)* | Sí | Heartbeat periódico y mensaje automático de desconexión vía MQTT Last Will (PB-18) |
| `home/garden/config/threshold` | Broker $\rightarrow$ ESP32 | `35` *(valor entero de 1 a 100)* | No | Actualiza el umbral mínimo de humedad (%) para el riego automático (PB-21) |

---

## 🔌 Esquema de Conexiones de Hardware (Pinout ESP32)

### 1. Sensor de Humedad del Suelo (Módulo Analógico)
| Pin del Sensor | Pin en el ESP32 | Descripción |
| :--- | :--- | :--- |
| `VCC` | `3V3` (3.3V) | Alimentación positiva del módulo sensor |
| `GND` | `GND` | Tierra común del circuito |
| `AO` (Analog Out) | `GPIO 34` (`G34`) | Entrada analógica ADC1 (12 bits: lecturas de `0` a `4095`) |

### 2. Módulo Relé (Canal 1 - `K1` / `IN1`)
| Pin del Relé | Pin en el ESP32 / Circuito | Descripción |
| :--- | :--- | :--- |
| `VCC` | `V5` (`VIN` 5V) | Alimentación de 5V para la bobina del relé (con jumper `JD-VCC` colocado) |
| `GND` | `GND` | Tierra común con el ESP32 |
| `IN1` | `GPIO 26` (`G26`) | Señal de control digital (Activo en bajo `LOW` / Conmutación `OUTPUT-INPUT`) |

### 3. Etapa de Potencia - Bomba de Agua Sumergible (5V DC)
| Conexión | Destino en Bornera del Relé (`K1`) | Descripción |
| :--- | :--- | :--- |
| Cable Positivo (`+`) Fuente Externa 5V | Bornera Central (`COM` - Tornillo 2) | Entrada de energía de 5V (Porta pilas) |
| Cable Positivo (`+`) Bomba de Agua | Bornera Normalmente Abierto (`NO` - Tornillo 3) | Salida conmutada que activa la bomba al cerrar el relé |
| Cable Negativo (`-`) Bomba de Agua | Unido al Negativo (`-`) de la Fuente Externa 5V | Retorno directo de la fuente externa (aislado del ESP32) |

---

## ⚙️ Requisitos para Compilación en Arduino IDE

1. **Gestor de tarjetas (Boards Manager):** `esp32 by Espressif Systems` (Placa seleccionada: `DOIT ESP32 DEVKIT V1` o `ESP32 Dev Module`).
2. **Librerías requeridas:**
   - `WiFi.h` y `WiFiMulti.h` (incluidas en el core de ESP32).
   - `PubSubClient` por *Nick O'Leary* (instalable desde el Library Manager de Arduino IDE).
3. **Velocidad del Monitor Serie:** `115200 baud`.