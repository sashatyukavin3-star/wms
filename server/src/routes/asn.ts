import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { asnLines, asns, batches, ops, stock } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

const asnSchema = z.object({
  asn_number: z.string().min(1),
  supplier: z.string().optional(),
  eta_date: z.string().optional(),
  note: z.string().optional(),
});

const asnLineSchema = z.object({
  barcode: z.string().min(1),
  qty_expected: z.number().int().positive(),
  note: z.string().optional(),
});

const receiveSchema = z.object({
  line_id: z.number().int().positive(),
  cell: z.string().min(1),
  qty: z.number().int().min(0),
  damaged_qty: z.number().int().min(0).optional(),
  operator: z.string().optional(),
  lot_number: z.string().optional(),
  expiry_date: z.string().optional(),
  note: z.string().optional(),
  discrepancy_reason: z.string().optional(),
});

function recomputeLineState(line: { qty_expected: number; qty_received: number; qty_damaged: number }) {
  const totalProcessed = line.qty_received + line.qty_damaged;
  const status: 'pending' | 'partial' | 'received' | 'issue' =
    totalProcessed <= 0 ? 'pending'
      : totalProcessed >= line.qty_expected
        ? (line.qty_damaged > 0 ? 'issue' : 'received')
        : 'partial';

  const qc_status: 'pending' | 'accepted' | 'accepted_with_issue' | 'rejected' =
    totalProcessed <= 0 ? 'pending'
      : line.qty_received === 0 && line.qty_damaged > 0 ? 'rejected'
        : line.qty_damaged > 0 ? 'accepted_with_issue'
          : 'accepted';

  return { status, qc_status };
}

function recomputeAsnStatus(id: number) {
  const lines = db.select().from(asnLines).where(eq(asnLines.asn_id, id)).all();
  const doc = db.select().from(asns).where(eq(asns.id, id)).get();
  if (!doc) return;

  let status: 'draft' | 'arrived' | 'receiving' | 'completed' | 'cancelled' = doc.status;
  if (doc.status !== 'cancelled') {
    const allReceived = lines.length > 0 && lines.every(line => (line.qty_received + line.qty_damaged) >= line.qty_expected);
    const anyReceived = lines.some(line => (line.qty_received + line.qty_damaged) > 0);
    if (allReceived) status = 'completed';
    else if (anyReceived) status = 'receiving';
    else if (doc.arrived_at) status = 'arrived';
    else status = 'draft';
  }

  db.update(asns).set({ status, updated_at: Date.now() }).where(eq(asns.id, id)).run();
}

export async function asnRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string; since?: string } }>('/api/asn', { preHandler: requireAuth }, async req => {
    const since = req.query.since ? Number(req.query.since) : 0;
    let query = db.select().from(asns).orderBy(desc(asns.id)).$dynamic();
    if (since > 0) query = query.where(sql`${asns.updated_at} > ${since}`);
    else if (req.query.status) query = query.where(eq(asns.status, req.query.status as any));
    return query.all();
  });

  app.get<{ Params: { id: string } }>('/api/asn/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(asns).where(eq(asns.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'ASN не найден' });
    const lines = db.select().from(asnLines).where(eq(asnLines.asn_id, id)).all();
    return { ...doc, lines };
  });

  app.post('/api/asn', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = asnSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });

    const exists = db.select().from(asns).where(eq(asns.asn_number, parsed.data.asn_number.trim())).get();
    if (exists) return reply.code(409).send({ error: 'ASN с таким номером уже существует' });

    const inserted = db.insert(asns).values({
      asn_number: parsed.data.asn_number.trim(),
      supplier: parsed.data.supplier?.trim() || null,
      eta_date: parsed.data.eta_date || null,
      note: parsed.data.note?.trim() || null,
      status: 'draft',
    }).returning({ id: asns.id }).get();

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'asn.create', entity: 'asn', entity_id: inserted!.id,
      details: { asn_number: parsed.data.asn_number },
    });
    broadcast({ type: 'asn:changed', id: inserted!.id });
    return { id: inserted!.id };
  });

  app.patch<{ Params: { id: string } }>('/api/asn/:id', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const existing = db.select().from(asns).where(eq(asns.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'ASN не найден' });

    const parsed = z.object({
      asn_number: z.string().min(1).optional(),
      supplier: z.string().optional(),
      eta_date: z.string().optional(),
      note: z.string().optional(),
      status: z.enum(['draft', 'arrived', 'receiving', 'completed', 'cancelled']).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (parsed.data.asn_number !== undefined) patch.asn_number = parsed.data.asn_number.trim();
    if (parsed.data.supplier !== undefined) patch.supplier = parsed.data.supplier?.trim() || null;
    if (parsed.data.eta_date !== undefined) patch.eta_date = parsed.data.eta_date || null;
    if (parsed.data.note !== undefined) patch.note = parsed.data.note?.trim() || null;
    if (parsed.data.status !== undefined) {
      patch.status = parsed.data.status;
      if (parsed.data.status === 'arrived' && !existing.arrived_at) patch.arrived_at = Date.now();
    }

    db.update(asns).set(patch).where(eq(asns.id, id)).run();
    recomputeAsnStatus(id);

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'asn.update', entity: 'asn', entity_id: id,
      details: { fields: Object.keys(parsed.data) },
    });
    broadcast({ type: 'asn:changed', id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/asn/:id', { preHandler: requireRole('supervisor') }, async (req, reply) => {
    const id = Number(req.params.id);
    const existing = db.select().from(asns).where(eq(asns.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'ASN не найден' });
    if (existing.status === 'completed') return reply.code(409).send({ error: 'Нельзя удалить завершённый ASN' });

    db.delete(asns).where(eq(asns.id, id)).run();
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'asn.delete', entity: 'asn', entity_id: id,
    });
    broadcast({ type: 'asn:changed', id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/asn/:id/mark-arrived', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const existing = db.select().from(asns).where(eq(asns.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'ASN не найден' });
    if (existing.status === 'completed' || existing.status === 'cancelled') return reply.code(409).send({ error: 'ASN уже закрыт' });

    db.update(asns).set({ status: 'arrived', arrived_at: Date.now(), updated_at: Date.now() }).where(eq(asns.id, id)).run();
    recomputeAsnStatus(id);
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'asn.arrived', entity: 'asn', entity_id: id,
    });
    broadcast({ type: 'asn:changed', id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/asn/:id/lines', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(asns).where(eq(asns.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'ASN не найден' });
    if (doc.status === 'completed' || doc.status === 'cancelled') return reply.code(409).send({ error: 'Нельзя менять закрытый ASN' });

    const parsed = asnLineSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });

    const inserted = db.insert(asnLines).values({
      asn_id: id,
      barcode: parsed.data.barcode.trim(),
      qty_expected: parsed.data.qty_expected,
      note: parsed.data.note?.trim() || null,
      status: 'pending',
      qc_status: 'pending',
    }).returning({ id: asnLines.id }).get();

    db.update(asns).set({ updated_at: Date.now() }).where(eq(asns.id, id)).run();
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'asn_line.create', entity: 'asn_line', entity_id: inserted!.id,
      details: { asn_id: id, barcode: parsed.data.barcode, qty_expected: parsed.data.qty_expected },
    });
    broadcast({ type: 'asn:changed', id });
    return { id: inserted!.id };
  });

  app.patch<{ Params: { lineId: string } }>('/api/asn/lines/:lineId', { preHandler: requireRole('operator') }, async (req, reply) => {
    const lineId = Number(req.params.lineId);
    const existing = db.select().from(asnLines).where(eq(asnLines.id, lineId)).get();
    if (!existing) return reply.code(404).send({ error: 'Строка ASN не найдена' });

    const parsed = z.object({
      qty_expected: z.number().int().positive().optional(),
      note: z.string().optional(),
      discrepancy_reason: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const patch: Record<string, unknown> = {};
    if (parsed.data.qty_expected !== undefined) patch.qty_expected = parsed.data.qty_expected;
    if (parsed.data.note !== undefined) patch.note = parsed.data.note?.trim() || null;
    if (parsed.data.discrepancy_reason !== undefined) patch.discrepancy_reason = parsed.data.discrepancy_reason?.trim() || null;
    db.update(asnLines).set(patch).where(eq(asnLines.id, lineId)).run();
    recomputeAsnStatus(existing.asn_id);
    broadcast({ type: 'asn:changed', id: existing.asn_id });
    return { ok: true };
  });

  app.delete<{ Params: { lineId: string } }>('/api/asn/lines/:lineId', { preHandler: requireRole('operator') }, async (req, reply) => {
    const lineId = Number(req.params.lineId);
    const line = db.select().from(asnLines).where(eq(asnLines.id, lineId)).get();
    if (!line) return reply.code(404).send({ error: 'Строка ASN не найдена' });
    if (line.qty_received > 0 || line.qty_damaged > 0) return reply.code(409).send({ error: 'Нельзя удалить строку, по которой уже была приёмка' });

    db.delete(asnLines).where(eq(asnLines.id, lineId)).run();
    db.update(asns).set({ updated_at: Date.now() }).where(eq(asns.id, line.asn_id)).run();
    recomputeAsnStatus(line.asn_id);
    broadcast({ type: 'asn:changed', id: line.asn_id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/asn/:id/receive', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(asns).where(eq(asns.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'ASN не найден' });
    if (doc.status === 'completed' || doc.status === 'cancelled') return reply.code(409).send({ error: 'Нельзя проводить закрытый ASN' });

    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });
    const data = parsed.data;
    const damagedQty = data.damaged_qty ?? 0;

    const line = db.select().from(asnLines).where(eq(asnLines.id, data.line_id)).get();
    if (!line || line.asn_id !== id) return reply.code(404).send({ error: 'Строка ASN не найдена' });
    const remaining = line.qty_expected - line.qty_received - line.qty_damaged;
    const totalIncoming = data.qty + damagedQty;
    if (totalIncoming <= 0) return reply.code(400).send({ error: 'Нужно указать хотя бы good qty или damaged qty' });
    if (remaining <= 0) return reply.code(409).send({ error: 'Строка ASN уже полностью обработана' });
    if (totalIncoming > remaining) return reply.code(400).send({ error: `Нельзя обработать больше остатка по строке (${remaining})` });
    if (damagedQty > 0 && !data.discrepancy_reason?.trim()) return reply.code(400).send({ error: 'Для брака / расхождения укажи причину' });

    const now = Date.now();
    const result = db.transaction(() => {
      let batch_id: number | undefined;
      if (data.qty > 0 && (data.lot_number || data.expiry_date)) {
        const b = db.insert(batches).values({
          barcode: line.barcode,
          cell: data.cell,
          qty: data.qty,
          lot_number: data.lot_number,
          supplier: doc.supplier || undefined,
          received_at: now,
          expiry_date: data.expiry_date,
        }).returning({ id: batches.id }).get();
        batch_id = b!.id;
      }

      if (data.qty > 0) {
        const stockRow = db.select().from(stock).where(sql`${stock.barcode} = ${line.barcode} AND ${stock.cell} = ${data.cell}`).get();
        if (stockRow) {
          db.update(stock).set({
            qty: stockRow.qty + data.qty,
            batch_id: batch_id ?? stockRow.batch_id,
            expiry_date: data.expiry_date ?? stockRow.expiry_date,
            updated_at: now,
          }).where(sql`${stock.barcode} = ${line.barcode} AND ${stock.cell} = ${data.cell}`).run();
        } else {
          db.insert(stock).values({
            barcode: line.barcode,
            cell: data.cell,
            qty: data.qty,
            batch_id,
            expiry_date: data.expiry_date,
            updated_at: now,
          }).run();
        }

        db.insert(ops).values({
          type: 'receive',
          barcode: line.barcode,
          cell: data.cell,
          qty: data.qty,
          operator: data.operator || req.user!.username,
          batch_id,
          note: data.note || `ASN ${doc.asn_number}`,
        }).run();
      }

      const qty_received = line.qty_received + data.qty;
      const qty_damaged = line.qty_damaged + damagedQty;
      const lineState = recomputeLineState({ qty_expected: line.qty_expected, qty_received, qty_damaged });
      db.update(asnLines).set({
        qty_received,
        qty_damaged,
        status: lineState.status,
        qc_status: lineState.qc_status,
        discrepancy_reason: damagedQty > 0 ? data.discrepancy_reason?.trim() || line.discrepancy_reason : line.discrepancy_reason,
      }).where(eq(asnLines.id, line.id)).run();
      db.update(asns).set({ updated_at: now, arrived_at: doc.arrived_at ?? now }).where(eq(asns.id, id)).run();

      return { batch_id, qty_received, qty_damaged, status: lineState.status, qc_status: lineState.qc_status };
    });

    recomputeAsnStatus(id);
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'asn.receive', entity: 'asn', entity_id: id,
      details: { line_id: data.line_id, barcode: line.barcode, qty_good: data.qty, qty_damaged: damagedQty, cell: data.cell, discrepancy_reason: data.discrepancy_reason },
    });
    if (data.qty > 0) {
      broadcast({ type: 'stock:changed', barcode: line.barcode, cell: data.cell });
      broadcast({ type: 'op:created', op_type: 'receive' });
    }
    broadcast({ type: 'asn:changed', id });
    return result;
  });
}
