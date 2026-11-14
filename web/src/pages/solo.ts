/* Mizavo — the daily solo challenge (solo.html).
   Logged in: today's 10 questions, the same for everyone; the database scores every answer and
   enforces the 15-second limit. One game a day.
   Guests: yesterday's challenge (nothing saved), so playing as a guest can't spoil today's.
   During the closed test, only invited players and admins can play today's; guests can still play yesterday's.
   Family logins (Nov 13; made on the admin page, log in at /family): play today's like everyone else, then
   unlimited practice games. Practice is never on a board, never repeats a question and never uses today's. */
import { $, el, show } from '../lib/dom';
import { rpc, supabase, loginWithTwitch } from '../lib/supabase';
import { plural } from '../lib/boards';
import { initNav, rememberLogin } from '../lib/nav';
import { OPT_COLORS, KEYS, SPHERE } from '../game/state';
import { SITE_HOST } from '../lib/site';
import { shareText } from '../lib/share';
import { showStanding } from '../lib/standing';
import { initSound, sfx, buzz } from '../lib/sound';
import { countTo } from '../lib/countup';
import { ribbedGlass } from '../lib/ribbed';

type RoundType = 'ff' | 'ooo';
interface Q { date?: string; idx: number; rounds: number; type: RoundType; category: string; statement?: string; items?: string[]; seconds: number; shown_at?: string; ends_at?: string }
interface Answer { idx: number; correct_position: number; explanation: string; correct: boolean; late?: boolean; points_gained?: number; points?: number; score?: number; streak?: number; is_last: boolean; state?: State }
interface State { date: string; next_reset_at: string; state: 'new' | 'playing' | 'done'; next_idx: number | null; points: number; correct: number; best_streak: number; rank: number | null; players_today: number; results?: boolean[] }
interface Info { closed_test: boolean; today: string; next_reset_at: string; guest_ready: boolean }
interface PState { state: 'new' | 'playing' | 'done'; next_idx: number | null; points: number; correct: number; best_streak: number; results: boolean[]; games_done: number; daily_done: boolean }

const api = {
  info: () => rpc<Info>('solo_info'),
  status: () => rpc<State>('solo_status'),
  start: () => rpc<State>('solo_start'),
  round: (i: number) => rpc<Q>('solo_round', { p_idx: i }),
  answer: (i: number, c: number | null) => rpc<Answer>('solo_answer', { p_idx: i, p_choice: c }),
  guestRound: (i: number) => rpc<Q>('guest_round', { p_idx: i }),
  guestAnswer: (i: number, c: number | null) => rpc<Answer>('guest_answer', { p_idx: i, p_choice: c }),
  familyMe: () => rpc<{ username: string; login: string; display_name: string }>('family_me'),
  practiceStatus: () => rpc<PState>('practice_status'),
  practiceStart: () => rpc<PState>('practice_start'),
  practiceRound: (i: number) => rpc<Q>('practice_round', { p_idx: i }),
  practiceAnswer: (i: number, c: number | null) => rpc<Answer & { state?: PState }>('practice_answer', { p_idx: i, p_choice: c }),
};

/* ---------- state ---------- */
let guest = false;
let idx = 0;
let q: Q | null = null;
let busy = false;
let phase: 'intro' | 'vote' | 'reveal' = 'intro';
let deadline = 0, total = 15000, timer = 0;
let gScore = 0, gPts = 0, gStreak = 0, gBest = 0;     // guest totals (local only)
let gResults: boolean[] = [], gDate = '';              // guest right/wrong per round, and which day it was
let lastState: State | null = null;
let family = false;       // logged in with a family login (not Twitch)
let practice = false;     // playing a practice game right now
let pState: PState | null = null;

/* ---------- helpers ---------- */
function err(msg: string | null): void { const e = $('#err'); e.textContent = msg || ''; show(e, !!msg); }
function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const code = m.split(':')[0];
  if (code === 'not_invited') return "Mizavo is in a closed test, and your account isn't on the invite list yet.";
  if (code === 'closed_test') return 'Guest play opens when Mizavo leaves the closed test. Log in with Twitch if you were invited.';
  if (code === 'no_challenge') return "There's no guest challenge yet. Check back tomorrow, or log in to play today's.";
  if (code === 'already_played') return "You've already played today's challenge.";
  if (code === 'not_enough_questions') return "Today's challenge isn't ready. Try again in a few minutes.";
  if (code === 'daily_first') return "Play today's challenge first. Then practice unlocks.";
  if (code === 'practice_empty') return "You've played every practice question there is. Amazing! More are coming soon.";
  if (code === 'family_off') return 'This login has been turned off. Ask the person who gave it to you.';
  if (code === 'practice_off') return 'Practice is only open to family logins for now.';
  return 'Something went wrong: ' + m;
}
function untilReset(iso: string): string {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const h = Math.floor(ms / 3.6e6), m = Math.ceil((ms % 3.6e6) / 6e4);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function btn(text: string, cls: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', 'btn ' + cls, text); b.onclick = onclick; return b;
}
function link(text: string, cls: string, href: string): HTMLAnchorElement {
  const a = el('a', 'btn ' + cls, text); a.href = href; return a;
}
function stat(value: string, label: string, hi = false): HTMLElement {
  const d = el('div', 'stat' + (hi ? ' hi' : '')); d.append(el('b', null, value), el('span', null, label)); return d;
}
/** Header score. animate: roll up with a pop (after an answer); otherwise set straight away. */
function setScore(score: number, pts: number, animate = false): void {
  if (animate) { countTo($('#sScore'), score, { quiet: true }); countTo($('#sPts'), pts); return; }
  const a = $('#sScore'), b = $('#sPts');
  a.textContent = String(score); a.dataset.n = String(score); b.textContent = pts.toLocaleString('en-US'); b.dataset.n = String(pts);
}
/** End of a game just played: a closing chime, and the Points total rolls up from 0. */
function celebrate(correct: number): void {
  sfx.finale(correct >= 8 ? 'good' : correct >= 5 ? 'even' : 'low');
  const pts = document.querySelector<HTMLElement>('#result .stat.hi b');
  if (pts) { const to = +(pts.textContent || '0').replace(/\D/g, '') || 0; pts.textContent = '0'; setTimeout(() => countTo(pts, to, { from: 0, ms: 1000 }), 450); }
}

/* ---------- share ---------- */
// e.g. "Mizavo Daily · Nov 7 / 🟦🟦🟧… 8/10 / 1,240 pts · best streak 6 / mizavo.gg/solo"
// Only right/wrong per round: no questions, so sharing never spoils the day for anyone.
function dayLabel(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return isNaN(+d) ? date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function shareMessage(date: string, results: boolean[], correct: number, points: number, best: number): string {
  const grid = results.map((r) => (r ? '🟦' : '🟧')).join('');
  return [`Mizavo Daily · ${dayLabel(date)}`, `${grid}  ${correct}/10`,
    `${points.toLocaleString('en-US')} pts · best streak ${best}`, `${SITE_HOST}/solo`].join('\n');
}
function shareBtn(text: string, cls = 'primary'): HTMLButtonElement {
  const label = 'Share result';
  const b = btn(label, cls, async () => {
    const r = await shareText(text);
    if (r === 'copied') b.textContent = 'Copied! Paste it anywhere';
    else if (r === 'failed') { window.prompt('Copy your result:', text); return; }
    else return;
    setTimeout(() => (b.textContent = label), 2200);
  });
  return b;
}

/* ---------- intro screens ---------- */
function intro(kicker: string, title: string, text: string, actions: HTMLElement[], fine = ''): void {
  phase = 'intro'; document.body.dataset.phase = 'intro';
  show($('#intro'), true); show($('#round'), false); show($('#result'), false); show($('#standing'), false);
  $('#introKicker').textContent = kicker; $('#introTitle').textContent = title; $('#introText').textContent = text;
  $('#introActions').replaceChildren(...actions);
  $('#introFine').textContent = fine;
}

function showResult(s: State): void {
  const r = $('#result'); r.replaceChildren(
    stat(`${s.correct}/10`, 'Right'),
    stat(s.points.toLocaleString('en-US'), 'Points', true),
    stat(s.rank ? `#${s.rank}` : '—', s.players_today ? `of ${plural(s.players_today, 'player')} today` : 'Today'),
    stat(String(s.best_streak), 'Best streak'));
  show(r, true);
}

function doneScreen(s: State): void {
  lastState = s; practice = false; show($('#edition'), false);
  show($('#scoreboard'), false);
  const share = shareBtn(shareMessage(s.date, s.results || [], s.correct, s.points, s.best_streak), family ? 'ghost' : 'primary');
  const open = family && pState?.state === 'playing';
  const actions = family
    ? [btn(open ? `Continue practice (round ${pState!.next_idx})` : 'Practice more', 'primary', () => beginPractice()), share, link('Leaderboards', 'ghost', '/today')]
    : [share, link('Leaderboards', 'ghost', '/today'), link('Play against your chat', 'ghost', '/')];
  intro("Today's challenge · done", s.correct >= 8 ? 'Sharp. Very sharp.' : s.correct >= 5 ? 'Nicely played.' : 'Tough one today.',
    `Your score is saved to the solo board. The next challenge starts in ${untilReset(s.next_reset_at)} (midnight Eastern time).`
      + (family ? ' Until then, practice as much as you like: practice rounds are always new questions and never go on the boards.' : ''),
    actions);
  showResult(s);
  showStanding($('#standing'), { date: s.date });
}

async function loggedIn(name: string): Promise<void> {
  $('#whoName').textContent = name; show($('#who'), true);
  try {
    if (family) {   // family login: no Twitch channel page, so no "My page" link
      const me = await api.familyMe();
      $('#whoName').textContent = me.display_name;
      rememberLogin(null);
    } else {
      const ch = await rpc<{ login: string }>('ensure_my_channel');
      rememberLogin(ch.login);
    }
    const s = await api.status();
    if (family && s.state === 'done') pState = await api.practiceStatus();
    lastState = s;
    if (s.state === 'done') return doneScreen(s);
    if (s.state === 'playing') {
      return intro("Today's challenge", 'Pick up where you left off.',
        `You're on round ${s.next_idx} of 10. Any round you opened and didn't answer in time counts as a miss.`,
        [btn(`Continue round ${s.next_idx}`, 'primary', () => begin())]);
    }
    intro("Today's challenge", 'Ten questions. Same for everyone.',
      'Fact or Fake and Odd One Out, easy to hard. 15 seconds a question, one try a day. Your score goes on the solo board.',
      [btn('Start today\'s challenge', 'primary', () => begin())],
      `New challenge every day at midnight Eastern time (in ${untilReset(s.next_reset_at)}).`);
  } catch (e) {
    const m = friendly(e);
    if (/closed test/.test(m)) {
      intro('Closed test', 'Not on the invite list yet.', m + ' If a streamer friend shared Mizavo with you, send them your Twitch name.',
        [btn('Check again', 'ghost', () => location.reload())]);
    } else { intro("Today's challenge", 'Hmm.', '', [btn('Try again', 'ghost', () => location.reload())]); err(m); }
  }
}

async function loggedOut(): Promise<void> {
  show($('#who'), false);
  const login = btn('Log in with Twitch', 'primary', async () => {
    try { await loginWithTwitch(); } catch (e) { err('Login failed: ' + (e as Error).message); }
  });
  let info: Info;
  try { info = await api.info(); } catch (e) { intro('Daily challenge', 'Hmm.', '', [login]); err(friendly(e)); return; }
  const actions = [login];
  if (info.guest_ready) actions.push(btn("Play yesterday's as a guest", 'ghost', () => beginGuest()));
  if (info.closed_test) {
    return intro('Closed test', 'Ten questions. Same for everyone.',
      "Today's challenge is invite-only while Mizavo is in its closed test. If you were invited, log in with Twitch to play it."
        + (info.guest_ready ? " Anyone can warm up with yesterday's as a guest (nothing is saved)." : ''),
      actions, `New challenge every day at midnight Eastern time (in ${untilReset(info.next_reset_at)}).`);
  }
  intro('Daily challenge', 'Ten questions. Same for everyone.',
    "Log in with Twitch to play today's challenge and get on the solo board. Or warm up with yesterday's as a guest (nothing is saved).",
    actions, `New challenge every day at midnight Eastern time (in ${untilReset(info.next_reset_at)}).`);
}

/* ---------- practice (family logins) ---------- */
async function beginPractice(): Promise<void> {
  if (busy) return; busy = true; err(null);
  try {
    const s = await api.practiceStart();
    pState = s; practice = true; guest = false;
    $('#edition').textContent = 'Practice · not on the boards'; show($('#edition'), true);
    setScore(s.correct, s.points); show($('#scoreboard'), true);
    idx = s.next_idx || 1;
    await loadRound();
  } catch (e) { practice = false; err(friendly(e)); }
  finally { busy = false; }
}

function practiceDone(s: PState): void {
  practice = false; show($('#edition'), false); show($('#scoreboard'), false);
  intro('Practice · done', `${s.correct} out of 10.`,
    "Practice scores don't go on the boards. Every practice round uses questions you haven't seen yet.",
    [btn('Practice again', 'primary', () => beginPractice()),
     btn("Today's results", 'ghost', () => { if (lastState) doneScreen(lastState); })],
    s.games_done === 1 ? 'Your first practice game is done.' : `${plural(s.games_done, 'practice game')} played.`);
  const r = $('#result'); r.replaceChildren(stat(`${s.correct}/10`, 'Right'), stat(s.points.toLocaleString('en-US'), 'Points', true), stat(String(s.best_streak), 'Best streak'));
  show(r, true);
  celebrate(s.correct);
}

/* ---------- playing ---------- */
async function begin(): Promise<void> {
  if (busy) return; busy = true; err(null);
  try {
    const s = await api.start();
    if (s.state === 'done') return doneScreen(s);
    setScore(s.correct, s.points); show($('#scoreboard'), true);
    idx = s.next_idx || 1;
    await loadRound();
  } catch (e) { err(friendly(e)); }
  finally { busy = false; }
}

function beginGuest(): void {
  guest = true; idx = 1; gScore = 0; gPts = 0; gStreak = 0; gBest = 0; gResults = []; gDate = '';
  $('#edition').textContent = "Yesterday's challenge · guest"; show($('#edition'), true);
  setScore(0, 0); show($('#scoreboard'), true);
  loadRound().catch((e) => { intro('Daily challenge', 'Hmm.', '', [btn('Back', 'ghost', () => location.reload())]); err(friendly(e)); });
}

async function loadRound(): Promise<void> {
  q = guest ? await api.guestRound(idx) : practice ? await api.practiceRound(idx) : await api.round(idx);
  if (guest && q.date) gDate = q.date;
  phase = 'vote'; document.body.dataset.phase = 'vote';
  show($('#intro'), false); show($('#round'), true); show($('#explain'), false); show($('#hint'), true);
  $('#rMode').textContent = q.type === 'ff' ? 'Fact or Fake' : 'Odd One Out';
  $('#rNum').textContent = `Round ${q.idx} of 10`;
  $('#statement').textContent = q.type === 'ff' ? (q.statement || '') : "Which one doesn't belong?";
  const opts = q.type === 'ff' ? ['Fact', 'Fake'] : (q.items || []);
  const box = $('#opts'); box.replaceChildren(); box.className = 'opts ' + q.type;
  opts.forEach((o, i) => {
    const c = OPT_COLORS[q!.type][i];
    const b = el('button', 'opt'); b.style.setProperty('--c', c); b.style.setProperty('--ball', SPHERE[c]);
    b.append(el('span', 'key', KEYS[q!.type][i]), document.createTextNode(o));
    b.dataset.sfx = 'off';   // plays the pick sound instead of the button tap
    b.onclick = () => choose(i); box.append(b);
  });
  // timer: a fresh round gets the full 15 s; a round reopened after a reload keeps its original end time
  total = q.seconds * 1000;
  const fresh = !q.shown_at || Math.abs(Date.parse(q.shown_at) - Date.now()) < 5000;
  deadline = fresh ? Date.now() + total : Date.parse(q.ends_at!);
  lastSec = -1; sfx.roundStart();
  clearInterval(timer); timer = window.setInterval(tick, 100); tick();
}

let lastSec = -1;
function tick(): void {
  const left = Math.max(0, deadline - Date.now());
  const sec = Math.ceil(left / 1000);
  $('#timerBar').style.transform = `scaleX(${left / total})`;
  $('#tnum').textContent = String(sec);
  // last 5 seconds: the timer turns orange and pulses once per second, with a soft tick
  const low = phase === 'vote' && left > 0 && sec <= 5; $('#stamp').classList.toggle('low', low); $('#timer').classList.toggle('low', low);
  if (sec !== lastSec) {
    if (lastSec !== -1 && low) { sfx.tick(sec); const st = $('#stamp'); st.classList.remove('beat'); void st.offsetWidth; st.classList.add('beat'); }
    lastSec = sec;
  }
  if (left <= 0 && phase === 'vote') choose(null);
}

async function choose(i: number | null): Promise<void> {
  if (phase !== 'vote' || busy || !q) return;
  busy = true; phase = 'reveal'; clearInterval(timer);
  $('#stamp').classList.remove('low'); $('#timer').classList.remove('low');
  if (i != null) { sfx.pick(); buzz(); } else sfx.timeUp();
  $('#opts').classList.add('locked');
  if (i != null) ($('#opts').children[i] as HTMLElement).classList.add('picked');
  let a: Answer;
  try { a = guest ? await api.guestAnswer(idx, i) : practice ? await api.practiceAnswer(idx, i) : await api.answer(idx, i); }
  catch (e) { busy = false; intro("Today's challenge", 'Hmm.', '', [btn('Try again', 'ghost', () => location.reload())]); err(friendly(e)); return; }
  busy = false;

  let gained = a.points_gained ?? 0, streak = a.streak ?? 0;
  if (guest) {   // same points rule as the database, kept locally (guest scores aren't saved)
    if (a.correct) { gStreak++; gScore++; gained = 100 + Math.min(5, gStreak - 1) * 20; gPts += gained; gBest = Math.max(gBest, gStreak); } else gStreak = 0;
    streak = gStreak;
    gResults[idx - 1] = !!a.correct;
    setScore(gScore, gPts, true);
  } else setScore(a.score ?? 0, a.points ?? 0, true);

  [...$('#opts').children].forEach((b, k) => b.classList.add(k === a.correct_position ? 'right' : 'wrong'));
  setTimeout(() => (a.correct ? sfx.right() : sfx.wrong()), 120);
  const label = q.type === 'ff' ? (a.correct_position === 0 ? 'Fact' : 'Fake') : (q.items || [])[a.correct_position];
  const tag = el('b', null, label); tag.style.background = OPT_COLORS[q.type][a.correct_position];
  const verdict = a.late ? 'Too late: the 15 seconds were up.' : i == null ? 'Out of time.'
    : a.correct ? `Right! +${gained}` + (streak >= 2 ? ` · ${streak} in a row` : '') : 'Not this time.';
  const meta = el('span', 'meta' + (a.correct ? ' good' : ''), verdict);
  $('#exText').replaceChildren(tag, ' ' + a.explanation, meta);
  $('#nextBtn').replaceChildren(a.is_last ? 'See results' : 'Next', el('kbd', null, 'Enter'));
  if (a.state) { if (practice) pState = a.state as unknown as PState; else lastState = a.state; }
  show($('#hint'), false); show($('#explain'), true);
}

async function next(): Promise<void> {
  if (phase !== 'reveal' || busy) return;
  if (idx >= 10) return finish();
  idx++;
  busy = true;
  try { await loadRound(); } catch (e) { intro("Today's challenge", 'Hmm.', '', [btn('Try again', 'ghost', () => location.reload())]); err(friendly(e)); }
  finally { busy = false; }
}

async function finish(): Promise<void> {
  if (practice) {
    const s = pState && pState.state === 'done' ? pState : await api.practiceStatus();
    pState = s;
    return practiceDone(s);
  }
  if (guest) {
    show($('#scoreboard'), false);
    intro("Yesterday's challenge · guest", `${gScore} out of 10.`,
      "Guest scores aren't saved. Log in with Twitch to play today's challenge and get on the solo board.",
      [btn('Log in with Twitch', 'primary', async () => { try { await loginWithTwitch(); } catch (e) { err((e as Error).message); } }),
       ...(gDate ? [shareBtn(shareMessage(gDate, gResults, gScore, gPts, gBest), 'ghost')] : []),
       link('Leaderboards', 'ghost', '/today')]);
    const r = $('#result'); r.replaceChildren(stat(`${gScore}/10`, 'Right'), stat(gPts.toLocaleString('en-US'), 'Points', true), stat(String(gBest), 'Best streak'));
    show(r, true);
    celebrate(gScore);
    if (gDate) showStanding($('#standing'), { date: gDate, points: gPts, guest: true });
    return;
  }
  const s = lastState && lastState.state === 'done' ? lastState : await api.status();
  if (family) { try { pState = await api.practiceStatus(); } catch { pState = null; } }
  doneScreen(s);
  celebrate(s.correct);
}

/* ---------- wiring ---------- */
$('#nextBtn').onclick = next;
$('#logoutBtn').onclick = async () => { await supabase.auth.signOut(); if (family) location.href = '/family'; else location.reload(); };
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (phase === 'vote' && q) {
    if (q.type === 'ff') { if (k === '1' || k === 'arrowleft') choose(0); else if (k === '2' || k === 'arrowright') choose(1); }
    else { const m = 'abcd'.indexOf(k); if (m >= 0) choose(m); else if ('1234'.includes(k) && k.length === 1) choose(+k - 1); }
  } else if (phase === 'reveal' && k === 'enter') { e.preventDefault(); next(); }
});

initNav();
initSound();
{ // the intro card's window of moving ribbed glass (Nov 11)
  const card = document.getElementById('intro')!;
  ribbedGlass(card, card.querySelector<HTMLCanvasElement>('.rGlow')!, card.querySelector<HTMLCanvasElement>('.rEdges')!, 9, (blob, _w, _h, s, c) => {
    blob(0.78 + 0.14 * s(0.0002), 0.45 + 0.22 * c(0.00026), 0.3, 0.75, [[0, '#d68a52'], [0.3, '#b76935'], [0.6, 'rgba(147,94,56,.5)'], [1, 'rgba(111,82,59,0)']]);
    blob(0.3 + 0.15 * c(0.00018, 1), 0.65 + 0.15 * s(0.00022, 2), 0.22, 0.6, [[0, '#7a5a42'], [0.45, 'rgba(110,90,70,.5)'], [1, 'rgba(92,77,60,0)']]);
  });
}
let started = false;
supabase.auth.onAuthStateChange((event, session) => {
  if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
  if (started && event === 'SIGNED_IN') return;      // token refreshes mid-game
  started = true;
  setTimeout(() => {
    if (!session) return loggedOut();
    const meta = session.user.user_metadata || {};
    family = !!session.user.app_metadata?.family;
    loggedIn(meta.nickname || meta.name || meta.preferred_username || 'Player');
  }, 0);
});
