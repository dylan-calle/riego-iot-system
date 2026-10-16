import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { db } from './db.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client = db;

  async onModuleDestroy() {
    await this.client.close();
  }
}
