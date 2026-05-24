import { ArrowDownToLine, Camera,CheckCircle, Clock, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo,useState } from 'react';

import { toast } from '../App';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { type Cell, db, type Op,type Product, receiveStock } from '../db';
import { productsApi } from '../lib/services';
import { debounce,formatDateTime } from '../utils';

const MAX_SUGGESTIONS = 8;
const MIN_QUERY_LEN = 2;

export default function Receive() {
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('шт');
  const [qty, setQty] = useState('');
  const [cell, setCell] = useState('');
  const [operator, setOperator] = useState('');
  const [batchLot, setBatchLot] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recentReceives, setRecentReceives] = useState<Op[]>([]);
  const [cellSuggestions, setCellSuggestions] = useState<string[]>([]);
  const [productSuggestions, setProductSuggestions] = useState<Pick<Product, 'barcode' | 'name' | 'unit'>[]>([]);
  const [allCells, setAllCells] = useState<Cell[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);

  const refreshRecent = useCallback(async () => {
    const ops = await db.ops.where('type').equals('receive').reverse().sortBy('ts');
    setRecentReceives(ops.slice(0, 20));
  }, []);

  useEffect(() => {
    refreshRecent();
    db.cells.toArray().then(setAllCells);
    db.products.filter(p => !p.deleted).toArray().then(setAllProducts);
    db.settings.get('default_operator').then(s => s?.value && setOperator(s.value));
  }, [refreshRecent]);

  const updateProductSuggestions = useMemo(
    () => debounce((value: string, products: Product[]) => {
      if (value.length < MIN_QUERY_LEN) {
        setProductSuggestions([]);
        return;
      }
      const q = value.toLowerCase();
      const matches = products
        .filter(p => p.barcode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
        .slice(0, MAX_SUGGESTIONS);
      setProductSuggestions(matches);
    }, 120),
    []
  );

  const onBarcodeChange = useCallback((val: string) => {
    setBarcode(val);
    updateProductSuggestions(val, allProducts);
  }, [allProducts, updateProductSuggestions]);

  const selectProduct = (p: Pick<Product, 'barcode' | 'name' | 'unit'>) => {
    setBarcode(p.barcode);
    setName(p.name);
    setUnit(p.unit || 'шт');
    setProductSuggestions([]);
  };

  const updateCellSuggestions = useMemo(
    () => debounce((value: string, cells: Cell[]) => {
      if (value.length < 1) {
        setCellSuggestions([]);
        return;
      }
      const q = value.toLowerCase();
      setCellSuggestions(
        cells
          .filter(c => c.addr.toLowerCase().includes(q) && c.status !== 'blocked' && c.status !== 'quarantine')
          .sort((a, b) => {
            const aPicking = a.is_picking_face ? 1 : 0;
            const bPicking = b.is_picking_face ? 1 : 0;
            if (aPicking !== bPicking) return aPicking - bPicking;
            return (b.putaway_priority || 0) - (a.putaway_priority || 0);
          })
          .slice(0, MAX_SUGGESTIONS)
          .map(c => c.addr)
      );
    }, 120),
    []
  );

  const onCellChange = useCallback((val: string) => {
    setCell(val);
    updateCellSuggestions(val, allCells);
  }, [allCells, updateCellSuggestions]);

  const resetForm = () => {
    setBarcode('');
    setName('');
    setQty('');
    setCell('');
    setNote('');
    setBatchLot('');
    setExpiryDate('');
    setCellSuggestions([]);
    setProductSuggestions([]);
  };

  async function doReceive() {
    if (submitting) return;
    const bc = barcode.trim();
    const qtyNum = Number(qty);
    if (!bc) { toast('error', 'Введите штрихкод'); return; }
    if (!qtyNum || qtyNum <= 0) { toast('error', 'Введите корректное количество'); return; }
    if (!cell.trim()) { toast('error', 'Введите ячейку размещения'); return; }

    setSubmitting(true);
    try {
      // Авто-создание товара, если в справочнике его ещё нет.
      // Через серверный API — чтобы товар появился на всех устройствах сразу.
      const product = await db.products.get(bc);
      if (!product) {
        try {
          await productsApi.upsert({ barcode: bc, name: name.trim() || bc, unit });
          toast('info', `Товар «${name.trim() || bc}» создан автоматически`);
          const fresh = await productsApi.list();
          setAllProducts(fresh.filter(p => !p.deleted));
        } catch (err: any) {
          // Если сервер недоступен — создаём локально как фоллбек
          const now = Date.now();
          await db.products.put({ barcode: bc, name: name.trim() || bc, unit, deleted: false, created_at: now, updated_at: now });
          toast('warning', `Товар создан только локально (сервер недоступен: ${err.message || err})`);
          const refreshed = await db.products.filter(p => !p.deleted).toArray();
          setAllProducts(refreshed);
        }
      }

      const trimmedCell = cell.trim();
      await receiveStock({
        barcode: bc,
        cell: trimmedCell,
        qty: qtyNum,
        operator: operator || undefined,
        lot_number: batchLot.trim() || undefined,
        expiry_date: expiryDate || undefined,
        note: note.trim() || undefined,
      });

      toast('success', `Принято: ${qtyNum} ${unit} → ${trimmedCell}`);
      setQty('');
      setNote('');
      setBatchLot('');
      setExpiryDate('');
      setCellSuggestions([]);
      await refreshRecent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка приёмки';
      toast('error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Form */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-6 flex items-center gap-2">
          <ArrowDownToLine className="text-green-400" size={22} /> Приёмка товара
        </h2>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Barcode */}
          <div className="relative">
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Штрихкод *</label>
            <div className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5">
              <Search size={16} className="text-nexus-text3 flex-shrink-0" />
              <input value={barcode} onChange={e => onBarcodeChange(e.target.value)} placeholder="Сканируйте или введите ШК"
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

          {/* Name */}
          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Наименование</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Автозаполнение из справочника"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          {/* Qty + Unit */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-nexus-text3 mb-1 block">Количество *</label>
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" min="0"
                className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
            </div>
            <div className="w-24">
              <label className="text-xs font-medium text-nexus-text3 mb-1 block">Ед.</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
                <option>шт</option><option>кг</option><option>л</option><option>м</option><option>уп</option>
              </select>
            </div>
          </div>

          {/* Cell */}
          <div className="relative">
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Ячейка размещения *</label>
            <input value={cell} onChange={e => onCellChange(e.target.value)} placeholder="90-118-1"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono" />
            {cellSuggestions.length > 0 && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-nexus-surface2 border border-nexus-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {cellSuggestions.map(a => (
                  <div key={a} onMouseDown={() => { setCell(a); setCellSuggestions([]); }} className="px-3 py-2 cursor-pointer hover:bg-nexus-surface3 text-sm text-nexus-accent2 font-mono border-b border-nexus-border last:border-0">{a}</div>
                ))}
              </div>
            )}
          </div>

          {/* Operator */}
          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Оператор</label>
            <input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Иванов И.И."
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          {/* Batch */}
          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Номер партии</label>
            <input value={batchLot} onChange={e => setBatchLot(e.target.value)} placeholder="LOT-2025-01"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          {/* Expiry */}
          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Срок годности</label>
            <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          {/* Note */}
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Примечание</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий к приёмке"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={doReceive}
            disabled={submitting}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-sm font-bold transition-colors"
          >
            <CheckCircle size={18} /> {submitting ? 'Сохранение…' : 'Принять'}
          </button>
          <button onClick={resetForm} className="px-4 py-3 rounded-xl text-nexus-text3 hover:text-nexus-text text-sm">Очистить</button>
        </div>
      </div>

      {/* Recent */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
        <h3 className="text-nexus-text font-bold text-base mb-4 flex items-center gap-2"><Clock size={18} className="text-nexus-text3" /> Последние приёмки</h3>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {recentReceives.length > 0 ? recentReceives.map(op => (
            <div key={op.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-nexus-surface2 text-sm">
              <span className="text-green-400 font-mono text-xs">{op.barcode}</span>
              <span className="text-nexus-text2 flex-1">{op.note || ''}</span>
              <span className="text-nexus-text font-medium">×{op.qty}</span>
              <span className="text-nexus-text2">→ {op.cell}</span>
              <span className="text-nexus-text3 text-xs">{formatDateTime(op.ts)}</span>
            </div>
          )) : <div className="text-center py-6 text-nexus-text3">Приёмок пока нет</div>}
        </div>
      </div>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={code => { setScannerOpen(false); onBarcodeChange(code); }} />
    </div>
  );
}
