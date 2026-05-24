/**
 * Service Worker для Storra WMS.
 *
 * Стратегия:
 *  - Navigation (открытие страницы): NETWORK-FIRST, чтобы свежий index.html
 *    с актуальным JS-бандлом всегда прилетал с сервера. Это критично:
 *    иначе при обновлении версии SW отдаст старый кэш и приложение «зависнет на загрузке»,
 *    потому что старый JS попытается дотянуть несуществующие новые чанки.
 *  - Статика (JS/CSS/иконки): cache-first с фоновым обновлением.
 *  - /api/* и /ws*: всегда сеть (никакого кэша) — иначе сломается логин и realtime.
 *
 * При смене bundle меняйте CACHE_NAME — старый кэш будет автоматически снесён.
 */

const CACHE_NAME = 'storra-wms-v3';
const CORE_ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.svg', './icon-512.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS).catch(() => { /* offline first install — допустимо */ }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API и WebSocket — никогда не кэшируем.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return; // browser default
  }

  // Навигационные запросы — СНАЧАЛА сеть, fallback в кэш только при оффлайне.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(resp => {
          // Обновляем кэш свежим index, чтобы оффлайн получил актуальную версию.
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Прочие GET — сначала пробуем сеть (чтобы получать свежий JS-бандл),
  // при сетевой ошибке отдаём кэш.
  event.respondWith(
    fetch(req)
      .then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req))
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
