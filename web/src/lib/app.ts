/* Mizavo — phone app feel, loaded on every page that has the nav bar (and the admin page).
   1. Press effects on iPhone: Safari only shows :active (the "pressed" look) on pages that listen for touches,
      so we add one empty touch listener.
   2. Offline bar: if the connection drops, a small bar says so; when it's back, "Back online" shows briefly.
      Twitch chat already reconnects on its own (game/chat.ts); this covers the rest of the site.
      We don't auto-resend failed requests: some (like finishing a game or sending a report) shouldn't run twice. */
let started = false;

export function initApp(): void {
  if (started) return;
  started = true;
  document.addEventListener('touchstart', () => {}, { passive: true });
  // the service worker only shows daily challenge reminders; it never caches pages (public/sw.js)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  const bar = document.createElement('div');
  bar.className = 'netBar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  document.body.append(bar);
  let hideTimer = 0;
  const set = (online: boolean, first = false) => {
    clearTimeout(hideTimer);
    if (!online) {
      bar.textContent = "You're offline";
      bar.className = 'netBar off show';
    } else if (!first) {
      bar.textContent = 'Back online';
      bar.className = 'netBar on show';
      hideTimer = window.setTimeout(() => bar.classList.remove('show'), 2200);
    }
  };
  if (!navigator.onLine) set(false, true);
  window.addEventListener('offline', () => set(false));
  window.addEventListener('online', () => set(true));
}
