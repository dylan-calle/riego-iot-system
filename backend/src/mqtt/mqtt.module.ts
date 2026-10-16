import { Module } from '@nestjs/common';
import { HumidityModule } from '../humidity/humidity.module.js';
import { MqttController } from './mqtt.controller.js';
import { MqttService } from './mqtt.service.js';

@Module({
  imports: [HumidityModule],
  controllers: [MqttController],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
