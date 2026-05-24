import { afterEach, describe, expect, it } from 'vitest';

import { cells, cycleCountLines, cycleCounts, invLines, ops, products, stock } from '../../db/schema.ts';
import { authedRequest, createTestServer } from '../../test/createTestServer.ts';

describe('Cycle count routes', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('builds suggestions from discrepancy and special cells', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();
    current.db.insert(products).values({ barcode: 'SKU-CC-1', name: 'Cycle Zebra', unit: 'шт', created_at: now, updated_at: now }).run();
    current.db.insert(cells).values({ addr: 'Q-CC-1', zone: 'Q', type: 'shelf', status: 'quarantine', updated_at: now }).run();
    current.db.insert(stock).values({ barcode: 'SKU-CC-1', cell: 'Q-CC-1', qty: 4, updated_at: now }).run();
    current.db.insert(invLines).values({ session_id: 1, barcode: 'SKU-CC-1', cell: 'Q-CC-1', qty_system: 3, qty_fact: 1, delta: -2, ts: now }).run();

    const res = await authedRequest(current.app, token, { method: 'GET', url: '/api/cycle-counts/suggestions?q=Zebra' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ barcode: string; reasons: string[] }>;
    expect(body[0]?.barcode).toBe('SKU-CC-1');
    expect(body[0]?.reasons.some(r => r.includes('quarantine'))).toBe(true);
  });

  it('creates cycle count task and counts a line', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();
    current.db.insert(products).values({ barcode: 'SKU-CC-2', name: 'Count Item', unit: 'шт', created_at: now, updated_at: now }).run();
    current.db.insert(cells).values({ addr: 'A-CC-2', zone: 'A', type: 'shelf', status: 'free', updated_at: now }).run();
    current.db.insert(stock).values({ barcode: 'SKU-CC-2', cell: 'A-CC-2', qty: 5, updated_at: now }).run();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/cycle-counts',
      payload: {
        task_number: 'CC-001',
        name: 'Count A',
        lines: [{ barcode: 'SKU-CC-2', cell: 'A-CC-2', priority: 80, reason: 'manual' }],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const { id } = createRes.json() as { id: number };

    const doc = current.db.select().from(cycleCounts).where(eq(cycleCounts.id, id)).get();
    expect(doc?.task_number).toBe('CC-001');
    const line = current.db.select().from(cycleCountLines).where(eq(cycleCountLines.cycle_count_id, id)).get()!;

    const countRes = await authedRequest(current.app, token, {
      method: 'PATCH',
      url: `/api/cycle-count-lines/${line.id}/count`,
      payload: { qty_counted: 3 },
    });
    expect(countRes.statusCode).toBe(200);
    const updatedLine = current.db.select().from(cycleCountLines).where(eq(cycleCountLines.id, line.id)).get();
    expect(updatedLine).toMatchObject({ qty_counted: 3, delta: -2, status: 'counted' });
  });

  it('applies cycle count adjustments to stock', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();
    current.db.insert(products).values({ barcode: 'SKU-CC-3', name: 'Adjust Item', unit: 'шт', created_at: now, updated_at: now }).run();
    current.db.insert(cells).values({ addr: 'A-CC-3', zone: 'A', type: 'shelf', status: 'free', updated_at: now }).run();
    current.db.insert(stock).values({ barcode: 'SKU-CC-3', cell: 'A-CC-3', qty: 7, updated_at: now }).run();
    const task = current.db.insert(cycleCounts).values({ task_number: 'CC-002', name: 'Adjust', status: 'active', created_at: now, updated_at: now }).returning({ id: cycleCounts.id }).get()!;
    current.db.insert(cycleCountLines).values({ cycle_count_id: task.id, barcode: 'SKU-CC-3', cell: 'A-CC-3', qty_system: 7, qty_counted: 5, delta: -2, priority: 50, reason: 'manual', status: 'counted', created_at: now, updated_at: now }).run();

    const applyRes = await authedRequest(current.app, token, { method: 'POST', url: `/api/cycle-counts/${task.id}/apply` });
    expect(applyRes.statusCode).toBe(200);
    const row = current.db.select().from(stock).where(sql`${stock.barcode} = 'SKU-CC-3' AND ${stock.cell} = 'A-CC-3'`).get();
    expect(row?.qty).toBe(5);
    const op = current.db.select().from(ops).where(eq(ops.type, 'cycle_adjust')).get();
    expect(op?.barcode).toBe('SKU-CC-3');
  });
});
