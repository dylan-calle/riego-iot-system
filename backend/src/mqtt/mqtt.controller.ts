import { Body, Controller, Get, Post } from '@nestjs/common';
import { PumpCommandDto } from './dto/pump-command.dto.js';
import { MqttService } from './mqtt.service.js';

@Controller('irrigation/pump')
export class MqttController {
  constructor(private readonly mqttService: MqttService) {}

  /**
   * Manual pump control endpoint for the React Native mobile app
   */
  @Post()
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
  @Get()
  async getPumpStatus() {
    return this.mqttService.getPumpStatus();
  }
}
