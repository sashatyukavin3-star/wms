/**
 * Атомарные операции склада: приёмка, отгрузка, перемещение.
 *
 * Ключевой принцип: всё внутри одной SQLite-транзакции с проверкой остатков.
 * SQLite в single-writer режиме гарантирует, что два конкурентных запроса
 * не уведут остаток в минус (даже без явных блокировок).
 */

import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { batches, ops, orderLines, orders, reservations,stock } from '../db/schema.ts';
import { requireAuth,requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

// ─── GET остатки ────────────────────────────────────────────
export async function stockRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { since?: string; barcode?: string; cell?: string } }>(
    '/api/stock',
    { preHandler: requireAuth },
    async req => {
      const since = req.query.since ? Number(req.query.since) : 0;
      const conds = [];
      if (since > 0) conds.push(gt(stock.updated_at, since));
      if (req.query.barcode) conds.push(eq(stock.barcode, req.query.barcode));
      if (req.query.cell) conds.push(eq(stock.cell, req.query.cell));
      const where = conds.length ? and(...conds) : undefined;
      return where ? db.select().from(stock).where(where).all() : db.select().from(stock).all();
    }
  );

  // ─── ПРИЁМКА ────────────────────────────────────────────
  const receiveSchema = z.object({
    barcode: z.string().min(1),
    cell: z.string().min(1),
    qty: z.number().int().positive(),
    operator: z.string().optional(),
    lot_number: z.string().optional(),
    expiry_date: z.string().optional(),
    supplier: z.string().optional(),
    note: z.string().optional(),
  });

  app.post('/api/ops/receive', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });
    const data = parsed.data;
    const now = Date.now();

    const result = db.transaction(() => {
      let batch_id: number | undefined;
      if (data.lot_number || data.expiry_date) {
        const b = db.insert(batches).values({
          barcode: data.barcode, cell: data.cell, qty: data.qty,
          lot_number: data.lot_number, supplier: data.supplier,
          received_at: now, expiry_date: data.expiry_date,
        }).returning({ id: batches.id }).get();
        batch_id = b!.id;
      }

      const existing = db.select().from(stock).where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.cell))).get();
      if (existing) {
        db.update(stock).set({
          qty: existing.qty + data.qty,
          batch_id: batch_id ?? existing.batch_id,
          expiry_date: data.expiry_date ?? existing.expiry_date,
          updated_at: now,
        }).where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.cell))).run();
      } else {
        db.insert(stock).values({
          barcode: data.barcode, cell: data.cell, qty: data.qty,
          batch_id, expiry_date: data.expiry_date, updated_at: now,
        }).run();
      }

      db.insert(ops).values({
        type: 'receive', barcode: data.barcode, cell: data.cell, qty: data.qty,
        operator: data.operator, batch_id, note: data.note,
      }).run();

      return { batch_id };
    });

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'receive', entity: 'stock', entity_id: `${data.barcode}@${data.cell}`,
      details: { qty: data.qty, batch_id: result.batch_id, operator: data.operator },
    });

    broadcast({ type: 'stock:changed', barcode: data.barcode, cell: data.cell });
    broadcast({ type: 'op:created', op_type: 'receive' });

    return result;
  });

  // ─── ОТГРУЗКА ─────────────────────────────────────────────
  const shipSchema = z.object({
    barcode: z.string().min(1),
    cell: z.string().min(1),
    qty: z.number().int().positive(),
    operator: z.string().optional(),
    order_id: z.number().int().optional(),
    note: z.string().optional(),
  });

  app.post('/api/ops/ship', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = shipSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const data = parsed.data;

    try {
      db.transaction(() => {
        const existing = db.select().from(stock).where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.cell))).get();
        if (!existing || existing.qty < data.qty) {
          throw new Error('Недостаточно остатков в указанной ячейке');
        }
        if (existing.qty === data.qty) {
          db.delete(stock).where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.cell))).run();
        } else {
          db.update(stock).set({ qty: existing.qty - data.qty, updated_at: Date.now() })
            .where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.cell))).run();
        }

        db.insert(ops).values({
          type: 'ship', barcode: data.barcode, cell: data.cell, qty: data.qty,
          operator: data.operator, order_id: data.order_id, note: data.note,
        }).run();

        // Если указан заказ — обновить qty_fact, статус строки и заказа, снять резерв
        if (data.order_id) {
          const lines = db.select().from(orderLines).where(eq(orderLines.order_id, data.order_id)).all();
          const line = lines.find(l => l.barcode === data.barcode && l.status !== 'done');
          if (line) {
            const qty_fact = line.qty_fact + data.qty;
            const status: 'partial' | 'done' = qty_fact >= line.qty_plan ? 'done' : 'partial';
            db.update(orderLines).set({ qty_fact, status }).where(eq(orderLines.id, line.id)).run();

            // Снять/уменьшить резерв этого заказа в этой ячейке
            const myRes = db.select().from(reservations).where(
              and(
                eq(reservations.order_id, data.order_id),
                eq(reservations.barcode, data.barcode),
                eq(reservations.cell, data.cell),
              )
            ).all();
            let toRelease = data.qty;
            for (const r of myRes) {
              if (toRelease <= 0) break;
              if (r.qty <= toRelease) {
                toRelease -= r.qty;
                db.delete(reservations).where(eq(reservations.id, r.id)).run();
              } else {
                db.update(reservations).set({ qty: r.qty - toRelease }).where(eq(reservations.id, r.id)).run();
                toRelease = 0;
              }
            }
          }

          // Пересчёт статуса заказа
          const order = db.select().from(orders).where(eq(orders.id, data.order_id)).get();
          if (order) {
            const allLines = db.select().from(orderLines).where(eq(orderLines.order_id, data.order_id)).all();
            const allDone = allLines.length > 0 && allLines.every(l => l.status === 'done');
            const anyProgress = allLines.some(l => l.qty_fact > 0);
            if (allDone && (order.status === 'new' || order.status === 'picking')) {
              db.update(orders).set({ status: 'picked', updated_at: Date.now() }).where(eq(orders.id, data.order_id)).run();
            } else if (anyProgress && order.status === 'new') {
              db.update(orders).set({ status: 'picking', updated_at: Date.now() }).where(eq(orders.id, data.order_id)).run();
            }
          }
        }
      });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'Ошибка отгрузки' });
    }

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'ship', entity: 'stock', entity_id: `${data.barcode}@${data.cell}`,
      details: { qty: data.qty, order_id: data.order_id, operator: data.operator },
    });

    broadcast({ type: 'stock:changed', barcode: data.barcode, cell: data.cell });
    broadcast({ type: 'op:created', op_type: 'ship' });
    if (data.order_id) {
      broadcast({ type: 'order:changed', id: data.order_id });
      broadcast({ type: 'reservation:changed', order_id: data.order_id });
    }
    return { ok: true };
  });

  // ─── ПЕРЕМЕЩЕНИЕ ───────────────────────────────────────────
  const moveSchema = z.object({
    barcode: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    qty: z.number().int().positive(),
    operator: z.string().optional(),
    note: z.string().optional(),
  });

  app.post('/api/ops/move', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const data = parsed.data;
    if (data.from === data.to) return reply.code(400).send({ error: 'Исходная и целевая ячейки совпадают' });

    try {
      db.transaction(() => {
        const source = db.select().from(stock).where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.from))).get();
        if (!source || source.qty < data.qty) throw new Error('Недостаточно остатков в исходной ячейке');

        if (source.qty === data.qty) {
          db.delete(stock).where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.from))).run();
        } else {
          db.update(stock).set({ qty: source.qty - data.qty, updated_at: Date.now() })
            .where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.from))).run();
        }

        const target = db.select().from(stock).where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.to))).get();
        if (target) {
          db.update(stock).set({ qty: target.qty + data.qty, updated_at: Date.now() })
            .where(and(eq(stock.barcode, data.barcode), eq(stock.cell, data.to))).run();
        } else {
          db.insert(stock).values({
            barcode: data.barcode, cell: data.to, qty: data.qty,
            batch_id: source.batch_id, expiry_date: source.expiry_date, updated_at: Date.now(),
          }).run();
        }

        db.insert(ops).values({
          type: 'move', barcode: data.barcode, source_cell: data.from, target_cell: data.to,
          qty: data.qty, operator: data.operator, note: data.note,
        }).run();
      });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'Ошибка перемещения' });
    }

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'move', entity: 'stock', entity_id: data.barcode,
      details: { from: data.from, to: data.to, qty: data.qty },
    });

    broadcast({ type: 'stock:changed', barcode: data.barcode });
    broadcast({ type: 'op:created', op_type: 'move' });
    return { ok: true };
  });

  // ─── Журнал операций ────────────────────────────────────────
  app.get<{ Querystring: { limit?: string; type?: string } }>(
    '/api/ops',
    { preHandler: requireAuth },
    async req => {
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      let q = db.select().from(ops).orderBy(sql`${ops.id} DESC`).$dynamic();
      if (req.query.type) q = q.where(eq(ops.type, req.query.type));
      return q.limit(limit).all();
    }
  );
}
