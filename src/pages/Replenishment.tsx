import { Layers3, RefreshCw, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { toast } from '../App';
import { replenishmentApi, type ReplenishmentSuggestion } from '../lib/services';
import { formatDateTime } from '../utils';

export default function Replenishment() {
  const [items, setItems] = useState<ReplenishmentSuggestion[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [executingKey, setExecutingKey] = useState<string | null>(null);
  const [sourceChoice, setSourceChoice] = useState<Record<string, string>>({});
  const [qtyChoice, setQtyChoice] = useState<Record<string, string>>({});
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const list = await replenishmentApi.list();
      setItems(list);
      setLastRefresh(Date.now());
      setSourceChoice(prev => {
        const next = { ...prev };
        for (const item of list) if (!next[item.barcode]) next[item.barcode] = item.source_options[0]?.cell || '';
        return next;
      });
      setQtyChoice(prev => {
        const next = { ...prev };
        for (const item of list) if (!next[item.barcode]) next[item.barcode] = String(item.suggested_qty);
        return next;
      });
    } catch (e: any) {
      toast('error', `Не удалось загрузить пополнение: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(item => item.barcode.toLowerCase().includes(q) || item.name.toLowerCase().includes(q) || item.destination_cell.toLowerCase().includes(q));
  }, [items, search]);

  async function execute(item: ReplenishmentSuggestion) {
    const from = sourceChoice[item.barcode] || item.source_options[0]?.cell;
    const qty = Number(qtyChoice[item.barcode] || item.suggested_qty);
    if (!from) { toast('warning', 'Выбери исходную ячейку'); return; }
    if (!qty || qty <= 0) { toast('warning', 'Укажи корректное количество'); return; }
    setExecutingKey(item.barcode);
    try {
      await replenishmentApi.execute({
        barcode: item.barcode,
        from,
        to: item.destination_cell,
        qty,
        note: 'Replenishment from picking-face screen',
      });
      toast('success', `Пополнение выполнено: ${item.barcode} ${qty} шт.`);
      await load();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось выполнить пополнение');
    } finally {
      setExecutingKey(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-nexus-text font-bold text-xl flex items-center gap-2"><Layers3 size={22} className="text-violet-300" /> Пополнение picking-face</h2>
            <p className="text-nexus-text3 text-sm mt-2 max-w-3xl">
              Список предложений пополнения, если stock в picking-face упал ниже минимума товара.
              Система подбирает source-ячейки и рекомендуемое количество на основе min/max stock и свойств ячеек.
            </p>
          </div>
          <button onClick={load} className="flex items-center gap-2 border border-nexus-border text-nexus-text3 hover:text-nexus-text px-4 py-2 rounded-xl text-sm" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Обновить
          </button>
        </div>
      </div>

      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по SKU, названию, picking-face ячейке..." className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
        <div className="text-xs text-nexus-text3 mt-2">Последнее обновление: {lastRefresh ? formatDateTime(lastRefresh) : '—'}</div>
      </div>

      <div className="space-y-3">
        {filtered.map(item => (
          <div key={item.barcode} className="bg-nexus-surface border border-nexus-border rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-nexus-text font-bold text-base">{item.name}</div>
                <div className="text-nexus-accent2 font-mono text-xs">{item.barcode}</div>
                <div className="text-nexus-text3 text-sm mt-2">Причина: {item.reason}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm min-w-[320px]">
                <Metric label="Min" value={item.min_stock} />
                <Metric label="Target" value={item.target_qty} />
                <Metric label="Pick qty" value={item.current_pick_qty} />
                <Metric label="Suggest" value={item.suggested_qty} />
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-3 text-sm">
              <div>
                <label className="text-xs text-nexus-text3 mb-1 block">Destination</label>
                <div className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text font-mono">{item.destination_cell}</div>
              </div>
              <div>
                <label className="text-xs text-nexus-text3 mb-1 block">Capacity left</label>
                <div className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text">{item.destination_capacity_left ?? '∞'}</div>
              </div>
              <div>
                <label className="text-xs text-nexus-text3 mb-1 block">Source cell</label>
                <select
                  value={sourceChoice[item.barcode] || item.source_options[0]?.cell || ''}
                  onChange={e => setSourceChoice(prev => ({ ...prev, [item.barcode]: e.target.value }))}
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono"
                >
                  {item.source_options.map(option => (
                    <option key={option.cell} value={option.cell}>{option.cell} · free {option.available_qty}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-nexus-text3 mb-1 block">Qty</label>
                <input
                  type="number"
                  value={qtyChoice[item.barcode] || String(item.suggested_qty)}
                  onChange={e => setQtyChoice(prev => ({ ...prev, [item.barcode]: e.target.value }))}
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => execute(item)}
                disabled={executingKey === item.barcode}
                className="flex items-center gap-2 bg-violet-700 hover:bg-violet-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60"
              >
                <Truck size={16} /> {executingKey === item.barcode ? 'Выполнение...' : 'Пополнить'}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-8 text-center text-nexus-text3">
            Нет товаров, которым сейчас требуется пополнение picking-face.
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-nexus-surface2 border border-nexus-border rounded-xl p-3 text-center">
      <div className="text-xs text-nexus-text3">{label}</div>
      <div className="text-sm font-bold text-nexus-text mt-1">{value}</div>
    </div>
  );
}
