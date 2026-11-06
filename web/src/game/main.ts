/* Mizavo — the game page: login, settings, buttons and keys. Everything starts here. */
import { $, show, store } from '../lib/dom';
import { supabase, loginWithTwitch } from '../lib/supabase';
import { S, type Mode } from './state';
import { api, friendly, type Channel } from './api';
import { startLoop } from './arena';
import { disconnectTwitch } from './chat';
import { startAttract, stopAttract } from './attract';
import { initStreamerMode } from './streamer-mode';
import {
  confirmBox, endUnfinished, goHome, next, pick, quitGame, resumeGame, revealNow,
  setMode, setPhase, setupError, show3, startGame, summary,
} from './flow';

/* ---------- logged out: preview + login ---------- */
function enterGate(msg?: string): void {
  disconnectTwitch();
  S.session = null;
  setPhase('gate'); show3('game');
  show($('#who'), false); show($('#scoreboard'), false);
  $('#edition').textContent = 'Night edition · streamer vs chat';
  $('#prompt').textContent = 'STREAMER VS CHAT';
  $('#statement').textContent = 'Fact or Fake? Your chat decides, live.';
  $('#gateMsg').textContent = msg || '';
  show($('#gateMsg'), !!msg);
  startAttract();
}

/* ---------- logged in: channel + settings ---------- */
function applySettings(ch: Channel): void {
  const st = ch.settings || {};
  if (st.mode) selectMode(st.mode);
  if (st.rounds) $<HTMLSelectElement>('#rounds').value = String(st.rounds);
  if (st.seconds) $<HTMLSelectElement>('#secs').value = String(st.seconds);
  if (typeof st.blind === 'boolean') $<HTMLInputElement>('#blind').checked = st.blind;
  const saved = store.get('hm_channel');
  $<HTMLInputElement>('#channel').value = saved != null && saved !== '' ? saved : ch.login;
}
async function enterSetup(name: string): Promise<void> {
  stopAttract();
  $('#whoName').textContent = name; show($('#who'), true);
  try {
    const ch = await api.ensureChannel();
    $('#whoName').textContent = ch.display_name;
    applySettings(ch);
  } catch (e) {
    return enterGate(friendly(e));
  }
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
$('#channel').onchange = () => store.set('hm_channel', $<HTMLInputElement>('#channel').value.trim().replace(/^#/, '').toLowerCase());
$('#startBtn').onclick = startGame;
$('#resumeBtn').onclick = resumeGame;
$('#endOldBtn').onclick = endUnfinished;
$('#quitBtn').onclick = quitGame;
$('#revealBtn').onclick = revealNow;
$('#nextBtn').onclick = next;
$('#againBtn').onclick = () => { goHome(); setupError(null); startGame(); };
$('#homeBtn').onclick = goHome;
$('#copyBtn').onclick = async () => {
  const t = summary();
  try { await navigator.clipboard.writeText(t); $('#copyBtn').textContent = 'Copied!'; setTimeout(() => $('#copyBtn').textContent = 'Copy results', 1500); }
  catch { const box = $<HTMLTextAreaElement>('#copyBox'); box.value = t; show(box, true); box.select(); }
};
$('#cv').addEventListener('click', (e) => {
  if (S.phase !== 'vote' || !S.R) return;
  const r = $('#cv').getBoundingClientRect(), x = (e as MouseEvent).clientX - r.left;
  const n = S.R.opts.length, i = Math.floor((x / r.width) * n);
  if (i >= 0 && i < n) pick(i);
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

initStreamerMode();
startLoop();
