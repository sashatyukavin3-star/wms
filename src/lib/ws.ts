/**
 * WebSocket-клиент к Storra WMS Server.
 * Автоматически переподключается при обрыве.
 *
 * Слушает события вида:
 *   { type: 'stock:changed', barcode, cell }
 *   { type: 'product:changed', barcode }
 *   ...
 * И диспатчит их подписчикам по типу.
 */

import { getApiBase, getToken } from './api';

export type WSEvent =
  | { type: 'welcome'; ts: number }
  | { type: 'stock:changed'; barcode?: string; cell?: string }
  | { type: 'product:changed'; barcode?: string }
  | { type: 'cell:changed'; addr?: string }
  | { type: 'order:changed'; id?: number }
  | { type: 'order_line:changed'; order_id?: number; id?: number }
  | { type: 'reservation:changed'; order_id?: number }
  | { type: 'inv:changed'; session_id?: number }
  | { type: 'act:changed'; kind: 'inspection' | 'rework'; id?: number }
  | { type: 'op:created'; op_type: string }
  | { type: 'user:changed' }
  | { type: 'audit:new' }
  | { type: 'asn:changed'; id?: number }
  | { type: 'return:changed'; id?: number }
  | { type: 'cycle_count:changed'; id?: number };

type Listener = (e: WSEvent) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let started = false;
let connected = false;
const connListeners = new Set<(c: boolean) => void>();

function wsUrl(): string {
  const base = getApiBase();
  // http://host:3000 → ws://host:3000/api/ws
  const u = new URL(base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/api/ws';
  const token = getToken();
  if (token) u.searchParams.set('token', token);
  return u.toString();
}

function notifyConnection(c: boolean) {
  if (connected === c) return;
  connected = c;
  connListeners.forEach(fn => fn(c));
}

// Последняя ошибка / диагностика — чтобы показывать в UI.
let lastError: string | null = null;
let lastUrl: string | null = null;
let connectAttempts = 0;

export function getWSDiagnostics() {
  return {
    url: lastUrl,
    lastError,
    attempts: connectAttempts,
    readyState: ws?.readyState ?? -1,
  };
}

function connect() {
  cleanup();
  let url: string;
  try { url = wsUrl(); } catch (e: any) {
    lastError = `Не удалось собрать URL: ${e?.message || e}`;
    console.warn('[Storra WS]', lastError);
    return scheduleReconnect();
  }
  lastUrl = url;
  connectAttempts++;
  console.log(`[Storra WS] подключаюсь к ${url} (попытка ${connectAttempts})`);

  try {
    ws = new WebSocket(url);
  } catch (e: any) {
    lastError = `WebSocket конструктор бросил: ${e?.message || e}`;
    console.warn('[Storra WS]', lastError);
    return scheduleReconnect();
  }

  // Watchdog: если за 10 секунд не открылись — закрываем и переподключаемся.
  // Иначе соединение может зависнуть в pending бесконечно (бывает за прокси).
  const watchdog = setTimeout(() => {
    if (ws && ws.readyState !== WebSocket.OPEN) {
      lastError = 'Таймаут подключения (10с) — закрываю и пробую снова';
      console.warn('[Storra WS]', lastError);
      try { ws.close(); } catch { /* noop */ }
    }
  }, 10000);

  ws.onopen = () => {
    clearTimeout(watchdog);
    reconnectDelay = 1000;
    lastError = null;
    console.log('[Storra WS] ✓ подключено');
    notifyConnection(true);
  };

  ws.onmessage = ev => {
    let evt: WSEvent | null = null;
    try { evt = JSON.parse(ev.data); } catch { return; }
    if (!evt) return;
    listeners.forEach(fn => {
      try { fn(evt!); } catch { /* noop */ }
    });
  };

  ws.onerror = (e) => {
    clearTimeout(watchdog);
    lastError = 'Ошибка WebSocket (см. консоль)';
    console.warn('[Storra WS] error:', e);
  };

  ws.onclose = (e) => {
    clearTimeout(watchdog);
    if (!lastError) lastError = `Соединение закрыто (code ${e.code}${e.reason ? ', ' + e.reason : ''})`;
    console.warn('[Storra WS] закрыто:', e.code, e.reason);
    notifyConnection(false);
    if (started) scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (!started) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.7, 15000); // экспоненциальный backoff до 15с
}

function cleanup() {
  if (ws) {
    try {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      if (ws.readyState !== WebSocket.CLOSED) ws.close();
    } catch { /* noop */ }
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/** Запустить подключение. Можно вызывать многократно. */
export function startWS() {
  if (started) return;
  started = true;
  connect();
}

/** Полностью остановить и сбросить состояние. */
export function stopWS() {
  started = false;
  cleanup();
  notifyConnection(false);
}

/** Переподключиться (например, после смены токена). */
export function restartWS() {
  if (!started) { startWS(); return; }
  reconnectDelay = 500;
  cleanup();
  connect();
}

/** Подписаться на все события. Возвращает функцию отписки. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Подписаться только на события определённого типа. */
export function subscribeType<T extends WSEvent['type']>(
  type: T,
  fn: (e: Extract<WSEvent, { type: T }>) => void
): () => void {
  return subscribe(e => {
    if (e.type === type) fn(e as Extract<WSEvent, { type: T }>);
  });
}

/** Подписаться на изменение статуса соединения. */
export function subscribeConnection(fn: (connected: boolean) => void): () => void {
  connListeners.add(fn);
  fn(connected);
  return () => connListeners.delete(fn);
}

export function isConnected(): boolean {
  return connected;
}
