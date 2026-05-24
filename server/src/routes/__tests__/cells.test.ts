import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cells } from '../../db/schema.ts';
import { authedRequest, createTestServer } from '../../test/createTestServer.ts';

describe('Cells routes', () => {
  let current: Awaited<ReturnType<typeof createTestServer>> | null = null;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = null;
    }
  });

  it('stores extended bin properties', async () => {
    current = await createTestServer();
    const token = await current.loginAsAdmin();

    const res = await authedRequest(current.app, token, {
      method: 'PUT',
      url: '/api/cells',
      payload: {
        addr: 'P-01-01',
        zone: 'P',
        row: '01',
        level: '01',
        type: 'shelf',
        status: 'free',
        max_pallets: 2,
        max_weight: 800,
        max_units: 120,
        allow_mixed_sku: false,
        pick_priority: 90,
        putaway_priority: 10,
        is_picking_face: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const row = current.db.select().from(cells).where(eq(cells.addr, 'P-01-01')).get();
    expect(row).toMatchObject({
      max_units: 120,
      allow_mixed_sku: false,
      pick_priority: 90,
      putaway_priority: 10,
      is_picking_face: true,
    });
  });
});
