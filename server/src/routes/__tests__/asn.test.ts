import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { asnLines, asns, ops, stock } from '../../db/schema.ts';
import { authedRequest, createTestServer } from '../../test/createTestServer.ts';

describe('ASN routes', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('creates ASN and lines', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/asn',
      payload: { asn_number: 'ASN-001', supplier: 'ООО Поставщик', eta_date: '2026-05-25', note: 'Тестовая поставка' },
    });
    expect(createRes.statusCode).toBe(200);
    const { id } = createRes.json() as { id: number };

    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/lines`,
      payload: { barcode: 'SKU-1', qty_expected: 12, note: 'Коробки' },
    });
    expect(lineRes.statusCode).toBe(200);

    const detailRes = await authedRequest(current.app, token, {
      method: 'GET',
      url: `/api/asn/${id}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json() as { asn_number: string; supplier: string; lines: Array<{ barcode: string; qty_expected: number }> };
    expect(detail.asn_number).toBe('ASN-001');
    expect(detail.supplier).toBe('ООО Поставщик');
    expect(detail.lines[0]).toMatchObject({ barcode: 'SKU-1', qty_expected: 12 });
  });

  it('marks ASN arrived and receives line into stock', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/asn',
      payload: { asn_number: 'ASN-002', supplier: 'ООО Поставка' },
    });
    const { id } = createRes.json() as { id: number };

    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/lines`,
      payload: { barcode: 'SKU-2', qty_expected: 10 },
    });
    const { id: lineId } = lineRes.json() as { id: number };

    const arrivedRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/mark-arrived`,
    });
    expect(arrivedRes.statusCode).toBe(200);

    const receiveRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/receive`,
      payload: { line_id: lineId, cell: 'A-01-01', qty: 6, operator: 'admin', note: 'Частичная приёмка' },
    });
    expect(receiveRes.statusCode).toBe(200);

    const line = current.db.select().from(asnLines).where(eq(asnLines.id, lineId)).get();
    const doc = current.db.select().from(asns).where(eq(asns.id, id)).get();
    const stockRow = current.db.select().from(stock).where(sql`${stock.barcode} = 'SKU-2' AND ${stock.cell} = 'A-01-01'`).get();
    const opRow = current.db.select().from(ops).where(sql`${ops.barcode} = 'SKU-2'`).get();

    expect(line).toMatchObject({ qty_received: 6, qty_damaged: 0, status: 'partial', qc_status: 'accepted' });
    expect(doc?.status).toBe('receiving');
    expect(stockRow?.qty).toBe(6);
    expect(opRow?.type).toBe('receive');
  });

  it('completes ASN when all lines are fully received', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/asn',
      payload: { asn_number: 'ASN-003' },
    });
    const { id } = createRes.json() as { id: number };

    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/lines`,
      payload: { barcode: 'SKU-3', qty_expected: 4 },
    });
    const { id: lineId } = lineRes.json() as { id: number };

    await authedRequest(current.app, token, { method: 'POST', url: `/api/asn/${id}/mark-arrived` });
    const receiveRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/receive`,
      payload: { line_id: lineId, cell: 'B-02-01', qty: 4 },
    });
    expect(receiveRes.statusCode).toBe(200);

    const doc = current.db.select().from(asns).where(eq(asns.id, id)).get();
    const line = current.db.select().from(asnLines).where(eq(asnLines.id, lineId)).get();
    expect(line).toMatchObject({ qty_received: 4, qty_damaged: 0, status: 'received', qc_status: 'accepted' });
    expect(doc?.status).toBe('completed');
  });

  it('stores damaged quantity and discrepancy reason without adding damaged stock', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const createRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: '/api/asn',
      payload: { asn_number: 'ASN-004', supplier: 'ООО QC' },
    });
    const { id } = createRes.json() as { id: number };

    const lineRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/lines`,
      payload: { barcode: 'SKU-4', qty_expected: 5 },
    });
    const { id: lineId } = lineRes.json() as { id: number };

    await authedRequest(current.app, token, { method: 'POST', url: `/api/asn/${id}/mark-arrived` });
    const receiveRes = await authedRequest(current.app, token, {
      method: 'POST',
      url: `/api/asn/${id}/receive`,
      payload: {
        line_id: lineId,
        cell: 'C-03-01',
        qty: 3,
        damaged_qty: 2,
        discrepancy_reason: 'Повреждена упаковка',
      },
    });
    expect(receiveRes.statusCode).toBe(200);

    const line = current.db.select().from(asnLines).where(eq(asnLines.id, lineId)).get();
    const stockRow = current.db.select().from(stock).where(sql`${stock.barcode} = 'SKU-4' AND ${stock.cell} = 'C-03-01'`).get();
    const doc = current.db.select().from(asns).where(eq(asns.id, id)).get();

    expect(line).toMatchObject({
      qty_received: 3,
      qty_damaged: 2,
      discrepancy_reason: 'Повреждена упаковка',
      status: 'issue',
      qc_status: 'accepted_with_issue',
    });
    expect(stockRow?.qty).toBe(3);
    expect(doc?.status).toBe('completed');
  });
});
