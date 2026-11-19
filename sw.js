// The game moved to https://streakorbust.pages.dev/. Phones that installed the old address still
// have the old offline copy; this replacement clears it and steps aside so they reach the new site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
