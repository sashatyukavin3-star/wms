/**
 * Схема БД Storra WMS — Drizzle ORM для SQLite.
 *
 * Принципы:
 *  - Все таблицы имеют updated_at (Unix ms) — для синхронизации клиента
 *  - Soft-delete через поле `deleted` — чтобы клиенты увидели удаления
 *  - Денежные суммы хранятся в копейках (integer), чтобы не было floating-point
 *  - Все ключевые операции (приёмка/отгрузка/перемещение) пишутся в `ops`
 *  - Резервы (`reservations`) делают возможной нормальную работу нескольких операторов
 */

import { sql } from 'drizzle-orm';
import { index,integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─────────────────────────────────────────────────────────────
// Пользователи (auth)
// ─────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  full_name: text('full_name').notNull(),
  role: text('role').notNull().$type<'operator' | 'supervisor' | 'admin'>(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  last_login_at: integer('last_login_at'),
});

// ─────────────────────────────────────────────────────────────
// Товары
// ─────────────────────────────────────────────────────────────
export const products = sqliteTable(
  'products',
  {
    barcode: text('barcode').primaryKey(),
    name: text('name').notNull(),
    category: text('category'),
    supplier: text('supplier'),
    unit: text('unit').notNull().default('шт'),
    weight_gross: integer('weight_gross'), // в граммах
    weight_net: integer('weight_net'),
    dim_l: integer('dim_l'), // мм
    dim_w: integer('dim_w'),
    dim_h: integer('dim_h'),
    has_expiry: integer('has_expiry', { mode: 'boolean' }).default(false),
    expiry_days: integer('expiry_days'),
    min_stock: integer('min_stock'),
    max_stock: integer('max_stock'),
    abc_class: text('abc_class').$type<'A' | 'B' | 'C' | ''>(),
    xyz_class: text('xyz_class').$type<'X' | 'Y' | 'Z' | ''>(),
    deleted: integer('deleted', { mode: 'boolean' }).default(false),
    created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    name_idx: index('products_name_idx').on(t.name),
    updated_idx: index('products_updated_idx').on(t.updated_at),
  })
);

// ─────────────────────────────────────────────────────────────
// Ячейки
// ─────────────────────────────────────────────────────────────
export const cells = sqliteTable(
  'cells',
  {
    addr: text('addr').primaryKey(),
    zone: text('zone'),
    row: text('row'),
    level: text('level'),
    type: text('type').notNull().$type<'pallet' | 'box' | 'shelf' | 'oversize'>(),
    status: text('status').notNull().$type<'free' | 'occupied' | 'blocked' | 'quarantine'>(),
    max_pallets: integer('max_pallets'),
    max_weight: integer('max_weight'),
    max_units: integer('max_units'),
    allow_mixed_sku: integer('allow_mixed_sku', { mode: 'boolean' }).default(true),
    pick_priority: integer('pick_priority'),
    putaway_priority: integer('putaway_priority'),
    is_picking_face: integer('is_picking_face', { mode: 'boolean' }).default(false),
    deleted: integer('deleted', { mode: 'boolean' }).default(false),
    updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    zone_idx: index('cells_zone_idx').on(t.zone),
    status_idx: index('cells_status_idx').on(t.status),
    updated_idx: index('cells_updated_idx').on(t.updated_at),
  })
);

// ─────────────────────────────────────────────────────────────
// Остатки (composite key: barcode + cell)
// ─────────────────────────────────────────────────────────────
export const stock = sqliteTable(
  'stock',
  {
    barcode: text('barcode').notNull(),
    cell: text('cell').notNull(),
    qty: integer('qty').notNull().default(0),
    batch_id: integer('batch_id'),
    expiry_date: text('expiry_date'),
    updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    pk: primaryKey({ columns: [t.barcode, t.cell] }),
    barcode_idx: index('stock_barcode_idx').on(t.barcode),
    cell_idx: index('stock_cell_idx').on(t.cell),
    updated_idx: index('stock_updated_idx').on(t.updated_at),
  })
);

// ─────────────────────────────────────────────────────────────
// Партии
// ─────────────────────────────────────────────────────────────
export const batches = sqliteTable('batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  barcode: text('barcode').notNull(),
  cell: text('cell'),
  qty: integer('qty').notNull(),
  lot_number: text('lot_number'),
  supplier: text('supplier'),
  received_at: integer('received_at').notNull(),
  expiry_date: text('expiry_date'),
  cost_price: integer('cost_price'), // копейки
});

// ─────────────────────────────────────────────────────────────
// ASN (ожидаемые входящие поставки)
// ─────────────────────────────────────────────────────────────
export const asns = sqliteTable(
  'asns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    asn_number: text('asn_number').notNull().unique(),
    supplier: text('supplier'),
    status: text('status').notNull().$type<'draft' | 'arrived' | 'receiving' | 'completed' | 'cancelled'>(),
    eta_date: text('eta_date'),
    arrived_at: integer('arrived_at'),
    note: text('note'),
    created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    status_idx: index('asns_status_idx').on(t.status),
    updated_idx: index('asns_updated_idx').on(t.updated_at),
  })
);

export const asnLines = sqliteTable('asn_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  asn_id: integer('asn_id').notNull().references(() => asns.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(),
  qty_expected: integer('qty_expected').notNull(),
  qty_received: integer('qty_received').notNull().default(0),
  qty_damaged: integer('qty_damaged').notNull().default(0),
  qc_status: text('qc_status').notNull().$type<'pending' | 'accepted' | 'accepted_with_issue' | 'rejected'>().default('pending'),
  discrepancy_reason: text('discrepancy_reason'),
  status: text('status').notNull().$type<'pending' | 'partial' | 'received' | 'issue'>(),
  note: text('note'),
});

// ─────────────────────────────────────────────────────────────
// Заказы и строки
// ─────────────────────────────────────────────────────────────
export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ext_id: text('ext_id'),
    status: text('status').notNull().$type<'new' | 'picking' | 'picked' | 'packed' | 'shipped' | 'cancelled'>(),
    customer: text('customer'),
    created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    closed_at: integer('closed_at'),
    packed_at: integer('packed_at'),
    packed_by: text('packed_by'),
    package_count: integer('package_count'),
    operator: text('operator'),
    note: text('note'),
    updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    status_idx: index('orders_status_idx').on(t.status),
    updated_idx: index('orders_updated_idx').on(t.updated_at),
  })
);

export const orderLines = sqliteTable('order_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  order_id: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(),
  qty_plan: integer('qty_plan').notNull(),
  qty_fact: integer('qty_fact').notNull().default(0),
  status: text('status').notNull().$type<'pending' | 'partial' | 'done'>(),
});

// ─────────────────────────────────────────────────────────────
// Резервы под заказы
// ─────────────────────────────────────────────────────────────
export const reservations = sqliteTable(
  'reservations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    order_id: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    order_line_id: integer('order_line_id'),
    barcode: text('barcode').notNull(),
    cell: text('cell').notNull(),
    qty: integer('qty').notNull(),
    created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    operator: text('operator'),
  },
  t => ({
    order_idx: index('res_order_idx').on(t.order_id),
    barcode_cell_idx: index('res_barcode_cell_idx').on(t.barcode, t.cell),
  })
);

// ─────────────────────────────────────────────────────────────
// Возвраты
// ─────────────────────────────────────────────────────────────
export const returnDocs = sqliteTable(
  'returns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    return_number: text('return_number').notNull().unique(),
    order_id: integer('order_id'),
    customer: text('customer'),
    reason: text('reason'),
    status: text('status').notNull().$type<'draft' | 'received' | 'completed' | 'cancelled'>(),
    note: text('note'),
    received_at: integer('received_at'),
    processed_at: integer('processed_at'),
    created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    status_idx: index('returns_status_idx').on(t.status),
    updated_idx: index('returns_updated_idx').on(t.updated_at),
  })
);

export const returnLines = sqliteTable('return_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  return_id: integer('return_id').notNull().references(() => returnDocs.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(),
  qty_expected: integer('qty_expected').notNull(),
  qty_received: integer('qty_received').notNull().default(0),
  qty_restocked: integer('qty_restocked').notNull().default(0),
  qty_quarantined: integer('qty_quarantined').notNull().default(0),
  qty_scrapped: integer('qty_scrapped').notNull().default(0),
  disposition: text('disposition').notNull().$type<'restock' | 'quarantine' | 'scrap'>().default('restock'),
  status: text('status').notNull().$type<'pending' | 'partial' | 'processed' | 'issue'>(),
  note: text('note'),
  reason: text('reason'),
});

// ─────────────────────────────────────────────────────────────
// Cycle Count / directed counting
// ─────────────────────────────────────────────────────────────
export const cycleCounts = sqliteTable(
  'cycle_counts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    task_number: text('task_number').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').notNull().$type<'planned' | 'active' | 'completed' | 'cancelled'>(),
    zone_filter: text('zone_filter'),
    created_by: text('created_by'),
    note: text('note'),
    started_at: integer('started_at'),
    completed_at: integer('completed_at'),
    created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    status_idx: index('cycle_counts_status_idx').on(t.status),
    updated_idx: index('cycle_counts_updated_idx').on(t.updated_at),
  })
);

export const cycleCountLines = sqliteTable('cycle_count_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cycle_count_id: integer('cycle_count_id').notNull().references(() => cycleCounts.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(),
  cell: text('cell').notNull(),
  qty_system: integer('qty_system').notNull(),
  qty_counted: integer('qty_counted').notNull().default(0),
  delta: integer('delta').notNull().default(0),
  priority: integer('priority').notNull().default(0),
  reason: text('reason'),
  status: text('status').notNull().$type<'pending' | 'counted' | 'adjusted' | 'skipped'>(),
  note: text('note'),
  created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
});

// ─────────────────────────────────────────────────────────────
// Журнал операций (бизнес-операции склада)
// ─────────────────────────────────────────────────────────────
export const ops = sqliteTable(
  'ops',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(), // receive | ship | move | adjust ...
    barcode: text('barcode'),
    cell: text('cell'),
    source_cell: text('source_cell'),
    target_cell: text('target_cell'),
    qty: integer('qty').notNull().default(0),
    operator: text('operator'),
    batch_id: integer('batch_id'),
    order_id: integer('order_id'),
    session_id: integer('session_id'),
    note: text('note'),
    ts: integer('ts').notNull().default(sql`(unixepoch() * 1000)`),
  },
  t => ({
    type_idx: index('ops_type_idx').on(t.type),
    ts_idx: index('ops_ts_idx').on(t.ts),
  })
);

// ─────────────────────────────────────────────────────────────
// Аудит (действия пользователей)
// ─────────────────────────────────────────────────────────────
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull().default(sql`(unixepoch() * 1000)`),
    user_id: integer('user_id'),
    username: text('username'),
    action: text('action').notNull(),
    entity: text('entity'),
    entity_id: text('entity_id'),
    details: text('details'),
    ip: text('ip'),
  },
  t => ({
    ts_idx: index('audit_ts_idx').on(t.ts),
    user_idx: index('audit_user_idx').on(t.user_id),
  })
);

// ─────────────────────────────────────────────────────────────
// Инвентаризации
// ─────────────────────────────────────────────────────────────
export const invSessions = sqliteTable('inv_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  status: text('status').notNull().$type<'active' | 'closed'>(),
  zone_filter: text('zone_filter'),
  operator: text('operator'),
  created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  closed_at: integer('closed_at'),
});

export const invLines = sqliteTable('inv_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  session_id: integer('session_id').notNull().references(() => invSessions.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(),
  cell: text('cell').notNull(),
  qty_system: integer('qty_system').notNull(),
  qty_fact: integer('qty_fact').notNull(),
  delta: integer('delta').notNull(),
  ts: integer('ts').notNull().default(sql`(unixepoch() * 1000)`),
});

// ─────────────────────────────────────────────────────────────
// Акты (хранятся как JSON для простоты, схема меняется чаще остального)
// ─────────────────────────────────────────────────────────────
export const inspectionActs = sqliteTable('inspection_acts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  act_number: text('act_number').notNull(),
  date: text('date').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(), // полный объект акта
  status: text('status').notNull(),
  created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
});

export const reworkActs = sqliteTable('rework_acts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  act_number: text('act_number').notNull(),
  date: text('date').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  status: text('status').notNull(),
  created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updated_at: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
});

// ─────────────────────────────────────────────────────────────
// Стикеры (задания печати)
// ─────────────────────────────────────────────────────────────
export const stickerJobs = sqliteTable('sticker_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  template_id: text('template_id').notNull().$type<'6x6' | '10x15'>(),
  payload: text('payload', { mode: 'json' }).notNull(),
  created_at: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  printed_at: integer('printed_at'),
});

// ─────────────────────────────────────────────────────────────
// Настройки (key-value)
// ─────────────────────────────────────────────────────────────
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
