import { PackageCheck, Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { toast } from '../App';
import type { Product, ReturnDoc, ReturnLine } from '../db';
import { useData } from '../hooks/useData';
import { returnsApi } from '../lib/services';
import { subscribeType } from '../lib/ws';
import { formatDateTime } from '../utils';

const STATUS_LABELS: Record<ReturnDoc['status'], string> = {
  draft: 'Черновик',
  received: 'Получен',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

const STATUS_COLORS: Record<ReturnDoc['status'], string> = {
  draft: 'bg-blue-900/40 text-blue-400',
  received: 'bg-amber-900/40 text-amber-300',
  completed: 'bg-green-900/40 text-green-400',
  cancelled: 'bg-red-900/40 text-red-400',
};

export default function ReturnsPage() {
  const [items, setItems] = useState<ReturnDoc[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | ReturnDoc['status']>('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ return_number: '', order_id: '', customer: '', reason: '', note: '' });
  const [selected, setSelected] = useState<ReturnDoc | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [lineForm, setLineForm] = useState({ barcode: '', qty_expected: '', disposition: 'restock' as ReturnLine['disposition'], note: '', reason: '' });
  const [productSuggestions, setProductSuggestions] = useState<Product[]>([]);
  const [processTarget, setProcessTarget] = useState<ReturnLine | null>(null);
  const [processForm, setProcessForm] = useState({ qty: '', disposition: 'restock' as ReturnLine['disposition'], cell: '', operator: '', note: '', reason: '' });
  const { products: allProducts, cells: allCells } = useData();

  async function load() {
    try {
      const fresh = await returnsApi.list(filterStatus ? { status: filterStatus } : undefined);
      let result = fresh;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        result = result.filter(item => item.return_number.toLowerCase().includes(q) || (item.customer || '').toLowerCase().includes(q) || String(item.id).includes(q));
      }
      setItems(result);
      if (selected?.id) {
        const detail = await returnsApi.get(selected.id);
        const { lines, ...doc } = detail;
        setSelected(doc);
        setLines(lines);
      }
    } catch (e: any) {
      toast('error', `Не удалось загрузить возвраты: ${e.message || e}`);
    }
  }

  useEffect(() => { load(); }, [filterStatus, search]);
  useEffect(() => subscribeType('return:changed', () => { load(); }), [selected?.id, filterStatus, search]);

  function openCreate() {
    setForm({ return_number: '', order_id: '', customer: '', reason: '', note: '' });
    setShowCreate(true);
  }

  async function saveReturn() {
    if (!form.return_number.trim()) { toast('error', 'Введите номер возврата'); return; }
    setBusy(true);
    try {
      await returnsApi.create({
        return_number: form.return_number.trim(),
        order_id: form.order_id ? Number(form.order_id) : undefined,
        customer: form.customer.trim() || undefined,
        reason: form.reason.trim() || undefined,
        note: form.note.trim() || undefined,
      });
      toast('success', 'Документ возврата создан');
      setShowCreate(false);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось создать возврат');
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(item: ReturnDoc) {
    try {
      const detail = await returnsApi.get(item.id!);
      const { lines, ...doc } = detail;
      setSelected(doc);
      setLines(lines);
      setProcessTarget(null);
    } catch (e: any) {
      toast('error', e.message || 'Не удалось открыть возврат');
    }
  }

  async function deleteReturn(id: number) {
    if (!confirm('Удалить документ возврата?')) return;
    try {
      await returnsApi.remove(id);
      if (selected?.id === id) { setSelected(null); setLines([]); }
      toast('info', 'Возврат удалён');
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось удалить возврат');
    }
  }

  function onBarcodeInput(value: string) {
    setLineForm(prev => ({ ...prev, barcode: value }));
    if (value.trim().length < 2) {
      setProductSuggestions([]);
      return;
    }
    const q = value.toLowerCase();
    setProductSuggestions(allProducts.filter(p => p.barcode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 8));
  }

  async function addLine() {
    if (!selected?.id) return;
    const qtyExpected = Number(lineForm.qty_expected);
    if (!lineForm.barcode.trim()) { toast('error', 'Введите штрихкод'); return; }
    if (!qtyExpected || qtyExpected <= 0) { toast('error', 'Введите корректное количество'); return; }
    try {
      await returnsApi.addLine(selected.id, {
        barcode: lineForm.barcode.trim(),
        qty_expected: qtyExpected,
        disposition: lineForm.disposition,
        note: lineForm.note.trim() || undefined,
        reason: lineForm.reason.trim() || undefined,
      });
      setLineForm({ barcode: '', qty_expected: '', disposition: 'restock', note: '', reason: '' });
      setProductSuggestions([]);
      toast('success', 'Строка возврата добавлена');
      await openDetail(selected);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось добавить строку');
    }
  }

  async function removeLine(id: number) {
    try {
      await returnsApi.removeLine(id);
      toast('info', 'Строка возврата удалена');
      if (selected) await openDetail(selected);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось удалить строку');
    }
  }

  function prepareProcess(line: ReturnLine) {
    setProcessTarget(line);
    setProcessForm({ qty: String(Math.max(1, line.qty_expected - line.qty_received)), disposition: line.disposition, cell: '', operator: '', note: '', reason: line.reason || '' });
  }

  async function processLine() {
    if (!selected?.id || !processTarget?.id) return;
    const qty = Number(processForm.qty);
    if (!qty || qty <= 0) { toast('error', 'Введите корректное количество'); return; }
    if (processForm.disposition !== 'scrap' && !processForm.cell.trim()) { toast('error', 'Укажи ячейку'); return; }
    try {
      await returnsApi.process(selected.id, {
        line_id: processTarget.id,
        qty,
        disposition: processForm.disposition,
        cell: processForm.cell.trim() || undefined,
        operator: processForm.operator.trim() || undefined,
        note: processForm.note.trim() || undefined,
        reason: processForm.reason.trim() || undefined,
      });
      toast('success', 'Строка возврата обработана');
      if (selected) await openDetail(selected);
      load();
      setProcessTarget(null);
    } catch (e: any) {
      toast('error', e.message || 'Не удалось обработать возврат');
    }
  }

  const quarantineCells = useMemo(() => allCells.filter(c => c.status === 'quarantine'), [allCells]);
  const normalCells = useMemo(() => allCells.filter(c => c.status !== 'blocked' && c.status !== 'quarantine'), [allCells]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[220px] flex items-center gap-2 bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2">
          <Search size={16} className="text-nexus-text3" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по номеру возврата, клиенту..." className="bg-transparent text-nexus-text text-sm flex-1 outline-none placeholder:text-nexus-text3" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button onClick={openCreate} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-4 py-2 rounded-xl text-sm font-medium">
          <Plus size={16} /> Новый возврат
        </button>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {items.map(item => (
            <div key={item.id} onClick={() => openDetail(item)} className={`bg-nexus-surface border rounded-xl p-4 cursor-pointer transition-colors hover:border-nexus-accent/40 ${selected?.id === item.id ? 'border-nexus-accent/60' : 'border-nexus-border'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-nexus-text font-bold text-sm">{item.return_number}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[item.status]}`}>{STATUS_LABELS[item.status]}</span>
              </div>
              <div className="text-nexus-text3 text-xs">{item.customer || '—'} · {formatDateTime(item.created_at)}</div>
              <div className="flex gap-1 mt-2">
                <button onClick={e => { e.stopPropagation(); deleteReturn(item.id!); }} className="text-xs bg-red-900/20 text-red-400 px-2 py-0.5 rounded ml-auto"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="text-center py-8 text-nexus-text3">Нет документов возврата</div>}
        </div>

        <div className="lg:col-span-3 space-y-4">
          {selected ? (
            <>
              <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-nexus-text font-bold flex items-center gap-2"><RotateCcw size={18} /> {selected.return_number}</h3>
                    <div className="text-sm text-nexus-text2 mt-1">Клиент: <span className="text-nexus-text">{selected.customer || '—'}</span></div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
                </div>
                <div className="grid md:grid-cols-2 gap-3 text-sm text-nexus-text2">
                  <div>Order ID: <span className="text-nexus-text">{selected.order_id || '—'}</span></div>
                  <div>Received at: <span className="text-nexus-text">{selected.received_at ? formatDateTime(selected.received_at) : '—'}</span></div>
                  <div>Processed at: <span className="text-nexus-text">{selected.processed_at ? formatDateTime(selected.processed_at) : '—'}</span></div>
                  <div>Причина: <span className="text-nexus-text">{selected.reason || '—'}</span></div>
                </div>
              </div>

              <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
                <h4 className="text-sm font-medium text-nexus-text3">Строки возврата</h4>
                <div className="flex gap-2 items-start flex-wrap">
                  <div className="relative flex-1 min-w-[220px]">
                    <input value={lineForm.barcode} onChange={e => onBarcodeInput(e.target.value)} placeholder="ШК товара" className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm font-mono" />
                    {productSuggestions.length > 0 && (
                      <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-nexus-surface2 border border-nexus-border rounded-xl shadow-lg max-h-40 overflow-y-auto">
                        {productSuggestions.map(product => (
                          <div key={product.barcode} onMouseDown={() => { setLineForm(prev => ({ ...prev, barcode: product.barcode })); setProductSuggestions([]); }} className="px-3 py-2 cursor-pointer hover:bg-nexus-surface3 text-sm border-b border-nexus-border last:border-0">
                            <span className="font-mono text-nexus-accent2 text-xs">{product.barcode}</span> <span className="text-nexus-text">{product.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <input type="number" value={lineForm.qty_expected} onChange={e => setLineForm(prev => ({ ...prev, qty_expected: e.target.value }))} placeholder="Кол-во" className="w-24 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                  <select value={lineForm.disposition} onChange={e => setLineForm(prev => ({ ...prev, disposition: e.target.value as ReturnLine['disposition'] }))} className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
                    <option value="restock">Restock</option>
                    <option value="quarantine">Quarantine</option>
                    <option value="scrap">Scrap</option>
                  </select>
                  <input value={lineForm.reason} onChange={e => setLineForm(prev => ({ ...prev, reason: e.target.value }))} placeholder="Причина" className="flex-1 min-w-[180px] bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                  <button onClick={addLine} className="bg-nexus-accent hover:bg-nexus-accent2 text-white px-3 py-2 rounded-xl text-sm"><Plus size={16} /></button>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-nexus-border">
                      <th className="px-2 py-2 text-left text-nexus-text3 text-xs">ШК</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Ожид.</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Прин.</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Restock</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Quarantine</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Scrap</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Статус</th>
                      <th className="px-2 py-2 text-right text-nexus-text3 text-xs">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(line => {
                      const remaining = Math.max(0, line.qty_expected - line.qty_received);
                      return (
                        <tr key={line.id} className="border-b border-nexus-border/50">
                          <td className="px-2 py-2 font-mono text-nexus-accent2 text-xs">{line.barcode}</td>
                          <td className="px-2 py-2 text-center text-nexus-text">{line.qty_expected}</td>
                          <td className="px-2 py-2 text-center text-nexus-text">{line.qty_received}</td>
                          <td className="px-2 py-2 text-center text-green-300">{line.qty_restocked || ''}</td>
                          <td className="px-2 py-2 text-center text-amber-300">{line.qty_quarantined || ''}</td>
                          <td className="px-2 py-2 text-center text-red-300">{line.qty_scrapped || ''}</td>
                          <td className="px-2 py-2 text-center text-nexus-text3">{line.status}</td>
                          <td className="px-2 py-2">
                            <div className="flex gap-2 justify-end">
                              {remaining > 0 && selected.status !== 'cancelled' && (
                                <button onClick={() => prepareProcess(line)} className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded flex items-center gap-1">
                                  <PackageCheck size={12} /> Обработать
                                </button>
                              )}
                              <button onClick={() => removeLine(line.id!)} className="text-xs bg-red-900/20 text-red-400 px-2 py-1 rounded"><Trash2 size={12} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {lines.length === 0 && <tr><td colSpan={8} className="text-center py-4 text-nexus-text3 text-xs">Добавьте строки возврата</td></tr>}
                  </tbody>
                </table>
              </div>

              {processTarget && (
                <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-nexus-text3">Обработка строки возврата</h4>
                    <button onClick={() => setProcessTarget(null)} className="text-nexus-text3 hover:text-nexus-text"><X size={16} /></button>
                  </div>
                  <div className="text-sm text-nexus-text2">Товар: <span className="font-mono text-nexus-accent2">{processTarget.barcode}</span> · Осталось обработать: <span className="text-nexus-text">{processTarget.qty_expected - processTarget.qty_received}</span></div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <input type="number" value={processForm.qty} onChange={e => setProcessForm(prev => ({ ...prev, qty: e.target.value }))} placeholder="Qty" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <select value={processForm.disposition} onChange={e => setProcessForm(prev => ({ ...prev, disposition: e.target.value as ReturnLine['disposition'], cell: '' }))} className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
                      <option value="restock">Restock</option>
                      <option value="quarantine">Quarantine</option>
                      <option value="scrap">Scrap</option>
                    </select>
                    {processForm.disposition === 'scrap' ? (
                      <div className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text3 text-sm flex items-center">Stock movement не будет</div>
                    ) : (
                      <select value={processForm.cell} onChange={e => setProcessForm(prev => ({ ...prev, cell: e.target.value }))} className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm font-mono">
                        <option value="">Выбери ячейку</option>
                        {(processForm.disposition === 'quarantine' ? quarantineCells : normalCells).map(cell => (
                          <option key={cell.addr} value={cell.addr}>{cell.addr}</option>
                        ))}
                      </select>
                    )}
                    <input value={processForm.operator} onChange={e => setProcessForm(prev => ({ ...prev, operator: e.target.value }))} placeholder="Оператор" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input value={processForm.reason} onChange={e => setProcessForm(prev => ({ ...prev, reason: e.target.value }))} placeholder="Причина / комментарий" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input value={processForm.note} onChange={e => setProcessForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Note" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                  </div>
                  <button onClick={processLine} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
                    <PackageCheck size={16} /> Провести возврат
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-8 text-center text-nexus-text3">Выберите документ возврата</div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl w-full max-w-md animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-border">
              <h2 className="text-nexus-text font-bold text-lg">Новый возврат</h2>
              <button onClick={() => setShowCreate(false)} className="text-nexus-text3 hover:text-nexus-text"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Номер возврата *</label><input value={form.return_number} onChange={e => setForm({ ...form, return_number: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Order ID</label><input type="number" value={form.order_id} onChange={e => setForm({ ...form, order_id: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Клиент</label><input value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Причина</label><input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Примечание</label><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-nexus-border">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-nexus-text3 text-sm">Отмена</button>
              <button onClick={saveReturn} disabled={busy} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-50"><Save size={16} /> {busy ? 'Сохранение...' : 'Создать'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
