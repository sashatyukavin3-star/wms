import { createContext, type ReactNode,useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Cell, Product, Stock } from '../db';
import { getToken } from '../lib/api';
import { cellsApi, productsApi, settingsApi,stockApi } from '../lib/services';
import { subscribe } from '../lib/ws';

export interface DataCache {
  products: Product[];
  cells: Cell[];
  stock: Stock[];
  warehouseName: string;
  defaultOperator: string;
  loading: boolean;
  refresh: () => Promise<void>;
  getProduct: (barcode: string) => Product | undefined;
  getCell: (addr: string) => Cell | undefined;
  getStockByBarcode: (barcode: string) => Stock[];
  getStockByCell: (cell: string) => Stock[];
  getTotalQty: (barcode: string) => number;
  searchProducts: (q: string, limit?: number) => Product[];
  searchCells: (q: string, limit?: number) => Cell[];
}

const DataContext = createContext<DataCache | null>(null);

/**
 * Источник данных для всего UI.
 * Тянет /api/products, /api/cells, /api/stock с сервера.
 * Слушает WS-события — при изменении подкачивает «дельту» по updated_at,
 * чтобы не гонять всю базу.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [stockRows, setStockRows] = useState<Stock[]>([]);
  const [warehouseName, setWarehouseName] = useState('');
  const [defaultOperator, setDefaultOperator] = useState('');
  const [loading, setLoading] = useState(true);

  // ─── Full reload (после логина / явного refresh) ──────────
  const fullReload = useCallback(async () => {
    if (!getToken()) {
      setProducts([]); setCells([]); setStockRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [p, c, s, settings] = await Promise.all([
        productsApi.list(),
        cellsApi.list(),
        stockApi.list(),
        settingsApi.getAll().catch(() => ({} as Record<string, string>)),
      ]);
      setProducts(p);
      setCells(c);
      setStockRows(s);
      setWarehouseName(settings.warehouse_name || '');
      setDefaultOperator(settings.default_operator || '');
    } catch (e) {
      console.warn('Не удалось загрузить данные с сервера:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Delta reload по WS-событию ───────────────────────────
  const reloadProducts = useCallback(async () => {
    try {
      const fresh = await productsApi.list();
      setProducts(fresh.filter(p => !p.deleted));
    } catch { /* noop */ }
  }, []);

  const reloadCells = useCallback(async () => {
    try {
      const fresh = await cellsApi.list();
      setCells(fresh.filter(c => !c.deleted));
    } catch { /* noop */ }
  }, []);

  const reloadStock = useCallback(async () => {
    try { setStockRows(await stockApi.list()); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    fullReload();
    const off = subscribe(evt => {
      // По разным сигналам подкачиваем нужное
      if (evt.type === 'product:changed') reloadProducts();
      else if (evt.type === 'cell:changed') reloadCells();
      else if (evt.type === 'stock:changed') reloadStock();
      else if (evt.type === 'welcome') fullReload(); // переподключились
    });
    return off;
  }, [fullReload, reloadProducts, reloadCells, reloadStock]);

  const refresh = fullReload;

  // ─── Производные кэши ──────────────────────────────────────
  const productMap = useMemo(() => new Map(products.map(p => [p.barcode, p])), [products]);
  const cellMap = useMemo(() => new Map(cells.map(c => [c.addr, c])), [cells]);

  const stockByBarcode = useMemo(() => {
    const m = new Map<string, Stock[]>();
    for (const s of stockRows) { const a = m.get(s.barcode); if (a) a.push(s); else m.set(s.barcode, [s]); }
    return m;
  }, [stockRows]);

  const stockByCell = useMemo(() => {
    const m = new Map<string, Stock[]>();
    for (const s of stockRows) { const a = m.get(s.cell); if (a) a.push(s); else m.set(s.cell, [s]); }
    return m;
  }, [stockRows]);

  const getProduct = useCallback((bc: string) => productMap.get(bc), [productMap]);
  const getCell = useCallback((addr: string) => cellMap.get(addr), [cellMap]);
  const getStockByBarcode = useCallback((bc: string) => stockByBarcode.get(bc) || [], [stockByBarcode]);
  const getStockByCell = useCallback((cell: string) => stockByCell.get(cell) || [], [stockByCell]);
  const getTotalQty = useCallback((bc: string) => (stockByBarcode.get(bc) || []).reduce((s, r) => s + r.qty, 0), [stockByBarcode]);

  const searchProducts = useCallback((q: string, limit = 10) => {
    if (q.length < 1) return [];
    const ql = q.toLowerCase();
    const res: Product[] = [];
    for (const p of products) {
      if (p.barcode.toLowerCase().includes(ql) || p.name.toLowerCase().includes(ql) || (p.category || '').toLowerCase().includes(ql)) {
        res.push(p);
        if (res.length >= limit) break;
      }
    }
    return res;
  }, [products]);

  const searchCells = useCallback((q: string, limit = 10) => {
    if (q.length < 1) return [];
    const ql = q.toLowerCase();
    const res: Cell[] = [];
    for (const c of cells) {
      if (c.addr.toLowerCase().includes(ql) || (c.zone || '').toLowerCase().includes(ql)) {
        res.push(c);
        if (res.length >= limit) break;
      }
    }
    return res;
  }, [cells]);

  const value: DataCache = {
    products, cells, stock: stockRows, warehouseName, defaultOperator, loading, refresh,
    getProduct, getCell, getStockByBarcode, getStockByCell, getTotalQty,
    searchProducts, searchCells,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataCache {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be inside DataProvider');
  return ctx;
}
