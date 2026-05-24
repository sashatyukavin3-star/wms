import { ArrowLeftRight, CheckCircle, Clock, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo,useState } from 'react';

import { toast } from '../App';
import { db, moveStock, type Op,type Product } from '../db';
import { debounce,formatDateTime } from '../utils';

const MAX_SUGGESTIONS = 8;

export default function Move() {
  const [barcode, setBarcode] = useState('');
  const [qty, setQty] = useState('');
  const [fromCell, setFromCell] = useState('');
  const [toCell, setToCell] = useState('');
  const [operator, setOperator] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recentMoves, setRecentMoves] = useState<Op[]>([]);
  const [productSuggestions, setProductSuggestions] = useState<Pick<Product, 'barcode' | 'name'>[]>([]);
  const [cellSuggestions, setCellSuggestions] = useState<string[]>([]);
  const [cellTarget, setCellTarget] = useState<string[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allCells, setAllCells] = useState<string[]>([]);
  const [activeField, setActiveField] = useState<'from' | 'to'>('from');

  const refreshRecent = useCallback(async () => {
    const ops = await db.ops.where('type').equals('move').reverse().sortBy('ts');
    setRecentMoves(ops.slice(0, 20));
  }, []);

  useEffect(() => {
    refreshRecent();
    db.products.filter(p => !p.deleted).toArray().then(setAllProducts);
    db.cells.toArray().then(cells => setAllCells(cells.map(c => c.addr).sort()));
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
    updateProductSuggestions(val, allProducts);
  }, [allProducts, updateProductSuggestions]);

  function selectProduct(p: Pick<Product, 'barcode' | 'name'>) {
    setBarcode(p.barcode);
    setProductSuggestions([]);
    loadStockCells(p.barcode);
  }

  async function loadStockCells(bc: string) {
    const items = await db.stock.where('barcode').equals(bc).toArray();
    if (items.length > 0) setFromCell(items[0].cell);
  }

  const updateCellSuggestions = useMemo(
    () => debounce((value: string, field: 'from' | 'to', cells: string[]) => {
      if (value.length < 1) {
        if (field === 'from') setCellSuggestions([]);
        else setCellTarget([]);
        return;
      }
      const q = value.toLowerCase();
      const suggestions = cells.filter(c => c.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
      if (field === 'from') setCellSuggestions(suggestions);
      else setCellTarget(suggestions);
    }, 120),
    []
  );

  const onCellInput = useCallback((val: string, field: 'from' | 'to') => {
    if (field === 'from') setFromCell(val);
    else setToCell(val);
    setActiveField(field);
    updateCellSuggestions(val, field, allCells);
  }, [allCells, updateCellSuggestions]);

  async function doMove() {
    if (submitting) return;
    const bc = barcode.trim();
    const qtyNum = Number(qty);
    const from = fromCell.trim();
    const to = toCell.trim();
    if (!bc) { toast('error', 'Введите штрихкод'); return; }
    if (!qtyNum || qtyNum <= 0) { toast('error', 'Введите корректное количество'); return; }
    if (!from) { toast('error', 'Введите исходную ячейку'); return; }
    if (!to) { toast('error', 'Введите целевую ячейку'); return; }
    if (from === to) { toast('error', 'Ячейки совпадают'); return; }

    setSubmitting(true);
    try {
      await moveStock({
        barcode: bc,
        from,
        to,
        qty: qtyNum,
        operator: operator || undefined,
        note: note.trim() || undefined,
      });
      toast('success', `Перемещено: ${qtyNum} из ${from} → ${to}`);
      setQty('');
      setNote('');
      await refreshRecent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка перемещения';
      toast('error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <h2 className="text-nexus-text font-bold text-lg mb-6 flex items-center gap-2">
          <ArrowLeftRight className="text-amber-400" size={22} /> Перемещение товара
        </h2>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Штрихкод *</label>
            <div className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5">
              <Search size={16} className="text-nexus-text3 flex-shrink-0" />
              <input value={barcode} onChange={e => onBarcodeChange(e.target.value)} placeholder="Сканируйте ШК"
                className="bg-transparent text-nexus-text text-sm flex-1 outline-none font-mono" autoFocus />
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

          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Количество *</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" min="0"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          <div className="relative">
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Из ячейки *</label>
            <input value={fromCell} onChange={e => onCellInput(e.target.value, 'from')} placeholder="90-118-1"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono" />
            {cellSuggestions.length > 0 && activeField === 'from' && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-nexus-surface2 border border-nexus-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {cellSuggestions.map(a => (
                  <div key={a} onMouseDown={() => { setFromCell(a); setCellSuggestions([]); }} className="px-3 py-2 cursor-pointer hover:bg-nexus-surface3 text-sm font-mono text-nexus-accent2">{a}</div>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">В ячейку *</label>
            <input value={toCell} onChange={e => onCellInput(e.target.value, 'to')} placeholder="90-119-1"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono" />
            {cellTarget.length > 0 && activeField === 'to' && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-nexus-surface2 border border-nexus-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {cellTarget.map(a => (
                  <div key={a} onMouseDown={() => { setToCell(a); setCellTarget([]); }} className="px-3 py-2 cursor-pointer hover:bg-nexus-surface3 text-sm font-mono text-nexus-accent2">{a}</div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Оператор</label>
            <input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Иванов И.И."
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-nexus-text3 mb-1 block">Примечание</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Причина перемещения"
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={doMove}
            disabled={submitting}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-sm font-bold transition-colors"
          >
            <CheckCircle size={18} /> {submitting ? 'Сохранение…' : 'Переместить'}
          </button>
        </div>
      </div>

      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
        <h3 className="text-nexus-text font-bold text-base mb-4 flex items-center gap-2"><Clock size={18} className="text-nexus-text3" /> Последние перемещения</h3>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {recentMoves.length > 0 ? recentMoves.map(op => (
            <div key={op.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-nexus-surface2 text-sm">
              <span className="text-amber-400 font-mono text-xs">{op.barcode}</span>
              <span className="text-nexus-text font-medium">×{op.qty}</span>
              <span className="text-nexus-text2">{op.source_cell} → {op.target_cell}</span>
              <span className="text-nexus-text3 text-xs ml-auto">{formatDateTime(op.ts)}</span>
            </div>
          )) : <div className="text-center py-6 text-nexus-text3">Перемещений пока нет</div>}
        </div>
      </div>
    </div>
  );
}
