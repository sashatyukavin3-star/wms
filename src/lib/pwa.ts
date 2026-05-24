/**
 * Регистрация Service Worker для PWA.
 * Безопасна для dev-режима: при ошибках/недоступности — просто ничего не делает.
 */

export function registerSW() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Регистрируем после загрузки страницы, чтобы не мешать первоначальной отрисовке.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // dev / file:// — silent
    });
  });
}

/** Подписаться на изменения online/offline. Возвращает функцию отписки. */
export function watchOnline(cb: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb(navigator.onLine);
  handler();
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
  };
}
