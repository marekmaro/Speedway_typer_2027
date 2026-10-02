/* ------------------------------------------------------------------
   Service Worker Żużlowego Typera (PWA).
   - strony i dane: najpierw sieć, bez sieci ostatnia zapisana wersja (offline),
   - CSS/JS/ikony: z pamięci, w tle odświeżane (szybki start apki),
   - panel admina i zapisy (POST) NIGDY nie idą przez cache,
   - powiadomienia push: przypomnienia o typach, wyniki, alerty admina.
   Wersję (VERSION i ?v= w adresach) wstawia serwer automatycznie przy każdym deployu.
------------------------------------------------------------------- */
// __V__ podmienia serwer na skrót plików CSS/JS - każdy deploy = nowa wersja = świeży cache
const VERSION = 'typer-__V__';
const SHELL = [
    '/', '/typuj.html', '/gracz.html',
    '/css/app.css?v=__V__', '/js/shared.js?v=__V__', '/js/main.js?v=__V__', '/js/typuj.js?v=__V__', '/js/gracz.js?v=__V__',
    '/icons/icon-192.png', '/icons/badge-72.png', '/icons/icon.svg'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

async function networkFirst(request, cacheKey) {
    const cache = await caches.open(VERSION);
    try {
        const res = await fetch(request);
        if (res.ok) cache.put(cacheKey || request, res.clone());
        return res;
    } catch (err) {
        const hit = await cache.match(cacheKey || request, { ignoreSearch: !cacheKey });
        if (hit) return hit;
        throw err;
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(request);
    const refresh = fetch(request).then(res => {
        if (res.ok) cache.put(request, res.clone());
        return res;
    }).catch(() => hit);
    return hit || refresh;
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;              // logo drużyn itp. - przeglądarka sama
    if (url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/admin')) return;
    if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;

    if (url.pathname.startsWith('/api/public/')) {
        // Dane z tokenem gracza trzymamy pod pełnym adresem, żeby offline pokazać właściwy panel
        event.respondWith(networkFirst(req, req.url));
        return;
    }
    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req, url.pathname === '/' ? '/' : url.pathname));
        return;
    }
    if (/\.(css|js|png|svg|woff2?)$/.test(url.pathname)) {
        event.respondWith(staleWhileRevalidate(req));
    }
});

/* ---------------- powiadomienia ---------------- */

self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Żużlowy Typer', body: event.data && event.data.text() }; }
    const title = data.title || 'Żużlowy Typer';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: data.url || '/' },
        vibrate: [80, 40, 80]
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin).href;
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const same = all.find(c => c.url === target) || all.find(c => new URL(c.url).pathname === new URL(target).pathname);
        if (same) { await same.focus(); if (same.url !== target && 'navigate' in same) return same.navigate(target); return; }
        return self.clients.openWindow(target);
    })());
});
