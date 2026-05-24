/**
 * Тесты для api.ts — критичная инфраструктура HTTP-клиента.
 *
 * Покрывает регрессию: «на втором ПК WebSocket не подключается».
 * Корневая причина была в getApiBase(): он возвращал устаревший
 * http://localhost из localStorage, даже когда страница открыта по сетевому IP.
 *
 * Эти тесты гарантируют, что фикс работает и не сломается при будущих правках.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getApiBase, resetApiBase, setApiBase } from '../api';

describe('getApiBase()', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('возвращает window.location.origin когда localStorage пуст', () => {
    // jsdom по умолчанию даёт http://localhost — это и есть наш origin
    expect(getApiBase()).toBe(window.location.origin);
  });

  it('возвращает сохранённое значение из localStorage когда оно валидно', () => {
    setApiBase('http://10.162.0.167:3000');
    // Имитируем что страница тоже открыта по этому IP — иначе сработает фикс
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hostname: '10.162.0.167', protocol: 'http:', origin: 'http://10.162.0.167:3000' },
    });
    expect(getApiBase()).toBe('http://10.162.0.167:3000');
  });

  it('ИГНОРИРУЕТ localhost из localStorage когда страница открыта по сетевому IP', () => {
    // Сценарий: на ПК-2 в localStorage случайно осталось http://localhost:3000
    // (например, после dev-режима). Страница открыта по http://10.162.0.20:3000.
    // Старый код возвращал localhost — WebSocket уходил на свой ПК, висел навсегда.
    // Фикс: игнорируем localhost когда хост текущей страницы — сетевой IP.
    setApiBase('http://localhost:3000');
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hostname: '10.162.0.20',
        protocol: 'http:',
        origin: 'http://10.162.0.20:3000',
      },
    });
    expect(getApiBase()).toBe('http://10.162.0.20:3000');
  });

  it('ИГНОРИРУЕТ 127.0.0.1 из localStorage когда страница открыта по сетевому IP', () => {
    setApiBase('http://127.0.0.1:3000');
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hostname: '192.168.1.50',
        protocol: 'http:',
        origin: 'http://192.168.1.50:3000',
      },
    });
    expect(getApiBase()).toBe('http://192.168.1.50:3000');
  });

  it('НЕ игнорирует localhost когда страница тоже открыта по localhost', () => {
    // На самом сервере страница и localStorage оба = localhost — это нормально
    setApiBase('http://localhost:3000');
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:3000' },
    });
    expect(getApiBase()).toBe('http://localhost:3000');
  });

  it('resetApiBase() очищает сохранённое значение', () => {
    setApiBase('http://example.com:3000');
    resetApiBase();
    expect(getApiBase()).toBe(window.location.origin);
  });

  it('защищается от поломанного localStorage (throw)', () => {
    // Если localStorage недоступен (privacy mode, квота переполнена) — не должны падать
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('Storage disabled');
    });
    try {
      expect(() => getApiBase()).not.toThrow();
      expect(getApiBase()).toBe(window.location.origin);
    } finally {
      Storage.prototype.getItem = originalGetItem;
    }
  });
});
