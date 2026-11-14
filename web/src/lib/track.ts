/* Mizavo — the visitor counter (Nov 13, 2026).
   Every public page calls trackView() once when it opens (it runs from initNav).
   What gets sent: which page, which site sent them here (just the site name, e.g. "reddit.com"),
   phone/tablet/desktop, browser name, time zone, language, and a random anonymous ID.
   No cookies, no names, no IP addresses. The numbers show up on the admin page's Analytics tab.

   Not counted: admins (the server checks), any device the admin page has been opened on (mz_notrack),
   robots/automated browsers, and the OBS warm-up page (it never calls initNav). */
import { supabase } from './supabase';
import { store } from './dom';

const VISIT_IDLE_MS = 30 * 60 * 1000;   // a "visit" ends after 30 minutes with no new page
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|discord|telegram|whatsapp/i;

/** A random lowercase id like "k3j9x0q2m7a1b5c8d4" (letters + digits only, 20 characters). */
function newId(): string {
  const a = new Uint8Array(15);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-5);
}

/** Page name without ".html", so "/solo" and "/solo.html" count as the same page. */
function pageName(): string {
  let p = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  // streamer pages: keep which streamer, so you can see whose page people open
  const c = new URLSearchParams(location.search).get('c');
  if (p === '/channel' && c && /^[a-z0-9_]{1,30}$/i.test(c)) p += '/' + c.toLowerCase();
  return (p || '/').slice(0, 60);
}

/** The other site that linked here, just its name ("reddit.com"). Links inside Mizavo don't count. */
function referrerHost(): string {
  try {
    if (!document.referrer) return '';
    const h = new URL(document.referrer).hostname.replace(/^www\./, '').replace(/^(m|l|lm|out)\./, '');
    const here = location.hostname.replace(/^www\./, '');
    return h === here ? '' : h;
  } catch { return ''; }
}

function device(): 'phone' | 'tablet' | 'desktop' {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/Mobi|iPhone|Android.+Mobile/i.test(ua)) return 'phone';
  if (/Android/i.test(ua)) return 'tablet';
  return 'desktop';
}

function browser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/SamsungBrowser/.test(ua)) return 'Samsung';
  if (/Twitch/i.test(ua)) return 'Twitch app';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

let sent = false;

/** Count this page once. Never throws and never slows the page down. */
export function trackView(): void {
  if (sent) return; sent = true;
  try {
    if (store.get('mz_notrack') === '1') return;              // a device the admin uses
    if (navigator.webdriver || BOT.test(navigator.userAgent)) return;

    let visitor = store.get('mz_vid'), isNew = false;
    if (!visitor || !/^[a-z0-9]{12,32}$/.test(visitor)) { visitor = newId(); isNew = true; store.set('mz_vid', visitor); }

    // a visit = pages opened without a 30-minute gap
    const now = Date.now();
    const last = Number(store.get('mz_visit_at') || 0);
    let visit = store.get('mz_visit');
    if (!visit || !/^[a-z0-9]{12,32}$/.test(visit) || now - last > VISIT_IDLE_MS) visit = newId();
    store.set('mz_visit', visit); store.set('mz_visit_at', String(now));

    const q = new URLSearchParams(location.search);
    const source = (q.get('utm_source') || q.get('ref') || '').slice(0, 40);
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* old browser */ }

    // wait until the page has settled so the counter never competes with the page loading
    const send = () => {
      supabase.rpc('track_view', {
        p_visitor: visitor, p_visit: visit, p_path: pageName(), p_referrer: referrerHost(), p_source: source,
        p_device: device(), p_browser: browser(), p_tz: tz, p_lang: (navigator.language || '').slice(0, 12), p_new: isNew,
      }).then(() => { /* nothing to do */ }, () => { /* a missed count is fine */ });
    };
    if (document.readyState === 'complete') setTimeout(send, 400);
    else addEventListener('load', () => setTimeout(send, 400), { once: true });
  } catch { /* counting must never break a page */ }
}
