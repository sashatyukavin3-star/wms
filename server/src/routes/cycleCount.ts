import { and, desc, eq, gte, like, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { cells, cycleCountLines, cycleCounts, invLines, ops, products, settings, stock } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

type Candidate = {
  barcode: string;
  cell: string;
  name: string;
  qty_system: number;
  priority: number;
  reasons: string[];
  zone?: string;
};

function expiryWarnDays(): number {
  const row = db.select().from(settings).where(eq(settings.key, 'expiry_warn_days')).get();
  return row ? parseInt(row.value) || 30 : 30;
}

function buildCandidates(query?: string): Candidate[] {
  const allStock = db.select().from(stock).all();
  const allCells = db.select().from(cells).all().filter(c => !c.deleted);
  const allProducts = db.select().from(products).all().filter(p => !p.deleted);
  const cellMap = new Map(allCells.map(c => [c.addr, c]));
  const productMap = new Map(allProducts.map(p => [p.barcode, p]));
  const edgeDate = new Date(Date.now() + expiryWarnDays() * 86400000).toISOString().slice(0, 10);
  const discrepancyRows = db.select().from(invLines).where(ne(invLines.delta, 0)).all();
  const discrepancyMap = new Map<string, number>();
  for (const row of discrepancyRows) {
    const key = `${row.barcode}@@${row.cell}`;
    discrepancyMap.set(key, (discrepancyMap.get(key) || 0) + 1);
  }

  const moveWindow = Date.now() - 14 * 86400000;
  const moveOps = db.select().from(ops).where(gte(ops.ts, moveWindow)).all();
  const activityByBarcode = new Map<string, number>();
  for (const op of moveOps) {
    if (!op.barcode) continue;
    activityByBarcode.set(op.barcode, (activityByBarcode.get(op.barcode) || 0) + Math.abs(op.qty || 0));
  }

  const items: Candidate[] = [];
  for (const row of allStock) {
    const cell = cellMap.get(row.cell);
    const product = productMap.get(row.barcode);
    if (!cell || !product) continue;

    let priority = 0;
    const reasons: string[] = [];
    if (cell.status === 'quarantine') { priority += 100; reasons.push('quarantine cell'); }
    if (cell.is_picking_face) { priority += 60; reasons.push('picking-face control'); }
    if (row.expiry_date && row.expiry_date <= edgeDate) { priority += 40; reasons.push('expiry control'); }
    const discrepancyHits = discrepancyMap.get(`${row.barcode}@@${row.cell}`) || 0;
    if (discrepancyHits > 0) { priority += 70 + discrepancyHits * 5; reasons.push('previous discrepancy'); }
    const activity = activityByBarcode.get(row.barcode) || 0;
    if (activity >= 20) { priority += 20; reasons.push('high movement SKU'); }

    if (priority <= 0) continue;
    items.push({
      barcode: row.barcode,
      cell: row.cell,
      name: product.name,
      qty_system: row.qty,
      priority,
      reasons,
      zone: cell.zone || undefined,
    });
  }

  let result = items.sort((a, b) => b.priority - a.priority || a.cell.localeCompare(b.cell, 'ru'));
  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    result = result.filter(item =>
      item.barcode.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.cell.toLowerCase().includes(q) ||
      (item.zone || '').toLowerCase().includes(q)
    );
  }
  return result;
}

export async function cycleCountRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>('/api/cycle-counts/suggestions', { preHandler: requireAuth }, async req => {
    return buildCandidates(req.query.q);
  });

  app.get('/api/cycle-counts', { preHandler: requireAuth }, async () => {
    return db.select().from(cycleCounts).orderBy(desc(cycleCounts.id)).all();
  });

  app.get<{ Params: { id: string } }>('/api/cycle-counts/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(cycleCounts).where(eq(cycleCounts.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Cycle count не найден' });
    const lines = db.select().from(cycleCountLines).where(eq(cycleCountLines.cycle_count_id, id)).all();
    return { ...doc, lines };
  });

  app.post('/api/cycle-counts', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = z.object({
      task_number: z.string().min(1),
      name: z.string().min(1),
      zone_filter: z.string().optional(),
      note: z.string().optional(),
      lines: z.array(z.object({
        barcode: z.string().min(1),
        cell: z.string().min(1),
        priority: z.number().int(),
        reason: z.string().min(1),
      })).min(1),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });

    const exists = db.select().from(cycleCounts).where(eq(cycleCounts.task_number, parsed.data.task_number.trim())).get();
    if (exists) return reply.code(409).send({ error: 'Cycle count с таким номером уже существует' });

    const now = Date.now();
    const inserted = db.transaction(() => {
      const doc = db.insert(cycleCounts).values({
        task_number: parsed.data.task_number.trim(),
        name: parsed.data.name.trim(),
        status: 'active',
        zone_filter: parsed.data.zone_filter?.trim() || null,
        created_by: req.user!.username,
        started_at: now,
        note: parsed.data.note?.trim() || null,
      }).returning({ id: cycleCounts.id }).get();

      for (const line of parsed.data.lines) {
        const systemRow = db.select().from(stock).all().find(s => s.barcode === line.barcode && s.cell === line.cell);
        db.insert(cycleCountLines).values({
          cycle_count_id: doc!.id,
          barcode: line.barcode,
          cell: line.cell,
          qty_system: systemRow?.qty || 0,
          qty_counted: 0,
          delta: 0,
          priority: line.priority,
          reason: line.reason,
          status: 'pending',
        }).run();
      }
      return doc!;
    });

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'cycle_count.create', entity: 'cycle_count', entity_id: inserted.id,
      details: { line_count: parsed.data.lines.length },
    });
    broadcast({ type: 'cycle_count:changed', id: inserted.id });
    return { id: inserted.id };
  });

  app.patch<{ Params: { lineId: string } }>('/api/cycle-count-lines/:lineId/count', { preHandler: requireRole('operator') }, async (req, reply) => {
    const lineId = Number(req.params.lineId);
    const line = db.select().from(cycleCountLines).where(eq(cycleCountLines.id, lineId)).get();
    if (!line) return reply.code(404).send({ error: 'Строка cycle count не найдена' });
    const parsed = z.object({ qty_counted: z.number().int().min(0), note: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const delta = parsed.data.qty_counted - line.qty_system;
    db.update(cycleCountLines).set({
      qty_counted: parsed.data.qty_counted,
      delta,
      status: 'counted',
      note: parsed.data.note?.trim() || line.note,
      updated_at: Date.now(),
    }).where(eq(cycleCountLines.id, lineId)).run();

    broadcast({ type: 'cycle_count:changed', id: line.cycle_count_id });
    return { ok: true, delta };
  });

  app.post<{ Params: { id: string } }>('/api/cycle-counts/:id/apply', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(cycleCounts).where(eq(cycleCounts.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Cycle count не найден' });
    if (doc.status === 'completed' || doc.status === 'cancelled') return reply.code(409).send({ error: 'Cycle count уже закрыт' });

    const lines = db.select().from(cycleCountLines).where(eq(cycleCountLines.cycle_count_id, id)).all();
    let applied = 0;
    let failed = 0;

    for (const line of lines) {
      if (line.status !== 'counted') continue;
      if (line.delta === 0) {
        db.update(cycleCountLines).set({ status: 'adjusted', updated_at: Date.now() }).where(eq(cycleCountLines.id, line.id)).run();
        applied++;
        continue;
      }
      try {
        db.transaction(() => {
          const row = db.select().from(stock).all().find(s => s.barcode === line.barcode && s.cell === line.cell);
          if (line.delta > 0) {
            if (row) {
              db.update(stock).set({ qty: row.qty + line.delta, updated_at: Date.now() }).where(sql`${stock.barcode} = ${line.barcode} AND ${stock.cell} = ${line.cell}`).run();
            } else {
              db.insert(stock).values({ barcode: line.barcode, cell: line.cell, qty: line.delta, updated_at: Date.now() }).run();
            }
          } else {
            if (!row || row.qty < Math.abs(line.delta)) throw new Error('Недостаточно остатка для списания');
            if (row.qty === Math.abs(line.delta)) {
              db.delete(stock).where(sql`${stock.barcode} = ${line.barcode} AND ${stock.cell} = ${line.cell}`).run();
            } else {
              db.update(stock).set({ qty: row.qty - Math.abs(line.delta), updated_at: Date.now() }).where(sql`${stock.barcode} = ${line.barcode} AND ${stock.cell} = ${line.cell}`).run();
            }
          }
          db.insert(ops).values({
            type: 'cycle_adjust',
            barcode: line.barcode,
            cell: line.cell,
            qty: Math.abs(line.delta),
            operator: req.user!.username,
            note: `CycleCount ${doc.task_number}: system=${line.qty_system}, counted=${line.qty_counted}, delta=${line.delta}`,
          }).run();
          db.update(cycleCountLines).set({ status: 'adjusted', updated_at: Date.now() }).where(eq(cycleCountLines.id, line.id)).run();
        });
        applied++;
      } catch {
        failed++;
      }
    }

    const refreshed = db.select().from(cycleCountLines).where(eq(cycleCountLines.cycle_count_id, id)).all();
    const allDone = refreshed.every(line => line.status === 'adjusted' || line.status === 'skipped');
    if (allDone) {
      db.update(cycleCounts).set({ status: 'completed', completed_at: Date.now(), updated_at: Date.now() }).where(eq(cycleCounts.id, id)).run();
    } else {
      db.update(cycleCounts).set({ updated_at: Date.now() }).where(eq(cycleCounts.id, id)).run();
    }

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'cycle_count.apply', entity: 'cycle_count', entity_id: id,
      details: { applied, failed },
    });
    broadcast({ type: 'cycle_count:changed', id });
    broadcast({ type: 'stock:changed' });
    broadcast({ type: 'op:created', op_type: 'cycle_adjust' });
    return { applied, failed };
  });

  app.patch<{ Params: { id: string } }>('/api/cycle-counts/:id/close', { preHandler: requireRole('supervisor') }, async (req, reply) => {
    const id = Number(req.params.id);
    const doc = db.select().from(cycleCounts).where(eq(cycleCounts.id, id)).get();
    if (!doc) return reply.code(404).send({ error: 'Cycle count не найден' });
    db.update(cycleCounts).set({ status: 'completed', completed_at: Date.now(), updated_at: Date.now() }).where(eq(cycleCounts.id, id)).run();
    broadcast({ type: 'cycle_count:changed', id });
    return { ok: true };
  });
}
