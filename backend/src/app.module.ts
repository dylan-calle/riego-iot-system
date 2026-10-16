import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HumidityModule } from './humidity/humidity.module.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, HumidityModule, MqttModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
