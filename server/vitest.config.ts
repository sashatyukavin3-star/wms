import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration для сервера.
 *
 * Серверные тесты бегут в node-окружении (без jsdom).
 * Каждый тест получает свежий Fastify-инстанс и in-memory SQLite БД
 * через createTestServer.ts — это даёт полную изоляцию между тестами.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 10_000,
    // Не запускаем тесты параллельно — каждый тест держит своё in-memory SQLite,
    // но shared-state (env, кэши) может пересекаться, безопаснее последовательно.
    globalSetup: ['./src/test/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/**/__tests__/**',
        'src/test/**',
        'src/index.ts', // bootstrap-файл, покрывается интеграционно
      ],
    },
  },
});
