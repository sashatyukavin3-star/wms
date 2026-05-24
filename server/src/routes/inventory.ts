/**
 * Серверный API для инвентаризации.
 *
 * Раньше сессии и строки инвентаризации хранились ТОЛЬКО в локальной IndexedDB
 * каждого браузера. Из-за этого:
 *   • один оператор не видел сессии, начатые другим;
 *   • при сбое браузера данные сессии терялись;
 *   • история инвентаризаций была разной на разных ПК.
 *
 * Теперь сессии и строки живут в серверной SQLite, синхронизируются
 * через REST + WebSocket-эвент `inv:changed`.
 */

import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { invLines,invSessions } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

export async function inventoryRoutes(app: FastifyInstance) {
  // ─── Список сессий ─────────────────────────────────────────
  app.get('/api/inventory/sessions', { preHandler: requireAuth }, async () => {
    return db.select().from(invSessions).orderBy(sql`${invSessions.id} DESC`).all();
  });

  // ─── Конкретная сессия со строками ────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/inventory/sessions/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const id = Number(req.params.id);
      const session = db.select().from(invSessions).where(eq(invSessions.id, id)).get();
      if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
      const lines = db.select().from(invLines).where(eq(invLines.session_id, id)).all();
      return { ...session, lines };
    }
  );

  // ─── Строки сессии (отдельно — для подкачки только строк) ──
  app.get<{ Params: { id: string } }>(
    '/api/inventory/sessions/:id/lines',
    { preHandler: requireAuth },
    async req => {
      const id = Number(req.params.id);
      return db.select().from(invLines).where(eq(invLines.session_id, id)).all();
    }
  );

  // ─── Создание сессии ───────────────────────────────────────
  const createSchema = z.object({
    name: z.string().min(1),
    zone_filter: z.string().optional(),
    operator: z.string().optional(),
  });

  app.post('/api/inventory/sessions', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры' });

    const inserted = db.insert(invSessions).values({
      name: parsed.data.name.trim(),
      status: 'active',
      zone_filter: parsed.data.zone_filter || null,
      operator: parsed.data.operator || req.user!.username,
    }).returning({ id: invSessions.id }).get();

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'inv.create', entity: 'inv_session', entity_id: inserted!.id,
      details: { name: parsed.data.name },
    });

    broadcast({ type: 'inv:changed', session_id: inserted!.id });
    return { id: inserted!.id };
  });

  // ─── Добавление строки (запись скана) ──────────────────────
  const addLineSchema = z.object({
    barcode: z.string().min(1),
    cell: z.string().min(1),
    qty_system: z.number().int().min(0),
    qty_fact: z.number().int().min(0),
  });

  app.post<{ Params: { id: string } }>(
    '/api/inventory/sessions/:id/lines',
    { preHandler: requireRole('operator') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const session = db.select().from(invSessions).where(eq(invSessions.id, id)).get();
      if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
      if (session.status !== 'active') return reply.code(400).send({ error: 'Сессия уже закрыта' });

      const parsed = addLineSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });

      const delta = parsed.data.qty_fact - parsed.data.qty_system;

      const inserted = db.insert(invLines).values({
        session_id: id,
        barcode: parsed.data.barcode.trim(),
        cell: parsed.data.cell.trim(),
        qty_system: parsed.data.qty_system,
        qty_fact: parsed.data.qty_fact,
        delta,
      }).returning({ id: invLines.id }).get();

      broadcast({ type: 'inv:changed', session_id: id });
      return { id: inserted!.id, delta };
    }
  );

  // ─── Удаление строки (если оператор ошибся при записи) ─────
  app.delete<{ Params: { lineId: string } }>(
    '/api/inventory/lines/:lineId',
    { preHandler: requireRole('operator') },
    async (req, reply) => {
      const lineId = Number(req.params.lineId);
      const line = db.select().from(invLines).where(eq(invLines.id, lineId)).get();
      if (!line) return reply.code(404).send({ error: 'Строка не найдена' });
      db.delete(invLines).where(eq(invLines.id, lineId)).run();
      broadcast({ type: 'inv:changed', session_id: line.session_id });
      return { ok: true };
    }
  );

  // ─── Закрытие сессии (применение корректировок остаётся на клиенте, ─
  //     потому что использует opsApi.receive/ship) ─────────────────────
  app.patch<{ Params: { id: string } }>(
    '/api/inventory/sessions/:id/close',
    { preHandler: requireRole('operator') },
    async (req, reply) => {
      const id = Number(req.params.id);
      const session = db.select().from(invSessions).where(eq(invSessions.id, id)).get();
      if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
      if (session.status === 'closed') return reply.code(400).send({ error: 'Сессия уже закрыта' });

      db.update(invSessions).set({
        status: 'closed',
        closed_at: Date.now(),
      }).where(eq(invSessions.id, id)).run();

      writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
        action: 'inv.close', entity: 'inv_session', entity_id: id,
      });

      broadcast({ type: 'inv:changed', session_id: id });
      return { ok: true };
    }
  );

  // ─── Удаление сессии (только supervisor) ───────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/inventory/sessions/:id',
    { preHandler: requireRole('supervisor') },
    async req => {
      const id = Number(req.params.id);
      db.delete(invSessions).where(eq(invSessions.id, id)).run();
      writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
        action: 'inv.delete', entity: 'inv_session', entity_id: id,
      });
      broadcast({ type: 'inv:changed', session_id: id });
      return { ok: true };
    }
  );
}
