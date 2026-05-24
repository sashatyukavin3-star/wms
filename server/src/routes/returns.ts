import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { cells, ops, orders, returnDocs, returnLines, stock } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

const returnSchema = z.object({
  return_number: z.string().min(1),
  order_id: z.number().int().positive().optional(),
  customer: z.string().optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

const returnLineSchema = z.object({
  barcode: z.string().min(1),
  qty_expected: z.number().int().positive(),
  disposition: z.enum(['restock', 'quarantine', 'scrap']).default('restock'),
  note: z.string().optional(),
  reason: z.string().optional(),
});

const processSchema = z.object({
  line_id: z.number().int().positive(),
  qty: z.number().int().positive(),
  disposition: z.enum(['restock', 'quarantine', 'scrap']),
  cell: z.string().optional(),
  operator: z.string().optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
});

function recomputeReturnStatus(id: number) {
  const doc = db.select().from(returnDocs).where(eq(returnDocs.id, id)).get();
  if (!doc) return;
  const lines = db.select().from(returnLines).where(eq(returnLines.return_id, id)).all();
  let status: 'draft' | 'received' | 'completed' | 'cancelled' = doc.status;
  if (doc.status !== 'cancelled') {
    const allProcessed = lines.length > 0 && lines.every(line => line.qty_received >= line.qty_expected);
    const anyProcessed = lines.some(line => line.qty_received > 0);
    if (allProcessed) status = 'completed';
    else if (anyProcessed) status = 'received';
    else status = 'draft';
  }
  const patch: Record<string, unknown> = { status, updated_at: Date.now() };
  if (status === 'received' && !doc.received_at) patch.received_at = Date.now();
  if (status === 'completed') patch.processed_at = Date.now();
  db.update(returnDocs).set(patch).where(eq(returnDocs.id, id)).run();
}

export async function returnsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string; since?: string } }>('/api/returns', { preHandler: requireAuth }, async req => {
    const since = req.query.since ? Number(req.query.since) : 0;
    let q = db.select().from(returnDocs).orderBy(desc(returnDocs.id)).$dynamic();
    if (since > 0) q = q.where(sql`${returnDocs.updated_at} > ${since}`);
    else if (req.query.status) q = q.where(eq(returnDocs.status, req.query.status as any));
    return q.all();
  });

  app.get<{ Params: { id: string } }>('/api/returns/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(returnDocs).where(eq(returnDocs.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Возврат не найден' });
    const lines = db.select().from(returnLines).where(eq(returnLines.return_id, id)).all();
    return { ...doc, lines };
  });

  app.post('/api/returns', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = returnSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });
    const exists = db.select().from(returnDocs).where(eq(returnDocs.return_number, parsed.data.return_number.trim())).get();
    if (exists) return reply.code(409).send({ error: 'Возврат с таким номером уже существует' });
    if (parsed.data.order_id) {
      const order = db.select().from(orders).where(eq(orders.id, parsed.data.order_id)).get();
      if (!order) return reply.code(404).send({ error: 'Связанный заказ не найден' });
    }

    const inserted = db.insert(returnDocs).values({
      return_number: parsed.data.return_number.trim(),
      order_id: parsed.data.order_id,
      customer: parsed.data.customer?.trim() || null,
      reason: parsed.data.reason?.trim() || null,
      note: parsed.data.note?.trim() || null,
      status: 'draft',
    }).returning({ id: returnDocs.id }).get();

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'return.create', entity: 'return', entity_id: inserted!.id,
      details: { return_number: parsed.data.return_number },
    });
    broadcast({ type: 'return:changed', id: inserted!.id });
    return { id: inserted!.id };
  });

  app.patch<{ Params: { id: string } }>('/api/returns/:id', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(returnDocs).where(eq(returnDocs.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Возврат не найден' });
    const parsed = z.object({
      customer: z.string().optional(),
      reason: z.string().optional(),
      note: z.string().optional(),
      status: z.enum(['draft', 'received', 'completed', 'cancelled']).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (parsed.data.customer !== undefined) patch.customer = parsed.data.customer?.trim() || null;
    if (parsed.data.reason !== undefined) patch.reason = parsed.data.reason?.trim() || null;
    if (parsed.data.note !== undefined) patch.note = parsed.data.note?.trim() || null;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    db.update(returnDocs).set(patch).where(eq(returnDocs.id, id)).run();
    recomputeReturnStatus(id);
    broadcast({ type: 'return:changed', id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/returns/:id', { preHandler: requireRole('supervisor') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(returnDocs).where(eq(returnDocs.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Возврат не найден' });
    if (doc.status === 'completed') return reply.code(409).send({ error: 'Нельзя удалить завершённый возврат' });
    db.delete(returnDocs).where(eq(returnDocs.id, id)).run();
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'return.delete', entity: 'return', entity_id: id,
    });
    broadcast({ type: 'return:changed', id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/returns/:id/lines', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(returnDocs).where(eq(returnDocs.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Возврат не найден' });
    if (doc.status === 'completed' || doc.status === 'cancelled') return reply.code(409).send({ error: 'Нельзя менять закрытый возврат' });
    const parsed = returnLineSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });

    const inserted = db.insert(returnLines).values({
      return_id: id,
      barcode: parsed.data.barcode.trim(),
      qty_expected: parsed.data.qty_expected,
      disposition: parsed.data.disposition,
      note: parsed.data.note?.trim() || null,
      reason: parsed.data.reason?.trim() || null,
      status: 'pending',
    }).returning({ id: returnLines.id }).get();
    db.update(returnDocs).set({ updated_at: Date.now() }).where(eq(returnDocs.id, id)).run();
    broadcast({ type: 'return:changed', id });
    return { id: inserted!.id };
  });

  app.delete<{ Params: { lineId: string } }>('/api/returns/lines/:lineId', { preHandler: requireRole('operator') }, async (req, reply) => {
    const lineId = Number(req.params.lineId);
    const line = db.select().from(returnLines).where(eq(returnLines.id, lineId)).get();
    if (!line) return reply.code(404).send({ error: 'Строка возврата не найдена' });
    if (line.qty_received > 0) return reply.code(409).send({ error: 'Нельзя удалить строку, по которой уже проводили возврат' });
    db.delete(returnLines).where(eq(returnLines.id, lineId)).run();
    db.update(returnDocs).set({ updated_at: Date.now() }).where(eq(returnDocs.id, line.return_id)).run();
    recomputeReturnStatus(line.return_id);
    broadcast({ type: 'return:changed', id: line.return_id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/returns/:id/process', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(returnDocs).where(eq(returnDocs.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Возврат не найден' });
    if (doc.status === 'completed' || doc.status === 'cancelled') return reply.code(409).send({ error: 'Нельзя проводить закрытый возврат' });

    const parsed = processSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });
    const data = parsed.data;

    const line = db.select().from(returnLines).where(eq(returnLines.id, data.line_id)).get();
    if (!line || line.return_id !== id) return reply.code(404).send({ error: 'Строка возврата не найдена' });
    const remaining = line.qty_expected - line.qty_received;
    if (remaining <= 0) return reply.code(409).send({ error: 'Строка возврата уже полностью обработана' });
    if (data.qty > remaining) return reply.code(400).send({ error: `Нельзя обработать больше остатка по строке (${remaining})` });

    let targetCell = null as null | { addr: string; status: string };
    if (data.disposition !== 'scrap') {
      if (!data.cell?.trim()) return reply.code(400).send({ error: 'Для restock/quarantine нужна ячейка' });
      targetCell = db.select().from(cells).where(eq(cells.addr, data.cell.trim())).get() as any;
      if (!targetCell) return reply.code(404).send({ error: 'Целевая ячейка не найдена' });
      if (data.disposition === 'quarantine' && targetCell.status !== 'quarantine') {
        return reply.code(400).send({ error: 'Для quarantine нужна ячейка со статусом quarantine' });
      }
      if (data.disposition === 'restock' && (targetCell.status === 'blocked' || targetCell.status === 'quarantine')) {
        return reply.code(400).send({ error: 'Для restock нужна доступная некарантинная ячейка' });
      }
    }

    db.transaction(() => {
      if (data.disposition !== 'scrap' && targetCell) {
        const currentRow = db.select().from(stock).all().find(row => row.barcode === line.barcode && row.cell === targetCell!.addr);
        if (currentRow) {
          db.update(stock).set({ qty: currentRow.qty + data.qty, updated_at: Date.now() })
            .where(sql`${stock.barcode} = ${line.barcode} AND ${stock.cell} = ${targetCell.addr}`).run();
        } else {
          db.insert(stock).values({ barcode: line.barcode, cell: targetCell.addr, qty: data.qty, updated_at: Date.now() }).run();
        }
      }

      const nextQtyReceived = line.qty_received + data.qty;
      const patch: Record<string, unknown> = {
        qty_received: nextQtyReceived,
      };
      if (data.disposition === 'restock') patch.qty_restocked = line.qty_restocked + data.qty;
      if (data.disposition === 'quarantine') patch.qty_quarantined = line.qty_quarantined + data.qty;
      if (data.disposition === 'scrap') patch.qty_scrapped = line.qty_scrapped + data.qty;
      const status = nextQtyReceived >= line.qty_expected
        ? ((line.qty_quarantined + line.qty_scrapped + (data.disposition === 'quarantine' || data.disposition === 'scrap' ? data.qty : 0)) > 0 ? 'issue' : 'processed')
        : 'partial';
      patch.status = status;
      patch.disposition = data.disposition;
      if (data.reason?.trim()) patch.reason = data.reason.trim();
      if (data.note?.trim()) patch.note = data.note.trim();
      db.update(returnLines).set(patch).where(eq(returnLines.id, line.id)).run();
      db.update(returnDocs).set({ updated_at: Date.now(), received_at: doc.received_at ?? Date.now() }).where(eq(returnDocs.id, id)).run();

      db.insert(ops).values({
        type: 'return',
        barcode: line.barcode,
        cell: targetCell?.addr,
        qty: data.qty,
        operator: data.operator || req.user!.username,
        note: data.note || `Return ${doc.return_number} / ${data.disposition}`,
      }).run();
    });

    recomputeReturnStatus(id);
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'return.process', entity: 'return', entity_id: id,
      details: { line_id: line.id, barcode: line.barcode, qty: data.qty, disposition: data.disposition, cell: data.cell, reason: data.reason },
    });
    if (targetCell) broadcast({ type: 'stock:changed', barcode: line.barcode, cell: targetCell.addr });
    broadcast({ type: 'op:created', op_type: 'return' });
    broadcast({ type: 'return:changed', id });
    return { ok: true };
  });
}
