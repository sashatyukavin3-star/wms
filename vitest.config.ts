import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest configuration для клиента.
 *
 * Зачем jsdom: тесты компонентов / lib используют document, window, localStorage —
 * это нужно эмулировать в Node-окружении. jsdom — стандарт де-факто и стабильнее happy-dom.
 *
 * setupFiles: глобальные вещи для всех тестов (моки matchMedia, ResizeObserver, и т.п.).
 *
 * Покрытие через v8 (нативный, не нужен Istanbul). Считаем покрытие только по src/,
 * исключая *.tsx-страницы (их тестировать e2e, а не unit'ом) и автогенерированные файлы.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false, // CSS не парсим — для unit-тестов не нужно
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/test/**',
        'src/main.tsx',
        'src/pages/**', // страницы покрываем e2e-тестами (позже), не unit'ом
      ],
    },
  },
});
