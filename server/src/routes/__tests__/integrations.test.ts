import { afterEach, describe, expect, it } from 'vitest';

import { ops, orderLines, orders, products, reservations, stock, cells } from '../../db/schema.ts';
import { env } from '../../lib/env.ts';
import { createTestServer } from '../../test/createTestServer.ts';

const INTEGRATION_TOKEN = env.INTEGRATION_TOKEN || 'invent_alex20_den26';

describe('Integration endpoints', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('rejects requests without integration token', async () => {
    current = await createTestServer();

    const res = await current.app.inject({
      method: 'GET',
      url: '/api/integrations/health',
    });

    expect(res.statusCode).toBe(401);
  });

  it('searches products, cells and orders for agent use', async () => {
    current = await createTestServer();
    await current.reset();
    const now = Date.now();

    current.sqlite.exec('DELETE FROM cells; DELETE FROM orders; DELETE FROM products;');
    current.db.insert(products).values({
      barcode: 'SKU-SEARCH-1',
      name: 'Ручной сканер Zebra',
      category: 'Оборудование',
      unit: 'шт',
      created_at: now,
      updated_at: now,
    }).run();
    current.db.insert(cells).values({
      addr: 'Z-99-01',
      zone: 'Z',
      row: '99',
      level: '1',
      type: 'shelf',
      status: 'free',
      updated_at: now,
    }).run();
    current.db.insert(orders).values({
      ext_id: 'SEARCH-ORDER',
      status: 'new',
      customer: 'Zebra customer',
      created_at: now,
      updated_at: now,
    }).run();

    const res = await current.app.inject({
      method: 'GET',
      url: '/api/integrations/search?q=zebra',
      headers: { 'X-Integration-Token': INTEGRATION_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      products: Array<{ barcode: string }>;
      cells: Array<{ addr: string }>;
      orders: Array<{ customer?: string }>;
    };
    expect(body.products.some(p => p.barcode === 'SKU-SEARCH-1')).toBe(true);
    expect(body.orders.some(o => (o.customer || '').toLowerCase().includes('zebra'))).toBe(true);
  });

  it('returns product and stock details by barcode', async () => {
    current = await createTestServer();
    await current.reset();
    const now = Date.now();

    current.sqlite.exec('DELETE FROM reservations; DELETE FROM stock; DELETE FROM products;');
    current.db.insert(products).values({
      barcode: 'SKU-DETAIL-1',
      name: 'Сканер Zebra',
      category: 'Оборудование',
      min_stock: 2,
      unit: 'шт',
      created_at: now,
      updated_at: now,
    }).run();
    current.db.insert(stock).values([
      { barcode: 'SKU-DETAIL-1', cell: 'A-01-01', qty: 3, updated_at: now },
      { barcode: 'SKU-DETAIL-1', cell: 'A-01-02', qty: 2, updated_at: now },
    ]).run();
    const orderForReserve = current.db
      .insert(orders)
      .values({ status: 'new', customer: 'Reserve test', created_at: now, updated_at: now })
      .returning({ id: orders.id })
      .get();
    current.db.insert(reservations).values({
      order_id: orderForReserve!.id,
      barcode: 'SKU-DETAIL-1',
      cell: 'A-01-01',
      qty: 1,
      operator: 'admin',
    }).run();

    const productRes = await current.app.inject({
      method: 'GET',
      url: '/api/integrations/products/SKU-DETAIL-1',
      headers: { 'X-Integration-Token': INTEGRATION_TOKEN },
    });
    expect(productRes.statusCode).toBe(200);
    expect(productRes.json()).toMatchObject({ barcode: 'SKU-DETAIL-1', name: 'Сканер Zebra' });

    const stockRes = await current.app.inject({
      method: 'GET',
      url: '/api/integrations/stock/SKU-DETAIL-1',
      headers: { 'X-Integration-Token': INTEGRATION_TOKEN },
    });
    expect(stockRes.statusCode).toBe(200);
    const stockBody = stockRes.json() as {
      total_qty: number;
      reserved_qty: number;
      available_qty: number;
      locations: Array<{ cell: string; qty: number }>;
    };
    expect(stockBody.total_qty).toBe(5);
    expect(stockBody.reserved_qty).toBe(1);
    expect(stockBody.available_qty).toBe(4);
    expect(stockBody.locations).toHaveLength(2);
  });

  it('returns low stock items for n8n polling', async () => {
    current = await createTestServer();
    await current.reset();

    current.sqlite.exec(`DELETE FROM stock; DELETE FROM products;`);
    current.db.insert(products).values({
      barcode: 'SKU-LOW-1',
      name: 'Кабель USB-C',
      category: 'Электроника',
      min_stock: 10,
      unit: 'шт',
      created_at: Date.now(),
      updated_at: Date.now(),
    }).run();
    current.db.insert(stock).values({
      barcode: 'SKU-LOW-1',
      cell: 'A-01-01',
      qty: 3,
      updated_at: Date.now(),
    }).run();

    const res = await current.app.inject({
      method: 'GET',
      url: '/api/integrations/low-stock',
      headers: { 'X-Integration-Token': INTEGRATION_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      count: number;
      items: Array<{ barcode: string; current_qty: number; min_stock: number; deficit: number }>;
    };
    expect(body.count).toBe(1);
    expect(body.items[0]).toMatchObject({
      barcode: 'SKU-LOW-1',
      current_qty: 3,
      min_stock: 10,
      deficit: 7,
    });
  });

  it('returns order details with lines, reservations and stock summary', async () => {
    current = await createTestServer();
    await current.reset();
    const now = Date.now();

    current.sqlite.exec('DELETE FROM reservations; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM stock; DELETE FROM products;');
    current.db.insert(products).values({
      barcode: 'SKU-ORDER-1',
      name: 'Термопринтер',
      unit: 'шт',
      min_stock: 1,
      created_at: now,
      updated_at: now,
    }).run();
    const inserted = current.db
      .insert(orders)
      .values({ status: 'picking', customer: 'ООО Ромашка', created_at: now, updated_at: now })
      .returning({ id: orders.id })
      .get();
    current.db.insert(orderLines).values({
      order_id: inserted!.id,
      barcode: 'SKU-ORDER-1',
      qty_plan: 5,
      qty_fact: 2,
      status: 'partial',
    }).run();
    current.db.insert(stock).values({
      barcode: 'SKU-ORDER-1',
      cell: 'B-02-01',
      qty: 7,
      updated_at: now,
    }).run();
    current.db.insert(reservations).values({
      order_id: inserted!.id,
      order_line_id: 1,
      barcode: 'SKU-ORDER-1',
      cell: 'B-02-01',
      qty: 3,
      operator: 'admin',
    }).run();

    const res = await current.app.inject({
      method: 'GET',
      url: `/api/integrations/orders/${inserted!.id}`,
      headers: { Authorization: `Bearer ${INTEGRATION_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      order: { id: number; status: string };
      lines: Array<{
        barcode: string;
        stock_summary: { total_qty: number; reserved_for_line: number; available_estimate: number };
      }>;
      reservations: Array<{ qty: number }>;
    };

    expect(body.order.id).toBe(inserted!.id);
    expect(body.order.status).toBe('picking');
    expect(body.lines[0]?.barcode).toBe('SKU-ORDER-1');
    expect(body.lines[0]?.stock_summary).toMatchObject({
      total_qty: 7,
      reserved_for_line: 3,
      available_estimate: 4,
    });
    expect(body.reservations[0]?.qty).toBe(3);
  });

  it('returns deterministic order analysis for agents', async () => {
    current = await createTestServer();
    await current.reset();
    const now = Date.now();

    current.sqlite.exec('DELETE FROM reservations; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM stock; DELETE FROM products;');
    current.db.insert(products).values({
      barcode: 'SKU-ANALYZE-1',
      name: 'Принтер этикеток',
      unit: 'шт',
      created_at: now,
      updated_at: now,
    }).run();
    const inserted = current.db
      .insert(orders)
      .values({ status: 'picking', customer: 'ООО Аналитика', created_at: now, updated_at: now })
      .returning({ id: orders.id })
      .get();
    current.db.insert(orderLines).values({
      order_id: inserted!.id,
      barcode: 'SKU-ANALYZE-1',
      qty_plan: 5,
      qty_fact: 1,
      status: 'partial',
    }).run();
    current.db.insert(stock).values({ barcode: 'SKU-ANALYZE-1', cell: 'C-01-01', qty: 2, updated_at: now }).run();
    current.db.insert(reservations).values({
      order_id: inserted!.id,
      order_line_id: 1,
      barcode: 'SKU-ANALYZE-1',
      cell: 'C-01-01',
      qty: 1,
      operator: 'admin',
    }).run();

    const res = await current.app.inject({
      method: 'GET',
      url: `/api/integrations/orders/${inserted!.id}/analysis`,
      headers: { 'X-Integration-Token': INTEGRATION_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      summary: { blocked_lines: number; fulfillment_ready: boolean };
      lines: Array<{ qty_remaining: number; issues: string[]; is_blocked: boolean }>;
    };
    expect(body.summary.blocked_lines).toBe(1);
    expect(body.summary.fulfillment_ready).toBe(false);
    expect(body.lines[0]?.qty_remaining).toBe(4);
    expect(body.lines[0]?.issues).toContain('insufficient_reservation');
    expect(body.lines[0]?.issues).toContain('insufficient_available_stock');
    expect(body.lines[0]?.is_blocked).toBe(true);
  });

  it('returns digest summary for recent ops and orders', async () => {
    current = await createTestServer();
    await current.reset();
    const now = Date.now();

    current.db.insert(products).values({
      barcode: 'SKU-DIGEST',
      name: 'Термопринтер',
      unit: 'шт',
      created_at: now,
      updated_at: now,
    }).run();

    const inserted = current.db
      .insert(orders)
      .values({
        status: 'new',
        customer: 'ООО Ромашка',
        created_at: now,
        updated_at: now,
      })
      .returning({ id: orders.id })
      .get();

    current.db.insert(ops).values({
      type: 'receive',
      barcode: 'SKU-DIGEST',
      cell: 'B-02-01',
      qty: 5,
      operator: 'admin',
      order_id: inserted?.id,
      ts: now,
    }).run();

    const res = await current.app.inject({
      method: 'GET',
      url: '/api/integrations/daily-digest?hours=24&top=3',
      headers: { Authorization: `Bearer ${INTEGRATION_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      orders: { created_in_window: number; current_statuses: Array<{ status: string; count: number }> };
      operations: { by_type: Array<{ type: string; count: number }>; top_skus: Array<{ barcode: string }> };
    };

    expect(body.orders.created_in_window).toBeGreaterThanOrEqual(1);
    expect(body.orders.current_statuses.some(s => s.status === 'new')).toBe(true);
    expect(body.operations.by_type.some(o => o.type === 'receive' && o.count >= 1)).toBe(true);
    expect(body.operations.top_skus[0]?.barcode).toBe('SKU-DIGEST');
  });
});
