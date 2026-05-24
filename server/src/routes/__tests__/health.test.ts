/**
 * Smoke-тесты для базовых health/diagnostic эндпоинтов.
 *
 * Цель: убедиться что:
 *   1. Тестовая инфраструктура (createTestServer, in-memory SQLite, Fastify inject) жива.
 *   2. /api/health отвечает корректно даже без авторизации.
 *   3. /api/server-info требует авторизации.
 *   4. После логина /api/server-info возвращает структурированную информацию.
 *
 * Если эти тесты падают — что-то фундаментально сломалось в инфраструктуре.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestServer, type TestServer } from '../../test/createTestServer.ts';

describe('Базовые эндпоинты', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  describe('GET /api/health', () => {
    it('возвращает 200 и ok:true без авторизации', async () => {
      const resp = await server.app.inject({ method: 'GET', url: '/api/health' });

      expect(resp.statusCode).toBe(200);
      const body = resp.json() as { ok: boolean; ts: number; clients: number };
      expect(body.ok).toBe(true);
      expect(typeof body.ts).toBe('number');
      expect(body.ts).toBeGreaterThan(0);
      expect(typeof body.clients).toBe('number');
    });

    it('не требует Authorization', async () => {
      const resp = await server.app.inject({ method: 'GET', url: '/api/health' });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('POST /api/auth/login', () => {
    it('возвращает токен и пользователя для admin/admin123', async () => {
      const resp = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'admin123' },
      });

      expect(resp.statusCode).toBe(200);
      const body = resp.json() as { token: string; user: { username: string; role: string } };
      expect(body.token).toMatch(/^eyJ/); // JWT начинается с eyJ
      expect(body.user.username).toBe('admin');
      expect(body.user.role).toBe('admin');
    });

    it('возвращает 401 на неверный пароль', async () => {
      const resp = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'wrong' },
      });
      expect(resp.statusCode).toBe(401);
    });

    it('возвращает 400 на пустые поля', async () => {
      const resp = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: '', password: '' },
      });
      expect(resp.statusCode).toBe(400);
    });
  });

  describe('GET /api/server-info', () => {
    it('возвращает 401 без авторизации', async () => {
      const resp = await server.app.inject({ method: 'GET', url: '/api/server-info' });
      expect(resp.statusCode).toBe(401);
    });

    it('возвращает структурированную информацию после логина', async () => {
      const token = await server.loginAsAdmin();
      const resp = await server.app.inject({
        method: 'GET',
        url: '/api/server-info',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = resp.json() as {
        version: string;
        name: string;
        clients: number;
        tables: Record<string, number>;
      };
      expect(body.name).toMatch(/Storra/);
      expect(typeof body.version).toBe('string');
      expect(body.tables).toBeTypeOf('object');
      expect(body.tables.users).toBeGreaterThanOrEqual(1); // как минимум admin
    });
  });
});
