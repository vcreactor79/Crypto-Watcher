// SUI 감시기 서비스워커 — 설치 가능화 + 셸 캐시. 라이브 시세는 항상 네트워크.
const CACHE = 'sui-watcher-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // 실시간 데이터(바이낸스/텔레그램)는 캐시하지 않고 브라우저 기본 처리
  if (url.includes('api.binance.com') || url.includes('api.telegram.org')) return;
  // 나머지(HTML/폰트 등): 네트워크 우선, 실패 시 캐시 → 오프라인에서도 화면은 열림
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
