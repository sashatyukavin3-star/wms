import { eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { cells, stock } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

const cellSchema = z.object({
  addr: z.string().min(1),
  zone: z.string().optional(),
  row: z.string().optional(),
  level: z.string().optional(),
  type: z.enum(['pallet', 'box', 'shelf', 'oversize']),
  status: z.enum(['free', 'occupied', 'blocked', 'quarantine']).default('free'),
  max_pallets: z.number().int().optional(),
  max_weight: z.number().int().optional(),
  max_units: z.number().int().optional(),
  allow_mixed_sku: z.boolean().default(true),
  pick_priority: z.number().int().optional(),
  putaway_priority: z.number().int().optional(),
  is_picking_face: z.boolean().default(false),
});

export async function cellsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { since?: string } }>('/api/cells', { preHandler: requireAuth }, async req => {
    const since = req.query.since ? Number(req.query.since) : 0;
    if (since > 0) return db.select().from(cells).where(gt(cells.updated_at, since)).all();
    return db.select().from(cells).where(eq(cells.deleted, false)).all();
  });

  app.put('/api/cells', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = cellSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const now = Date.now();
    const existing = db.select().from(cells).where(eq(cells.addr, parsed.data.addr)).get();
    if (existing) {
      db.update(cells).set({ ...parsed.data, updated_at: now, deleted: false }).where(eq(cells.addr, parsed.data.addr)).run();
    } else {
      db.insert(cells).values({ ...parsed.data, updated_at: now }).run();
    }
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: existing ? 'cell.update' : 'cell.create', entity: 'cell', entity_id: parsed.data.addr,
      details: {
        pick_priority: parsed.data.pick_priority,
        putaway_priority: parsed.data.putaway_priority,
        is_picking_face: parsed.data.is_picking_face,
      },
    });
    broadcast({ type: 'cell:changed', addr: parsed.data.addr });
    return { ok: true };
  });

  app.post('/api/cells/bulk', { preHandler: requireRole('operator') }, async (req, reply) => {
    const arr = z.array(cellSchema).safeParse(req.body);
    if (!arr.success) return reply.code(400).send({ error: 'Ожидается массив ячеек' });
    const now = Date.now();
    let added = 0, updated = 0;
    db.transaction(() => {
      for (const c of arr.data) {
        const existing = db.select({ a: cells.addr }).from(cells).where(eq(cells.addr, c.addr)).get();
        if (existing) {
          db.update(cells).set({ ...c, updated_at: now, deleted: false }).where(eq(cells.addr, c.addr)).run();
          updated++;
        } else {
          db.insert(cells).values({ ...c, updated_at: now }).run();
          added++;
        }
      }
    });
    broadcast({ type: 'cell:changed' });
    return { added, updated };
  });

  app.delete<{ Params: { addr: string } }>('/api/cells/:addr', { preHandler: requireRole('supervisor') }, async (req, reply) => {
    const inStock = db.select({ c: stock.barcode }).from(stock).where(eq(stock.cell, req.params.addr)).all();
    if (inStock.length > 0) return reply.code(400).send({ error: 'Нельзя удалить ячейку с остатками' });
    db.update(cells).set({ deleted: true, updated_at: Date.now() }).where(eq(cells.addr, req.params.addr)).run();
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'cell.delete', entity: 'cell', entity_id: req.params.addr,
    });
    broadcast({ type: 'cell:changed', addr: req.params.addr });
    return { ok: true };
  });
}
