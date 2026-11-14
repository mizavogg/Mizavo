/* Mizavo — service worker (Nov 14, 2026).
   Only two jobs: show the daily challenge reminder when one arrives, and open the right page when it's tapped.
   It does NOT cache or intercept any page loads (no "fetch" handler), so the site always loads fresh. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = {}; }
  const title = d.title || "Today's Mizavo challenge is live";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'Ten questions, the same for everyone.',
    icon: '/app-192.png',
    badge: '/favicon-48.png',
    tag: 'mizavo-daily',          // a new reminder replaces yesterday's instead of piling up
    data: { url: d.url || '/solo' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/solo', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url).catch(() => {}); }
    }
    return self.clients.openWindow(url);
  })());
});
