import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { PumpCommandDto } from './dto/pump-command.dto.js';
import { SetThresholdDto } from './dto/set-threshold.dto.js';
import { MqttService } from './mqtt.service.js';

@Controller('irrigation')
export class MqttController {
  constructor(private readonly mqttService: MqttService) {}

  /**
   * Manual pump control endpoint for the React Native mobile app
   */
  @Post('pump')
  @RequirePermissions(PERMISSIONS.PUMP_CONTROL)
  async sendPumpCommand(@Body() dto: PumpCommandDto) {
    return this.mqttService.sendPumpCommand(
      dto.command,
      dto.deviceCode ?? 'esp32-01',
      'MANUAL',
    );
  }

  /**
   * Status endpoint to check current pump state and latest irrigation log
   */
  @Get('pump')
  @RequirePermissions(PERMISSIONS.PUMP_READ)
  async getPumpStatus(@Query('deviceCode') deviceCode?: string) {
    return this.mqttService.getPumpStatus(deviceCode ?? 'esp32-01');
  }

  /**
   * Endpoint to update soil humidity threshold and notify ESP32 via MQTT topic home/garden/config/threshold
   */
  @Put(['threshold', 'config/threshold'])
  @Post(['threshold', 'config/threshold'])
  @RequirePermissions(PERMISSIONS.PUMP_CONTROL)
  async setThreshold(@Body() dto: SetThresholdDto) {
    return this.mqttService.sendThresholdConfig(
      dto.threshold,
      dto.deviceCode ?? 'esp32-01',
    );
  }

  /**
   * Status endpoint to inspect device connectivity (ONLINE/OFFLINE, LWT, heartbeat) and thresholds
   */
  @Get(['status', 'device/status'])
  @RequirePermissions(PERMISSIONS.PUMP_READ)
  async getDeviceStatus(@Query('deviceCode') deviceCode?: string) {
    return this.mqttService.getDeviceStatus(deviceCode ?? 'esp32-01');
  }

  /**
   * Last hardware diagnostics published by the ESP32 on home/garden/diagnostics
   * (component health, wiring, battery, pump). Returns hasData=false until the first message arrives.
   */
  @Get('diagnostics')
  @RequirePermissions(PERMISSIONS.PUMP_READ)
  getDiagnostics(@Query('deviceCode') deviceCode?: string) {
    return this.mqttService.getDiagnostics(deviceCode ?? 'esp32-01');
  }
}


