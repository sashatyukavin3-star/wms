import { ArrowUpFromLine, Camera,CheckCircle, Clock, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo,useState } from 'react';

import { toast } from '../App';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { db, type Op,type Product, shipStock, type Stock } from '../db';
import { debounce,formatDateTime } from '../utils';

type StockWithName = Stock & { name?: string };

const MAX_SUGGESTIONS = 8;

export default function Ship() {
  const [barcode, setBarcode] = useState('');
  const [qty, setQty] = useState('');
  const [cell, setCell] = useState('');
  const [operator, setOperator] = useState('');
  const [orderId, setOrderId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stockItems, setStockItems] = useState<StockWithName[]>([]);
  const [recentShips, setRecentShips] = useState<Op[]>([]);
  const [productSuggestions, setProductSuggestions] = useState<Pick<Product, 'barcode' | 'name'>[]>([]);
  const [cellOptions, setCellOptions] = useState<string[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);

  const refreshRecent = useCallback(async () => {
    const ops = await db.ops.where('type').equals('ship').reverse().sortBy('ts');
    setRecentShips(ops.slice(0, 20));
  }, []);

  useEffect(() => {
    refreshRecent();
    db.products.filter(p => !p.deleted).toArray().then(setAllProducts);
    db.settings.get('default_operator').then(s => s?.value && setOperator(s.value));
  }, [refreshRecent]);

  const updateProductSuggestions = useMemo(
    () => debounce((value: string, products: Product[]) => {
      if (value.length < 2) {
        setProductSuggestions([]);
        return;
      }
      const q = value.toLowerCase();
      setProductSuggestions(
        products
          .filter(p => p.barcode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
          .slice(0, MAX_SUGGESTIONS)
      );
    }, 120),
    []
  );

  const onBarcodeChange = useCallback((val: string) => {
    setBarcode(val);
    setCell('');
    setCellOptions([]);
    setStockItems([]);
    updateProductSuggestions(val, allProducts);
  }, [allProducts, updateProductSuggestions]);

  async function loadStock(bc: string) {
    const items = await db.stock.where('barcode').equals(bc).toArray();
    if (items.length === 0) {
      setStockItems([]);
      setCellOptions([]);
      toast('warning', 'Товар не найден на остатках');
      return;
    }
    const products = await db.products.bulkGet(items.map(i => i.barcode));
    const enriched: StockWithName[] = items.map((item, i) => ({ ...item, name: products[i]?.name }));

    // FIFO: сортируем по updated_at по возрастанию (старые остатки — первыми).
    enriched.sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));
    setStockItems(enriched);
    setCellOptions(enriched.map(i => i.cell));
    setCell(enriched[0].cell);
    setQty('');
  }

  function selectProduct(p: Pick<Product, 'barcode' | 'name'>) {
    setBarcode(p.barcode);
    setProductSuggestions([]);
    loadStock(p.barcode);
  }

  async function doShip() {
    if (submitting) return;
    const bc = barcode.trim();
    const qtyNum = Number(qty);
    if (!bc) { toast('error', 'Введите штрихкод'); return; }
    if (!qtyNum || qtyNum <= 0) { toast('error', 'Введите корректное количество'); return; }
    if (!cell.trim()) { toast('error', 'Выберите ячейку'); return; }

    const parsedOrderId = orderId.trim() ? Number(orderId.trim()) : undefined;
    if (orderId.trim() && (parsedOrderId === undefined || Number.isNaN(parsedOrderId))) {
      toast('error', 'ID заказа должен быть числом');
      return;
    }

    setSubmitting(true);
    try {
      await shipStock({
        barcode: bc,
        cell: cell.trim(),
        qty: qtyNum,
        operator: operator || undefined,
        order_id: parsedOrderId,
        note: note.trim() || undefined,
      });
      toast('success', `Отгружено: ${qtyNum} из ${cell.trim()}${parsedOrderId !== undefined ? ` (заказ #${parsedOrderId})` : ''}`);
      setQty('');
      setNote('');
      await refreshRecent();
      await loadStock(bc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка отгрузки';
      toast('error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-6 flex items-center gap-2">
          <ArrowUpFromLine className="text-blue-400" size={22} /> Отгрузка товара
        </h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Штрихкод товара *</label>
            <div className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5">
              <Search size={16} className="text-nexus-text3 flex-shrink-0" />
              <input value={barcode} onChange={e => onBarcodeChange(e.target.value)} placeholder="Сканируйте ШК"
                className="bg-transparent text-nexus-text text-sm flex-1 outline-none font-mono" autoFocus />
              <button type="button" onClick={() => setScannerOpen(true)} className="text-nexus-text3 hover:text-nexus-accent2 flex-shrink-0" title="Сканировать камерой"><Camera size={18} /></button>
            </div>
            {productSuggestions.length > 0 && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-nexus-surface2 border border-nexus-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {productSuggestions.map(p => (
                  <div key={p.barcode} onMouseDown={() => selectProduct(p)} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-nexus-surface3 text-sm border-b border-nexus-border last:border-0">
                    <span className="font-mono text-nexus-accent2 text-xs">{p.barcode}</span>
                    <span className="text-nexus-text flex-1 truncate">{p.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-nexus-text3 mb-1 block">Количество *</label>
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" min="0"
                className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Из ячейки * {cellOptions.length > 1 && <span className="text-nexus-accent">(FIFO)</span>}</label>
            <select value={cell} onChange={e => setCell(e.target.value)} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono">
              <option value="">Выберите ячейку</option>
              {cellOptions.map(c => {
                const stockItem = stockItems.find(s => s.cell === c);
                return <option key={c} value={c}>{c} {stockItem ? `(ост: ${stockItem.qty})` : ''}</option>;
              })}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Заказ №</label>
            <input value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="ID заказа (для авто-учёта)"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Оператор</label>
            <input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Иванов И.И."
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Примечание</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>
        </div>

        {stockItems.length > 0 && (
          <div className="mt-4 bg-nexus-surface2 rounded-xl p-4">
            <h4 className="text-sm font-medium text-nexus-text2 mb-2">Остатки по ячейкам (FIFO):</h4>
            <div className="flex flex-wrap gap-2">
              {stockItems.map(s => (
                <div key={s.cell} className={`px-3 py-1.5 rounded-lg text-sm border ${cell === s.cell ? 'border-nexus-accent bg-nexus-accent/10 text-nexus-accent2' : 'border-nexus-border text-nexus-text2'}`}>
                  <span className="font-mono">{s.cell}</span>: {s.qty}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={doShip}
            disabled={submitting}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-sm font-bold transition-colors"
          >
            <CheckCircle size={18} /> {submitting ? 'Сохранение…' : 'Отгрузить'}
          </button>
        </div>
      </div>

      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
        <h3 className="text-nexus-text font-bold text-base mb-4 flex items-center gap-2"><Clock size={18} className="text-nexus-text3" /> Последние отгрузки</h3>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {recentShips.length > 0 ? recentShips.map(op => (
            <div key={op.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-nexus-surface2 text-sm">
              <span className="text-blue-400 font-mono text-xs">{op.barcode}</span>
              <span className="text-nexus-text font-medium">×{op.qty}</span>
              <span className="text-nexus-text2">← {op.cell}</span>
              {op.order_id !== undefined && <span className="text-nexus-accent text-xs">Заказ #{op.order_id}</span>}
              <span className="text-nexus-text3 text-xs ml-auto">{formatDateTime(op.ts)}</span>
            </div>
          )) : <div className="text-center py-6 text-nexus-text3">Отгрузок пока нет</div>}
        </div>
      </div>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={code => { setScannerOpen(false); onBarcodeChange(code); }} />
    </div>
  );
}
