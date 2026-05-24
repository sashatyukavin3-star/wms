import { eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { products } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

const productSchema = z.object({
  barcode: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  supplier: z.string().optional(),
  unit: z.string().default('шт'),
  weight_gross: z.number().int().optional(),
  weight_net: z.number().int().optional(),
  dim_l: z.number().int().optional(),
  dim_w: z.number().int().optional(),
  dim_h: z.number().int().optional(),
  has_expiry: z.boolean().optional(),
  expiry_days: z.number().int().optional(),
  min_stock: z.number().int().optional(),
  max_stock: z.number().int().optional(),
  abc_class: z.enum(['A', 'B', 'C', '']).optional(),
  xyz_class: z.enum(['X', 'Y', 'Z', '']).optional(),
});

export async function productsRoutes(app: FastifyInstance) {
  // Полный список или дельта по updated_at (для синхронизации)
  app.get<{ Querystring: { since?: string } }>(
    '/api/products',
    { preHandler: requireAuth },
    async req => {
      const since = req.query.since ? Number(req.query.since) : 0;
      if (since > 0) {
        return db.select().from(products).where(gt(products.updated_at, since)).all();
      }
      return db.select().from(products).where(eq(products.deleted, false)).all();
    }
  );

  app.get<{ Params: { barcode: string } }>(
    '/api/products/:barcode',
    { preHandler: requireAuth },
    async (req, reply) => {
      const p = db.select().from(products).where(eq(products.barcode, req.params.barcode)).get();
      if (!p) return reply.code(404).send({ error: 'Не найдено' });
      return p;
    }
  );

  // Upsert (создание или обновление)
  app.put('/api/products', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });
    const now = Date.now();
    const existing = db.select().from(products).where(eq(products.barcode, parsed.data.barcode)).get();
    if (existing) {
      db.update(products).set({ ...parsed.data, updated_at: now, deleted: false }).where(eq(products.barcode, parsed.data.barcode)).run();
    } else {
      db.insert(products).values({ ...parsed.data, created_at: now, updated_at: now }).run();
    }
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: existing ? 'product.update' : 'product.create',
      entity: 'product', entity_id: parsed.data.barcode,
    });
    broadcast({ type: 'product:changed', barcode: parsed.data.barcode });
    return { ok: true };
  });

  // Bulk upsert (для массового импорта CSV)
  app.post('/api/products/bulk', { preHandler: requireRole('operator') }, async (req, reply) => {
    const arr = z.array(productSchema).safeParse(req.body);
    if (!arr.success) return reply.code(400).send({ error: 'Ожидается массив товаров' });
    const now = Date.now();
    let added = 0, updated = 0;
    db.transaction(() => {
      for (const p of arr.data) {
        const existing = db.select({ b: products.barcode }).from(products).where(eq(products.barcode, p.barcode)).get();
        if (existing) {
          db.update(products).set({ ...p, updated_at: now, deleted: false }).where(eq(products.barcode, p.barcode)).run();
          updated++;
        } else {
          db.insert(products).values({ ...p, created_at: now, updated_at: now }).run();
          added++;
        }
      }
    });
    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'product.bulk', entity: 'product', details: { added, updated },
    });
    broadcast({ type: 'product:changed' });
    return { added, updated };
  });

  app.delete<{ Params: { barcode: string } }>(
    '/api/products/:barcode',
    { preHandler: requireRole('supervisor') },
    async (req, reply) => {
      const barcode = req.params.barcode;
      const existing = db.select().from(products).where(eq(products.barcode, barcode)).get();
      if (!existing) return reply.code(404).send({ error: 'Не найдено' });
      // Soft delete для синхронизации
      db.update(products).set({ deleted: true, updated_at: Date.now() }).where(eq(products.barcode, barcode)).run();
      writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
        action: 'product.delete', entity: 'product', entity_id: barcode,
      });
      broadcast({ type: 'product:changed', barcode });
      return { ok: true };
    }
  );
}
