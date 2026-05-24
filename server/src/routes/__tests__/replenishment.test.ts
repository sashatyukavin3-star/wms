import { afterEach, describe, expect, it } from 'vitest';

import { cells, orders, products, reservations, stock } from '../../db/schema.ts';
import { authedRequest, createTestServer } from '../../test/createTestServer.ts';

describe('Replenishment routes', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('builds replenishment suggestion for pick-face below min stock', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();

    current.db.insert(products).values({
      barcode: 'SKU-R-1',
      name: 'Товар пополнения',
      unit: 'шт',
      min_stock: 5,
      max_stock: 10,
      created_at: now,
      updated_at: now,
    }).run();
    current.db.insert(cells).values([
      { addr: 'PF-01', type: 'shelf', status: 'occupied', is_picking_face: true, pick_priority: 100, max_units: 20, updated_at: now },
      { addr: 'ST-01', type: 'pallet', status: 'occupied', updated_at: now },
    ]).run();
    current.db.insert(stock).values([
      { barcode: 'SKU-R-1', cell: 'PF-01', qty: 1, updated_at: now },
      { barcode: 'SKU-R-1', cell: 'ST-01', qty: 20, updated_at: now },
    ]).run();

    const res = await authedRequest(current.app, token, { method: 'GET', url: '/api/replenishment/suggestions' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ barcode: string; destination_cell: string; suggested_qty: number }>;
    expect(body[0]).toMatchObject({ barcode: 'SKU-R-1', destination_cell: 'PF-01', suggested_qty: 9 });
  });

  it('executes replenishment move into pick-face', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();

    current.db.insert(cells).values([
      { addr: 'PF-02', type: 'shelf', status: 'occupied', is_picking_face: true, max_units: 20, updated_at: now },
      { addr: 'ST-02', type: 'pallet', status: 'occupied', updated_at: now },
    ]).run();
    current.db.insert(stock).values([
      { barcode: 'SKU-R-2', cell: 'PF-02', qty: 1, updated_at: now },
      { barcode: 'SKU-R-2', cell: 'ST-02', qty: 12, updated_at: now },
    ]).run();

    const res = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/replenishment/execute',
      payload: { barcode: 'SKU-R-2', from: 'ST-02', to: 'PF-02', qty: 4 },
    });
    expect(res.statusCode).toBe(200);

    const source = current.db.select().from(stock).all().find(row => row.barcode === 'SKU-R-2' && row.cell === 'ST-02');
    const target = current.db.select().from(stock).all().find(row => row.barcode === 'SKU-R-2' && row.cell === 'PF-02');
    expect(source?.qty).toBe(8);
    expect(target?.qty).toBe(5);
  });

  it('does not allow replenishment beyond free source qty', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();

    current.db.insert(cells).values([
      { addr: 'PF-03', type: 'shelf', status: 'occupied', is_picking_face: true, updated_at: now },
      { addr: 'ST-03', type: 'pallet', status: 'occupied', updated_at: now },
    ]).run();
    current.db.insert(stock).values([{ barcode: 'SKU-R-3', cell: 'ST-03', qty: 5, updated_at: now }]).run();
        const order = current.db.insert(orders).values({ status: 'new', customer: 'Reserve', created_at: now, updated_at: now }).returning({ id: orders.id }).get()!;
    current.db.insert(reservations).values({ order_id: order.id, barcode: 'SKU-R-3', cell: 'ST-03', qty: 4, operator: 'admin' }).run();

    const res = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/replenishment/execute',
      payload: { barcode: 'SKU-R-3', from: 'ST-03', to: 'PF-03', qty: 3 },
    });
    expect(res.statusCode).toBe(400);
  });
});
