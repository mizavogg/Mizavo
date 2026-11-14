/* Mizavo — the navigation bar shared by every public page.
   Fills <nav class="siteNav" data-page="..."> with: Play · Daily challenge · Leaderboards · Guide (· My page).
   "My page" appears when logged in and we know the channel's login (saved by the game/solo pages). */
import { el, store } from './dom';
import { supabase, loginWithTwitch } from './supabase';
import { channelUrl } from './boards';
import { trackView } from './track';
import { initApp } from './app';

/** Mizavo's Ko-fi page. Empty = every support link stays hidden. Paste the full link here to turn them on. */
export const SUPPORT_URL = 'https://ko-fi.com/mizavo';

const LINKS: [key: string, text: string, href: string][] = [
  ['play', 'Play', '/'],
  ['solo', 'Daily challenge', '/solo'],
  ['boards', 'Leaderboards', '/today'],
  ['guide', 'Guide', '/guide'],
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
  // admins only: a shortcut to the admin page (the admin page still checks admin rights on the server)
  if (loggedIn && store.get('mz_admin') === '1') add('admin', 'Admin', '/admin');
  // logged out: a login button right in the bar, so it's never hidden under a webcam overlay
  // (not on the family login page, which has its own username + password form)
  if (known && !loggedIn && page !== 'family') {
    const b = el('button', 'navLogin'); b.type = 'button';
    b.innerHTML = TWITCH_ICON; b.append('Log in');
    b.title = 'Log in with Twitch';
    b.onclick = async () => { try { await loginWithTwitch(); } catch { b.textContent = 'Login failed. Try again'; } };
    nav.append(b);
  }
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

const TWITCH_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3v15h5v3l3-3h4l5-5V3z"/><line x1="11" y1="8" x2="11" y2="12"/><line x1="16" y1="8" x2="16" y2="12"/></svg>';

let loggedIn = false, known = false;   // known: the login check has finished (avoids the button flashing)
/** Secret door to the family login page (Nov 13): tap "mizavo" in the footer twice quickly.
    One tap still does what it always did (the link goes home), after a short wait to see if a second tap comes.
    Navigation goes through a hidden link, so the page transition still plays. */
function wireFamilyDoor(): void {
  const word = document.querySelector<HTMLElement>('footer.foot > a:first-child, footer.foot > span:first-child');
  if (!word) return;
  word.classList.add('famDoor');
  const go = (href: string) => {
    const a = document.createElement('a'); a.href = href; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
  };
  let taps = 0, timer = 0;
  word.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // new tab etc.: leave it alone
    e.preventDefault();
    e.stopPropagation();   // this click isn't a page change yet
    clearTimeout(timer);
    if (++taps >= 2) { taps = 0; go('/family'); return; }
    timer = window.setTimeout(() => {
      taps = 0;
      const home = word.getAttribute('href');
      if (home) go(home);   // one tap: the normal link (a plain-text "mizavo" does nothing)
    }, 350);
  });
}

export function initNav(): void {
  initApp(); render(); wireSupport(); wireFamilyDoor(); trackView();
  supabase.auth.getSession().then(({ data }) => {
    loggedIn = !!data.session; known = true;
    if (!loggedIn) { store.remove('mz_login'); store.remove('mz_admin'); }
    render(); if (loggedIn) checkAdmin();
  });
  supabase.auth.onAuthStateChange((_e, s) => {
    const was = loggedIn; loggedIn = !!s;
    if (!loggedIn) store.remove('mz_admin');
    if (was !== loggedIn) { render(); if (loggedIn) checkAdmin(); }
  });
}

/** Ask the server whether this account is an admin; remember it so the Admin link shows right away next time. */
async function checkAdmin(): Promise<void> {
  const { data, error } = await supabase.rpc('my_access');
  if (error) return;
  const admin = !!(data as { is_admin?: boolean } | null)?.is_admin;
  if (admin !== (store.get('mz_admin') === '1')) {
    if (admin) store.set('mz_admin', '1'); else store.remove('mz_admin');
    render();
  }
}
