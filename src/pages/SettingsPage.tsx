import { Clock, Database, Download, FileText, HardDrive, Info, RefreshCw, Settings as SettingsIcon, Shield, Trash2, Upload, UserCog, UserPlus, Volume2, VolumeX,Zap } from 'lucide-react';
import { useEffect, useRef,useState } from 'react';

import { toast } from '../App';
import { useApp } from '../App';
import {
  type AuditLog,
  type AuthUser,
  clearAudit,
  createAuthUser,
  db,
  deleteAuthUser,
  fullBackup,
  getDBStats,
  getSetting,
  listAudit,
  listAuthUsers,
  restoreBackup,
  setSetting,
  updateAuthUser,
} from '../db';
import { useData } from '../hooks/useData';
import { downloadXLS } from '../lib/excel';
import { cellsApi, opsApi, productsApi, serverApi, settingsApi } from '../lib/services';
import { setSoundEnabled } from '../lib/sounds';
import { downloadFile, exportToCSV,formatDateTime } from '../utils';

export default function SettingsPage() {
  const { theme, toggleTheme, tsdMode, toggleTsd } = useApp();
  const { refresh: refreshData } = useData();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Record<string, number>>({});
  const [ops, setOps] = useState<any[]>([]);
  const [opFilter, setOpFilter] = useState('');
  const [opSearch, setOpSearch] = useState('');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [soundsEnabled, setSoundsEnabledState] = useState(true);
  const [userForm, setUserForm] = useState({ username: '', password: '', full_name: '', role: 'operator' as AuthUser['role'], active: true });
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadSettings(); loadStats(); loadOps(); loadUsers(); loadAudit(); }, []);
  useEffect(() => { getSetting('sounds_enabled', '1').then(v => setSoundsEnabledState(v === '1')); }, []);

  async function loadSettings() {
    const keys = ['warehouse_name', 'warehouse_addr', 'default_operator', 'fifo_mode', 'abc_period_days', 'nelikvid_days', 'expiry_warn_days'];
    const result: Record<string, string> = {};
    // Сначала локальный кэш для мгновенного UI
    for (const k of keys) result[k] = await getSetting(k, '');
    setSettings(result);
    // Потом обновляем с сервера
    try {
      const serverAll = await settingsApi.getAll();
      const merged: Record<string, string> = { ...result };
      for (const k of keys) if (serverAll[k] !== undefined) merged[k] = serverAll[k];
      setSettings(merged);
      // Сохраняем серверные значения в локальный кэш
      for (const k of keys) if (serverAll[k] !== undefined) await setSetting(k, serverAll[k]);
    } catch (e) {
      console.warn('[Settings] сервер недоступен — показываем локальные настройки:', e);
    }
  }

  async function loadStats() { setStats(await getDBStats()); }

  async function loadUsers() {
    setUsers(await listAuthUsers());
  }

  async function loadAudit() {
    const items = await listAudit({ limit: 300 });
    setAudit(items);
  }

  async function doClearAudit() {
    if (!confirm('Очистить журнал аудита целиком? Это действие необратимо.')) return;
    await clearAudit();
    toast('info', 'Журнал аудита очищен');
    loadAudit();
  }

  function exportAuditXLS() {
    downloadXLS('audit-log', {
      name: 'Аудит',
      columns: [
        { header: 'Дата/время', width: 20 },
        { header: 'Пользователь', width: 18 },
        { header: 'Действие', width: 12 },
        { header: 'Сущность', width: 12 },
        { header: 'ID', width: 18 },
        { header: 'Детали', width: 60 },
      ],
      rows: audit.map(a => [
        new Date(a.ts),
        a.username || '',
        a.action,
        a.entity || '',
        a.entity_id || '',
        a.details || '',
      ]),
    });
    toast('success', 'Журнал аудита экспортирован в Excel');
  }

  async function toggleSounds() {
    const next = !soundsEnabled;
    setSoundsEnabledState(next);
    setSoundEnabled(next);
    await setSetting('sounds_enabled', next ? '1' : '0');
    toast('info', next ? 'Звук включён' : 'Звук отключён');
  }

  async function loadOps() {
    try {
      let items = await opsApi.list({ limit: 200 });
      if (opFilter) items = items.filter(o => o.type === opFilter);
      if (opSearch) {
        const q = opSearch.toLowerCase();
        items = items.filter(o => (o.barcode || '').toLowerCase().includes(q) || (o.cell || '').includes(q) || (o.note || '').toLowerCase().includes(q));
      }
      setOps(items.slice(0, 100));
    } catch {
      // Фоллбек на локальный лог
      let items = await db.ops.orderBy('id').reverse().limit(100).toArray();
      if (opFilter) items = items.filter(o => o.type === opFilter);
      if (opSearch) {
        const q = opSearch.toLowerCase();
        items = items.filter(o => (o.barcode || '').toLowerCase().includes(q) || (o.cell || '').includes(q) || (o.note || '').toLowerCase().includes(q));
      }
      setOps(items);
    }
  }

  useEffect(() => { loadOps(); }, [opFilter, opSearch]);

  async function saveSetting(key: string, value: string) {
    await setSetting(key, value);
    setSettings(prev => ({ ...prev, [key]: value }));
    // Дублируем на сервер, чтобы настройки синхронизировались между ПК.
    try {
      await settingsApi.putAll({ [key]: value });
    } catch (e) {
      console.warn('[Settings] не удалось сохранить на сервер:', e);
    }
    toast('success', 'Настройка сохранена');
  }

  async function saveUser() {
    try {
      if (!userForm.username.trim()) {
        toast('error', 'Введите логин');
        return;
      }

      if (editingUserId) {
        await updateAuthUser(editingUserId, {
          username: userForm.username,
          full_name: userForm.full_name,
          role: userForm.role,
          active: userForm.active,
          password: userForm.password || undefined,
        });
        toast('success', 'Пользователь обновлён');
      } else {
        await createAuthUser({
          username: userForm.username,
          password: userForm.password,
          full_name: userForm.full_name,
          role: userForm.role,
          active: userForm.active,
        });
        toast('success', 'Пользователь создан');
      }

      setUserForm({ username: '', password: '', full_name: '', role: 'operator', active: true });
      setEditingUserId(null);
      await loadUsers();
      await loadStats();
    } catch (e: any) {
      toast('error', e?.message || 'Ошибка сохранения пользователя');
    }
  }

  function editUser(u: AuthUser) {
    setEditingUserId(u.id!);
    setUserForm({
      username: u.username,
      password: '',
      full_name: u.full_name,
      role: u.role,
      active: u.active,
    });
  }

  async function removeUser(id: number) {
    if (!confirm('Удалить пользователя?')) return;
    try {
      await deleteAuthUser(id);
      toast('success', 'Пользователь удалён');
      await loadUsers();
      await loadStats();
    } catch (e: any) {
      toast('error', e?.message || 'Ошибка удаления пользователя');
    }
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserForm({ username: '', password: '', full_name: '', role: 'operator', active: true });
  }

  async function doBackup() {
    // Делаем серверный бэкап (если сервер доступен) — он содержит данные ВСЕХ пользователей.
    try {
      const serverData = await serverApi.backup();
      downloadFile(JSON.stringify(serverData, null, 2), `storra_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      toast('success', 'Серверная резервная копия создана');
      return;
    } catch (e) {
      console.warn('[Backup] сервер недоступен, делаю локальный бэкап:', e);
    }
    const json = await fullBackup();
    downloadFile(json, `storra_backup_local_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('warning', 'Создана ЛОКАЛЬНАЯ копия (только данные этого ПК)');
  }

  async function doRestore(file: File) {
    try {
      const json = await file.text();
      const parsed = JSON.parse(json);
      // Попробуем восстановить на сервер
      try {
        const result = await serverApi.restore({ data: parsed.data || parsed });
        toast('success', `Восстановлено на сервер: ${result.tables} таблиц, ${result.records} записей`);
        refreshData();
        loadSettings(); loadStats();
        return;
      } catch (e) {
        console.warn('[Restore] сервер недоступен, восстанавливаю локально:', e);
      }
      const result = await restoreBackup(json);
      toast('warning', `Восстановлено ЛОКАЛЬНО: ${result.tables} таблиц, ${result.records} записей`);
      loadSettings(); loadStats();
    } catch (e: any) { toast('error', `Ошибка: ${e.message}`); }
  }

  async function loadDemoData() {
    if (!confirm('Загрузить демо-данные? Существующие данные будут добавлены.')) return;
    try {
      const now = Date.now();
      
      // Demo products
      const cats = ['Напитки', 'Молочная продукция', 'Кондитерские изделия', 'Бакалея', 'Заморозка'];
      const names = [
        'Вода питьевая 1.5л', 'Сок апельсиновый 1л', 'Молоко 3.2% 1л', 'Кефир 2.5% 0.9л',
        'Шоколад молочный 100г', 'Печенье овсяное 200г', 'Крупа гречневая 800г', 'Макароны 500г',
        'Масло подсолнечное 1л', 'Сахар 1кг', 'Мука пшеничная 2кг', 'Соль 1кг',
        'Чай черный 100г', 'Кофе молотый 250г', 'Сгущёнка 380г', 'Варенье клубничное 500г',
        'Хлеб белый 600г', 'Батон нарезной 400г', 'Сметана 20% 400г', 'Творог 5% 200г',
        'Сыр Российский 300г', 'Масло сливочное 180г', 'Йогурт клубничный 130г', 'Ряженка 2.5% 500г',
        'Пельмени 900г', 'Котлеты куриные 600г', 'Пицца Маргарита 450г', 'Мороженое 200г',
        'Рыба минтай 600г', 'Крабовые палочки 200г',
      ];
      
      const products = names.map((name, i) => ({
        barcode: `460${String(1000000000 + i).slice(1)}`,
        name,
        category: cats[i % cats.length],
        supplier: ['Поставщик А', 'Поставщик Б', 'Поставщик В'][i % 3],
        unit: i < 2 ? 'л' : i < 6 ? 'шт' : 'кг',
        has_expiry: i < 4 || i >= 24,
        expiry_days: i < 4 ? 14 : i >= 24 ? 180 : undefined,
        min_stock: 5,
        max_stock: 50,
        deleted: false,
        created_at: now,
        updated_at: now,
      }));
      // Демо-данные грузим через серверное API, чтобы они появились на всех ПК.
      const productsForApi = products.map(p => ({
        barcode: p.barcode, name: p.name, category: p.category, supplier: p.supplier,
        unit: p.unit, has_expiry: !!p.has_expiry, expiry_days: p.expiry_days,
        min_stock: p.min_stock, max_stock: p.max_stock,
      }));
      await productsApi.bulk(productsForApi);

      // Demo cells
      const zones = ['A', 'Б', 'В', 'Г'];
      const types: ('pallet' | 'box' | 'shelf')[] = ['pallet', 'box', 'shelf'];
      const cells: Array<{ addr: string; zone: string; row: string; level: string; type: 'pallet'|'box'|'shelf'; status: 'free'|'occupied'|'blocked'|'quarantine'; max_pallets: number; max_weight: number }> = [];
      for (const zone of zones) {
        for (let row = 1; row <= 5; row++) {
          for (let level = 1; level <= 3; level++) {
            cells.push({
              addr: `${zone}-${String(row).padStart(2,'0')}-${level}`,
              zone, row: String(row), level: String(level),
              type: types[(row + level) % 3],
              status: 'free',
              max_pallets: 4,
              max_weight: 1000,
            });
          }
        }
      }
      await cellsApi.bulk(cells);

      // Demo stock через серверный receive (атомарно создаст партии и обновит ячейки)
      let received = 0;
      for (let i = 0; i < 20; i++) {
        const p = products[i];
        const c = cells[i];
        const qty = Math.floor(Math.random() * 40) + 5;
        try {
          await opsApi.receive({ barcode: p.barcode, cell: c.addr, qty, operator: 'Демо', note: 'Демо-приёмка' });
          received++;
        } catch { /* пропускаем */ }
      }

      // Несколько демо-отгрузок
      let shipped = 0;
      for (let i = 0; i < 8; i++) {
        const p = products[i];
        const qty = Math.floor(Math.random() * 5) + 1;
        try {
          await opsApi.ship({ barcode: p.barcode, cell: cells[i].addr, qty, operator: 'Демо' });
          shipped++;
        } catch { /* пропускаем */ }
      }

      toast('success', `Демо-данные: ${products.length} товаров, ${cells.length} ячеек, ${received} приёмок, ${shipped} отгрузок`);
      // Обновляем все кэши
      refreshData();
      loadSettings(); loadStats();
    } catch (e: any) { toast('error', `Ошибка: ${e.message}`); }
  }

  async function clearTable(table: string) {
    if (!confirm(`Очистить таблицу ${table}? Все данные будут удалены!`)) return;
    try {
      await (db as any)[table].clear();
      toast('info', `Таблица ${table} очищена`);
      loadStats();
    } catch { toast('error', 'Ошибка очистки'); }
  }

  function exportOps() {
    const headers = ['ID', 'Тип', 'ШК', 'Ячейка', 'Кол-во', 'Оператор', 'Дата'];
    const rows = ops.map(o => [String(o.id), o.type, o.barcode || '', o.cell || o.source_cell || '', String(o.qty), o.operator || '', formatDateTime(o.ts)]);
    exportToCSV(headers, rows, 'operations.csv');
  }

  const typeLabels: Record<string, string> = { receive: '⬇ Приёмка', ship: '⬆ Отгрузка', move: '↔ Перемещение', replenish: '↥ Пополнение', adjust: '📋 Корректировка', error: '❌ Ошибка' };
  const typeColors: Record<string, string> = { receive: 'text-green-400', ship: 'text-blue-400', move: 'text-amber-400', replenish: 'text-violet-300', adjust: 'text-nexus-accent2' };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Warehouse Settings */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-4 flex items-center gap-2"><SettingsIcon size={20} /> Настройки склада</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { key: 'warehouse_name', label: 'Название склада' },
            { key: 'warehouse_addr', label: 'Адрес склада' },
            { key: 'default_operator', label: 'Оператор по умолчанию' },
          ].map(s => (
            <div key={s.key}>
              <label className="text-xs font-medium text-nexus-text3 mb-1 block">{s.label}</label>
              <div className="flex gap-2">
                <input value={settings[s.key] || ''} onChange={e => setSettings(prev => ({ ...prev, [s.key]: e.target.value }))}
                  className="flex-1 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
                <button onClick={() => saveSetting(s.key, settings[s.key] || '')} className="px-3 py-2 rounded-xl bg-nexus-accent/20 text-nexus-accent2 text-sm hover:bg-nexus-accent/30">💾</button>
              </div>
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Режим FIFO/FEFO</label>
            <select value={settings.fifo_mode || 'fifo'} onChange={e => { setSettings(prev => ({ ...prev, fifo_mode: e.target.value })); saveSetting('fifo_mode', e.target.value); }}
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
              <option value="fifo">FIFO (первый пришёл — первый ушёл)</option>
              <option value="fefo">FEFO (по сроку годности)</option>
              <option value="none">Без автоподбора</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Период ABC (дней)</label>
            <input type="number" value={settings.abc_period_days || '90'} onChange={e => setSettings(prev => ({ ...prev, abc_period_days: e.target.value }))}
              onBlur={() => saveSetting('abc_period_days', settings.abc_period_days || '90')}
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>
        </div>
      </div>

      {/* Interface */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-4">Интерфейс</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between bg-nexus-surface2 rounded-xl p-4">
            <div>
              <div className="text-nexus-text font-medium">Тема оформления</div>
              <div className="text-nexus-text3 text-xs">{theme === 'dark' ? 'Тёмная тема активна' : 'Светлая тема активна'}</div>
            </div>
            <button onClick={toggleTheme} className={`relative w-14 h-7 rounded-full transition-colors ${theme === 'dark' ? 'bg-nexus-accent' : 'bg-amber-500'}`}>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'left-0.5' : 'left-[30px]'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between bg-nexus-surface2 rounded-xl p-4">
            <div>
              <div className="text-nexus-text font-medium">Режим ТСД</div>
              <div className="text-nexus-text3 text-xs">Увеличенные элементы для сканера</div>
            </div>
            <button onClick={toggleTsd} className={`relative w-14 h-7 rounded-full transition-colors ${tsdMode ? 'bg-nexus-accent' : 'bg-nexus-border'}`}>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${tsdMode ? 'left-[30px]' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Users / Auth */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-4 flex items-center gap-2"><Shield size={20} /> Пользователи и доступ</h2>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="text-sm text-nexus-text2">{editingUserId ? 'Редактирование пользователя' : 'Создание пользователя'}</div>
            <div>
              <label className="text-xs text-nexus-text3 mb-1 block">Логин</label>
              <input value={userForm.username} onChange={e => setUserForm(p => ({ ...p, username: e.target.value }))} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
            </div>
            <div>
              <label className="text-xs text-nexus-text3 mb-1 block">ФИО / отображаемое имя</label>
              <input value={userForm.full_name} onChange={e => setUserForm(p => ({ ...p, full_name: e.target.value }))} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
            </div>
            <div>
              <label className="text-xs text-nexus-text3 mb-1 block">Пароль {editingUserId ? '(оставьте пустым, если не менять)' : ''}</label>
              <input type="password" value={userForm.password} onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-nexus-text3 mb-1 block">Роль</label>
                <select value={userForm.role} onChange={e => setUserForm(p => ({ ...p, role: e.target.value as AuthUser['role'] }))} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
                  <option value="operator">operator</option>
                  <option value="supervisor">supervisor</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-nexus-text3 mb-1 block">Статус</label>
                <select value={userForm.active ? '1' : '0'} onChange={e => setUserForm(p => ({ ...p, active: e.target.value === '1' }))} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
                  <option value="1">Активен</option>
                  <option value="0">Отключён</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={saveUser} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-4 py-2.5 rounded-xl text-sm font-medium">
                {editingUserId ? <UserCog size={16} /> : <UserPlus size={16} />}
                {editingUserId ? 'Сохранить изменения' : 'Создать пользователя'}
              </button>
              {editingUserId && (
                <button onClick={resetUserForm} className="px-4 py-2.5 rounded-xl border border-nexus-border text-nexus-text3 hover:text-nexus-text text-sm">Отмена</button>
              )}
            </div>
          </div>

          <div>
            <div className="text-sm text-nexus-text2 mb-3">Список пользователей</div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {users.map(u => (
                <div key={u.id} className="bg-nexus-surface2 border border-nexus-border rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-nexus-accent to-nexus-accent2 text-white text-xs font-bold flex items-center justify-center">
                    {(u.full_name || u.username).split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-nexus-text text-sm font-medium truncate">{u.full_name || u.username}</div>
                    <div className="text-nexus-text3 text-xs">@{u.username} · {u.role} · {u.active ? 'active' : 'disabled'}</div>
                  </div>
                  <button onClick={() => editUser(u)} className="text-xs px-2 py-1 rounded border border-nexus-border text-nexus-text3 hover:text-nexus-text">Изм.</button>
                  <button onClick={() => removeUser(u.id!)} className="text-xs px-2 py-1 rounded border border-red-900/40 text-red-400 hover:text-red-300">Удал.</button>
                </div>
              ))}
              {users.length === 0 && <div className="text-center py-6 text-sm text-nexus-text3">Пользователи не найдены</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Demo Data */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-2 flex items-center gap-2"><Database size={20} /> Демо-данные</h2>
        <p className="text-nexus-text3 text-sm mb-4">Загрузить пример данных для тестирования системы. Добавит 30 товаров, 50 ячеек, остатки и операции.</p>
        <button onClick={loadDemoData} className="flex items-center gap-2 bg-gradient-to-r from-nexus-accent to-nexus-accent2 hover:from-nexus-accent2 hover:to-nexus-accent text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all">
          <Zap size={16} /> Загрузить демо-данные
        </button>
      </div>

      {/* Backup */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-4 flex items-center gap-2"><Database size={20} /> Резервное копирование</h2>
        <div className="flex gap-3">
          <button onClick={doBackup} className="flex items-center gap-2 bg-green-700 hover:bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium"><Download size={16} /> Создать бэкап</button>
          <button onClick={() => backupRef.current?.click()} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium"><Upload size={16} /> Восстановить из файла</button>
          <input ref={backupRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) doRestore(f); e.target.value = ''; }} />
        </div>
      </div>

      {/* DB Stats */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-4 flex items-center gap-2"><HardDrive size={20} /> Статистика базы данных</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(stats).map(([key, value]) => (
            <div key={key} className="bg-nexus-surface2 rounded-xl p-3 text-center">
              <div className="text-nexus-text font-bold text-lg">{value}</div>
              <div className="text-nexus-text3 text-xs">{key}</div>
              <button onClick={() => clearTable(key)} className="mt-1 text-[10px] text-red-400 hover:text-red-300"><Trash2 size={10} className="inline" /> Очистить</button>
            </div>
          ))}
        </div>
      </div>

      {/* Operations Log */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-nexus-text font-bold text-lg flex items-center gap-2"><Clock size={20} /> Журнал операций</h2>
          <div className="flex gap-2">
            <button onClick={exportOps} className="flex items-center gap-1 text-sm text-nexus-text3 hover:text-nexus-text"><Download size={14} /> CSV</button>
            <button onClick={loadOps} className="flex items-center gap-1 text-sm text-nexus-text3 hover:text-nexus-text"><RefreshCw size={14} /></button>
          </div>
        </div>
        <div className="flex gap-2 mb-3">
          <select value={opFilter} onChange={e => setOpFilter(e.target.value)} className="bg-nexus-surface2 border border-nexus-border rounded-lg px-3 py-1.5 text-nexus-text text-sm">
            <option value="">Все типы</option>
            <option value="receive">Приёмка</option><option value="ship">Отгрузка</option><option value="move">Перемещение</option><option value="adjust">Корректировка</option>
          </select>
          <input value={opSearch} onChange={e => setOpSearch(e.target.value)} placeholder="Поиск по ШК, ячейке..." className="flex-1 bg-nexus-surface2 border border-nexus-border rounded-lg px-3 py-1.5 text-nexus-text text-sm" />
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {ops.map(op => (
            <div key={op.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-nexus-surface2 text-sm">
              <span className={`font-medium ${typeColors[op.type] || 'text-nexus-text3'}`}>{typeLabels[op.type] || op.type}</span>
              <span className="font-mono text-nexus-accent2 text-xs">{op.barcode || '—'}</span>
              <span className="text-nexus-text2 text-xs">{op.cell || op.source_cell || ''}</span>
              <span className="text-nexus-text font-medium">{op.qty > 0 ? `×${op.qty}` : ''}</span>
              {op.operator && <span className="text-nexus-text3 text-xs">{op.operator}</span>}
              {op.note && <span className="text-nexus-text3 text-xs truncate max-w-[150px]">{op.note}</span>}
              <span className="text-nexus-text3 text-xs ml-auto">{formatDateTime(op.ts)}</span>
            </div>
          ))}
          {ops.length === 0 && <div className="text-center py-6 text-nexus-text3">Операций пока нет</div>}
        </div>
      </div>

      {/* Sound toggle */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-2 flex items-center gap-2">
          {soundsEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />} Звуковые сигналы
        </h2>
        <p className="text-nexus-text3 text-sm mb-3">
          Короткие звуки при сканировании / ошибках. На некоторых браузерах требуется первое нажатие в окне для активации звука.
        </p>
        <button
          onClick={toggleSounds}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border ${soundsEnabled ? 'bg-nexus-accent/15 text-nexus-accent2 border-nexus-accent/40' : 'bg-nexus-surface2 text-nexus-text border-nexus-border'}`}
        >
          {soundsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          {soundsEnabled ? 'Звук включён' : 'Звук отключён'}
        </button>
      </div>

      {/* Audit log */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-nexus-text font-bold text-lg flex items-center gap-2"><FileText size={20} /> Журнал действий пользователей (аудит)</h2>
          <div className="flex gap-2">
            <button onClick={exportAuditXLS} className="flex items-center gap-1 text-sm text-nexus-text3 hover:text-nexus-text" title="Excel"><Download size={14} /> Excel</button>
            <button onClick={loadAudit} className="flex items-center gap-1 text-sm text-nexus-text3 hover:text-nexus-text" title="Обновить"><RefreshCw size={14} /></button>
            <button onClick={doClearAudit} className="flex items-center gap-1 text-sm text-red-400 hover:text-red-300" title="Очистить"><Trash2 size={14} /></button>
          </div>
        </div>
        <div className="flex gap-2 mb-3">
          <input value={auditFilter} onChange={e => setAuditFilter(e.target.value)} placeholder="Фильтр по пользователю или действию..." className="flex-1 bg-nexus-surface2 border border-nexus-border rounded-lg px-3 py-1.5 text-nexus-text text-sm" />
        </div>
        <div className="space-y-0.5 max-h-96 overflow-y-auto font-mono text-xs">
          {audit
            .filter(a => !auditFilter ||
              (a.username || '').toLowerCase().includes(auditFilter.toLowerCase()) ||
              a.action.toLowerCase().includes(auditFilter.toLowerCase()) ||
              (a.entity || '').toLowerCase().includes(auditFilter.toLowerCase())
            )
            .map(a => (
            <div key={a.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-nexus-surface2">
              <span className="text-nexus-text3 w-32 flex-shrink-0">{formatDateTime(a.ts)}</span>
              <span className="text-nexus-accent2 w-24 truncate">{a.username || '—'}</span>
              <span className="text-nexus-text w-20 font-semibold">{a.action}</span>
              <span className="text-nexus-text2 w-16">{a.entity || ''}</span>
              <span className="text-nexus-text3 flex-1 truncate">{a.entity_id || ''} {a.details ? `· ${a.details}` : ''}</span>
            </div>
          ))}
          {audit.length === 0 && <div className="text-center py-6 text-nexus-text3 font-sans">Записей в журнале пока нет</div>}
        </div>
      </div>

      {/* About */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-4 flex items-center gap-2"><Info size={20} /> О системе</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div><span className="text-nexus-text3">Версия:</span> <span className="text-nexus-text font-medium">7.0.0</span></div>
          <div><span className="text-nexus-text3">Архитектура:</span> <span className="text-nexus-text">React + Dexie (IndexedDB)</span></div>
          <div><span className="text-nexus-text3">Хранилище:</span> <span className="text-nexus-text">IndexedDB (офлайн)</span></div>
          <div><span className="text-nexus-text3">Функций:</span> <span className="text-nexus-text">130+</span></div>
        </div>
        <div className="mt-4 text-nexus-text3 text-xs">
          Storra WMS — система управления складом.
          Работает полностью офлайн. Все данные хранятся локально в IndexedDB.
        </div>
      </div>
    </div>
  );
}
