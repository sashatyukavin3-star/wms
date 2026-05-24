import { ClipboardCheck, Play, Plus, Save, Square, Trash2 } from 'lucide-react';
import { useCallback,useEffect, useState } from 'react';

import { toast } from '../App';
import { db, type InvLine,type InvSession } from '../db';
import { useData } from '../hooks/useData';
import { inventoryApi,opsApi } from '../lib/services';
import { subscribe } from '../lib/ws';
import { formatDateTime } from '../utils';

/**
 * Раздел «Инвентаризация».
 *
 * Все сессии и строки теперь живут на сервере — они общие для всех ПК.
 * Это значит:
 *   • один оператор начинает сессию, другой может её продолжить;
 *   • при сбое браузера данные не теряются (всё на сервере);
 *   • при изменении на одном ПК остальные мгновенно увидят через WS-эвент inv:changed.
 *
 * Локальный Dexie остаётся только как тёплый кэш на случай оффлайна:
 *   при успешном чтении с сервера данные дублируются туда же.
 */
export default function Inventory() {
  // Остатки — из централизованного DataProvider (он сам синхронизирован с сервером).
  // Используем для расчёта «системного» количества при записи строки инвентаризации.
  const { getStockByBarcode } = useData();

  const [sessions, setSessions] = useState<InvSession[]>([]);
  const [activeSession, setActiveSession] = useState<InvSession | null>(null);
  const [lines, setLines] = useState<InvLine[]>([]);
  const [showNewSession, setShowNewSession] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [sessionZone, setSessionZone] = useState('');
  const [sessionOp, setSessionOp] = useState('');
  const [scanBarcode, setScanBarcode] = useState('');
  const [scanCell, setScanCell] = useState('');
  const [scanQty, setScanQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  // ─── Загрузка сессий с сервера ──────────────────────────────
  const load = useCallback(async () => {
    try {
      const fresh = await inventoryApi.listSessions();
      setSessions(fresh);
      // Дублируем в локальный кэш для оффлайн-чтения.
      try {
        await db.transaction('rw', db.invSessions, async () => {
          await db.invSessions.clear();
          if (fresh.length) await db.invSessions.bulkPut(fresh);
        });
      } catch { /* noop */ }
    } catch (e: any) {
      // Сервер недоступен — показываем то, что есть локально.
      const local = await db.invSessions.orderBy('id').reverse().toArray();
      setSessions(local);
      console.warn('[Inventory] сервер недоступен, читаю локально:', e);
    }
  }, []);

  useEffect(() => {
    load();
    db.settings.get('default_operator').then(s => s && setSessionOp(s.value));
  }, [load]);

  // ─── Подписка на WS-эвенты: мгновенно обновляемся при изменениях ──
  useEffect(() => {
    const off = subscribe(evt => {
      if (evt.type === 'inv:changed') {
        load();
        // Если открыта активная сессия и пришёл эвент про неё — обновляем и строки
        if (activeSession?.id && evt.session_id === activeSession.id) {
          inventoryApi.getLines(activeSession.id).then(setLines).catch(() => { /* noop */ });
        }
      }
    });
    return off;
  }, [load, activeSession]);

  // ─── Создание сессии ───────────────────────────────────────
  async function createSession() {
    if (!sessionName.trim()) { toast('error', 'Введите название сессии'); return; }
    setBusy(true);
    try {
      const { id } = await inventoryApi.createSession({
        name: sessionName,
        zone_filter: sessionZone || undefined,
        operator: sessionOp || undefined,
      });
      toast('success', `Сессия "${sessionName}" создана`);
      setShowNewSession(false);
      setSessionName('');
      await load();
      // Открываем созданную сессию для немедленного скана
      const session = await inventoryApi.getSession(id);
      setActiveSession(session);
      setLines(session.lines || []);
    } catch (e: any) {
      toast('error', `Не удалось создать сессию: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  // ─── Открытие существующей сессии ──────────────────────────
  async function openSession(s: InvSession) {
    try {
      const fresh = await inventoryApi.getSession(s.id!);
      setActiveSession(fresh);
      setLines(fresh.lines || []);
    } catch (e: any) {
      // Фоллбек: читаем из локальной БД
      setActiveSession(s);
      const l = await db.invLines.where('session_id').equals(s.id!).toArray();
      setLines(l);
      toast('warning', `Сервер недоступен, показываю локальные данные: ${e.message || e}`);
    }
  }

  // ─── Системный qty: «по системе сколько должно быть» ───────
  // Берём из useData() — он реагирует на WS stock:changed, так что цифры всегда свежие.
  function getSystemQty(barcode: string, cell: string): number {
    const all = getStockByBarcode(barcode);
    if (cell.trim()) {
      return all.find(s => s.cell === cell)?.qty || 0;
    }
    return all.reduce((sum, s) => sum + s.qty, 0);
  }

  // ─── Запись строки скана ────────────────────────────────────
  async function addLine() {
    if (!activeSession?.id) return;
    if (!scanBarcode.trim()) { toast('error', 'Введите штрихкод'); return; }
    if (!scanCell.trim()) { toast('error', 'Введите ячейку (она нужна для применения корректировок)'); return; }

    const qty_system = getSystemQty(scanBarcode.trim(), scanCell.trim());
    const qty_fact = Number(scanQty) || 0;
    setBusy(true);
    try {
      const { delta } = await inventoryApi.addLine(activeSession.id, {
        barcode: scanBarcode.trim(),
        cell: scanCell.trim(),
        qty_system,
        qty_fact,
      });
      // Очищаем поля и перезагружаем строки (или дождёмся WS-эвента — но руками быстрее)
      setScanBarcode(''); setScanCell(''); setScanQty('');
      const fresh = await inventoryApi.getLines(activeSession.id);
      setLines(fresh);
      toast(delta === 0 ? 'success' : 'warning',
        `Записано: факт ${qty_fact}, система ${qty_system}, δ ${delta > 0 ? '+' : ''}${delta}`);
    } catch (e: any) {
      toast('error', `Не удалось записать: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  // ─── Удаление строки (если оператор ошибся) ────────────────
  async function deleteLine(lineId: number) {
    if (!confirm('Удалить эту строку из сессии?')) return;
    try {
      await inventoryApi.removeLine(lineId);
      if (activeSession?.id) {
        const fresh = await inventoryApi.getLines(activeSession.id);
        setLines(fresh);
      }
    } catch (e: any) {
      toast('error', `Не удалось удалить: ${e.message || e}`);
    }
  }

  // ─── Закрытие сессии + применение корректировок ─────────────
  async function closeSession() {
    if (!activeSession?.id) return;
    if (!confirm('Закрыть сессию инвентаризации? Корректировки будут применены на сервере (приходование/списание).')) return;

    setClosing(true);
    let ok = 0, fail = 0;
    for (const line of lines) {
      if (line.delta === 0 || !line.cell) continue;
      const note = `Инв. #${activeSession.id}: ${line.delta > 0 ? '+' : ''}${line.delta}`;
      try {
        if (line.delta > 0) {
          await opsApi.receive({ barcode: line.barcode, cell: line.cell, qty: line.delta, note, operator: activeSession.operator });
        } else {
          await opsApi.ship({ barcode: line.barcode, cell: line.cell, qty: Math.abs(line.delta), note, operator: activeSession.operator });
        }
        ok++;
      } catch (e: any) {
        fail++;
        console.warn(`[Inventory] не удалось применить корректировку ${line.barcode}@${line.cell}:`, e);
      }
    }

    try {
      await inventoryApi.closeSession(activeSession.id);
      if (fail === 0) {
        toast('success', `Сессия закрыта, применено корректировок: ${ok}`);
      } else {
        toast('warning', `Применено: ${ok}, не удалось: ${fail}. Проверьте остатки и сеть.`);
      }
      setActiveSession(null);
      setLines([]);
      load();
    } catch (e: any) {
      toast('error', `Корректировки применены (${ok}), но не удалось пометить сессию закрытой: ${e.message || e}`);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {!activeSession ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-nexus-text font-bold text-lg flex items-center gap-2"><ClipboardCheck className="text-nexus-accent2" size={22} /> Инвентаризация</h2>
            <button onClick={() => setShowNewSession(true)} disabled={busy}
                    className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
              <Plus size={16} /> Новая сессия
            </button>
          </div>

          <div className="space-y-3">
            {sessions.map(s => (
              <div key={s.id} onClick={() => s.status === 'active' && openSession(s)}
                   className={`bg-nexus-surface border border-nexus-border rounded-xl p-4 flex items-center gap-4 ${s.status === 'active' ? 'cursor-pointer hover:border-nexus-accent/50' : 'opacity-70'}`}>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.status === 'active' ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                  {s.status === 'active' ? <Play size={18} /> : <Square size={18} />}
                </div>
                <div className="flex-1">
                  <div className="text-nexus-text font-medium">{s.name}</div>
                  <div className="text-nexus-text3 text-xs">{formatDateTime(s.created_at)} · {s.operator || 'Без оператора'} {s.zone_filter ? `· Зона: ${s.zone_filter}` : ''}</div>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${s.status === 'active' ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-400'}`}>
                  {s.status === 'active' ? 'Активна' : 'Закрыта'}
                </span>
              </div>
            ))}
            {sessions.length === 0 && <div className="text-center py-12 text-nexus-text3">Нет сессий инвентаризации. Создайте первую.</div>}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-nexus-text font-bold text-lg">{activeSession.name}</h2>
              <p className="text-nexus-text3 text-sm">{activeSession.zone_filter ? `Зона: ${activeSession.zone_filter}` : 'Весь склад'} · Оператор: {activeSession.operator || '—'}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setActiveSession(null)} className="px-4 py-2 rounded-xl text-nexus-text3 hover:text-nexus-text text-sm border border-nexus-border">Назад</button>
              <button onClick={closeSession} disabled={closing}
                      className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
                <Square size={16} /> {closing ? 'Закрываем...' : 'Закрыть сессию'}
              </button>
            </div>
          </div>

          {/* Scan input */}
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-5">
            <div className="grid md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Штрихкод</label>
                <input value={scanBarcode} onChange={e => setScanBarcode(e.target.value)} placeholder="Сканируйте ШК" autoFocus
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono"
                  onKeyDown={e => e.key === 'Enter' && addLine()} />
              </div>
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Ячейка</label>
                <input value={scanCell} onChange={e => setScanCell(e.target.value)} placeholder="90-118-1"
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Факт. количество</label>
                <input type="number" value={scanQty} onChange={e => setScanQty(e.target.value)} placeholder="0"
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
              </div>
              <div className="flex items-end">
                <button onClick={addLine} disabled={busy}
                        className="w-full flex items-center justify-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium">
                  <Plus size={16} /> Записать
                </button>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-400px)]">
              <table className="w-full text-sm">
                <thead className="sticky-header">
                  <tr className="border-b border-nexus-border bg-nexus-surface2">
                    <th className="px-3 py-3 text-left text-nexus-text3 font-medium">ШК</th>
                    <th className="px-3 py-3 text-left text-nexus-text3 font-medium">Ячейка</th>
                    <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Система</th>
                    <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Факт</th>
                    <th className="px-3 py-3 text-center text-nexus-text3 font-medium">Δ</th>
                    <th className="px-3 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} className={`border-b border-nexus-border/50 ${l.delta !== 0 ? (l.delta > 0 ? 'bg-green-950/20' : 'bg-red-950/20') : ''}`}>
                      <td className="px-3 py-2.5 font-mono text-nexus-accent2 text-xs">{l.barcode}</td>
                      <td className="px-3 py-2.5 font-mono text-nexus-text2">{l.cell}</td>
                      <td className="px-3 py-2.5 text-center text-nexus-text2">{l.qty_system}</td>
                      <td className="px-3 py-2.5 text-center text-nexus-text font-medium">{l.qty_fact}</td>
                      <td className={`px-3 py-2.5 text-center font-bold ${l.delta > 0 ? 'text-green-400' : l.delta < 0 ? 'text-red-400' : 'text-nexus-text3'}`}>
                        {l.delta > 0 ? '+' : ''}{l.delta}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => deleteLine(l.id!)} title="Удалить строку"
                                className="p-1.5 rounded-lg hover:bg-red-900/30 text-nexus-text3 hover:text-red-400">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-nexus-text3">Отсканируйте товары для начала инвентаризации</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          {lines.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 text-center">
                <div className="text-nexus-text text-2xl font-bold">{lines.length}</div>
                <div className="text-nexus-text3 text-xs">Позиций проверено</div>
              </div>
              <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 text-center">
                <div className="text-green-400 text-2xl font-bold">{lines.filter(l => l.delta === 0).length}</div>
                <div className="text-nexus-text3 text-xs">Совпадений</div>
              </div>
              <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 text-center">
                <div className="text-red-400 text-2xl font-bold">{lines.filter(l => l.delta !== 0).length}</div>
                <div className="text-nexus-text3 text-xs">Расхождений</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* New Session Modal */}
      {showNewSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowNewSession(false)}>
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl w-full max-w-md animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-nexus-border">
              <h2 className="text-nexus-text font-bold text-lg">Новая инвентаризация</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Название *</label>
                <input value={sessionName} onChange={e => setSessionName(e.target.value)} placeholder="Инвентаризация #1"
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Зона (фильтр)</label>
                <input value={sessionZone} onChange={e => setSessionZone(e.target.value)} placeholder="Оставьте пустым для всего склада"
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-nexus-text3 mb-1 block">Оператор</label>
                <input value={sessionOp} onChange={e => setSessionOp(e.target.value)} placeholder="Иванов И.И."
                  className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-nexus-border">
              <button onClick={() => setShowNewSession(false)} className="px-4 py-2 rounded-xl text-nexus-text3 text-sm">Отмена</button>
              <button onClick={createSession} disabled={busy}
                      className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-sm font-medium">
                <Save size={16} /> {busy ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
