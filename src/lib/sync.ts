/**
 * Sync Engine: синхронизирует серверную БД с локальным Dexie-кэшем.
 *
 * Принцип:
 *   1. При старте — full sync (всё с сервера → Dexie)
 *   2. WebSocket-события "<entity>:changed" → подкачиваем дельту по updated_at
 *   3. Все мутации (write) идут только через сервер (см. lib/services.ts)
 *
 * Это позволяет страницам, которые сейчас читают из Dexie напрямую,
 * продолжать работать — но данные у них будут актуальные с сервера.
 */

import { db } from '../db';
import { getToken } from './api';
import { actsApi,cellsApi, opsApi, ordersApi, productsApi, settingsApi, stockApi } from './services';
import { subscribe } from './ws';

const LAST_SYNC_KEY = 'storra_last_sync_v1';

interface LastSync {
  products: number;
  cells: number;
  stock: number;
  orders: number;
  ops: number;
}

function saveLast(s: LastSync) {
  try { localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

let syncing = false;

/** Полная синхронизация всех таблиц с сервера в Dexie. */
export async function fullSync(): Promise<void> {
  if (!getToken()) return;
  if (syncing) return;
  syncing = true;
  try {
    const [products, cells, stock, orders, opsList, settings] = await Promise.all([
      productsApi.list(),
      cellsApi.list(),
      stockApi.list(),
      ordersApi.list(),
      opsApi.list({ limit: 500 }).catch(() => []),
      settingsApi.getAll().catch(() => ({} as Record<string, string>)),
    ]);

    await db.transaction('rw', [db.products, db.cells, db.stock, db.orders, db.ops, db.settings], async () => {
      await db.products.clear(); if (products.length) await db.products.bulkPut(products);
      await db.cells.clear(); if (cells.length) await db.cells.bulkPut(cells);
      await db.stock.clear(); if (stock.length) await db.stock.bulkPut(stock);
      await db.orders.clear(); if (orders.length) await db.orders.bulkPut(orders);
      // ops затираем только если что-то пришло (на пустом сервере не уничтожаем локальный лог)
      if (opsList.length) {
        await db.ops.clear();
        await db.ops.bulkPut(opsList);
      }
      // Settings — мерж: серверные перезаписывают локальные
      for (const [key, value] of Object.entries(settings)) {
        await db.settings.put({ key, value });
      }
    });

    // Заодно строки заказов
    if (orders.length > 0) {
      const allLines = await Promise.all(
        orders.map(o => ordersApi.getLines(o.id!).catch(() => []))
      );
      await db.transaction('rw', db.orderLines, async () => {
        await db.orderLines.clear();
        const flat = allLines.flat();
        if (flat.length) await db.orderLines.bulkPut(flat);
      });
    }

    // Акты — храним в Dexie как было (страницы их читают из Dexie)
    try {
      const [inspActs, reworkActs] = await Promise.all([
        actsApi.listInspection(),
        actsApi.listRework(),
      ]);
      await db.transaction('rw', [db.inspectionActs, db.reworkActs], async () => {
        await db.inspectionActs.clear();
        for (const a of inspActs) {
          // payload приходит как объект, разворачиваем поля наверх для совместимости
          const payload = (a.payload || {}) as Record<string, unknown>;
          await db.inspectionActs.put({
            id: a.id,
            act_number: a.act_number,
            type: 'cell_inspection',
            date: a.date,
            created_at: a.created_at,
            updated_at: a.updated_at,
            status: a.status as 'draft' | 'saved' | 'printed',
            rows: (payload.rows as []) || [],
            warehouse: payload.warehouse as string,
            warehouse_addr: payload.warehouse_addr as string,
            zone_span: payload.zone_span as string,
            aisle_from: payload.aisle_from as string,
            aisle_to: payload.aisle_to as string,
            sheet_no: payload.sheet_no as number,
            sheets_total: payload.sheets_total as number,
            inspector_high: payload.inspector_high as string,
            inspector_low: payload.inspector_low as string,
            inspector_position: payload.inspector_position as string,
            note: payload.note as string,
          });
        }
        await db.reworkActs.clear();
        for (const a of reworkActs) {
          const payload = (a.payload || {}) as Record<string, unknown>;
          await db.reworkActs.put({
            id: a.id,
            act_number: a.act_number,
            date: a.date,
            created_at: a.created_at,
            updated_at: a.updated_at,
            status: a.status as 'draft' | 'saved' | 'printed',
            positions: (payload.positions as []) || [],
            warehouse: payload.warehouse as string,
            warehouse_addr: payload.warehouse_addr as string,
            zone: payload.zone as string,
            source: payload.source as string,
            destination: payload.destination as string,
            reason: payload.reason as string,
            ref_document: payload.ref_document as string,
            start_time: payload.start_time as string,
            end_time: payload.end_time as string,
            workers: payload.workers as string,
            supervisor: payload.supervisor as string,
            pallets_total: payload.pallets_total as number,
            items_total: payload.items_total as number,
            good_total: payload.good_total as number,
            defect_total: payload.defect_total as number,
            note: payload.note as string,
          });
        }
      });
    } catch { /* акты опциональны */ }

    saveLast({ products: Date.now(), cells: Date.now(), stock: Date.now(), orders: Date.now(), ops: Date.now() });
  } finally {
    syncing = false;
  }
}

// ─── Дельта-обновления по WS-событиям ──────────────────────
const debouncers = new Map<string, ReturnType<typeof setTimeout>>();
function debounce(key: string, fn: () => void, ms = 200) {
  const prev = debouncers.get(key);
  if (prev) clearTimeout(prev);
  debouncers.set(key, setTimeout(() => {
    debouncers.delete(key);
    fn();
  }, ms));
}

let started = false;

/** Запустить sync engine: full sync + подписка на WS. */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  await fullSync();
  subscribe(evt => {
    if (evt.type === 'product:changed')      debounce('products', refreshProducts);
    else if (evt.type === 'cell:changed')    debounce('cells',    refreshCells);
    else if (evt.type === 'stock:changed')   debounce('stock',    refreshStock);
    else if (evt.type === 'order:changed' || evt.type === 'order_line:changed') {
      debounce('orders', refreshOrders);
    }
    else if (evt.type === 'op:created')      debounce('ops', refreshOps);
    else if (evt.type === 'act:changed')     debounce('acts', refreshActs);
    else if (evt.type === 'welcome')         debounce('all',    fullSync, 50);
  });
}

async function refreshProducts() {
  try {
    const list = await productsApi.list();
    await db.transaction('rw', db.products, async () => {
      await db.products.clear();
      if (list.length) await db.products.bulkPut(list);
    });
  } catch { /* noop */ }
}
async function refreshCells() {
  try {
    const list = await cellsApi.list();
    await db.transaction('rw', db.cells, async () => {
      await db.cells.clear();
      if (list.length) await db.cells.bulkPut(list);
    });
  } catch { /* noop */ }
}
async function refreshStock() {
  try {
    const list = await stockApi.list();
    await db.transaction('rw', db.stock, async () => {
      await db.stock.clear();
      if (list.length) await db.stock.bulkPut(list);
    });
  } catch { /* noop */ }
}
async function refreshOrders() {
  try {
    const list = await ordersApi.list();
    await db.transaction('rw', [db.orders, db.orderLines], async () => {
      await db.orders.clear();
      if (list.length) await db.orders.bulkPut(list);
      await db.orderLines.clear();
      for (const o of list) {
        try {
          const lines = await ordersApi.getLines(o.id!);
          if (lines.length) await db.orderLines.bulkPut(lines);
        } catch { /* noop */ }
      }
    });
  } catch { /* noop */ }
}
async function refreshOps() {
  try {
    const list = await opsApi.list({ limit: 500 });
    await db.transaction('rw', db.ops, async () => {
      await db.ops.clear();
      if (list.length) await db.ops.bulkPut(list);
    });
  } catch { /* noop */ }
}
async function refreshActs() {
  await fullSync(); // акты редко меняются — проще пере-засинкать всё
}
