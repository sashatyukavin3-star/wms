import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import {
  asnLines,
  asns,
  auditLog,
  batches,
  cells,
  cycleCountLines,
  cycleCounts,
  inspectionActs,
  invLines,
  invSessions,
  ops,
  orderLines,
  orders,
  products,
  reservations,
  reworkActs,
  returnDocs,
  returnLines,
  settings,
  stickerJobs,
  stock,
  users,
} from '../db/schema.ts';
import { requireIntegration } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';

const ALL_TABLES = {
  products,
  cells,
  stock,
  cycleCounts,
  cycleCountLines,
  asns,
  asnLines,
  orders,
  orderLines,
  reservations,
  ops,
  batches,
  invSessions,
  invLines,
  inspectionActs,
  reworkActs,
  returnDocs,
  returnLines,
  stickerJobs,
  settings,
  users,
  auditLog,
} as const;

function integrationAudit(ip: string | undefined, action: string, details?: Record<string, unknown>) {
  writeAudit({ username: 'integration:n8n', ip }, { action, entity: 'integration', details });
}

function toIsoDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

export async function integrationsRoutes(app: FastifyInstance) {
  app.get('/api/integrations/health', { preHandler: requireIntegration }, async req => {
    integrationAudit(req.ip, 'integration.health');
    return {
      ok: true,
      ts: Date.now(),
      service: 'storra-wms-integrations',
    };
  });

  app.get('/api/integrations/products/:barcode', { preHandler: requireIntegration }, async (req, reply) => {
    const params = z.object({ barcode: z.string().min(1) }).parse(req.params);
    const product = db.select().from(products).where(eq(products.barcode, params.barcode)).get();
    if (!product || product.deleted) return reply.code(404).send({ error: 'Товар не найден' });

    integrationAudit(req.ip, 'integration.product.read', { barcode: params.barcode });
    return product;
  });

  app.get('/api/integrations/stock/:barcode', { preHandler: requireIntegration }, async (req, reply) => {
    const params = z.object({ barcode: z.string().min(1) }).parse(req.params);
    const product = db.select().from(products).where(eq(products.barcode, params.barcode)).get();
    if (!product || product.deleted) return reply.code(404).send({ error: 'Товар не найден' });

    const locations = db.select().from(stock).where(eq(stock.barcode, params.barcode)).all();
    const reserved = db
      .select({ total: sql<number>`COALESCE(SUM(${reservations.qty}), 0)` })
      .from(reservations)
      .where(eq(reservations.barcode, params.barcode))
      .get();

    const totalQty = locations.reduce((sum, row) => sum + row.qty, 0);
    const reservedQty = Number(reserved?.total ?? 0);

    integrationAudit(req.ip, 'integration.stock.read', {
      barcode: params.barcode,
      locations: locations.length,
    });

    return {
      barcode: params.barcode,
      name: product.name,
      category: product.category,
      unit: product.unit,
      total_qty: totalQty,
      reserved_qty: reservedQty,
      available_qty: Math.max(0, totalQty - reservedQty),
      locations,
    };
  });

  app.get('/api/integrations/orders/:id', { preHandler: requireIntegration }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const order = db.select().from(orders).where(eq(orders.id, params.id)).get();
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });

    const lines = db.select().from(orderLines).where(eq(orderLines.order_id, params.id)).all();
    const reserves = db.select().from(reservations).where(eq(reservations.order_id, params.id)).all();

    const lineBarcodes = [...new Set(lines.map(line => line.barcode))];
    const productRows = lineBarcodes.length
      ? db.select().from(products).all().filter(product => lineBarcodes.includes(product.barcode))
      : [];
    const stockRows = lineBarcodes.length
      ? db.select().from(stock).all().filter(item => lineBarcodes.includes(item.barcode))
      : [];

    const lineContext = lines.map(line => {
      const product = productRows.find(p => p.barcode === line.barcode);
      const stockForLine = stockRows.filter(s => s.barcode === line.barcode);
      const reservationsForLine = reserves.filter(r => r.order_line_id === line.id);
      const totalQty = stockForLine.reduce((sum, row) => sum + row.qty, 0);
      const reservedForLine = reservationsForLine.reduce((sum, row) => sum + row.qty, 0);

      return {
        ...line,
        product: product
          ? {
              barcode: product.barcode,
              name: product.name,
              category: product.category,
              unit: product.unit,
              min_stock: product.min_stock,
              has_expiry: product.has_expiry,
            }
          : null,
        stock_summary: {
          total_qty: totalQty,
          reserved_for_line: reservedForLine,
          available_estimate: Math.max(0, totalQty - reservedForLine),
          locations: stockForLine,
        },
        reservations: reservationsForLine,
      };
    });

    integrationAudit(req.ip, 'integration.order.read', {
      order_id: params.id,
      lines: lines.length,
    });

    return {
      order,
      lines: lineContext,
      reservations: reserves,
    };
  });


  app.get('/api/integrations/search', { preHandler: requireIntegration }, async req => {
    const query = z.object({ q: z.string().min(2), limit: z.coerce.number().int().positive().max(25).optional() }).parse(req.query);
    const q = query.q.trim().toLowerCase();
    const limit = query.limit ?? 10;

    const productRows = db.select().from(products).all()
      .filter(product => !product.deleted && (
        product.barcode.toLowerCase().includes(q) ||
        product.name.toLowerCase().includes(q) ||
        (product.category || '').toLowerCase().includes(q)
      ))
      .slice(0, limit);

    const cellRows = db.select().from(cells).all()
      .filter(cell => !cell.deleted && (
        cell.addr.toLowerCase().includes(q) ||
        (cell.zone || '').toLowerCase().includes(q) ||
        (cell.row || '').toLowerCase().includes(q)
      ))
      .slice(0, limit);

    const orderRows = db.select().from(orders).all()
      .filter(order =>
        String(order.id).includes(q) ||
        (order.ext_id || '').toLowerCase().includes(q) ||
        (order.customer || '').toLowerCase().includes(q)
      )
      .slice(0, limit);

    integrationAudit(req.ip, 'integration.search.read', {
      q,
      products: productRows.length,
      cells: cellRows.length,
      orders: orderRows.length,
    });

    return {
      q: query.q,
      products: productRows,
      cells: cellRows,
      orders: orderRows,
    };
  });


  app.get('/api/integrations/orders/:id/analysis', { preHandler: requireIntegration }, async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const order = db.select().from(orders).where(eq(orders.id, params.id)).get();
    if (!order) return reply.code(404).send({ error: 'Заказ не найден' });

    const lines = db.select().from(orderLines).where(eq(orderLines.order_id, params.id)).all();
    const allReservations = db.select().from(reservations).all();
    const allStock = db.select().from(stock).all();
    const allProducts = db.select().from(products).all();

    const productsByBarcode = new Map(allProducts.map(product => [product.barcode, product]));

    const lineAnalyses = lines.map(line => {
      const qtyRemaining = Math.max(0, line.qty_plan - line.qty_fact);
      const lineReservations = allReservations.filter(reservation => reservation.order_line_id === line.id);
      const reservedForLine = lineReservations.reduce((sum, reservation) => sum + reservation.qty, 0);
      const totalReservedForBarcode = allReservations
        .filter(reservation => reservation.barcode === line.barcode)
        .reduce((sum, reservation) => sum + reservation.qty, 0);
      const stockForBarcode = allStock.filter(item => item.barcode === line.barcode);
      const totalStock = stockForBarcode.reduce((sum, item) => sum + item.qty, 0);
      const freeForThisOrder = Math.max(0, totalStock - (totalReservedForBarcode - reservedForLine));

      const issues: string[] = [];
      if (qtyRemaining > 0 && reservedForLine === 0) issues.push('no_reservation');
      if (qtyRemaining > 0 && reservedForLine < qtyRemaining) issues.push('insufficient_reservation');
      if (qtyRemaining > 0 && freeForThisOrder < qtyRemaining) issues.push('insufficient_available_stock');
      if (qtyRemaining > 0 && totalStock === 0) issues.push('out_of_stock');
      if (qtyRemaining > 0 && stockForBarcode.length === 0) issues.push('no_stock_locations');

      return {
        line_id: line.id,
        barcode: line.barcode,
        product_name: productsByBarcode.get(line.barcode)?.name || line.barcode,
        status: line.status,
        qty_plan: line.qty_plan,
        qty_fact: line.qty_fact,
        qty_remaining: qtyRemaining,
        reserved_for_line: reservedForLine,
        total_reserved_for_barcode: totalReservedForBarcode,
        total_stock: totalStock,
        free_for_this_order: freeForThisOrder,
        reservation_locations: lineReservations,
        stock_locations: stockForBarcode,
        issues,
        is_blocked: qtyRemaining > 0 && issues.length > 0,
      };
    });

    const blockedLines = lineAnalyses.filter(line => line.is_blocked);
    const summary = {
      total_lines: lineAnalyses.length,
      remaining_lines: lineAnalyses.filter(line => line.qty_remaining > 0).length,
      blocked_lines: blockedLines.length,
      ready_lines: lineAnalyses.filter(line => line.qty_remaining > 0 && !line.is_blocked).length,
      fulfillment_ready: lineAnalyses.every(line => line.qty_remaining === 0 || !line.is_blocked),
    };

    integrationAudit(req.ip, 'integration.order.analysis.read', {
      order_id: params.id,
      blocked_lines: summary.blocked_lines,
    });

    return {
      order,
      summary,
      lines: lineAnalyses,
    };
  });

  app.get('/api/integrations/low-stock', { preHandler: requireIntegration }, async req => {
    const rows = db.all<{
      barcode: string;
      name: string | null;
      category: string | null;
      min_stock: number;
      current_qty: number;
      deficit: number;
    }>(sql`
      SELECT
        p.barcode,
        p.name,
        p.category,
        p.min_stock,
        COALESCE(SUM(s.qty), 0) AS current_qty,
        (p.min_stock - COALESCE(SUM(s.qty), 0)) AS deficit
      FROM products p
      LEFT JOIN stock s ON s.barcode = p.barcode
      WHERE p.deleted = 0
        AND p.min_stock IS NOT NULL
        AND p.min_stock > 0
      GROUP BY p.barcode, p.name, p.category, p.min_stock
      HAVING COALESCE(SUM(s.qty), 0) < p.min_stock
      ORDER BY deficit DESC, p.name ASC
    `);

    integrationAudit(req.ip, 'integration.low_stock.read', { count: rows.length });
    return {
      generated_at: Date.now(),
      count: rows.length,
      items: rows,
    };
  });

  app.get<{ Querystring: { days?: string } }>(
    '/api/integrations/expiring-stock',
    { preHandler: requireIntegration },
    async req => {
      const daysSchema = z.object({ days: z.coerce.number().int().positive().max(365).optional() });
      const parsed = daysSchema.parse(req.query);
      const settingsRow = db.select().from(settings).where(sql`${settings.key} = 'expiry_warn_days'`).get();
      const days = parsed.days ?? (settingsRow ? Number(settingsRow.value) || 30 : 30);
      const edgeDate = toIsoDate(days);

      const rows = db.all<{
        barcode: string;
        name: string | null;
        category: string | null;
        cell: string;
        qty: number;
        expiry_date: string;
      }>(sql`
        SELECT
          s.barcode,
          p.name,
          p.category,
          s.cell,
          s.qty,
          s.expiry_date
        FROM stock s
        LEFT JOIN products p ON p.barcode = s.barcode
        WHERE s.expiry_date IS NOT NULL
          AND s.expiry_date <= ${edgeDate}
        ORDER BY s.expiry_date ASC, p.name ASC, s.cell ASC
      `);

      integrationAudit(req.ip, 'integration.expiring_stock.read', { count: rows.length, days });
      return {
        generated_at: Date.now(),
        until_date: edgeDate,
        days,
        count: rows.length,
        items: rows,
      };
    }
  );

  app.get<{ Querystring: { hours?: string; top?: string; expiry_days?: string } }>(
    '/api/integrations/daily-digest',
    { preHandler: requireIntegration },
    async req => {
      const query = z
        .object({
          hours: z.coerce.number().int().positive().max(168).optional(),
          top: z.coerce.number().int().positive().max(50).optional(),
          expiry_days: z.coerce.number().int().positive().max(365).optional(),
        })
        .parse(req.query);

      const hours = query.hours ?? 24;
      const top = query.top ?? 5;
      const sinceTs = Date.now() - hours * 3_600_000;
      const expiryDays = query.expiry_days ?? 30;
      const expiryEdge = toIsoDate(expiryDays);

      const currentOrderStatuses = db.all<{ status: string; count: number }>(sql`
        SELECT status, COUNT(*) AS count
        FROM orders
        GROUP BY status
        ORDER BY status ASC
      `);

      const orderWindowRow =
        db.get<{
          created_in_window: number;
          closed_in_window: number;
        }>(sql`
          SELECT
            SUM(CASE WHEN created_at >= ${sinceTs} THEN 1 ELSE 0 END) AS created_in_window,
            SUM(CASE WHEN closed_at IS NOT NULL AND closed_at >= ${sinceTs} THEN 1 ELSE 0 END) AS closed_in_window
          FROM orders
        `) ?? { created_in_window: 0, closed_in_window: 0 };

      const opsByType = db.all<{ type: string; count: number; qty_total: number }>(sql`
        SELECT
          type,
          COUNT(*) AS count,
          COALESCE(SUM(ABS(qty)), 0) AS qty_total
        FROM ops
        WHERE ts >= ${sinceTs}
        GROUP BY type
        ORDER BY count DESC, qty_total DESC
      `);

      const topSkus = db.all<{
        barcode: string;
        name: string | null;
        ops_count: number;
        qty_total: number;
      }>(sql`
        SELECT
          o.barcode,
          p.name,
          COUNT(*) AS ops_count,
          COALESCE(SUM(ABS(o.qty)), 0) AS qty_total
        FROM ops o
        LEFT JOIN products p ON p.barcode = o.barcode
        WHERE o.ts >= ${sinceTs}
          AND o.barcode IS NOT NULL
        GROUP BY o.barcode, p.name
        ORDER BY qty_total DESC, ops_count DESC
        LIMIT ${top}
      `);

      const lowStockRow =
        db.get<{ count: number }>(sql`
          SELECT COUNT(*) AS count FROM (
            SELECT p.barcode
            FROM products p
            LEFT JOIN stock s ON s.barcode = p.barcode
            WHERE p.deleted = 0
              AND p.min_stock IS NOT NULL
              AND p.min_stock > 0
            GROUP BY p.barcode, p.min_stock
            HAVING COALESCE(SUM(s.qty), 0) < p.min_stock
          )
        `) ?? { count: 0 };

      const expiringRow =
        db.get<{ count: number }>(sql`
          SELECT COUNT(*) AS count
          FROM stock
          WHERE expiry_date IS NOT NULL
            AND expiry_date <= ${expiryEdge}
        `) ?? { count: 0 };

      integrationAudit(req.ip, 'integration.daily_digest.read', { hours, top });
      return {
        generated_at: Date.now(),
        window_hours: hours,
        since_ts: sinceTs,
        alerts: {
          low_stock_count: lowStockRow.count,
          expiring_stock_count: expiringRow.count,
          expiring_within_days: expiryDays,
        },
        orders: {
          current_statuses: currentOrderStatuses,
          created_in_window: orderWindowRow.created_in_window,
          closed_in_window: orderWindowRow.closed_in_window,
        },
        operations: {
          by_type: opsByType,
          top_skus: topSkus,
        },
      };
    }
  );

  app.get('/api/integrations/backup', { preHandler: requireIntegration }, async (req, reply) => {
    const data: Record<string, unknown[]> = {};
    for (const [name, table] of Object.entries(ALL_TABLES)) {
      data[name] = db.select().from(table).all();
    }

    integrationAudit(req.ip, 'integration.backup.export', {
      tables: Object.keys(ALL_TABLES).length,
    });

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename=storra-backup-${Date.now()}.json`);
    return {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      source: 'integration-api',
      data,
    };
  });
}
