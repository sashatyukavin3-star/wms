import { Eye, MapPin,Package, Plus, Printer, Search, X } from 'lucide-react';
import { useEffect, useRef,useState } from 'react';

import { toast } from '../App';
import { type Cell,db, type Product } from '../db';
import { barcodeToDataURL, formatBarcodeDisplay,renderBarcode, todayRu } from '../utils';

interface StickerData {
  barcode: string;
  name: string;
  qty: number;
  unit: string;
  cell: string;
  batch: string;
  expiry: string;
  operator: string;
  copies: number;
}

const EMPTY_STICKER: StickerData = {
  barcode: '', name: '', qty: 1, unit: 'шт', cell: '', batch: '', expiry: '', operator: '', copies: 1,
};

export default function Stickers() {
  const [template, setTemplate] = useState<'6x6' | '10x15'>('10x15');
  const [stickers, setStickers] = useState<StickerData[]>([{ ...EMPTY_STICKER }]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allCells, setAllCells] = useState<Cell[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  const barcodeCanvasBigRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    db.products.filter(p => !p.deleted).toArray().then(setAllProducts);
    db.cells.toArray().then(setAllCells);
    db.settings.get('default_operator').then(s => {
      if (s?.value) setStickers(prev => prev.map(st => ({ ...st, operator: s.value })));
    });
  }, []);

  // Render preview barcode
  useEffect(() => {
    const s = stickers[previewIdx];
    if (!s) return;
    const bc = s.barcode || '4600000000000';
    if (barcodeCanvasRef.current) {
      renderBarcode(barcodeCanvasRef.current, bc, { width: 200, height: 40 });
    }
    if (barcodeCanvasBigRef.current) {
      renderBarcode(barcodeCanvasBigRef.current, bc, { width: 320, height: 64 });
    }
  }, [previewIdx, stickers]);

  function update(i: number, field: keyof StickerData, value: any) {
    setStickers(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      // Auto-fill name from barcode
      if (field === 'barcode') {
        const p = allProducts.find(p => p.barcode === value);
        if (p) {
          next[i].name = p.name;
          next[i].unit = p.unit || 'шт';
        }
      }
      return next;
    });
  }

  function addRow() {
    setStickers(prev => [...prev, { ...EMPTY_STICKER, operator: prev[0]?.operator || '' }]);
  }

  function removeRow(i: number) {
    if (stickers.length <= 1) return;
    setStickers(prev => prev.filter((_, idx) => idx !== i));
    if (previewIdx >= stickers.length - 1) setPreviewIdx(Math.max(0, stickers.length - 2));
  }

  function duplicateRow(i: number) {
    setStickers(prev => {
      const copy = { ...prev[i], copies: 1 };
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
  }

  // Search products/cells
  function doSearch(q: string) {
    setSearchQ(q);
    if (q.length < 1) { setSearchResults([]); setShowSearch(false); return; }
    const ql = q.toLowerCase();
    const prods = allProducts.filter(p => p.barcode.toLowerCase().includes(ql) || p.name.toLowerCase().includes(ql)).slice(0, 8).map(p => ({ type: 'product' as const, data: p }));
    const cells = allCells.filter(c => c.addr.toLowerCase().includes(ql)).slice(0, 5).map(c => ({ type: 'cell' as const, data: c }));
    setSearchResults([...prods, ...cells]);
    setShowSearch(true);
  }

  function selectSearchResult(item: any) {
    if (item.type === 'product') {
      const p = item.data as Product;
      setStickers(prev => [...prev, {
        barcode: p.barcode, name: p.name, qty: 1, unit: p.unit || 'шт',
        cell: '', batch: '', expiry: '', operator: prev[0]?.operator || '', copies: 1,
      }]);
    } else {
      const c = item.data as Cell;
      setStickers(prev => [...prev, {
        barcode: c.addr, name: `Ячейка ${c.addr}`, qty: 1, unit: '',
        cell: c.addr, batch: '', expiry: '', operator: prev[0]?.operator || '', copies: 1,
      }]);
    }
    setSearchQ('');
    setShowSearch(false);
    setPreviewIdx(stickers.length);
    toast('success', 'Добавлено в список');
  }

  function loadAllProducts() {
    const items = allProducts.slice(0, 50).map(p => ({
      barcode: p.barcode, name: p.name, qty: 1, unit: p.unit || 'шт',
      cell: '', batch: '', expiry: '', operator: stickers[0]?.operator || '', copies: 1,
    }));
    setStickers(items);
    setPreviewIdx(0);
    toast('info', `Загружено ${items.length} товаров`);
  }

  function loadAllCells() {
    const items = allCells.slice(0, 50).map(c => ({
      barcode: c.addr, name: `Ячейка ${c.addr}`, qty: 1, unit: '',
      cell: c.addr, batch: '', expiry: '', operator: stickers[0]?.operator || '', copies: 1,
    }));
    setStickers(items);
    setPreviewIdx(0);
    toast('info', `Загружено ${items.length} ячеек`);
  }

  // ═══════════════════════════════════════════════════════════
  // PRINT STICKERS
  // ═══════════════════════════════════════════════════════════
  function printStickers() {
    const valid = stickers.filter(s => s.barcode.trim());
    if (!valid.length) { toast('error', 'Нет стикеров с заполненным штрихкодом'); return; }

    // Expand copies
    const expanded: StickerData[] = [];
    for (const s of valid) {
      for (let c = 0; c < Math.min(s.copies || 1, 100); c++) expanded.push(s);
    }

    const isSmall = template === '6x6';
    const cols = isSmall ? 3 : 2;
    const sw = isSmall ? 60 : 100;
    const sh = isSmall ? 60 : 150;

    // Generate barcode images as data URLs
    const bcImages: Record<number, string> = {};
    const bcW = isSmall ? 200 : 320;
    const bcH = isSmall ? 40 : 64;
    for (let i = 0; i < expanded.length; i++) {
      bcImages[i] = barcodeToDataURL(expanded[i].barcode, bcW, bcH);
    }

    const today = todayRu();
    const stickersHtml = expanded.map((s, idx) => {
      const bcImg = bcImages[idx];
      if (isSmall) {
        return `<div style="width:${sw}mm;height:${sh}mm;border:0.3mm solid #000;display:flex;flex-direction:column;background:#fff;page-break-inside:avoid;overflow:hidden;font-family:Arial,sans-serif;">
          <div style="height:7mm;background:#1e3a5c;display:flex;align-items:center;justify-content:space-between;padding:0 2mm;">
            <span style="color:#fff;font-size:5.5pt;font-weight:900">▣ STORRA WMS</span>
            <span style="color:#aaa;font-size:4pt">6.0</span>
          </div>
          <div style="padding:1.5mm 2mm;border-bottom:0.2mm solid #ccc;flex:1;display:flex;align-items:center;min-height:12mm;max-height:15mm;">
            <div style="font-size:7pt;font-weight:700;line-height:1.25;word-break:break-word;color:#000;overflow:hidden;max-height:15mm">${escHtml(s.name) || '—'}</div>
          </div>
          <div style="padding:1mm 2mm 0.5mm;border-bottom:0.2mm solid #ccc;text-align:center;">
            <img src="${bcImg}" style="width:52mm;height:10mm;image-rendering:crisp-edges" />
            <div style="font-family:'Courier New',monospace;font-size:4.5pt;letter-spacing:1.5px;color:#000;margin-top:0.3mm;font-weight:600">${escHtml(s.barcode)}</div>
          </div>
          <div style="height:8mm;display:flex;align-items:center;padding:0 2mm;border-bottom:0.2mm solid #ccc;gap:1.5mm;">
            <span style="font-size:4.5pt;color:#666;font-weight:600;text-transform:uppercase">Кол-во:</span>
            <span style="font-size:13pt;font-weight:900;color:#1e3a5c;line-height:1">${s.qty}</span>
            <span style="font-size:5pt;color:#888">${escHtml(s.unit)}</span>
          </div>
          <div style="height:7mm;background:#f5f5f5;display:flex;align-items:center;justify-content:space-between;padding:0 2mm;font-size:4.5pt;color:#444;">
            <span>📦 ${escHtml(s.cell) || '—'}</span>
            <span>📅 ${today}</span>
          </div>
        </div>`;
      } else {
        return `<div style="width:${sw}mm;height:${sh}mm;border:0.3mm solid #000;display:flex;flex-direction:column;background:#fff;page-break-inside:avoid;overflow:hidden;font-family:Arial,sans-serif;">
          <div style="height:11mm;background:linear-gradient(135deg,#1e3a5c,#3a8ab0);display:flex;align-items:center;justify-content:space-between;padding:0 3mm;border-bottom:0.6mm solid #5fb6d9;">
            <div style="display:flex;align-items:center;gap:2mm;">
              <div style="width:7mm;height:7mm;background:#5fb6d9;border-radius:1.2mm;display:flex;align-items:center;justify-content:center;font-size:8pt;color:#fff;font-weight:900">▣</div>
              <div>
                <div style="color:#fff;font-size:7.5pt;font-weight:900;letter-spacing:1px">STORRA WMS</div>
                <div style="color:#8888cc;font-size:4pt;letter-spacing:0.5px">Warehouse Management 6.0</div>
              </div>
            </div>
          </div>
          <div style="padding:2.5mm 3mm;border-bottom:0.2mm solid #e0e0e0;min-height:18mm;display:flex;align-items:center;">
            <div style="font-size:9.5pt;font-weight:800;line-height:1.3;color:#0a0a1a;word-break:break-word;overflow:hidden;max-height:20mm">${escHtml(s.name) || '—'}</div>
          </div>
          <div style="height:1.5mm;background:linear-gradient(90deg,#5fb6d9,#3a8ab0,#7cc4dc);flex-shrink:0"></div>
          <div style="padding:2.5mm 3mm 1.5mm;text-align:center;background:#fafafa;">
            <div style="font-size:3.5pt;color:#999;text-transform:uppercase;letter-spacing:2px;margin-bottom:1mm">штрихкод / barcode</div>
            <img src="${bcImg}" style="width:88mm;height:16mm;image-rendering:crisp-edges" />
            <div style="font-family:'Courier New',monospace;font-size:6pt;font-weight:700;letter-spacing:2.5px;color:#000;margin-top:0.8mm">${escHtml(s.barcode)}</div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5mm;">
            <div style="font-size:4pt;color:#999;text-transform:uppercase;letter-spacing:2.5px;margin-bottom:1.5mm">количество</div>
            <div style="border:0.5mm solid #1a1a2e;border-radius:1.5mm;padding:1.5mm 4mm;display:flex;align-items:center;gap:2.5mm;background:#f8f8ff;">
              <span style="font-size:24pt;font-weight:900;color:#1e3a5c;line-height:1">${s.qty}</span>
              <span style="font-size:7pt;font-weight:700;color:#666;border-left:0.2mm solid #ccc;padding-left:2mm">${escHtml(s.unit)}</span>
            </div>
          </div>
          <div style="background:#f0f0f8;border-top:0.2mm solid #ddd;padding:1.5mm 3mm;display:grid;grid-template-columns:1fr 1fr;gap:0.8mm;font-size:4.5pt;color:#444;">
            <div>📦 Ячейка: <b style="color:#000">${escHtml(s.cell) || '—'}</b></div>
            <div>📅 Дата: <b style="color:#000">${today}</b></div>
            <div>👤 Оператор: <b style="color:#000">${escHtml(s.operator) || '—'}</b></div>
            <div>📋 Партия: <b style="color:#000">${escHtml(s.batch) || '—'}</b></div>
            ${s.expiry ? `<div style="grid-column:1/-1">⏳ Срок годности: <b style="color:#d32f2f">${escHtml(s.expiry)}</b></div>` : ''}
          </div>
        </div>`;
      }
    }).join('\n');

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Стикеры — STORRA WMS</title>
    <style>
      @page { size: A4; margin: 5mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: Arial, sans-serif; background: #fff; }
      .sheet { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 0; }
      @media print { .sheet { gap: 0; } }
    </style></head>
    <body><div class="sheet">${stickersHtml}</div>
    <script>setTimeout(function(){window.print()},400);</script>
    </body></html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) { win.document.write(html); win.document.close(); }
  }

  const validCount = stickers.filter(s => s.barcode.trim()).reduce((sum, s) => sum + (s.copies || 1), 0);

  const currentSticker = stickers[previewIdx];

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <h2 className="text-nexus-text font-bold text-lg">🏷 Редактор стикеров</h2>
          <div className="flex bg-nexus-surface2 border border-nexus-border rounded-xl overflow-hidden">
            <button onClick={() => setTemplate('6x6')} className={`px-4 py-2 text-sm font-medium transition-colors ${template === '6x6' ? 'bg-nexus-accent text-white' : 'text-nexus-text3 hover:text-nexus-text'}`}>6×6 см</button>
            <button onClick={() => setTemplate('10x15')} className={`px-4 py-2 text-sm font-medium transition-colors ${template === '10x15' ? 'bg-nexus-accent text-white' : 'text-nexus-text3 hover:text-nexus-text'}`}>10×15 см</button>
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={loadAllProducts} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border hover:border-nexus-border2 text-nexus-text px-3 py-2 rounded-xl text-sm transition-colors"><Package size={14} /> Все товары</button>
            <button onClick={loadAllCells} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border hover:border-nexus-border2 text-nexus-text px-3 py-2 rounded-xl text-sm transition-colors"><MapPin size={14} /> Все ячейки</button>
            <button onClick={printStickers} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2 rounded-xl text-sm font-bold transition-colors"><Printer size={16} /> Печать ({validCount} шт.)</button>
          </div>
        </div>

        {/* Quick search */}
        <div className="relative mb-4">
          <div className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2">
            <Search size={16} className="text-nexus-text3" />
            <input value={searchQ} onChange={e => doSearch(e.target.value)} placeholder="Быстрый поиск товара или ячейки для добавления..."
              className="bg-transparent text-nexus-text text-sm flex-1 outline-none placeholder:text-nexus-text3" />
            {searchQ && <button onClick={() => { setSearchQ(''); setShowSearch(false); }} className="text-nexus-text3 hover:text-nexus-text"><X size={14} /></button>}
          </div>
          {showSearch && searchResults.length > 0 && (
            <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-nexus-surface2 border border-nexus-border rounded-xl shadow-lg max-h-60 overflow-y-auto">
              {searchResults.map((item, i) => (
                <div key={i} onMouseDown={() => selectSearchResult(item)} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-nexus-surface3 text-sm border-b border-nexus-border last:border-0">
                  <span className={`text-xs px-2 py-0.5 rounded ${item.type === 'product' ? 'bg-cyan-900/30 text-cyan-300' : 'bg-blue-900/30 text-blue-300'}`}>
                    {item.type === 'product' ? '📦' : '📍'}
                  </span>
                  <span className="font-mono text-nexus-accent2 text-xs">{item.type === 'product' ? (item.data as Product).barcode : (item.data as Cell).addr}</span>
                  <span className="text-nexus-text flex-1 truncate">{item.type === 'product' ? (item.data as Product).name : (item.data as Cell).addr}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sticker table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-nexus-border text-xs text-nexus-text3">
                <th className="px-2 py-2 text-left w-8">#</th>
                <th className="px-2 py-2 text-left">Штрихкод</th>
                <th className="px-2 py-2 text-left">Наименование</th>
                <th className="px-2 py-2 text-center w-20">Кол-во</th>
                <th className="px-2 py-2 text-center w-16">Ед.</th>
                <th className="px-2 py-2 text-left w-28">Ячейка</th>
                <th className="px-2 py-2 text-left w-28">Партия</th>
                <th className="px-2 py-2 text-center w-16">Копии</th>
                <th className="px-2 py-2 text-center w-24"></th>
              </tr>
            </thead>
            <tbody>
              {stickers.map((s, i) => (
                <tr key={i} className={`border-b border-nexus-border/30 transition-colors ${previewIdx === i ? 'bg-nexus-accent/10' : 'hover:bg-nexus-surface2/50'}`}>
                  <td className="px-2 py-1.5 text-nexus-text3 text-center">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <input value={s.barcode} onChange={e => update(i, 'barcode', e.target.value)} placeholder="Штрихкод"
                      className="w-full bg-transparent border-b border-transparent hover:border-nexus-border focus:border-nexus-accent px-1 py-1 text-nexus-accent2 text-xs font-mono outline-none transition-colors" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={s.name} onChange={e => update(i, 'name', e.target.value)} placeholder="Наименование"
                      className="w-full bg-transparent border-b border-transparent hover:border-nexus-border focus:border-nexus-accent px-1 py-1 text-nexus-text text-xs outline-none transition-colors" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={s.qty || ''} onChange={e => update(i, 'qty', Number(e.target.value) || 0)}
                      className="w-full bg-transparent border-b border-transparent hover:border-nexus-border focus:border-nexus-accent px-1 py-1 text-nexus-text text-xs text-center outline-none transition-colors" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={s.unit} onChange={e => update(i, 'unit', e.target.value)}
                      className="w-full bg-transparent border-b border-transparent hover:border-nexus-border focus:border-nexus-accent px-1 py-1 text-nexus-text text-xs text-center outline-none transition-colors" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={s.cell} onChange={e => update(i, 'cell', e.target.value)} placeholder="Ячейка"
                      className="w-full bg-transparent border-b border-transparent hover:border-nexus-border focus:border-nexus-accent px-1 py-1 text-nexus-text text-xs font-mono outline-none transition-colors" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={s.batch} onChange={e => update(i, 'batch', e.target.value)} placeholder="LOT"
                      className="w-full bg-transparent border-b border-transparent hover:border-nexus-border focus:border-nexus-accent px-1 py-1 text-nexus-text text-xs outline-none transition-colors" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={s.copies} onChange={e => update(i, 'copies', Math.max(1, Number(e.target.value) || 1))} min="1" max="999"
                      className="w-full bg-transparent border-b border-transparent hover:border-nexus-border focus:border-nexus-accent px-1 py-1 text-nexus-text text-xs text-center outline-none transition-colors" />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setPreviewIdx(i)} className={`p-1 rounded ${previewIdx === i ? 'text-nexus-accent bg-nexus-accent/20' : 'text-nexus-text3 hover:text-nexus-accent'}`} title="Предпросмотр"><Eye size={13} /></button>
                      <button onClick={() => duplicateRow(i)} className="p-1 rounded text-nexus-text3 hover:text-green-400" title="Дублировать">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      </button>
                      <button onClick={() => removeRow(i)} className="p-1 rounded text-nexus-text3 hover:text-red-400" title="Удалить"><X size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addRow} className="flex items-center gap-1 text-nexus-accent text-sm mt-3 hover:text-nexus-accent2 transition-colors"><Plus size={14} /> Добавить строку</button>
        </div>
      </div>

      {/* ═══ PREVIEW ═══ */}
      {currentSticker && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Live preview */}
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
            <h3 className="text-nexus-text font-bold mb-4">Предпросмотр {template === '6x6' ? '6×6 см' : '10×15 см'}</h3>
            <div className="flex justify-center">
              <div className={`${template === '6x6' ? 'w-[240px] h-[240px]' : 'w-[340px] h-[510px]'} bg-white text-black rounded-lg shadow-2xl overflow-hidden flex flex-col border border-gray-200`}>
                {template === '6x6' ? (
                  <>
                    <div className="h-7 bg-gradient-to-r from-[#1a1a2e] to-[#16213e] flex items-center justify-between px-2">
                      <span className="text-white text-[8px] font-bold tracking-wide">▣ STORRA WMS</span>
                      <span className="text-gray-500 text-[6px]">6.0</span>
                    </div>
                    <div className="px-2 py-1.5 border-b border-gray-200 min-h-[48px] flex items-center">
                      <div className="text-[9px] font-bold text-black leading-tight line-clamp-3">{currentSticker.name || 'Наименование товара'}</div>
                    </div>
                    <div className="px-2 py-1 border-b border-gray-200 flex flex-col items-center">
                      <canvas ref={barcodeCanvasRef} width={200} height={40} className="w-[210px] h-[42px]" />
                      <div className="text-[6.5px] font-mono mt-0.5 text-black tracking-wider font-semibold">{currentSticker.barcode || '—'}</div>
                    </div>
                    <div className="px-2 py-1 border-b border-gray-200 flex items-center gap-2">
                      <span className="text-[6px] text-gray-500 font-semibold uppercase">Кол-во:</span>
                      <span className="text-xl font-black text-[#1a1a2e] leading-none">{currentSticker.qty}</span>
                      <span className="text-[7px] text-gray-500">{currentSticker.unit}</span>
                    </div>
                    <div className="flex-1 bg-gray-50 px-2 py-1 flex items-center justify-between text-[6px] text-gray-500">
                      <span>📦 {currentSticker.cell || '—'}</span>
                      <span>📅 {todayRu()}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-10 bg-gradient-to-r from-[#1a1a2e] to-[#16213e] flex items-center justify-between px-3 border-b-2 border-[#6c63ff]">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded bg-[#6c63ff] flex items-center justify-center text-white text-[7px] font-bold">▣</div>
                        <div>
                          <div className="text-white text-[8px] font-bold tracking-wide leading-none">STORRA WMS</div>
                          <div className="text-[#8888cc] text-[4px]">Warehouse Management</div>
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2 border-b border-gray-200 min-h-[60px] flex items-center">
                      <div className="text-[10px] font-bold text-black leading-tight">{currentSticker.name || 'Наименование товара'}</div>
                    </div>
                    <div className="h-1.5 bg-gradient-to-r from-[#6c63ff] via-[#ff6b35] to-[#4caf50]" />
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex flex-col items-center">
                      <div className="text-[4px] text-gray-400 uppercase tracking-widest mb-0.5">штрихкод</div>
                      <canvas ref={barcodeCanvasBigRef} width={320} height={64} className="w-[300px] h-[60px]" />
                      <div className="text-[6px] font-mono font-bold text-black tracking-[2px] mt-0.5">{currentSticker.barcode || '—'}</div>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center py-2">
                      <div className="text-[4px] text-gray-400 uppercase tracking-[2px] mb-1.5">количество</div>
                      <div className="border-2 border-[#1a1a2e] rounded-md px-5 py-1.5 flex items-center gap-2 bg-blue-50/50">
                        <span className="text-[22px] font-black text-[#1a1a2e] leading-none">{currentSticker.qty}</span>
                        <span className="text-[7px] font-bold text-gray-500 border-l border-gray-300 pl-2">{currentSticker.unit}</span>
                      </div>
                    </div>
                    <div className="bg-gray-50 border-t border-gray-200 px-3 py-1.5 grid grid-cols-2 gap-0.5 text-[5px] text-gray-500">
                      <div>📦 Ячейка: <b className="text-black">{currentSticker.cell || '—'}</b></div>
                      <div>📅 Дата: <b className="text-black">{todayRu()}</b></div>
                      <div>👤 Оператор: <b className="text-black">{currentSticker.operator || '—'}</b></div>
                      <div>📋 Партия: <b className="text-black">{currentSticker.batch || '—'}</b></div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="mt-3 text-center text-nexus-text3 text-xs">
              Стикер #{previewIdx + 1} из {stickers.length} · {template === '6x6' ? 'На листе A4: 12 шт.' : 'На листе A4: 4 шт.'}
            </div>
          </div>

          {/* Sticker info & controls */}
          <div className="space-y-4">
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
              <h3 className="text-nexus-text font-bold text-sm mb-3">Данные стикера #{previewIdx + 1}</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Штрихкод', value: currentSticker.barcode },
                  { label: 'Наименование', value: currentSticker.name },
                  { label: 'Количество', value: `${currentSticker.qty} ${currentSticker.unit}` },
                  { label: 'Ячейка', value: currentSticker.cell || '—' },
                  { label: 'Партия', value: currentSticker.batch || '—' },
                  { label: 'Оператор', value: currentSticker.operator || '—' },
                  { label: 'Копий', value: String(currentSticker.copies) },
                  { label: 'Шаблон', value: template === '6x6' ? '6×6 см (квадрат)' : '10×15 см (флагман)' },
                ].map((row, i) => (
                  <div key={i} className="bg-nexus-surface2 rounded-lg px-3 py-2">
                    <div className="text-nexus-text3 text-[10px] uppercase tracking-wide">{row.label}</div>
                    <div className="text-nexus-text text-sm font-medium truncate">{row.value || '—'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
              <h3 className="text-nexus-text font-bold text-sm mb-3">Информация о печати</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-nexus-text2">
                  <span>Стикеров в списке:</span>
                  <span className="text-nexus-text font-medium">{stickers.length}</span>
                </div>
                <div className="flex justify-between text-nexus-text2">
                  <span>С учётом копий:</span>
                  <span className="text-nexus-text font-medium">{validCount} шт.</span>
                </div>
                <div className="flex justify-between text-nexus-text2">
                  <span>На одном листе A4:</span>
                  <span className="text-nexus-text font-medium">{template === '6x6' ? '12' : '4'} шт.</span>
                </div>
                <div className="flex justify-between text-nexus-text2">
                  <span>Листов A4:</span>
                  <span className="text-nexus-text font-medium">{Math.ceil(validCount / (template === '6x6' ? 12 : 4))}</span>
                </div>
                <div className="flex justify-between text-nexus-text2">
                  <span>Штрихкод:</span>
                  <span className="text-nexus-accent font-medium">Code128B</span>
                </div>
              </div>
            </div>

            {/* Barcode test */}
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
              <h3 className="text-nexus-text font-bold text-sm mb-3">Тест штрихкода</h3>
              <div className="bg-white rounded-lg p-3 flex flex-col items-center">
                <canvas id="test-bc" width={300} height={50} ref={el => {
                  if (el) renderBarcode(el, currentSticker.barcode || '4600000000000', { width: 300, height: 50 });
                }} />
                <div className="text-black text-[8px] font-mono mt-1 tracking-wider font-semibold">{formatBarcodeDisplay(currentSticker.barcode || '4600000000000')}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
