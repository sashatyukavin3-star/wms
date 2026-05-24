import {
ArrowDownToLine, ArrowLeftRight,
ArrowUpFromLine, BarChart3, Bell,   ClipboardCheck, ClipboardList, FileText, Inbox, Layers3, ListChecks, RotateCcw,   LayoutDashboard, LogOut,
MapPin, Menu, Monitor,   Moon, Package, Search, Settings,
ShoppingCart, Sun, Tag} from 'lucide-react';
import { createContext, type ReactNode,useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ConnectionBadge } from './components/ConnectionBadge';
import { HotkeysHelp } from './components/HotkeysHelp';
import { OfflineBadge } from './components/OfflineBadge';
import { StorraLogo } from './components/StorraLogo';
import { db, getSetting, initDefaults, setSetting } from './db';
import { api, apiPost, type AuthUser,getStoredUser, getToken, setStoredUser, setToken, setUnauthorizedHandler } from './lib/api';
import { registerSW } from './lib/pwa';
import { loadSoundSetting,playSound } from './lib/sounds';
import { fullSync,startSync } from './lib/sync';
import { restartWS,startWS, stopWS } from './lib/ws';
registerSW();
import { DataProvider } from './hooks/useData';
import Acts from './pages/Acts';
import Asn from './pages/Asn';
import Analytics from './pages/Analytics';
import Cells from './pages/Cells';
import Dashboard, { onDashboardNav } from './pages/Dashboard';
import CycleCount from './pages/CycleCount';
import Inventory from './pages/Inventory';
import Move from './pages/Move';
import Orders from './pages/Orders';
import Pick from './pages/Pick';
import Products from './pages/Products';
import Replenishment from './pages/Replenishment';
import Returns from './pages/Returns';
import Receive from './pages/Receive';
import SettingsPage from './pages/SettingsPage';
import Ship from './pages/Ship';
import Stickers from './pages/Stickers';

// ═══════════════════════════════════════════════════════════
// TOAST SYSTEM
// ═══════════════════════════════════════════════════════════

interface Toast {
  id: number;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  exiting?: boolean;
}

interface HeaderNotification {
  id: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  page: Page;
  ts: number;
  read: boolean;
}

let toastId = 0;
const toastListeners: ((toasts: Toast[]) => void)[] = [];
let currentToasts: Toast[] = [];

function notifyToasts() {
  toastListeners.forEach(l => l([...currentToasts]));
}

export function toast(type: Toast['type'], message: string, duration = 3500) {
  const id = ++toastId;
  currentToasts = [...currentToasts, { id, type, message }];
  notifyToasts();
  // Звуковой фидбек: success/error/warning/info — отключается через настройки
  try { playSound(type); } catch { /* noop */ }
  setTimeout(() => {
    currentToasts = currentToasts.map(t => t.id === id ? { ...t, exiting: true } : t);
    notifyToasts();
    setTimeout(() => {
      currentToasts = currentToasts.filter(t => t.id !== id);
      notifyToasts();
    }, 300);
  }, duration);
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    toastListeners.push(setToasts);
    return () => { const idx = toastListeners.indexOf(setToasts); if (idx >= 0) toastListeners.splice(idx, 1); };
  }, []);
  return toasts;
}

// ═══════════════════════════════════════════════════════════
// THEME CONTEXT
// ═══════════════════════════════════════════════════════════

interface AppContextType {
  theme: 'dark' | 'light';
  tsdMode: boolean;
  currentUser: AuthUser | null;
  hasRole: (role: AuthUser['role']) => boolean;
  canAccessPage: (page: Page) => boolean;
  toggleTheme: () => void;
  toggleTsd: () => void;
  refreshKey: number;
  triggerRefresh: () => void;
}

export const AppContext = createContext<AppContextType>({
  theme: 'dark', tsdMode: false, currentUser: null, hasRole: () => false, canAccessPage: () => true, toggleTheme: () => {}, toggleTsd: () => {},
  refreshKey: 0, triggerRefresh: () => {},
});

export const useApp = () => useContext(AppContext);

// ═══════════════════════════════════════════════════════════
// NAV ITEMS
// ═══════════════════════════════════════════════════════════

type Page = 'dashboard' | 'products' | 'cells' | 'asn' | 'replenishment' | 'returns' | 'cyclecount' | 'receive' | 'ship' | 'move' | 'inventory' | 'orders' | 'pick' | 'analytics' | 'acts' | 'stickers' | 'settings';

const NAV_ITEMS: { page: Page; icon: ReactNode; label: string; shortcut?: string; minRole?: AuthUser['role'] }[] = [
  { page: 'dashboard', icon: <LayoutDashboard size={20} />, label: 'Дашборд' },
  { page: 'products', icon: <Package size={20} />, label: 'Товары' },
  { page: 'cells', icon: <MapPin size={20} />, label: 'Ячейки' },
  { page: 'asn', icon: <Inbox size={20} />, label: 'ASN / Поставки' },
  { page: 'replenishment', icon: <Layers3 size={20} />, label: 'Пополнение' },
  { page: 'returns', icon: <RotateCcw size={20} />, label: 'Возвраты' },
  { page: 'cyclecount', icon: <ListChecks size={20} />, label: 'Cycle Count' },
  { page: 'receive', icon: <ArrowDownToLine size={20} />, label: 'Приёмка' },
  { page: 'ship', icon: <ArrowUpFromLine size={20} />, label: 'Отгрузка' },
  { page: 'move', icon: <ArrowLeftRight size={20} />, label: 'Перемещение' },
  { page: 'inventory', icon: <ClipboardCheck size={20} />, label: 'Инвентаризация' },
  { page: 'orders', icon: <ShoppingCart size={20} />, label: 'Заказы' },
  { page: 'pick', icon: <ClipboardList size={20} />, label: 'Комплектация' },
  { page: 'analytics', icon: <BarChart3 size={20} />, label: 'Аналитика', minRole: 'supervisor' },
  { page: 'acts', icon: <FileText size={20} />, label: 'Акты' },
  { page: 'stickers', icon: <Tag size={20} />, label: 'Стикеры' },
  { page: 'settings', icon: <Settings size={20} />, label: 'Настройки', minRole: 'admin' },
];

const ROLE_RANK: Record<AuthUser['role'], number> = {
  operator: 1,
  supervisor: 2,
  admin: 3,
};

// ═══════════════════════════════════════════════════════════
// APP COMPONENT
// ═══════════════════════════════════════════════════════════

export default function App() {
  // Страница берётся из URL (?page=orders) — это позволяет:
  //   • F5 не сбрасывает страницу на дашборд;
  //   • можно дать коллеге ссылку "http://server/?page=orders";
  //   • Back/Forward в браузере работают между разделами.
  const [page, setPage] = useState<Page>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const fromUrl = new URLSearchParams(window.location.search).get('page');
    const valid = ['dashboard','products','cells','asn','replenishment','returns','cyclecount','receive','ship','move','inventory','orders','pick','analytics','acts','stickers','settings'];
    return (fromUrl && valid.includes(fromUrl)) ? fromUrl as Page : 'dashboard';
  });

  // При навигации меняем URL без перезагрузки (history.pushState).
  // Это даёт honest browser history: можно вернуться кнопкой «назад».
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get('page');
    if (current !== page) {
      if (page === 'dashboard') url.searchParams.delete('page');
      else url.searchParams.set('page', page);
      window.history.replaceState(null, '', url.toString());
    }
  }, [page]);

  // Реагируем на browser back/forward — синхронизируем состояние с URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const fromUrl = new URLSearchParams(window.location.search).get('page');
      const valid = ['dashboard','products','cells','asn','replenishment','returns','cyclecount','receive','ship','move','inventory','orders','pick','analytics','acts','stickers','settings'];
      setPage((fromUrl && valid.includes(fromUrl)) ? fromUrl as Page : 'dashboard');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [tsdMode, setTsdMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; page: Page; title: string; subtitle: string }>>([]);
  const bellWrapRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const toasts = useToasts();

  useEffect(() => {
    // Главная цель: ВСЕГДА дойти до setInitialized(true), даже если что-то упадёт.
    // Иначе на не-HTTPS адресах (http://192.168.x.x) приложение зависало на splash,
    // потому что crypto.subtle недоступен и initDefaults()/ensureDefaultAdminUser() бросает.
    let cancelled = false;

    const initApp = async () => {
      // 1) Базовая инициализация (Dexie defaults + admin user локально).
      //    Падает на не-secure-context из-за crypto.subtle — это НЕ должно блокировать вход.
      try {
        await initDefaults();
      } catch (err) {
        console.warn('[Storra] initDefaults упал (это нормально на http://):', err);
      }

      // 2) Тема, ТСД-режим, звуки — каждый блок изолирован.
      try {
        const t = await getSetting('theme', 'dark');
        const tsd = await getSetting('tsd_mode', '0');
        if (!cancelled) {
          setTheme(t as 'dark' | 'light');
          setTsdMode(tsd === '1');
        }
      } catch (err) {
        console.warn('[Storra] чтение настроек упало:', err);
      }

      try { await loadSoundSetting(); } catch { /* noop */ }

      // 3) Восстановление сессии: проверяем JWT через GET /api/auth/me.
      try {
        const stored = getStoredUser();
        const token = getToken();
        if (stored && token) {
          if (!cancelled) setCurrentUser(stored);
          api<AuthUser>('/api/auth/me').then(u => {
            if (cancelled || !u) return;
            setCurrentUser(u);
            setStoredUser(u);
            startWS();
            startSync().catch(() => { /* noop */ });
          }).catch(() => {
            if (cancelled) return;
            setCurrentUser(null);
            setToken(null);
            setStoredUser(null);
          });
        }
      } catch (err) {
        console.warn('[Storra] восстановление сессии упало:', err);
      }

      // 4) Глобальный 401-обработчик.
      setUnauthorizedHandler(() => {
        setCurrentUser(null);
        stopWS();
        toast('warning', 'Сессия истекла, войдите снова');
      });

      // 5) ВСЕГДА показываем UI — даже если что-то выше упало.
      if (!cancelled) setInitialized(true);
    };

    // Жёсткий fallback: если за 8 секунд не дошли до setInitialized — всё равно показываем UI,
    // чтобы пользователь не залипал на splash-экране бесконечно.
    const fallback = setTimeout(() => {
      if (!cancelled) {
        console.warn('[Storra] init timeout — показываем UI принудительно');
        setInitialized(true);
      }
    }, 8000);

    initApp().finally(() => clearTimeout(fallback));

    return () => { cancelled = true; clearTimeout(fallback); };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-tsd', tsdMode ? '1' : '0');
  }, [theme, tsdMode]);

  const toggleTheme = useCallback(async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await setSetting('theme', next);
  }, [theme]);

  const toggleTsd = useCallback(async () => {
    const next = !tsdMode;
    setTsdMode(next);
    await setSetting('tsd_mode', next ? '1' : '0');
  }, [tsdMode]);

  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const hasRole = useCallback((role: AuthUser['role']) => {
    if (!currentUser) return false;
    return ROLE_RANK[currentUser.role] >= ROLE_RANK[role];
  }, [currentUser]);

  const canAccessPage = useCallback((target: Page) => {
    const item = NAV_ITEMS.find(n => n.page === target);
    if (!item || !item.minRole) return true;
    return hasRole(item.minRole);
  }, [hasRole]);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter(n => !n.minRole || hasRole(n.minRole)),
    [hasRole]
  );

  const login = useCallback(async () => {
    setLoginError('');
    setLoginLoading(true);
    try {
      const resp = await apiPost<{ token: string; user: AuthUser }>('/api/auth/login', {
        username: loginForm.username,
        password: loginForm.password,
      });
      setToken(resp.token);
      setStoredUser(resp.user);
      setCurrentUser(resp.user);
      restartWS();
      fullSync().catch(() => { /* noop */ });
      startSync().catch(() => { /* noop */ });
      setLoginForm({ username: '', password: '' });
      toast('success', `Вход выполнен: ${resp.user.full_name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка входа';
      setLoginError(msg);
    } finally {
      setLoginLoading(false);
    }
  }, [loginForm]);

  const logout = useCallback(async () => {
    const name = currentUser?.full_name || 'пользователь';
    try { await apiPost('/api/auth/logout'); } catch { /* noop */ }
    setToken(null);
    setStoredUser(null);
    setCurrentUser(null);
    stopWS();
    setNotifOpen(false);
    toast('info', `Вы вышли из системы: ${name}`);
  }, [currentUser]);

  const navigate = useCallback((p: Page) => {
    if (!canAccessPage(p)) {
      toast('warning', 'Недостаточно прав доступа');
      return;
    }
    setPage(p);
    setSidebarMobileOpen(false);
  }, [canAccessPage]);

  // Wire up Dashboard navigation (с корректным cleanup, чтобы не было утечки слушателей)
  useEffect(() => {
    const off = onDashboardNav((p) => setPage(p as Page));
    return off;
  }, []);

  useEffect(() => {
    if (!canAccessPage(page)) {
      setPage('dashboard');
    }
  }, [page, canAccessPage]);

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const loadNotifications = useCallback(async () => {
    const now = Date.now();
    const next: HeaderNotification[] = [];

    // Все 3 расчёта (новые заказы, дефицит, истекающий срок) делает сервер одним SQL.
    // Раньше клиент перебирал тысячи товаров и stock в браузере — это лагало.
    let alerts: { new_orders: number; stock_deficit: number; stock_expiring: number; expiry_warn_days: number };
    try {
      alerts = await api<typeof alerts>('/api/dashboard/alerts');
    } catch {
      // Сервер недоступен — пробуем рассчитать локально (медленно, но хоть что-то).
      const newOrdersLocal = await db.orders.where('status').equals('new').count();
      const stockRows = await db.stock.toArray();
      const expiryWarnDays = Number(await getSetting('expiry_warn_days', '30')) || 30;
      const edge = now + expiryWarnDays * 86400000;
      const expiringLocal = stockRows.filter(s => {
        if (!s.expiry_date) return false;
        const ts = new Date(s.expiry_date).getTime();
        return Number.isFinite(ts) && ts <= edge;
      }).length;
      alerts = { new_orders: newOrdersLocal, stock_deficit: 0, stock_expiring: expiringLocal, expiry_warn_days: expiryWarnDays };
    }

    if (alerts.new_orders > 0) {
      next.push({
        id: 'orders_new', level: 'info',
        title: 'Новые заказы', description: `Ожидают обработки: ${alerts.new_orders}`,
        page: 'orders', ts: now, read: false,
      });
    }
    if (alerts.stock_deficit > 0) {
      next.push({
        id: 'stock_deficit', level: 'warning',
        title: 'Дефицит остатков', description: `Товаров ниже min: ${alerts.stock_deficit}`,
        page: 'analytics', ts: now, read: false,
      });
    }
    if (alerts.stock_expiring > 0) {
      next.push({
        id: 'stock_expiring', level: 'error',
        title: 'Истекает срок годности', description: `Позиций в зоне риска: ${alerts.stock_expiring}`,
        page: 'analytics', ts: now, read: false,
      });
    }

    if (!navigator.onLine) {
      next.push({
        id: 'offline_mode',
        level: 'info',
        title: 'Офлайн-режим',
        description: 'Нет сети, работаем локально через IndexedDB',
        page: 'settings',
        ts: now,
        read: false,
      });
    }

    setNotifications(prev => {
      const prevRead = Object.fromEntries(prev.map(n => [n.id, n.read]));
      return next.map(n => ({ ...n, read: prevRead[n.id] ?? false }));
    });
  }, []);

  useEffect(() => {
    if (!initialized) return;
    loadNotifications();
    const t = setInterval(loadNotifications, 30000);
    return () => clearInterval(t);
  }, [initialized, loadNotifications]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!bellWrapRef.current?.contains(target)) setNotifOpen(false);
      if (!searchWrapRef.current?.contains(target)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const q = searchQ.trim();
      if (q.length < 2) {
        if (active) setSearchResults([]);
        return;
      }
      try {
        const res = await api<Array<{ id: string; page: Page; title: string; subtitle: string }>>('/api/search/global', { query: { q, limit: 12 } as any });
        if (active) setSearchResults(res.filter(r => canAccessPage(r.page)).slice(0, 12));
        return;
      } catch {
        const ql = q.toLowerCase();
        const [products, cells, orders] = await Promise.all([
          db.products.filter(p => !p.deleted && (p.barcode.toLowerCase().includes(ql) || p.name.toLowerCase().includes(ql))).limit(6).toArray(),
          db.cells.filter(c => c.addr.toLowerCase().includes(ql) || (c.zone || '').toLowerCase().includes(ql)).limit(4).toArray(),
          db.orders.filter(o => String(o.id).includes(ql) || (o.ext_id || '').toLowerCase().includes(ql) || (o.customer || '').toLowerCase().includes(ql)).limit(4).toArray(),
        ]);
        const fallback: Array<{ id: string; page: Page; title: string; subtitle: string }> = [
          ...products.map(p => ({ id: `p-${p.barcode}`, page: 'products' as Page, title: p.name, subtitle: `Товар · ${p.barcode}` })),
          ...cells.map(c => ({ id: `c-${c.addr}`, page: 'cells' as Page, title: c.addr, subtitle: `Ячейка · ${c.zone || 'без зоны'}` })),
          ...orders.map(o => ({ id: `o-${o.id}`, page: 'orders' as Page, title: `Заказ #${o.id}${o.ext_id ? ` / ${o.ext_id}` : ''}`, subtitle: `${o.customer || 'без клиента'} · ${o.status}` })),
        ].filter(r => canAccessPage(r.page));
        if (active) setSearchResults(fallback.slice(0, 10));
      }
    };
    run();
    return () => { active = false; };
  }, [searchQ, canAccessPage]);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const openNotification = useCallback((n: HeaderNotification) => {
    setPage(n.page);
    setNotifOpen(false);
    setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const map: Record<string, Page> = {
        'F1': 'receive', 'F2': 'ship', 'F3': 'move', 'F4': 'inventory',
        'F5': 'orders', 'F6': 'analytics', 'F7': 'acts', 'F8': 'stickers',
        'F9': 'settings', 'F10': 'pick', 'F11': 'dashboard',
      };
      if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  if (!initialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-nexus-bg">
        <div className="text-center animate-fadeIn">
          <div className="animate-pulse-glow inline-block rounded-2xl mb-5">
            <StorraLogo size={88} showText={false} />
          </div>
          <div className="font-extrabold text-3xl tracking-wide" style={{ color: '#1e3a5c' }}>STORRA</div>
          <div className="font-medium text-sm mt-1.5" style={{ color: '#5ba9b8', letterSpacing: '0.05em' }}>Warehouse Management System</div>
          <div className="mt-6 w-56 h-1 bg-nexus-surface2 rounded mx-auto overflow-hidden">
            <div className="h-full rounded" style={{ animation: 'shimmer 1.5s infinite', width: '60%', background: 'linear-gradient(90deg, #5fb6d9, #3a8ab0)' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginScreen
        form={loginForm}
        setForm={setLoginForm}
        error={loginError}
        loading={loginLoading}
        onSubmit={login}
      />
    );
  }

  const ctx: AppContextType = { theme, tsdMode, currentUser, hasRole, canAccessPage, toggleTheme, toggleTsd, refreshKey, triggerRefresh };

  return (
    <AppContext.Provider value={ctx}>
      <DataProvider>
      <div className="h-screen flex overflow-hidden bg-nexus-bg">
        {/* Sidebar */}
        <aside className={`
          ${sidebarMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:relative fixed inset-y-0 left-0 z-50
          ${sidebarOpen ? 'w-60' : 'w-16'}
          bg-nexus-surface border-r border-nexus-border flex flex-col transition-all duration-300
        `}>
          {/* Logo */}
          <div className={`h-16 flex items-center ${sidebarOpen ? 'px-5' : 'px-3 justify-center'} border-b border-nexus-border flex-shrink-0`}>
            {sidebarOpen
              ? <StorraLogo size={34} tagline="WMS" />
              : <StorraLogo size={34} showText={false} />
            }
          </div>

          {/* Nav Items */}
          <nav className="flex-1 overflow-y-auto py-2 px-2">
            {visibleNavItems.map(item => {
              const active = page === item.page;
              return (
                <button
                  key={item.page}
                  onClick={() => navigate(item.page)}
                  className={`
                    w-full flex items-center gap-3 rounded-xl transition-all duration-200 mb-0.5
                    ${sidebarOpen ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center'}
                    ${active
                      ? 'bg-nexus-accent/15 text-nexus-accent2 shadow-sm'
                      : 'text-nexus-text3 hover:bg-nexus-surface2 hover:text-nexus-text'}
                  `}
                  title={item.label}
                >
                  <span className={active ? 'text-nexus-accent' : ''}>{item.icon}</span>
                  {sidebarOpen && <span className="text-[13px] font-medium truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Bottom */}
          <div className={`border-t border-nexus-border p-2 flex flex-col gap-1`}>
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-nexus-text3 hover:bg-nexus-surface2 hover:text-nexus-text transition-all ${!sidebarOpen ? 'justify-center px-0' : ''}`}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              {sidebarOpen && <span className="text-[13px]">{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>}
            </button>
            <button
              onClick={toggleTsd}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${tsdMode ? 'bg-nexus-accent/15 text-nexus-accent2' : 'text-nexus-text3 hover:bg-nexus-surface2 hover:text-nexus-text'} ${!sidebarOpen ? 'justify-center px-0' : ''}`}
              title="Режим ТСД"
            >
              <Monitor size={18} />
              {sidebarOpen && <span className="text-[13px]">ТСД {tsdMode ? 'ON' : 'OFF'}</span>}
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`hidden lg:flex items-center gap-3 rounded-xl px-3 py-2.5 text-nexus-text3 hover:bg-nexus-surface2 hover:text-nexus-text transition-all ${!sidebarOpen ? 'justify-center px-0' : ''}`}
            >
              <Menu size={18} />
              {sidebarOpen && <span className="text-[13px]">Свернуть</span>}
            </button>
            <div className={`mt-2 pt-2 border-t border-nexus-border/50 ${sidebarOpen ? 'px-3' : 'text-center'}`}>
              <div className={`text-nexus-text3/40 text-[9px] ${sidebarOpen ? '' : 'hidden'}`}>Storra WMS</div>
            </div>
          </div>
        </aside>

        {/* Overlay for mobile */}
        {sidebarMobileOpen && (
          <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarMobileOpen(false)} />
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="h-16 bg-nexus-surface border-b border-nexus-border flex items-center px-4 gap-4 flex-shrink-0">
            <button className="lg:hidden text-nexus-text3 hover:text-nexus-text" onClick={() => setSidebarMobileOpen(true)}>
              <Menu size={22} />
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-nexus-text font-bold text-lg">
                 {NAV_ITEMS.find(n => n.page === page)?.label || 'Storra WMS'}
              </h1>
              <span className="hidden sm:inline text-nexus-text3 text-xs ml-2 px-2 py-0.5 rounded bg-nexus-surface2 border border-nexus-border/50 uppercase tracking-wider">Storra</span>
            </div>
            <div className="ml-auto flex items-center gap-3"><ConnectionBadge />
              <div className="hidden sm:block relative" ref={searchWrapRef}>
                <div className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 min-w-[260px]">
                  <Search size={16} className="text-nexus-text3" />
                  <input
                    value={searchQ}
                    onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    placeholder="Быстрый поиск: товар, ячейка, заказ..."
                    className="bg-transparent text-nexus-text text-sm w-56 lg:w-80 outline-none placeholder:text-nexus-text3"
                  />
                </div>

                {searchOpen && (
                  <div className="absolute top-11 right-0 z-50 w-[420px] bg-nexus-surface border border-nexus-border rounded-xl shadow-2xl overflow-hidden">
                    {searchQ.trim().length < 2 ? (
                      <div className="px-4 py-4 text-sm text-nexus-text3">Введите минимум 2 символа для поиска</div>
                    ) : searchResults.length === 0 ? (
                      <div className="px-4 py-4 text-sm text-nexus-text3">Ничего не найдено</div>
                    ) : (
                      <div className="max-h-80 overflow-y-auto">
                        {searchResults.map(item => (
                          <button
                            key={item.id}
                            onClick={() => {
                              navigate(item.page);
                              setSearchOpen(false);
                            }}
                            className="w-full text-left px-4 py-3 border-b border-nexus-border/50 last:border-0 hover:bg-nexus-surface2"
                          >
                            <div className="text-sm text-nexus-text font-medium truncate">{item.title}</div>
                            <div className="text-xs text-nexus-text3">{item.subtitle}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="relative" ref={bellWrapRef}>
                <button
                  onClick={() => setNotifOpen(v => !v)}
                  className={`relative text-nexus-text3 hover:text-nexus-text transition-colors ${notifOpen ? 'text-nexus-text' : ''}`}
                  title="Уведомления"
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 bg-red-500 text-white rounded-full text-[10px] leading-4 text-center font-bold">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 top-8 z-50 w-80 bg-nexus-surface border border-nexus-border rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-nexus-border flex items-center justify-between">
                      <div className="text-sm font-semibold text-nexus-text">Уведомления</div>
                      <button onClick={markAllNotificationsRead} className="text-xs text-nexus-text3 hover:text-nexus-text">Прочитать все</button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-nexus-text3">Событий нет</div>
                      ) : (
                        notifications.map(n => (
                          <button
                            key={n.id}
                            onClick={() => openNotification(n)}
                            className={`w-full text-left px-3 py-2.5 border-b border-nexus-border/50 hover:bg-nexus-surface2 transition-colors ${n.read ? 'opacity-70' : ''}`}
                          >
                            <div className="flex items-start gap-2">
                              <span className={`mt-1 w-2 h-2 rounded-full ${n.level === 'error' ? 'bg-red-400' : n.level === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                              <div className="min-w-0">
                                <div className="text-sm text-nexus-text font-medium truncate">{n.title}</div>
                                <div className="text-xs text-nexus-text3">{n.description}</div>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-nexus-accent to-nexus-accent2 flex items-center justify-center text-white text-xs font-bold" title={`${currentUser.full_name} (${currentUser.role})`}>
                  {(currentUser.full_name || currentUser.username).split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <button onClick={logout} className="text-nexus-text3 hover:text-nexus-text" title="Выйти">
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <div className="flex-1 overflow-auto p-4 lg:p-6">
            <div className="animate-fadeIn">
              {canAccessPage(page) ? <PageRenderer page={page} /> : <AccessDenied />}
            </div>
          </div>
        </main>

        {/* Global hotkeys help (?) */}
        <HotkeysHelp />

        {/* Offline indicator */}
        <OfflineBadge />

        {/* Toast Container */}
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`
                pointer-events-auto px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 min-w-[280px] max-w-[400px]
                ${t.exiting ? 'toast-exit' : 'toast-enter'}
                ${t.type === 'success' ? 'bg-green-900/90 border border-green-700/50 text-green-100' : ''}
                ${t.type === 'error' ? 'bg-red-900/90 border border-red-700/50 text-red-100' : ''}
                ${t.type === 'warning' ? 'bg-amber-900/90 border border-amber-700/50 text-amber-100' : ''}
                ${t.type === 'info' ? 'bg-blue-900/90 border border-blue-700/50 text-blue-100' : ''}
              `}
            >
              <span className="text-lg">
                {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : t.type === 'warning' ? '⚠' : 'ℹ'}
              </span>
              <span className="text-sm font-medium flex-1">{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    </DataProvider>
    </AppContext.Provider>
  );
}

function LoginScreen({
  form,
  setForm,
  error,
  loading,
  onSubmit,
}: {
  form: { username: string; password: string };
  setForm: (v: { username: string; password: string }) => void;
  error: string;
  loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="h-screen bg-nexus-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Декоративные градиенты на фоне */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-nexus-accent/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-nexus-accent/20 blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-nexus-surface border border-nexus-border rounded-2xl p-7 animate-scaleIn shadow-2xl">
        <div className="text-center mb-6">
          <StorraLogo size={72} showText={false} className="mx-auto mb-4" />
          <div className="text-3xl font-extrabold tracking-wide" style={{ color: '#1e3a5c' }}>STORRA</div>
          <div className="font-medium text-sm mt-1.5" style={{ color: '#5ba9b8', letterSpacing: '0.05em' }}>Warehouse Management System</div>
          <div className="mt-4 inline-block text-nexus-text3/70 text-xs px-3 py-1 rounded-full bg-nexus-surface2 border border-nexus-border/50">
            По умолчанию: <span className="font-mono text-nexus-text2">admin</span> / <span className="font-mono text-nexus-text2">admin123</span>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-nexus-text3 mb-1 block">Логин</label>
            <input
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              placeholder="Введите логин"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm"
              onKeyDown={e => e.key === 'Enter' && onSubmit()}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-nexus-text3 mb-1 block">Пароль</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="Введите пароль"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm"
              onKeyDown={e => e.key === 'Enter' && onSubmit()}
            />
          </div>

          {error && <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">{error}</div>}

          <button
            onClick={onSubmit}
            disabled={loading || !form.username.trim() || !form.password.trim()}
            className="w-full bg-nexus-accent hover:bg-nexus-accent2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-2.5 text-sm font-bold"
          >
            {loading ? 'Проверка...' : 'Войти'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="h-[70vh] flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-3">🔒</div>
        <h2 className="text-xl font-bold text-nexus-text mb-2">Доступ ограничен</h2>
        <p className="text-nexus-text3 text-sm">У вашей роли нет прав для этого раздела. Обратитесь к администратору.</p>
      </div>
    </div>
  );
}

function PageRenderer({ page }: { page: Page }) {
  const pages: Record<Page, ReactNode> = {
    dashboard: <Dashboard />,
    products: <Products />,
    cells: <Cells />,
    asn: <Asn />,
    replenishment: <Replenishment />,
    returns: <Returns />,
    cyclecount: <CycleCount />,
    receive: <Receive />,
    ship: <Ship />,
    move: <Move />,
    inventory: <Inventory />,
    orders: <Orders />,
    pick: <Pick />,
    analytics: <Analytics />,
    acts: <Acts />,
    stickers: <Stickers />,
    settings: <SettingsPage />,
  };
  return pages[page] || <Dashboard />;
}
