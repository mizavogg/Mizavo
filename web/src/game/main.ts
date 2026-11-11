/* Mizavo — the game page: login, settings, buttons and keys. Everything starts here. */
import { $, show, store } from '../lib/dom';
import { supabase, loginWithTwitch } from '../lib/supabase';
import { S, type Mode } from './state';
import { api, friendly, type Channel } from './api';
import { startLoop, binAt } from './arena';
import { disconnectTwitch } from './chat';
import { startLaunch, stopLaunch } from './launch';
import { startHome } from './homeround';
import { initPageMotion } from './page-motion';
import { initStreamerMode } from './streamer-mode';
import { openReport } from './report';
import { initPublicSwitch } from './community';
import { initNav, rememberLogin } from '../lib/nav';
import {
  confirmBox, endUnfinished, goHome, next, pick, quitGame, resumeGame, revealNow,
  setMode, setPhase, setupError, show3, startGame, summary,
} from './flow';
import { setTopicPick } from './topics';
import { initSound } from '../lib/sound';
import { picturesOn, setPictures } from './avatars';

/* ---------- invite links: ?invite=CODE ----------
   The code is kept in the browser while the visitor goes through Twitch login
   (Twitch sends them back without it), then used once they're logged in. */
const INVITE_KEY = 'mz_invite';
{
  const url = new URL(window.location.href);
  const code = (url.searchParams.get('invite') || '').trim().toUpperCase();
  if (/^[A-Z0-9]{4,20}$/.test(code)) store.set(INVITE_KEY, code);
  if (url.searchParams.has('invite')) {           // tidy the address bar (and keep the code out of stream captures)
    url.searchParams.delete('invite');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}
const INVITE_PROBLEM: Record<string, string> = {
  inactive: "The invite link you used isn't active anymore. Ask the person who sent it for a new one.",
  full: 'The invite link you used is full. Ask the person who sent it for a new one.',
};
/** Use a saved invite code, if any. Returns a problem message, or null. */
async function useInviteCode(): Promise<string | null> {
  const code = store.get(INVITE_KEY);
  if (!code) return null;
  try {
    const r = await api.redeemInvite(code);
    store.remove(INVITE_KEY);                       // one try per link visit
    return INVITE_PROBLEM[r.status] ?? null;
  } catch { return null; }                          // keep the code; it gets another try on "Check again"
}

/* ---------- logged out: preview + login ---------- */
function enterGate(msg?: string, closedFor?: string, inviteProblem?: string | null): void {
  disconnectTwitch();
  S.session = null;
  document.body.classList.toggle('closedTest', closedFor != null);
  show($('#closedBox'), closedFor != null);
  if (closedFor != null) $('#closedWho').textContent = closedFor ? 'twitch.tv/' + closedFor : 'This channel';
  $('#closedLink').textContent = inviteProblem || '';
  show($('#closedLink'), !!inviteProblem);
  $('#gateIntro').textContent = store.get(INVITE_KEY)
    ? "You've been invited to the Mizavo closed test. Log in with Twitch to join and play against your chat."
    : 'A quick trivia game for your stream. You answer on screen, your viewers answer in chat, and whoever gets more right wins.';
  setPhase('gate'); show3('game');
  show($('#who'), closedFor != null); show($('#scoreboard'), false);
  $('#edition').textContent = 'Streamer vs chat';
  $('#gateMsg').textContent = msg || '';
  show($('#gateMsg'), !!msg);
  startLaunch();
}

/* ---------- logged in: channel + settings ---------- */
function applySettings(ch: Channel): void {
  const st = ch.settings || {};
  if (st.mode) selectMode(st.mode);
  if (st.rounds) $<HTMLSelectElement>('#rounds').value = String(st.rounds);
  if (st.seconds) $<HTMLSelectElement>('#secs').value = String(st.seconds);
  if (typeof st.blind === 'boolean') $<HTMLInputElement>('#blind').checked = st.blind;
  if (typeof st.double === 'boolean') $<HTMLInputElement>('#double').checked = st.double;
  if (typeof st.lightning === 'boolean') $<HTMLInputElement>('#lightning').checked = st.lightning;
  setTopicPick(st.categories);
  const saved = store.get('hm_channel');
  $<HTMLInputElement>('#channel').value = saved != null && saved !== '' ? saved : ch.login;
  showChat();
  // simulated chat is a testing tool: only admins see it
  show($('#adminOpts'), !!ch.is_admin);
  if (!ch.is_admin) $<HTMLInputElement>('#demo').checked = false;
  updateOptSum();
}

/* ---------- the chat line: "Playing with yourname's chat · Change" ---------- */
function showChat(editing = false): void {
  const v = $<HTMLInputElement>('#channel').value.trim().replace(/^#/, '');
  $('#chatName').textContent = v ? v + "'s chat" : 'no chat yet';
  const edit = editing || !v;
  show($('#chatField'), edit); show($('#chatRow'), !edit);
}
$('#chatEdit').onclick = () => { showChat(true); $<HTMLInputElement>('#channel').focus(); };
$<HTMLInputElement>('#channel').addEventListener('blur', () => showChat(false));

/* ---------- "More options" summary: which game rules are on, so nothing is hidden by surprise ---------- */
function updateOptSum(): void {
  const on = [['#blind', 'Blind'], ['#double', 'Double final'], ['#lightning', 'Lightning']]
    .filter(([id]) => $<HTMLInputElement>(id).checked).map(([, t]) => t);
  if ($<HTMLInputElement>('#streamer').checked) on.push('Streamer mode');
  if ($<HTMLInputElement>('#demo').checked) on.push('Simulated chat');
  $('#optSum').textContent = on.length ? on.join(' · ') : '';
}
['#blind', '#double', '#lightning', '#streamer', '#demo'].forEach((id) => $(id).addEventListener('change', updateOptSum));
async function enterSetup(name: string): Promise<void> {
  stopLaunch();
  $('#whoName').textContent = name; show($('#who'), true);
  try {
    const ch = await api.ensureChannel();
    $('#whoName').textContent = ch.display_name;
    rememberLogin(ch.login);
    const inviteProblem = await useInviteCode();
    const access = await api.access();
    if (!access.can_play) return enterGate(undefined, access.login ?? ch.login, inviteProblem);   // closed test, not invited yet
    applySettings(ch);
  } catch (e) {
    return enterGate(friendly(e));
  }
  document.body.classList.remove('closedTest');
  goHome();
}

let authRun = 0;
supabase.auth.onAuthStateChange((event, session) => {
  if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
  const run = ++authRun;
  setTimeout(() => {           // run outside the auth callback, as Supabase recommends
    if (run !== authRun) return;
    if (!session) return enterGate();
    if (event === 'SIGNED_IN' && S.phase !== 'gate') return;   // token refreshes mid-game: ignore
    const meta = session.user.user_metadata || {};
    enterSetup(meta.nickname || meta.name || meta.preferred_username || 'Streamer');
  }, 0);
});

/* ---------- buttons ---------- */
function selectMode(m: Mode): void {
  document.querySelectorAll<HTMLElement>('.mode').forEach((x) => x.classList.toggle('sel', x.dataset.mode === m));
  setMode(m);
}
document.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.onclick = () => selectMode(b.dataset.mode as Mode));

$('#loginBtn').onclick = async () => {
  try { await loginWithTwitch(); } catch (e) { $('#gateMsg').textContent = 'Login failed: ' + (e as Error).message; show($('#gateMsg'), true); }
};
$('#logoutBtn').onclick = async () => {
  if (S.session && !(await confirmBox('Log out?', 'Your game in progress will be waiting when you log back in.', 'Log out'))) return;
  await supabase.auth.signOut();
};
$('#channel').onchange = () => { store.set('hm_channel', $<HTMLInputElement>('#channel').value.trim().replace(/^#/, '').toLowerCase()); showChat(false); };
$('#startBtn').onclick = startGame;
$('#resumeBtn').onclick = resumeGame;
$('#endOldBtn').onclick = endUnfinished;
$('#quitBtn').onclick = quitGame;
$('#revealBtn').onclick = revealNow;
$('#nextBtn').onclick = next;
$('#reportBtn').onclick = openReport;
$('#closedRetry').onclick = async () => {
  const b = $<HTMLButtonElement>('#closedRetry'); b.disabled = true; b.textContent = 'Checking…';
  try { await enterSetup($('#whoName').textContent || 'Streamer'); }
  finally { b.disabled = false; b.textContent = document.body.classList.contains('closedTest') ? 'Not yet. Check again' : 'Check again'; }
};
$('#againBtn').onclick = () => { goHome(); setupError(null); startGame(); };
$('#homeBtn').onclick = goHome;
$('#copyBtn').onclick = async () => {
  const t = summary();
  try { await navigator.clipboard.writeText(t); $('#copyBtn').textContent = 'Copied!'; setTimeout(() => $('#copyBtn').textContent = 'Copy results', 1500); }
  catch { const box = $<HTMLTextAreaElement>('#copyBox'); box.value = t; show(box, true); box.select(); }
};
$('#cv').addEventListener('click', (e) => {
  if (S.phase !== 'vote' || !S.R) return;
  const r = $('#cv').getBoundingClientRect(), me = e as MouseEvent;
  const i = binAt(me.clientX - r.left, me.clientY - r.top);   // works for a row of bins and for phone cards
  if (i >= 0 && i < S.R.opts.length) pick(i);
});

/* ---------- keys: number keys / arrows / A–D to pick, Enter to reveal or continue ---------- */
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const tag = (e.target as HTMLElement).tagName;
  if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && e.key !== 'Enter') return;
  const k = e.key.toLowerCase();
  if (S.phase === 'setup' && k === 'enter') { e.preventDefault(); startGame(); return; }
  if (S.phase === 'vote' && S.R) {
    if (S.R.type === 'ff') { if (k === '1' || k === 'arrowleft') pick(0); else if (k === '2' || k === 'arrowright') pick(1); }
    else { const m = 'abcd'.indexOf(k); if (m >= 0) pick(m); else if ('1234'.includes(k) && k.length === 1) pick(+k - 1); }
    if (k === 'enter') { e.preventDefault(); revealNow(); }
    return;
  }
  if (S.phase === 'reveal' && k === 'enter') { e.preventDefault(); next(); return; }
  if (S.phase === 'final' && k === 'enter') { e.preventDefault(); goHome(); startGame(); }
});

initSound();
$<HTMLInputElement>('#pics').checked = picturesOn();
$<HTMLInputElement>('#pics').onchange = (e) => setPictures((e.target as HTMLInputElement).checked);
initStreamerMode();
initPublicSwitch();
initNav();
// keep More options open if something in it is switched on
if ($<HTMLInputElement>('#streamer').checked) $<HTMLDetailsElement>('#moreOpts').open = true;
updateOptSum();

/* the Mizavo name always goes home: the setup screen when logged in (asks first mid-game), else the top */
$('#logoLink').onclick = async (e) => {
  e.preventDefault();
  if (S.phase === 'gate') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (S.phase === 'setup') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (S.phase !== 'final' && S.session) {
    const ok = await confirmBox('Leave this game?', "It's saved: you can resume it from the setup screen.", 'Leave');
    if (!ok) return;
  }
  goHome();
};
startLoop();
initPageMotion();
startHome();   // homepage round card + glass panels (they only animate while on screen)
