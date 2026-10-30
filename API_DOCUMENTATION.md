# 🌿 Smart Irrigation IoT System — API Documentation

This documentation details the REST API endpoints and data schemas designed for the **Smart Irrigation IoT System**. The API powers the React / React Native mobile application for monitoring real-time soil moisture, reviewing historical trends, viewing statistical charts, and remotely controlling the irrigation pump.

---

## 🌐 Base URLs

| Environment | Base URL | Notes |
| :--- | :--- | :--- |
| **Production** | `https://api.riego.pipexapp.com` | HTTPS enabled, public VPS deployment |
| **Local Development** | `http://localhost:3000` | Local NestJS server |

> [!NOTE]
> CORS is enabled for all origins (`*`), so no additional proxy configuration is needed for React or React Native (Expo) apps.

---

## 🏷️ System Constants & Soil Moisture Thresholds

The backend categorizes soil moisture percentage into four states:

| Range (%) | Soil Status | Meaning | Automatic Irrigation |
| :--- | :--- | :--- | :--- |
| **< 30%** | `CRITICAL_DRY` | Severe moisture deficit | **Triggers Pump ON** |
| **30% – 44%** | `DRY` | Low moisture level | Needs attention |
| **45% – 70%** | `OPTIMAL` | Healthy moisture level | Pump remains **OFF** |
| **> 70%** | `SATURATED` | Waterlogged / Overwatered | Pump remains **OFF** |

---

## 📑 Endpoints Overview

### 🔐 Authentication & Authorization
> Full implementation details for mobile app AI agents are available in [**`MOBILE_AUTH_INTEGRATION_GUIDE.md`**](file:///home/dylan-gnu/Proyects/_college/riego-iot-system/MOBILE_AUTH_INTEGRATION_GUIDE.md).

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/auth/login` | Log in with email and password to receive JWT | **Public** |
| `POST` | `/auth/register` | Register a new user (defaults to `VIEWER` role) | **Public** |
| `GET` | `/auth/me` | Fetch active user profile and up-to-date permissions | **Bearer JWT** |
| `GET` | `/auth/available-permissions` | List all available permissions in the system | **Public** |
| `GET` | `/roles` | List all system and custom roles with permissions | `roles:read` |
| `POST` | `/roles` | Create a custom role with permissions | `roles:manage` |
| `GET` | `/permissions` | List permission catalog | `permissions:read` |
| `GET` | `/users` | List users, their roles, and custom permissions | `users:read` |

### 🌿 Sensor & Irrigation Endpoints

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `GET` | [`/humidity/latest`](#1-get-humiditylatest) | Returns the most recent humidity reading and device status | `humidity:read` |
| `GET` | [`/humidity/stats`](#2-get-humiditystats) | Returns aggregated statistics, summary card metrics, and chart points | `humidity:read` |
| `GET` | [`/humidity/history`](#3-get-humidityhistory) | Returns paginated/filtered list of historical sensor readings | `humidity:read` |
| `POST` | [`/humidity`](#4-post-humidity) | Ingests a new sensor reading (ESP32 / HTTP / MQTT fallback) | `humidity:create` |
| `GET` | [`/irrigation/pump`](#5-get-irrigationpump) | Returns the current state of the irrigation pump (`ON` / `OFF`) | `pump:read` |
| `POST` | [`/irrigation/pump`](#6-post-irrigationpump) | Manually activates or deactivates the pump | `pump:control` |
| `PUT` / `POST` | [`/irrigation/threshold`](#7-put--post-irrigationthreshold) | Sets soil moisture threshold and notifies ESP32 via MQTT (`home/garden/config/threshold`) | `pump:control` |
| `GET` | [`/irrigation/status`](#8-get-irrigationstatus) | Returns node connectivity (ONLINE/OFFLINE, heartbeat) and current pump state | `pump:read` |
| `GET` | [`/`](#9-get-) | Health check endpoint | **Public** |

---

## 📡 Detailed Endpoint Specifications

### 1. `GET /humidity/latest`

Fetches the latest reading recorded for a specific device node (default: `esp32-01`).

#### Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `deviceCode` | `string` | No | `ESP32-DEFAULT` | Identifier of the ESP32 node (e.g. `esp32-01`) |

#### Example Request

```http
GET /humidity/latest?deviceCode=esp32-01 HTTP/1.1
Host: api.riego.pipexapp.com
```

```bash
curl -s "https://api.riego.pipexapp.com/humidity/latest?deviceCode=esp32-01"
```

#### Success Response (`200 OK`)

```json
{
  "hasData": true,
  "data": {
    "id": 447,
    "deviceId": 2,
    "deviceCode": "esp32-01",
    "humidity": 55.4,
    "rawAdcValue": 2840,
    "temperature": 24.5,
    "timestamp": "2026-10-16 18:49:53.629427-04",
    "createdAt": "2026-10-16 18:49:53.629427-04"
  },
  "meta": {
    "soilStatus": "OPTIMAL",
    "requiresIrrigation": false,
    "minThreshold": 30.0,
    "maxThreshold": 70.0,
    "device": {
      "id": 2,
      "name": "ESP32 Node (esp32-01)",
      "code": "esp32-01",
      "status": "ONLINE"
    }
  }
}
```

---

### 2. `GET /humidity/stats`

Returns metrics formatted directly for dashboard cards (min, max, average, current, trend) and time-series data points tailored for mobile charts (e.g., `react-native-chart-kit`, `victory-native`, or `react-native-gifted-charts`).

#### Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `deviceCode` | `string` | No | `ESP32-DEFAULT` | Node code (e.g. `esp32-01`) |
| `range` | `string` | No | `24h` | Time window: `'24h'`, `'7d'`, or `'30d'` |

#### Example Request

```http
GET /humidity/stats?deviceCode=esp32-01&range=24h HTTP/1.1
Host: api.riego.pipexapp.com
```

```bash
curl -s "https://api.riego.pipexapp.com/humidity/stats?deviceCode=esp32-01&range=24h"
```

#### Success Response (`200 OK`)

```json
{
  "count": 120,
  "range": "24h",
  "summary": {
    "current": 55.4,
    "min": 18.2,
    "max": 65.0,
    "average": 42.6,
    "trend": "RISING",
    "soilStatus": "OPTIMAL"
  },
  "chartData": [
    {
      "value": 28.0,
      "temperature": 23.8,
      "timestamp": "2026-10-16 12:00:00-04",
      "label": "12:00 PM"
    },
    {
      "value": 55.4,
      "temperature": 24.5,
      "timestamp": "2026-10-16 18:49:53-04",
      "label": "06:49 PM"
    }
  ]
}
```

> [!TIP]
> Use `summary.trend` (`'RISING'` | `'FALLING'` | `'STABLE'`) to render indicator arrows in your dashboard UI.

---

### 3. `GET /humidity/history`

Retrieves a list of readings with sorting, date filtering, and record limits.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `deviceCode` | `string` | No | `ESP32-DEFAULT` | Device code filter |
| `range` | `string` | No | `all` | Filter window: `'24h'`, `'7d'`, `'30d'`, `'all'` |
| `startDate` | `string` | No | `undefined` | ISO 8601 start date (e.g. `2026-10-16T00:00:00Z`) |
| `endDate` | `string` | No | `undefined` | ISO 8601 end date (e.g. `2026-10-16T23:59:59Z`) |
| `limit` | `number` | No | `100` | Maximum rows to retrieve (1 – 1000) |
| `order` | `string` | No | `desc` | Ordering by timestamp: `'asc'` or `'desc'` |

#### Example Request

```http
GET /humidity/history?deviceCode=esp32-01&limit=10&order=desc HTTP/1.1
Host: api.riego.pipexapp.com
```

#### Success Response (`200 OK`)

```json
{
  "total": 10,
  "data": [
    {
      "id": 447,
      "deviceId": 2,
      "deviceCode": "esp32-01",
      "humidity": 55.4,
      "rawAdcValue": 2840,
      "temperature": 24.5,
      "timestamp": "2026-10-16 18:49:53.629427-04",
      "createdAt": "2026-10-16 18:49:53.629427-04"
    }
  ]
}
```

---

### 4. `POST /humidity`

Allows manual data insertion or testing of the humidity ingestion pipeline.

#### Request Headers

```http
Content-Type: application/json
```

#### Request Body

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `humidity` | `number` | **Yes** | Min: `0`, Max: `100` | Soil humidity percentage |
| `deviceCode` | `string` | No | - | Node code (default: `ESP32-DEFAULT`) |
| `temperature` | `number` | No | - | Ambient temperature in °C |
| `rawAdcValue` | `number` | No | - | Raw 12-bit ADC value (0 – 4095) |
| `timestamp` | `string` | No | ISO 8601 | Custom timestamp |

#### Example Body

```json
{
  "deviceCode": "esp32-01",
  "humidity": 48.5,
  "temperature": 23.4,
  "rawAdcValue": 2410
}
```

#### Success Response (`201 Created`)

```json
{
  "success": true,
  "data": {
    "id": 448,
    "deviceId": 2,
    "deviceCode": "esp32-01",
    "humidity": 48.5,
    "rawAdcValue": 2410,
    "temperature": 23.4,
    "timestamp": "2026-10-16 19:10:00-04",
    "createdAt": "2026-10-16 19:10:00-04"
  },
  "meta": {
    "soilStatus": "OPTIMAL",
    "requiresIrrigation": false,
    "minThreshold": 30.0,
    "maxThreshold": 70.0
  }
}
```

---

### 5. `GET /irrigation/pump`

Returns the current active state of the pump and details regarding the latest irrigation cycle.
The response also includes the latest retained circuit diagnostic from `home/garden/diagnostics` (when available), including the ESP32's pump current check. Device and relay state must not be presented as proof that the water pump is physically running unless the diagnostic reports `components.pump.status: "BOMBEANDO_OK"`.

#### Example Request

```http
GET /irrigation/pump HTTP/1.1
Host: api.riego.pipexapp.com
```

#### Success Response (`200 OK`)

```json
{
  "pumpState": "ON",
  "deviceStatus": "ONLINE",
  "lastSeenAt": "2026-10-16T18:49:53.629Z",
  "diagnosticsReceivedAt": "2026-10-16T18:49:54.000Z",
  "diagnostics": {
    "components": {
      "pump": {
        "ok": true,
        "status": "BOMBEANDO_OK",
        "running": true
      }
    }
  },
  "lastEvent": {
    "id": 7,
    "deviceId": 2,
    "userId": null,
    "mode": "AUTOMATIC",
    "status": "ACTIVE",
    "activatedAt": "2026-10-16 18:49:11.695208-04",
    "stoppedAt": null,
    "durationSeconds": null,
    "soilHumidityBefore": 0.0,
    "soilHumidityAfter": null,
    "createdAt": "2026-10-16 18:49:11.695208-04"
  }
}
```

---

### 6. `POST /irrigation/pump`

Sends a command via MQTT to the ESP32 to manually turn the irrigation pump **ON** or **OFF**.

The backend only accepts the command when the ESP32 has sent a heartbeat within the last 30 seconds. A successful response means that the command was published to MQTT; it is **not** confirmation that the relay changed state. The app must wait for the ESP32's `home/garden/pump/status` report before showing the requested state. Irrigation events are recorded/closed from this reported status, not from the publish request.

#### Request Body

| Field | Type | Required | Values | Description |
| :--- | :--- | :--- | :--- | :--- |
| `command` | `string` | **Yes** | `"ON"` or `"OFF"` | Command for the relay |
| `deviceCode` | `string` | No | e.g. `"esp32-01"` | Target node code (default: `esp32-01`) |

#### Example Body

```json
{
  "command": "ON",
  "deviceCode": "esp32-01"
}
```

#### Success Response (`200 OK`)

```json
{
  "success": true,
  "action": "ON",
  "command": "ON",
  "deviceCode": "esp32-01",
  "pumpState": "OFF",
  "awaitingDeviceConfirmation": true
}
```

`pumpState` is the latest state reported by the ESP32 and may not yet match the requested command. When the device is offline or its heartbeat is older than 30 seconds, the endpoint responds with `503 Service Unavailable` instead of publishing a command.

---

### 7. `PUT /irrigation/threshold` & `POST /irrigation/threshold`

Sets the soil moisture threshold percentage (`minHumidityThreshold`) for an irrigation node in the database and broadcasts the new threshold to the ESP32 via MQTT topic `home/garden/config/threshold` with retain flag set (`qos: 1, retain: true`).

- **Permission Required**: `pump:control` (e.g. `ADMIN`, `OPERATOR`)

#### Request Headers

```http
Content-Type: application/json
Authorization: Bearer <accessToken>
```

#### Request Body

| Field | Type | Required | Range | Description |
| :--- | :--- | :--- | :--- | :--- |
| `threshold` | `number` | **Yes** | `0` – `100` | Minimum humidity threshold percentage to trigger watering |
| `deviceCode` | `string` | No | - | Node code (default: `"esp32-01"`) |

#### Example Body

```json
{
  "threshold": 35,
  "deviceCode": "esp32-01"
}
```

#### Success Response (`200 OK`)

```json
{
  "success": true,
  "threshold": 35,
  "deviceCode": "esp32-01",
  "topic": "home/garden/config/threshold",
  "message": "Threshold updated to 35% and broadcast to ESP32"
}
```

---

### 8. `GET /irrigation/status`

Retrieves the live operational status and connectivity metrics of the IoT node and the irrigation pump, combining MQTT broker connectivity, ESP32 device connectivity (`ONLINE` / `OFFLINE` reported by LWT and heartbeat on `home/garden/status`), last seen timestamp, threshold configuration, and pump state.

- **Permission Required**: `pump:read` (e.g. `ADMIN`, `OPERATOR`, `VIEWER`)

#### Example Request

```http
GET /irrigation/status?deviceCode=esp32-01 HTTP/1.1
Host: api.riego.pipexapp.com
Authorization: Bearer <accessToken>
```

#### Success Response (`200 OK`)

```json
{
  "deviceCode": "esp32-01",
  "connected": true,
  "status": "ONLINE",
  "deviceStatus": "ONLINE",
  "lastSeenAt": "2026-10-28T20:45:10.123Z",
  "minThreshold": 35,
  "maxThreshold": 70,
  "pumpState": "OFF",
  "lastPumpEvent": {
    "id": 8,
    "mode": "AUTOMATIC",
    "status": "COMPLETED",
    "activatedAt": "2026-10-28T20:30:00.000Z",
    "stoppedAt": "2026-10-28T20:31:00.000Z",
    "durationSeconds": 60
  }
}
```

---

### 9. `GET /`

Health check endpoint.

#### Success Response (`200 OK`)

```json
{
  "status": "ok",
  "service": "Riego IoT Backend API",
  "version": "1.0.0"
}
```

---

## 💻 TypeScript Interfaces for Frontend Integration

Copy and paste these interfaces into your React / React Native project (`src/types/riego.ts`):

```typescript
export type SoilStatus = 'CRITICAL_DRY' | 'DRY' | 'OPTIMAL' | 'SATURATED';
export type PumpState = 'ON' | 'OFF' | 'UNKNOWN';
export type IrrigationMode = 'AUTOMATIC' | 'MANUAL';
export type IrrigationEventStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface DeviceInfo {
  id: number;
  name: string;
  code: string;
  status: 'ONLINE' | 'OFFLINE';
}

export interface HumidityReading {
  id: number;
  deviceId: number;
  deviceCode: string;
  humidity: number;
  rawAdcValue: number | null;
  temperature: number | null;
  timestamp: string;
  createdAt: string;
}

export interface LatestReadingResponse {
  hasData: boolean;
  message?: string;
  data?: HumidityReading;
  meta?: {
    soilStatus: SoilStatus;
    requiresIrrigation: boolean;
    minThreshold: number;
    maxThreshold: number;
    device: DeviceInfo | null;
  };
}

export interface ChartDataPoint {
  value: number;
  temperature: number | null;
  timestamp: string;
  label: string;
}

export interface HumidityStatsResponse {
  count: number;
  range: '24h' | '7d' | '30d';
  summary: {
    current: number;
    min: number;
    max: number;
    average: number;
    trend: 'RISING' | 'FALLING' | 'STABLE';
    soilStatus: SoilStatus;
  } | null;
  chartData: ChartDataPoint[];
}

export interface IrrigationEvent {
  id: number;
  deviceId: number;
  userId: number | null;
  mode: IrrigationMode;
  status: IrrigationEventStatus;
  activatedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  soilHumidityBefore: number | null;
  soilHumidityAfter: number | null;
  createdAt: string;
}

export interface PumpStatusResponse {
  pumpState: PumpState;
  lastEvent: IrrigationEvent | null;
}

export interface PumpCommandResponse {
  success: boolean;
  action: 'ON' | 'OFF';
  pumpState: PumpState;
  message: string;
}

export interface DeviceStatusResponse {
  deviceCode: string;
  connected: boolean;
  status: 'ONLINE' | 'OFFLINE';
  deviceStatus: 'ONLINE' | 'OFFLINE';
  lastSeenAt: string | null;
  minThreshold: number;
  maxThreshold: number;
  pumpState: PumpState;
  lastPumpEvent: IrrigationEvent | null;
}

export interface SetThresholdResponse {
  success: boolean;
  threshold: number;
  deviceCode: string;
  topic: string;
  message: string;
}
```

---

## ⚛️ React / React Native Hook Example

Here is a ready-to-use custom React hook using `fetch` (compatible with React Native and Expo):

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { 
  LatestReadingResponse, 
  HumidityStatsResponse, 
  PumpStatusResponse 
} from './types/riego';

const BASE_URL = 'https://api.riego.pipexapp.com';

export function useIrrigationDashboard(deviceCode = 'esp32-01') {
  const [latest, setLatest] = useState<LatestReadingResponse | null>(null);
  const [stats, setStats] = useState<HumidityStatsResponse | null>(null);
  const [pumpStatus, setPumpStatus] = useState<PumpStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingPump, setTogglingPump] = useState(false);

  // Fetch current data
  const refresh = useCallback(async () => {
    try {
      const [resLatest, resStats, resPump] = await Promise.all([
        fetch(`${BASE_URL}/humidity/latest?deviceCode=${deviceCode}`),
        fetch(`${BASE_URL}/humidity/stats?deviceCode=${deviceCode}&range=24h`),
        fetch(`${BASE_URL}/irrigation/pump`),
      ]);

      if (resLatest.ok) setLatest(await resLatest.json());
      if (resStats.ok) setStats(await resStats.json());
      if (resPump.ok) setPumpStatus(await resPump.json());
    } catch (error) {
      console.error('Failed to fetch irrigation data:', error);
    } finally {
      setLoading(false);
    }
  }, [deviceCode]);

  // Toggle pump manually
  const togglePump = async (command: 'ON' | 'OFF') => {
    setTogglingPump(true);
    try {
      const res = await fetch(`${BASE_URL}/irrigation/pump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, deviceCode }),
      });
      if (res.ok) {
        await refresh(); // Refresh status immediately
      }
    } catch (error) {
      console.error('Failed to send pump command:', error);
    } finally {
      setTogglingPump(false);
    }
  };

  // Poll every 5 seconds for real-time telemetry
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { latest, stats, pumpStatus, loading, togglingPump, togglePump, refresh };
}
```
