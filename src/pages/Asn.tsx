import { CheckCircle2, Inbox, Plus, Save, Search, Trash2, Truck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { toast } from '../App';
import type { Asn, AsnLine, Product } from '../db';
import { useData } from '../hooks/useData';
import { asnApi } from '../lib/services';
import { subscribeType } from '../lib/ws';
import { formatDateTime } from '../utils';

const STATUS_LABELS: Record<Asn['status'], string> = {
  draft: 'Черновик',
  arrived: 'Прибыло',
  receiving: 'В приёмке',
  completed: 'Завершено',
  cancelled: 'Отменено',
};

const STATUS_COLORS: Record<Asn['status'], string> = {
  draft: 'bg-blue-900/40 text-blue-400',
  arrived: 'bg-cyan-900/40 text-cyan-300',
  receiving: 'bg-amber-900/40 text-amber-300',
  completed: 'bg-green-900/40 text-green-400',
  cancelled: 'bg-red-900/40 text-red-400',
};

export default function AsnPage() {
  const [items, setItems] = useState<Asn[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | Asn['status']>('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asnForm, setAsnForm] = useState({ asn_number: '', supplier: '', eta_date: '', note: '' });
  const [selected, setSelected] = useState<Asn | null>(null);
  const [lines, setLines] = useState<AsnLine[]>([]);
  const [lineForm, setLineForm] = useState({ barcode: '', qty_expected: '', note: '' });
  const [productSuggestions, setProductSuggestions] = useState<Product[]>([]);
  const [receiveTarget, setReceiveTarget] = useState<AsnLine | null>(null);
  const [receiveForm, setReceiveForm] = useState({ cell: '', qty: '', damaged_qty: '0', operator: '', lot_number: '', expiry_date: '', note: '', discrepancy_reason: '' });
  const { products: allProducts } = useData();

  const load = useCallback(async () => {
    try {
      const fresh = await asnApi.list(filterStatus ? { status: filterStatus } : undefined);
      let result = fresh;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        result = result.filter(item =>
          item.asn_number.toLowerCase().includes(q) ||
          (item.supplier || '').toLowerCase().includes(q) ||
          String(item.id).includes(q)
        );
      }
      setItems(result);
      if (selected?.id) {
        const detail = await asnApi.get(selected.id);
        setSelected({
          id: detail.id,
          asn_number: detail.asn_number,
          supplier: detail.supplier,
          status: detail.status,
          eta_date: detail.eta_date,
          arrived_at: detail.arrived_at,
          note: detail.note,
          created_at: detail.created_at,
          updated_at: detail.updated_at,
        });
        setLines(detail.lines);
      }
    } catch (e: any) {
      toast('error', `Не удалось загрузить ASN: ${e.message || e}`);
    }
  }, [filterStatus, search, selected?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribeType('asn:changed', () => { load(); }), [load]);

  function openCreate() {
    setAsnForm({ asn_number: '', supplier: '', eta_date: '', note: '' });
    setShowCreate(true);
  }

  async function saveAsn() {
    if (!asnForm.asn_number.trim()) {
      toast('error', 'Введите номер ASN');
      return;
    }
    setBusy(true);
    try {
      await asnApi.create({
        asn_number: asnForm.asn_number.trim(),
        supplier: asnForm.supplier.trim() || undefined,
        eta_date: asnForm.eta_date || undefined,
        note: asnForm.note.trim() || undefined,
      });
      toast('success', 'ASN создан');
      setShowCreate(false);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось создать ASN');
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(item: Asn) {
    try {
      const detail = await asnApi.get(item.id!);
      setSelected({
        id: detail.id,
        asn_number: detail.asn_number,
        supplier: detail.supplier,
        status: detail.status,
        eta_date: detail.eta_date,
        arrived_at: detail.arrived_at,
        note: detail.note,
        created_at: detail.created_at,
        updated_at: detail.updated_at,
      });
      setLines(detail.lines);
      setReceiveTarget(null);
    } catch (e: any) {
      toast('error', e.message || 'Не удалось открыть ASN');
    }
  }

  async function markArrived() {
    if (!selected?.id) return;
    try {
      await asnApi.markArrived(selected.id);
      toast('success', 'Поставка отмечена как прибывшая');
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось отметить прибытие');
    }
  }

  async function removeAsn(id: number) {
    if (!confirm('Удалить ASN?')) return;
    try {
      await asnApi.remove(id);
      toast('info', 'ASN удалён');
      if (selected?.id === id) { setSelected(null); setLines([]); }
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось удалить ASN');
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
    if (!lineForm.barcode.trim()) { toast('error', 'Введите штрихкод товара'); return; }
    if (!qtyExpected || qtyExpected <= 0) { toast('error', 'Введите корректное плановое количество'); return; }
    try {
      await asnApi.addLine(selected.id, {
        barcode: lineForm.barcode.trim(),
        qty_expected: qtyExpected,
        note: lineForm.note.trim() || undefined,
      });
      setLineForm({ barcode: '', qty_expected: '', note: '' });
      setProductSuggestions([]);
      toast('success', 'Строка ASN добавлена');
      await openDetail(selected);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось добавить строку');
    }
  }

  async function deleteLine(lineId: number) {
    try {
      await asnApi.removeLine(lineId);
      toast('info', 'Строка ASN удалена');
      if (selected) await openDetail(selected);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось удалить строку');
    }
  }

  function prepareReceive(line: AsnLine) {
    setReceiveTarget(line);
    setReceiveForm({ cell: '', qty: String(Math.max(1, line.qty_expected - line.qty_received - line.qty_damaged)), damaged_qty: '0', operator: '', lot_number: '', expiry_date: '', note: '', discrepancy_reason: '' });
  }

  async function receiveLine() {
    if (!selected?.id || !receiveTarget?.id) return;
    const qty = Number(receiveForm.qty);
    const damagedQty = Number(receiveForm.damaged_qty || '0');
    if (!receiveForm.cell.trim()) { toast('error', 'Введите ячейку размещения'); return; }
    if ((qty <= 0 || Number.isNaN(qty)) && (damagedQty <= 0 || Number.isNaN(damagedQty))) { toast('error', 'Укажи good qty или damaged qty'); return; }
    if (damagedQty > 0 && !receiveForm.discrepancy_reason.trim()) { toast('error', 'Для брака укажи причину'); return; }
    try {
      await asnApi.receive(selected.id, {
        line_id: receiveTarget.id,
        cell: receiveForm.cell.trim(),
        qty,
        damaged_qty: damagedQty,
        operator: receiveForm.operator.trim() || undefined,
        lot_number: receiveForm.lot_number.trim() || undefined,
        expiry_date: receiveForm.expiry_date || undefined,
        note: receiveForm.note.trim() || undefined,
        discrepancy_reason: receiveForm.discrepancy_reason.trim() || undefined,
      });
      toast('success', 'Строка ASN принята в остатки');
      if (selected) await openDetail(selected);
      load();
      setReceiveTarget(null);
    } catch (e: any) {
      toast('error', e.message || 'Не удалось провести приёмку по ASN');
    }
  }

  const totals = useMemo(() => ({
    expected: lines.reduce((sum, line) => sum + line.qty_expected, 0),
    received: lines.reduce((sum, line) => sum + line.qty_received, 0),
  }), [lines]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[220px] flex items-center gap-2 bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2">
          <Search size={16} className="text-nexus-text3" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по ASN, поставщику..."
            className="bg-transparent text-nexus-text text-sm flex-1 outline-none placeholder:text-nexus-text3"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button onClick={openCreate} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-4 py-2 rounded-xl text-sm font-medium">
          <Plus size={16} /> Новый ASN
        </button>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {items.map(item => (
            <div key={item.id} onClick={() => openDetail(item)} className={`bg-nexus-surface border rounded-xl p-4 cursor-pointer transition-colors hover:border-nexus-accent/40 ${selected?.id === item.id ? 'border-nexus-accent/60' : 'border-nexus-border'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-nexus-text font-bold text-sm">{item.asn_number}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[item.status]}`}>{STATUS_LABELS[item.status]}</span>
              </div>
              <div className="text-nexus-text3 text-xs">{item.supplier || '—'} · {formatDateTime(item.created_at)}</div>
              <div className="flex gap-1 mt-2">
                {item.status === 'draft' && <button onClick={e => { e.stopPropagation(); openDetail(item).then(markArrived); }} className="text-xs bg-cyan-900/30 text-cyan-300 px-2 py-0.5 rounded">→ Прибыло</button>}
                <button onClick={e => { e.stopPropagation(); removeAsn(item.id!); }} className="text-xs bg-red-900/20 text-red-400 px-2 py-0.5 rounded ml-auto"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="text-center py-8 text-nexus-text3">Нет ASN / поставок</div>}
        </div>

        <div className="lg:col-span-3 space-y-4">
          {selected ? (
            <>
              <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-nexus-text font-bold flex items-center gap-2"><Inbox size={18} /> {selected.asn_number}</h3>
                    <div className="text-sm text-nexus-text2 mt-1">Поставщик: <span className="text-nexus-text">{selected.supplier || '—'}</span></div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
                </div>
                <div className="grid md:grid-cols-2 gap-3 text-sm text-nexus-text2">
                  <div>ETA: <span className="text-nexus-text">{selected.eta_date || '—'}</span></div>
                  <div>Arrived at: <span className="text-nexus-text">{selected.arrived_at ? formatDateTime(selected.arrived_at) : '—'}</span></div>
                  <div>План всего: <span className="text-nexus-text">{totals.expected}</span></div>
                  <div>Принято всего: <span className="text-nexus-text">{totals.received}</span></div>
                </div>
                {selected.status === 'draft' && (
                  <button onClick={markArrived} className="flex items-center gap-2 bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium">
                    <Truck size={16} /> Отметить прибытие
                  </button>
                )}
              </div>

              <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
                <h4 className="text-sm font-medium text-nexus-text3">Строки ASN</h4>
                <div className="flex gap-2 items-start">
                  <div className="relative flex-1">
                    <input value={lineForm.barcode} onChange={e => onBarcodeInput(e.target.value)} placeholder="ШК товара"
                      className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm font-mono" />
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
                  <input type="number" value={lineForm.qty_expected} onChange={e => setLineForm(prev => ({ ...prev, qty_expected: e.target.value }))} placeholder="План"
                    className="w-24 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                  <input value={lineForm.note} onChange={e => setLineForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Примечание"
                    className="flex-1 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                  <button onClick={addLine} className="bg-nexus-accent hover:bg-nexus-accent2 text-white px-3 py-2 rounded-xl text-sm"><Plus size={16} /></button>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-nexus-border">
                      <th className="px-2 py-2 text-left text-nexus-text3 text-xs">ШК</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">План</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Принято</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Брак</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">QC</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Статус</th>
                      <th className="px-2 py-2 text-right text-nexus-text3 text-xs">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(line => {
                      const remaining = Math.max(0, line.qty_expected - line.qty_received - line.qty_damaged);
                      return (
                        <tr key={line.id} className="border-b border-nexus-border/50">
                          <td className="px-2 py-2 font-mono text-nexus-accent2 text-xs">{line.barcode}</td>
                          <td className="px-2 py-2 text-center text-nexus-text">{line.qty_expected}</td>
                          <td className="px-2 py-2 text-center text-nexus-text">{line.qty_received}</td>
                          <td className="px-2 py-2 text-center text-red-300">{line.qty_damaged || ''}</td>
                          <td className="px-2 py-2 text-center text-nexus-text3">{line.qc_status}</td>
                          <td className="px-2 py-2 text-center text-nexus-text3">{line.status}</td>
                          <td className="px-2 py-2">
                            <div className="flex gap-2 justify-end">
                              {remaining > 0 && selected.status !== 'cancelled' && (
                                <button onClick={() => prepareReceive(line)} className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded flex items-center gap-1">
                                  <CheckCircle2 size={12} /> Принять
                                </button>
                              )}
                              <button onClick={() => deleteLine(line.id!)} className="text-xs bg-red-900/20 text-red-400 px-2 py-1 rounded"><Trash2 size={12} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {lines.length === 0 && <tr><td colSpan={7} className="text-center py-4 text-nexus-text3 text-xs">Добавьте строки поставки</td></tr>}
                  </tbody>
                </table>
              </div>

              {receiveTarget && (
                <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-nexus-text3">Приёмка по строке ASN</h4>
                    <button onClick={() => setReceiveTarget(null)} className="text-nexus-text3 hover:text-nexus-text"><X size={16} /></button>
                  </div>
                  <div className="text-sm text-nexus-text2">Товар: <span className="font-mono text-nexus-accent2">{receiveTarget.barcode}</span> · Осталось обработать: <span className="text-nexus-text">{receiveTarget.qty_expected - receiveTarget.qty_received - receiveTarget.qty_damaged}</span></div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <input value={receiveForm.cell} onChange={e => setReceiveForm(prev => ({ ...prev, cell: e.target.value }))} placeholder="Ячейка" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm font-mono" />
                    <input type="number" value={receiveForm.qty} onChange={e => setReceiveForm(prev => ({ ...prev, qty: e.target.value }))} placeholder="Good qty" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input type="number" value={receiveForm.damaged_qty} onChange={e => setReceiveForm(prev => ({ ...prev, damaged_qty: e.target.value }))} placeholder="Damaged qty" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input value={receiveForm.operator} onChange={e => setReceiveForm(prev => ({ ...prev, operator: e.target.value }))} placeholder="Оператор" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input value={receiveForm.lot_number} onChange={e => setReceiveForm(prev => ({ ...prev, lot_number: e.target.value }))} placeholder="Партия" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input type="date" value={receiveForm.expiry_date} onChange={e => setReceiveForm(prev => ({ ...prev, expiry_date: e.target.value }))} className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input value={receiveForm.note} onChange={e => setReceiveForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Примечание" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                    <input value={receiveForm.discrepancy_reason} onChange={e => setReceiveForm(prev => ({ ...prev, discrepancy_reason: e.target.value }))} placeholder="Причина брака / расхождения" className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm md:col-span-2" />
                  </div>
                  <button onClick={receiveLine} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
                    <CheckCircle2 size={16} /> Провести приёмку
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-8 text-center text-nexus-text3">Выберите ASN / поставку для просмотра</div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl w-full max-w-md animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-border">
              <h2 className="text-nexus-text font-bold text-lg">Новый ASN / поставка</h2>
              <button onClick={() => setShowCreate(false)} className="text-nexus-text3 hover:text-nexus-text"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Номер ASN *</label><input value={asnForm.asn_number} onChange={e => setAsnForm({ ...asnForm, asn_number: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Поставщик</label><input value={asnForm.supplier} onChange={e => setAsnForm({ ...asnForm, supplier: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">ETA дата</label><input type="date" value={asnForm.eta_date} onChange={e => setAsnForm({ ...asnForm, eta_date: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Примечание</label><input value={asnForm.note} onChange={e => setAsnForm({ ...asnForm, note: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-nexus-border">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-nexus-text3 text-sm">Отмена</button>
              <button onClick={saveAsn} disabled={busy} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-50"><Save size={16} /> {busy ? 'Сохранение...' : 'Создать'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
