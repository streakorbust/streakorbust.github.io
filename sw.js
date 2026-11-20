// Offline support: try the network first (so updates arrive automatically),
// fall back to the cached copy when offline or slow.
const VERSION = 'streakorbust-v73';
const FILES = ['./', 'index.html', 'styles.css', 'engine.js', 'app.js', 'net.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const path = new URL(e.request.url).pathname;
  if (path === '/turn' || path.startsWith('/push/')) return; // live server answers: never cache
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    if (!cached) return net;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 2500));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});

// Lock-screen alert: a friend is trying to join this phone's room. The push itself carries no
// text, so ask the server what to say (falling back to a plain message), then always show it.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let msg = null;
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch('/push/msg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub && sub.endpoint }) });
      msg = (await r.json()).msg;
    } catch (err) { /* use the plain message */ }
    msg = msg || { title: 'A friend wants to play!', body: 'Someone is trying to join your Streak or Bust room. Tap to open the game.' };
    await self.registration.showNotification(msg.title, { body: msg.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'join', renotify: true });
  })());
});

// Tapping the alert brings the game back (and reopens the room if the page had been closed).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) { await open.focus(); return; }
    await self.clients.openWindow('/?reopen');
  })());
});
