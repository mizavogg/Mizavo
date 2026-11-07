/* Mizavo — the navigation bar shared by every public page.
   Fills <nav class="siteNav" data-page="..."> with: Play · Daily challenge · Leaderboards · Guide (· My page).
   "My page" appears when logged in and we know the channel's login (saved by the game/solo pages). */
import { el, store } from './dom';
import { supabase } from './supabase';
import { channelUrl } from './boards';

/** Mizavo's Ko-fi page. Empty = every support link stays hidden. Paste the full link here to turn them on. */
export const SUPPORT_URL = 'https://ko-fi.com/mizavo';

const LINKS: [key: string, text: string, href: string][] = [
  ['play', 'Play', '/'],
  ['solo', 'Daily challenge', '/solo.html'],
  ['boards', 'Leaderboards', '/today.html'],
  ['guide', 'Guide', '/guide.html'],
];

/** Remember the logged-in channel's Twitch login so every page can link to "My page". */
export function rememberLogin(login: string | null): void {
  if (login) store.set('mz_login', login); else store.remove('mz_login');
  render();
}

function render(): void {
  const nav = document.querySelector<HTMLElement>('nav.siteNav');
  if (!nav) return;
  const page = nav.dataset.page || '';
  const here = new URLSearchParams(location.search).get('c');
  nav.replaceChildren();
  const add = (key: string, text: string, href: string) => {
    const a = el('a', key === page ? 'on' : null, text); a.href = href;
    if (key === page) a.setAttribute('aria-current', 'page');
    nav.append(a);
  };
  for (const [k, t, h] of LINKS) add(k, t, h);
  const login = store.get('mz_login');
  if (login && loggedIn) add(page === 'channel' && here === login ? 'channel' : 'mine', 'My page', channelUrl(login));
  if (SUPPORT_URL) {
    const a = el('a', 'support', '♥ Support'); a.href = SUPPORT_URL; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.title = 'Help cover the servers (optional tip on Ko-fi)';
    nav.append(a);
  }
}

/** Footer links and the guide section: shown only once SUPPORT_URL is set. */
function wireSupport(): void {
  document.querySelectorAll<HTMLAnchorElement>('a.supportLink').forEach((a) => { if (SUPPORT_URL) a.href = SUPPORT_URL; });
  document.querySelectorAll<HTMLElement>('.supportWrap, #support').forEach((n) => n.classList.toggle('hidden', !SUPPORT_URL));
}

let loggedIn = false;
export function initNav(): void {
  render(); wireSupport();
  supabase.auth.getSession().then(({ data }) => { loggedIn = !!data.session; if (!loggedIn) store.remove('mz_login'); render(); });
  supabase.auth.onAuthStateChange((_e, s) => { const was = loggedIn; loggedIn = !!s; if (was !== loggedIn) render(); });
}
