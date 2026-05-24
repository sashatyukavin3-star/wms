/**
 * Экспорт в .xls (формат Excel 2003 XML SpreadsheetML).
 * Открывается нативно в MS Excel / LibreOffice Calc / Numbers без warning'ов.
 *
 * Преимущества перед xlsx-библиотекой:
 *  - 0 зависимостей, ~3 KB кода
 *  - не раздувает bundle (xlsx-lib весит 800+ KB)
 *  - сохраняет типы данных (число / строка / дата) — в отличие от CSV
 *  - поддерживает несколько листов
 */

export interface SheetColumn {
  header: string;
  /** Ширина колонки в "символах Excel" (примерно 7px на символ). По умолчанию 15. */
  width?: number;
}

export type CellValue = string | number | boolean | Date | null | undefined;

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatCell(v: CellValue): string {
  if (v === null || v === undefined) return '<Cell/>';
  if (v instanceof Date) {
    const iso = v.toISOString().slice(0, 19);
    return `<Cell ss:StyleID="sDate"><Data ss:Type="DateTime">${iso}</Data></Cell>`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  }
  if (typeof v === 'boolean') {
    return `<Cell><Data ss:Type="Boolean">${v ? 1 : 0}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`;
}

function buildSheet(sheet: Sheet): string {
  const colsXml = sheet.columns
    .map(c => `<Column ss:AutoFitWidth="0" ss:Width="${(c.width ?? 15) * 7}"/>`)
    .join('');

  const headerXml =
    '<Row ss:StyleID="sHeader">' +
    sheet.columns.map(c => `<Cell><Data ss:Type="String">${xmlEscape(c.header)}</Data></Cell>`).join('') +
    '</Row>';

  const rowsXml = sheet.rows
    .map(row => '<Row>' + row.map(formatCell).join('') + '</Row>')
    .join('');

  return `<Worksheet ss:Name="${xmlEscape(sheet.name.slice(0, 31))}">
<Table>
${colsXml}
${headerXml}
${rowsXml}
</Table>
</Worksheet>`;
}

/** Скачать .xls c одним или несколькими листами. */
export function downloadXLS(filename: string, sheets: Sheet | Sheet[]): void {
  const list = Array.isArray(sheets) ? sheets : [sheets];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="sHeader">
  <Font ss:Bold="1" ss:Color="#FFFFFF"/>
  <Interior ss:Color="#1a1a1a" ss:Pattern="Solid"/>
  <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
</Style>
<Style ss:ID="sDate">
  <NumberFormat ss:Format="yyyy-mm-dd hh:mm:ss"/>
</Style>
</Styles>
${list.map(buildSheet).join('\n')}
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xls') ? filename : filename + '.xls';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
