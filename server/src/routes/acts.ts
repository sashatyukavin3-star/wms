import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { inspectionActs, reworkActs, settings } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { broadcast } from '../ws/hub.ts';

// Хранение актов как JSON в payload — гибко, если будут меняться поля.
const PAYLOAD = z.record(z.unknown());

async function nextActNumber(prefix: string): Promise<string> {
  const key = `act_${prefix.toLowerCase()}_counter`;
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  const current = row ? parseInt(row.value) || 0 : 0;
  const next = current + 1;
  db.insert(settings).values({ key, value: String(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(next) } }).run();
  const year = new Date().getFullYear();
  return `${prefix}-${String(next).padStart(3, '0')}/${year}`;
}

export async function actsRoutes(app: FastifyInstance) {
  // ─── Inspection acts ───
  app.get('/api/acts/inspection', { preHandler: requireAuth }, async () => {
    return db.select().from(inspectionActs).orderBy(sql`${inspectionActs.id} DESC`).all();
  });

  app.post('/api/acts/inspection', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = z.object({
      date: z.string(),
      payload: PAYLOAD,
      act_number: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const act_number = parsed.data.act_number || (await nextActNumber('ОСМ'));
    const inserted = db.insert(inspectionActs).values({
      act_number, date: parsed.data.date, payload: parsed.data.payload, status: 'saved',
    }).returning({ id: inspectionActs.id }).get();
    broadcast({ type: 'act:changed', kind: 'inspection', id: inserted!.id });
    return { id: inserted!.id, act_number };
  });

  app.patch<{ Params: { id: string } }>('/api/acts/inspection/:id', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const parsed = z.object({ date: z.string().optional(), payload: PAYLOAD.optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (parsed.data.date) patch.date = parsed.data.date;
    if (parsed.data.payload) patch.payload = parsed.data.payload;
    db.update(inspectionActs).set(patch).where(eq(inspectionActs.id, id)).run();
    broadcast({ type: 'act:changed', kind: 'inspection', id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/acts/inspection/:id', { preHandler: requireRole('supervisor') }, async (req) => {
    db.delete(inspectionActs).where(eq(inspectionActs.id, Number(req.params.id))).run();
    broadcast({ type: 'act:changed', kind: 'inspection' });
    return { ok: true };
  });

  // ─── Rework acts ───
  app.get('/api/acts/rework', { preHandler: requireAuth }, async () => {
    return db.select().from(reworkActs).orderBy(sql`${reworkActs.id} DESC`).all();
  });

  app.post('/api/acts/rework', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = z.object({
      date: z.string(),
      payload: PAYLOAD,
      act_number: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const act_number = parsed.data.act_number || (await nextActNumber('ПРБ'));
    const inserted = db.insert(reworkActs).values({
      act_number, date: parsed.data.date, payload: parsed.data.payload, status: 'saved',
    }).returning({ id: reworkActs.id }).get();
    broadcast({ type: 'act:changed', kind: 'rework', id: inserted!.id });
    return { id: inserted!.id, act_number };
  });

  app.patch<{ Params: { id: string } }>('/api/acts/rework/:id', { preHandler: requireRole('operator') }, async (req, reply) => {
    const id = Number(req.params.id);
    const parsed = z.object({ date: z.string().optional(), payload: PAYLOAD.optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (parsed.data.date) patch.date = parsed.data.date;
    if (parsed.data.payload) patch.payload = parsed.data.payload;
    db.update(reworkActs).set(patch).where(eq(reworkActs.id, id)).run();
    broadcast({ type: 'act:changed', kind: 'rework', id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/acts/rework/:id', { preHandler: requireRole('supervisor') }, async (req) => {
    db.delete(reworkActs).where(eq(reworkActs.id, Number(req.params.id))).run();
    broadcast({ type: 'act:changed', kind: 'rework' });
    return { ok: true };
  });
}
