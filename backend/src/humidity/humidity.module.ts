import { Module } from '@nestjs/common';
import { HumidityController } from './humidity.controller.js';
import { HumidityService } from './humidity.service.js';

@Module({
  controllers: [HumidityController],
  providers: [HumidityService],
  exports: [HumidityService],
})
export class HumidityModule {}
