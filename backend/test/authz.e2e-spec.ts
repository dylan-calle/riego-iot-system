import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('Auth & Authz (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET / is public and accessible without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.text).toBe('Hello World!');
  });

  it('2. GET /irrigation/pump without token is blocked with 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .get('/irrigation/pump')
      .expect(401);
  });

  it('3. POST /auth/login with invalid password returns 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@gmail.com', password: 'wrongpassword' })
      .expect(401);
  });

  it('4. POST /auth/login with admin@gmail.com / 123456 returns JWT and all permissions', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@gmail.com', password: '123456' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.email).toBe('admin@gmail.com');
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user.permissions).toContain('pump:control');
    expect(res.body.user.permissions).toContain('pump:read');
    expect(res.body.user.permissions).toContain('humidity:read');
    expect(res.body.user.permissions).toContain('roles:manage');

    adminToken = res.body.accessToken;
  });

  it('5. GET /auth/me returns admin profile and permissions', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('admin@gmail.com');
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('6. GET /irrigation/pump with admin token returns 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/irrigation/pump')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('pumpState');
  });

  it('6b. GET /irrigation/status returns device status, threshold, and pump state', async () => {
    const res = await request(app.getHttpServer())
      .get('/irrigation/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('pumpState');
    expect(res.body).toHaveProperty('deviceStatus');
    expect(res.body).toHaveProperty('minHumidityThreshold');
  });


  it('7. GET /permissions lists all system endpoint permissions', async () => {
    const res = await request(app.getHttpServer())
      .get('/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(9);
    const actions = res.body.data.map((p: any) => p.action);
    expect(actions).toContain('humidity:read');
    expect(actions).toContain('pump:control');
    expect(actions).toContain('roles:manage');
  });

  it('8. GET /roles lists system and custom roles', async () => {
    const res = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const roleNames = res.body.data.map((r: any) => r.name);
    expect(roleNames).toContain('ADMIN');
    expect(roleNames).toContain('OPERATOR');
    expect(roleNames).toContain('VIEWER');
  });

  it(
    '9. POST /roles can create a custom role with customized endpoint permissions',
    async () => {
      const customRoleName = `GARDENER_${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: customRoleName,
          description: 'Custom gardener role with read and pump control permissions',
          permissions: ['humidity:read', 'pump:control'],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(customRoleName);
      expect(res.body.data.permissions).toEqual(
        expect.arrayContaining(['humidity:read', 'pump:control']),
      );

      // Clean up created role
      await request(app.getHttpServer())
        .delete(`/roles/${res.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    },
    30000,
  );
});
