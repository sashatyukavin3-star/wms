import {
  Camera, CheckCircle2, ChevronRight, ClipboardList, MapPin,
  Package, PackageCheck, Play, RefreshCw, Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef,useState } from 'react';

import { toast } from '../App';
import { BarcodeScanner } from '../components/BarcodeScanner';
import {
  buildPickList,
  db,
  type Order,
  type OrderLine,
  type PickStep,
  type Product,
  reserveForOrderLine,
  shipStock,
} from '../db';
import { ordersApi } from '../lib/services';
import { formatDateTime } from '../utils';

interface OrderInfo {
  order: Order;
  lines: OrderLine[];
  totalPlan: number;
  totalFact: number;
}

type Mode = 'list' | 'pick';

/**
 * Раздел «Комплектация» — ТСД-режим пошаговой сборки заказа.
 *
 * Сценарий:
 *  1. Список заказов в статусе new/picking → выбираем заказ
 *  2. Если резервы не сделаны — автоматически резервируем по FIFO
 *  3. Видим маршрут: ячейка → товар → qty
 *  4. На каждом шаге: сканируем ШК (сравниваем с ожидаемым), вводим qty, [Подтвердить]
 *  5. Резерв уменьшается, остаток списывается, статус строки/заказа обновляется автоматически
 *  6. Когда все строки done → заказ переходит в «Собран»
 */
export default function Pick() {
  const [mode, setMode] = useState<Mode>('list');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<OrderInfo[]>([]);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [steps, setSteps] = useState<PickStep[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [scanInput, setScanInput] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productMap, setProductMap] = useState<Record<string, Product>>({});
  const [operator, setOperator] = useState('');
  const qtyRef = useRef<HTMLInputElement | null>(null);

  const loadOrders = useCallback(async () => {
    const [list, products, defaultOp] = await Promise.all([
      db.orders.where('status').anyOf(['new', 'picking']).reverse().sortBy('id'),
      db.products.toArray(),
      db.settings.get('default_operator'),
    ]);
    if (defaultOp?.value) setOperator(defaultOp.value);
    setProductMap(Object.fromEntries(products.map(p => [p.barcode, p])));

    const infos: OrderInfo[] = [];
    for (const o of list) {
      const lines = await db.orderLines.where('order_id').equals(o.id!).toArray();
      const totalPlan = lines.reduce((s, l) => s + l.qty_plan, 0);
      const totalFact = lines.reduce((s, l) => s + l.qty_fact, 0);
      infos.push({ order: o, lines, totalPlan, totalFact });
    }
    setOrders(infos);
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(({ order: o }) =>
      String(o.id).includes(q) ||
      (o.ext_id || '').toLowerCase().includes(q) ||
      (o.customer || '').toLowerCase().includes(q)
    );
  }, [orders, search]);

  async function startPicking(order: Order) {
    if (!order.id) return;
    setSubmitting(true);
    try {
      // Если резервов нет — авто-резервируем по FIFO
      const existingRes = await db.reservations.where('order_id').equals(order.id).count();
      if (existingRes === 0) {
        const lines = await db.orderLines.where('order_id').equals(order.id).toArray();
        for (const line of lines) {
          if (line.qty_plan > line.qty_fact && line.id !== undefined) {
            await reserveForOrderLine({
              order_id: order.id,
              order_line_id: line.id,
              barcode: line.barcode,
              qty: line.qty_plan - line.qty_fact,
              operator: operator || undefined,
            });
          }
        }
      }
      const list = await buildPickList(order.id);
      const remaining = list.filter(s => s.qty_to_pick > 0);
      if (remaining.length === 0) {
        toast('warning', 'Все позиции этого заказа уже отобраны');
        await loadOrders();
        return;
      }
      // Переводим заказ в picking, если был new — через серверный API
      if (order.status === 'new') {
        try {
          await ordersApi.update(order.id!, { status: 'picking' });
        } catch (err: any) {
          // Не блокируем сборку, если сервер недоступен
          console.warn('[Pick] не удалось обновить статус заказа:', err);
        }
      }
      setActiveOrder(order);
      setSteps(remaining);
      setStepIdx(0);
      setScanInput('');
      setQtyInput(String(remaining[0].qty_to_pick));
      setMode('pick');
      setTimeout(() => qtyRef.current?.focus(), 100);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось начать комплектацию');
    } finally {
      setSubmitting(false);
    }
  }

  function exitPicking() {
    setMode('list');
    setActiveOrder(null);
    setSteps([]);
    setStepIdx(0);
    loadOrders();
  }

  const currentStep = steps[stepIdx];
  const progress = useMemo(() => {
    if (steps.length === 0) return 0;
    return Math.round((stepIdx / steps.length) * 100);
  }, [stepIdx, steps.length]);

  async function confirmStep() {
    if (!currentStep || !activeOrder || submitting) return;
    const expected = currentStep.barcode;
    const scanned = scanInput.trim();
    if (scanned && scanned !== expected) {
      toast('error', `Ожидался ШК ${expected}, отсканирован ${scanned}`);
      return;
    }
    const qty = Number(qtyInput);
    if (!qty || qty <= 0) {
      toast('error', 'Укажите количество');
      return;
    }
    if (qty > currentStep.qty_to_pick) {
      toast('error', `Нельзя отобрать больше плана (${currentStep.qty_to_pick})`);
      return;
    }
    setSubmitting(true);
    try {
      await shipStock({
        barcode: expected,
        cell: currentStep.cell,
        qty,
        order_id: activeOrder.id,
        operator: operator || undefined,
        note: 'Pick List',
      });

      // Обновляем локальный шаг
      const updatedSteps = [...steps];
      updatedSteps[stepIdx] = {
        ...currentStep,
        qty_to_pick: currentStep.qty_to_pick - qty,
        qty_done: currentStep.qty_done + qty,
      };

      const nextIdx = updatedSteps.findIndex((s, i) => i > stepIdx && s.qty_to_pick > 0);
      if (updatedSteps[stepIdx].qty_to_pick === 0 && nextIdx === -1 &&
          !updatedSteps.some(s => s.qty_to_pick > 0)) {
        // Все шаги завершены
        setSteps(updatedSteps);
        toast('success', '🎉 Заказ собран полностью!');
        setTimeout(exitPicking, 800);
        return;
      }
      setSteps(updatedSteps);
      const advanceTo = updatedSteps[stepIdx].qty_to_pick > 0
        ? stepIdx
        : (nextIdx >= 0 ? nextIdx : stepIdx);
      setStepIdx(advanceTo);
      setScanInput('');
      setQtyInput(String(updatedSteps[advanceTo]?.qty_to_pick || 0));
      setTimeout(() => qtyRef.current?.focus(), 50);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Не удалось списать');
    } finally {
      setSubmitting(false);
    }
  }

  function skipStep() {
    if (stepIdx < steps.length - 1) {
      setStepIdx(stepIdx + 1);
      setScanInput('');
      setQtyInput(String(steps[stepIdx + 1].qty_to_pick));
      setTimeout(() => qtyRef.current?.focus(), 50);
    } else {
      toast('info', 'Это последний шаг');
    }
  }

  // ════════════════════════════════════════════════════════
  // RENDER: list
  // ════════════════════════════════════════════════════════
  if (mode === 'list') {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center">
              <ClipboardList size={22} />
            </div>
            <div>
              <h2 className="text-nexus-text font-bold text-lg">Комплектация заказов</h2>
              <div className="text-nexus-text3 text-xs">Пошаговый сбор с резервированием и FIFO</div>
            </div>
            <button onClick={loadOrders} className="ml-auto text-nexus-text3 hover:text-nexus-text" title="Обновить">
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2">
            <Search size={16} className="text-nexus-text3" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по № заказа, клиенту..."
              className="flex-1 bg-transparent text-nexus-text text-sm outline-none placeholder:text-nexus-text3"
            />
          </div>
        </div>

        <div className="space-y-2">
          {filteredOrders.map(({ order, lines, totalPlan, totalFact }) => {
            const completion = totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0;
            return (
              <div
                key={order.id}
                className="bg-nexus-surface border border-nexus-border rounded-2xl p-4 hover:border-nexus-accent/40 transition-colors"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-nexus-text font-bold">#{order.id}{order.ext_id ? ` / ${order.ext_id}` : ''}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${order.status === 'new' ? 'bg-blue-900/40 text-blue-400' : 'bg-amber-900/40 text-amber-400'}`}>
                        {order.status === 'new' ? 'Новый' : 'Комплектация'}
                      </span>
                    </div>
                    <div className="text-nexus-text3 text-xs mt-0.5">{order.customer || '—'} · {formatDateTime(order.created_at)}</div>
                    <div className="text-nexus-text3 text-xs mt-1">
                      Позиций: {lines.length} · Кол-во: <span className="text-nexus-text">{totalFact}</span> / {totalPlan}
                    </div>
                    <div className="mt-2 h-1.5 bg-nexus-surface2 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${completion}%` }} />
                    </div>
                  </div>
                  <button
                    onClick={() => startPicking(order)}
                    disabled={submitting}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors"
                  >
                    <Play size={16} /> Начать сбор
                  </button>
                </div>
              </div>
            );
          })}

          {filteredOrders.length === 0 && (
            <div className="text-center py-12 text-nexus-text3">
              <PackageCheck size={42} className="mx-auto mb-3 opacity-30" />
              Активных заказов для комплектации нет
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // RENDER: pick mode (ТСД-режим, крупные кнопки)
  // ════════════════════════════════════════════════════════
  if (!currentStep) {
    return (
      <div className="text-center py-12">
        <div className="text-3xl mb-3">🎉</div>
        <div className="text-nexus-text font-bold text-lg">Заказ собран</div>
        <button onClick={exitPicking} className="mt-4 px-5 py-2.5 bg-nexus-accent text-white rounded-xl">К списку</button>
      </div>
    );
  }

  const productName = productMap[currentStep.barcode]?.name || currentStep.barcode;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Шапка прогресса */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <button onClick={exitPicking} className="text-nexus-text3 hover:text-nexus-text text-sm">← Прервать</button>
          <div className="text-nexus-text font-bold text-sm">
            Заказ #{activeOrder?.id}{activeOrder?.ext_id ? ` / ${activeOrder.ext_id}` : ''}
          </div>
          <div className="text-nexus-text3 text-xs">Шаг {stepIdx + 1} / {steps.length}</div>
        </div>
        <div className="h-2 bg-nexus-surface2 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Главная карточка шага */}
      <div className="bg-nexus-surface border-2 border-emerald-500/30 rounded-2xl p-6 mb-4 shadow-2xl">
        <div className="text-nexus-text3 text-xs uppercase tracking-wide mb-2">Идите к ячейке</div>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center text-2xl">
            <MapPin size={32} />
          </div>
          <div className="text-emerald-300 font-extrabold text-4xl font-mono">{currentStep.cell || '—'}</div>
        </div>

        <div className="bg-nexus-surface2 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <Package size={28} className="text-nexus-accent2 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-nexus-text font-bold text-lg leading-tight truncate">{productName}</div>
              <div className="text-nexus-accent2 font-mono text-sm">{currentStep.barcode}</div>
            </div>
          </div>
        </div>

        <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 mb-4 flex items-center justify-between">
          <div className="text-amber-300 text-sm font-medium">Нужно взять</div>
          <div className="text-amber-200 font-extrabold text-4xl">{currentStep.qty_to_pick}</div>
        </div>

        {/* Scan + Qty */}
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-nexus-text3 mb-1 block">Сканируйте ШК (для проверки)</label>
            <div className="flex gap-2">
              <input
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                placeholder="Штрихкод..."
                className="flex-1 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-3 text-nexus-text font-mono"
              />
              <button
                onClick={() => setScannerOpen(true)}
                className="px-3 rounded-xl bg-nexus-surface2 border border-nexus-border text-nexus-text2 hover:text-nexus-text"
                title="Сканер камеры"
              >
                <Camera size={20} />
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-nexus-text3 mb-1 block">Количество</label>
            <input
              ref={qtyRef}
              type="number"
              min="0"
              max={currentStep.qty_to_pick}
              value={qtyInput}
              onChange={e => setQtyInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmStep(); }}
              className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-3 text-nexus-text text-2xl font-bold text-center"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={confirmStep}
            disabled={submitting}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl py-4 text-base font-bold transition-colors"
          >
            <CheckCircle2 size={22} /> Подтвердить
          </button>
          <button
            onClick={skipStep}
            disabled={submitting}
            className="px-4 rounded-xl border border-nexus-border text-nexus-text3 hover:text-nexus-text"
            title="Пропустить"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Следующие шаги (предпросмотр) */}
      {steps.length > stepIdx + 1 && (
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4">
          <div className="text-nexus-text3 text-xs uppercase tracking-wide mb-2">Следующие шаги</div>
          <div className="space-y-1.5">
            {steps.slice(stepIdx + 1, stepIdx + 4).map((s, i) => (
              <div key={`${s.order_line_id}-${i}`} className="flex items-center gap-3 px-2 py-1.5 text-sm">
                <span className="font-mono text-emerald-300/80 w-20">{s.cell}</span>
                <span className="text-nexus-text2 flex-1 truncate">{productMap[s.barcode]?.name || s.barcode}</span>
                <span className="text-nexus-text font-bold">×{s.qty_to_pick}</span>
              </div>
            ))}
            {steps.length > stepIdx + 4 && (
              <div className="text-nexus-text3 text-xs text-center pt-1">…ещё {steps.length - stepIdx - 4}</div>
            )}
          </div>
        </div>
      )}

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={code => {
          setScanInput(code);
          setScannerOpen(false);
          toast('success', `Сканер: ${code}`);
        }}
      />
    </div>
  );
}
