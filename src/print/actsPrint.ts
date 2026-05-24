/**
 * Печатные шаблоны актов — пиксель-в-пиксель копия эталонных HTML-бланков
 * + расширенные поля + мини-штрихкоды для быстрого сканирования.
 *
 *  - Акт осмотра ячеек стеллажей (парный — осматривал/фиксировал)
 *  - Акт переборки миксовых паллетов
 *
 * Открываются в новом окне и сразу запускают window.print().
 */

import type { InspectionAct, ReworkAct } from '../db';
import { barcodeToDataURL } from '../utils';

function escape(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d: string): string {
  if (!d) return '__________';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return d;
}

/**
 * Сгенерировать data-URL мини-баркода Code 128 для печати.
 * Малый размер: ~160×30 px (15 мм × 8 мм при 300 dpi).
 * Возвращает пустую строку при ошибке (тогда в ячейку выведется только цифры).
 */
function miniBarcode(value: string): string {
  if (!value) return '';
  try {
    return barcodeToDataURL(value, 220, 36);
  } catch {
    return '';
  }
}

const COMMON_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #e0e0e0;
    display: flex;
    justify-content: center;
    padding: 20px;
    font-family: 'Arial', 'Helvetica', sans-serif;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    background: #fff;
    padding: 12mm 12mm 10mm 12mm;
    box-shadow: 0 0 8px rgba(0,0,0,0.12);
    display: flex;
    flex-direction: column;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2px solid #1a1a1a;
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .brand {
    width: 38px; height: 38px; border-radius: 9px;
    background: linear-gradient(135deg, #5fb6d9, #3a8ab0);
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 16pt; letter-spacing: -1px;
  }
  .header-title {
    font-size: 13pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #1e3a5c;
  }
  .brand-sub { font-size: 7.5pt; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .header-meta { font-size: 8.5pt; color: #444; text-align: right; }
  .info-row {
    display: flex; gap: 20px; font-size: 10pt;
    margin-bottom: 8px; flex-wrap: wrap;
  }
  .info-row .field { white-space: nowrap; }
  .info-row .field span {
    border-bottom: 1px solid #000; padding: 0 10px;
    display: inline-block; min-width: 80px;
    text-align: center; font-weight: bold;
  }
  .crew-line {
    display: flex; gap: 30px; font-size: 10pt;
    margin-bottom: 12px; padding-bottom: 10px;
    border-bottom: 1px solid #999;
  }
  .crew-line .field span {
    border-bottom: 1px solid #000; padding: 0 12px;
    display: inline-block; min-width: 120px; text-align: center;
  }
  .legend {
    font-size: 8pt; color: #555;
    margin-bottom: 10px; line-height: 1.4;
    border: 1px solid #ccc; padding: 6px 8px; background: #fafafa;
  }
  .legend strong { color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; flex-grow: 1; }
  th {
    background: #1a1a1a; color: #fff;
    font-size: 8.5pt; padding: 6px 3px;
    text-align: center; border: 1px solid #1a1a1a; vertical-align: middle;
  }
  td {
    border: 1px solid #555; padding: 5px 3px;
    vertical-align: middle; word-wrap: break-word;
  }
  .bc-cell { padding: 2px 3px !important; text-align: center; }
  .bc-cell .num { font-size: 8pt; font-family: 'Courier New', monospace; line-height: 1; margin-bottom: 2px; }
  .bc-cell img { display: block; margin: 0 auto; width: 95%; height: 24px; image-rendering: pixelated; }
  .footer {
    margin-top: 12px; font-size: 9pt;
    border-top: 1px solid #1a1a1a; padding-top: 8px;
    display: flex; justify-content: space-between; flex-wrap: wrap;
  }
  .sign-block { width: 42%; text-align: center; }
  .sign-line { border-bottom: 1px solid #000; margin: 20px 0 4px 0; }
  .summary { display: flex; gap: 15px; flex-wrap: wrap; font-size: 9pt; margin-top: 4px; }
  .summary .item { white-space: nowrap; }
  .summary .item span { border-bottom: 1px solid #000; padding: 0 6px; font-weight: bold; }
  .note-bottom { margin-top: 10px; font-size: 9pt; }
  .note-bottom strong { color: #1a1a1a; }
  @media print {
    body { background: none; padding: 0; }
    .page { box-shadow: none; width: 100%; min-height: auto; margin: 0; page-break-after: always; }
    .legend { background: #fff; }
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
// АКТ ОСМОТРА ЯЧЕЕК
// ═══════════════════════════════════════════════════════════════════════════

export function renderInspectionAct(a: InspectionAct, minRows = 22): string {
  const padded = [...a.rows];
  while (padded.length < minRows) padded.push({ cell: '', status: '', note: '' });

  const rowsHtml = padded
    .map((r, i) => {
      const bcImg = r.barcode ? miniBarcode(r.barcode) : '';
      const factText = r.barcode && r.note
        ? `${escape(r.note)}`
        : escape(r.note || '');
      // В колонке ШК — мини-баркод + цифры
      const bcCell = r.barcode
        ? `<div class="num">${escape(r.barcode)}</div>${bcImg ? `<img src="${bcImg}" alt=""/>` : ''}`
        : '';
      // Подсветка расхождения «Факт vs План» — красным жирным, чтобы старший
      // сразу видел проблемные строки на распечатанном бланке.
      const isMismatch = r.qty !== undefined && r.qty_plan !== undefined && r.qty !== r.qty_plan;
      const factCellCls = isMismatch ? 'c-fact mismatch' : 'c-fact';
      return `<tr>
        <td class="c-num">${i + 1}</td>
        <td class="c-cell">${escape(r.cell)}</td>
        <td class="c-status">${escape(r.status)}</td>
        <td class="c-desc">${factText}</td>
        <td class="c-bc bc-cell">${bcCell}</td>
        <td class="c-plan">${r.qty_plan ?? ''}</td>
        <td class="c-res">${r.qty_reserved ?? ''}</td>
        <td class="${factCellCls}">${r.qty ?? ''}</td>
        <td class="c-action">${escape(r.action || '')}</td>
      </tr>`;
    })
    .join('');

  const filledRows = a.rows.filter(r => r.cell.trim()).length;
  const problemRows = a.rows.filter(r => r.cell.trim() && r.status && r.status !== 'ОК').length;
  const aisleSpan =
    a.aisle_from && a.aisle_to ? `${a.aisle_from} — ${a.aisle_to}` :
    a.aisle_from || a.aisle_to || '_______________';

  const sheetLine = a.sheet_no || a.sheets_total
    ? `Лист № ${a.sheet_no || '___'} из ${a.sheets_total || '___'}<br>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Акт осмотра ${escape(a.act_number)}</title>
<style>${COMMON_STYLE}
  .c-num      { width: 3%;    text-align: center; }
  .c-cell     { width: 10%;   text-align: center; font-weight: bold; }
  .c-status   { width: 12%;   text-align: center; }
  .c-desc     { width: 23%; }
  .c-bc       { width: 14%; }
  .c-plan     { width: 6%;    text-align: center; font-weight: 600; color: #111; }
  .c-res      { width: 6%;    text-align: center; color: #8a5a00; background: #fff8e1; }
  .c-fact     { width: 6%;    text-align: center; font-weight: bold; }
  .c-fact.mismatch { background: #ffeaea; color: #b00020; }
  .c-action   { width: 20%; }
  td { height: 34px; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-left">
        <div class="brand">S</div>
        <div>
          <div class="header-title">Акт осмотра ячеек стеллажей</div>
          <div class="brand-sub">Storra WMS · бланк осмотра</div>
        </div>
      </div>
      <div class="header-meta">
        № ${escape(a.act_number)}<br>
        ${sheetLine}
        Дата составления: ${fmtDate(a.date)}
      </div>
    </div>

    <div class="info-row">
      <div class="field">Склад: <span>${escape(a.warehouse) || '_______________'}</span></div>
      ${a.warehouse_addr ? `<div class="field">Адрес: <span>${escape(a.warehouse_addr)}</span></div>` : ''}
      <div class="field">Зона / Ряд: <span>${escape(a.zone_span) || '_______________'}</span></div>
      <div class="field">Пролёт (с - по): <span>${escape(aisleSpan)}</span></div>
    </div>

    <div class="crew-line">
      <div class="field">Осматривал (на высоте): <span>${escape(a.inspector_high) || '__________________________'}</span></div>
      <div class="field">Фиксировал (внизу): <span>${escape(a.inspector_low) || '__________________________'}</span></div>
      ${a.inspector_position ? `<div class="field">Должность: <span>${escape(a.inspector_position)}</span></div>` : ''}
    </div>

    <div class="legend">
      <strong>Колонки «План / Отбор / Факт»:</strong>
      «План» — сколько товара числится по WMS на момент печати;
      «Отбор» — сколько зарезервировано под открытые заказы;
      «Факт» — что реально нашли при осмотре (заполняется вручную).
      Расхождение «Факт ≠ План» подсвечивается красным.<br>
      <strong>Статусы для заполнения:</strong>
      «Пересорт» — лежит не тот товар;
      «Излишек» — товара БОЛЬШЕ чем по системе (надо оприходовать разницу);
      «Недостача» — в системе есть, фактически нет;
      «Не на месте» — товар целиком, но в чужой ячейке (по системе он в другой / эта пустая);
      «Out_stock» — товар в системе помечен как недоступный, физически лежит обычно;
      «Микс-паллет» — на одном паллете лежат 2+ разных наименований (требует переборки);
      «Паллет в пустой» — ячейка должна быть пуста по учёту, но занята паллетом;
      «Повреждение», «Срок», «Карантин» — по необходимости.
      <strong>В графе «Что именно находится»</strong> — описать фактический товар или пометку «пустой паллет».
      <strong>ШК товара</strong> (если применимо) — печатается под номером для быстрого сканирования.
    </div>

    <table>
      <thead>
        <tr>
          <th class="c-num">№</th>
          <th class="c-cell">Ячейка</th>
          <th class="c-status">Статус проблемы</th>
          <th class="c-desc">Что находится (факт)</th>
          <th class="c-bc">ШК товара</th>
          <th class="c-plan" title="По системе WMS">План</th>
          <th class="c-res" title="Зарезервировано под заказы">Отбор</th>
          <th class="c-fact" title="Фактически найдено при осмотре">Факт</th>
          <th class="c-action">Что сделано / Реком.</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    ${a.note ? `<div class="note-bottom"><strong>Примечание к акту:</strong> ${escape(a.note)}</div>` : ''}

    <div class="footer">
      <div>Всего осмотрено ячеек: ${filledRows || '________'}</div>
      <div>Из них с проблемами: ${problemRows || '________'}</div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 12px;">
      <div class="sign-block">
        <div class="sign-line"></div>
        Осматривал _______________<br>
        <small>${escape(a.inspector_high) || '(подпись / расшифровка)'}</small>
      </div>
      <div class="sign-block">
        <div class="sign-line"></div>
        Фиксировал _______________<br>
        <small>${escape(a.inspector_low) || '(подпись / расшифровка)'}</small>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// АКТ ПЕРЕБОРКИ ПАЛЛЕТОВ
// ═══════════════════════════════════════════════════════════════════════════

export function renderReworkAct(a: ReworkAct, minRows = 22): string {
  const padded = [...a.positions];
  while (padded.length < minRows) padded.push({ barcode: '', name: '', total: 0, good: 0, defect: 0, note: '' });

  const rowsHtml = padded
    .map((p, i) => {
      const hasData = p.barcode || p.name || p.total || p.good || p.defect;
      const bcImg = p.barcode ? miniBarcode(p.barcode) : '';
      const bcCell = p.barcode
        ? `<div class="num">${escape(p.barcode)}</div>${bcImg ? `<img src="${bcImg}" alt=""/>` : ''}`
        : '';
      return `<tr>
        <td class="c-num">${i + 1}</td>
        <td class="c-name">${escape(p.name)}</td>
        <td class="c-article">${escape(p.article || '')}</td>
        <td class="c-bc bc-cell">${bcCell}</td>
        <td class="c-unit">${hasData ? escape(p.unit || 'шт') : ''}</td>
        <td class="c-total">${hasData && p.total ? p.total : ''}</td>
        <td class="c-good">${hasData && p.good ? p.good : ''}</td>
        <td class="c-defect" style="${p.defect > 0 ? 'color:#a00;font-weight:bold;' : ''}">${hasData && p.defect ? p.defect : ''}</td>
        <td class="c-reason">${escape(p.note || '')}</td>
      </tr>`;
    })
    .join('');

  const totals = a.positions.reduce(
    (acc, p) => ({
      total: acc.total + (p.total || 0),
      good: acc.good + (p.good || 0),
      defect: acc.defect + (p.defect || 0),
    }),
    { total: 0, good: 0, defect: 0 }
  );

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Акт переборки ${escape(a.act_number)}</title>
<style>${COMMON_STYLE}
  table { font-size: 8pt; }
  th { font-size: 7.5pt; padding: 5px 2px; }
  td { padding: 3px 2px; height: 30px; }
  .c-num      { width: 3%;    text-align: center; }
  .c-name     { width: 26%; }
  .c-article  { width: 7%;    text-align: center; }
  .c-bc       { width: 13%; }
  .c-unit     { width: 4%;    text-align: center; }
  .c-total    { width: 7%;    text-align: center; }
  .c-good     { width: 7%;    text-align: center; }
  .c-defect   { width: 7%;    text-align: center; }
  .c-reason   { width: 26%; }
  .page { padding: 12mm 14mm 10mm 14mm; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-left">
        <div class="brand">S</div>
        <div>
          <div class="header-title">Акт переборки миксовых паллетов</div>
          <div class="brand-sub">Storra WMS · бланк переборки</div>
        </div>
      </div>
      <div class="header-meta">
        Акт № ${escape(a.act_number)} от ${fmtDate(a.date)}<br>
        Склад: ${escape(a.warehouse) || '____________________'}
        ${a.ref_document ? `<br>Док.: ${escape(a.ref_document)}` : ''}
      </div>
    </div>

    <div class="info-row">
      <div class="field">Участок / Зона: <span>${escape(a.zone) || '_______________'}</span></div>
      <div class="field">Дата переборки: <span>${fmtDate(a.date)}</span></div>
      ${a.reason ? `<div class="field">Причина: <span>${escape(a.reason)}</span></div>` : ''}
    </div>

    <div class="info-row">
      <div class="field">Время начала: <span>${escape(a.start_time) || '_____'}</span></div>
      <div class="field">Время окончания: <span>${escape(a.end_time) || '_____'}</span></div>
      ${a.source ? `<div class="field">Источник: <span>${escape(a.source)}</span></div>` : ''}
      ${a.destination ? `<div class="field">Назначение: <span>${escape(a.destination)}</span></div>` : ''}
    </div>

    <div class="crew-line">
      <div class="field">Перебирали (ФИО): <span>${escape(a.workers) || '_______________'}</span></div>
      <div class="field">Контролировал (ФИО): <span>${escape(a.supervisor) || '_______________'}</span></div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="c-num">№</th>
          <th class="c-name">Наименование товара</th>
          <th class="c-article">Артикул</th>
          <th class="c-bc">ШК</th>
          <th class="c-unit">Ед.</th>
          <th class="c-total">Всего</th>
          <th class="c-good">Годного</th>
          <th class="c-defect">Брак</th>
          <th class="c-reason">Причина брака / Примечание</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    ${a.note ? `<div class="note-bottom"><strong>Примечание к акту:</strong> ${escape(a.note)}</div>` : ''}

    <div class="footer">
      <div class="summary">
        <div class="item">Всего перебрано паллетов: <span>${a.pallets_total || '___'}</span></div>
        <div class="item">Общее кол-во единиц товара: <span>${totals.total || '___'}</span></div>
        <div class="item">Из них годного: <span>${totals.good || '___'}</span></div>
        <div class="item">Брак: <span>${totals.defect || '___'}</span></div>
      </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 12px;">
      <div class="sign-block">
        <div class="sign-line"></div>
        Перебирали _______________<br>
        <small>${escape(a.workers) || '(подпись / расшифровка)'}</small>
      </div>
      <div class="sign-block">
        <div class="sign-line"></div>
        Контролировал _______________<br>
        <small>${escape(a.supervisor) || '(подпись / расшифровка)'}</small>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Открыть новое окно с заранее сформированным HTML и сразу запустить печать. */
export function printHtmlInNewWindow(html: string): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  // Чуть дольше задержку, чтобы успели прогрузиться картинки баркодов
  setTimeout(() => {
    try { win.focus(); win.print(); } catch { /* noop */ }
  }, 500);
}
