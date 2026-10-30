import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import mqtt, { type MqttClient } from 'mqtt';
import { HumidityService } from '../humidity/humidity.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Último mensaje de diagnóstico recibido de un dispositivo.
 * `payload` se guarda tal cual lo publica el ESP32 (sin transformar): puede ser
 * el JSON completo o el mensaje parcial de última voluntad (LWT) con
 * generalStatus "OFFLINE".
 */
interface StoredDiagnostics {
  payload: Record<string, unknown>;
  /** Momento en que ESTE backend recibió el mensaje (no lo envía el ESP32). */
  receivedAt: string;
  /** true si el broker lo entregó como mensaje retenido (p. ej. al suscribirse). */
  retained: boolean;
}

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private readonly deviceHeartbeatTimeoutMs = 30_000;
  private client!: MqttClient;

  // Topics
  private readonly moistureTopic =
    process.env.MQTT_MOISTURE_TOPIC ?? 'home/garden/moisture';
  private readonly pumpCommandTopic =
    process.env.MQTT_PUMP_COMMAND_TOPIC ?? 'home/garden/pump/command';
  private readonly pumpStatusTopic =
    process.env.MQTT_PUMP_STATUS_TOPIC ?? 'home/garden/pump/status';
  private readonly deviceStatusTopic =
    process.env.MQTT_DEVICE_STATUS_TOPIC ?? 'home/garden/status';
  private readonly diagnosticsTopic =
    process.env.MQTT_DIAGNOSTICS_TOPIC ?? 'home/garden/diagnostics';
  private readonly thresholdConfigTopic =
    process.env.MQTT_THRESHOLD_CONFIG_TOPIC ?? 'home/garden/config/threshold';

  // State
  private readonly latestDiagnostics = new Map<string, StoredDiagnostics>();
  private pumpState: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN';
  private activeIrrigationEventId: number | null = null;
  private lastPumpActionTime: number = 0;
  private pendingPumpCommand: {
    command: 'ON' | 'OFF';
    deviceCode: string;
    mode: 'MANUAL' | 'AUTOMATIC';
    soilHumidity?: number;
  } | null = null;

  constructor(
    private readonly humidityService: HumidityService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    let brokerUrl =
      process.env.MQTT_BROKER_URL ?? 'mqtts://mqtt.riego.pipexapp.com:8883';
    const username = process.env.MQTT_USERNAME ?? 'esp32';
    const password = process.env.MQTT_PASSWORD ?? 'esp32device';

    // Auto-normalize if protocol was mistakenly set to mqtt:// on TLS port 8883
    if (brokerUrl.startsWith('mqtt://') && brokerUrl.includes(':8883')) {
      this.logger.warn(
        'Detected unencrypted "mqtt://" scheme for port 8883. Switching to "mqtts://" to prevent TLS handshake failure (ECONNRESET).',
      );
      brokerUrl = brokerUrl.replace(/^mqtt:\/\//, 'mqtts://');
    }

    this.logger.log(`Connecting to MQTT broker at ${brokerUrl}...`);

    this.client = mqtt.connect(brokerUrl, {
      username,
      password,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      clientId:
        process.env.MQTT_CLIENT_ID ??
        `riego-backend-${Math.random().toString(16).slice(2, 10)}`,
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to MQTT broker successfully');

      // Subscribe to moisture telemetry, pump status, device heartbeat/LWT and hardware diagnostics
      this.client.subscribe(
        [
          this.moistureTopic,
          this.pumpStatusTopic,
          this.deviceStatusTopic,
          this.diagnosticsTopic,
        ],
        (err) => {
          if (err) {
            this.logger.error(`Failed to subscribe to topics: ${err.message}`);
          } else {
            this.logger.log(
              `Subscribed to: ${this.moistureTopic}, ${this.pumpStatusTopic}, ${this.deviceStatusTopic}, ${this.diagnosticsTopic}`,
            );
          }
        },
      );
    });

    this.client.on('message', async (topic, payload, packet) => {
      const message = payload.toString();
      if (topic === this.moistureTopic) {
        await this.handleMoistureMessage(message);
      } else if (topic === this.pumpStatusTopic) {
        await this.handlePumpStatusMessage(message);
      } else if (topic === this.deviceStatusTopic) {
        await this.handleDeviceStatusMessage(message);
      } else if (topic === this.diagnosticsTopic) {
        this.handleDiagnosticsMessage(message, packet.retain);
      }
    });

    this.client.on('error', (err) => {
      this.logger.error(`MQTT Client error: ${err.message}`);
    });

    this.client.on('offline', () => {
      this.logger.warn('MQTT Client went offline, reconnecting...');
    });
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.end(true);
      this.logger.log('Disconnected from MQTT broker');
    }
  }

  /**
   * Processes moisture payload: {"deviceId":"esp32-01","moisture":50}
   */
  private async handleMoistureMessage(rawMessage: string) {
    try {
      const parsed = JSON.parse(rawMessage);
      const deviceCode = parsed.deviceId ?? parsed.deviceCode ?? 'esp32-01';
      const moisture = Number(parsed.moisture ?? parsed.humidity);

      if (isNaN(moisture)) {
        this.logger.warn(`Received invalid moisture value: ${rawMessage}`);
        return;
      }

      // Persist reading in database
      const result = await this.humidityService.createReading({
        deviceCode,
        humidity: moisture,
      });

      // Automation check: Automatic irrigation control based on thresholds
      await this.handleAutoIrrigation(
        deviceCode,
        moisture,
        result.meta.minThreshold,
        result.meta.maxThreshold,
      );
    } catch (err: any) {
      this.logger.error(
        `Error processing moisture message "${rawMessage}": ${err.message}`,
      );
    }
  }

  /**
   * Handles automatic pump trigger when soil moisture is low, and turns off when saturated
   */
  private async handleAutoIrrigation(
    deviceCode: string,
    currentMoisture: number,
    minThreshold: number,
    maxThreshold: number,
  ) {
    const now = Date.now();
    const cooldownMs = 30000; // 30-second cooldown between state switches to avoid oscillating

    if (now - this.lastPumpActionTime < cooldownMs) {
      return;
    }

    // Trigger ON if below minimum threshold and pump is not running
    if (currentMoisture < minThreshold && this.pumpState !== 'ON') {
      this.logger.warn(
        `Low moisture detected (${currentMoisture}% < ${minThreshold}%). Triggering automatic irrigation for ${deviceCode}...`,
      );
      await this.sendPumpCommand(
        'ON',
        deviceCode,
        'AUTOMATIC',
        currentMoisture,
      );
      this.lastPumpActionTime = now;
    }
    // Trigger OFF if above maximum threshold and pump is currently running
    else if (currentMoisture >= maxThreshold && this.pumpState === 'ON') {
      this.logger.log(
        `Optimal moisture reached (${currentMoisture}% >= ${maxThreshold}%). Stopping automatic irrigation for ${deviceCode}...`,
      );
      await this.sendPumpCommand(
        'OFF',
        deviceCode,
        'AUTOMATIC',
        currentMoisture,
      );
      this.lastPumpActionTime = now;
    }
  }

  /**
   * Processes pump status report: "ON", "OFF", or {"status":"ON"}
   */
  private async handlePumpStatusMessage(rawMessage: string) {
    let status = rawMessage.trim().toUpperCase();
    let deviceCode = 'esp32-01';
    try {
      const parsed = JSON.parse(rawMessage);
      if (parsed.status) status = String(parsed.status).toUpperCase();
      deviceCode = parsed.deviceId ?? parsed.deviceCode ?? deviceCode;
    } catch {
      // String payload like "ON" or "OFF"
    }

    if (status === 'ON' || status === 'OFF') {
      this.pumpState = status;
      this.logger.log(`Pump feedback status received from ESP32: ${status}`);

      const pending = this.pendingPumpCommand;
      const commandConfirmed =
        pending?.command === status && pending.deviceCode === deviceCode;

      if (
        status === 'ON' &&
        commandConfirmed &&
        !this.activeIrrigationEventId
      ) {
        const orm = this.prisma.client.orm.public;
        const device = await orm.Device.where({ code: deviceCode }).first();
        const event = await orm.IrrigationEvent.create({
          deviceId: device?.id ?? null,
          mode: pending.mode,
          status: 'ACTIVE',
          soilHumidityBefore: pending.soilHumidity ?? null,
        });
        this.activeIrrigationEventId = event.id;
      }

      // If pump reported OFF and we had an active event, close it
      if (status === 'OFF' && this.activeIrrigationEventId) {
        await this.finishActiveIrrigationEvent();
      }

      if (commandConfirmed) {
        this.pendingPumpCommand = null;
      }
    }
  }

  /**
   * Processes device heartbeat & LWT: {"deviceId":"esp32-01","status":"ONLINE"|"OFFLINE"}
   */
  private async handleDeviceStatusMessage(rawMessage: string) {
    try {
      let deviceCode = 'esp32-01';
      let status = 'ONLINE';

      try {
        const parsed = JSON.parse(rawMessage);
        if (parsed.deviceId || parsed.deviceCode) {
          deviceCode = parsed.deviceId ?? parsed.deviceCode;
        }
        if (parsed.status) {
          status = String(parsed.status).toUpperCase();
        }
      } catch {
        const trimmed = rawMessage.trim().toUpperCase();
        if (trimmed === 'ONLINE' || trimmed === 'OFFLINE') {
          status = trimmed;
        }
      }

      const orm = this.prisma.client.orm.public;
      const device = await orm.Device.where({ code: deviceCode }).first();
      const nowIso = new Date().toISOString();

      if (deviceCode === 'esp32-01' && status === 'OFFLINE') {
        this.pumpState = 'UNKNOWN';
      }

      if (!device) {
        await orm.Device.create({
          code: deviceCode,
          name: `ESP32 Node (${deviceCode})`,
          status,
          minHumidityThreshold: 30.0,
          maxHumidityThreshold: 70.0,
          lastSeenAt: nowIso,
        });
        this.logger.log(
          `Created device record for ${deviceCode} with status: ${status}`,
        );
      } else {
        await orm.Device.where({ id: device.id }).update({
          status,
          lastSeenAt: nowIso,
        });
        this.logger.log(
          `Updated device status for ${deviceCode}: ${status} (Last seen: ${nowIso})`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Error processing device status message "${rawMessage}": ${err.message}`,
      );
    }
  }

  /**
   * Processes hardware diagnostics published by the ESP32 on home/garden/diagnostics.
   * Full payload: {"deviceId","generalStatus":"ALL_OK"|"FALLO_DETECTADO","mode","thresholdMin",
   * "thresholdMax","components":{esp32,sensor,relay,battery,pump,wiring}}.
   * LWT payload (partial): {"deviceId","generalStatus":"OFFLINE","components":{"esp32":{...}}}.
   * The last message per device is kept in memory exactly as received.
   */
  private handleDiagnosticsMessage(rawMessage: string, retained: boolean) {
    try {
      const parsed: unknown = JSON.parse(rawMessage);

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        this.logger.warn(`Received invalid diagnostics payload: ${rawMessage}`);
        return;
      }

      const payload = parsed as Record<string, unknown>;
      const deviceCode = String(
        payload.deviceId ?? payload.deviceCode ?? 'esp32-01',
      );

      const previous = this.latestDiagnostics.get(deviceCode);
      this.latestDiagnostics.set(deviceCode, {
        payload,
        receivedAt: new Date().toISOString(),
        retained,
      });

      // Diagnostics arrive every ~3s: only log when the general status changes
      if (previous?.payload.generalStatus !== payload.generalStatus) {
        this.logger.log(
          `Diagnostics for ${deviceCode}: generalStatus ${String(previous?.payload.generalStatus ?? 'N/A')} -> ${String(payload.generalStatus)}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Error processing diagnostics message "${rawMessage}": ${err.message}`,
      );
    }
  }

  private publishPumpCommand(command: 'ON' | 'OFF'): Promise<void> {
    if (!this.client?.connected) {
      throw new ServiceUnavailableException(
        'Cannot control the pump because the MQTT broker is unavailable',
      );
    }

    return new Promise((resolve, reject) => {
      this.client.publish(
        this.pumpCommandTopic,
        command,
        { qos: 1 },
        (error) => {
          if (error) {
            this.logger.error(
              `Failed to publish pump command ${command}: ${error.message}`,
            );
            reject(
              new ServiceUnavailableException(
                `Failed to publish pump command ${command}`,
              ),
            );
            return;
          }

          this.logger.log(
            `Published command "${command}" to ${this.pumpCommandTopic}`,
          );
          resolve();
        },
      );
    });
  }

  /**
   * Publishes new threshold configuration to ESP32 on home/garden/config/threshold
   */
  async sendThresholdConfig(
    threshold: number,
    deviceCode: string = 'esp32-01',
  ) {
    if (!this.client?.connected) {
      throw new ServiceUnavailableException(
        'Cannot update threshold because the MQTT broker is unavailable',
      );
    }

    const payload = String(Math.round(threshold));

    await new Promise<void>((resolve, reject) => {
      this.client.publish(
        this.thresholdConfigTopic,
        payload,
        { qos: 1, retain: true },
        (error) => {
          if (error) {
            this.logger.error(
              `Failed to publish threshold config ${payload}: ${error.message}`,
            );
            reject(
              new ServiceUnavailableException(
                `Failed to publish threshold config to MQTT broker`,
              ),
            );
            return;
          }

          this.logger.log(
            `Published new threshold "${payload}" to ${this.thresholdConfigTopic} (retained)`,
          );
          resolve();
        },
      );
    });

    const orm = this.prisma.client.orm.public;
    const device = await orm.Device.where({ code: deviceCode }).first();

    if (device) {
      await orm.Device.where({ id: device.id }).update({
        minHumidityThreshold: threshold,
      });
    }

    return {
      success: true,
      deviceCode,
      minHumidityThreshold: threshold,
      topic: this.thresholdConfigTopic,
    };
  }

  /**
   * Send ON or OFF command to ESP32 on home/garden/pump/command
   */
  async sendPumpCommand(
    command: 'ON' | 'OFF' | 'on' | 'off',
    deviceCode: string = 'esp32-01',
    mode: 'MANUAL' | 'AUTOMATIC' = 'MANUAL',
    soilHumidity?: number,
  ) {
    const cmdNormalized: 'ON' | 'OFF' =
      command.toUpperCase() === 'ON' ? 'ON' : 'OFF';
    const orm = this.prisma.client.orm.public;
    const device = await orm.Device.where({ code: deviceCode }).first();
    const lastSeenMs = device?.lastSeenAt
      ? new Date(device.lastSeenAt).getTime()
      : Number.NaN;
    const deviceIsOnline =
      device?.status === 'ONLINE' &&
      Number.isFinite(lastSeenMs) &&
      Date.now() - lastSeenMs >= -this.deviceHeartbeatTimeoutMs &&
      Date.now() - lastSeenMs <= this.deviceHeartbeatTimeoutMs;

    if (!deviceIsOnline) {
      throw new ServiceUnavailableException(
        `Cannot control the pump because device ${deviceCode} is offline or has no recent heartbeat`,
      );
    }

    this.pendingPumpCommand = {
      command: cmdNormalized,
      deviceCode,
      mode,
      soilHumidity,
    };

    try {
      await this.publishPumpCommand(cmdNormalized);
    } catch (error) {
      this.pendingPumpCommand = null;
      throw error;
    }

    this.lastPumpActionTime = Date.now();

    return {
      success: true,
      command: cmdNormalized,
      deviceCode,
      mode,
      pumpState: this.pumpState,
      awaitingDeviceConfirmation: true,
    };
  }

  /**
   * Finalize the active irrigation event in PostgreSQL
   */
  private async finishActiveIrrigationEvent(soilHumidityAfter?: number) {
    if (!this.activeIrrigationEventId) return;

    try {
      const orm = this.prisma.client.orm.public;
      const event = await orm.IrrigationEvent.where({
        id: this.activeIrrigationEventId,
      }).first();

      if (event) {
        const stoppedAt = new Date().toISOString();
        const startMs = new Date(event.activatedAt).getTime();
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - startMs) / 1000),
        );

        await orm.IrrigationEvent.where({ id: event.id }).update({
          status: 'COMPLETED',
          stoppedAt,
          durationSeconds,
          soilHumidityAfter: soilHumidityAfter ?? null,
        });

        this.logger.log(
          `Irrigation event #${event.id} closed (Duration: ${durationSeconds}s)`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Failed to close irrigation event: ${err.message}`);
    } finally {
      this.activeIrrigationEventId = null;
    }
  }

  /**
   * Get current known pump state and last irrigation event
   */
  async getPumpStatus(deviceCode: string = 'esp32-01') {
    const orm = this.prisma.client.orm.public;
    const device = await orm.Device.where({ code: deviceCode }).first();
    const lastEvent = await orm.IrrigationEvent.orderBy((e) =>
      e.activatedAt.desc(),
    ).first();

    const lastSeenMs = device?.lastSeenAt
      ? new Date(device.lastSeenAt).getTime()
      : Number.NaN;
    const deviceIsOnline =
      device?.status === 'ONLINE' &&
      Number.isFinite(lastSeenMs) &&
      Date.now() - lastSeenMs >= -this.deviceHeartbeatTimeoutMs &&
      Date.now() - lastSeenMs <= this.deviceHeartbeatTimeoutMs;
    const diagnostics = this.latestDiagnostics.get(deviceCode);

    return {
      pumpState: deviceIsOnline ? this.pumpState : 'UNKNOWN',
      deviceCode,
      deviceStatus: deviceIsOnline ? 'ONLINE' : 'OFFLINE',
      lastSeenAt: device?.lastSeenAt ?? null,
      threshold: device?.minHumidityThreshold ?? 30.0,
      lastEvent: lastEvent ?? null,
      diagnostics: diagnostics?.payload ?? null,
      diagnosticsReceivedAt:
        diagnostics && !diagnostics.retained ? diagnostics.receivedAt : null,
    };
  }

  /**
   * Get device telemetry, connection status, and configuration
   */
  async getDeviceStatus(deviceCode: string = 'esp32-01') {
    const orm = this.prisma.client.orm.public;
    const device = await orm.Device.where({ code: deviceCode }).first();
    const lastEvent = await orm.IrrigationEvent.orderBy((e) =>
      e.activatedAt.desc(),
    ).first();

    const lastSeenMs = device?.lastSeenAt
      ? new Date(device.lastSeenAt).getTime()
      : Number.NaN;
    const deviceIsOnline =
      device?.status === 'ONLINE' &&
      Number.isFinite(lastSeenMs) &&
      Date.now() - lastSeenMs >= -this.deviceHeartbeatTimeoutMs &&
      Date.now() - lastSeenMs <= this.deviceHeartbeatTimeoutMs;
    const deviceStatus = deviceIsOnline ? 'ONLINE' : 'OFFLINE';
    const diagnostics = this.latestDiagnostics.get(deviceCode);

    return {
      deviceCode,
      name: device?.name ?? `ESP32 Node (${deviceCode})`,
      status: deviceStatus,
      deviceStatus,
      lastSeenAt: device?.lastSeenAt ?? null,
      minHumidityThreshold: device?.minHumidityThreshold ?? 30.0,
      maxHumidityThreshold: device?.maxHumidityThreshold ?? 70.0,
      pumpState: deviceIsOnline ? this.pumpState : 'UNKNOWN',
      lastEvent: lastEvent ?? null,
      diagnostics: diagnostics?.payload ?? null,
      diagnosticsReceivedAt:
        diagnostics && !diagnostics.retained ? diagnostics.receivedAt : null,
    };
  }

  /**
   * Get the last hardware diagnostics received from the device via MQTT.
   * `data` is the raw payload published by the ESP32 (full or LWT/partial).
   */
  getDiagnostics(deviceCode: string = 'esp32-01') {
    const stored = this.latestDiagnostics.get(deviceCode);

    if (!stored) {
      return {
        hasData: false,
        deviceCode,
        receivedAt: null,
        retained: null,
        data: null,
      };
    }

    return {
      hasData: true,
      deviceCode,
      receivedAt: stored.receivedAt,
      retained: stored.retained,
      data: stored.payload,
    };
  }
}
