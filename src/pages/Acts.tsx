import { ChevronDown,Edit3, FileText, MapPin, Package, Plus, Printer, Save, Trash2, Wand2, X } from 'lucide-react';
import { useCallback,useEffect, useMemo, useRef, useState } from 'react';

import { toast } from '../App';
import {
  type Cell,
  db,
  getSetting,
  type InspectionAct,
  type InspectionRow,
  type Product,
  type ReworkAct,
  type ReworkPosition,
} from '../db';
import { useData } from '../hooks/useData';
import { actsApi, reservationsApi } from '../lib/services';
import { printHtmlInNewWindow,renderInspectionAct, renderReworkAct } from '../print/actsPrint';
import { debounce,formatDate, todayStr } from '../utils';

// Поля акта осмотра, которые шлём в payload на сервер (всё кроме служебных).
function inspectionToPayload(a: Partial<InspectionAct>) {
  return {
    type: 'cell_inspection' as const,
    warehouse: a.warehouse, warehouse_addr: a.warehouse_addr,
    zone_span: a.zone_span, aisle_from: a.aisle_from, aisle_to: a.aisle_to,
    sheet_no: a.sheet_no, sheets_total: a.sheets_total,
    inspector_high: a.inspector_high, inspector_low: a.inspector_low,
    inspector_position: a.inspector_position, note: a.note,
    rows: a.rows || [],
  };
}
function reworkToPayload(a: Partial<ReworkAct>) {
  return {
    warehouse: a.warehouse, warehouse_addr: a.warehouse_addr, zone: a.zone,
    source: a.source, destination: a.destination, reason: a.reason,
    ref_document: a.ref_document, start_time: a.start_time, end_time: a.end_time,
    workers: a.workers, supervisor: a.supervisor, pallets_total: a.pallets_total,
    items_total: a.items_total, good_total: a.good_total, defect_total: a.defect_total,
    note: a.note, positions: a.positions || [],
  };
}

const STATUS_OPTIONS = [
  { value: 'ОК', label: 'ОК — Всё в порядке' },
  { value: 'Пересорт', label: 'Пересорт — Лежит не тот товар' },
  { value: 'Излишек', label: 'Излишек — Товара больше, чем по системе (надо оприходовать)' },
  { value: 'Недостача', label: 'Недостача — В системе есть, фактически нет' },
  { value: 'Не на месте', label: 'Не на месте — Товар в чужой ячейке (просто переставить)' },
  { value: 'Out_stock', label: 'Out_stock — В системе числится как недоступный, а лежит обычно' },
  { value: 'Микс-паллет', label: 'Микс-паллет — На одном паллете 2+ наименований' },
  { value: 'Паллет в пустой', label: 'Паллет в пустой — Учёт пуст, факт занят' },
  { value: 'Повреждение', label: 'Повреждение — Товар/тара повреждены' },
  { value: 'Срок', label: 'Срок — Истёк / истекает срок годности' },
  { value: 'Карантин', label: 'Карантин — Требуется проверка' },
];

/**
 * Типовые действия / рекомендации по результатам осмотра.
 * Сгруппированы по типу — в <select> будут показаны через <optgroup>.
 *
 * Список покрывает реальные сценарии складского осмотра:
 *  • корректировка остатков (системные действия),
 *  • физические действия с товаром (переместить, переупаковать),
 *  • изоляция / списание (карантин, брак, истёкший срок),
 *  • требующие внимания (повторный пересчёт, эскалация старшему).
 *
 * Спец. значения:
 *  • '' — «Без действий» (всё в порядке).
 *  • '__custom__' — открывает свободное поле для своего текста.
 */
const ACTION_GROUPS: Array<{ label: string; options: Array<{ value: string; label: string }> }> = [
  {
    label: 'Без действий',
    options: [{ value: '', label: '— ничего не требуется' }],
  },
  {
    label: 'Корректировка остатков',
    options: [
      { value: 'Скорректировать остаток', label: 'Скорректировать остаток' },
      { value: 'Списать недостачу', label: 'Списать недостачу' },
      { value: 'Оприходовать излишек', label: 'Оприходовать излишек' },
      { value: 'Сменить статус в системе', label: 'Сменить статус в системе (out_stock → доступен)' },
    ],
  },
  {
    label: 'Физические действия с товаром',
    options: [
      { value: 'Переместить в правильную ячейку', label: 'Переместить в правильную ячейку' },
      { value: 'Объединить с основной ячейкой', label: 'Объединить с основной ячейкой' },
      { value: 'Переупаковать', label: 'Переупаковать' },
      { value: 'Отправить на переборку', label: 'Отправить на переборку' },
    ],
  },
  {
    label: 'Изоляция / списание',
    options: [
      { value: 'Перевести в карантин', label: 'Перевести в карантин' },
      { value: 'Списать (брак)', label: 'Списать (брак)' },
      { value: 'Списать (срок)', label: 'Списать (срок)' },
      { value: 'Заблокировать ячейку', label: 'Заблокировать ячейку' },
    ],
  },
  {
    label: 'Требуется внимание',
    options: [
      { value: 'Повторный пересчёт', label: 'Повторный пересчёт' },
      { value: 'Эскалация старшему', label: 'Эскалация старшему' },
      { value: 'Найти и вернуть', label: 'Найти и вернуть' },
      { value: 'Сверить с документами', label: 'Сверить с документами' },
    ],
  },
  {
    label: 'Другое',
    options: [{ value: '__custom__', label: 'Свой текст…' }],
  },
];

/** Плоский список всех типовых значений (для быстрой проверки «это из списка или кастом»). */
const ALL_PREDEFINED_ACTIONS = new Set<string>(
  ACTION_GROUPS.flatMap(g => g.options.map(o => o.value)).filter(v => v && v !== '__custom__')
);

/**
 * Умная авто-рекомендация действия по статусу строки.
 * Возвращает значение из ALL_PREDEFINED_ACTIONS, которое чаще всего подходит для этого статуса.
 * Оператор всегда может поменять.
 */
function suggestedActionFor(status: string): string {
  switch (status) {
    case 'Недостача':       return 'Списать недостачу';
    case 'Излишек':         return 'Оприходовать излишек';
    case 'Пересорт':        return 'Переместить в правильную ячейку';
    case 'Не на месте':     return 'Переместить в правильную ячейку';
    case 'Out_stock':       return 'Сменить статус в системе';
    case 'Микс-паллет':     return 'Отправить на переборку';
    case 'Паллет в пустой': return 'Скорректировать остаток';
    case 'Повреждение':     return 'Переупаковать';
    case 'Срок':            return 'Списать (срок)';
    case 'Карантин':        return 'Перевести в карантин';
    case 'ОК':              return '';
    default:                return '';
  }
}

// ═══════════════════════════════════════════════════════════
// ГЕНЕРАТОР АДРЕСОВ ЯЧЕЕК
// ═══════════════════════════════════════════════════════════
//
// На реальном складе адреса однотипные: «90-118-1», «90-119-1»...
// Оператор обходит ряд за рядом, и каждый раз вписывать вручную 22+ адресов
// слишком долго. Поэтому:
//   • кнопка «Генератор строк» — массово создаёт диапазон в один клик;
//   • ввод одного адреса → Tab/Enter автоматически создаёт следующий +1 по позиции.
//
// Формат адреса по умолчанию: «РЯД-ПОЗИЦИЯ-ЭТАЖ», например «90-118-1».
// Если у вас другой формат — поменяйте разделитель и порядок ниже.

const CELL_SEP = '-';

interface ParsedAddr {
  row: string;
  pos: number;
  posWidth: number; // ширина zero-padding, чтобы 118 не превращалось в 119 потом
  level: string;
  raw: string;
}

/** Парсит адрес «РЯД-ПОЗИЦИЯ-ЭТАЖ» в части. Если формат другой — вернёт null. */
function parseCellAddr(addr: string): ParsedAddr | null {
  const parts = addr.trim().split(CELL_SEP);
  if (parts.length !== 3) return null;
  const [row, posStr, level] = parts;
  if (!row || !posStr || !level) return null;
  const pos = parseInt(posStr, 10);
  if (!Number.isFinite(pos)) return null;
  return { row, pos, posWidth: posStr.length, level, raw: addr };
}

/** Собирает адрес из частей, сохраняя zero-padding позиции. */
function buildCellAddr(row: string, pos: number, level: string, posWidth: number): string {
  return `${row}${CELL_SEP}${String(pos).padStart(posWidth, '0')}${CELL_SEP}${level}`;
}

/** Следующий адрес по позиции (для авто-инкремента при Tab/Enter). */
function nextCellAddr(addr: string): string | null {
  const parsed = parseCellAddr(addr);
  if (!parsed) return null;
  return buildCellAddr(parsed.row, parsed.pos + 1, parsed.level, parsed.posWidth);
}

interface GenParams {
  row: string;          // например "92"
  posFrom: string;      // например "118"
  posTo: string;        // например "189"
  level: string;        // например "5"
  skipDrivewayRows: boolean; // правило склада: ряды 124-126 начинаются с 4 этажа
  drivewayPosFrom: string;   // 124
  drivewayPosTo: string;     // 126
  drivewayMinLevel: string;  // 4
}

const GEN_DEFAULTS: GenParams = {
  row: '92',
  posFrom: '118',
  posTo: '189',
  level: '5',
  skipDrivewayRows: true,
  drivewayPosFrom: '124',
  drivewayPosTo: '126',
  drivewayMinLevel: '4',
};

const GEN_STORAGE_KEY = 'storra_act_gen_params_v1';

/** Генерирует список адресов по параметрам. С защитой от очевидных опечаток. */
function generateAddrs(p: GenParams): string[] {
  const row = p.row.trim();
  const level = p.level.trim();
  const from = parseInt(p.posFrom, 10);
  const to = parseInt(p.posTo, 10);
  if (!row || !level || !Number.isFinite(from) || !Number.isFinite(to)) return [];
  if (to < from) return [];
  if (to - from > 500) return []; // защита от случайного «1 — 99999»

  // Считаем ширину zero-padding по верхней границе: если "189" → padStart(3)
  const posWidth = String(Math.max(from, to)).length;
  const lvlNum = parseInt(level, 10);

  // Правило «проезд»: в позициях [drivewayPosFrom..drivewayPosTo] нижние этажи пустые.
  const drivewayFrom = parseInt(p.drivewayPosFrom, 10);
  const drivewayTo = parseInt(p.drivewayPosTo, 10);
  const drivewayMin = parseInt(p.drivewayMinLevel, 10);
  const skip = p.skipDrivewayRows
    && Number.isFinite(drivewayFrom) && Number.isFinite(drivewayTo)
    && Number.isFinite(drivewayMin) && Number.isFinite(lvlNum)
    && lvlNum < drivewayMin;

  const addrs: string[] = [];
  for (let pos = from; pos <= to; pos++) {
    if (skip && pos >= drivewayFrom && pos <= drivewayTo) continue;
    addrs.push(buildCellAddr(row, pos, level, posWidth));
  }
  return addrs;
}

const REWORK_REASONS = [
  'Сортировка миксового паллета',
  'Карантин / проверка качества',
  'Комплектация заказа',
  'Возврат от покупателя',
  'Списание брака',
  'Перемаркировка',
  'Другое',
];

const UNIT_OPTIONS = ['шт', 'кг', 'л', 'м', 'уп', 'пач', 'кор'];

type ActTab = 'inspection' | 'rework' | 'list';
type SuggestionType =
  | { kind: 'cell'; items: Cell[] }
  | { kind: 'product'; items: Product[] }
  | null;

const INSPECTION_DRAFT_KEY = 'storra_inspection_draft_v3';
const REWORK_DRAFT_KEY = 'storra_rework_draft_v3';

// ═══════════════════════════════════════════════════════════
// ЧЕРНОВИКИ — анти-«потерял час работы»
// ═══════════════════════════════════════════════════════════
// Что защищаем:
//  • Переключение на другой раздел (Товары/Заказы) → компонент Acts размонтируется
//    и локальный useState стирается. Раньше всё пропадало.
//  • Случайное закрытие вкладки / F5 / падение браузера.
//  • Переключение приложений (Alt-Tab) — на всякий случай.
//
// Как защищаем:
//  • Каждое изменение → автосейв в localStorage с дебаунсом 1 секунда.
//  • При монтаже компонента → автоматически восстанавливаемся из черновика.
//  • Перед закрытием вкладки (beforeunload) и при размонтировании → финальный сейв.

interface InspectionDraft {
  insp: {
    date: string; warehouse: string; warehouse_addr: string;
    zone_span: string; aisle_from: string; aisle_to: string;
    sheet_no: string; sheets_total: string;
    inspector_high: string; inspector_low: string; inspector_position: string;
    note: string;
  };
  inspRows: InspectionRow[];
  /** Метка времени последнего сохранения — для индикатора «сохранено в HH:MM:SS». */
  savedAt: number;
  /** Редактируем существующий акт или создаём новый? Нужно при восстановлении. */
  editingId?: number;
}

interface ReworkDraft {
  rework: {
    date: string; warehouse: string; warehouse_addr: string; zone: string;
    source: string; destination: string; reason: string; ref_document: string;
    start_time: string; end_time: string; workers: string; supervisor: string;
    pallets_total: string; note: string;
  };
  reworkPos: ReworkPosition[];
  savedAt: number;
  editingId?: number;
}

/** Проверяет, есть ли в черновике осмотра хоть что-то осмысленное (не «дефолтная пустая форма»). */
function isInspectionDraftMeaningful(d: InspectionDraft | null): boolean {
  if (!d) return false;
  const hasFormData = !!(d.insp?.warehouse?.trim() || d.insp?.zone_span?.trim()
    || d.insp?.aisle_from?.trim() || d.insp?.aisle_to?.trim()
    || d.insp?.inspector_high?.trim() || d.insp?.inspector_low?.trim()
    || d.insp?.note?.trim());
  const hasRowData = Array.isArray(d.inspRows) && d.inspRows.some(r =>
    r.cell?.trim() || r.barcode?.trim() || r.note?.trim() || r.action?.trim()
    || r.qty !== undefined || r.qty_plan !== undefined
  );
  return hasFormData || hasRowData;
}

function isReworkDraftMeaningful(d: ReworkDraft | null): boolean {
  if (!d) return false;
  const hasFormData = !!(d.rework?.warehouse?.trim() || d.rework?.zone?.trim()
    || d.rework?.source?.trim() || d.rework?.destination?.trim()
    || d.rework?.workers?.trim() || d.rework?.supervisor?.trim()
    || d.rework?.note?.trim() || d.rework?.ref_document?.trim());
  const hasPositions = Array.isArray(d.reworkPos) && d.reworkPos.some(p =>
    p.barcode?.trim() || p.name?.trim() || (p.total || 0) > 0
  );
  return hasFormData || hasPositions;
}

function loadInspectionDraft(): InspectionDraft | null {
  try {
    const raw = localStorage.getItem(INSPECTION_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as InspectionDraft;
  } catch { return null; }
}
function loadReworkDraft(): ReworkDraft | null {
  try {
    const raw = localStorage.getItem(REWORK_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReworkDraft;
  } catch { return null; }
}

export default function Acts() {
  const [tab, setTab] = useState<ActTab>('list');
  const [inspActs, setInspActs] = useState<InspectionAct[]>([]);
  const [reworkActs, setReworkActs] = useState<ReworkAct[]>([]);
  const [listFilter, setListFilter] = useState<'all' | 'inspection' | 'rework'>('all');

  // ═══ Inspection form ═══
  // ВАЖНО: при монтировании компонента сразу читаем черновик из localStorage.
  // Это защищает от случайного переключения раздела (например, оператор кликнул
  // на «Товары» и вернулся обратно — раньше всё стиралось).
  const [savedDraft] = useState(() => {
    const ins = loadInspectionDraft();
    const rwk = loadReworkDraft();
    return {
      ins: isInspectionDraftMeaningful(ins) ? ins : null,
      rwk: isReworkDraftMeaningful(rwk) ? rwk : null,
    };
  });
  // Если в черновике есть editingId — значит редактировали существующий акт.
  const [editingInspId, setEditingInspId] = useState<number | null>(savedDraft.ins?.editingId ?? null);

  const [insp, setInsp] = useState(() => savedDraft.ins?.insp || {
    date: todayStr(),
    warehouse: '',
    warehouse_addr: '',
    zone_span: '',
    aisle_from: '',
    aisle_to: '',
    sheet_no: '1',
    sheets_total: '1',
    inspector_high: '',
    inspector_low: '',
    inspector_position: '',
    note: '',
  });
  const [inspRows, setInspRows] = useState<InspectionRow[]>(() => savedDraft.ins?.inspRows && savedDraft.ins.inspRows.length > 0
    ? savedDraft.ins.inspRows
    : [{ cell: '', status: 'ОК', note: '', barcode: '', qty_plan: undefined, qty_reserved: undefined, qty: undefined, action: '' }]
  );

  // ═══ Rework form ═══
  const [editingReworkId, setEditingReworkId] = useState<number | null>(savedDraft.rwk?.editingId ?? null);
  const [rework, setRework] = useState(() => savedDraft.rwk?.rework || {
    date: todayStr(),
    warehouse: '',
    warehouse_addr: '',
    zone: '',
    source: '',
    destination: '',
    reason: REWORK_REASONS[0],
    ref_document: '',
    start_time: '',
    end_time: '',
    workers: '',
    supervisor: '',
    pallets_total: '',
    note: '',
  });
  const [reworkPos, setReworkPos] = useState<ReworkPosition[]>(() => savedDraft.rwk?.reworkPos && savedDraft.rwk.reworkPos.length > 0
    ? savedDraft.rwk.reworkPos
    : [{ barcode: '', name: '', article: '', unit: 'шт', total: 0, good: 0, defect: 0, quantum: undefined, note: '' }]
  );

  // Метка «сохранено в HH:MM:SS» для отображения в UI.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(savedDraft.ins?.savedAt || savedDraft.rwk?.savedAt || null);

  // Если был восстановлен черновик — единожды показываем уведомление.
  useEffect(() => {
    if (savedDraft.ins || savedDraft.rwk) {
      const which = savedDraft.ins && savedDraft.rwk ? 'осмотра и переборки'
        : savedDraft.ins ? 'осмотра' : 'переборки';
      // setTimeout чтобы тост появился после первого рендера, а не во время.
      setTimeout(() => toast('info', `Восстановлен незавершённый черновик ${which}`, 5000), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ═══ Autocomplete data ═══
  const [allCells, setAllCells] = useState<Cell[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  // Подтягиваем остатки из общего DataProvider (он сам синхронизирован с сервером).
  // По ним считаем «План» = сколько товара числится в выбранной ячейке.
  const { stock: stockRows } = useData();

  // Резервирования (отбор под заказы) подгружаем отдельно — по ним считаем колонку «Отбор».
  const [reservations, setReservations] = useState<Array<{ barcode: string; cell: string; qty: number }>>([]);
  useEffect(() => {
    let alive = true;
    const loadRes = () => {
      reservationsApi.list().then(list => {
        if (alive) setReservations(list);
      }).catch(() => { /* сервер недоступен — резервы будут 0 */ });
    };
    loadRes();
    // Обновляем раз в 30 сек, чтобы цифры были актуальные.
    const t = setInterval(loadRes, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // ─── Генератор строк (массовое создание адресов) ───────────
  // Параметры запоминаются в localStorage — чтобы при следующем акте не вводить заново.
  const [genOpen, setGenOpen] = useState(false);
  const [genParams, setGenParams] = useState<GenParams>(() => {
    try {
      const raw = localStorage.getItem(GEN_STORAGE_KEY);
      if (raw) return { ...GEN_DEFAULTS, ...JSON.parse(raw) };
    } catch { /* noop */ }
    return GEN_DEFAULTS;
  });
  useEffect(() => {
    try { localStorage.setItem(GEN_STORAGE_KEY, JSON.stringify(genParams)); } catch { /* noop */ }
  }, [genParams]);

  /**
   * Считает «План» (сколько по системе) и «Отбор» (зарезервировано) для заданной ячейки.
   * Если указан barcode — фильтрует только по этому товару, иначе суммирует по всем товарам в ячейке.
   * Это даёт точную колонку «План» в акте осмотра, аналогично экрану «Отбор» в WMS.
   */
  const computePlanReserved = useCallback(
    (cell: string, barcode?: string): { qty_plan: number; qty_reserved: number } => {
      if (!cell.trim()) return { qty_plan: 0, qty_reserved: 0 };
      const matchesStock = (s: { cell: string; barcode: string }) =>
        s.cell === cell && (!barcode || s.barcode === barcode);
      const matchesRes = (r: { cell: string; barcode: string }) =>
        r.cell === cell && (!barcode || r.barcode === barcode);
      const qty_plan = stockRows.filter(matchesStock).reduce((sum, s) => sum + (s.qty || 0), 0);
      const qty_reserved = reservations.filter(matchesRes).reduce((sum, r) => sum + (r.qty || 0), 0);
      return { qty_plan, qty_reserved };
    },
    [stockRows, reservations]
  );

  // active dropdown: каноничный ключ "insp-cell-3" / "insp-bc-3" / "rew-bc-2" / "rew-name-5"
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionType>(null);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const productByBarcode = useMemo(
    () => new Map(allProducts.map(p => [p.barcode, p])),
    [allProducts]
  );

  // ═══ INIT ═══
  useEffect(() => {
    loadActs();
    db.cells.toArray().then(setAllCells);
    db.products.filter(p => !p.deleted).toArray().then(setAllProducts);
    Promise.all([
      getSetting('warehouse_name'),
      getSetting('warehouse_addr'),
      getSetting('default_operator'),
    ]).then(([wn, wa, op]) => {
      setInsp(prev => ({
        ...prev,
        warehouse: prev.warehouse || wn,
        warehouse_addr: prev.warehouse_addr || wa,
        inspector_high: prev.inspector_high || op,
        inspector_low: prev.inspector_low || op,
      }));
      setRework(prev => ({
        ...prev,
        warehouse: prev.warehouse || wn,
        warehouse_addr: prev.warehouse_addr || wa,
        supervisor: prev.supervisor || op,
      }));
    });
  }, []);

  // ─── Автосохранение черновиков ─────────────────────────────
  // 1) Дебаунс 1.5 сек после каждого изменения — короткая защита от мелких потерь.
  // 2) Перед закрытием вкладки (beforeunload) — финальный сейв синхронно.
  // 3) При размонтировании компонента (переключение раздела) — финальный сейв в cleanup.
  //
  // saveNowRef — стабильная ссылка на свежую функцию сейва, чтобы её можно было
  // дёргать из beforeunload-обработчика без переподписки.
  const saveNowRef = useRef<() => void>(() => {});
  saveNowRef.current = () => {
    try {
      const now = Date.now();
      const inspDraft: InspectionDraft = { insp, inspRows, savedAt: now, editingId: editingInspId ?? undefined };
      const reworkDraft: ReworkDraft = { rework, reworkPos, savedAt: now, editingId: editingReworkId ?? undefined };
      // Сохраняем только если есть что сохранять (чтобы не плодить мусорные «пустые» черновики).
      if (isInspectionDraftMeaningful(inspDraft)) {
        localStorage.setItem(INSPECTION_DRAFT_KEY, JSON.stringify(inspDraft));
      }
      if (isReworkDraftMeaningful(reworkDraft)) {
        localStorage.setItem(REWORK_DRAFT_KEY, JSON.stringify(reworkDraft));
      }
      setDraftSavedAt(now);
    } catch {
      // localStorage может быть полным или недоступным — не валим UI.
    }
  };

  useEffect(() => {
    // Дебаунс 1.5 секунды — баланс между «не теряет» и «не дёргает диск каждый клик».
    const t = setTimeout(() => saveNowRef.current(), 1500);
    return () => clearTimeout(t);
  }, [insp, inspRows, rework, reworkPos, editingInspId, editingReworkId]);

  useEffect(() => {
    // Сохранение при закрытии вкладки / F5. beforeunload должен быть синхронным.
    const onBeforeUnload = () => { saveNowRef.current(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    // Также сохраняемся при потере видимости (Alt-Tab, переключение приложений).
    const onVisibility = () => { if (document.visibilityState === 'hidden') saveNowRef.current(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      // Финальный сейв при размонтировании компонента — на случай, если пользователь
      // переключился на другой раздел в самой WMS (тогда beforeunload не сработает,
      // и без этого cleanup данные между «свежим вводом» и «20-секундным интервалом» бы пропали).
      saveNowRef.current();
    };
  }, []);

  // Закрытие дропдаунов при клике вне области
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  async function loadActs() {
    try {
      const [insp, rework] = await Promise.all([
        actsApi.listInspection(),
        actsApi.listRework(),
      ]);
      // Раскрываем payload в плоский объект, который ожидает UI
      const inspActsLocal: InspectionAct[] = insp.map(a => {
        const p = (a.payload || {}) as any;
        return {
          id: a.id, act_number: a.act_number, type: 'cell_inspection',
          date: a.date, created_at: a.created_at, updated_at: a.updated_at,
          status: a.status as InspectionAct['status'],
          rows: p.rows || [],
          warehouse: p.warehouse, warehouse_addr: p.warehouse_addr,
          zone_span: p.zone_span, aisle_from: p.aisle_from, aisle_to: p.aisle_to,
          sheet_no: p.sheet_no, sheets_total: p.sheets_total,
          inspector_high: p.inspector_high, inspector_low: p.inspector_low,
          inspector_position: p.inspector_position, note: p.note,
        };
      });
      const reworkLocal: ReworkAct[] = rework.map(a => {
        const p = (a.payload || {}) as any;
        return {
          id: a.id, act_number: a.act_number, date: a.date,
          created_at: a.created_at, updated_at: a.updated_at,
          status: a.status as ReworkAct['status'],
          positions: p.positions || [],
          warehouse: p.warehouse, warehouse_addr: p.warehouse_addr, zone: p.zone,
          source: p.source, destination: p.destination, reason: p.reason,
          ref_document: p.ref_document, start_time: p.start_time, end_time: p.end_time,
          workers: p.workers, supervisor: p.supervisor, pallets_total: p.pallets_total,
          items_total: p.items_total, good_total: p.good_total, defect_total: p.defect_total,
          note: p.note,
        };
      });
      setInspActs(inspActsLocal.sort((a, b) => (b.id || 0) - (a.id || 0)));
      setReworkActs(reworkLocal.sort((a, b) => (b.id || 0) - (a.id || 0)));
      // Локальный кэш
      try {
        await db.transaction('rw', [db.inspectionActs, db.reworkActs], async () => {
          await db.inspectionActs.clear();
          if (inspActsLocal.length) await db.inspectionActs.bulkPut(inspActsLocal);
          await db.reworkActs.clear();
          if (reworkLocal.length) await db.reworkActs.bulkPut(reworkLocal);
        });
      } catch { /* noop */ }
    } catch (e: any) {
      toast('error', `Не удалось загрузить акты: ${e.message || e}. Показываю локальные.`);
      const [ia, ra] = await Promise.all([
        db.inspectionActs.orderBy('id').reverse().toArray(),
        db.reworkActs.orderBy('id').reverse().toArray(),
      ]);
      setInspActs(ia);
      setReworkActs(ra);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AUTOCOMPLETE — единый «контроллер» для всех инпутов
  // ═══════════════════════════════════════════════════════════
  const updateSuggestions = useMemo(
    () => debounce((kind: 'cell' | 'product', value: string, dropdownKey: string) => {
      const q = value.trim().toLowerCase();
      if (q.length < 1) {
        setSuggestions(null);
        setActiveDropdown(null);
        return;
      }
      if (kind === 'cell') {
        const items = allCells
          .filter(c => c.addr.toLowerCase().includes(q) || (c.zone || '').toLowerCase().includes(q))
          .slice(0, 10);
        setSuggestions({ kind: 'cell', items });
      } else {
        const items = allProducts
          .filter(p => p.barcode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
          .slice(0, 10);
        setSuggestions({ kind: 'product', items });
      }
      setActiveDropdown(dropdownKey);
      setActiveSuggestionIdx(0);
    }, 80),
    [allCells, allProducts]
  );

  function onSuggestionKey(e: React.KeyboardEvent<HTMLInputElement>, onPick: (idx: number) => void) {
    if (!activeDropdown || !suggestions || suggestions.items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIdx(v => Math.min(v + 1, suggestions.items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIdx(v => Math.max(v - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onPick(activeSuggestionIdx);
    } else if (e.key === 'Escape') {
      setActiveDropdown(null);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INSPECTION — строки
  // ═══════════════════════════════════════════════════════════
  function addInspRow() {
    setInspRows(r => [...r, { cell: '', status: 'ОК', note: '', barcode: '', qty_plan: undefined, qty_reserved: undefined, qty: undefined, action: '' }]);
  }
  function addInspRows(n: number) {
    setInspRows(r => [
      ...r,
      ...Array.from({ length: n }, () => ({ cell: '', status: 'ОК', note: '', barcode: '', qty_plan: undefined, qty_reserved: undefined, qty: undefined, action: '' })),
    ]);
  }

  /**
   * Генерирует строки по заданным параметрам и добавляет в акт.
   * Если первая строка таблицы пустая (cell == '') — она тоже заменяется первой сгенерированной.
   * Так оператор может нажать «Создать» сразу после открытия формы, без хвоста пустой строки.
   * Для каждой строки сразу подставляются план/отбор по системе, если ячейка существует в БД.
   */
  function generateAndAdd(replace: boolean) {
    const addrs = generateAddrs(genParams);
    if (addrs.length === 0) {
      toast('warning', 'Проверьте параметры: ряд, позиция "от-до", этаж');
      return;
    }
    const newRows: InspectionRow[] = addrs.map(addr => {
      const { qty_plan, qty_reserved } = computePlanReserved(addr);
      return {
        cell: addr,
        status: 'ОК',
        note: '',
        barcode: '',
        qty_plan: qty_plan || undefined,
        qty_reserved: qty_reserved || undefined,
        qty: undefined,
        action: '',
      };
    });
    if (replace) {
      setInspRows(newRows);
    } else {
      // Если в таблице только одна пустая стартовая строка — заменяем её, не оставляем мусор
      setInspRows(prev => {
        const hasOnlyEmpty = prev.length === 1 && !prev[0].cell.trim() && !prev[0].barcode && !prev[0].note;
        return hasOnlyEmpty ? newRows : [...prev, ...newRows];
      });
    }
    setGenOpen(false);
    toast('success', `Создано строк: ${addrs.length}`);
  }
  function removeInspRow(i: number) {
    if (inspRows.length > 1) setInspRows(rows => rows.filter((_, idx) => idx !== i));
  }
  function patchInspRow(i: number, patch: Partial<InspectionRow>) {
    setInspRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  /** Авто-подстановка наименования по ШК + пересчёт плана/отбора под выбранный товар. */
  const onInspBarcodePicked = useCallback((i: number, barcode: string) => {
    const p = productByBarcode.get(barcode);
    const currentRow = inspRows[i];
    // Если ячейка уже выбрана — уточняем план/отбор именно по выбранному товару.
    const update: Partial<InspectionRow> = { barcode, note: p?.name || barcode };
    if (currentRow?.cell?.trim()) {
      const { qty_plan, qty_reserved } = computePlanReserved(currentRow.cell, barcode);
      update.qty_plan = qty_plan;
      update.qty_reserved = qty_reserved;
    }
    patchInspRow(i, update);
    setActiveDropdown(null);
  }, [productByBarcode, inspRows, computePlanReserved]);

  function selectInspCell(i: number, c: Cell) {
    // Берём текущий ШК из строки (если оператор уже выбрал товар), чтобы посчитать
    // план именно по нему. Если ШК ещё не задан — сумма по всем товарам в ячейке.
    const currentRow = inspRows[i];
    const { qty_plan, qty_reserved } = computePlanReserved(c.addr, currentRow?.barcode);
    patchInspRow(i, { cell: c.addr, qty_plan, qty_reserved });
    setActiveDropdown(null);
  }

  async function saveInspection() {
    if (!inspRows.some(r => r.cell.trim())) {
      toast('error', 'Добавьте хотя бы одну строку с ячейкой');
      return;
    }
    const payload = inspectionToPayload({
      warehouse: insp.warehouse,
      warehouse_addr: insp.warehouse_addr,
      zone_span: insp.zone_span,
      aisle_from: insp.aisle_from,
      aisle_to: insp.aisle_to,
      sheet_no: insp.sheet_no ? Number(insp.sheet_no) : undefined,
      sheets_total: insp.sheets_total ? Number(insp.sheets_total) : undefined,
      inspector_high: insp.inspector_high,
      inspector_low: insp.inspector_low,
      inspector_position: insp.inspector_position,
      note: insp.note,
      rows: inspRows,
    });
    try {
      if (editingInspId) {
        await actsApi.updateInspection(editingInspId, { date: insp.date, payload });
        toast('success', 'Акт обновлён');
      } else {
        const resp = await actsApi.createInspection({ date: insp.date, payload });
        toast('success', `Акт осмотра ${resp.act_number} сохранён`);
      }
      setEditingInspId(null);
      resetInspForm();
      await loadActs();
      setTab('list');
    } catch (e: any) {
      toast('error', `Не удалось сохранить: ${e.message || e}`);
    }
  }

  function resetInspForm() {
    setInsp({
      date: todayStr(),
      warehouse: '',
      warehouse_addr: '',
      zone_span: '',
      aisle_from: '',
      aisle_to: '',
      sheet_no: '1',
      sheets_total: '1',
      inspector_high: '',
      inspector_low: '',
      inspector_position: '',
      note: '',
    });
    setInspRows([{ cell: '', status: 'ОК', note: '', barcode: '', qty_plan: undefined, qty_reserved: undefined, qty: undefined, action: '' }]);
    localStorage.removeItem(INSPECTION_DRAFT_KEY);
  }

  function restoreInspectionDraft() {
    const raw = localStorage.getItem(INSPECTION_DRAFT_KEY);
    if (!raw) { toast('info', 'Черновик осмотра не найден'); return; }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.insp) setInsp(prev => ({ ...prev, ...parsed.insp }));
      if (Array.isArray(parsed?.inspRows) && parsed.inspRows.length) setInspRows(parsed.inspRows);
      toast('success', 'Черновик осмотра восстановлен');
    } catch {
      toast('error', 'Не удалось восстановить черновик');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // REWORK — позиции
  // ═══════════════════════════════════════════════════════════
  function addReworkPos() {
    setReworkPos(p => [...p, { barcode: '', name: '', article: '', unit: 'шт', total: 0, good: 0, defect: 0, quantum: undefined, note: '' }]);
  }
  function removeReworkPos(i: number) {
    if (reworkPos.length > 1) setReworkPos(pos => pos.filter((_, idx) => idx !== i));
  }
  function patchReworkPos(i: number, patch: Partial<ReworkPosition>) {
    setReworkPos(pos => pos.map((p, idx) => {
      if (idx !== i) return p;
      const next = { ...p, ...patch };
      if ('total' in patch || 'good' in patch) {
        next.defect = Math.max(0, (next.total || 0) - (next.good || 0));
      }
      return next;
    }));
  }

  /** Авто-подстановка наименования/артикула/единицы по ШК. */
  const onReworkBarcodePicked = useCallback((i: number, barcode: string) => {
    const p = productByBarcode.get(barcode);
    patchReworkPos(i, {
      barcode,
      name: p?.name || '',
      unit: p?.unit || 'шт',
      article: p?.category || '',
    });
    setActiveDropdown(null);
  }, [productByBarcode]);

  async function saveRework() {
    if (!reworkPos.some(p => p.barcode.trim() || p.name.trim())) {
      toast('error', 'Добавьте хотя бы одну позицию');
      return;
    }
    const totals = reworkPos.reduce((acc, p) => ({
      items: acc.items + (p.total || 0),
      good: acc.good + (p.good || 0),
      defect: acc.defect + (p.defect || 0),
    }), { items: 0, good: 0, defect: 0 });

    const payload = reworkToPayload({
      warehouse: rework.warehouse,
      warehouse_addr: rework.warehouse_addr,
      zone: rework.zone,
      source: rework.source,
      destination: rework.destination,
      reason: rework.reason,
      ref_document: rework.ref_document,
      start_time: rework.start_time,
      end_time: rework.end_time,
      workers: rework.workers,
      supervisor: rework.supervisor,
      pallets_total: rework.pallets_total ? Number(rework.pallets_total) : undefined,
      note: rework.note,
      items_total: totals.items,
      good_total: totals.good,
      defect_total: totals.defect,
      positions: reworkPos,
    });
    try {
      if (editingReworkId) {
        await actsApi.updateRework(editingReworkId, { date: rework.date, payload });
        toast('success', 'Акт обновлён');
      } else {
        const resp = await actsApi.createRework({ date: rework.date, payload });
        toast('success', `Акт переборки ${resp.act_number} сохранён`);
      }
      setEditingReworkId(null);
      resetReworkForm();
      await loadActs();
      setTab('list');
    } catch (e: any) {
      toast('error', `Не удалось сохранить: ${e.message || e}`);
    }
  }

  function resetReworkForm() {
    setRework({
      date: todayStr(),
      warehouse: '',
      warehouse_addr: '',
      zone: '',
      source: '',
      destination: '',
      reason: REWORK_REASONS[0],
      ref_document: '',
      start_time: '',
      end_time: '',
      workers: '',
      supervisor: '',
      pallets_total: '',
      note: '',
    });
    setReworkPos([{ barcode: '', name: '', article: '', unit: 'шт', total: 0, good: 0, defect: 0, quantum: undefined, note: '' }]);
    localStorage.removeItem(REWORK_DRAFT_KEY);
  }

  function restoreReworkDraft() {
    const raw = localStorage.getItem(REWORK_DRAFT_KEY);
    if (!raw) { toast('info', 'Черновик переборки не найден'); return; }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.rework) setRework(prev => ({ ...prev, ...parsed.rework }));
      if (Array.isArray(parsed?.reworkPos) && parsed.reworkPos.length) setReworkPos(parsed.reworkPos);
      toast('success', 'Черновик переборки восстановлен');
    } catch {
      toast('error', 'Не удалось восстановить черновик');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PRINT
  // ═══════════════════════════════════════════════════════════
  function printSavedAct(type: 'inspection' | 'rework', id: number) {
    const act = type === 'inspection' ? inspActs.find(a => a.id === id) : reworkActs.find(a => a.id === id);
    if (!act) return;
    const html = type === 'inspection'
      ? renderInspectionAct(act as InspectionAct)
      : renderReworkAct(act as ReworkAct);
    printHtmlInNewWindow(html);
  }

  function printInspectionDraft() {
    const draft: InspectionAct = {
      id: -1,
      act_number: 'ЧЕРНОВИК',
      type: 'cell_inspection',
      date: insp.date,
      warehouse: insp.warehouse,
      warehouse_addr: insp.warehouse_addr,
      zone_span: insp.zone_span,
      aisle_from: insp.aisle_from,
      aisle_to: insp.aisle_to,
      sheet_no: insp.sheet_no ? Number(insp.sheet_no) : undefined,
      sheets_total: insp.sheets_total ? Number(insp.sheets_total) : undefined,
      inspector_high: insp.inspector_high,
      inspector_low: insp.inspector_low,
      inspector_position: insp.inspector_position,
      note: insp.note,
      created_at: Date.now(),
      updated_at: Date.now(),
      status: 'draft',
      rows: inspRows,
    };
    printHtmlInNewWindow(renderInspectionAct(draft));
  }

  function printReworkDraft() {
    const totals = reworkPos.reduce((acc, p) => ({
      total: acc.total + (p.total || 0),
      good: acc.good + (p.good || 0),
      defect: acc.defect + (p.defect || 0),
    }), { total: 0, good: 0, defect: 0 });
    const draft: ReworkAct = {
      id: -1,
      act_number: 'ЧЕРНОВИК',
      date: rework.date,
      warehouse: rework.warehouse,
      warehouse_addr: rework.warehouse_addr,
      zone: rework.zone,
      source: rework.source,
      destination: rework.destination,
      reason: rework.reason,
      ref_document: rework.ref_document,
      start_time: rework.start_time,
      end_time: rework.end_time,
      workers: rework.workers,
      supervisor: rework.supervisor,
      pallets_total: rework.pallets_total ? Number(rework.pallets_total) : undefined,
      note: rework.note,
      items_total: totals.total,
      good_total: totals.good,
      defect_total: totals.defect,
      created_at: Date.now(),
      updated_at: Date.now(),
      status: 'draft',
      positions: reworkPos,
    };
    printHtmlInNewWindow(renderReworkAct(draft));
  }

  // ═══════════════════════════════════════════════════════════
  // DELETE / EDIT
  // ═══════════════════════════════════════════════════════════
  async function deleteAct(type: 'inspection' | 'rework', id: number) {
    if (!confirm('Удалить акт безвозвратно?')) return;
    try {
      if (type === 'inspection') await actsApi.removeInspection(id);
      else await actsApi.removeRework(id);
      toast('info', 'Акт удалён');
      loadActs();
    } catch (e: any) {
      toast('error', `Не удалось удалить: ${e.message || e}`);
    }
  }

  function editInspAct(a: InspectionAct) {
    setEditingInspId(a.id!);
    setInsp({
      date: a.date,
      warehouse: a.warehouse || '',
      warehouse_addr: a.warehouse_addr || '',
      zone_span: a.zone_span || '',
      aisle_from: a.aisle_from || '',
      aisle_to: a.aisle_to || '',
      sheet_no: a.sheet_no ? String(a.sheet_no) : '1',
      sheets_total: a.sheets_total ? String(a.sheets_total) : '1',
      inspector_high: a.inspector_high || '',
      inspector_low: a.inspector_low || '',
      inspector_position: a.inspector_position || '',
      note: a.note || '',
    });
    setInspRows(a.rows.length > 0 ? a.rows : [{ cell: '', status: 'ОК', note: '', barcode: '', qty_plan: undefined, qty_reserved: undefined, qty: undefined, action: '' }]);
    setTab('inspection');
  }

  function editReworkAct(a: ReworkAct) {
    setEditingReworkId(a.id!);
    setRework({
      date: a.date,
      warehouse: a.warehouse || '',
      warehouse_addr: a.warehouse_addr || '',
      zone: a.zone || '',
      source: a.source || '',
      destination: a.destination || '',
      reason: a.reason || REWORK_REASONS[0],
      ref_document: a.ref_document || '',
      start_time: a.start_time || '',
      end_time: a.end_time || '',
      workers: a.workers || '',
      supervisor: a.supervisor || '',
      pallets_total: a.pallets_total ? String(a.pallets_total) : '',
      note: a.note || '',
    });
    setReworkPos(a.positions.length > 0 ? a.positions : [{ barcode: '', name: '', article: '', unit: 'шт', total: 0, good: 0, defect: 0, quantum: undefined, note: '' }]);
    setTab('rework');
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  const inputCls = 'w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm focus:border-nexus-accent/50 outline-none';
  const labelCls = 'text-xs text-nexus-text3 mb-1 block';

  return (
    <div ref={wrapperRef} className="max-w-6xl mx-auto space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 bg-nexus-surface border border-nexus-border rounded-2xl p-1.5">
        {[
          { id: 'list' as const, label: '📂 Список актов' },
          { id: 'inspection' as const, label: '⚖ Акт осмотра' },
          { id: 'rework' as const, label: '🔧 Акт переборки' },
        ].map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setEditingInspId(null); setEditingReworkId(null); }}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${tab === t.id ? 'bg-nexus-accent text-white' : 'text-nexus-text3 hover:text-nexus-text'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
          LIST
          ═══════════════════════════════════════════════════════ */}
      {tab === 'list' && (
        <div className="space-y-3">
          <div className="flex gap-2 mb-4">
            {(['all', 'inspection', 'rework'] as const).map(f => (
              <button key={f} onClick={() => setListFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm ${listFilter === f ? 'bg-nexus-accent/20 text-nexus-accent2' : 'text-nexus-text3 hover:text-nexus-text'}`}>
                {f === 'all' ? 'Все' : f === 'inspection' ? 'Осмотр' : 'Переборка'}
              </button>
            ))}
          </div>

          {(listFilter === 'all' || listFilter === 'inspection') && inspActs.map(a => (
            <div key={`insp-${a.id}`} className="bg-nexus-surface border border-nexus-border rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-900/30 flex items-center justify-center text-blue-400"><FileText size={18} /></div>
              <div className="flex-1 min-w-0">
                <div className="text-nexus-text font-medium">{a.act_number} — Акт осмотра ячеек</div>
                <div className="text-nexus-text3 text-xs">
                  {formatDate(a.date)} · {a.rows.length} строк · {a.warehouse || '—'}
                  {a.sheet_no && a.sheets_total && ` · лист ${a.sheet_no}/${a.sheets_total}`}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === 'saved' ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400'}`}>{a.status === 'saved' ? 'Сохранён' : 'Черновик'}</span>
              <button onClick={() => editInspAct(a)} className="p-2 rounded-lg hover:bg-nexus-surface2 text-nexus-text3 hover:text-nexus-accent" title="Редактировать"><Edit3 size={16} /></button>
              <button onClick={() => printSavedAct('inspection', a.id!)} className="p-2 rounded-lg hover:bg-nexus-surface2 text-nexus-text3 hover:text-blue-400" title="Печать"><Printer size={16} /></button>
              <button onClick={() => deleteAct('inspection', a.id!)} className="p-2 rounded-lg hover:bg-red-900/20 text-nexus-text3 hover:text-red-400" title="Удалить"><Trash2 size={16} /></button>
            </div>
          ))}

          {(listFilter === 'all' || listFilter === 'rework') && reworkActs.map(a => (
            <div key={`rework-${a.id}`} className="bg-nexus-surface border border-nexus-border rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-amber-900/30 flex items-center justify-center text-amber-400"><FileText size={18} /></div>
              <div className="flex-1 min-w-0">
                <div className="text-nexus-text font-medium">{a.act_number} — Акт переборки паллетов</div>
                <div className="text-nexus-text3 text-xs">
                  {formatDate(a.date)} · {a.positions.length} поз. · Годное: {a.good_total || 0} / Брак: {a.defect_total || 0}
                  {a.reason && ` · ${a.reason}`}
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400">Сохранён</span>
              <button onClick={() => editReworkAct(a)} className="p-2 rounded-lg hover:bg-nexus-surface2 text-nexus-text3 hover:text-nexus-accent" title="Редактировать"><Edit3 size={16} /></button>
              <button onClick={() => printSavedAct('rework', a.id!)} className="p-2 rounded-lg hover:bg-nexus-surface2 text-nexus-text3 hover:text-blue-400" title="Печать"><Printer size={16} /></button>
              <button onClick={() => deleteAct('rework', a.id!)} className="p-2 rounded-lg hover:bg-red-900/20 text-nexus-text3 hover:text-red-400" title="Удалить"><Trash2 size={16} /></button>
            </div>
          ))}

          {inspActs.length === 0 && reworkActs.length === 0 && (
            <div className="text-center py-12 text-nexus-text3">
              <div className="text-3xl mb-2">📄</div>
              Нет сохранённых актов. Создайте новый через вкладки выше.
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          INSPECTION FORM
          ═══════════════════════════════════════════════════════ */}
      {tab === 'inspection' && (
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-nexus-text font-bold text-lg">Акт осмотра ячеек {editingInspId ? '(редактирование)' : '(новый)'}</h2>
            {editingInspId && <button onClick={() => { setEditingInspId(null); resetInspForm(); }} className="text-nexus-text3 hover:text-nexus-text text-sm">Отменить редактирование</button>}
          </div>

          {/* Шапка — все поля */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Дата *</label>
              <input type="date" value={insp.date} onChange={e => setInsp({ ...insp, date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Склад</label>
              <input value={insp.warehouse} onChange={e => setInsp({ ...insp, warehouse: e.target.value })} placeholder="Основной склад" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Адрес склада</label>
              <input value={insp.warehouse_addr} onChange={e => setInsp({ ...insp, warehouse_addr: e.target.value })} placeholder="г. Москва, ул. ..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Зона / Ряд</label>
              <input value={insp.zone_span} onChange={e => setInsp({ ...insp, zone_span: e.target.value })} placeholder="A, Б, В..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Пролёт с</label>
              <input value={insp.aisle_from} onChange={e => setInsp({ ...insp, aisle_from: e.target.value })} placeholder="01" className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>Пролёт по</label>
              <input value={insp.aisle_to} onChange={e => setInsp({ ...insp, aisle_to: e.target.value })} placeholder="20" className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>Осматривал (на высоте) — ФИО</label>
              <input value={insp.inspector_high} onChange={e => setInsp({ ...insp, inspector_high: e.target.value })} placeholder="Иванов И.И." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Фиксировал (внизу) — ФИО</label>
              <input value={insp.inspector_low} onChange={e => setInsp({ ...insp, inspector_low: e.target.value })} placeholder="Петров П.П." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Должность инспектора</label>
              <input value={insp.inspector_position} onChange={e => setInsp({ ...insp, inspector_position: e.target.value })} placeholder="Кладовщик / Бригадир" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Лист №</label>
              <input type="number" min="1" value={insp.sheet_no} onChange={e => setInsp({ ...insp, sheet_no: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Всего листов</label>
              <input type="number" min="1" value={insp.sheets_total} onChange={e => setInsp({ ...insp, sheets_total: e.target.value })} className={inputCls} />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>Примечание к акту</label>
              <input value={insp.note} onChange={e => setInsp({ ...insp, note: e.target.value })} placeholder="Общий комментарий ко всему акту" className={inputCls} />
            </div>
          </div>

          {/* Строки */}
          <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-nexus-text font-medium text-sm">Строки акта ({inspRows.length})</h3>
                {draftSavedAt && (
                  <span className="text-[11px] text-emerald-400/80 flex items-center gap-1"
                        title="Черновик автоматически сохраняется в браузере. Если случайно переключитесь — данные не потеряются.">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
                    Авто-сохранено в {new Date(draftSavedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setGenOpen(v => !v)}
                  className={`flex items-center gap-1.5 text-xs border px-2.5 py-1 rounded-lg transition-colors ${genOpen ? 'bg-nexus-accent/15 border-nexus-accent/50 text-nexus-accent2' : 'border-nexus-border text-nexus-text2 hover:border-nexus-accent/40 hover:text-nexus-text'}`}
                  title="Сгенерировать сразу 22+ строк с готовыми адресами по ряду/этажу"
                >
                  <Wand2 size={13} /> Генератор строк
                  <ChevronDown size={12} className={`transition-transform ${genOpen ? 'rotate-180' : ''}`} />
                </button>
                <button onClick={restoreInspectionDraft} className="text-nexus-text3 hover:text-nexus-text text-xs border border-nexus-border px-2 py-1 rounded-lg">Восстановить черновик</button>
                <button onClick={() => addInspRows(10)} className="text-nexus-text3 hover:text-nexus-text text-xs border border-nexus-border px-2 py-1 rounded-lg">+10 строк</button>
                <button onClick={addInspRow} className="flex items-center gap-1 text-nexus-accent text-sm hover:text-nexus-accent2"><Plus size={14} /> Добавить</button>
              </div>
            </div>

            {/* Панель генератора — сворачивается */}
            {genOpen && (() => {
              const preview = generateAddrs(genParams);
              return (
                <div className="mb-4 bg-nexus-surface2 border border-nexus-accent/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-nexus-text font-medium">
                    <Wand2 size={15} className="text-nexus-accent2" />
                    Генератор адресов ячеек
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[10px] text-nexus-text3 uppercase tracking-wide mb-1 block">Ряд</label>
                      <input value={genParams.row} onChange={e => setGenParams(p => ({ ...p, row: e.target.value }))}
                             placeholder="92" className="w-full bg-nexus-surface border border-nexus-border rounded-lg px-3 py-2 text-nexus-text text-sm font-mono outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-nexus-text3 uppercase tracking-wide mb-1 block">Этаж (ярус)</label>
                      <input value={genParams.level} onChange={e => setGenParams(p => ({ ...p, level: e.target.value }))}
                             placeholder="5" className="w-full bg-nexus-surface border border-nexus-border rounded-lg px-3 py-2 text-nexus-text text-sm font-mono outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-nexus-text3 uppercase tracking-wide mb-1 block">Позиция: от</label>
                      <input value={genParams.posFrom} onChange={e => setGenParams(p => ({ ...p, posFrom: e.target.value }))}
                             placeholder="118" className="w-full bg-nexus-surface border border-nexus-border rounded-lg px-3 py-2 text-nexus-text text-sm font-mono outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-nexus-text3 uppercase tracking-wide mb-1 block">Позиция: до</label>
                      <input value={genParams.posTo} onChange={e => setGenParams(p => ({ ...p, posTo: e.target.value }))}
                             placeholder="189" className="w-full bg-nexus-surface border border-nexus-border rounded-lg px-3 py-2 text-nexus-text text-sm font-mono outline-none" />
                    </div>
                  </div>

                  {/* Правило проезда */}
                  <div className="flex items-start gap-2 text-xs text-nexus-text2">
                    <input
                      id="gen-skip-driveway"
                      type="checkbox"
                      checked={genParams.skipDrivewayRows}
                      onChange={e => setGenParams(p => ({ ...p, skipDrivewayRows: e.target.checked }))}
                      className="mt-0.5"
                    />
                    <label htmlFor="gen-skip-driveway" className="cursor-pointer flex-1">
                      <span className="text-nexus-text">Учесть проезд:</span>{' '}
                      в позициях с
                      <input value={genParams.drivewayPosFrom} onChange={e => setGenParams(p => ({ ...p, drivewayPosFrom: e.target.value }))}
                             className="mx-1 w-10 bg-nexus-surface border border-nexus-border rounded px-1.5 py-0.5 text-center text-nexus-text font-mono" />
                      по
                      <input value={genParams.drivewayPosTo} onChange={e => setGenParams(p => ({ ...p, drivewayPosTo: e.target.value }))}
                             className="mx-1 w-10 bg-nexus-surface border border-nexus-border rounded px-1.5 py-0.5 text-center text-nexus-text font-mono" />
                      нет этажей ниже
                      <input value={genParams.drivewayMinLevel} onChange={e => setGenParams(p => ({ ...p, drivewayMinLevel: e.target.value }))}
                             className="mx-1 w-8 bg-nexus-surface border border-nexus-border rounded px-1.5 py-0.5 text-center text-nexus-text font-mono" />
                      <span className="text-nexus-text3">— эти ячейки пропустятся</span>
                    </label>
                  </div>

                  {/* Превью */}
                  <div className="text-xs text-nexus-text3">
                    Будет создано: <span className="text-nexus-text font-bold">{preview.length}</span> строк.{' '}
                    {preview.length > 0 && (
                      <>Пример: <span className="font-mono text-nexus-accent2">{preview[0]}</span>
                      {preview.length > 1 && <> … <span className="font-mono text-nexus-accent2">{preview[preview.length - 1]}</span></>}</>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={() => generateAndAdd(false)} disabled={preview.length === 0}
                            className="flex items-center gap-1.5 bg-nexus-accent hover:bg-nexus-accent2 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium">
                      <Plus size={14} /> Добавить в акт
                    </button>
                    <button onClick={() => generateAndAdd(true)} disabled={preview.length === 0}
                            className="flex items-center gap-1.5 bg-nexus-surface border border-nexus-border hover:border-nexus-accent/40 disabled:opacity-40 disabled:cursor-not-allowed text-nexus-text px-4 py-2 rounded-lg text-sm"
                            title="Удалит существующие строки и заменит на сгенерированные">
                      Заменить все строки
                    </button>
                    <button onClick={() => setGenOpen(false)}
                            className="text-nexus-text3 hover:text-nexus-text px-3 py-2 text-sm">
                      Отмена
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Заголовки */}
            <div className="hidden md:grid gap-2 px-1 mb-1 text-[10px] text-nexus-text3 uppercase tracking-wide font-medium"
                 style={{ gridTemplateColumns: '28px 1fr 150px 1fr 1fr 60px 60px 60px 1fr 24px' }}>
              <span>№</span>
              <span>Ячейка *</span>
              <span>Статус</span>
              <span>ШК товара (для авто-наименования)</span>
              <span>Что находится (наим.)</span>
              <span title="Сколько по системе WMS — подставляется автоматически">План</span>
              <span title="Зарезервировано под отбор/заказы — автоматически">Отбор</span>
              <span title="Сколько фактически нашли при осмотре — вписать вручную">Факт</span>
              <span>Что сделано / Реком.</span>
              <span />
            </div>

            <div className="space-y-1.5">
              {inspRows.map((row, i) => {
                const cellKey = `insp-cell-${i}`;
                const bcKey = `insp-bc-${i}`;
                return (
                  <div key={i} className="grid gap-2 items-center"
                       style={{ gridTemplateColumns: '28px 1fr 150px 1fr 1fr 60px 60px 60px 1fr 24px' }}>
                    <span className="text-nexus-text3 text-xs text-center">{i + 1}</span>

                    {/* Ячейка */}
                    <div className="relative">
                      <input
                        value={row.cell}
                        onChange={e => {
                          patchInspRow(i, { cell: e.target.value });
                          updateSuggestions('cell', e.target.value, cellKey);
                        }}
                        onFocus={() => { if (row.cell) updateSuggestions('cell', row.cell, cellKey); }}
                        onKeyDown={e => {
                          // Tab без модификаторов / Ctrl+Enter / Enter без открытой подсказки
                          // → автоинкремент в следующую строку. Это позволяет «пробегать» ряд за секунды:
                          //   ввёл 90-118-1 → Tab → следующая строка получает 90-119-1.
                          // Если подсказка открыта — отдаём событие ей.
                          const hasOpenSuggestion = activeDropdown === cellKey && (suggestions?.items?.length ?? 0) > 0;
                          if (!hasOpenSuggestion && row.cell && (e.key === 'Tab' || e.key === 'Enter')) {
                            const next = nextCellAddr(row.cell);
                            if (next) {
                              e.preventDefault();
                              // Если следующая строка уже есть и адрес пустой — заполним её.
                              // Иначе добавим новую строку с этим адресом.
                              const nextIdx = i + 1;
                              const { qty_plan, qty_reserved } = computePlanReserved(next);
                              setInspRows(prev => {
                                if (nextIdx < prev.length && !prev[nextIdx].cell.trim()) {
                                  return prev.map((r, idx) =>
                                    idx === nextIdx
                                      ? { ...r, cell: next, qty_plan: qty_plan || undefined, qty_reserved: qty_reserved || undefined }
                                      : r
                                  );
                                }
                                return [
                                  ...prev,
                                  { cell: next, status: 'ОК', note: '', barcode: '', qty_plan: qty_plan || undefined, qty_reserved: qty_reserved || undefined, qty: undefined, action: '' },
                                ];
                              });
                              setActiveDropdown(null);
                              // Фокус на новый адрес — через requestAnimationFrame, чтобы DOM успел отрисоваться
                              requestAnimationFrame(() => {
                                const next_el = document.querySelector<HTMLInputElement>(`input[data-cell-idx="${nextIdx}"]`);
                                next_el?.focus();
                                next_el?.select();
                              });
                              return;
                            }
                          }
                          onSuggestionKey(e, idx => {
                            const c = (suggestions?.kind === 'cell' && suggestions.items[idx]) || null;
                            if (c) selectInspCell(i, c);
                          });
                        }}
                        data-cell-idx={i}
                        placeholder="Начните вводить адрес... (Tab → следующая +1)"
                        className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-3 py-2 text-nexus-text text-sm font-mono focus:border-nexus-accent/50 outline-none"
                      />
                      {activeDropdown === cellKey && suggestions?.kind === 'cell' && suggestions.items.length > 0 && (
                        <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-nexus-surface2 border-2 border-nexus-accent/35 rounded-xl shadow-2xl max-h-56 overflow-y-auto" onClick={e => e.stopPropagation()}>
                          {suggestions.items.map((c, idx) => (
                            <div key={c.addr} onMouseDown={() => selectInspCell(i, c)}
                                 className={`px-3 py-2.5 cursor-pointer text-sm font-mono text-nexus-accent2 flex items-center gap-2 border-b border-nexus-border/30 last:border-0 ${idx === activeSuggestionIdx ? 'bg-nexus-surface3 ring-1 ring-inset ring-nexus-accent/40' : 'hover:bg-nexus-surface3'}`}>
                              <MapPin size={12} className="text-nexus-text3" />
                              {c.addr}
                              {c.zone && <span className="text-nexus-text3 text-xs ml-auto">{c.zone}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Статус — при смене умно подставляем рекомендацию, если оператор ещё ничего не вписал */}
                    <select value={row.status} onChange={e => {
                      const newStatus = e.target.value;
                      const patch: Partial<InspectionRow> = { status: newStatus };
                      // Если действие пустое или совпадает с предыдущей авто-рекомендацией —
                      // подставляем новую. Если оператор уже вписал что-то своё — не трогаем.
                      const prevSuggestion = suggestedActionFor(row.status);
                      const currentAction = row.action || '';
                      if (currentAction === '' || currentAction === prevSuggestion) {
                        patch.action = suggestedActionFor(newStatus);
                      }
                      patchInspRow(i, patch);
                    }}
                            className="bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-text text-xs">
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.value} — {s.label.split(' — ')[1]}</option>)}
                    </select>

                    {/* ШК с автовводом */}
                    <div className="relative">
                      <input
                        value={row.barcode || ''}
                        onChange={e => {
                          patchInspRow(i, { barcode: e.target.value });
                          updateSuggestions('product', e.target.value, bcKey);
                        }}
                        onFocus={() => { if (row.barcode) updateSuggestions('product', row.barcode, bcKey); }}
                        onKeyDown={e => onSuggestionKey(e, idx => {
                          const p = (suggestions?.kind === 'product' && suggestions.items[idx]) || null;
                          if (p) onInspBarcodePicked(i, p.barcode);
                        })}
                        placeholder="ШК или название..."
                        className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-accent2 text-xs font-mono outline-none"
                      />
                      {activeDropdown === bcKey && suggestions?.kind === 'product' && suggestions.items.length > 0 && (
                        <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-nexus-surface2 border-2 border-nexus-accent/35 rounded-xl shadow-2xl max-h-56 overflow-y-auto min-w-[320px]" onClick={e => e.stopPropagation()}>
                          {suggestions.items.map((p, idx) => (
                            <div key={p.barcode} onMouseDown={() => onInspBarcodePicked(i, p.barcode)}
                                 className={`px-3 py-2 cursor-pointer text-xs flex items-center gap-2 border-b border-nexus-border/30 last:border-0 ${idx === activeSuggestionIdx ? 'bg-nexus-surface3 ring-1 ring-inset ring-nexus-accent/40' : 'hover:bg-nexus-surface3'}`}>
                              <Package size={12} className="text-nexus-text3" />
                              <span className="font-mono text-nexus-accent2">{p.barcode}</span>
                              <span className="text-nexus-text flex-1 truncate">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Наименование */}
                    <input value={row.note} onChange={e => patchInspRow(i, { note: e.target.value })}
                           placeholder="Что фактически найдено" className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-3 py-2 text-nexus-text text-sm outline-none" />

                    {/* План — авто-подстановка из системы, оператор может поправить */}
                    <input type="number" min="0" value={row.qty_plan ?? ''}
                           onChange={e => patchInspRow(i, { qty_plan: e.target.value !== '' ? Number(e.target.value) : undefined })}
                           title="План: сколько товара числится в системе. Подставляется автоматически при выборе ячейки/товара."
                           placeholder="—"
                           className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-1 py-2 text-nexus-text2 text-sm text-center outline-none" />

                    {/* Отбор — авто из reservations */}
                    <input type="number" min="0" value={row.qty_reserved ?? ''}
                           onChange={e => patchInspRow(i, { qty_reserved: e.target.value !== '' ? Number(e.target.value) : undefined })}
                           title="Отбор: зарезервировано под заказы. Подставляется автоматически."
                           placeholder="—"
                           className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-1 py-2 text-amber-300 text-sm text-center outline-none" />

                    {/* Факт — оператор вписывает то, что увидел в ячейке */}
                    <input type="number" min="0" value={row.qty ?? ''}
                           onChange={e => patchInspRow(i, { qty: e.target.value !== '' ? Number(e.target.value) : undefined })}
                           title="Факт: сколько фактически нашли при осмотре. Вписать вручную."
                           placeholder="0"
                           className={`w-full bg-nexus-surface2 border rounded-lg px-1 py-2 text-sm text-center outline-none ${
                             row.qty !== undefined && row.qty_plan !== undefined && row.qty !== row.qty_plan
                               ? 'border-red-500/50 text-red-300 font-semibold'
                               : 'border-nexus-border text-nexus-text'
                           }`} />

                    {/* Действие — выпадающий список типовых вариантов + свободный ввод */}
                    {(() => {
                      const cur = row.action || '';
                      // "Кастомное" значение — это любой текст, которого нет в типовом списке (и не пустой).
                      const isCustom = cur !== '' && !ALL_PREDEFINED_ACTIONS.has(cur);
                      // Что выбрано в select: '' / типовое значение / '__custom__'
                      const selectValue = cur === '' ? '' : isCustom ? '__custom__' : cur;

                      return (
                        <div className="flex flex-col gap-1">
                          <select
                            value={selectValue}
                            onChange={e => {
                              const v = e.target.value;
                              if (v === '__custom__') {
                                // Включаем режим свободного ввода — оставляем то, что было,
                                // или ставим пробел, чтобы появилось не-пустое поле.
                                patchInspRow(i, { action: isCustom ? cur : ' ' });
                              } else {
                                patchInspRow(i, { action: v });
                              }
                            }}
                            className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-text text-xs outline-none cursor-pointer"
                            title="Выберите типовое действие или «Свой текст…» для свободного ввода"
                          >
                            {ACTION_GROUPS.map(g => (
                              <optgroup key={g.label} label={g.label}>
                                {g.options.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          {(isCustom || selectValue === '__custom__') && (
                            <input
                              value={cur.trim() === '' ? '' : cur}
                              onChange={e => patchInspRow(i, { action: e.target.value })}
                              placeholder="Опишите своё действие…"
                              autoFocus={!isCustom}
                              className="w-full bg-nexus-surface2 border border-nexus-accent/40 rounded-lg px-2 py-1.5 text-nexus-text text-xs outline-none"
                            />
                          )}
                        </div>
                      );
                    })()}

                    <button onClick={() => removeInspRow(i)} className="p-1.5 text-nexus-text3 hover:text-red-400"><X size={14} /></button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button onClick={saveInspection} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2.5 rounded-xl text-sm font-medium"><Save size={16} /> Сохранить акт</button>
            <button onClick={printInspectionDraft} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border hover:border-nexus-border2 text-nexus-text px-4 py-2.5 rounded-xl text-sm"><Printer size={16} /> Печать черновика</button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          REWORK FORM
          ═══════════════════════════════════════════════════════ */}
      {tab === 'rework' && (
        <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-nexus-text font-bold text-lg">Акт переборки паллетов {editingReworkId ? '(редактирование)' : '(новый)'}</h2>
            {editingReworkId && <button onClick={() => { setEditingReworkId(null); resetReworkForm(); }} className="text-nexus-text3 hover:text-nexus-text text-sm">Отменить редактирование</button>}
          </div>

          {/* Шапка */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Дата *</label>
              <input type="date" value={rework.date} onChange={e => setRework({ ...rework, date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Склад</label>
              <input value={rework.warehouse} onChange={e => setRework({ ...rework, warehouse: e.target.value })} placeholder="Основной склад" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Адрес склада</label>
              <input value={rework.warehouse_addr} onChange={e => setRework({ ...rework, warehouse_addr: e.target.value })} placeholder="г. Москва, ул. ..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Участок / Зона</label>
              <input value={rework.zone} onChange={e => setRework({ ...rework, zone: e.target.value })} placeholder="Склад Е, зона переборки" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Время начала</label>
              <input type="time" value={rework.start_time} onChange={e => setRework({ ...rework, start_time: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Время окончания</label>
              <input type="time" value={rework.end_time} onChange={e => setRework({ ...rework, end_time: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Источник (откуда взяли паллет)</label>
              <input value={rework.source} onChange={e => setRework({ ...rework, source: e.target.value })} placeholder="Стеллаж А12, паллет №..." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Назначение (куда отправлен товар)</label>
              <input value={rework.destination} onChange={e => setRework({ ...rework, destination: e.target.value })} placeholder="Зона хранения / отгрузка" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Причина переборки</label>
              <select value={rework.reason} onChange={e => setRework({ ...rework, reason: e.target.value })} className={inputCls}>
                {REWORK_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Первичный документ</label>
              <input value={rework.ref_document} onChange={e => setRework({ ...rework, ref_document: e.target.value })} placeholder="№ накладной / задания" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Кол-во перебранных паллетов</label>
              <input type="number" min="0" value={rework.pallets_total} onChange={e => setRework({ ...rework, pallets_total: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Перебирали — ФИО (через запятую)</label>
              <input value={rework.workers} onChange={e => setRework({ ...rework, workers: e.target.value })} placeholder="Тюкавин А.Д., Вялушкин Д.А." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Контролировал — ФИО</label>
              <input value={rework.supervisor} onChange={e => setRework({ ...rework, supervisor: e.target.value })} placeholder="ФИО мастера" className={inputCls} />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>Примечание к акту</label>
              <input value={rework.note} onChange={e => setRework({ ...rework, note: e.target.value })} placeholder="Общий комментарий ко всему акту" className={inputCls} />
            </div>
          </div>

          {/* Позиции */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-nexus-text font-medium text-sm">Позиции ({reworkPos.length})</h3>
                {draftSavedAt && (
                  <span className="text-[11px] text-emerald-400/80 flex items-center gap-1"
                        title="Черновик автоматически сохраняется в браузере.">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
                    Авто-сохранено в {new Date(draftSavedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={restoreReworkDraft} className="text-nexus-text3 hover:text-nexus-text text-xs border border-nexus-border px-2 py-1 rounded-lg">Восстановить черновик</button>
                <button onClick={addReworkPos} className="flex items-center gap-1 text-nexus-accent text-sm hover:text-nexus-accent2"><Plus size={14} /> Добавить</button>
              </div>
            </div>

            <div className="hidden md:grid gap-2 px-1 mb-1 text-[10px] text-nexus-text3 uppercase tracking-wide font-medium"
                 style={{ gridTemplateColumns: '24px 130px 1fr 90px 60px 70px 70px 60px 1fr 24px' }}>
              <span>№</span>
              <span>ШК *</span>
              <span>Наименование</span>
              <span>Артикул</span>
              <span>Ед.</span>
              <span>Всего</span>
              <span>Годное</span>
              <span>Брак</span>
              <span>Причина / Прим.</span>
              <span />
            </div>

            <div className="space-y-1.5">
              {reworkPos.map((pos, i) => {
                const bcKey = `rew-bc-${i}`;
                const nameKey = `rew-name-${i}`;
                return (
                  <div key={i} className="grid gap-2 items-center"
                       style={{ gridTemplateColumns: '24px 130px 1fr 90px 60px 70px 70px 60px 1fr 24px' }}>
                    <span className="text-nexus-text3 text-xs text-center">{i + 1}</span>

                    {/* ШК + autocomplete */}
                    <div className="relative">
                      <input
                        value={pos.barcode}
                        onChange={e => {
                          patchReworkPos(i, { barcode: e.target.value });
                          updateSuggestions('product', e.target.value, bcKey);
                        }}
                        onFocus={() => { if (pos.barcode) updateSuggestions('product', pos.barcode, bcKey); }}
                        onKeyDown={e => onSuggestionKey(e, idx => {
                          const p = (suggestions?.kind === 'product' && suggestions.items[idx]) || null;
                          if (p) onReworkBarcodePicked(i, p.barcode);
                        })}
                        placeholder="ШК"
                        className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-accent2 text-xs font-mono outline-none"
                      />
                      {activeDropdown === bcKey && suggestions?.kind === 'product' && suggestions.items.length > 0 && (
                        <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-nexus-surface2 border-2 border-nexus-accent/35 rounded-xl shadow-2xl max-h-56 overflow-y-auto min-w-[320px]" onClick={e => e.stopPropagation()}>
                          {suggestions.items.map((p, idx) => (
                            <div key={p.barcode} onMouseDown={() => onReworkBarcodePicked(i, p.barcode)}
                                 className={`px-3 py-2 cursor-pointer text-xs flex items-center gap-2 border-b border-nexus-border/30 last:border-0 ${idx === activeSuggestionIdx ? 'bg-nexus-surface3 ring-1 ring-inset ring-nexus-accent/40' : 'hover:bg-nexus-surface3'}`}>
                              <Package size={12} className="text-nexus-text3" />
                              <span className="font-mono text-nexus-accent2">{p.barcode}</span>
                              <span className="text-nexus-text flex-1 truncate">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Наименование + autocomplete по названию */}
                    <div className="relative">
                      <input
                        value={pos.name}
                        onChange={e => {
                          patchReworkPos(i, { name: e.target.value });
                          updateSuggestions('product', e.target.value, nameKey);
                        }}
                        onFocus={() => { if (pos.name && pos.name.length >= 2) updateSuggestions('product', pos.name, nameKey); }}
                        onKeyDown={e => onSuggestionKey(e, idx => {
                          const p = (suggestions?.kind === 'product' && suggestions.items[idx]) || null;
                          if (p) onReworkBarcodePicked(i, p.barcode);
                        })}
                        placeholder="Начните вводить название..."
                        className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-text text-xs outline-none"
                      />
                      {activeDropdown === nameKey && suggestions?.kind === 'product' && suggestions.items.length > 0 && (
                        <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-nexus-surface2 border-2 border-nexus-accent/35 rounded-xl shadow-2xl max-h-56 overflow-y-auto" onClick={e => e.stopPropagation()}>
                          {suggestions.items.map((p, idx) => (
                            <div key={p.barcode} onMouseDown={() => onReworkBarcodePicked(i, p.barcode)}
                                 className={`px-3 py-2 cursor-pointer text-xs flex items-center gap-2 border-b border-nexus-border/30 last:border-0 ${idx === activeSuggestionIdx ? 'bg-nexus-surface3 ring-1 ring-inset ring-nexus-accent/40' : 'hover:bg-nexus-surface3'}`}>
                              <Package size={12} className="text-nexus-text3" />
                              <span className="font-mono text-nexus-accent2">{p.barcode}</span>
                              <span className="text-nexus-text flex-1 truncate">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Артикул */}
                    <input value={pos.article || ''} onChange={e => patchReworkPos(i, { article: e.target.value })}
                           placeholder="—" className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-text text-xs outline-none" />

                    {/* Ед. */}
                    <select value={pos.unit || 'шт'} onChange={e => patchReworkPos(i, { unit: e.target.value })}
                            className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-1 py-2 text-nexus-text text-xs">
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>

                    <input type="number" min="0" value={pos.total || ''} onChange={e => patchReworkPos(i, { total: Number(e.target.value) })}
                           placeholder="0" className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-text text-xs text-center outline-none" />
                    <input type="number" min="0" value={pos.good || ''} onChange={e => patchReworkPos(i, { good: Number(e.target.value) })}
                           placeholder="0" className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-text text-xs text-center outline-none" />
                    <span className={`w-full text-center font-bold text-sm ${pos.defect > 0 ? 'text-red-400' : 'text-nexus-text3'}`}>{pos.defect || 0}</span>

                    <input value={pos.note} onChange={e => patchReworkPos(i, { note: e.target.value })}
                           placeholder="Истёк срок, повреждение..." className="w-full bg-nexus-surface2 border border-nexus-border rounded-lg px-2 py-2 text-nexus-text text-xs outline-none" />

                    <button onClick={() => removeReworkPos(i)} className="p-1.5 text-nexus-text3 hover:text-red-400"><X size={14} /></button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Итоги */}
          <div className="bg-nexus-surface2 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-nexus-text font-bold text-xl">{reworkPos.reduce((s, p) => s + (p.total || 0), 0)}</div>
              <div className="text-nexus-text3 text-xs">Всего ед.</div>
            </div>
            <div>
              <div className="text-green-400 font-bold text-xl">{reworkPos.reduce((s, p) => s + (p.good || 0), 0)}</div>
              <div className="text-nexus-text3 text-xs">Годного</div>
            </div>
            <div>
              <div className="text-red-400 font-bold text-xl">{reworkPos.reduce((s, p) => s + (p.defect || 0), 0)}</div>
              <div className="text-nexus-text3 text-xs">Брак</div>
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button onClick={saveRework} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-5 py-2.5 rounded-xl text-sm font-medium"><Save size={16} /> Сохранить акт</button>
            <button onClick={printReworkDraft} className="flex items-center gap-2 bg-nexus-surface2 border border-nexus-border hover:border-nexus-border2 text-nexus-text px-4 py-2.5 rounded-xl text-sm"><Printer size={16} /> Печать черновика</button>
          </div>
        </div>
      )}
    </div>
  );
}
