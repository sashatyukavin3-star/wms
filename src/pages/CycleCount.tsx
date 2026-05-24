import { ClipboardCheck, ListChecks, Plus, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { toast } from '../App';
import type { CycleCount, CycleCountLine } from '../db';
import { cycleCountApi, type CycleCountSuggestion } from '../lib/services';
import { subscribeType } from '../lib/ws';
import { formatDateTime } from '../utils';

export default function CycleCountPage() {
  const [suggestions, setSuggestions] = useState<CycleCountSuggestion[]>([]);
  const [tasks, setTasks] = useState<CycleCount[]>([]);
  const [selectedTask, setSelectedTask] = useState<CycleCount | null>(null);
  const [lines, setLines] = useState<CycleCountLine[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [taskName, setTaskName] = useState('Cycle Count Task');

  async function loadSuggestions() {
    try { setSuggestions(await cycleCountApi.suggestions(search || undefined)); }
    catch (e: any) { toast('error', `Не удалось загрузить кандидатов: ${e.message || e}`); }
  }
  async function loadTasks() {
    try { setTasks(await cycleCountApi.list()); }
    catch (e: any) { toast('error', `Не удалось загрузить cycle counts: ${e.message || e}`); }
  }
  async function openTask(task: CycleCount) {
    try {
      const detail = await cycleCountApi.get(task.id!);
      const { lines, ...doc } = detail;
      setSelectedTask(doc);
      setLines(lines);
    } catch (e: any) {
      toast('error', `Не удалось открыть task: ${e.message || e}`);
    }
  }

  useEffect(() => { loadSuggestions(); loadTasks(); }, []);
  useEffect(() => { const t = setTimeout(() => loadSuggestions(), 150); return () => clearTimeout(t); }, [search]);
  useEffect(() => subscribeType('cycle_count:changed', () => { loadTasks(); if (selectedTask?.id) openTask(selectedTask); }), [selectedTask?.id]);

  function keyFor(s: CycleCountSuggestion) { return `${s.barcode}@@${s.cell}`; }

  async function createTask() {
    const picks = suggestions.filter(s => selectedSuggestions.has(keyFor(s)));
    if (picks.length === 0) { toast('warning', 'Выбери хотя бы одного кандидата'); return; }
    setBusy(true);
    try {
      const task_number = `CC-${Date.now()}`;
      const { id } = await cycleCountApi.create({
        task_number,
        name: taskName.trim() || 'Cycle Count Task',
        lines: picks.map(s => ({ barcode: s.barcode, cell: s.cell, priority: s.priority, reason: s.reasons.join(', ') })),
      });
      toast('success', `Cycle count создан: ${task_number}`);
      setSelectedSuggestions(new Set());
      await loadTasks();
      const fresh = (await cycleCountApi.list()).find(t => t.id === id);
      if (fresh) await openTask(fresh);
    } catch (e: any) {
      toast('error', e.message || 'Не удалось создать cycle count');
    } finally {
      setBusy(false);
    }
  }

  async function saveCount(line: CycleCountLine, qty: number) {
    try {
      const res = await cycleCountApi.countLine(line.id!, { qty_counted: qty });
      toast(res.delta === 0 ? 'success' : 'warning', `Сохранено: counted ${qty}, delta ${res.delta > 0 ? '+' : ''}${res.delta}`);
      if (selectedTask) await openTask(selectedTask);
    } catch (e: any) {
      toast('error', e.message || 'Не удалось сохранить counted qty');
    }
  }

  async function applyAdjustments() {
    if (!selectedTask?.id) return;
    setBusy(true);
    try {
      const res = await cycleCountApi.apply(selectedTask.id);
      toast(res.failed ? 'warning' : 'success', `Применено ${res.applied}, ошибок ${res.failed}`);
      await openTask(selectedTask);
      await loadTasks();
    } catch (e: any) {
      toast('error', e.message || 'Не удалось применить корректировки');
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => suggestions.slice(0, 40), [suggestions]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-nexus-text font-bold text-xl flex items-center gap-2"><ListChecks size={22} className="text-cyan-300" /> Cycle Count / адресный пересчёт</h2>
            <p className="text-nexus-text3 text-sm mt-2 max-w-3xl">
              Система предлагает кандидатов для выборочного пересчёта: карантинные ячейки, picking-face, строки с предыдущими расхождениями и активные SKU.
            </p>
          </div>
          <button onClick={() => { loadSuggestions(); loadTasks(); }} className="flex items-center gap-2 border border-nexus-border text-nexus-text3 hover:text-nexus-text px-4 py-2 rounded-xl text-sm">
            <RefreshCw size={16} /> Обновить
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
        <div className="space-y-4">
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4 space-y-3">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Фильтр кандидатов: SKU, ячейка, зона..." className="w-full bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
            <div className="flex gap-2 flex-wrap items-center">
              <input value={taskName} onChange={e => setTaskName(e.target.value)} placeholder="Название задачи" className="flex-1 min-w-[220px] bg-nexus-surface2 border border-nexus-border rounded-xl px-3 py-2.5 text-nexus-text text-sm" />
              <button onClick={createTask} disabled={busy} className="flex items-center gap-2 bg-nexus-accent hover:bg-nexus-accent2 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60"><Plus size={16} /> Создать задачу</button>
            </div>
          </div>

          <div className="space-y-3">
            {grouped.map(item => {
              const key = keyFor(item);
              const checked = selectedSuggestions.has(key);
              return (
                <label key={key} className={`block bg-nexus-surface border rounded-2xl p-4 cursor-pointer ${checked ? 'border-nexus-accent/60' : 'border-nexus-border'}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={checked} onChange={e => setSelectedSuggestions(prev => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(key) : next.delete(key);
                      return next;
                    })} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="text-nexus-text font-medium">{item.name}</div>
                      <div className="text-nexus-accent2 text-xs font-mono">{item.barcode}</div>
                      <div className="text-nexus-text3 text-sm mt-1">{item.cell} {item.zone ? `· зона ${item.zone}` : ''} · system qty {item.qty_system}</div>
                      <div className="text-[11px] text-nexus-text3 mt-2">priority {item.priority} · {item.reasons.join(', ')}</div>
                    </div>
                  </div>
                </label>
              );
            })}
            {grouped.length === 0 && <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-8 text-center text-nexus-text3">Нет кандидатов для cycle count</div>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4 space-y-2">
            <h3 className="text-nexus-text font-bold flex items-center gap-2"><ClipboardCheck size={18} /> Задачи Cycle Count</h3>
            {tasks.map(task => (
              <button key={task.id} onClick={() => openTask(task)} className={`w-full text-left rounded-xl border p-3 ${selectedTask?.id === task.id ? 'border-nexus-accent/60' : 'border-nexus-border'} hover:border-nexus-accent/40`}>
                <div className="text-nexus-text font-medium">{task.task_number}</div>
                <div className="text-nexus-text3 text-xs">{task.name} · {task.status}</div>
              </button>
            ))}
            {tasks.length === 0 && <div className="text-nexus-text3 text-sm">Пока нет задач.</div>}
          </div>

          {selectedTask && (
            <div className="bg-nexus-surface border border-nexus-border rounded-2xl p-4 space-y-4">
              <div>
                <div className="text-nexus-text font-bold">{selectedTask.task_number}</div>
                <div className="text-nexus-text3 text-sm">{selectedTask.name} · {selectedTask.status}</div>
              </div>

              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {lines.map(line => (
                  <CycleLineCard key={line.id} line={line} onSave={saveCount} />
                ))}
                {lines.length === 0 && <div className="text-sm text-nexus-text3">Нет строк.</div>}
              </div>

              <div className="flex gap-2">
                <button onClick={applyAdjustments} disabled={busy} className="flex items-center gap-2 bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60">
                  <Save size={16} /> Применить корректировки
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CycleLineCard({ line, onSave }: { line: CycleCountLine; onSave: (line: CycleCountLine, qty: number) => void }) {
  const [qty, setQty] = useState<string>(line.status === 'pending' ? String(line.qty_system) : String(line.qty_counted));

  useEffect(() => {
    setQty(line.status === 'pending' ? String(line.qty_system) : String(line.qty_counted));
  }, [line.id, line.qty_system, line.qty_counted, line.status]);

  return (
    <div className="bg-nexus-surface2 border border-nexus-border rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-nexus-text font-medium">{line.barcode}</div>
          <div className="text-nexus-text3 text-xs font-mono">{line.cell}</div>
          <div className="text-[11px] text-nexus-text3 mt-1">priority {line.priority} · {line.reason || '—'}</div>
        </div>
        <div className="text-right text-xs text-nexus-text3">
          <div>system {line.qty_system}</div>
          <div>status {line.status}</div>
          <div className={line.delta === 0 ? 'text-nexus-text3' : line.delta > 0 ? 'text-green-400' : 'text-red-400'}>
            delta {line.delta > 0 ? '+' : ''}{line.delta}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <input type="number" value={qty} onChange={e => setQty(e.target.value)} className="flex-1 bg-nexus-surface border border-nexus-border rounded-lg px-3 py-2 text-nexus-text text-sm" />
        <button onClick={() => onSave(line, Number(qty) || 0)} className="bg-nexus-accent hover:bg-nexus-accent2 text-white px-3 py-2 rounded-lg text-sm">Сохранить</button>
      </div>
    </div>
  );
}
