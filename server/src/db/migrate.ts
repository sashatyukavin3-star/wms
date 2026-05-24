/**
 * Простая миграция без drizzle-kit — генерируем DDL прямо в коде.
 * Удобно для single-binary деплоя на склад: одна команда `npm start`
 * автоматически поднимает схему.
 */

import { sqlite } from './index.ts';

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    last_login_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS products (
    barcode TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    supplier TEXT,
    unit TEXT NOT NULL DEFAULT 'шт',
    weight_gross INTEGER,
    weight_net INTEGER,
    dim_l INTEGER,
    dim_w INTEGER,
    dim_h INTEGER,
    has_expiry INTEGER DEFAULT 0,
    expiry_days INTEGER,
    min_stock INTEGER,
    max_stock INTEGER,
    abc_class TEXT,
    xyz_class TEXT,
    deleted INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS products_name_idx ON products(name)`,
  `CREATE INDEX IF NOT EXISTS products_updated_idx ON products(updated_at)`,

  `CREATE TABLE IF NOT EXISTS cells (
    addr TEXT PRIMARY KEY,
    zone TEXT,
    row TEXT,
    level TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    max_pallets INTEGER,
    max_weight INTEGER,
    max_units INTEGER,
    allow_mixed_sku INTEGER DEFAULT 1,
    pick_priority INTEGER,
    putaway_priority INTEGER,
    is_picking_face INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS cells_zone_idx ON cells(zone)`,
  `CREATE INDEX IF NOT EXISTS cells_status_idx ON cells(status)`,
  `CREATE INDEX IF NOT EXISTS cells_updated_idx ON cells(updated_at)`,

  `CREATE TABLE IF NOT EXISTS stock (
    barcode TEXT NOT NULL,
    cell TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 0,
    batch_id INTEGER,
    expiry_date TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (barcode, cell)
  )`,
  `CREATE INDEX IF NOT EXISTS stock_barcode_idx ON stock(barcode)`,
  `CREATE INDEX IF NOT EXISTS stock_cell_idx ON stock(cell)`,
  `CREATE INDEX IF NOT EXISTS stock_updated_idx ON stock(updated_at)`,

  `CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT NOT NULL,
    cell TEXT,
    qty INTEGER NOT NULL,
    lot_number TEXT,
    supplier TEXT,
    received_at INTEGER NOT NULL,
    expiry_date TEXT,
    cost_price INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS asns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asn_number TEXT NOT NULL UNIQUE,
    supplier TEXT,
    status TEXT NOT NULL,
    eta_date TEXT,
    arrived_at INTEGER,
    note TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS asns_status_idx ON asns(status)`,
  `CREATE INDEX IF NOT EXISTS asns_updated_idx ON asns(updated_at)`,

  `CREATE TABLE IF NOT EXISTS asn_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asn_id INTEGER NOT NULL REFERENCES asns(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    qty_expected INTEGER NOT NULL,
    qty_received INTEGER NOT NULL DEFAULT 0,
    qty_damaged INTEGER NOT NULL DEFAULT 0,
    qc_status TEXT NOT NULL DEFAULT 'pending',
    discrepancy_reason TEXT,
    status TEXT NOT NULL,
    note TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ext_id TEXT,
    status TEXT NOT NULL,
    customer TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    closed_at INTEGER,
    packed_at INTEGER,
    packed_by TEXT,
    package_count INTEGER,
    operator TEXT,
    note TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS orders_updated_idx ON orders(updated_at)`,

  `CREATE TABLE IF NOT EXISTS order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    qty_plan INTEGER NOT NULL,
    qty_fact INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_line_id INTEGER,
    barcode TEXT NOT NULL,
    cell TEXT NOT NULL,
    qty INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    operator TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS res_order_idx ON reservations(order_id)`,
  `CREATE INDEX IF NOT EXISTS res_barcode_cell_idx ON reservations(barcode, cell)`,

  `CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_number TEXT NOT NULL UNIQUE,
    order_id INTEGER,
    customer TEXT,
    reason TEXT,
    status TEXT NOT NULL,
    note TEXT,
    received_at INTEGER,
    processed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS returns_status_idx ON returns(status)`,
  `CREATE INDEX IF NOT EXISTS returns_updated_idx ON returns(updated_at)`,

  `CREATE TABLE IF NOT EXISTS return_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    qty_expected INTEGER NOT NULL,
    qty_received INTEGER NOT NULL DEFAULT 0,
    qty_restocked INTEGER NOT NULL DEFAULT 0,
    qty_quarantined INTEGER NOT NULL DEFAULT 0,
    qty_scrapped INTEGER NOT NULL DEFAULT 0,
    disposition TEXT NOT NULL DEFAULT 'restock',
    status TEXT NOT NULL,
    note TEXT,
    reason TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS cycle_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    zone_filter TEXT,
    created_by TEXT,
    note TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS cycle_counts_status_idx ON cycle_counts(status)`,
  `CREATE INDEX IF NOT EXISTS cycle_counts_updated_idx ON cycle_counts(updated_at)`,

  `CREATE TABLE IF NOT EXISTS cycle_count_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_count_id INTEGER NOT NULL REFERENCES cycle_counts(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    cell TEXT NOT NULL,
    qty_system INTEGER NOT NULL,
    qty_counted INTEGER NOT NULL DEFAULT 0,
    delta INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    status TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    barcode TEXT,
    cell TEXT,
    source_cell TEXT,
    target_cell TEXT,
    qty INTEGER NOT NULL DEFAULT 0,
    operator TEXT,
    batch_id INTEGER,
    order_id INTEGER,
    session_id INTEGER,
    note TEXT,
    ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS ops_type_idx ON ops(type)`,
  `CREATE INDEX IF NOT EXISTS ops_ts_idx ON ops(ts)`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    ip TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log(ts)`,
  `CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_log(user_id)`,

  `CREATE TABLE IF NOT EXISTS inv_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    zone_filter TEXT,
    operator TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    closed_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS inv_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES inv_sessions(id) ON DELETE CASCADE,
    barcode TEXT NOT NULL,
    cell TEXT NOT NULL,
    qty_system INTEGER NOT NULL,
    qty_fact INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS inspection_acts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    act_number TEXT NOT NULL,
    date TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS rework_acts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    act_number TEXT NOT NULL,
    date TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE TABLE IF NOT EXISTS sticker_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    printed_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

const COLUMN_PATCHES = [
  { table: 'cells', column: 'max_units', ddl: 'ALTER TABLE cells ADD COLUMN max_units INTEGER' },
  { table: 'cells', column: 'allow_mixed_sku', ddl: 'ALTER TABLE cells ADD COLUMN allow_mixed_sku INTEGER DEFAULT 1' },
  { table: 'cells', column: 'pick_priority', ddl: 'ALTER TABLE cells ADD COLUMN pick_priority INTEGER' },
  { table: 'cells', column: 'putaway_priority', ddl: 'ALTER TABLE cells ADD COLUMN putaway_priority INTEGER' },
  { table: 'cells', column: 'is_picking_face', ddl: 'ALTER TABLE cells ADD COLUMN is_picking_face INTEGER DEFAULT 0' },
  { table: 'asn_lines', column: 'qty_damaged', ddl: 'ALTER TABLE asn_lines ADD COLUMN qty_damaged INTEGER NOT NULL DEFAULT 0' },
  { table: 'asn_lines', column: 'qc_status', ddl: "ALTER TABLE asn_lines ADD COLUMN qc_status TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'asn_lines', column: 'discrepancy_reason', ddl: 'ALTER TABLE asn_lines ADD COLUMN discrepancy_reason TEXT' },
  { table: 'orders', column: 'packed_at', ddl: 'ALTER TABLE orders ADD COLUMN packed_at INTEGER' },
  { table: 'orders', column: 'packed_by', ddl: 'ALTER TABLE orders ADD COLUMN packed_by TEXT' },
  { table: 'orders', column: 'package_count', ddl: 'ALTER TABLE orders ADD COLUMN package_count INTEGER' },
] as const;

function columnExists(table: string, column: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }> ;
  return rows.some(row => row.name === column);
}

export function migrate() {
  sqlite.transaction(() => {
    for (const stmt of DDL) sqlite.exec(stmt);
    for (const patch of COLUMN_PATCHES) {
      if (!columnExists(patch.table, patch.column)) sqlite.exec(patch.ddl);
    }
  })();
}

// Если запускают напрямую: node migrate.js
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  console.log('✓ Миграция выполнена');
}
