/* Service worker: يجعل التطبيق قابلًا للتثبيت ويعمل عند ضعف الاتصال.
   الاستراتيجية: الشبكة أولًا (حتى تظهر تحديثات الملازم والتدريبات فورًا)،
   وإن تعذر الاتصال نعرض آخر نسخة محفوظة. */

const CACHE = 'abgad-v6';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/quiz-engine.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const stripSearch = (url) => {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.toString();
};

function fetchWithTimeout(req, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(req, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const key = new Request(stripSearch(req.url));
  try {
    const res = await fetchWithTimeout(req, 6000);
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match(key);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const index = await cache.match('index.html');
      if (index) return index;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || refresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (isFont) {
    event.respondWith(staleWhileRevalidate(req));
  } else if (sameOrigin) {
    event.respondWith(networkFirst(req));
  }
});
