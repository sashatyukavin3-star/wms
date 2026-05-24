import { AlertCircle,Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getApiBase, pingServer, resetApiBase } from '../lib/api';
import { getWSDiagnostics,restartWS, subscribeConnection } from '../lib/ws';

type Status = 'unknown' | 'connecting' | 'online' | 'offline';

/**
 * Бейдж статуса подключения к серверу.
 * Показывает зелёный если WS подключён, красный — если нет.
 * По клику открывается панель с диагностикой и кнопкой «Переподключиться».
 */
export function ConnectionBadge() {
  const [status, setStatus] = useState<Status>('unknown');
  const [clients, setClients] = useState<number | null>(null);
  const [pingOk, setPingOk] = useState<boolean | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState(getWSDiagnostics());

  useEffect(() => {
    const off = subscribeConnection(c => setStatus(c ? 'online' : 'offline'));
    return off;
  }, []);

  // Раз в 30 сек дёргаем /api/health — независимо от WS, чтобы понять,
  // в HTTP вообще или только в WebSocket проблема.
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const h = await pingServer();
        if (!alive) return;
        setPingOk(!!h?.ok);
        setPingError(null);
        if (h?.ok) setClients(h.clients);
      } catch (e: any) {
        if (!alive) return;
        setPingOk(false);
        setPingError(e?.message || 'Не удалось пингануть сервер');
      }
    }
    tick();
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Когда панель открыта — каждую секунду обновляем диагностику.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setDiag(getWSDiagnostics()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const meta = {
    unknown:    { color: 'bg-nexus-text3', label: '—',         desc: 'Статус неизвестен' },
    connecting: { color: 'bg-amber-400',   label: 'Подключение', desc: 'Подключаемся к серверу' },
    online:     { color: 'bg-emerald-400 animate-pulse', label: 'Онлайн', desc: 'Подключено к серверу' },
    offline:    { color: 'bg-red-500',     label: 'Офлайн',     desc: 'Нет связи с сервером' },
  }[status];

  const handleReconnect = () => {
    restartWS();
    setDiag(getWSDiagnostics());
  };

  const handleReset = () => {
    if (!confirm('Сбросить сохранённый адрес сервера и перезагрузить страницу?\n(нужно, если приложение пытается подключиться к неправильному адресу)')) return;
    resetApiBase();
    location.reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-nexus-surface2 text-xs"
        title={meta.desc}
      >
        <span className={`w-2 h-2 rounded-full ${meta.color}`} />
        {status === 'online'
          ? <Wifi size={13} className="text-emerald-400" />
          : status === 'connecting'
            ? <Loader2 size={13} className="text-amber-400 animate-spin" />
            : <WifiOff size={13} className="text-red-400" />}
      </button>

      {open && (
        <div
          className="absolute right-0 top-9 z-50 w-96 bg-nexus-surface border border-nexus-border rounded-xl shadow-2xl p-4 text-sm"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-nexus-text">Диагностика подключения</div>
            <span className={`w-2 h-2 rounded-full ${meta.color}`} />
          </div>

          <div className="space-y-2 text-xs">
            <Row label="Сервер" value={<span className="font-mono text-nexus-text">{getApiBase()}</span>} />
            <Row label="Открыто как" value={<span className="font-mono text-nexus-text2">{typeof window !== 'undefined' ? window.location.origin : '—'}</span>} />
            <Row
              label="HTTP /api/health"
              value={
                pingOk === null
                  ? <span className="text-amber-400">проверяю...</span>
                  : pingOk
                    ? <span className="text-emerald-400">✓ работает</span>
                    : <span className="text-red-400" title={pingError || ''}>✕ не отвечает</span>
              }
            />
            <Row
              label="WebSocket"
              value={
                <span className={status === 'online' ? 'text-emerald-400' : status === 'offline' ? 'text-red-400' : 'text-amber-400'}>
                  {status === 'online' ? '✓ онлайн' : status === 'offline' ? '✕ не подключён' : meta.label}
                </span>
              }
            />
            {diag.url && <Row label="WS URL" value={<span className="font-mono text-nexus-text2 truncate text-[10px]">{diag.url}</span>} />}
            <Row label="Попыток" value={<span className="text-nexus-text">{diag.attempts}</span>} />
            {clients !== null && <Row label="Клиентов подключено" value={<span className="text-nexus-text">{clients}</span>} />}
            {diag.lastError && (
              <div className="mt-2 px-2 py-1.5 rounded bg-red-900/30 border border-red-800/40 text-red-300 text-[11px] flex items-start gap-1.5">
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{diag.lastError}</span>
              </div>
            )}
          </div>

          {/* Подсказки исходя из текущего состояния */}
          {pingOk === false && (
            <div className="mt-3 px-2.5 py-2 rounded bg-amber-900/20 border border-amber-800/40 text-amber-200 text-[11px] leading-relaxed">
              <b>HTTP не отвечает.</b> Сервер выключен или firewall блокирует порт 3000. На ПК-сервере запустите:
              <code className="block mt-1 px-2 py-1 bg-black/40 rounded font-mono text-[10px]">
                netsh advfirewall firewall add rule name="Storra WMS" dir=in action=allow protocol=TCP localport=3000
              </code>
            </div>
          )}
          {pingOk === true && status === 'offline' && (
            <div className="mt-3 px-2.5 py-2 rounded bg-amber-900/20 border border-amber-800/40 text-amber-200 text-[11px] leading-relaxed">
              <b>HTTP работает, а WebSocket — нет.</b> Возможные причины:
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                <li>Прокси / антивирус режет ws:// соединения.</li>
                <li>Сохранён неправильный адрес сервера (см. кнопку «Сбросить»).</li>
                <li>Сервер старой версии — пересоберите фронт на сервере.</li>
              </ul>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleReconnect}
              className="flex items-center justify-center gap-1.5 flex-1 bg-nexus-accent hover:bg-nexus-accent2 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              <RefreshCw size={12} /> Переподключить
            </button>
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-1.5 bg-nexus-surface2 hover:bg-nexus-surface3 border border-nexus-border text-nexus-text2 px-3 py-1.5 rounded-lg text-xs"
              title="Если приложение подключается к localhost вместо реального IP — нажмите"
            >
              Сбросить адрес
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-nexus-text3">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
