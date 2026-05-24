import { Plus, Save, Search,Trash2, X } from 'lucide-react';
import { useCallback,useEffect, useState } from 'react';

import { toast } from '../App';
import { db, type Order, type OrderLine, type Product } from '../db';
import { useData } from '../hooks/useData';
import { ordersApi } from '../lib/services';
import { formatDateTime } from '../utils';

const STATUS_LABELS: Record<string, string> = { new: 'Новый', picking: 'Комплектация', picked: 'Собран', packed: 'Упакован', shipped: 'Отгружен', cancelled: 'Отменён' };
const STATUS_COLORS: Record<string, string> = { new: 'bg-blue-900/40 text-blue-400', picking: 'bg-amber-900/40 text-amber-400', picked: 'bg-green-900/40 text-green-400', packed: 'bg-violet-900/40 text-violet-300', shipped: 'bg-gray-700/40 text-gray-400', cancelled: 'bg-red-900/40 text-red-400' };

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [orderForm, setOrderForm] = useState({ ext_id: '', customer: '', operator: '', note: '' });
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [viewLines, setViewLines] = useState<OrderLine[]>([]);
  const [newLine, setNewLine] = useState({ barcode: '', qty: '' });
  const [productSuggestions, setProductSuggestions] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const { products: allProductsActive } = useData();
  const allProducts: Product[] = allProductsActive;

  const load = useCallback(async () => {
    try {
      const fresh = await ordersApi.list();
      let items = fresh;
      if (search) {
        const q = search.toLowerCase();
        items = items.filter(o => (o.ext_id || '').toLowerCase().includes(q) || (o.customer || '').toLowerCase().includes(q) || String(o.id).includes(q));
      }
      if (filterStatus) items = items.filter(o => o.status === filterStatus);
      // ordersApi.list уже отдаёт DESC по id
      setOrders(items);
      // Локальный кэш для оффлайн-чтения
      try { await db.orders.clear(); if (items.length) await db.orders.bulkPut(items); } catch { /* noop */ }
    } catch (e: any) {
      toast('error', `Не удалось загрузить заказы: ${e.message || e}`);
      // Фоллбек: показываем то, что лежит в Dexie
      const local = await db.orders.orderBy('id').reverse().toArray();
      setOrders(local);
    }
  }, [search, filterStatus]);

  useEffect(() => { load(); }, [load]);

  // Перезагружаемся, когда придёт WS-эвент об изменении заказа
  useEffect(() => {
    const handler = () => load();
    // Простая интеграция через polling: useData уже подписан на WS и сам обновит products/stock,
    // а здесь подписка на window-event не нужна — load() и так дергается при изменении search/filter.
    // Делаем мягкий refresh при возврате на вкладку.
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [load]);

  function openAdd() { setEditOrder(null); setOrderForm({ ext_id: '', customer: '', operator: '', note: '' }); setShowModal(true); }

  async function saveOrder() {
    setBusy(true);
    try {
      if (editOrder && editOrder.id) {
        await ordersApi.update(editOrder.id, {
          ext_id: orderForm.ext_id || undefined,
          customer: orderForm.customer || undefined,
          operator: orderForm.operator || undefined,
          note: orderForm.note || undefined,
        });
        toast('success', 'Заказ обновлён');
      } else {
        await ordersApi.create({
          ext_id: orderForm.ext_id || undefined,
          customer: orderForm.customer || undefined,
          operator: orderForm.operator || undefined,
          note: orderForm.note || undefined,
        });
        toast('success', 'Заказ создан');
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      toast('error', `Не удалось сохранить: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(order: Order, status: Order['status']) {
    try {
      await ordersApi.update(order.id!, { status });
      toast('success', `Статус: ${STATUS_LABELS[status]}`);
      load();
    } catch (e: any) {
      toast('error', `Не удалось сменить статус: ${e.message || e}`);
    }
  }

  async function packOrder(order: Order) {
    const raw = prompt('Количество упаковок', String(order.package_count || 1));
    if (raw === null) return;
    const package_count = Math.max(1, Number(raw) || 1);
    try {
      await ordersApi.pack(order.id!, { package_count });
      toast('success', `Заказ упакован (${package_count} мест)`);
      if (viewOrder?.id === order.id) {
        const detail = await ordersApi.get(order.id!);
        setViewOrder(detail);
        setViewLines(detail.lines);
      }
      load();
    } catch (e: any) {
      toast('error', `Не удалось упаковать: ${e.message || e}`);
    }
  }

  async function deleteOrder(id: number) {
    if (!confirm('Удалить заказ?')) return;
    try {
      await ordersApi.remove(id);
      toast('info', 'Заказ удалён');
      if (viewOrder?.id === id) { setViewOrder(null); setViewLines([]); }
      load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось удалить');
    }
  }

  async function openView(order: Order) {
    setViewOrder(order);
    try {
      const lines = await ordersApi.getLines(order.id!);
      setViewLines(lines);
    } catch (e: any) {
      toast('error', `Не удалось загрузить позиции: ${e.message || e}`);
      const local = await db.orderLines.where('order_id').equals(order.id!).toArray();
      setViewLines(local);
    }
  }

  async function addLine() {
    if (!viewOrder?.id || !newLine.barcode.trim()) { toast('error', 'Введите ШК'); return; }
    const qty = Number(newLine.qty) || 1;
    try {
      await ordersApi.addLine(viewOrder.id, { barcode: newLine.barcode.trim(), qty_plan: qty });
      setNewLine({ barcode: '', qty: '' });
      const lines = await ordersApi.getLines(viewOrder.id);
      setViewLines(lines);
      toast('success', 'Позиция добавлена');
    } catch (e: any) {
      toast('error', `Не удалось добавить: ${e.message || e}`);
    }
  }

  async function removeLine(id: number) {
    try {
      await ordersApi.removeLine(id);
      if (viewOrder?.id) {
        const lines = await ordersApi.getLines(viewOrder.id);
        setViewLines(lines);
      }
    } catch (e: any) {
      toast('error', `Не удалось удалить: ${e.message || e}`);
    }
  }

  const onBarcodeInput = (val: string) => {
    setNewLine({ ...newLine, barcode: val });
    if (val.length >= 2) {
      const q = val.toLowerCase();
      setProductSuggestions(allProducts.filter(p => p.barcode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 6));
    } else setProductSuggestions([]);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2">
          <Search size={16} className="text-nexus-text3" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по номеру, клиенту..."
            className="bg-transparent text-nexus-text text-sm flex-1 outline-none placeholder:text-nexus-text3" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={openAdd} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-4 py-2 rounded-xl text-sm font-medium"><Plus size={16} /> Новый заказ</button>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Orders list */}
        <div className="lg:col-span-2 space-y-2">
          {orders.map(o => (
            <div key={o.id} onClick={() => openView(o)} className={`bg-nexus-surface border rounded-xl p-4 cursor-pointer transition-colors hover:border-nexus-accent/40 ${viewOrder?.id === o.id ? 'border-nexus-accent/60' : 'border-nexus-border'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-nexus-text font-bold text-sm">#{o.id}{o.ext_id ? ` / ${o.ext_id}` : ''}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[o.status]}`}>{STATUS_LABELS[o.status]}</span>
              </div>
              <div className="text-nexus-text3 text-xs">{o.customer || '—'} · {formatDateTime(o.created_at)}</div>
              <div className="flex gap-1 mt-2">
                {o.status === 'new' && <button onClick={e => { e.stopPropagation(); changeStatus(o, 'picking'); }} className="text-xs bg-amber-900/30 text-amber-400 px-2 py-0.5 rounded">→ Комплектация</button>}
                {o.status === 'picking' && <button onClick={e => { e.stopPropagation(); changeStatus(o, 'picked'); }} className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded">→ Собран</button>}
                {o.status === 'picked' && <button onClick={e => { e.stopPropagation(); packOrder(o); }} className="text-xs bg-violet-900/30 text-violet-300 px-2 py-0.5 rounded">→ Упаковать</button>}
                {o.status === 'packed' && <button onClick={e => { e.stopPropagation(); changeStatus(o, 'shipped'); }} className="text-xs bg-gray-700/30 text-gray-300 px-2 py-0.5 rounded">→ Отгружен</button>}
                <button onClick={e => { e.stopPropagation(); deleteOrder(o.id!); }} className="text-xs bg-red-900/20 text-red-400 px-2 py-0.5 rounded ml-auto"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {orders.length === 0 && <div className="text-center py-8 text-nexus-text3">Нет заказов</div>}
        </div>

        {/* Order detail */}
        <div className="lg:col-span-3">
          {viewOrder ? (
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-nexus-text font-bold">Заказ #{viewOrder.id}{viewOrder.ext_id ? ` / ${viewOrder.ext_id}` : ''}</h3>
                <div className="flex items-center gap-2">
                  {viewOrder.status === 'picked' && <button onClick={() => packOrder(viewOrder)} className="text-xs bg-violet-900/30 text-violet-300 px-2 py-1 rounded">Упаковать</button>}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[viewOrder.status]}`}>{STATUS_LABELS[viewOrder.status]}</span>
                </div>
              </div>
              <div className="text-sm text-nexus-text2 space-y-1">
                <div>Клиент: <span className="text-nexus-text">{viewOrder.customer || '—'}</span></div>
                <div>Оператор: <span className="text-nexus-text">{viewOrder.operator || '—'}</span></div>
                <div>Упаковал: <span className="text-nexus-text">{viewOrder.packed_by || '—'}</span></div>
                <div>Упаковок: <span className="text-nexus-text">{viewOrder.package_count || '—'}</span></div>
                <div>Упаковано: <span className="text-nexus-text">{viewOrder.packed_at ? formatDateTime(viewOrder.packed_at) : '—'}</span></div>
                <div>Примечание: <span className="text-nexus-text">{viewOrder.note || '—'}</span></div>
              </div>

              <div className="border-t border-nexus-border pt-4">
                <h4 className="text-sm font-medium text-nexus-text3 mb-3">Позиции заказа</h4>

                {/* Add line */}
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <input value={newLine.barcode} onChange={e => onBarcodeInput(e.target.value)} placeholder="ШК товара"
                      className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm font-mono" />
                    {productSuggestions.length > 0 && (
                      <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-nexus-surface2 border border-nexus-border rounded-xl shadow-lg max-h-40 overflow-y-auto">
                        {productSuggestions.map(p => (
                          <div key={p.barcode} onMouseDown={() => { setNewLine({ ...newLine, barcode: p.barcode }); setProductSuggestions([]); }} className="px-3 py-2 cursor-pointer hover:bg-nexus-surface3 text-sm">
                            <span className="font-mono text-nexus-accent2 text-xs">{p.barcode}</span> <span className="text-nexus-text">{p.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <input type="number" value={newLine.qty} onChange={e => setNewLine({ ...newLine, qty: e.target.value })} placeholder="Кол-во" className="w-24 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm" />
                  <button onClick={addLine} className="bg-nexus-accent hover:bg-nexus-accent2 text-white px-3 py-2 rounded-xl text-sm"><Plus size={16} /></button>
                </div>

                {/* Lines table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-nexus-border">
                      <th className="px-2 py-2 text-left text-nexus-text3 text-xs">ШК</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">План</th>
                      <th className="px-2 py-2 text-center text-nexus-text3 text-xs">Факт</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewLines.map(l => (
                      <tr key={l.id} className="border-b border-nexus-border/50">
                        <td className="px-2 py-2 font-mono text-nexus-accent2 text-xs">{l.barcode}</td>
                        <td className="px-2 py-2 text-center text-nexus-text">{l.qty_plan}</td>
                        <td className="px-2 py-2 text-center text-nexus-text">{l.qty_fact}</td>
                        <td className="px-2 py-2"><button onClick={() => removeLine(l.id!)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                    {viewLines.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-nexus-text3 text-xs">Добавьте позиции</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-8 text-center text-nexus-text3">Выберите заказ для просмотра</div>
          )}
        </div>
      </div>

      {/* New Order Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowModal(false)}>
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl w-full max-w-md animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-border">
              <h2 className="text-nexus-text font-bold text-lg">Новый заказ</h2>
              <button onClick={() => setShowModal(false)} className="text-nexus-text3 hover:text-nexus-text"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Внешний номер</label><input value={orderForm.ext_id} onChange={e => setOrderForm({ ...orderForm, ext_id: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Клиент</label><input value={orderForm.customer} onChange={e => setOrderForm({ ...orderForm, customer: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Оператор</label><input value={orderForm.operator} onChange={e => setOrderForm({ ...orderForm, operator: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
              <div><label className="text-xs font-medium text-nexus-text3 mb-1 block">Примечание</label><input value={orderForm.note} onChange={e => setOrderForm({ ...orderForm, note: e.target.value })} className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" /></div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-nexus-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl text-nexus-text3 text-sm">Отмена</button>
              <button onClick={saveOrder} disabled={busy} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-50"><Save size={16} /> {busy ? 'Сохранение...' : 'Создать'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
