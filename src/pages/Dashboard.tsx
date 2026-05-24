import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler,Legend, LinearScale, LineElement, PointElement, Title, Tooltip } from 'chart.js';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Clock,MapPin, Package, TrendingUp } from 'lucide-react';
import { type ReactNode,useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';

import { db, type Op, type Product } from '../db';
import { formatDateTime } from '../utils';

// Global navigation helper.
// Возвращает функцию-отписки, чтобы избежать утечки слушателей при размонтировании.
const navListeners = new Set<(page: string) => void>();
export function onDashboardNav(cb: (page: string) => void): () => void {
  navListeners.add(cb);
  return () => { navListeners.delete(cb); };
}
function navTo(page: string) {
  navListeners.forEach(l => l(page));
}

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler);

interface DashboardStats {
  products: number;
  cells: number;
  stock: number;
  opsToday: number;
  opsReceive: number;
  opsShip: number;
  deficit: number;
  activeOrders: number;
}

interface DeficitProduct extends Product {
  currentStock: number;
}

interface TopProduct {
  barcode: string;
  name: string;
  qty: number;
}

interface OpsByDayData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor: string;
    borderRadius: number;
  }[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    products: 0, cells: 0, stock: 0, opsToday: 0, opsReceive: 0, opsShip: 0, deficit: 0, activeOrders: 0,
  });
  const [recentOps, setRecentOps] = useState<Op[]>([]);
  const [deficitProducts, setDeficitProducts] = useState<DeficitProduct[]>([]);
  const [opsByDay, setOpsByDay] = useState<OpsByDayData | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    // Один проход по товарам и один — по остаткам, агрегации делаем в Map.
    // Это устраняет N+1 запросов, которые были раньше.
    const [products, cellsCount, allStock, activeOrders] = await Promise.all([
      db.products.filter(p => !p.deleted).toArray(),
      db.cells.count(),
      db.stock.toArray(),
      db.orders.where('status').anyOf(['new', 'picking']).count(),
    ]);

    const productsCount = products.length;
    const totalStock = allStock.reduce((s, st) => s + st.qty, 0);

    const stockByBarcode = new Map<string, number>();
    for (const s of allStock) {
      stockByBarcode.set(s.barcode, (stockByBarcode.get(s.barcode) || 0) + s.qty);
    }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const ops = await db.ops.where('ts').above(todayStart.getTime()).toArray();
    const opsToday = ops.length;
    const opsReceive = ops.filter(o => o.type === 'receive').reduce((s, o) => s + o.qty, 0);
    const opsShip = ops.filter(o => o.type === 'ship').reduce((s, o) => s + o.qty, 0);

    // Дефицит — без N+1: используем уже вычисленный stockByBarcode.
    const deficits: DeficitProduct[] = [];
    for (const p of products) {
      if (p.min_stock && p.min_stock > 0) {
        const total = stockByBarcode.get(p.barcode) || 0;
        if (total < p.min_stock) {
          deficits.push({ ...p, currentStock: total });
        }
      }
    }
    setDeficitProducts(deficits.slice(0, 10));

    setStats({
      products: productsCount,
      cells: cellsCount,
      stock: totalStock,
      opsToday,
      opsReceive,
      opsShip,
      deficit: deficits.length,
      activeOrders,
    });

    const recent = await db.ops.orderBy('id').reverse().limit(15).toArray();
    setRecentOps(recent);

    // Операции за последние 7 дней.
    const dayData: Record<string, { receive: number; ship: number }> = {};
    const dayLabels: string[] = [];
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      dayLabels.push(label);
      dayKeys.push(key);
      dayData[key] = { receive: 0, ship: 0 };
    }

    const weekAgo = Date.now() - 7 * 86400000;
    const weekOps = await db.ops.where('ts').above(weekAgo).toArray();
    for (const op of weekOps) {
      const key = new Date(op.ts).toISOString().slice(0, 10);
      if (dayData[key]) {
        if (op.type === 'receive') dayData[key].receive += op.qty;
        if (op.type === 'ship') dayData[key].ship += op.qty;
      }
    }

    setOpsByDay({
      labels: dayLabels,
      datasets: [
        { label: 'Приёмка', data: dayKeys.map(k => dayData[k].receive), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 },
        { label: 'Отгрузка', data: dayKeys.map(k => dayData[k].ship), backgroundColor: 'rgba(124,106,255,0.7)', borderRadius: 6 },
      ],
    });

    // Топ товаров по отгрузкам за 30 дней — также без N+1.
    const monthAgo = Date.now() - 30 * 86400000;
    const shipOps = await db.ops.where('ts').above(monthAgo).and(o => o.type === 'ship').toArray();
    const shipMap = new Map<string, number>();
    for (const o of shipOps) {
      if (o.barcode) shipMap.set(o.barcode, (shipMap.get(o.barcode) || 0) + o.qty);
    }
    const topEntries = [...shipMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const productsByBarcode = new Map(products.map(p => [p.barcode, p]));
    const topProds: TopProduct[] = topEntries.map(([bc, qty]) => ({
      barcode: bc,
      name: productsByBarcode.get(bc)?.name || bc,
      qty,
    }));
    setTopProducts(topProds);
  }

  const typeLabel: Record<string, string> = { receive: '⬇ Приёмка', ship: '⬆ Отгрузка', move: '↔ Перемещение', replenish: '↥ Пополнение', adjust: '📋 Корректировка' };
  const typeColor: Record<string, string> = { receive: 'text-green-400', ship: 'text-blue-400', move: 'text-amber-400', replenish: 'text-violet-300', adjust: 'text-nexus-accent2' };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard icon={<Package size={22} />} label="Товаров" value={stats.products} color="from-cyan-600 to-blue-700" />
        <KPICard icon={<MapPin size={22} />} label="Ячеек" value={stats.cells} color="from-blue-500 to-cyan-500" />
        <KPICard icon={<Activity size={22} />} label="Остаток (ед.)" value={stats.stock} color="from-emerald-500 to-green-600" />
        <KPICard icon={<Clock size={22} />} label="Операций сегодня" value={stats.opsToday} color="from-amber-500 to-orange-500" />
        <KPICard icon={<ArrowDownToLine size={22} />} label="Принято сегодня" value={stats.opsReceive} color="from-teal-500 to-emerald-500" />
        <KPICard icon={<ArrowUpFromLine size={22} />} label="Отгружено сегодня" value={stats.opsShip} color="from-rose-500 to-pink-500" />
      </div>

      {/* Empty state for new users */}
      {stats.products === 0 && stats.cells === 0 && (
        <div className="bg-gradient-to-br from-nexus-accent/10 to-nexus-accent2/10 border border-nexus-accent/30 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">🚀</div>
          <h2 className="text-nexus-text font-bold text-xl mb-2">Добро пожаловать в Storra WMS!</h2>
          <p className="text-nexus-text2 mb-5 max-w-lg mx-auto">Система готова к работе. Для быстрого старта загрузите демо-данные или начните добавлять товары и ячейки вручную.</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => navTo('settings')} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-6 py-3 rounded-xl text-sm font-bold transition-colors">
              ⚡ Загрузить демо-данные
            </button>
            <button onClick={() => navTo('products')} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border hover:border-nexus-border2 text-nexus-text px-6 py-3 rounded-xl text-sm font-medium transition-colors">
              📦 Добавить товары
            </button>
            <button onClick={() => navTo('cells')} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border hover:border-nexus-border2 text-nexus-text px-6 py-3 rounded-xl text-sm font-medium transition-colors">
              📍 Добавить ячейки
            </button>
          </div>
        </div>
      )}

      {/* Alerts */}
      {(stats.deficit > 0 || stats.activeOrders > 0) && (
        <div className="flex gap-4 flex-wrap">
          {stats.deficit > 0 && (
            <div className="flex-1 min-w-[300px] bg-red-950/40 border border-red-800/40 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-900/50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="text-red-400" size={24} />
              </div>
              <div>
                <div className="text-red-300 font-bold text-lg">{stats.deficit}</div>
                <div className="text-red-400/70 text-sm">Товаров ниже минимального остатка</div>
              </div>
            </div>
          )}
          {stats.activeOrders > 0 && (
            <div className="flex-1 min-w-[300px] bg-blue-950/40 border border-blue-800/40 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-900/50 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="text-blue-400" size={24} />
              </div>
              <div>
                <div className="text-blue-300 font-bold text-lg">{stats.activeOrders}</div>
                <div className="text-blue-400/70 text-sm">Активных заказов в работе</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Operations Chart */}
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
          <h3 className="text-nexus-text font-bold text-base mb-4">Операции за 7 дней</h3>
          {opsByDay ? (
            <Bar data={opsByDay} options={{ responsive: true, plugins: { legend: { labels: { color: '#8891a8', font: { size: 12 } } } }, scales: { x: { ticks: { color: '#555d78' }, grid: { color: 'rgba(42,47,62,0.5)' } }, y: { ticks: { color: '#555d78' }, grid: { color: 'rgba(42,47,62,0.5)' } } } }} />
          ) : (
            <div className="h-48 flex items-center justify-center text-nexus-text3">Нет данных</div>
          )}
        </div>

        {/* Top Products */}
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
          <h3 className="text-nexus-text font-bold text-base mb-4">Топ товаров (отгрузка, 30 дней)</h3>
          {topProducts.length > 0 ? (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={p.barcode} className="flex items-center gap-3 bg-nexus-surface2 rounded-xl px-4 py-2.5">
                  <span className="text-nexus-accent font-bold text-sm w-6">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-nexus-text text-sm font-medium truncate">{p.name}</div>
                    <div className="text-nexus-text3 text-xs font-mono">{p.barcode}</div>
                  </div>
                  <div className="text-nexus-accent2 font-bold">{p.qty}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-nexus-text3">Нет данных об отгрузках</div>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Operations */}
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
          <h3 className="text-nexus-text font-bold text-base mb-4">Последние операции</h3>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {recentOps.length > 0 ? recentOps.map(op => (
              <div key={op.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-nexus-surface2 transition-colors text-sm">
                <span className={`font-medium ${typeColor[op.type] || 'text-nexus-text3'}`}>
                  {typeLabel[op.type] || op.type}
                </span>
                <span className="text-nexus-text2 font-mono text-xs">{op.barcode || '—'}</span>
                <span className="text-nexus-text text-xs">{op.cell || op.source_cell || ''}</span>
                <span className="ml-auto text-nexus-text font-medium">{op.qty > 0 ? `×${op.qty}` : ''}</span>
                <span className="text-nexus-text3 text-xs">{formatDateTime(op.ts)}</span>
              </div>
            )) : (
              <div className="text-nexus-text3 text-center py-8">Операций пока нет</div>
            )}
          </div>
        </div>

        {/* Deficit */}
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
          <h3 className="text-nexus-text font-bold text-base mb-4">
            Дефицит товаров
            {deficitProducts.length > 0 && <span className="ml-2 text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full">{deficitProducts.length}</span>}
          </h3>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {deficitProducts.length > 0 ? deficitProducts.map(p => (
              <div key={p.barcode} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-red-950/20 border border-red-900/20 text-sm">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-nexus-text font-medium truncate">{p.name}</div>
                  <div className="text-nexus-text3 text-xs font-mono">{p.barcode}</div>
                </div>
                <div className="text-right">
                  <div className="text-red-400 font-bold">{p.currentStock}</div>
                  <div className="text-nexus-text3 text-xs">min: {p.min_stock}</div>
                </div>
              </div>
            )) : (
              <div className="text-nexus-text3 text-center py-8">
                <div className="text-2xl mb-2">✓</div>
                Дефицит не обнаружен
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, color }: { icon: ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4 relative overflow-hidden group hover:border-nexus-border2 transition-colors">
      <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${color} opacity-10 rounded-bl-[40px] group-hover:opacity-20 transition-opacity`} />
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white mb-3`}>
        {icon}
      </div>
      <div className="text-nexus-text2 text-xs font-medium mb-1">{label}</div>
      <div className="text-nexus-text font-bold text-2xl">{value.toLocaleString('ru-RU')}</div>
    </div>
  );
}
