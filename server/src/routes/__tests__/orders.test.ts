import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { orderLines, orders, stock } from '../../db/schema.ts';
import { authedRequest, createTestServer } from '../../test/createTestServer.ts';

describe('Orders routes', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('packs fully picked order', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/orders',
      payload: { customer: 'ООО Тест' },
    });
    const { id } = createRes.json() as { id: number };

    await current.db.insert(orderLines).values({
      order_id: id,
      barcode: 'SKU-PACK-1',
      qty_plan: 4,
      qty_fact: 4,
      status: 'done',
    }).run();
    await current.db.update(orders).set({ status: 'picked' }).where(eq(orders.id, id)).run();

    const packRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/orders/${id}/pack`,
      payload: { package_count: 2, packed_by: 'packer1' },
    });

    expect(packRes.statusCode).toBe(200);
    const order = current.db.select().from(orders).where(eq(orders.id, id)).get();
    expect(order).toMatchObject({ status: 'packed', package_count: 2, packed_by: 'packer1' });
    expect(order?.packed_at).toBeTypeOf('number');
  });

  it('rejects packing if not all lines are done', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/orders',
      payload: { customer: 'ООО Тест2' },
    });
    const { id } = createRes.json() as { id: number };

    await current.db.insert(orderLines).values({
      order_id: id,
      barcode: 'SKU-PACK-2',
      qty_plan: 4,
      qty_fact: 2,
      status: 'partial',
    }).run();

    const packRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/orders/${id}/pack`,
      payload: { package_count: 1 },
    });

    expect(packRes.statusCode).toBe(409);
  });

  it('does not downgrade packed order back to picked during ship op', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/orders',
      payload: { customer: 'ООО Packed' },
    });
    const { id } = createRes.json() as { id: number };

    await current.db.insert(orderLines).values({
      order_id: id,
      barcode: 'SKU-PACK-3',
      qty_plan: 5,
      qty_fact: 4,
      status: 'partial',
    }).run();
    await current.db.insert(stock).values({ barcode: 'SKU-PACK-3', cell: 'A-01-01', qty: 10, updated_at: Date.now() }).run();
    await current.db.update(orders).set({ status: 'packed', package_count: 1, packed_by: 'packer2', packed_at: Date.now() }).where(eq(orders.id, id)).run();

    const shipRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/ops/ship',
      payload: { barcode: 'SKU-PACK-3', cell: 'A-01-01', qty: 1, order_id: id, operator: 'shipper1' },
    });

    expect(shipRes.statusCode).toBe(200);
    const order = current.db.select().from(orders).where(eq(orders.id, id)).get();
    expect(order?.status).toBe('packed');
  });
});
