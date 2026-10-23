#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/abcde6a439de8238a06f5dec89917f3163904df87a1e31d35edc4ba6cf7663da/contract';
import endContract from '../../snapshots/abcde6a439de8238a06f5dec89917f3163904df87a1e31d35edc4ba6cf7663da/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'Device',
        columns: [
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('lastSeenAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('location', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('maxHumidityThreshold', 'float8', {
            notNull: true,
            default: lit(70),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('minHumidityThreshold', 'float8', {
            notNull: true,
            default: lit(30),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('ONLINE'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'HumidityReading',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('deviceCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('deviceId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('humidity', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('rawAdcValue', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('temperature', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('timestamp', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'IrrigationEvent',
        columns: [
          col('activatedAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('deviceId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('durationSeconds', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('mode', 'text', {
            notNull: true,
            default: lit('AUTOMATIC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('soilHumidityAfter', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('soilHumidityBefore', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('COMPLETED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('stoppedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('userId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'User',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('password', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', {
            notNull: true,
            default: lit('admin'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Device',
        constraint: 'Device_code_key',
        columns: ['code'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'User',
        constraint: 'User_email_key',
        columns: ['email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Device',
        index: 'Device_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'HumidityReading',
        index: 'HumidityReading_deviceId_idx_a7d461e8',
        columns: ['deviceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'IrrigationEvent',
        index: 'IrrigationEvent_deviceId_idx_a7d461e8',
        columns: ['deviceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'IrrigationEvent',
        index: 'IrrigationEvent_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Device',
        foreignKey: {
          name: 'Device_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'HumidityReading',
        foreignKey: {
          name: 'HumidityReading_deviceId_fkey',
          columns: ['deviceId'],
          references: { schema: 'public', table: 'Device', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'IrrigationEvent',
        foreignKey: {
          name: 'IrrigationEvent_deviceId_fkey',
          columns: ['deviceId'],
          references: { schema: 'public', table: 'Device', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'IrrigationEvent',
        foreignKey: {
          name: 'IrrigationEvent_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
