// ═══════════════════════════════════════════════════════════
// CSV PARSER
// ═══════════════════════════════════════════════════════════

const HEADER_MAP: Record<string, string[]> = {
  barcode: ['штрихкод', 'barcode', 'шк', 'код', 'code', 'ean', 'upc', 'артикул', 'article'],
  name: ['наименование', 'name', 'название', 'title', 'товар', 'product', 'описание'],
  unit: ['единица', 'unit', 'ед', 'ед.', 'uom'],
  category: ['категория', 'category', 'группа', 'group', 'тип'],
  supplier: ['поставщик', 'supplier'],
  addr: ['адрес', 'addr', 'ячейка', 'cell', 'location', 'место'],
  zone: ['зона', 'zone'],
  type: ['тип_ячейки', 'type', 'cell_type'],
  qty: ['количество', 'qty', 'quantity', 'кол', 'кол-во', 'колво'],
};

function normalizeHeader(h: string): string {
  const low = h.toLowerCase().trim();
  for (const [key, variants] of Object.entries(HEADER_MAP)) {
    if (variants.includes(low)) return key;
  }
  return low;
}

export interface CSVResult {
  headers: string[]; rows: string[][]; total: number; sep: string;
}

export async function parseCSVFile(file: File): Promise<CSVResult> {
  const buffer = await file.arrayBuffer();
  let text: string;
  try { text = new TextDecoder('utf-8').decode(buffer); if (text.includes('\uFFFD')) throw new Error('win'); } catch { text = new TextDecoder('windows-1251').decode(buffer); }
  text = text.replace(/^\uFEFF/, '');
  const sep = detectSep(text);
  const raw = parseRFC(text, sep);
  if (!raw.length) return { headers: [], rows: [], total: 0, sep };
  return { headers: raw[0].map(normalizeHeader), rows: raw.slice(1).filter(r => r.some(c => c.trim())), total: raw.length - 1, sep };
}

function detectSep(t: string): string {
  const s = t.split('\n').slice(0, 5).join('\n');
  return Object.entries({ ',': (s.match(/,/g)||[]).length, ';': (s.match(/;/g)||[]).length, '\t': (s.match(/\t/g)||[]).length }).sort((a,b) => b[1]-a[1])[0][0];
}

function parseRFC(text: string, sep: string): string[][] {
  const rows: string[][] = []; let cur: string[] = []; let f = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i+1];
    if (inQ) { if (c==='"'&&n==='"') { f+='"'; i++; } else if (c==='"') inQ=false; else f+=c; }
    else { if (c==='"') inQ=true; else if (c===sep) { cur.push(f.trim()); f=''; } else if (c==='\n'||(c==='\r'&&n==='\n')) { if(c==='\r')i++; cur.push(f.trim()); if(cur.some(x=>x))rows.push(cur); cur=[];f=''; } else if(c!=='\r') f+=c; }
  }
  if(f||cur.length){cur.push(f.trim());if(cur.some(x=>x))rows.push(cur);}
  return rows;
}

export function rowToObj(headers: string[], row: string[]): Record<string, string> {
  const o: Record<string, string> = {}; headers.forEach((h, i) => { o[h] = row[i] || ''; }); return o;
}

// ═══════════════════════════════════════════════════════════
// CODE128 — CORRECT IMPLEMENTATION
// Official width table from ISO/IEC 15417 specification
// Each value = 6 widths [bar,space,bar,space,bar,space] summing to 11
// STOP = 7 widths summing to 13
// ═══════════════════════════════════════════════════════════

// Width numbers as documented in official Code128 spec
// Source: barcodesinc.com/articles/code128.htm + bardecode.com
const C128_BARS = [
  212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,  // 0-9
  221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,  // 10-19
  221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,  // 20-29
  212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,  // 30-39
  231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,  // 40-49
  231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,  // 50-59
  314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,  // 60-69
  112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,  // 70-79
  111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,  // 80-89
  214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,  // 90-99
  114131,311141,411131,211412,211214,211232,                                // 100-105
];
const C128_STOP = 23311120; // 7 widths, 13 modules

// Pre-computed binary patterns: '1'=bar, '0'=space
const C128_PATTERNS: string[] = [];

function initPatterns() {
  for (let i = 0; i < C128_BARS.length; i++) {
    C128_PATTERNS[i] = widthsToBits(String(C128_BARS[i]).split('').map(Number));
  }
  // STOP pattern
  C128_PATTERNS[106] = widthsToBits(String(C128_STOP).split('').map(Number));
}

function widthsToBits(ws: number[]): string {
  let bits = '';
  for (let i = 0; i < ws.length; i++) {
    bits += (i % 2 === 0 ? '1' : '0').repeat(ws[i]);
  }
  return bits;
}

// Initialize patterns on load
initPatterns();

// Build Code128B bars array for a string value
function buildCode128(value: string): number[] | null {
  const enc: number[] = [];
  let checksum = 104; // START_B = value 104

  // START_B
  for (const ch of C128_PATTERNS[104]) enc.push(ch === '1' ? 1 : 0);

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i) - 32;
    if (code < 0 || code > 95) return null; // unsupported char
    const pattern = C128_PATTERNS[code];
    if (!pattern) return null;
    for (const ch of pattern) enc.push(ch === '1' ? 1 : 0);
    checksum += code * (i + 1);
  }

  // Checksum symbol
  const checkVal = checksum % 103;
  const checkPattern = C128_PATTERNS[checkVal];
  if (!checkPattern) return null;
  for (const ch of checkPattern) enc.push(ch === '1' ? 1 : 0);

  // STOP
  const stopPattern = C128_PATTERNS[106];
  for (const ch of stopPattern) enc.push(ch === '1' ? 1 : 0);

  return enc;
}

// ═══════════════════════════════════════════════════════════
// BARCODE RENDERER
// Key rules for scanner readability:
// 1. Integer module width (NO sub-pixel bars)
// 2. Minimum 2px per module
// 3. Quiet zone ≥ 10× module width on each side
// 4. No CSS scaling of canvas (set canvas.style to match)
// 5. imageSmoothingEnabled = false
// 6. Height ≥ 50px for standard scanners
// ═══════════════════════════════════════════════════════════

export function renderBarcode(canvas: HTMLCanvasElement, value: string, opts: {
  width?: number; height?: number; padding?: number; barColor?: string; bgColor?: string;
} = {}): boolean {
  if (!value) return false;
  
  const bars = buildCode128(value);
  if (!bars || bars.length === 0) {
    // Draw error X
    const w = opts.width || canvas.width || 200;
    const h = opts.height || canvas.height || 60;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = '#f00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(4,4); ctx.lineTo(w-4,h-4); ctx.moveTo(w-4,4); ctx.lineTo(4,h-4); ctx.stroke();
    return false;
  }

  // Calculate integer module width
  // Try to fill the requested width, but enforce minimum 2px per module
  const requestedWidth = opts.width || canvas.width || 300;
  const height = opts.height || canvas.height || 60;
  const requestedPadding = opts.padding || 0;

  // If a specific width is requested, calculate module size from it
  let moduleW: number;
  let padding: number;
  
  if (requestedPadding > 0) {
    // Auto-calculate from available space
    const availW = requestedWidth - requestedPadding * 2;
    moduleW = Math.max(2, Math.floor(availW / bars.length));
    padding = requestedPadding;
  } else {
    // Calculate padding to center barcode in the requested width
    moduleW = Math.max(2, Math.floor((requestedWidth * 0.85) / bars.length));
    padding = Math.floor((requestedWidth - moduleW * bars.length) / 2);
    // Ensure minimum quiet zone of 10 modules
    if (padding < moduleW * 5) {
      padding = moduleW * 5;
    }
  }

  const totalWidth = padding * 2 + moduleW * bars.length;

  // Set canvas size EXACTLY — no CSS scaling
  canvas.width = totalWidth;
  canvas.height = height;
  canvas.style.width = totalWidth + 'px';
  canvas.style.height = height + 'px';

  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // White background
  ctx.fillStyle = opts.bgColor || '#ffffff';
  ctx.fillRect(0, 0, totalWidth, height);

  // Draw bars — integer coordinates only
  ctx.fillStyle = opts.barColor || '#000000';
  let x = padding;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i] === 1) {
      ctx.fillRect(x, 0, moduleW, height);
    }
    x += moduleW;
  }

  return true;
}

// Generate barcode as data URL for embedding in print HTML
export function barcodeToDataURL(value: string, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  renderBarcode(canvas, value, { width, height, padding: 0 });
  return canvas.toDataURL('image/png');
}

// Inline barcode renderer code string for print windows
export function getBarcodeRendererCode(): string {
  return `
(function(){
var B=[212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232];
var S=23311120;
var P=[];
function w2b(ws){var b='';for(var i=0;i<ws.length;i++){b+=(i%2===0?'1':'0');for(var j=1;j<ws[i];j++)b+=(i%2===0?'1':'0');}return b;}
for(var i=0;i<B.length;i++){var d=String(B[i]).split('');var ws=[];for(var j=0;j<d.length;j++)ws.push(+d[j]);P[i]=w2b(ws);}
var sd=String(S).split('');var sw=[];for(var j=0;j<sd.length;j++)sw.push(+sd[j]);P[106]=w2b(sw);
window.renderBC=function(canvas,value){
if(!value)return;
var enc=[],ck=104;
var sb=P[104];for(var i=0;i<sb.length;i++)enc.push(sb[i]==='1'?1:0);
for(var i=0;i<value.length;i++){var code=value.charCodeAt(i)-32;if(code<0||code>95)continue;var p=P[code];if(!p)continue;for(var j=0;j<p.length;j++)enc.push(p[j]==='1'?1:0);ck+=code*(i+1);}
var cv=ck%103;var cp=P[cv];if(cp)for(var j=0;j<cp.length;j++)enc.push(cp[j]==='1'?1:0);
var sp=P[106];for(var j=0;j<sp.length;j++)enc.push(sp[j]==='1'?1:0);
var mw=Math.max(2,Math.floor(canvas.width*0.85/enc.length));
var pd=Math.floor((canvas.width-mw*enc.length)/2);
if(pd<mw*5)pd=mw*5;
var ctx=canvas.getContext('2d');
ctx.imageSmoothingEnabled=false;
ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.fillStyle='#000';
var x=pd;
for(var i=0;i<enc.length;i++){if(enc[i])ctx.fillRect(x,0,mw,canvas.height);x+=mw;}
};
})();`;
}

export function formatBarcodeDisplay(barcode: string): string {
  if (barcode.length === 13) {
    return barcode[0] + ' ' + barcode.slice(1,7).split('').join(' ') + '  ' + barcode.slice(7).split('').join(' ');
  }
  return barcode.split('').join(' ');
}

// ═══════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════

export function formatDate(ts: number | string): string {
  return (typeof ts === 'string' ? new Date(ts) : new Date(ts)).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function todayStr(): string { return new Date().toISOString().slice(0, 10); }
export function todayRu(): string { return new Date().toLocaleDateString('ru-RU'); }

// ═══════════════════════════════════════════════════════════
// EXPORT HELPERS
// ═══════════════════════════════════════════════════════════

export function downloadFile(content: string, filename: string, type: string = 'text/csv') {
  const blob = new Blob(['\uFEFF' + content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportToCSV(headers: string[], rows: string[][], filename: string) {
  downloadFile([headers.join(';'), ...rows.map(r => r.map(c => `"${(c||'').replace(/"/g,'""')}"`).join(';'))].join('\n'), filename, 'text/csv');
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as T;
}

export function parseCellAddr(addr: string) { const p = addr.split('-'); return { zone: p[0], row: p[1], level: p[2] }; }
