/** Прочие роуты: settings, audit, backup/restore, server-info. */

import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db, schema } from '../db/index.ts';
import {
auditLog,
asnLines,
asns,
batches,
cells, cycleCountLines, cycleCounts, inspectionActs, invLines,   invSessions, ops, orderLines, orders,   products, reservations, reworkActs, returnDocs, returnLines,   settings, stickerJobs, stock, users,
} from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { clientCount } from '../ws/hub.ts';

const ALL_TABLES = {
  products, cells, stock, asns, asnLines, orders, orderLines, reservations, ops, batches,
  invSessions, invLines, cycleCounts, cycleCountLines, inspectionActs, reworkActs, returnDocs, returnLines, stickerJobs, settings, users, auditLog,
} as const;

export async function miscRoutes(app: FastifyInstance) {
  // ─── ping / health / info ───
  app.get('/api/health', async () => ({ ok: true, ts: Date.now(), clients: clientCount() }));

  app.get('/api/server-info', { preHandler: requireAuth }, async () => {
    const counts: Record<string, number> = {};
    for (const [name, table] of Object.entries(ALL_TABLES)) {
      try {
        counts[name] = (db.select({ c: sql<number>`count(*)`.mapWith(Number) }).from(table as any).get())?.c ?? 0;
      } catch { counts[name] = 0; }
    }
    return { version: '1.0.0', name: 'Storra WMS Server', clients: clientCount(), tables: counts };
  });

  // ─── Алерты дашборда — одним запросом ─────────────────────
  // Раньше клиент тянул все products + stock и считал в браузере.
  // На 5000+ SKU это блокировало UI на сотни мс. Теперь — 3 быстрых SQL.
  app.get('/api/dashboard/alerts', { preHandler: requireAuth }, async () => {
    // 1) Заказы в статусе 'new'
    const newOrders = (db.select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(orders).where(sql`${orders.status} = 'new'`).get())?.c ?? 0;

    // 2) Товары ниже min_stock (один SQL вместо N+1 цикла)
    //    Считаем суммы остатков по barcode, потом сравниваем с min_stock.
    const deficitRows = db.all<{ c: number }>(sql`
      SELECT COUNT(*) AS c FROM (
        SELECT p.barcode, p.min_stock, COALESCE(SUM(s.qty), 0) AS total
        FROM products p
        LEFT JOIN stock s ON s.barcode = p.barcode
        WHERE p.deleted = 0 AND p.min_stock IS NOT NULL AND p.min_stock > 0
        GROUP BY p.barcode, p.min_stock
        HAVING COALESCE(SUM(s.qty), 0) < p.min_stock
      )
    `);
    const deficitCount = deficitRows[0]?.c ?? 0;

    // 3) Истекающие сроки годности
    const expiryWarnRow = db.select().from(settings).where(sql`${settings.key} = 'expiry_warn_days'`).get();
    const expiryWarnDays = expiryWarnRow ? parseInt(expiryWarnRow.value) || 30 : 30;
    const edgeDate = new Date(Date.now() + expiryWarnDays * 86400000).toISOString().slice(0, 10);
    const expiringRows = db.all<{ c: number }>(sql`
      SELECT COUNT(*) AS c FROM stock
      WHERE expiry_date IS NOT NULL AND expiry_date <= ${edgeDate}
    `);
    const expiringCount = expiringRows[0]?.c ?? 0;

    return {
      new_orders: newOrders,
      stock_deficit: deficitCount,
      stock_expiring: expiringCount,
      expiry_warn_days: expiryWarnDays,
    };
  });

  // ─── settings ───
  app.get('/api/settings', { preHandler: requireAuth }, async () => {
    const all = db.select().from(settings).all();
    const obj: Record<string, string> = {};
    for (const s of all) obj[s.key] = s.value;
    return obj;
  });

  app.put('/api/settings', { preHandler: requireRole('supervisor') }, async (req, reply) => {
    const parsed = z.record(z.string()).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ожидается объект ключ→значение' });
    db.transaction(() => {
      for (const [key, value] of Object.entries(parsed.data)) {
        db.insert(settings).values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
      }
    });
    return { ok: true };
  });

  // ─── audit ───
  app.get<{ Querystring: { limit?: string; action?: string } }>(
    '/api/audit',
    { preHandler: requireAuth },
    async req => {
      const limit = Math.min(Number(req.query.limit ?? 300), 1000);
      let q = db.select().from(auditLog).orderBy(desc(auditLog.id)).$dynamic();
      if (req.query.action) q = q.where(eq(auditLog.action, req.query.action));
      return q.limit(limit).all();
    }
  );

  app.delete('/api/audit', { preHandler: requireRole('admin') }, async () => {
    db.delete(auditLog).run();
    return { ok: true };
  });

  // ─── full backup ───
  app.get('/api/backup', { preHandler: requireRole('admin') }, async (_req, reply) => {
    const data: Record<string, unknown[]> = {};
    for (const [name, table] of Object.entries(ALL_TABLES)) {
      data[name] = db.select().from(table as any).all();
    }
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename=storra-backup-${Date.now()}.json`);
    return { version: '1.0.0', exported_at: new Date().toISOString(), data };
  });

  app.post('/api/restore', { preHandler: requireRole('admin') }, async (req, reply) => {
    const parsed = z.object({ data: z.record(z.array(z.record(z.unknown()))) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ожидается { data: { table: [...] } }' });
    let tables = 0, records = 0;
    db.transaction(() => {
      for (const [name, rows] of Object.entries(parsed.data.data)) {
        const table = (ALL_TABLES as any)[name];
        if (!table) continue;
        db.delete(table).run();
        if (rows.length > 0) {
          for (const row of rows) {
            try { db.insert(table).values(row as any).run(); } catch { /* skip */ }
          }
        }
        tables++;
        records += rows.length;
      }
    });
    return { tables, records };
  });
}

// Подавим неиспользуемый импорт
void schema;
