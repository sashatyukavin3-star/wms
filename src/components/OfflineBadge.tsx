import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { watchOnline } from '../lib/pwa';

/** Небольшой бейдж, появляющийся когда пропала сеть. */
export function OfflineBadge() {
  const [online, setOnline] = useState(true);

  useEffect(() => watchOnline(setOnline), []);

  if (online) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[9000] flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-900/90 border border-amber-700 text-amber-100 text-sm font-medium shadow-2xl animate-fadeIn">
      <WifiOff size={16} />
      Офлайн — работаем локально (IndexedDB)
    </div>
  );
}
