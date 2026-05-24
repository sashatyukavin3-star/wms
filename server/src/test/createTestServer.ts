/**
 * Хелпер для создания изолированного тестового Fastify-сервера.
 *
 * Зачем:
 *  - Каждый тест должен начинаться с чистой БД (иначе тесты влияют друг на друга).
 *  - Не хотим писать на диск во время тестов (медленно + мусор).
 *  - Хотим иметь возможность залить только нужные таблицы / данные.
 *
 * Как:
 *  - Создаём in-memory SQLite (`:memory:`) — живёт только в RAM.
 *  - Накатываем все DDL миграции.
 *  - Регистрируем все роуты.
 *  - Возвращаем `app` (Fastify) + `db` (Drizzle) + `sqlite` (для прямых SQL при необходимости).
 *
 * После теста: `await app.close()` — освобождает порт и закрывает соединения.
 *
 * Замечание: миграции в migrate.ts работают через импорт глобального `sqlite`,
 * поэтому в тестах нам нужно либо использовать тот же глобальный (с риском shared state),
 * либо переписать миграции на принимающие connection. Сейчас выбираем первый вариант
 * с осторожностью: pool: forks + singleFork в vitest.config.ts гарантирует
 * последовательное выполнение, и `clearAllTables()` сбрасывает данные между тестами.
 */
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import { db,sqlite } from '../db/index.ts';
import { migrate } from '../db/migrate.ts';
import { seed } from '../db/seed.ts';
import { actsRoutes } from '../routes/acts.ts';
import { asnRoutes } from '../routes/asn.ts';
import { authRoutes } from '../routes/auth.ts';
import { cellsRoutes } from '../routes/cells.ts';
import { cycleCountRoutes } from '../routes/cycleCount.ts';
import { integrationsRoutes } from '../routes/integrations.ts';
import { inventoryRoutes } from '../routes/inventory.ts';
import { miscRoutes } from '../routes/misc.ts';
import { ordersRoutes } from '../routes/orders.ts';
import { replenishmentRoutes } from '../routes/replenishment.ts';
import { returnsRoutes } from '../routes/returns.ts';
import { productsRoutes } from '../routes/products.ts';
import { stockRoutes } from '../routes/stock.ts';
import { searchRoutes } from '../routes/search.ts';

const TEST_JWT_SECRET = 'test-only-secret-do-not-use-in-prod-' + 'x'.repeat(32);

/** Имена всех таблиц приложения — для clearAllTables. */
const ALL_TABLE_NAMES = [
  'audit_log',
  'asn_lines',
  'asns',
  'cycle_count_lines',
  'cycle_counts',
  'return_lines',
  'returns',
  'reservations',
  'order_lines',
  'orders',
  'inv_lines',
  'inv_sessions',
  'ops',
  'batches',
  'stock',
  'sticker_jobs',
  'rework_acts',
  'inspection_acts',
  'cells',
  'products',
  'settings',
  'users',
] as const;

export interface TestServer {
  app: FastifyInstance;
  /** Drizzle DB instance (доступ к тем же таблицам). */
  db: typeof db;
  /** Прямой better-sqlite3 instance (для произвольных SQL в тестах). */
  sqlite: typeof sqlite;
  /** Авторизация: возвращает токен для пользователя admin. */
  loginAsAdmin(): Promise<string>;
  /** Авторизация под произвольным пользователем. */
  loginAs(username: string, password: string): Promise<string>;
  /** Чистит все таблицы и пересоздаёт seed (admin/admin123). */
  reset(): Promise<void>;
  /** Закрывает сервер. Обязательно вызывать в afterEach/afterAll. */
  close(): Promise<void>;
}

/**
 * Создаёт новый тестовый сервер.
 * @param opts.seed — если false, не создаёт дефолтного админа (тестируем чистое состояние)
 */
export async function createTestServer(opts: { seed?: boolean } = {}): Promise<TestServer> {
  // 1. БД — миграции на shared in-memory (см. комментарий вверху файла)
  migrate();
  if (opts.seed !== false) {
    await seed();
  }

  // 2. Fastify (logger выключен — не засоряем вывод тестов)
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true, credentials: true });
  await app.register(fastifyJwt, { secret: TEST_JWT_SECRET, sign: { expiresIn: '1h' } });
  await app.register(fastifyWebsocket);

  await app.register(authRoutes);
  await app.register(asnRoutes);
  await app.register(productsRoutes);
  await app.register(cellsRoutes);
  await app.register(stockRoutes);
  await app.register(ordersRoutes);
  await app.register(replenishmentRoutes);
  await app.register(returnsRoutes);
  await app.register(actsRoutes);
  await app.register(miscRoutes);
  await app.register(integrationsRoutes);
  await app.register(searchRoutes);
  await app.register(cycleCountRoutes);
  await app.register(inventoryRoutes);

  await app.ready();

  const server: TestServer = {
    app,
    db,
    sqlite,

    async loginAsAdmin() {
      return server.loginAs('admin', 'admin123');
    },

    async loginAs(username, password) {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username, password },
      });
      if (resp.statusCode !== 200) {
        throw new Error(`Login failed: ${resp.statusCode} ${resp.payload}`);
      }
      const { token } = resp.json() as { token: string };
      return token;
    },

    async reset() {
      // Чистим в обратном порядке зависимостей (FK безопасно)
      for (const table of ALL_TABLE_NAMES) {
        sqlite.exec(`DELETE FROM ${table}`);
      }
      // Сбрасываем автоинкременты, чтобы id были предсказуемыми
      sqlite.exec(`DELETE FROM sqlite_sequence`);
      if (opts.seed !== false) {
        await seed();
      }
    },

    async close() {
      await app.close();
    },
  };

  return server;
}

/**
 * Удобный хелпер для запросов с авторизацией.
 * Возвращает результат app.inject() с уже выставленным Bearer.
 */
export function authedRequest(
  app: FastifyInstance,
  token: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: object | string }
) {
  return app.inject({
    method: init.method,
    url: init.url,
    payload: init.payload,
    headers: { Authorization: `Bearer ${token}` },
  });
}
