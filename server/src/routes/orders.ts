import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { cells, orderLines, orders, products, reservations, stock } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

export async function ordersRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { since?: string; status?: string } }>('/api/orders', { preHandler: requireAuth }, async req => {
    const since = req.query.since ? Number(req.query.since) : 0;
    let q = db.select().from(orders).$dynamic();
    if (since > 0) q = q.where(gt(orders.updated_at, since));
    else if (req.query.status) q = q.where(eq(orders.status, req.query.status as any));
    return q.orderBy(sql`${orders.id} DESC`).all();
  });

  app.get<{ Params: { id: string } }>('/api/orders/:id', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const o = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!o) return reply.code(404).send({ error: 'Не найдено' });
    const lines = db.select().from(orderLines).where(eq(orderLines.order_id, id)).all();
    return { ...o, lines };
  });

  app.get<{ Params: { id: string } }>('/api/orders/:id/lines', { preHandler: requireAuth }, async req => {
    return db.select().from(orderLines).where(eq(orderLines.order_id, Number(req.params.id))).all();
  });

  app.post('/api/orders', { preHandler: requireRole('operator') }, async (req, reply) => {
    const schema = z.object({
      ext_id: z.string().optional(),
      customer: z.string().optional(),
      operator: z.string().optional(),
      note: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const inserted = db.insert(orders).values({
      ...parsed.data,
      status: 'new',
    }).returning({ id: orders.id }).get();

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'order.create', entity: 'order', entity_id: inserted!.id,
    });
    broadcast({ type: 'order:changed', id: inserted!.id });
    return { id: inserted!.id };
  });

  app.patch<{ Params: { id: string } }>('/api/orders/:id', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const schema = z.object({
      ext_id: z.string().optional(),
      customer: z.string().optional(),
      operator: z.string().optional(),
      note: z.string().optional(),
      package_count: z.number().int().positive().optional(),
      status: z.enum(['new', 'picking', 'picked', 'packed', 'shipped', 'cancelled']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const patch: Record<string, unknown> = { ...parsed.data, updated_at: Date.now() };
    if (parsed.data.status === 'packed') {
      patch.packed_at = Date.now();
      patch.packed_by = req.user!.username;
    }
    if (parsed.data.status === 'shipped' || parsed.data.status === 'cancelled') patch.closed_at = Date.now();
    db.update(orders).set(patch).where(eq(orders.id, id)).run();
    broadcast({ type: 'order:changed', id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/orders/:id/pack', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const order = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });
    if (order.status === 'shipped' || order.status === 'cancelled') return reply.code(409).send({ error: 'Нельзя упаковать закрытый заказ' });

    const parsed = z.object({
      package_count: z.number().int().positive().optional(),
      packed_by: z.string().optional(),
      note: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const lines = db.select().from(orderLines).where(eq(orderLines.order_id, id)).all();
    const allDone = lines.length > 0 && lines.every(line => line.qty_fact >= line.qty_plan);
    if (!allDone) {
      return reply.code(409).send({ error: 'Нельзя упаковать заказ, пока не все позиции собраны' });
    }

    const patch: Record<string, unknown> = {
      status: 'packed',
      packed_at: Date.now(),
      packed_by: parsed.data.packed_by?.trim() || req.user!.username,
      updated_at: Date.now(),
    };
    if (parsed.data.package_count !== undefined) patch.package_count = parsed.data.package_count;
    if (parsed.data.note) patch.note = parsed.data.note.trim();

    db.update(orders).set(patch).where(eq(orders.id, id)).run();
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'order.pack', entity: 'order', entity_id: id,
      details: { package_count: parsed.data.package_count, packed_by: patch.packed_by },
    });
    broadcast({ type: 'order:changed', id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/orders/:id', { preHandler: requireRole('supervisor') }, async (req, reply) => {
    const id = Number(req.params.id);
    const existing = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!existing) return reply.code(404).send({ error: 'Заказ не найден' });
    if (existing.status === 'shipped' || existing.status === 'picked' || existing.status === 'packed') {
      return reply.code(409).send({
        error: 'Нельзя удалить заказ со статусом "' + existing.status + '". Используйте отмену.',
      });
    }
    db.delete(orders).where(eq(orders.id, id)).run();
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'order.delete', entity: 'order', entity_id: id,
    });
    broadcast({ type: 'order:changed', id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/orders/:id/lines', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const schema = z.object({
      barcode: z.string().min(1),
      qty_plan: z.number().int().positive(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    db.insert(orderLines).values({
      order_id: id, barcode: parsed.data.barcode, qty_plan: parsed.data.qty_plan,
      qty_fact: 0, status: 'pending',
    }).run();
    db.update(orders).set({ updated_at: Date.now() }).where(eq(orders.id, id)).run();
    broadcast({ type: 'order_line:changed', order_id: id });
    return { ok: true };
  });

  app.delete<{ Params: { lineId: string } }>('/api/orders/lines/:lineId', { preHandler: requireRole('operator') }, async (req, reply) => {
    const lineId = Number(req.params.lineId);
    const line = db.select().from(orderLines).where(eq(orderLines.id, lineId)).get();
    if (!line) return reply.code(404).send({ error: 'Не найдено' });
    db.delete(orderLines).where(eq(orderLines.id, lineId)).run();
    db.update(orders).set({ updated_at: Date.now() }).where(eq(orders.id, line.order_id)).run();
    broadcast({ type: 'order_line:changed', order_id: line.order_id, id: lineId });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/orders/:id/reserve', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const order = db.select().from(orders).where(eq(orders.id, id)).get();
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });

    db.transaction(() => {
      const lines = db.select().from(orderLines).where(eq(orderLines.order_id, id)).all();
      db.delete(reservations).where(eq(reservations.order_id, id)).run();

      for (const line of lines) {
        const needed = line.qty_plan - line.qty_fact;
        if (needed <= 0) continue;

        const stocks = db.select().from(stock).where(eq(stock.barcode, line.barcode)).all()
          .sort((a, b) => a.updated_at - b.updated_at);

        const otherRes = db.select().from(reservations)
          .where(and(eq(reservations.barcode, line.barcode))).all();
        const reservedByCell = new Map<string, number>();
        for (const r of otherRes) reservedByCell.set(r.cell, (reservedByCell.get(r.cell) || 0) + r.qty);

        let remain = needed;
        for (const st of stocks) {
          if (remain <= 0) break;
          const available = Math.max(0, st.qty - (reservedByCell.get(st.cell) || 0));
          if (available <= 0) continue;
          const take = Math.min(available, remain);
          db.insert(reservations).values({
            order_id: id, order_line_id: line.id, barcode: line.barcode, cell: st.cell,
            qty: take, operator: req.user!.username,
          }).run();
          remain -= take;
        }
      }
    });

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'order.reserve', entity: 'order', entity_id: id,
    });
    broadcast({ type: 'reservation:changed', order_id: id });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/orders/:id/picklist', { preHandler: requireAuth }, async (req, reply) => {
    const id = Number(req.params.id);
    const lines = db.select().from(orderLines).where(eq(orderLines.order_id, id)).all();
    if (lines.length === 0) return reply.send([]);

    const res = db.select().from(reservations).where(eq(reservations.order_id, id)).all();
    const allCells = db.select().from(cells).all();
    const cellMap = new Map(allCells.map(c => [c.addr, c]));
    const allProducts = db.select().from(products).all();
    const productMap = new Map(allProducts.map(p => [p.barcode, p]));

    const steps: Array<{
      order_line_id: number; barcode: string; name: string; cell: string;
      qty_to_pick: number; qty_done: number;
      zone?: string; row?: string; level?: string;
      pick_priority?: number; is_picking_face?: boolean;
    }> = [];

    for (const line of lines) {
      if (line.status === 'done') continue;
      const reservedForLine = res.filter(r => r.order_line_id === line.id);
      if (reservedForLine.length === 0) {
        steps.push({
          order_line_id: line.id, barcode: line.barcode,
          name: productMap.get(line.barcode)?.name || line.barcode, cell: '',
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
          order_line_id: line.id, barcode: line.barcode,
          name: productMap.get(line.barcode)?.name || line.barcode, cell: r.cell,
          qty_to_pick: toPick, qty_done: fromThis,
          zone: cell?.zone || undefined, row: cell?.row || undefined, level: cell?.level || undefined,
          pick_priority: cell?.pick_priority || undefined, is_picking_face: cell?.is_picking_face || undefined,
        });
      }
    }

    steps.sort((a, b) => {
      const faceDelta = Number(Boolean(b.is_picking_face)) - Number(Boolean(a.is_picking_face));
      if (faceDelta !== 0) return faceDelta;
      const priorityDelta = (b.pick_priority || 0) - (a.pick_priority || 0);
      if (priorityDelta !== 0) return priorityDelta;
      const az = (a.zone || '').localeCompare(b.zone || '', 'ru', { numeric: true });
      if (az !== 0) return az;
      const ar = (a.row || '').localeCompare(b.row || '', 'ru', { numeric: true });
      if (ar !== 0) return ar;
      const al = (a.level || '').localeCompare(b.level || '', 'ru', { numeric: true });
      if (al !== 0) return al;
      return a.cell.localeCompare(b.cell, 'ru', { numeric: true });
    });

    return steps;
  });

  app.get('/api/reservations', { preHandler: requireAuth }, async req => {
    const since = (req.query as any)?.since ? Number((req.query as any).since) : 0;
    if (since > 0) return db.select().from(reservations).where(gt(reservations.created_at, since)).all();
    return db.select().from(reservations).all();
  });
}
