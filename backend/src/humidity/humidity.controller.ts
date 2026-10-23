import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { CreateHumidityReadingDto } from './dto/create-humidity-reading.dto.js';
import { QueryHumidityDto } from './dto/query-humidity.dto.js';
import { HumidityService } from './humidity.service.js';

@Controller('humidity')
export class HumidityController {
  constructor(private readonly humidityService: HumidityService) {}

  /**
   * Endpoint for ESP32 / MQTT broker to send humidity sensor data
   */
  @Post()
  @RequirePermissions(PERMISSIONS.HUMIDITY_CREATE)
  async recordReading(@Body() dto: CreateHumidityReadingDto) {
    return this.humidityService.createReading(dto);
  }

  /**
   * Endpoint for React Native app to get current/latest humidity
   */
  @Get('latest')
  @RequirePermissions(PERMISSIONS.HUMIDITY_READ)
  async getLatestReading(@Query('deviceCode') deviceCode?: string) {
    return this.humidityService.getLatestReading(deviceCode);
  }

  /**
   * Endpoint for React Native app to get historical readings
   */
  @Get('history')
  @RequirePermissions(PERMISSIONS.HUMIDITY_READ)
  async getHistory(@Query() query: QueryHumidityDto) {
    return this.humidityService.getHistory(query);
  }

  /**
   * Endpoint for React Native app to get analytics & graph data points
   */
  @Get('stats')
  @RequirePermissions(PERMISSIONS.HUMIDITY_READ)
  async getStats(
    @Query('deviceCode') deviceCode?: string,
    @Query('range') range?: '24h' | '7d' | '30d',
  ) {
    return this.humidityService.getStats(deviceCode, range ?? '24h');
  }
}

