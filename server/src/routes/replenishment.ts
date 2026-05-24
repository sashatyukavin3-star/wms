import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/index.ts';
import { cells, ops, products, reservations, stock } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { broadcast } from '../ws/hub.ts';

interface ReplenishmentSuggestion {
  barcode: string;
  name: string;
  min_stock: number;
  target_qty: number;
  current_pick_qty: number;
  available_source_qty: number;
  suggested_qty: number;
  destination_cell: string;
  destination_capacity_left: number | null;
  source_options: Array<{ cell: string; available_qty: number }>;
  reason: string;
}

function reservedMap() {
  const map = new Map<string, number>();
  const rows = db.select().from(reservations).all();
  for (const row of rows) {
    const key = `${row.barcode}@@${row.cell}`;
    map.set(key, (map.get(key) || 0) + row.qty);
  }
  return map;
}

function buildSuggestions(filterBarcode?: string): ReplenishmentSuggestion[] {
  const allProducts = db.select().from(products).all().filter(product => !product.deleted);
  const allCells = db.select().from(cells).all().filter(cell => !cell.deleted);
  const allStock = db.select().from(stock).all();
  const reservedByBarcodeCell = reservedMap();

  const cellMap = new Map(allCells.map(cell => [cell.addr, cell]));
  const stockByBarcode = new Map<string, typeof allStock>();
  const stockByCell = new Map<string, typeof allStock>();

  for (const row of allStock) {
    const byBarcode = stockByBarcode.get(row.barcode);
    if (byBarcode) byBarcode.push(row);
    else stockByBarcode.set(row.barcode, [row]);

    const byCell = stockByCell.get(row.cell);
    if (byCell) byCell.push(row);
    else stockByCell.set(row.cell, [row]);
  }

  const suggestions: ReplenishmentSuggestion[] = [];

  for (const product of allProducts) {
    if (filterBarcode && product.barcode !== filterBarcode) continue;
    const minStock = product.min_stock || 0;
    if (minStock <= 0) continue;

    const targetQty = Math.max(minStock, product.max_stock || minStock);
    const rows = stockByBarcode.get(product.barcode) || [];

    const pickRows = rows.filter(row => cellMap.get(row.cell)?.is_picking_face);
    const currentPickQty = pickRows.reduce((sum, row) => sum + row.qty, 0);
    if (currentPickQty >= minStock) continue;

    const destinationCandidates = allCells
      .filter(cell => cell.is_picking_face && cell.status !== 'blocked' && cell.status !== 'quarantine')
      .map(cell => {
        const currentRows = stockByCell.get(cell.addr) || [];
        const currentTotal = currentRows.reduce((sum, row) => sum + row.qty, 0);
        const foreignSkus = currentRows.filter(row => row.barcode !== product.barcode);
        const canStore = cell.allow_mixed_sku !== false || foreignSkus.length === 0;
        const capacityLeft = typeof cell.max_units === 'number' ? Math.max(0, cell.max_units - currentTotal) : null;
        const containsSkuAlready = currentRows.some(row => row.barcode === product.barcode);
        return { cell, canStore, capacityLeft, containsSkuAlready };
      })
      .filter(candidate => candidate.canStore)
      .sort((a, b) => {
        const existingDelta = Number(b.containsSkuAlready) - Number(a.containsSkuAlready);
        if (existingDelta !== 0) return existingDelta;
        const prioDelta = (b.cell.pick_priority || 0) - (a.cell.pick_priority || 0);
        if (prioDelta !== 0) return prioDelta;
        return a.cell.addr.localeCompare(b.cell.addr, 'ru', { numeric: true });
      });

    const destination = destinationCandidates[0];
    if (!destination) continue;

    const sourceOptions = rows
      .filter(row => row.cell !== destination.cell.addr)
      .filter(row => !cellMap.get(row.cell)?.is_picking_face)
      .filter(row => {
        const sourceCell = cellMap.get(row.cell);
        return sourceCell && sourceCell.status !== 'blocked' && sourceCell.status !== 'quarantine';
      })
      .map(row => {
        const key = `${row.barcode}@@${row.cell}`;
        const reserved = reservedByBarcodeCell.get(key) || 0;
        return {
          cell: row.cell,
          available_qty: Math.max(0, row.qty - reserved),
        };
      })
      .filter(option => option.available_qty > 0)
      .sort((a, b) => b.available_qty - a.available_qty);

    if (sourceOptions.length === 0) continue;

    const availableSourceQty = sourceOptions.reduce((sum, option) => sum + option.available_qty, 0);
    let suggestedQty = Math.max(0, targetQty - currentPickQty);
    suggestedQty = Math.min(suggestedQty, availableSourceQty);
    if (destination.capacityLeft !== null) suggestedQty = Math.min(suggestedQty, destination.capacityLeft);
    if (suggestedQty <= 0) continue;

    suggestions.push({
      barcode: product.barcode,
      name: product.name,
      min_stock: minStock,
      target_qty: targetQty,
      current_pick_qty: currentPickQty,
      available_source_qty: availableSourceQty,
      suggested_qty: suggestedQty,
      destination_cell: destination.cell.addr,
      destination_capacity_left: destination.capacityLeft,
      source_options: sourceOptions,
      reason: currentPickQty === 0 ? 'pick-face empty' : 'pick-face below minimum',
    });
  }

  return suggestions.sort((a, b) => {
    const deficitA = a.target_qty - a.current_pick_qty;
    const deficitB = b.target_qty - b.current_pick_qty;
    return deficitB - deficitA || a.name.localeCompare(b.name, 'ru');
  });
}

export async function replenishmentRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { barcode?: string } }>('/api/replenishment/suggestions', { preHandler: requireAuth }, async req => {
    return buildSuggestions(req.query.barcode);
  });

  app.post('/api/replenishment/execute', { preHandler: requireRole('operator') }, async (req, reply) => {
    const parsed = z.object({
      barcode: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      qty: z.number().int().positive(),
      operator: z.string().optional(),
      note: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Неверные параметры', details: parsed.error.errors });
    const data = parsed.data;
    if (data.from === data.to) return reply.code(400).send({ error: 'Исходная и целевая ячейки совпадают' });

    const sourceCell = db.select().from(cells).where(eq(cells.addr, data.from)).get();
    const targetCell = db.select().from(cells).where(eq(cells.addr, data.to)).get();
    if (!sourceCell || !targetCell) return reply.code(404).send({ error: 'Одна из ячеек не найдена' });
    if (!targetCell.is_picking_face) return reply.code(400).send({ error: 'Целевая ячейка не является picking-face' });
    if (sourceCell.status === 'blocked' || sourceCell.status === 'quarantine') return reply.code(400).send({ error: 'Исходная ячейка недоступна' });
    if (targetCell.status === 'blocked' || targetCell.status === 'quarantine') return reply.code(400).send({ error: 'Целевая ячейка недоступна' });

    const sourceRow = db.select().from(stock).where(eq(stock.barcode, data.barcode)).all().find(row => row.cell === data.from);
    if (!sourceRow || sourceRow.qty < data.qty) return reply.code(400).send({ error: 'Недостаточно остатков в исходной ячейке' });

    const reserved = db.select().from(reservations).where(eq(reservations.barcode, data.barcode)).all()
      .filter(row => row.cell === data.from)
      .reduce((sum, row) => sum + row.qty, 0);
    const available = Math.max(0, sourceRow.qty - reserved);
    if (available < data.qty) return reply.code(400).send({ error: `Недостаточно свободного остатка в исходной ячейке (${available})` });

    const targetRows = db.select().from(stock).all().filter(row => row.cell === data.to);
    const foreignSkuRows = targetRows.filter(row => row.barcode !== data.barcode);
    if (targetCell.allow_mixed_sku === false && foreignSkuRows.length > 0) {
      return reply.code(400).send({ error: 'Целевая ячейка не допускает mixed SKU' });
    }
    if (typeof targetCell.max_units === 'number') {
      const currentUnits = targetRows.reduce((sum, row) => sum + row.qty, 0);
      if (currentUnits + data.qty > targetCell.max_units) {
        return reply.code(400).send({ error: 'Недостаточно ёмкости в целевой ячейке' });
      }
    }

    db.transaction(() => {
      const now = Date.now();
      if (sourceRow.qty === data.qty) {
        db.delete(stock).where(sql`${stock.barcode} = ${data.barcode} AND ${stock.cell} = ${data.from}`).run();
      } else {
        db.update(stock).set({ qty: sourceRow.qty - data.qty, updated_at: now })
          .where(sql`${stock.barcode} = ${data.barcode} AND ${stock.cell} = ${data.from}`).run();
      }

      const targetExisting = db.select().from(stock).all().find(row => row.barcode === data.barcode && row.cell === data.to);
      if (targetExisting) {
        db.update(stock).set({ qty: targetExisting.qty + data.qty, updated_at: now })
          .where(sql`${stock.barcode} = ${data.barcode} AND ${stock.cell} = ${data.to}`).run();
      } else {
        db.insert(stock).values({
          barcode: data.barcode,
          cell: data.to,
          qty: data.qty,
          batch_id: sourceRow.batch_id,
          expiry_date: sourceRow.expiry_date,
          updated_at: now,
        }).run();
      }

      db.insert(ops).values({
        type: 'replenish',
        barcode: data.barcode,
        source_cell: data.from,
        target_cell: data.to,
        qty: data.qty,
        operator: data.operator || req.user!.username,
        note: data.note || 'Replenishment to picking-face',
      }).run();
    });

    writeAudit({ user_id: req.user!.id, username: req.user!.username, ip: req.ip }, {
      action: 'replenish',
      entity: 'stock',
      entity_id: data.barcode,
      details: { from: data.from, to: data.to, qty: data.qty },
    });
    broadcast({ type: 'stock:changed', barcode: data.barcode });
    broadcast({ type: 'op:created', op_type: 'replenish' });
    return { ok: true };
  });
}
