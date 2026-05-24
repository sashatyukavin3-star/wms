import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cells, returnDocs, returnLines, stock } from '../../db/schema.ts';
import { authedRequest, createTestServer } from '../../test/createTestServer.ts';

describe('Returns routes', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('creates return doc and lines', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/returns',
      payload: { return_number: 'RET-001', customer: 'ООО Клиент', reason: 'Клиентский возврат' },
    });
    expect(createRes.statusCode).toBe(200);
    const { id } = createRes.json() as { id: number };

    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/returns/${id}/lines`,
      payload: { barcode: 'SKU-RET-1', qty_expected: 3, disposition: 'restock' },
    });
    expect(lineRes.statusCode).toBe(200);

    const detailRes = await authedRequest(current.app, token, {
      method: 'GET',
      url: `/api/returns/${id}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const body = detailRes.json() as { return_number: string; lines: Array<{ barcode: string }> };
    expect(body.return_number).toBe('RET-001');
    expect(body.lines[0]?.barcode).toBe('SKU-RET-1');
  });

  it('processes return to restock cell', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();
    current.db.insert(cells).values({ addr: 'R-01-01', type: 'shelf', status: 'free', updated_at: now }).run();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/returns',
      payload: { return_number: 'RET-002' },
    });
    const { id } = createRes.json() as { id: number };
    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/returns/${id}/lines`,
      payload: { barcode: 'SKU-RET-2', qty_expected: 4, disposition: 'restock' },
    });
    const { id: lineId } = lineRes.json() as { id: number };

    const processRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/returns/${id}/process`,
      payload: { line_id: lineId, qty: 4, disposition: 'restock', cell: 'R-01-01' },
    });
    expect(processRes.statusCode).toBe(200);

    const line = current.db.select().from(returnLines).where(eq(returnLines.id, lineId)).get();
    const doc = current.db.select().from(returnDocs).where(eq(returnDocs.id, id)).get();
    const row = current.db.select().from(stock).where(sql`${stock.barcode} = 'SKU-RET-2' AND ${stock.cell} = 'R-01-01'`).get();
    expect(line).toMatchObject({ qty_received: 4, qty_restocked: 4, status: 'processed', disposition: 'restock' });
    expect(doc?.status).toBe('completed');
    expect(row?.qty).toBe(4);
  });

  it('processes return to quarantine cell', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();
    current.db.insert(cells).values({ addr: 'Q-01-01', type: 'shelf', status: 'quarantine', updated_at: now }).run();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/returns',
      payload: { return_number: 'RET-003' },
    });
    const { id } = createRes.json() as { id: number };
    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/returns/${id}/lines`,
      payload: { barcode: 'SKU-RET-3', qty_expected: 2, disposition: 'quarantine' },
    });
    const { id: lineId } = lineRes.json() as { id: number };

    const processRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/returns/${id}/process`,
      payload: { line_id: lineId, qty: 2, disposition: 'quarantine', cell: 'Q-01-01', reason: 'Повреждена упаковка' },
    });
    expect(processRes.statusCode).toBe(200);

    const line = current.db.select().from(returnLines).where(eq(returnLines.id, lineId)).get();
    const row = current.db.select().from(stock).where(sql`${stock.barcode} = 'SKU-RET-3' AND ${stock.cell} = 'Q-01-01'`).get();
    expect(line).toMatchObject({ qty_received: 2, qty_quarantined: 2, status: 'issue', disposition: 'quarantine' });
    expect(row?.qty).toBe(2);
  });

  it('processes return to scrap without stock movement', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/returns',
      payload: { return_number: 'RET-004' },
    });
    const { id } = createRes.json() as { id: number };
    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/returns/${id}/lines`,
      payload: { barcode: 'SKU-RET-4', qty_expected: 1, disposition: 'scrap' },
    });
    const { id: lineId } = lineRes.json() as { id: number };

    const processRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/returns/${id}/process`,
      payload: { line_id: lineId, qty: 1, disposition: 'scrap', reason: 'Непригодно к продаже' },
    });
    expect(processRes.statusCode).toBe(200);

    const line = current.db.select().from(returnLines).where(eq(returnLines.id, lineId)).get();
    const anyStock = current.db.select().from(stock).all().find(row => row.barcode === 'SKU-RET-4');
    expect(line).toMatchObject({ qty_received: 1, qty_scrapped: 1, status: 'issue', disposition: 'scrap' });
    expect(anyStock).toBeUndefined();
  });
});
