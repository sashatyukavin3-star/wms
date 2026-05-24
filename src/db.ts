import Dexie, { type Table } from 'dexie';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface Product {
  barcode: string;
  name: string;
  category?: string;
  supplier?: string;
  unit: string;
  weight_gross?: number;
  weight_net?: number;
  dim_l?: number;
  dim_w?: number;
  dim_h?: number;
  has_expiry?: boolean;
  expiry_days?: number;
  min_stock?: number;
  max_stock?: number;
  abc_class?: 'A' | 'B' | 'C' | '';
  xyz_class?: 'X' | 'Y' | 'Z' | '';
  deleted?: boolean;
  created_at: number;
  updated_at: number;
}

export interface Cell {
  addr: string;
  zone?: string;
  row?: string;
  level?: string;
  type: 'pallet' | 'box' | 'shelf' | 'oversize';
  status: 'free' | 'occupied' | 'blocked' | 'quarantine';
  max_pallets?: number;
  max_weight?: number;
  max_units?: number;
  allow_mixed_sku?: boolean;
  pick_priority?: number;
  putaway_priority?: number;
  is_picking_face?: boolean;
  deleted?: boolean;
  updated_at: number;
}

export interface Operator {
  id?: number;
  name: string;
  role: 'operator' | 'supervisor' | 'admin';
  pin?: string;
  active: boolean;
  created_at: number;
}

export interface Category {
  id?: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface Stock {
  barcode: string;
  cell: string;
  qty: number;
  batch_id?: number;
  expiry_date?: string;
  updated_at: number;
}

export interface Op {
  id?: number;
  type: string;
  barcode?: string;
  cell?: string;
  source_cell?: string;
  target_cell?: string;
  qty: number;
  operator?: string;
  batch_id?: number;
  order_id?: number;
  session_id?: number;
  note?: string;
  ts: number;
}

export interface Batch {
  id?: number;
  barcode: string;
  cell?: string;
  qty: number;
  lot_number?: string;
  supplier?: string;
  received_at: number;
  expiry_date?: string;
  cost_price?: number;
}

export interface Asn {
  id?: number;
  asn_number: string;
  supplier?: string;
  status: 'draft' | 'arrived' | 'receiving' | 'completed' | 'cancelled';
  eta_date?: string;
  arrived_at?: number;
  note?: string;
  created_at: number;
  updated_at: number;
}

export interface AsnLine {
  id?: number;
  asn_id: number;
  barcode: string;
  qty_expected: number;
  qty_received: number;
  qty_damaged: number;
  qc_status: 'pending' | 'accepted' | 'accepted_with_issue' | 'rejected';
  discrepancy_reason?: string;
  status: 'pending' | 'partial' | 'received' | 'issue';
  note?: string;
}

export interface Order {
  id?: number;
  ext_id?: string;
  status: 'new' | 'picking' | 'picked' | 'packed' | 'shipped' | 'cancelled';
  customer?: string;
  created_at: number;
  closed_at?: number;
  packed_at?: number;
  packed_by?: string;
  package_count?: number;
  operator?: string;
  note?: string;
}

export interface OrderLine {
  id?: number;
  order_id: number;
  barcode: string;
  qty_plan: number;
  qty_fact: number;
  status: 'pending' | 'partial' | 'done';
}

export interface ReturnDoc {
  id?: number;
  return_number: string;
  order_id?: number;
  customer?: string;
  reason?: string;
  status: 'draft' | 'received' | 'completed' | 'cancelled';
  note?: string;
  received_at?: number;
  processed_at?: number;
  created_at: number;
  updated_at: number;
}

export interface ReturnLine {
  id?: number;
  return_id: number;
  barcode: string;
  qty_expected: number;
  qty_received: number;
  qty_restocked: number;
  qty_quarantined: number;
  qty_scrapped: number;
  disposition: 'restock' | 'quarantine' | 'scrap';
  status: 'pending' | 'partial' | 'processed' | 'issue';
  note?: string;
  reason?: string;
}

export interface CycleCount {
  id?: number;
  task_number: string;
  name: string;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  zone_filter?: string;
  created_by?: string;
  note?: string;
  started_at?: number;
  completed_at?: number;
  created_at: number;
  updated_at: number;
}

export interface CycleCountLine {
  id?: number;
  cycle_count_id: number;
  barcode: string;
  cell: string;
  qty_system: number;
  qty_counted: number;
  delta: number;
  priority: number;
  reason?: string;
  status: 'pending' | 'counted' | 'adjusted' | 'skipped';
  note?: string;
  created_at: number;
  updated_at: number;
}

export interface InvSession {
  id?: number;
  name: string;
  status: 'active' | 'closed';
  zone_filter?: string;
  operator?: string;
  created_at: number;
  closed_at?: number;
}

export interface InvLine {
  id?: number;
  session_id: number;
  barcode: string;
  cell: string;
  qty_system: number;
  qty_fact: number;
  delta: number;
  ts: number;
}

export interface InspectionAct {
  id?: number;
  act_number: string;
  type: 'cell_inspection';
  date: string;
  /** Название склада. */
  warehouse?: string;
  /** Адрес склада (печатается в шапке). */
  warehouse_addr?: string;
  /** Зона / Ряд (как в бумажном бланке). */
  zone_span?: string;
  aisle_from?: string;
  aisle_to?: string;
  /** Номер этого листа в наборе (для многостраничных актов). */
  sheet_no?: number;
  /** Всего листов в наборе. */
  sheets_total?: number;
  /** ФИО осматривавшего наверху. */
  inspector_high?: string;
  /** ФИО фиксировавшего внизу. */
  inspector_low?: string;
  /** Должность инспектора (опц.). */
  inspector_position?: string;
  /** Общее примечание к акту. */
  note?: string;
  created_at: number;
  updated_at: number;
  status: 'draft' | 'saved' | 'printed';
  rows: InspectionRow[];
}

export interface InspectionRow {
  cell: string;
  status: string;
  /** Что именно находится (факт): описание товара или «пустой паллет». */
  note: string;
  /** Опционально: ШК товара, найденного в ячейке (для авто-наименования). */
  barcode?: string;
  /**
   * Системный план — сколько товара должно быть в ячейке по учёту WMS.
   * Подставляется автоматически при выборе ячейки / товара.
   * В печатном акте — колонка «План».
   */
  qty_plan?: number;
  /**
   * Зарезервировано под отбор (заказы). Сумма qty из таблицы reservations.
   * Помогает понять, почему фактически в ячейке меньше, чем «должно быть».
   * В печатном акте — колонка «Отбор».
   */
  qty_reserved?: number;
  /**
   * Фактически найдено при осмотре. Вписывает оператор.
   * В печатном акте — колонка «Факт».
   */
  qty?: number;
  /** Опционально: что сделано / рекомендация (графа «Действие»). */
  action?: string;
  /** Опционально: подпись осматривал (ФИО / отметка). */
  sig_high?: string;
  /** Опционально: подпись фиксировал. */
  sig_low?: string;
}

export interface ReworkAct {
  id?: number;
  act_number: string;
  date: string;
  /** Название склада. */
  warehouse?: string;
  /** Адрес склада (печатается). */
  warehouse_addr?: string;
  /** Участок / зона переборки. */
  zone?: string;
  /** Источник: откуда забран миксовый паллет (стеллаж/ячейка/№ паллета). */
  source?: string;
  /** Назначение: куда отправляется отсортированный товар. */
  destination?: string;
  /** Причина переборки (например «комплектация заказа», «карантин», «сортировка»). */
  reason?: string;
  /** Номер первичного документа (накладной/задания), если есть. */
  ref_document?: string;
  start_time?: string;
  end_time?: string;
  /** Рабочие — ФИО через запятую. */
  workers?: string;
  /** Контролировал — ФИО. */
  supervisor?: string;
  /** Кол-во перебранных паллетов. */
  pallets_total?: number;
  items_total?: number;
  good_total?: number;
  defect_total?: number;
  /** Общее примечание к акту. */
  note?: string;
  created_at: number;
  updated_at: number;
  status: 'draft' | 'saved' | 'printed';
  positions: ReworkPosition[];
}

export interface ReworkPosition {
  barcode: string;
  name: string;
  /** Артикул (если отличается от ШК). */
  article?: string;
  /** Единица измерения. По умолчанию «шт». */
  unit?: string;
  total: number;
  good: number;
  defect: number;
  /** Квант — упаковочная норма для подсчёта. */
  quantum?: number;
  /** Причина брака / примечание. */
  note: string;
}

export interface StickerJob {
  id?: number;
  name: string;
  template_id: '6x6' | '10x15';
  items: StickerItem[];
  created_at: number;
  printed_at?: number;
}

export interface StickerItem {
  barcode: string;
  name: string;
  qty: number;
  unit: string;
  cell?: string;
  batch?: string;
  expiry?: string;
  operator?: string;
  copies: number;
}

export interface Setting {
  key: string;
  value: string;
}

/**
 * Хранение паролей:
 *  - password_hash — PBKDF2-SHA256(password, salt, iterations) в hex.
 *  - salt — случайная 16-байтовая соль, hex.
 *  - iterations — параметр PBKDF2 (на 2026 г. безопасный минимум ~210_000).
 *  - password_legacy === true означает старый формат (SHA-256 + общая соль)
 *    и будет пересохранён в новый при первом успешном входе.
 */
export interface AuthUser {
  id?: number;
  username: string;
  password_hash: string;
  salt?: string;
  iterations?: number;
  password_legacy?: boolean;
  full_name: string;
  role: 'operator' | 'supervisor' | 'admin';
  active: boolean;
  created_at: number;
  updated_at: number;
  last_login_at?: number;
}

export interface AuditLog {
  id?: number;
  ts: number;
  user_id?: number;
  username?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  details?: string;
  ip?: string;
}

export interface Reservation {
  id?: number;
  order_id: number;
  order_line_id?: number;
  barcode: string;
  cell: string;
  qty: number;
  created_at: number;
  operator?: string;
}

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

/** Полный список таблиц БД — используется в backup/restore/stats, чтобы не было рассинхрона. */
export const TABLE_NAMES = [
  'products', 'cells', 'operators', 'categories', 'stock', 'ops', 'batches',
  'orders', 'orderLines', 'invSessions', 'invLines',
  'inspectionActs', 'reworkActs', 'stickerJobs', 'settings', 'users', 'audit_log',
] as const;
export type TableName = typeof TABLE_NAMES[number];

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_HASH = 'SHA-256';
const PBKDF2_KEYLEN_BITS = 256;

// ═══════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════

class StorraDB extends Dexie {
  products!: Table<Product>;
  cells!: Table<Cell>;
  operators!: Table<Operator>;
  categories!: Table<Category>;
  stock!: Table<Stock>;
  ops!: Table<Op>;
  batches!: Table<Batch>;
  orders!: Table<Order>;
  orderLines!: Table<OrderLine>;
  invSessions!: Table<InvSession>;
  invLines!: Table<InvLine>;
  inspectionActs!: Table<InspectionAct>;
  reworkActs!: Table<ReworkAct>;
  stickerJobs!: Table<StickerJob>;
  settings!: Table<Setting>;
  users!: Table<AuthUser>;
  audit_log!: Table<AuditLog>;
  reservations!: Table<Reservation>;

  constructor() {
    // Имя БД оставлено прежним, чтобы существующие пользователи не потеряли данные.
    super('NexusWMS_Pro');
    this.version(1).stores({
      products: 'barcode, name, category, supplier, abc_class, xyz_class, deleted',
      cells: 'addr, zone, row, level, type, status',
      operators: '++id, name, role, active',
      categories: '++id, name, sort_order',
      stock: '[barcode+cell], barcode, cell, qty',
      ops: '++id, type, barcode, cell, ts, order_id, session_id',
      batches: '++id, barcode, cell, lot_number',
      orders: '++id, ext_id, status, customer, created_at',
      orderLines: '++id, order_id, barcode, status',
      invSessions: '++id, name, status, zone_filter',
      invLines: '++id, session_id, barcode, cell',
      inspectionActs: '++id, act_number, date, status',
      reworkActs: '++id, act_number, date, status',
      stickerJobs: '++id, name, template_id, created_at',
      settings: 'key',
    });

    this.version(2).stores({
      products: 'barcode, name, category, supplier, abc_class, xyz_class, deleted',
      cells: 'addr, zone, row, level, type, status',
      operators: '++id, name, role, active',
      categories: '++id, name, sort_order',
      stock: '[barcode+cell], barcode, cell, qty',
      ops: '++id, type, barcode, cell, ts, order_id, session_id',
      batches: '++id, barcode, cell, lot_number',
      orders: '++id, ext_id, status, customer, created_at',
      orderLines: '++id, order_id, barcode, status',
      invSessions: '++id, name, status, zone_filter',
      invLines: '++id, session_id, barcode, cell',
      inspectionActs: '++id, act_number, date, status',
      reworkActs: '++id, act_number, date, status',
      stickerJobs: '++id, name, template_id, created_at',
      settings: 'key',
      users: '++id, username, role, active, created_at',
    });

    // v3: помечаем существующих пользователей как legacy (старый SHA-256 + общая соль).
    // При следующем успешном входе пароль будет автоматически пересохранён в PBKDF2.
    this.version(3).stores({
      products: 'barcode, name, category, supplier, abc_class, xyz_class, deleted',
      cells: 'addr, zone, row, level, type, status',
      operators: '++id, name, role, active',
      categories: '++id, name, sort_order',
      stock: '[barcode+cell], barcode, cell, qty',
      ops: '++id, type, barcode, cell, ts, order_id, session_id',
      batches: '++id, barcode, cell, lot_number',
      orders: '++id, ext_id, status, customer, created_at',
      orderLines: '++id, order_id, barcode, status',
      invSessions: '++id, name, status, zone_filter',
      invLines: '++id, session_id, barcode, cell',
      inspectionActs: '++id, act_number, date, status',
      reworkActs: '++id, act_number, date, status',
      stickerJobs: '++id, name, template_id, created_at',
      settings: 'key',
      users: '++id, username, role, active, created_at',
    }).upgrade(async tx => {
      await tx.table('users').toCollection().modify(u => {
        if (!u.password_legacy && !u.salt) {
          u.password_legacy = true;
        }
      });
    });

    // v4: добавлен журнал действий пользователей (audit log).
    this.version(4).stores({
      products: 'barcode, name, category, supplier, abc_class, xyz_class, deleted',
      cells: 'addr, zone, row, level, type, status',
      operators: '++id, name, role, active',
      categories: '++id, name, sort_order',
      stock: '[barcode+cell], barcode, cell, qty',
      ops: '++id, type, barcode, cell, ts, order_id, session_id',
      batches: '++id, barcode, cell, lot_number',
      orders: '++id, ext_id, status, customer, created_at',
      orderLines: '++id, order_id, barcode, status',
      invSessions: '++id, name, status, zone_filter',
      invLines: '++id, session_id, barcode, cell',
      inspectionActs: '++id, act_number, date, status',
      reworkActs: '++id, act_number, date, status',
      stickerJobs: '++id, name, template_id, created_at',
      settings: 'key',
      users: '++id, username, role, active, created_at',
      audit_log: '++id, ts, user_id, username, action, entity, entity_id',
    });
  }
}

export const db = new StorraDB();

// ═══════════════════════════════════════════════════════════
// SETTINGS HELPER
// ═══════════════════════════════════════════════════════════

export async function getSetting(key: string, defaultVal: string = ''): Promise<string> {
  const s = await db.settings.get(key);
  return s?.value ?? defaultVal;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

// ═══════════════════════════════════════════════════════════
// INIT DEFAULT SETTINGS
// ═══════════════════════════════════════════════════════════

export async function initDefaults() {
  const defaults: Record<string, string> = {
    warehouse_name: 'Основной склад',
    warehouse_addr: 'г. Москва, ул. Складская 1',
    default_operator: '',
    theme: 'dark',
    tsd_mode: '0',
    fifo_mode: 'fifo',
    abc_period_days: '90',
    nelikvid_days: '90',
    expiry_warn_days: '30',
    act_cell_counter: '0',
    act_rework_counter: '0',
    sticker_default_tpl: '10x15',
  };

  for (const [key, value] of Object.entries(defaults)) {
    const existing = await db.settings.get(key);
    if (!existing) {
      await db.settings.put({ key, value });
    }
  }

  // Локальный admin нужен только для оффлайн-режима / file://.
  // На http без HTTPS (т.е. на http://192.168.x.x) crypto.subtle недоступен,
  // и эта функция бросит. В этом случае работаем только с серверной авторизацией —
  // поэтому ошибку гасим, чтобы не блокировать initDefaults().
  try {
    await ensureDefaultAdminUser();
  } catch (err) {
    console.warn('[Storra] ensureDefaultAdminUser пропущен (нет crypto.subtle):', err);
  }
}

// ═══════════════════════════════════════════════════════════
// AUTH USERS — PBKDF2 + per-user salt
// ═══════════════════════════════════════════════════════════

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function assertSubtleCrypto(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'Web Crypto API недоступен. Откройте приложение через https://, http://localhost ' +
      'или http://127.0.0.1, либо подключайтесь к серверу — серверная авторизация работает в любом случае.'
    );
  }
  return crypto.subtle;
}

function generateSalt(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const subtle = assertSubtleCrypto();
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  // .buffer типизируется как ArrayBufferLike, но deriveBits ждёт BufferSource с ArrayBuffer.
  // Поэтому копируем в свежий ArrayBuffer.
  const saltBytes = hexToBytes(saltHex);
  const saltBuf = new ArrayBuffer(saltBytes.length);
  new Uint8Array(saltBuf).set(saltBytes);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: PBKDF2_HASH, salt: saltBuf, iterations },
    baseKey,
    PBKDF2_KEYLEN_BITS
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Старый формат: SHA-256 от строки `nexus_wms_salt_v1::<password>` — используется только для проверки legacy-паролей. */
async function legacySha256(password: string): Promise<string> {
  const subtle = assertSubtleCrypto();
  const data = new TextEncoder().encode(`nexus_wms_salt_v1::${password}`);
  const hash = await subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

/** Сравнение строк за постоянное время — защита от тайминг-атак. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

export async function ensureDefaultAdminUser(): Promise<void> {
  const count = await db.users.count();
  if (count > 0) return;

  const now = Date.now();
  const salt = generateSalt();
  const password_hash = await pbkdf2('admin123', salt, PBKDF2_ITERATIONS);
  await db.users.add({
    username: 'admin',
    password_hash,
    salt,
    iterations: PBKDF2_ITERATIONS,
    password_legacy: false,
    full_name: 'Системный администратор',
    role: 'admin',
    active: true,
    created_at: now,
    updated_at: now,
  });
}

export async function listAuthUsers(): Promise<AuthUser[]> {
  return db.users.orderBy('username').toArray();
}

export async function createAuthUser(input: {
  username: string;
  password: string;
  full_name: string;
  role: AuthUser['role'];
  active?: boolean;
}): Promise<number> {
  const now = Date.now();
  const username = input.username.trim();
  const exists = await db.users.where('username').equals(username).first();
  if (exists) throw new Error('Пользователь с таким логином уже существует');
  if (!input.password || input.password.length < 4) throw new Error('Пароль должен быть не короче 4 символов');

  const salt = generateSalt();
  const password_hash = await pbkdf2(input.password, salt, PBKDF2_ITERATIONS);

  return db.users.add({
    username,
    password_hash,
    salt,
    iterations: PBKDF2_ITERATIONS,
    password_legacy: false,
    full_name: input.full_name.trim() || username,
    role: input.role,
    active: input.active !== false,
    created_at: now,
    updated_at: now,
  });
}

export async function updateAuthUser(
  id: number,
  patch: Partial<Omit<AuthUser, 'id' | 'password_hash' | 'salt' | 'iterations' | 'password_legacy'>> & { password?: string }
): Promise<void> {
  const now = Date.now();
  const updatePayload: Partial<AuthUser> = { updated_at: now };

  if (patch.username !== undefined) {
    const username = patch.username.trim();
    const exists = await db.users.where('username').equals(username).first();
    if (exists && exists.id !== id) throw new Error('Логин уже занят');
    updatePayload.username = username;
  }
  if (patch.full_name !== undefined) updatePayload.full_name = patch.full_name.trim();
  if (patch.role !== undefined) updatePayload.role = patch.role;
  if (patch.active !== undefined) updatePayload.active = patch.active;

  if (patch.password !== undefined) {
    if (!patch.password || patch.password.length < 4) throw new Error('Пароль должен быть не короче 4 символов');
    const salt = generateSalt();
    updatePayload.salt = salt;
    updatePayload.iterations = PBKDF2_ITERATIONS;
    updatePayload.password_hash = await pbkdf2(patch.password, salt, PBKDF2_ITERATIONS);
    updatePayload.password_legacy = false;
  }

  await db.users.update(id, updatePayload);
}

export async function deleteAuthUser(id: number): Promise<void> {
  const count = await db.users.count();
  if (count <= 1) throw new Error('Нельзя удалить последнего пользователя');
  await db.users.delete(id);
}

export async function authenticateUser(username: string, password: string): Promise<AuthUser | null> {
  const user = await db.users.where('username').equals(username.trim()).first();
  if (!user || !user.active) return null;

  let ok = false;

  if (user.password_legacy || !user.salt || !user.iterations) {
    // Старый формат — проверяем по SHA-256 + общая соль, а потом сразу мигрируем в PBKDF2.
    const legacyHash = await legacySha256(password);
    ok = timingSafeEqual(legacyHash, user.password_hash);
    if (ok) {
      const newSalt = generateSalt();
      const newHash = await pbkdf2(password, newSalt, PBKDF2_ITERATIONS);
      await db.users.update(user.id!, {
        password_hash: newHash,
        salt: newSalt,
        iterations: PBKDF2_ITERATIONS,
        password_legacy: false,
        updated_at: Date.now(),
      });
    }
  } else {
    const candidate = await pbkdf2(password, user.salt, user.iterations);
    ok = timingSafeEqual(candidate, user.password_hash);
  }

  if (!ok) return null;

  const lastLogin = Date.now();
  await db.users.update(user.id!, { last_login_at: lastLogin, updated_at: lastLogin });
  return { ...user, last_login_at: lastLogin };
}

// ═══════════════════════════════════════════════════════════
// STOCK HELPERS
// ═══════════════════════════════════════════════════════════

export async function getStockForProduct(barcode: string): Promise<Stock[]> {
  return db.stock.where('barcode').equals(barcode).toArray();
}

export async function getTotalStock(barcode: string): Promise<number> {
  const items = await db.stock.where('barcode').equals(barcode).toArray();
  return items.reduce((sum, s) => sum + s.qty, 0);
}

export async function getStockInCell(cell: string): Promise<Stock[]> {
  return db.stock.where('cell').equals(cell).toArray();
}

/**
 * Прибавляет товар в ячейку. Атомарно при вызове внутри уже открытой транзакции
 * (Dexie сам подхватит текущую). Снаружи — отдельная мини-транзакция Dexie.
 */
export async function addStock(barcode: string, cell: string, qty: number, batch_id?: number, expiry_date?: string): Promise<void> {
  const existing = await db.stock.get([barcode, cell]);
  const now = Date.now();

  if (existing) {
    const patch: Partial<Stock> = { qty: existing.qty + qty, updated_at: now };
    if (batch_id !== undefined) patch.batch_id = batch_id;
    if (expiry_date !== undefined) patch.expiry_date = expiry_date;
    await db.stock.update([barcode, cell], patch);
  } else {
    await db.stock.put({ barcode, cell, qty, batch_id, expiry_date, updated_at: now });
  }
}

export async function removeStock(barcode: string, cell: string, qty: number): Promise<boolean> {
  const existing = await db.stock.get([barcode, cell]);
  if (!existing || existing.qty < qty) return false;

  if (existing.qty === qty) {
    await db.stock.delete([barcode, cell]);
  } else {
    await db.stock.update([barcode, cell], { qty: existing.qty - qty, updated_at: Date.now() });
  }
  return true;
}

export async function logOp(op: Partial<Op>): Promise<void> {
  await db.ops.add({
    type: op.type || 'unknown',
    barcode: op.barcode,
    cell: op.cell,
    source_cell: op.source_cell,
    target_cell: op.target_cell,
    qty: op.qty || 0,
    operator: op.operator,
    batch_id: op.batch_id,
    order_id: op.order_id,
    session_id: op.session_id,
    note: op.note,
    ts: Date.now(),
  });
}

// ═══════════════════════════════════════════════════════════
// ATOMIC WAREHOUSE OPERATIONS
// ═══════════════════════════════════════════════════════════

/**
 * Атомарная приёмка: создание партии (если задан lot/expiry), пополнение остатка
 * и запись в журнал — всё в одной транзакции.
 */
export async function receiveStock(input: {
  barcode: string;
  cell: string;
  qty: number;
  operator?: string;
  lot_number?: string;
  expiry_date?: string;
  supplier?: string;
  note?: string;
}): Promise<{ batch_id?: number }> {
  // Делегируем на сервер. Сервер сам атомарно обновит остатки, партии и журнал.
  const { opsApi } = await import('./lib/services');
  return opsApi.receive(input);
}

/**
 * Атомарная отгрузка с опциональной привязкой к заказу.
 * Если указан order_id — соответствующая строка заказа получает +qty к qty_fact,
 * статус строки обновляется (partial/done), статус заказа пересчитывается.
 */
export async function shipStock(input: {
  barcode: string;
  cell: string;
  qty: number;
  operator?: string;
  order_id?: number;
  note?: string;
}): Promise<void> {
  const { opsApi } = await import('./lib/services');
  await opsApi.ship(input);
}

/**
 * Атомарное перемещение товара между ячейками с записью в журнал.
 */
export async function moveStock(input: {
  barcode: string;
  from: string;
  to: string;
  qty: number;
  operator?: string;
  note?: string;
}): Promise<void> {
  const { opsApi } = await import('./lib/services');
  await opsApi.move(input);
}

// ═══════════════════════════════════════════════════════════
// MISC HELPERS
// ═══════════════════════════════════════════════════════════

export async function nextActNumber(prefix: string): Promise<string> {
  const key = `act_${prefix}_counter`;
  const current = parseInt(await getSetting(key, '0'));
  const next = current + 1;
  await setSetting(key, String(next));
  const year = new Date().getFullYear();
  const num = String(next).padStart(3, '0');
  return `${prefix}-${num}/${year}`;
}

export async function fullBackup(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLE_NAMES) {
    try {
      data[t] = await (db as unknown as Record<string, Table>)[t].toArray();
    } catch {
      data[t] = [];
    }
  }
  return JSON.stringify({ version: '7.0.0', exported_at: new Date().toISOString(), data }, null, 2);
}

export async function restoreBackup(json: string): Promise<{ tables: number; records: number }> {
  const parsed = JSON.parse(json);
  const data = parsed.data || parsed;
  let tables = 0;
  let records = 0;

  for (const t of TABLE_NAMES) {
    const rows = data[t];
    if (!Array.isArray(rows)) continue;
    const table = (db as unknown as Record<string, Table>)[t];
    await table.clear();
    if (rows.length > 0) await table.bulkPut(rows);
    tables++;
    records += rows.length;
  }

  return { tables, records };
}

export async function getDBStats(): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  for (const t of TABLE_NAMES) {
    try {
      stats[t] = await (db as unknown as Record<string, Table>)[t].count();
    } catch {
      stats[t] = 0;
    }
  }
  return stats;
}


// ═══════════════════════════════════════════════════════════
// AUDIT LOG HELPERS
// ═══════════════════════════════════════════════════════════

let currentAuditUser: { id?: number; username?: string } | null = null;

export function setAuditUser(user: { id?: number; username?: string } | null) {
  currentAuditUser = user;
}

export async function writeAudit(input: {
  action: string;
  entity?: string;
  entity_id?: string | number;
  details?: string | object;
}): Promise<void> {
  try {
    await db.audit_log.add({
      ts: Date.now(),
      user_id: currentAuditUser?.id,
      username: currentAuditUser?.username,
      action: input.action,
      entity: input.entity,
      entity_id: input.entity_id !== undefined ? String(input.entity_id) : undefined,
      details: typeof input.details === 'string' ? input.details : input.details ? JSON.stringify(input.details) : undefined,
    });
  } catch {
    // Никогда не падаем на ошибке аудита
  }
}

export async function listAudit(opts: { limit?: number; action?: string; userId?: number } = {}): Promise<AuditLog[]> {
  let coll = db.audit_log.orderBy('id').reverse();
  if (opts.action) coll = coll.filter(a => a.action === opts.action);
  if (opts.userId !== undefined) coll = coll.filter(a => a.user_id === opts.userId);
  return coll.limit(opts.limit ?? 200).toArray();
}

export async function clearAudit(): Promise<void> {
  await db.audit_log.clear();
}

// ═══════════════════════════════════════════════════════════
// RESERVATIONS & DOSTUPNOSTI (доступные = qty - reserved)
// ═══════════════════════════════════════════════════════════

/** Снять резерв под конкретный заказ (или конкретную строку заказа). */
export async function clearReservationsForOrder(order_id: number, order_line_id?: number): Promise<void> {
  await db.transaction('rw', db.reservations, async () => {
    const rows = await db.reservations.where('order_id').equals(order_id).toArray();
    const ids = rows
      .filter(r => order_line_id === undefined || r.order_line_id === order_line_id)
      .map(r => r.id!)
      .filter(Boolean);
    if (ids.length > 0) await db.reservations.bulkDelete(ids);
  });
}

/** Сумма зарезервированных qty по штрихкоду (опц. в конкретной ячейке). */
export async function getReservedQty(barcode: string, cell?: string): Promise<number> {
  const list = await db.reservations.where('barcode').equals(barcode).toArray();
  return list
    .filter(r => cell === undefined || r.cell === cell)
    .reduce((s, r) => s + (r.qty || 0), 0);
}

/**
 * Доступно к отгрузке = qty в ячейке − зарезервировано в ней (под другие заказы).
 * Если задан `exclude_order_id` — резервы этого заказа считаются "своими" и не вычитаются.
 */
export async function getAvailableQty(
  barcode: string,
  cell: string,
  exclude_order_id?: number
): Promise<number> {
  const stock = await db.stock.get([barcode, cell]);
  const qty = stock?.qty || 0;
  if (qty === 0) return 0;
  const all = await db.reservations.where('barcode').equals(barcode).toArray();
  const reserved = all
    .filter(r => r.cell === cell && r.order_id !== exclude_order_id)
    .reduce((s, r) => s + (r.qty || 0), 0);
  return Math.max(0, qty - reserved);
}

/**
 * Авто-резервирование под строку заказа по FIFO.
 * Возвращает массив созданных резервов.
 */
export async function reserveForOrderLine(input: {
  order_id: number;
  order_line_id: number;
  barcode: string;
  qty: number;
  operator?: string;
}): Promise<Reservation[]> {
  return db.transaction('rw', db.stock, db.reservations, async () => {
    const stocks = (await db.stock.where('barcode').equals(input.barcode).toArray())
      .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));

    const allRes = await db.reservations.where('barcode').equals(input.barcode).toArray();
    const reservedByCell = new Map<string, number>();
    for (const r of allRes) {
      if (r.order_id === input.order_id && r.order_line_id === input.order_line_id) continue;
      reservedByCell.set(r.cell, (reservedByCell.get(r.cell) || 0) + r.qty);
    }

    const existing = allRes.filter(r => r.order_id === input.order_id && r.order_line_id === input.order_line_id);
    if (existing.length > 0) {
      await db.reservations.bulkDelete(existing.map(r => r.id!).filter(Boolean) as number[]);
    }

    let remain = input.qty;
    const created: Reservation[] = [];
    const now = Date.now();

    for (const st of stocks) {
      if (remain <= 0) break;
      const available = Math.max(0, st.qty - (reservedByCell.get(st.cell) || 0));
      if (available <= 0) continue;
      const take = Math.min(available, remain);
      const id = await db.reservations.add({
        order_id: input.order_id,
        order_line_id: input.order_line_id,
        barcode: input.barcode,
        cell: st.cell,
        qty: take,
        created_at: now,
        operator: input.operator,
      }) as number;
      created.push({ id, order_id: input.order_id, order_line_id: input.order_line_id, barcode: input.barcode, cell: st.cell, qty: take, created_at: now, operator: input.operator });
      remain -= take;
    }

    await writeAudit({
      action: 'reserve',
      entity: 'order_line',
      entity_id: input.order_line_id,
      details: { barcode: input.barcode, qty: input.qty - remain, requested: input.qty },
    });

    return created;
  });
}

/** Шаг плана комплектации (Pick List). */
export interface PickStep {
  order_line_id: number;
  barcode: string;
  name: string;
  cell: string;
  qty_to_pick: number;
  qty_done: number;
  zone?: string;
  row?: string;
  level?: string;
}

/**
 * Построить отсортированный план сборки заказа.
 * Маршрут: зона → ряд → уровень → адрес (естественная сортировка).
 */
export async function buildPickList(order_id: number): Promise<PickStep[]> {
  const [lines, allRes, allCells, allProducts] = await Promise.all([
    db.orderLines.where('order_id').equals(order_id).toArray(),
    db.reservations.where('order_id').equals(order_id).toArray(),
    db.cells.toArray(),
    db.products.toArray(),
  ]);

  const cellMap = new Map(allCells.map(c => [c.addr, c]));
  const productMap = new Map(allProducts.map(p => [p.barcode, p]));
  const steps: PickStep[] = [];

  for (const line of lines) {
    if (line.status === 'done') continue;
    const reservedForLine = allRes.filter(r => r.order_line_id === line.id);

    if (reservedForLine.length === 0) {
      steps.push({
        order_line_id: line.id!,
        barcode: line.barcode,
        name: productMap.get(line.barcode)?.name || line.barcode,
        cell: '',
        qty_to_pick: Math.max(0, line.qty_plan - line.qty_fact),
        qty_done: line.qty_fact,
      });
      continue;
    }

    let remainingFact = line.qty_fact;
    for (const r of reservedForLine) {
      const fromThis = Math.min(r.qty, remainingFact);
      const toPick = r.qty - fromThis;
      remainingFact -= fromThis;
      if (toPick <= 0) continue;
      const cell = cellMap.get(r.cell);
      steps.push({
        order_line_id: line.id!,
        barcode: line.barcode,
        name: productMap.get(line.barcode)?.name || line.barcode,
        cell: r.cell,
        qty_to_pick: toPick,
        qty_done: fromThis,
        zone: cell?.zone,
        row: cell?.row,
        level: cell?.level,
      });
    }
  }

  steps.sort((a, b) => {
    const az = (a.zone || '').localeCompare(b.zone || '', 'ru', { numeric: true });
    if (az !== 0) return az;
    const ar = (a.row || '').localeCompare(b.row || '', 'ru', { numeric: true });
    if (ar !== 0) return ar;
    const al = (a.level || '').localeCompare(b.level || '', 'ru', { numeric: true });
    if (al !== 0) return al;
    return a.cell.localeCompare(b.cell, 'ru', { numeric: true });
  });

  return steps;
}
