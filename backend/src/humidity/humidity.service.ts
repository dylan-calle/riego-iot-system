import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateHumidityReadingDto } from './dto/create-humidity-reading.dto.js';
import { QueryHumidityDto } from './dto/query-humidity.dto.js';

export type SoilStatus = 'CRITICAL_DRY' | 'DRY' | 'OPTIMAL' | 'SATURATED';

@Injectable()
export class HumidityService {
  private readonly logger = new Logger(HumidityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates soil humidity against threshold values
   */
  evaluateSoilStatus(humidity: number): SoilStatus {
    if (humidity < 30) return 'CRITICAL_DRY';
    if (humidity < 45) return 'DRY';
    if (humidity <= 70) return 'OPTIMAL';
    return 'SATURATED';
  }

  /**
   * Record a new humidity reading (e.g. received via MQTT or HTTP from ESP32)
   */
  async createReading(dto: CreateHumidityReadingDto) {
    const deviceCode = dto.deviceCode ?? 'ESP32-DEFAULT';
    const orm = this.prisma.client.orm.public;

    // Check if device exists or create it
    let device = await orm.Device.where({ code: deviceCode }).first();

    if (!device) {
      device = await orm.Device.create({
        code: deviceCode,
        name: `ESP32 Node (${deviceCode})`,
        status: 'ONLINE',
        minHumidityThreshold: 30.0,
        maxHumidityThreshold: 70.0,
      });
    } else {
      // Update device last seen
      await orm.Device.where({ id: device.id }).update({
        status: 'ONLINE',
      });
    }

    const reading = await orm.HumidityReading.create({
      humidity: Number(dto.humidity.toFixed(2)),
      rawAdcValue: dto.rawAdcValue ?? null,
      temperature: dto.temperature !== undefined ? Number(dto.temperature.toFixed(2)) : null,
      deviceCode,
      deviceId: device.id,
    });

    const status = this.evaluateSoilStatus(reading.humidity);
    const requiresIrrigation = reading.humidity < device.minHumidityThreshold;

    this.logger.log(
      `Saved reading for ${deviceCode}: ${reading.humidity}% (Status: ${status}, Irrigation needed: ${requiresIrrigation})`,
    );

    return {
      success: true,
      data: reading,
      meta: {
        soilStatus: status,
        requiresIrrigation,
        minThreshold: device.minHumidityThreshold,
        maxThreshold: device.maxHumidityThreshold,
      },
    };
  }

  /**
   * Get the most recent reading for a device
   */
  async getLatestReading(deviceCode?: string) {
    const orm = this.prisma.client.orm.public;
    const targetCode = deviceCode ?? 'ESP32-DEFAULT';

    const latest = await orm.HumidityReading
      .where({ deviceCode: targetCode })
      .orderBy((r) => r.timestamp.desc())
      .first();

    if (!latest) {
      return {
        hasData: false,
        message: `No readings recorded for device ${targetCode}`,
      };
    }

    const device = await orm.Device.where({ code: targetCode }).first();
    const status = this.evaluateSoilStatus(latest.humidity);
    const minThreshold = device?.minHumidityThreshold ?? 30.0;
    const maxThreshold = device?.maxHumidityThreshold ?? 70.0;

    return {
      hasData: true,
      data: latest,
      meta: {
        soilStatus: status,
        requiresIrrigation: latest.humidity < minThreshold,
        minThreshold,
        maxThreshold,
        device: device
          ? {
              id: device.id,
              name: device.name,
              code: device.code,
              status: device.status,
            }
          : null,
      },
    };
  }

  /**
   * Query historical readings with range and device filters
   */
  async getHistory(query: QueryHumidityDto) {
    const orm = this.prisma.client.orm.public;
    const targetCode = query.deviceCode ?? 'ESP32-DEFAULT';
    const limit = query.limit ?? 100;
    const order = query.order ?? 'desc';

    let collection = orm.HumidityReading.where({ deviceCode: targetCode });

    if (order === 'asc') {
      collection = collection.orderBy((r) => r.timestamp.asc());
    } else {
      collection = collection.orderBy((r) => r.timestamp.desc());
    }

    const readings = await collection.limit(limit).all();

    // Filter by date range in-memory if range is specified
    const now = new Date();
    let filtered = readings;

    if (query.range && query.range !== 'all') {
      const hours = query.range === '24h' ? 24 : query.range === '7d' ? 24 * 7 : 24 * 30;
      const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
      filtered = readings.filter((r) => new Date(r.timestamp) >= cutoff);
    } else if (query.startDate) {
      const start = new Date(query.startDate);
      const end = query.endDate ? new Date(query.endDate) : now;
      filtered = readings.filter((r) => {
        const t = new Date(r.timestamp);
        return t >= start && t <= end;
      });
    }

    return {
      total: filtered.length,
      data: filtered,
    };
  }

  /**
   * Calculates dashboard summary statistics and chart intervals for the React Native mobile app
   */
  async getStats(deviceCode?: string, range: '24h' | '7d' | '30d' = '24h') {
    const history = await this.getHistory({
      deviceCode,
      range,
      limit: 1000,
      order: 'asc',
    });

    const readings = history.data;

    if (readings.length === 0) {
      return {
        count: 0,
        range,
        summary: null,
        chartData: [],
      };
    }

    const values = readings.map((r) => r.humidity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1));
    const current = readings[readings.length - 1].humidity;

    // Trend calculation (compare first half vs second half)
    const mid = Math.floor(values.length / 2);
    let trend: 'RISING' | 'FALLING' | 'STABLE' = 'STABLE';
    if (mid > 0) {
      const firstHalfAvg = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondHalfAvg = values.slice(mid).reduce((a, b) => a + b, 0) / (values.length - mid);
      const diff = secondHalfAvg - firstHalfAvg;
      if (diff > 2.0) trend = 'RISING';
      else if (diff < -2.0) trend = 'FALLING';
    }

    // Chart points formatted for React Native mobile charts
    const chartData = readings.map((r) => ({
      value: r.humidity,
      temperature: r.temperature,
      timestamp: r.timestamp,
      label: new Date(r.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

    return {
      count: readings.length,
      range,
      summary: {
        current,
        min,
        max,
        average: avg,
        trend,
        soilStatus: this.evaluateSoilStatus(current),
      },
      chartData,
    };
  }
}
