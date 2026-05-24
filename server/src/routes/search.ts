import { or, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { asns, cells, inspectionActs, orders, products, returnDocs, reworkActs } from '../db/schema.ts';
import { requireAuth } from '../middleware/auth.ts';

export async function searchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/search/global', { preHandler: requireAuth }, async req => {
    const parsed = z.object({
      q: z.string().min(2),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return [];

    const q = `%${parsed.data.q.trim()}%`;
    const limit = parsed.data.limit ?? 12;

    const [productRows, cellRows, orderRows, asnRows, returnRows, inspRows, reworkRows] = await Promise.all([
      db.select().from(products).where(or(like(products.barcode, q), like(products.name, q), like(products.category, q))).limit(limit).all(),
      db.select().from(cells).where(or(like(cells.addr, q), like(cells.zone, q))).limit(limit).all(),
      db.select().from(orders).where(or(like(orders.ext_id, q), like(orders.customer, q))).limit(limit).all(),
      db.select().from(asns).where(or(like(asns.asn_number, q), like(asns.supplier, q))).limit(limit).all(),
      db.select().from(returnDocs).where(or(like(returnDocs.return_number, q), like(returnDocs.customer, q), like(returnDocs.reason, q))).limit(limit).all(),
      db.select().from(inspectionActs).where(like(inspectionActs.act_number, q)).limit(limit).all(),
      db.select().from(reworkActs).where(like(reworkActs.act_number, q)).limit(limit).all(),
    ]);

    const results = [
      ...productRows.filter(p => !p.deleted).map(p => ({ id: `p-${p.barcode}`, page: 'products', title: p.name, subtitle: `Товар · ${p.barcode}` })),
      ...cellRows.filter(c => !c.deleted).map(c => ({ id: `c-${c.addr}`, page: 'cells', title: c.addr, subtitle: `Ячейка · ${c.zone || 'без зоны'}` })),
      ...orderRows.map(o => ({ id: `o-${o.id}`, page: 'orders', title: `Заказ #${o.id}${o.ext_id ? ` / ${o.ext_id}` : ''}`, subtitle: `${o.customer || 'без клиента'} · ${o.status}` })),
      ...asnRows.map(a => ({ id: `asn-${a.id}`, page: 'asn', title: a.asn_number, subtitle: `Поставка · ${a.supplier || 'без поставщика'} · ${a.status}` })),
      ...returnRows.map(r => ({ id: `ret-${r.id}`, page: 'returns', title: r.return_number, subtitle: `Возврат · ${r.customer || 'без клиента'} · ${r.status}` })),
      ...inspRows.map(a => ({ id: `insp-${a.id}`, page: 'acts', title: a.act_number, subtitle: `Акт осмотра · ${a.date}` })),
      ...reworkRows.map(a => ({ id: `rew-${a.id}`, page: 'acts', title: a.act_number, subtitle: `Акт переборки · ${a.date}` })),
    ].slice(0, limit);

    return results;
  });
}
