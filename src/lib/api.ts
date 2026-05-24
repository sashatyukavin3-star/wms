/**
 * Тонкий HTTP-клиент к Storra WMS Server.
 *
 * Возможности:
 *  - Автоматический Authorization: Bearer <token>
 *  - Единая обработка ошибок (бросает Error с понятным сообщением)
 *  - Авто-определение base URL (та же origin, что фронт)
 *  - Сохранение токена в localStorage между перезагрузками
 *  - Реагирует на 401 → выкидывает на логин
 */

const TOKEN_KEY = 'storra_token_v1';
const USER_KEY = 'storra_user_v1';

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: 'operator' | 'supervisor' | 'admin';
  active?: boolean;
}

interface ApiOpts<B = unknown> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: B;
  query?: Record<string, string | number | undefined>;
  /** Куда отправить запрос. По умолчанию — та же origin, что фронт. */
  baseUrl?: string;
  /** Если true — при 401 не выкидываем на логин (нужно для самого логина). */
  silent401?: boolean;
  /** Таймаут запроса (мс). */
  timeoutMs?: number;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// ─── Token / user storage ──────────────────────────────────
export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* noop */ }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch { return null; }
}

export function setStoredUser(u: AuthUser | null): void {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch { /* noop */ }
}

// ─── Base URL ──────────────────────────────────────────────
/** По умолчанию: та же origin, что фронт (когда сервер раздаёт и фронт). */
export function getDefaultBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  // Если открыт file://, по умолчанию ходим в localhost — пользователь сам переопределит.
  if (window.location.protocol === 'file:') return 'http://localhost:3000';
  return window.location.origin;
}

const API_BASE_KEY = 'storra_api_base_v1';

/**
 * Возвращает текущий API base URL.
 *
 * ВАЖНО: на другом ПК в `localStorage` может «застрять» старый URL (например,
 * `http://localhost:3000` от dev-сборки). Это приводит к тому, что HTTP-запросы
 * ещё могут пройти, а WebSocket уходит на чужой ПК и зависает.
 *
 * Поэтому: если сохранённый base указывает на `localhost` / `127.0.0.1`,
 * а сама страница открыта по другому адресу (например, 192.168.1.X),
 * то сохранённое значение игнорируется. Так клиент гарантированно работает
 * через ту же origin, что и фронт.
 */
export function getApiBase(): string {
  try {
    const saved = localStorage.getItem(API_BASE_KEY);
    if (saved) {
      if (typeof window !== 'undefined' && window.location.protocol !== 'file:') {
        const here = window.location.hostname;
        const isHereLocal = here === 'localhost' || here === '127.0.0.1';
        const savedIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(saved);
        // Страница открыта по сетевому IP, а в LS сохранён localhost — отбрасываем.
        if (savedIsLocal && !isHereLocal) {
          console.warn('[Storra] игнорирую устаревший API base из localStorage:', saved, '→ использую', window.location.origin);
          return window.location.origin;
        }
      }
      return saved;
    }
  } catch { /* noop */ }
  return getDefaultBaseUrl();
}

export function setApiBase(url: string | null): void {
  try {
    if (url) localStorage.setItem(API_BASE_KEY, url.replace(/\/+$/, ''));
    else localStorage.removeItem(API_BASE_KEY);
  } catch { /* noop */ }
}

/** Принудительный сброс настроек подключения — на случай, если что-то «застряло». */
export function resetApiBase(): void {
  setApiBase(null);
}

// ─── Core request ──────────────────────────────────────────
export async function api<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const base = (opts.baseUrl ?? getApiBase()).replace(/\/+$/, '');

  // Сборка query
  let url = base + path;
  if (opts.query) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) search.set(k, String(v));
    }
    const s = search.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('Превышено время ожидания запроса', 0);
    }
    throw new ApiError('Не удалось подключиться к серверу', 0);
  } finally {
    clearTimeout(timeout);
  }

  if (resp.status === 401 && !opts.silent401) {
    setToken(null);
    setStoredUser(null);
    onUnauthorized?.();
    throw new ApiError('Сессия истекла. Войдите снова.', 401);
  }

  const contentType = resp.headers.get('Content-Type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await resp.json().catch(() => null) : await resp.text().catch(() => null);

  if (!resp.ok) {
    const message = (isJson && data && typeof data === 'object' && 'error' in data)
      ? String((data as { error: unknown }).error)
      : `HTTP ${resp.status}`;
    throw new ApiError(message, resp.status, data);
  }

  return data as T;
}

export class ApiError extends Error {
  status: number;
  payload?: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

// ─── Удобные обёртки ───────────────────────────────────────
export const apiGet = <T>(path: string, query?: ApiOpts['query']) => api<T>(path, { method: 'GET', query });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiDelete = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

// ─── Проверка доступности сервера ──────────────────────────
export interface ServerHealth {
  ok: boolean;
  ts: number;
  clients: number;
}

export async function pingServer(baseUrl?: string): Promise<ServerHealth> {
  return api<ServerHealth>('/api/health', {
    method: 'GET',
    baseUrl,
    silent401: true,
    timeoutMs: 5000,
  });
}
