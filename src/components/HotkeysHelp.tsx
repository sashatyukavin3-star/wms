import { Keyboard, X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Модалка с подсказкой по горячим клавишам.
 * Открывается по нажатию `?` или `H` (в любом месте, кроме инпутов).
 */
export function HotkeysHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      // Не реагируем, если фокус в инпуте/textarea/select.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        // Кроме комбинаций с Ctrl/Meta
        if (!(e.ctrlKey || e.metaKey)) return;
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  const sections = [
    {
      title: 'Навигация',
      keys: [
        ['F1', 'Приёмка'],
        ['F2', 'Отгрузка'],
        ['F3', 'Перемещение'],
        ['F4', 'Инвентаризация'],
        ['F5', 'Заказы'],
        ['F6', 'Аналитика'],
        ['F7', 'Акты'],
        ['F8', 'Стикеры'],
        ['F9', 'Настройки'],
        ['F11', 'Дашборд'],
      ],
    },
    {
      title: 'Общие',
      keys: [
        ['?', 'Эта подсказка'],
        ['Esc', 'Закрыть диалог / убрать фокус'],
        ['Ctrl + K', 'Быстрый поиск (товар / ячейка / заказ)'],
        ['Ctrl + B', 'Свернуть / развернуть боковое меню'],
      ],
    },
    {
      title: 'В формах',
      keys: [
        ['Enter', 'Подтвердить / применить подсказку'],
        ['↑ / ↓', 'Перемещение по подсказкам'],
        ['Tab', 'Следующее поле'],
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-nexus-surface border border-nexus-border rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-nexus-border">
          <div className="flex items-center gap-2 text-nexus-text font-bold">
            <Keyboard size={20} className="text-nexus-accent" />
            Горячие клавиши
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-nexus-text3 hover:text-nexus-text"
            title="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 grid gap-6 md:grid-cols-2">
          {sections.map(section => (
            <div key={section.title}>
              <h3 className="text-nexus-text font-semibold text-sm mb-3 uppercase tracking-wide">
                {section.title}
              </h3>
              <div className="space-y-1.5">
                {section.keys.map(([k, label]) => (
                  <div key={k} className="flex items-center justify-between text-sm">
                    <span className="text-nexus-text2">{label}</span>
                    <kbd className="px-2 py-0.5 rounded bg-nexus-surface2 border border-nexus-border text-nexus-text font-mono text-xs">
                      {k}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-nexus-border px-6 py-3 text-xs text-nexus-text3">
          Нажмите <kbd className="px-1.5 py-0.5 rounded bg-nexus-surface2 border border-nexus-border font-mono">?</kbd> в любой момент, чтобы открыть эту подсказку.
        </div>
      </div>
    </div>
  );
}
