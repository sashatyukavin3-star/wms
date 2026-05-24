import { afterEach, describe, expect, it } from 'vitest';

import { asns, cells, orders, products, returnDocs } from '../../db/schema.ts';
import { authedRequest, createTestServer } from '../../test/createTestServer.ts';

describe('Global search route', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('searches across products, cells, orders, ASN and returns', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();
    const now = Date.now();

    current.db.insert(products).values({ barcode: 'SKU-SEARCH-X', name: 'Zebra Device', unit: 'шт', created_at: now, updated_at: now }).run();
    current.db.insert(cells).values({ addr: 'ZX-01-01', zone: 'ZX', type: 'shelf', status: 'free', updated_at: now }).run();
    current.db.insert(orders).values({ ext_id: 'ZX-ORDER', customer: 'Zebra Client', status: 'new', created_at: now, updated_at: now }).run();
    current.db.insert(asns).values({ asn_number: 'ASN-ZX', supplier: 'Zebra Supplier', status: 'draft', created_at: now, updated_at: now }).run();
    current.db.insert(returnDocs).values({ return_number: 'RET-ZX', customer: 'Zebra Client', status: 'draft', created_at: now, updated_at: now }).run();

    const res = await authedRequest(current.app, token, { method: 'GET', url: '/api/search/global?q=Zebra&limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ page: string; title: string }>;
    expect(body.some(item => item.page === 'products')).toBe(true);
    expect(body.some(item => item.page === 'orders')).toBe(true);
    expect(body.some(item => item.page === 'asn')).toBe(true);
    expect(body.some(item => item.page === 'returns')).toBe(true);
  });
});
