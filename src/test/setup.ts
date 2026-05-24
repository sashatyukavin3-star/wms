/**
 * Глобальный setup для всех тестов клиента (Vitest + jsdom).
 *
 * Подключает:
 *  - @testing-library/jest-dom — кастомные матчеры (toBeInTheDocument и т.п.)
 *  - полифилы / моки для API, которых нет в jsdom (matchMedia, IntersectionObserver,
 *    ResizeObserver, scrollIntoView) — иначе компоненты, использующие их, падают.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// ── Cleanup React-tree после каждого теста (изоляция) ─────────
afterEach(() => {
  cleanup();
});

// ── Мок matchMedia (некоторые компоненты используют для prefers-color-scheme) ──
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ── Мок IntersectionObserver (jsdom не реализует) ─────────────
class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// ── Мок ResizeObserver ────────────────────────────────────────
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// ── Мок scrollIntoView ────────────────────────────────────────
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
