import { Download, Edit3, Plus, Save,Search, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useRef,useState } from 'react';

import { toast } from '../App';
import { DropZone } from '../components/DropZone';
import { type Cell } from '../db';
import { useData } from '../hooks/useData';
import { downloadXLS } from '../lib/excel';
import { cellsApi } from '../lib/services';
import { exportToCSV,parseCSVFile, rowToObj } from '../utils';

const CELL_TYPES = ['pallet', 'box', 'shelf', 'oversize'] as const;
const CELL_STATUSES = ['free', 'occupied', 'blocked', 'quarantine'] as const;
const TYPE_LABELS: Record<string, string> = { pallet: 'Паллет', box: 'Короб', shelf: 'Полка', oversize: 'Крупногаб.' };
const STATUS_LABELS: Record<string, string> = { free: 'Свободна', occupied: 'Занята', blocked: 'Заблокир.', quarantine: 'Карантин' };
const STATUS_COLORS: Record<string, string> = { free: 'bg-green-900/40 text-green-400', occupied: 'bg-blue-900/40 text-blue-400', blocked: 'bg-red-900/40 text-red-400', quarantine: 'bg-amber-900/40 text-amber-400' };

export default function Cells() {
  // Данные читаем из общего DataProvider — он сам подписан на сервер.
  const { cells: allCells, getStockByCell, refresh } = useData();

  const [search, setSearch] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Cell | null>(null);
  const [form, setForm] = useState({ addr: '', zone: '', type: 'pallet' as Cell['type'], status: 'free' as Cell['status'], max_pallets: '', max_weight: '', max_units: '', allow_mixed_sku: '1', pick_priority: '', putaway_priority: '', is_picking_face: '0' });
  const [importReport, setImportReport] = useState<{ added: number; skipped: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cells = useMemo(() => {
    let items = allCells;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(c => c.addr.toLowerCase().includes(q) || (c.zone || '').toLowerCase().includes(q));
    }
    if (filterZone) items = items.filter(c => c.zone === filterZone);
    if (filterStatus) items = items.filter(c => c.status === filterStatus);
    if (filterType) items = items.filter(c => c.type === filterType);
    return [...items].sort((a, b) => a.addr.localeCompare(b.addr, 'ru'));
  }, [allCells, search, filterZone, filterStatus, filterType]);

  const zones = [...new Set(allCells.map(c => c.zone).filter(Boolean))].sort();

  function openAdd() { setEditItem(null); setForm({ addr: '', zone: '', type: 'pallet', status: 'free', max_pallets: '', max_weight: '', max_units: '', allow_mixed_sku: '1', pick_priority: '', putaway_priority: '', is_picking_face: '0' }); setShowModal(true); }
  function openEdit(c: Cell) { setEditItem(c); setForm({ addr: c.addr, zone: c.zone || '', type: c.type, status: c.status, max_pallets: c.max_pallets?.toString() || '', max_weight: c.max_weight?.toString() || '', max_units: c.max_units?.toString() || '', allow_mixed_sku: c.allow_mixed_sku === false ? '0' : '1', pick_priority: c.pick_priority?.toString() || '', putaway_priority: c.putaway_priority?.toString() || '', is_picking_face: c.is_picking_face ? '1' : '0' }); setShowModal(true); }

  async function saveCell() {
    if (!form.addr.trim()) { toast('error', 'Адрес ячейки обязателен'); return; }
    const addr = form.addr.trim();
    // Серверное API не поддерживает переименование адреса (это PRIMARY KEY).
    // Поэтому при редактировании оставляем addr исходным.
    if (editItem && editItem.addr !== addr) {
      toast('error', 'Адрес ячейки изменить нельзя. Создайте новую и удалите старую.');
      return;
    }
    if (!editItem) {
      const dup = allCells.find(c => c.addr === addr);
      if (dup) { toast('warning', 'Ячейка уже существует'); return; }
    }
        try {
      await cellsApi.upsert({
        addr,
        zone: form.zone.trim() || undefined,
        type: form.type,
        status: form.status,
        max_pallets: form.max_pallets ? Number(form.max_pallets) : undefined,
        max_weight: form.max_weight ? Number(form.max_weight) : undefined,
        max_units: form.max_units ? Number(form.max_units) : undefined,
        allow_mixed_sku: form.allow_mixed_sku === '1',
        pick_priority: form.pick_priority ? Number(form.pick_priority) : undefined,
        putaway_priority: form.putaway_priority ? Number(form.putaway_priority) : undefined,
        is_picking_face: form.is_picking_face === '1',
      });
      toast('success', editItem ? `Ячейка "${addr}" обновлена` : `Ячейка "${addr}" добавлена`);
      setShowModal(false);
      refresh();
    } catch (e: any) {
      toast('error', `Не удалось сохранить: ${e.message || e}`);
    }
  }

  async function deleteCell(addr: string) {
    const stock = getStockByCell(addr);
    if (stock.length > 0) { toast('error', 'Нельзя удалить ячейку с остатками'); return; }
    if (!confirm(`Удалить ячейку ${addr}?`)) return;
    try {
      await cellsApi.remove(addr);
      toast('info', `Ячейка ${addr} удалена`);
      refresh();
    } catch (e: any) {
      toast('error', `Не удалось удалить: ${e.message || e}`);
    }
  }

  async function importCSV(file: File) {
    try {
      const result = await parseCSVFile(file);
      const batch: Array<{ addr: string; zone?: string; row?: string; level?: string; type: 'pallet'|'box'|'shelf'|'oversize'; status: 'free'|'occupied'|'blocked'|'quarantine'; max_pallets?: number; max_weight?: number; max_units?: number; allow_mixed_sku?: boolean; pick_priority?: number; putaway_priority?: number; is_picking_face?: boolean }> = [];
      let errors = 0;
      for (const row of result.rows) {
        const obj = rowToObj(result.headers, row);
        const addr = (obj.addr || row[0] || '').trim();
        if (!addr || addr.length < 2) { errors++; continue; }
        const parts = addr.split('-');
        batch.push({
          addr, zone: obj.zone || parts[0] || undefined, row: parts[1], level: parts[2],
          type: (obj.type as any) || 'pallet', status: 'free',
          max_pallets: obj.max_pallets ? Number(obj.max_pallets) : undefined,
          max_weight: obj.max_weight ? Number(obj.max_weight) : undefined,
          max_units: obj.max_units ? Number(obj.max_units) : undefined,
          allow_mixed_sku: obj.allow_mixed_sku ? ['1','true','yes','y'].includes(String(obj.allow_mixed_sku).toLowerCase()) : true,
          pick_priority: obj.pick_priority ? Number(obj.pick_priority) : undefined,
          putaway_priority: obj.putaway_priority ? Number(obj.putaway_priority) : undefined,
          is_picking_face: obj.is_picking_face ? ['1','true','yes','y'].includes(String(obj.is_picking_face).toLowerCase()) : false,
        });
      }
      if (batch.length === 0) {
        toast('warning', `Ничего не импортировано (ошибок: ${errors})`);
        return;
      }
            const resp = await cellsApi.bulk(batch);
      setImportReport({ added: resp.added, skipped: resp.updated, errors });
      toast('success', `Импорт: +${resp.added} добавлено, ~${resp.updated} обновлено, ${errors} ошибок`);
      refresh();
    } catch (e: any) {
      toast('error', `Ошибка: ${e.message}`);
    }
  }

  function doExport() {
    const headers = ['Адрес', 'Зона', 'Ряд', 'Ярус', 'Тип', 'Статус', 'Макс. паллетов', 'Макс. вес', 'Макс. units', 'Mixed SKU', 'Pick prio', 'Putaway prio', 'Picking face'];
    const rows = cells.map(c => [c.addr, c.zone || '', c.row || '', c.level || '', c.type, c.status, String(c.max_pallets || ''), String(c.max_weight || ''), String(c.max_units || ''), c.allow_mixed_sku === false ? '0' : '1', String(c.pick_priority || ''), String(c.putaway_priority || ''), c.is_picking_face ? '1' : '0']);
    exportToCSV(headers, rows, 'cells.csv');
    toast('success', 'Ячейки экспортированы в CSV');
  }

  function doExportXLS() {
    downloadXLS('cells', {
      name: 'Ячейки',
      columns: [
        { header: 'Адрес', width: 14 },
        { header: 'Зона', width: 10 },
        { header: 'Ряд', width: 8 },
        { header: 'Ярус', width: 8 },
        { header: 'Тип', width: 12 },
        { header: 'Статус', width: 14 },
        { header: 'Макс. паллетов', width: 14 },
        { header: 'Макс. вес, кг', width: 14 },
        { header: 'Макс. units', width: 12 },
        { header: 'Mixed SKU', width: 10 },
        { header: 'Pick prio', width: 10 },
        { header: 'Putaway prio', width: 12 },
        { header: 'Picking face', width: 12 },
      ],
      rows: cells.map(c => [
        c.addr, c.zone || '', c.row || '', c.level || '',
        TYPE_LABELS[c.type] || c.type,
        STATUS_LABELS[c.status] || c.status,
        c.max_pallets ?? '',
        c.max_weight ?? '',
        c.max_units ?? '',
        c.allow_mixed_sku === false ? 'No' : 'Yes',
        c.pick_priority ?? '',
        c.putaway_priority ?? '',
        c.is_picking_face ? 'Yes' : 'No',
      ]),
    });
    toast('success', 'Ячейки экспортированы в Excel');
  }

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2">
          <Search size={16} className="text-nexus-text3" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по адресу, зоне..." className="bg-transparent text-nexus-text text-sm flex-1 outline-none placeholder:text-nexus-text3" />
        </div>

        <select value={filterZone} onChange={e => setFilterZone(e.target.value)} className="bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
          <option value="">Все зоны</option>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
          <option value="">Все статусы</option>
          {CELL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-nexus-surface border border-nexus-border rounded-xl px-3 py-2 text-nexus-text text-sm">
          <option value="">Все типы</option>
          {CELL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>

        <button onClick={openAdd} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-4 py-2 rounded-xl text-sm font-medium"><Plus size={16} /> Добавить</button>
        <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm"><Upload size={16} /> CSV</button>
        <button onClick={doExport} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm" title="Экспорт CSV"><Download size={16} /> CSV</button>
        <button onClick={doExportXLS} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm" title="Экспорт Excel"><Download size={16} /> Excel</button>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = ''; }} />
      </div>

      <DropZone
        accept=".csv,.txt,text/csv"
        onFile={importCSV}
        label="Перетащите CSV-файл с ячейками сюда или нажмите для выбора"
      />

      {importReport && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
          <div><div className="text-green-400 text-xl font-bold">{importReport.added}</div><div className="text-nexus-text3 text-xs">Добавлено</div></div>
          <div><div className="text-amber-400 text-xl font-bold">{importReport.skipped}</div><div className="text-nexus-text3 text-xs">Пропущено (дубли)</div></div>
          <div><div className="text-red-400 text-xl font-bold">{importReport.errors}</div><div className="text-nexus-text3 text-xs">Ошибок</div></div>
        </div>
      )}

      <div className="text-nexus-text3 text-sm">Всего: <span className="text-nexus-text font-medium">{cells.length}</span> ячеек</div>

      <div className="bg-nexus-surface border border-nexus-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-320px)]">
          <table className="w-full text-sm">
            <thead className="sticky-header">
              <tr className="border-b border-nexus-border bg-nexus-surface2">
                <th className="px-3 py-3 text-left text-nexus-text3 font-medium">Адрес</th>
                <th className="px-3 py-3 text-left text-nexus-text3 font-medium">Зона</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Ряд</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Ярус</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Тип</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Статус</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Макс. паллетов</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Макс. вес</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Units</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Mix</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Pick</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Putaway</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Face</th>
                <th className="px-3 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {cells.map(c => (
                <tr key={c.addr} className="border-b border-nexus-border/50 hover:bg-nexus-surface2/50 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-nexus-accent2 font-medium">{c.addr}</td>
                  <td className="px-3 py-2.5 text-nexus-text2">{c.zone || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.row || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.level || ''}</td>
                  <td className="px-3 py-2.5 text-center"><span className="text-xs bg-nexus-surface3 text-nexus-text2 px-2 py-0.5 rounded">{TYPE_LABELS[c.type] || c.type}</span></td>
                  <td className="px-3 py-2.5 text-center"><span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status]}</span></td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.max_pallets || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.max_weight || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.max_units || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.allow_mixed_sku === false ? 'No' : 'Yes'}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.pick_priority || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.putaway_priority || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2">{c.is_picking_face ? 'Yes' : ''}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-nexus-surface3 text-nexus-text3 hover:text-nexus-accent"><Edit3 size={14} /></button>
                      <button onClick={() => deleteCell(c.addr)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-nexus-text3 hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {cells.length === 0 && <tr><td colSpan={14} className="text-center py-12 text-nexus-text3">Нет ячеек. Импортируйте из CSV или добавьте вручную.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowModal(false)}>
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl w-full max-w-md animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-border">
              <h2 className="text-nexus-text font-bold text-lg">{editItem ? 'Редактирование ячейки' : 'Новая ячейка'}</h2>
              <button onClick={() => setShowModal(false)} className="text-nexus-text3 hover:text-nexus-text"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Адрес *</label>
                <input value={form.addr} onChange={e => setForm({ ...form, addr: e.target.value })} placeholder="90-118-1" disabled={!!editItem}
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono disabled:opacity-50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Зона</label>
                  <input value={form.zone} onChange={e => setForm({ ...form, zone: e.target.value })} placeholder="A, Б, В..."
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Тип</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as any })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
                    {CELL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Статус</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })}
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
                  {CELL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Макс. паллетов</label>
                  <input type="number" value={form.max_pallets} onChange={e => setForm({ ...form, max_pallets: e.target.value })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Макс. вес (кг)</label>
                  <input type="number" value={form.max_weight} onChange={e => setForm({ ...form, max_weight: e.target.value })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Макс. units</label>
                  <input type="number" value={form.max_units} onChange={e => setForm({ ...form, max_units: e.target.value })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Mixed SKU</label>
                  <select value={form.allow_mixed_sku} onChange={e => setForm({ ...form, allow_mixed_sku: e.target.value })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
                    <option value="1">Разрешено</option>
                    <option value="0">Запрещено</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Pick priority</label>
                  <input type="number" value={form.pick_priority} onChange={e => setForm({ ...form, pick_priority: e.target.value })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Putaway priority</label>
                  <input type="number" value={form.putaway_priority} onChange={e => setForm({ ...form, putaway_priority: e.target.value })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-nexus-text3 mb-1 block">Picking face</label>
                  <select value={form.is_picking_face} onChange={e => setForm({ ...form, is_picking_face: e.target.value })}
                    className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm">
                    <option value="0">Нет</option>
                    <option value="1">Да</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-nexus-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl text-nexus-text3 hover:text-nexus-text text-sm">Отмена</button>
              <button onClick={saveCell} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2 rounded-xl text-sm font-medium"><Save size={16} /> Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
