import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler,Legend, LinearScale, LineElement, PointElement, Title, Tooltip } from 'chart.js';
import { BarChart2, Download, Grid3x3,PieChart, Play, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';

import { toast } from '../App';
import { db } from '../db';
import { productsApi } from '../lib/services';
import { exportToCSV } from '../utils';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler);

interface ABCItem {
  barcode: string; name: string; qty: number; share: number; cumulative: number; abc_class: string;
}

interface XYZItem {
  barcode: string; mean: number; sigma: number; cv: number; xyz_class: string;
}

export default function Analytics() {
  const [tab, setTab] = useState<'abc' | 'xyz' | 'matrix' | 'reports'>('abc');
  const [period, setPeriod] = useState(90);
  const [abcData, setAbcData] = useState<ABCItem[]>([]);
  const [abcTotals, setAbcTotals] = useState({ a: 0, b: 0, c: 0, aQty: 0, bQty: 0, cQty: 0 });
  const [xyzData, setXyzData] = useState<XYZItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function runABC() {
    setLoading(true);
    try {
      const since = Date.now() - period * 86400000;
      const ops = await db.ops.where('ts').above(since).and(o => o.type === 'ship').toArray();

      const map = new Map<string, number>();
      for (const op of ops) {
        if (op.barcode) map.set(op.barcode, (map.get(op.barcode) || 0) + (op.qty || 0));
      }

      const barcodes = [...map.keys()];
      const products = await db.products.bulkGet(barcodes);

      const items: ABCItem[] = [...map.entries()]
        .map(([barcode, qty]) => {
          const p = products.find(pr => pr && pr.barcode === barcode);
          return { barcode, name: p?.name || barcode, qty, share: 0, cumulative: 0, abc_class: 'C' };
        })
        .sort((a, b) => b.qty - a.qty);

      const totalQty = items.reduce((s, i) => s + i.qty, 0);
      let cumulative = 0;

      // Сначала считаем классы локально, потом одним bulk-запросом обновляем сервер.
      const updates: Array<{ barcode: string; abc_class: 'A' | 'B' | 'C' }> = [];
      for (const item of items) {
        const share = totalQty > 0 ? item.qty / totalQty : 0;
        cumulative += share;
        item.share = +(share * 100).toFixed(2);
        item.cumulative = +(cumulative * 100).toFixed(2);
        if (cumulative - share < 0.80) item.abc_class = 'A';
        else if (cumulative - share < 0.95) item.abc_class = 'B';
        else item.abc_class = 'C';
        updates.push({ barcode: item.barcode, abc_class: item.abc_class as 'A'|'B'|'C' });
      }
      try {
        // Грузим текущие записи с сервера, чтобы прокинуть их обязательные поля (name, unit)
        const productsForBulk = await Promise.all(updates.map(async u => {
          const p = await productsApi.get(u.barcode).catch(() => null);
          if (!p) return null;
          return { barcode: p.barcode, name: p.name, unit: p.unit || 'шт', abc_class: u.abc_class };
        }));
        const valid = productsForBulk.filter(Boolean) as Array<{ barcode: string; name: string; unit: string; abc_class: 'A'|'B'|'C' }>;
        if (valid.length) await productsApi.bulk(valid);
      } catch (err: any) {
        toast('warning', `ABC-классы сохранены локально, но не уехали на сервер: ${err.message || err}`);
      }

      setAbcData(items);
      setAbcTotals({
        a: items.filter(i => i.abc_class === 'A').length,
        b: items.filter(i => i.abc_class === 'B').length,
        c: items.filter(i => i.abc_class === 'C').length,
        aQty: items.filter(i => i.abc_class === 'A').reduce((s, i) => s + i.qty, 0),
        bQty: items.filter(i => i.abc_class === 'B').reduce((s, i) => s + i.qty, 0),
        cQty: items.filter(i => i.abc_class === 'C').reduce((s, i) => s + i.qty, 0),
      });

      toast('success', `ABC-анализ завершён: ${items.length} SKU за ${period} дней`);
    } catch (e: any) { toast('error', `Ошибка: ${e.message}`); }
    setLoading(false);
  }

  async function runXYZ() {
    setLoading(true);
    try {
      const since = Date.now() - period * 86400000;
      const weekMs = 7 * 86400000;
      const ops = await db.ops.where('ts').above(since).and(o => o.type === 'ship').toArray();

      const weeksMap = new Map<string, Map<number, number>>();
      for (const op of ops) {
        if (!op.barcode) continue;
        const weekKey = Math.floor((op.ts - since) / weekMs);
        if (!weeksMap.has(op.barcode)) weeksMap.set(op.barcode, new Map());
        weeksMap.get(op.barcode)!.set(weekKey, (weeksMap.get(op.barcode)!.get(weekKey) || 0) + op.qty);
      }

      const totalWeeks = Math.ceil(period / 7);
      const results: XYZItem[] = [];

      const xyzUpdates: Array<{ barcode: string; xyz_class: 'X'|'Y'|'Z' }> = [];
      for (const [barcode, weeklyMap] of weeksMap.entries()) {
        const qtys = Array.from({ length: totalWeeks }, (_, w) => weeklyMap.get(w) || 0);
        const mean = qtys.reduce((s, q) => s + q, 0) / totalWeeks;
        if (mean === 0) continue;
        const variance = qtys.reduce((s, q) => s + Math.pow(q - mean, 2), 0) / totalWeeks;
        const sigma = Math.sqrt(variance);
        const cv = sigma / mean;
        const xyz_class: 'X'|'Y'|'Z' = cv <= 0.10 ? 'X' : cv <= 0.25 ? 'Y' : 'Z';
        xyzUpdates.push({ barcode, xyz_class });
        results.push({ barcode, mean: +mean.toFixed(1), sigma: +sigma.toFixed(1), cv: +(cv * 100).toFixed(1), xyz_class });
      }
      try {
        const productsForBulk = await Promise.all(xyzUpdates.map(async u => {
          const p = await productsApi.get(u.barcode).catch(() => null);
          if (!p) return null;
          return { barcode: p.barcode, name: p.name, unit: p.unit || 'шт', xyz_class: u.xyz_class };
        }));
        const valid = productsForBulk.filter(Boolean) as Array<{ barcode: string; name: string; unit: string; xyz_class: 'X'|'Y'|'Z' }>;
        if (valid.length) await productsApi.bulk(valid);
      } catch (err: any) {
        toast('warning', `XYZ-классы сохранены локально, но не уехали на сервер: ${err.message || err}`);
      }

      setXyzData(results.sort((a, b) => a.cv - b.cv));
      toast('success', `XYZ-анализ завершён: ${results.length} SKU`);
    } catch (e: any) { toast('error', `Ошибка: ${e.message}`); }
    setLoading(false);
  }

  function exportABC() {
    const headers = ['ШК', 'Наименование', 'Кол-во', 'Доля %', 'Нарастающий %', 'ABC'];
    const rows = abcData.map(i => [i.barcode, i.name, String(i.qty), String(i.share), String(i.cumulative), i.abc_class]);
    exportToCSV(headers, rows, 'abc_analysis.csv');
  }

  function exportXYZ() {
    const headers = ['ШК', 'Среднее', 'σ', 'CV %', 'XYZ'];
    const rows = xyzData.map(i => [i.barcode, String(i.mean), String(i.sigma), String(i.cv), i.xyz_class]);
    exportToCSV(headers, rows, 'xyz_analysis.csv');
  }

  const tabs = [
    { id: 'abc' as const, label: 'ABC-анализ', icon: <BarChart2 size={18} /> },
    { id: 'xyz' as const, label: 'XYZ-анализ', icon: <TrendingUp size={18} /> },
    { id: 'matrix' as const, label: 'ABC×XYZ', icon: <Grid3x3 size={18} /> },
    { id: 'reports' as const, label: 'Отчёты', icon: <PieChart size={18} /> },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 bg-nexus-surface border border-nexus-border rounded-2xl p-1.5">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${tab === t.id ? 'bg-nexus-accent text-white' : 'text-nexus-text3 hover:text-nexus-text'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Period selector + Run */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2">
          <span className="text-nexus-text3 text-sm">Период:</span>
          <select value={period} onChange={e => setPeriod(Number(e.target.value))} className="bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-1 text-nexus-text text-sm">
            <option value={30}>30 дней</option><option value={90}>90 дней</option><option value={180}>180 дней</option><option value={365}>365 дней</option>
          </select>
        </div>
        <button onClick={tab === 'xyz' ? runXYZ : runABC} disabled={loading} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium">
          <Play size={16} /> {loading ? 'Выполняется...' : 'Запустить анализ'}
        </button>
      </div>

      {/* ABC Tab */}
      {tab === 'abc' && abcData.length > 0 && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-950/30 border border-green-800/30 rounded-2xl p-5 text-center">
              <div className="text-green-400 text-3xl font-bold">{abcTotals.a}</div>
              <div className="text-green-400/70 text-sm">A-товаров (80%)</div>
              <div className="text-green-400/50 text-xs mt-1">{abcTotals.aQty.toLocaleString()} ед. оборот</div>
            </div>
            <div className="bg-amber-950/30 border border-amber-800/30 rounded-2xl p-5 text-center">
              <div className="text-amber-400 text-3xl font-bold">{abcTotals.b}</div>
              <div className="text-amber-400/70 text-sm">B-товаров (15%)</div>
              <div className="text-amber-400/50 text-xs mt-1">{abcTotals.bQty.toLocaleString()} ед. оборот</div>
            </div>
            <div className="bg-gray-800/30 border border-gray-700/30 rounded-2xl p-5 text-center">
              <div className="text-gray-400 text-3xl font-bold">{abcTotals.c}</div>
              <div className="text-gray-400/70 text-sm">C-товаров (5%)</div>
              <div className="text-gray-400/50 text-xs mt-1">{abcTotals.cQty.toLocaleString()} ед. оборот</div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
              <h3 className="text-nexus-text font-bold mb-4">Кривая Парето (нарастающий итог)</h3>
              <Line data={{
                labels: abcData.slice(0, 50).map((_, i) => i + 1),
                datasets: [
                  { label: 'Нарастающий %', data: abcData.slice(0, 50).map(i => i.cumulative), borderColor: '#5fb6d9', backgroundColor: 'rgba(95,182,217,0.12)', fill: true, tension: 0.3, pointRadius: 0 },
                  { label: '80%', data: Array(50).fill(80), borderColor: '#22c55e', borderDash: [5, 5], pointRadius: 0 },
                  { label: '95%', data: Array(50).fill(95), borderColor: '#f59e0b', borderDash: [5, 5], pointRadius: 0 },
                ],
              }} options={{ responsive: true, plugins: { legend: { labels: { color: '#8891a8' } } }, scales: { x: { ticks: { color: '#555d78' }, grid: { color: 'rgba(42,47,62,0.5)' } }, y: { ticks: { color: '#555d78' }, grid: { color: 'rgba(42,47,62,0.5)' }, max: 100 } } }} />
            </div>

            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
              <h3 className="text-nexus-text font-bold mb-4">Распределение по классам</h3>
              <div className="max-w-[280px] mx-auto">
                <Doughnut data={{
                  labels: ['A-товары', 'B-товары', 'C-товары'],
                  datasets: [{ data: [abcTotals.a, abcTotals.b, abcTotals.c], backgroundColor: ['#22c55e', '#f59e0b', '#9ca3af'], borderWidth: 0 }],
                }} options={{ responsive: true, plugins: { legend: { labels: { color: '#8891a8' } } } }} />
              </div>
            </div>
          </div>

          {/* Top 20 bar chart */}
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-nexus-text font-bold">Топ-20 товаров по отгрузке</h3>
              <button onClick={exportABC} className="flex items-center gap-2 text-sm text-nexus-text3 hover:text-nexus-text"><Download size={14} /> CSV</button>
            </div>
            <Bar data={{
              labels: abcData.slice(0, 20).map(i => i.name.slice(0, 20)),
              datasets: [{ label: 'Отгрузка', data: abcData.slice(0, 20).map(i => i.qty),
                backgroundColor: abcData.slice(0, 20).map(i => i.abc_class === 'A' ? 'rgba(34,197,94,0.7)' : i.abc_class === 'B' ? 'rgba(245,158,11,0.7)' : 'rgba(156,163,175,0.7)'), borderRadius: 6 }],
            }} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#555d78', font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: '#555d78' }, grid: { color: 'rgba(42,47,62,0.5)' } } } }} />
          </div>

          {/* Full table */}
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky-header"><tr className="border-b border-nexus-border bg-nexus-surface2">
                  <th className="px-3 py-3 text-left text-nexus-text3 font-medium">#</th>
                  <th className="px-3 py-3 text-left text-nexus-text3 font-medium">ШК</th>
                  <th className="px-3 py-3 text-left text-nexus-text3 font-medium">Наименование</th>
                  <th className="px-3 py-3 text-right text-nexus-text3 font-medium">Отгрузка</th>
                  <th className="px-3 py-3 text-right text-nexus-text3 font-medium">Доля %</th>
                  <th className="px-3 py-3 text-right text-nexus-text3 font-medium">Нар. %</th>
                  <th className="px-3 py-3 text-center text-nexus-text3 font-medium">ABC</th>
                </tr></thead>
                <tbody>
                  {abcData.map((item, i) => (
                    <tr key={item.barcode} className="border-b border-nexus-border/50 hover:bg-nexus-surface2/50">
                      <td className="px-3 py-2 text-nexus-text3">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-nexus-accent2 text-xs">{item.barcode}</td>
                      <td className="px-3 py-2 text-nexus-text truncate max-w-[200px]">{item.name}</td>
                      <td className="px-3 py-2 text-right text-nexus-text font-medium">{item.qty}</td>
                      <td className="px-3 py-2 text-right text-nexus-text2">{item.share}%</td>
                      <td className="px-3 py-2 text-right text-nexus-text2">{item.cumulative}%</td>
                      <td className="px-3 py-2 text-center"><span className={`text-xs font-bold px-2 py-0.5 rounded ${item.abc_class === 'A' ? 'bg-green-900/40 text-green-400' : item.abc_class === 'B' ? 'bg-amber-900/40 text-amber-400' : 'bg-gray-700/40 text-gray-400'}`}>{item.abc_class}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* XYZ Tab */}
      {tab === 'xyz' && xyzData.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-950/30 border border-blue-800/30 rounded-2xl p-5 text-center">
              <div className="text-blue-400 text-3xl font-bold">{xyzData.filter(i => i.xyz_class === 'X').length}</div>
              <div className="text-blue-400/70 text-sm">X (CV ≤ 10%)</div>
            </div>
            <div className="bg-amber-950/30 border border-amber-800/30 rounded-2xl p-5 text-center">
              <div className="text-amber-400 text-3xl font-bold">{xyzData.filter(i => i.xyz_class === 'Y').length}</div>
              <div className="text-amber-400/70 text-sm">Y (CV ≤ 25%)</div>
            </div>
            <div className="bg-red-950/30 border border-red-800/30 rounded-2xl p-5 text-center">
              <div className="text-red-400 text-3xl font-bold">{xyzData.filter(i => i.xyz_class === 'Z').length}</div>
              <div className="text-red-400/70 text-sm">Z (CV {'>'} 25%)</div>
            </div>
          </div>

          <div className="bg-nexus-surface border border-nexus-border rounded-2xl overflow-hidden">
            <div className="flex justify-end p-3"><button onClick={exportXYZ} className="flex items-center gap-2 text-sm text-nexus-text3 hover:text-nexus-text"><Download size={14} /> CSV</button></div>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky-header"><tr className="border-b border-nexus-border bg-nexus-surface2">
                  <th className="px-3 py-3 text-left text-nexus-text3">#</th>
                  <th className="px-3 py-3 text-left text-nexus-text3">ШК</th>
                  <th className="px-3 py-3 text-right text-nexus-text3">Среднее/нед</th>
                  <th className="px-3 py-3 text-right text-nexus-text3">σ</th>
                  <th className="px-3 py-3 text-right text-nexus-text3">CV %</th>
                  <th className="px-3 py-3 text-center text-nexus-text3">XYZ</th>
                </tr></thead>
                <tbody>
                  {xyzData.map((item, i) => (
                    <tr key={item.barcode} className="border-b border-nexus-border/50 hover:bg-nexus-surface2/50">
                      <td className="px-3 py-2 text-nexus-text3">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-nexus-accent2 text-xs">{item.barcode}</td>
                      <td className="px-3 py-2 text-right text-nexus-text">{item.mean}</td>
                      <td className="px-3 py-2 text-right text-nexus-text2">{item.sigma}</td>
                      <td className="px-3 py-2 text-right text-nexus-text">{item.cv}%</td>
                      <td className="px-3 py-2 text-center"><span className={`text-xs font-bold px-2 py-0.5 rounded ${item.xyz_class === 'X' ? 'bg-blue-900/40 text-blue-400' : item.xyz_class === 'Y' ? 'bg-amber-900/40 text-amber-400' : 'bg-red-900/40 text-red-400'}`}>{item.xyz_class}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Matrix Tab */}
      {tab === 'matrix' && abcData.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            {['A', 'B', 'C'].map(abc => (
              <div key={abc} className="col-span-1">
                {['X', 'Y', 'Z'].map(xyz => {
                  const abcItems = abcData.filter(a => a.abc_class === abc);
                  const xyzItems = xyzData.filter(x => x.xyz_class === xyz);
                  const intersection = abcItems.filter(a => xyzItems.some(x => x.barcode === a.barcode));
                  const recommendations: Record<string, string> = {
                    AX: 'Золотой запас: точное прогнозирование', AY: 'Высокая ценность: страховой запас 20-30%', AZ: 'Работа под заказ или большой буфер',
                    BX: 'Периодические заказы', BY: 'Мониторинг сезонности', BZ: 'Снижение запаса',
                    CX: 'Мин. запас, редкие пополнения', CY: 'Низкий приоритет', CZ: 'Кандидат на вывод из ассортимента',
                  };
                  const colors: Record<string, string> = {
                    AX: 'bg-green-900/30 border-green-700/30', AY: 'bg-green-900/20 border-green-800/20', AZ: 'bg-green-900/10 border-green-800/10',
                    BX: 'bg-amber-900/20 border-amber-800/20', BY: 'bg-amber-900/10 border-amber-800/10', BZ: 'bg-amber-900/10 border-amber-800/10',
                    CX: 'bg-gray-800/20 border-gray-700/20', CY: 'bg-gray-800/10 border-gray-700/10', CZ: 'bg-red-900/10 border-red-800/10',
                  };
                  return (
                    <div key={abc + xyz} className={`border rounded-xl p-3 mb-2 ${colors[abc + xyz]}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-nexus-text text-sm">{abc}{xyz}</span>
                        <span className="text-nexus-accent2 font-bold text-lg">{intersection.length}</span>
                      </div>
                      <div className="text-nexus-text3 text-xs">{recommendations[abc + xyz]}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reports Tab */}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

function ReportsTab() {
  const [reports, setReports] = useState<any[]>([]);

  async function loadDeficit() {
    const products = await db.products.filter(p => !p.deleted).toArray();
    const items = [];
    for (const p of products) {
      if (p.min_stock && p.min_stock > 0) {
        const stock = await db.stock.where('barcode').equals(p.barcode).toArray();
        const total = stock.reduce((s, st) => s + st.qty, 0);
        if (total < p.min_stock) items.push({ ...p, currentStock: total, deficit: p.min_stock - total });
      }
    }
    setReports(items);
  }

  async function loadNelikvid() {
    const days = 90;
    const since = Date.now() - days * 86400000;
    const products = await db.products.filter(p => !p.deleted).toArray();
    const ops = await db.ops.where('ts').above(since).toArray();
    const movedBarcodes = new Set(ops.filter(o => o.barcode).map(o => o.barcode));
    const items = products.filter(p => !movedBarcodes.has(p.barcode));
    
    const enriched = [];
    for (const p of items) {
      const stock = await db.stock.where('barcode').equals(p.barcode).toArray();
      const total = stock.reduce((s, st) => s + st.qty, 0);
      if (total > 0) enriched.push({ ...p, currentStock: total });
    }
    setReports(enriched);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <button onClick={loadDeficit} className="flex items-center gap-2 bg-red-900/30 border border-red-700/30 text-red-300 px-4 py-2.5 rounded-xl text-sm hover:bg-red-900/50">
          <span>🔴</span> Дефицит (остаток {'<'} Min)
        </button>
        <button onClick={loadNelikvid} className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/30 text-amber-300 px-4 py-2.5 rounded-xl text-sm hover:bg-amber-900/50">
          <span>🟡</span> Неликвиды (нет движения 90д)
        </button>
      </div>

      {reports.length > 0 && (
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-nexus-border flex items-center justify-between">
            <span className="text-nexus-text font-medium text-sm">Найдено: {reports.length}</span>
            <button onClick={() => exportToCSV(['ШК', 'Наименование', 'Остаток', 'Мин', 'Дефицит'].slice(0, reports[0]?.deficit ? 5 : 3),
              reports.map(r => [r.barcode, r.name, r.currentStock, r.min_stock || '', r.deficit || '']), 'report.csv')}
              className="flex items-center gap-2 text-sm text-nexus-text3 hover:text-nexus-text"><Download size={14} /> Экспорт</button>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky-header"><tr className="border-b border-nexus-border bg-nexus-surface2">
                <th className="px-3 py-3 text-left text-nexus-text3">ШК</th>
                <th className="px-3 py-3 text-left text-nexus-text3">Наименование</th>
                <th className="px-3 py-3 text-center text-nexus-text3">Остаток</th>
                {reports[0]?.min_stock && <th className="px-3 py-3 text-center text-nexus-text3">Мин</th>}
                {reports[0]?.deficit && <th className="px-3 py-3 text-center text-nexus-text3">Дефицит</th>}
              </tr></thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.barcode} className="border-b border-nexus-border/50 hover:bg-nexus-surface2/50">
                    <td className="px-3 py-2 font-mono text-nexus-accent2 text-xs">{r.barcode}</td>
                    <td className="px-3 py-2 text-nexus-text">{r.name}</td>
                    <td className="px-3 py-2 text-center text-nexus-text">{r.currentStock}</td>
                    {r.min_stock && <td className="px-3 py-2 text-center text-nexus-text2">{r.min_stock}</td>}
                    {r.deficit && <td className="px-3 py-2 text-center text-red-400 font-bold">{r.deficit}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
