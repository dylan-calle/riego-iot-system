import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { db } from './db.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client = db;

  async onModuleInit() {
    this.logger.log('Initializing database connection...');
    await this.client.connect();
    this.logger.log('Database connection initialized successfully');
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
