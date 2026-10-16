import path from 'node:path';
import dotenv from 'dotenv';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

// Load .env from process.cwd() or relative to this source/dist directory
dotenv.config();
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });
dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') });

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not defined in environment variables or .env file');
}

export const db = postgres<Contract>({
  contractJson,
  url: databaseUrl,
});

