import { ChevronLeft, ChevronRight, Download, Edit3, FileJson, FileSpreadsheet, Plus, Printer,Save, Search, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo,useRef, useState } from 'react';

import { toast } from '../App';
import { DropZone } from '../components/DropZone';
import { type Category, db,type Product } from '../db';
import { useData } from '../hooks/useData';
import { downloadXLS } from '../lib/excel';
import { productsApi } from '../lib/services';
import { downloadFile, exportToCSV, parseCSVFile, rowToObj, todayRu } from '../utils';

// Тип, который мы шлём на сервер: оставляем только поля, которые есть в Product,
// без updated_at/created_at — их проставит сервер.
type ProductInput = Omit<Product, 'created_at' | 'updated_at' | 'deleted'>;

const EMPTY_PRODUCT: ProductInput = {
  barcode: '', name: '', category: '', supplier: '', unit: 'шт',
  weight_gross: undefined, weight_net: undefined, has_expiry: false, expiry_days: undefined,
  min_stock: undefined, max_stock: undefined,
};

/**
 * Очищает объект для отправки на сервер:
 *  - выкидывает пустые строки в опциональных полях (zod не примет 'A' в abc_class из пустой строки)
 *  - убирает undefined
 *  - не передаёт служебные поля.
 */
function sanitizeForApi(p: Partial<Product>): ProductInput {
  const out: any = {
    barcode: p.barcode!,
    name: p.name!,
    unit: p.unit || 'шт',
  };
  if (p.category) out.category = p.category;
  if (p.supplier) out.supplier = p.supplier;
  if (p.weight_gross !== undefined && p.weight_gross !== null && !Number.isNaN(p.weight_gross)) out.weight_gross = Math.round(Number(p.weight_gross));
  if (p.weight_net !== undefined && p.weight_net !== null && !Number.isNaN(p.weight_net)) out.weight_net = Math.round(Number(p.weight_net));
  if (p.dim_l !== undefined) out.dim_l = Math.round(Number(p.dim_l));
  if (p.dim_w !== undefined) out.dim_w = Math.round(Number(p.dim_w));
  if (p.dim_h !== undefined) out.dim_h = Math.round(Number(p.dim_h));
  if (p.has_expiry !== undefined) out.has_expiry = !!p.has_expiry;
  if (p.expiry_days !== undefined && !Number.isNaN(Number(p.expiry_days))) out.expiry_days = Math.round(Number(p.expiry_days));
  if (p.min_stock !== undefined && !Number.isNaN(Number(p.min_stock))) out.min_stock = Math.round(Number(p.min_stock));
  if (p.max_stock !== undefined && !Number.isNaN(Number(p.max_stock))) out.max_stock = Math.round(Number(p.max_stock));
  if (p.abc_class) out.abc_class = p.abc_class;
  if (p.xyz_class) out.xyz_class = p.xyz_class;
  return out;
}

export default function Products() {
  // ВСЁ читаем из централизованного DataProvider — он сам подкачивает с сервера
  // и реагирует на WS-эвенты. Поэтому после createOrUpdate ничего вручную обновлять не нужно.
  const { products: allProducts, refresh } = useData();

  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductInput>(EMPTY_PRODUCT);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(50);
  const [sortCol, setSortCol] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [_categories, _setCategories] = useState<Category[]>([]);
  const [filterCat, setFilterCat] = useState('');
  const [filterAbc, setFilterAbc] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);

  // Один раз грузим категории (они пока хранятся локально).
  useEffect(() => { db.categories.toArray().then(_setCategories); }, []);

  // Фильтрация/сортировка делается в памяти — это быстро для нескольких тысяч позиций
  // и моментально реагирует на изменения с сервера через useData().
  const products = useMemo(() => {
    let items = allProducts.filter(p => !p.deleted);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(p =>
        p.barcode.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.supplier || '').toLowerCase().includes(q)
      );
    }
    if (filterCat) items = items.filter(p => p.category === filterCat);
    if (filterAbc) items = items.filter(p => p.abc_class === filterAbc);
    return items.sort((a, b) => {
      const av = (a as any)[sortCol] || '';
      const bv = (b as any)[sortCol] || '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [allProducts, search, filterCat, filterAbc, sortCol, sortDir]);

  const totalPages = Math.ceil(products.length / perPage);
  const pageItems = products.slice(page * perPage, (page + 1) * perPage);

  function openAdd() { setEditItem(null); setForm({ ...EMPTY_PRODUCT }); setShowModal(true); }
  function openEdit(p: Product) {
    setEditItem(p);
    setForm({
      barcode: p.barcode, name: p.name, category: p.category || '', supplier: p.supplier || '',
      unit: p.unit || 'шт', weight_gross: p.weight_gross, weight_net: p.weight_net,
      has_expiry: p.has_expiry, expiry_days: p.expiry_days, min_stock: p.min_stock,
      max_stock: p.max_stock,
    });
    setShowModal(true);
  }

  async function saveProduct() {
    if (!form.barcode.trim() || !form.name.trim()) {
      toast('error', 'Штрихкод и наименование обязательны');
      return;
    }
    if (!editItem) {
      // Локальная проверка на дубликат барскода (даёт более понятное сообщение, чем 409 от сервера)
      const dup = allProducts.find(p => p.barcode === form.barcode.trim() && !p.deleted);
      if (dup) { toast('warning', `Товар со ШК ${form.barcode} уже существует`); return; }
    }
    setBusy(true);
    try {
      await productsApi.upsert(sanitizeForApi({ ...form, barcode: form.barcode.trim(), name: form.name.trim() }));
      toast('success', editItem ? `Товар "${form.name}" обновлён` : `Товар "${form.name}" добавлен`);
      setShowModal(false);
      // WS-эвент product:changed придёт сам и обновит useData(),
      // но на всякий случай (если WS отвалился) — явно дёргаем refresh.
      refresh();
    } catch (e: any) {
      toast('error', `Не удалось сохранить: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(barcode: string) {
    if (!confirm('Удалить товар? (мягкое удаление)')) return;
    try {
      await productsApi.remove(barcode);
      toast('info', 'Товар удалён');
      refresh();
    } catch (e: any) {
      toast('error', `Ошибка удаления: ${e.message || e}`);
    }
  }

  async function deleteSelected() {
    if (!confirm(`Удалить ${selected.size} товаров?`)) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const bc of selected) {
      try {
        await productsApi.remove(bc);
        ok++;
      } catch { fail++; }
    }
    toast(fail ? 'warning' : 'info', `Удалено ${ok}${fail ? `, не удалось: ${fail}` : ''}`);
    setSelected(new Set());
    setBusy(false);
    refresh();
  }

  async function importCSV(file: File) {
    try {
      const result = await parseCSVFile(file);
      // Собираем массив товаров для bulk-upsert, чтобы не делать N HTTP-запросов
      const batch: ProductInput[] = [];
      let errors = 0;
      for (const row of result.rows) {
        const obj = rowToObj(result.headers, row);
        const barcode = obj.barcode?.trim();
        const name = obj.name?.trim();
        if (!barcode || !name) { errors++; continue; }
        batch.push(sanitizeForApi({
          barcode, name,
          category: obj.category || '',
          supplier: obj.supplier || '',
          unit: obj.unit || 'шт',
        }));
      }
      if (batch.length === 0) {
        toast('warning', `Ничего не импортировано (ошибок строк: ${errors})`);
        return;
      }
      setBusy(true);
      const resp = await productsApi.bulk(batch);
      toast('success', `Импорт: +${resp.added} добавлено, ~${resp.updated} обновлено, ${errors} ошибок`);
      refresh();
    } catch (e: any) {
      toast('error', `Ошибка импорта: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  function exportCSV() {
    const headers = ['Штрихкод', 'Наименование', 'Категория', 'Поставщик', 'Ед.', 'Брутто', 'Нетто', 'Срок (дн.)', 'Мин.', 'Макс.', 'ABC', 'XYZ'];
    const rows = products.map(p => [p.barcode, p.name, p.category || '', p.supplier || '', p.unit, String(p.weight_gross || ''), String(p.weight_net || ''), String(p.expiry_days || ''), String(p.min_stock || ''), String(p.max_stock || ''), p.abc_class || '', p.xyz_class || '']);
    exportToCSV(headers, rows, 'products.csv');
    toast('success', 'Справочник товаров экспортирован в CSV');
  }

  function exportXLS() {
    downloadXLS('products', {
      name: 'Товары',
      columns: [
        { header: 'Штрихкод', width: 16 },
        { header: 'Наименование', width: 36 },
        { header: 'Категория', width: 14 },
        { header: 'Поставщик', width: 14 },
        { header: 'Ед.', width: 6 },
        { header: 'Брутто, кг', width: 10 },
        { header: 'Нетто, кг', width: 10 },
        { header: 'Срок, дн.', width: 10 },
        { header: 'Мин.', width: 8 },
        { header: 'Макс.', width: 8 },
        { header: 'ABC', width: 6 },
        { header: 'XYZ', width: 6 },
      ],
      rows: products.map(p => [
        p.barcode, p.name, p.category || '', p.supplier || '', p.unit,
        p.weight_gross ?? '', p.weight_net ?? '', p.expiry_days ?? '',
        p.min_stock ?? '', p.max_stock ?? '',
        p.abc_class || '', p.xyz_class || '',
      ]),
    });
    toast('success', 'Справочник товаров экспортирован в Excel');
  }

  async function exportJSON() {
    // На экспорт берём то, что сейчас в кэше (всё с сервера),
    // включая помеченные deleted — для архивных бэкапов.
    downloadFile(JSON.stringify(allProducts, null, 2), 'products.json', 'application/json');
    toast('success', 'JSON экспорт завершён');
  }

  async function importJSON(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data.products || [];
      const batch: ProductInput[] = [];
      for (const p of arr) {
        if (p.barcode && p.name) batch.push(sanitizeForApi(p));
      }
      if (batch.length === 0) {
        toast('warning', 'В файле нет валидных товаров');
        return;
      }
      setBusy(true);
      const resp = await productsApi.bulk(batch);
      toast('success', `Импортировано: +${resp.added}, обновлено ~${resp.updated}`);
      refresh();
    } catch (e: any) {
      toast('error', `Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  function SortIcon({ col }: { col: string }) {
    return sortCol === col ? <span className="text-nexus-accent ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span> : null;
  }

  function quickPrintSticker(barcode: string, name: string) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 300; canvas.height = 60;
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,300,60);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(barcode, 20, 40);
    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Стикер — ${barcode}</title>
    <style>@page{size:100mm 150mm;margin:0}*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,sans-serif;background:#fff;display:flex;justify-content:center;align-items:flex-start;padding:5mm}</style></head>
    <body><div style="width:100mm;height:150mm;border:0.3mm solid #000;display:flex;flex-direction:column;background:#fff;overflow:hidden;font-family:Arial,sans-serif">
    <div style="height:12mm;background:linear-gradient(135deg,#1e3a5c,#3a8ab0);display:flex;align-items:center;justify-content:space-between;padding:0 3mm;border-bottom:0.6mm solid #5fb6d9">
    <div style="color:#fff;font-size:8pt;font-weight:900">▣ STORRA WMS</div></div>
    <div style="padding:3mm;border-bottom:0.3mm solid #e0e0e0;min-height:20mm;display:flex;align-items:center">
    <div style="font-size:10pt;font-weight:800;color:#0a0a1a;word-break:break-word">${name}</div></div>
    <div style="height:2mm;background:linear-gradient(90deg,#5fb6d9,#3a8ab0,#7cc4dc)"></div>
    <div style="padding:3mm;text-align:center;background:#fafafa">
    <div style="font-size:4pt;color:#888;text-transform:uppercase;letter-spacing:2px">ШТРИХКОД</div>
    <div style="font-family:'Courier New',monospace;font-size:14pt;font-weight:800;letter-spacing:1px;color:#0a0a1a;margin-top:2mm">${barcode}</div>
    <div style="font-size:6pt;color:#666;margin-top:1mm">${todayRu()}</div>
    </div></div></body></html>`;
    const w = window.open('', '_blank', 'width=420,height=620');
    if (!w) { toast('error', 'Браузер заблокировал всплывающее окно — разрешите попапы'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-nexus-text">Товары</h2>
          <p className="text-sm text-nexus-text3 mt-1">Справочник номенклатуры — {products.length} активных, {allProducts.filter(p => p.deleted).length} в архиве</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={e => e.target.files && importCSV(e.target.files[0])} />
          <input ref={jsonFileRef} type="file" accept=".json" hidden onChange={e => e.target.files && importJSON(e.target.files[0])} />
          <DropZone onFile={importCSV} className="hidden lg:block" />
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-2 bg-nexus-surface2 hover:bg-nexus-surface3 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm disabled:opacity-50"><Upload size={16} /> CSV</button>
          <button onClick={() => jsonFileRef.current?.click()} disabled={busy} className="flex items-center gap-2 bg-nexus-surface2 hover:bg-nexus-surface3 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm disabled:opacity-50"><FileJson size={16} /> JSON</button>
          <button onClick={exportCSV} className="flex items-center gap-2 bg-nexus-surface2 hover:bg-nexus-surface3 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm"><Download size={16} /> CSV</button>
          <button onClick={exportXLS} className="flex items-center gap-2 bg-nexus-surface2 hover:bg-nexus-surface3 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm"><FileSpreadsheet size={16} /> XLS</button>
          <button onClick={exportJSON} className="flex items-center gap-2 bg-nexus-surface2 hover:bg-nexus-surface3 border border-nexus-border text-nexus-text px-3 py-2 rounded-xl text-sm"><FileJson size={16} /> JSON</button>
          <button onClick={openAdd} disabled={busy} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"><Plus size={16} /> Добавить</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Search size={18} className="text-nexus-text3" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Поиск: штрихкод, наименование, категория, поставщик..." className="flex-1 bg-transparent border-none text-nexus-text text-sm outline-none placeholder:text-nexus-text3" />
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-sm text-nexus-text">
          <option value="">Все категории</option>
          {Array.from(new Set(allProducts.map(p => p.category).filter(Boolean))).sort().map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterAbc} onChange={e => setFilterAbc(e.target.value)} className="bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2 text-sm text-nexus-text">
          <option value="">Все классы ABC</option>
          <option value="A">A</option><option value="B">B</option><option value="C">C</option>
        </select>
        {selected.size > 0 && (
          <button onClick={deleteSelected} disabled={busy} className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-xl text-sm disabled:opacity-50"><Trash2 size={16} /> Удалить ({selected.size})</button>
        )}
      </div>

      {/* Table */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-nexus-surface2 border-b border-nexus-border">
              <tr>
                <th className="px-3 py-3 w-10"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={e => { if (e.target.checked) setSelected(new Set(pageItems.map(p => p.barcode))); else setSelected(new Set()); }} className="rounded" /></th>
                <th className="px-3 py-3 text-left text-nexus-text3 font-medium cursor-pointer hover:text-nexus-text whitespace-nowrap" onClick={() => toggleSort('barcode')}>ШК <SortIcon col="barcode" /></th>
                <th className="px-3 py-3 text-left text-nexus-text3 font-medium cursor-pointer hover:text-nexus-text" onClick={() => toggleSort('name')}>Наименование <SortIcon col="name" /></th>
                <th className="px-3 py-3 text-left text-nexus-text3 font-medium whitespace-nowrap">Категория</th>
                <th className="px-3 py-3 text-left text-nexus-text3 font-medium whitespace-nowrap">Поставщик</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium w-12">Ед.</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium w-14">Срок</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium w-10">Min</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium w-10">Max</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium w-10">ABC</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium w-10">XYZ</th>
                <th className="px-3 py-3 text-center text-nexus-text3 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(p => {
                return (
                <tr key={p.barcode} className={`border-b border-nexus-border/50 hover:bg-nexus-surface2/50 transition-colors ${selected.has(p.barcode) ? 'bg-nexus-accent/5' : ''}`}>
                  <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(p.barcode)} onChange={e => { const s = new Set(selected); e.target.checked ? s.add(p.barcode) : s.delete(p.barcode); setSelected(s); }} className="rounded" /></td>
                  <td className="px-3 py-2.5 font-mono text-nexus-accent2 text-xs">{p.barcode}</td>
                  <td className="px-3 py-2.5 text-nexus-text font-medium max-w-[300px] truncate">{p.name}</td>
                  <td className="px-3 py-2.5 text-nexus-text2 text-xs">{p.category || ''}</td>
                  <td className="px-3 py-2.5 text-nexus-text2 text-xs">{p.supplier || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2 text-xs">{p.unit}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2 text-xs">{p.expiry_days || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2 text-xs">{p.min_stock || ''}</td>
                  <td className="px-3 py-2.5 text-center text-nexus-text2 text-xs">{p.max_stock || ''}</td>
                  <td className="px-3 py-2.5 text-center">{p.abc_class ? <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.abc_class === 'A' ? 'bg-green-900/40 text-green-400' : p.abc_class === 'B' ? 'bg-amber-900/40 text-amber-400' : 'bg-gray-700/40 text-gray-400'}`}>{p.abc_class}</span> : ''}</td>
                  <td className="px-3 py-2.5 text-center">{p.xyz_class ? <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.xyz_class === 'X' ? 'bg-blue-900/40 text-blue-400' : p.xyz_class === 'Y' ? 'bg-amber-900/40 text-amber-400' : 'bg-red-900/40 text-red-400'}`}>{p.xyz_class}</span> : ''}</td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => quickPrintSticker(p.barcode, p.name)} className="p-1.5 rounded-lg hover:bg-nexus-surface3 text-nexus-text3 hover:text-nexus-accent2 transition-colors" title="Печать стикера"><Printer size={13} /></button>
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-nexus-surface3 text-nexus-text3 hover:text-nexus-accent transition-colors"><Edit3 size={13} /></button>
                      <button onClick={() => deleteProduct(p.barcode)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-nexus-text3 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ); })}
              {pageItems.length === 0 && (
                <tr><td colSpan={12} className="text-center py-12 text-nexus-text3">
                  <div className="text-3xl mb-2">📦</div>
                  {search || filterCat || filterAbc ? 'Ничего не найдено. Попробуйте другие фильтры.' : 'Нет товаров. Добавьте или импортируйте из CSV.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-nexus-text3">
            <span>На странице:</span>
            <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(0); }} className="bg-nexus-surface border border-nexus-border rounded-lg px-2 py-1 text-nexus-text">
              {[50, 100, 500].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 rounded-lg bg-nexus-surface2 border border-nexus-border disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-sm text-nexus-text2">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-2 rounded-lg bg-nexus-surface2 border border-nexus-border disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowModal(false)}>
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-border">
              <h2 className="text-nexus-text font-bold text-lg">{editItem ? 'Редактирование товара' : 'Новый товар'}</h2>
              <button onClick={() => setShowModal(false)} className="text-nexus-text3 hover:text-nexus-text"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <Field label="Штрихкод *" disabled={!!editItem} value={form.barcode} onChange={v => setForm({ ...form, barcode: v })} />
              <div className="col-span-2"><Field label="Наименование *" value={form.name} onChange={v => setForm({ ...form, name: v })} /></div>
              <Field label="Категория" value={form.category || ''} onChange={v => setForm({ ...form, category: v })} />
              <Field label="Поставщик" value={form.supplier || ''} onChange={v => setForm({ ...form, supplier: v })} />
              <Field label="Единица" value={form.unit} onChange={v => setForm({ ...form, unit: v })} />
              <Field label="Вес брутто (кг)" type="number" value={form.weight_gross?.toString() || ''} onChange={v => setForm({ ...form, weight_gross: v ? Number(v) : undefined })} />
              <Field label="Вес нетто (кг)" type="number" value={form.weight_net?.toString() || ''} onChange={v => setForm({ ...form, weight_net: v ? Number(v) : undefined })} />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.has_expiry || false} onChange={e => setForm({ ...form, has_expiry: e.target.checked })} className="rounded accent-[var(--c-accent)]" />
                  <span className="text-sm text-nexus-text2">Есть срок годности</span>
                </label>
              </div>
              {form.has_expiry && <Field label="Срок (дней)" type="number" value={form.expiry_days?.toString() || ''} onChange={v => setForm({ ...form, expiry_days: v ? Number(v) : undefined })} />}
              <Field label="Мин. остаток" type="number" value={form.min_stock?.toString() || ''} onChange={v => setForm({ ...form, min_stock: v ? Number(v) : undefined })} />
              <Field label="Макс. остаток" type="number" value={form.max_stock?.toString() || ''} onChange={v => setForm({ ...form, max_stock: v ? Number(v) : undefined })} />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-nexus-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl text-nexus-text3 hover:text-nexus-text text-sm">Отмена</button>
              <button onClick={saveProduct} disabled={busy} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"><Save size={16} /> {busy ? 'Сохранение...' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', disabled = false, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-nexus-text3 mb-1 block">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm disabled:opacity-50 focus:border-nexus-accent/50 transition-colors" />
    </div>
  );
}
