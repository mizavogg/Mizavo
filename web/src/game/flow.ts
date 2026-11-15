/* Mizavo — game flow: start, rounds, timer, picking, reveal, final results.
   Questions come from the database one round at a time, never with the answer.
   The answer only arrives from reveal_round, after the timer ends or the streamer locks in. */
import { $, el, show, store } from '../lib/dom';
import { SITE_URL } from '../lib/site';
import { S, OPT_COLORS, KEYS, SPHERE, type Mode, type Round, type Viewer } from './state';
import { api, chatServer, friendly, type ActiveGame, type RoundData, type ViewerResult } from './api';
import { dropStreamerBall, layout, popWrong, resetArena, sortPool } from './arena';
import { clearBots, makeBots, scheduleBots } from './demo';
import { connectTwitch, disconnectTwitch, setStatus } from './chat';
import { loadFinalCommunity, loadSetupCommunity } from './community';
import { pickedCategories, refreshTopics } from './topics';
import { sfx, buzz } from '../lib/sound';
import { countTo } from '../lib/countup';

const MODE_NAME = { ff: 'Fact or Fake', ooo: 'Odd One Out', mix: 'Mix' } as const;

/* ---------- screens ---------- */
export function show3(id: 'setup' | 'game' | 'final'): void {
  for (const s of ['setup', 'game', 'final']) show($('#' + s), s === id);
}
export function setPhase(p: typeof S.phase): void {
  S.phase = p; document.body.dataset.phase = p;
  document.documentElement.classList.remove('boot', 'fxWait');   // the real screen is known now: settle, and let the opening cover lift (see index.html)
}
/** Header score. animate: roll up with a pop (after a reveal); otherwise set straight away (new game, resume). */
function updateScore(animate = false): void {
  if (animate) { countTo($('#sMe'), S.me); countTo($('#sCh'), S.chat, { quiet: true }); return; }
  for (const [id, v] of [['#sMe', S.me], ['#sCh', S.chat]] as const) { const n = $(id); n.textContent = String(v); n.dataset.n = String(v); }
}
export function setupError(msg: string | null): void { const e = $('#setupErr'); e.textContent = msg || ''; show(e, !!msg); }

/** Simple yes/no dialog. Resolves true if the streamer confirms. */
export function confirmBox(title: string, text: string, ok: string): Promise<boolean> {
  const d = $<HTMLDialogElement>('#confirmDlg');
  $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmOk').textContent = ok;
  d.showModal();
  return new Promise((res) => {
    $('#confirmOk').onclick = () => { d.close(); res(true); };
    $('#confirmCancel').onclick = () => { d.close(); res(false); };
    d.oncancel = () => res(false);
  });
}

/* ---------- starting ---------- */
function readSettings(): void {
  S.rounds = +$<HTMLSelectElement>('#rounds').value;
  S.secs = +$<HTMLSelectElement>('#secs').value;
  S.blind = $<HTMLInputElement>('#blind').checked;
  S.demo = $<HTMLInputElement>('#demo').checked;
  S.double = $<HTMLInputElement>('#double').checked;
  S.lightning = $<HTMLInputElement>('#lightning').checked;
}
function connectChat(): void {
  const ch = $<HTMLInputElement>('#channel').value.trim().replace(/^#/, '').toLowerCase();
  if (ch) connectTwitch(ch); else { disconnectTwitch(); setStatus(S.demo ? 'demo chat' : 'chat off', S.demo ? 'on' : ''); }
  if (S.demo) makeBots();
}
function resetGame(session: string, isTest: boolean, doubleFinal: boolean, lightningAt: number | null): void {
  S.session = session; S.isTest = isTest; S.me = 0; S.chat = 0;
  S.doubleFinal = doubleFinal; S.lightningAt = lightningAt; S.lightBuf = [];
  S.maxScore = S.rounds + (doubleFinal ? 1 : 0);
  S.viewers.clear(); S.history = [];
  show($('#scoreboard'), true); show($('#testTag'), isTest); updateScore();
}

/* ---------- trusted scoring (Nov 14): the server reads chat through Mizavo's bot ---------- */
/** Show or hide the "Re-connect Twitch" box on the setup screen. */
export function setTrust(ok: boolean): void { show($('#trustBox'), !ok); }
/** Ask the server to read this game's chat. Real games only; test games keep simulated chat in the browser. */
async function startServerChat(session: string, isTest: boolean): Promise<void> {
  if (isTest) return;
  const reading = $<HTMLInputElement>('#channel').value.trim().replace(/^#/, '').toLowerCase();
  const mine = store.get('mz_login');
  if (reading && mine && reading !== mine) {   // reading someone else's chat: the bot only reads your own channel
    showNote("Scores this game aren't verified: Mizavo can only verify your own channel's chat.");
    return;
  }
  const r = await chatServer.start(session);
  if (r.verified) return;
  if (r.reason === 'reconnect') setTrust(false);
  showNote("Scores this game aren't verified: re-connect Twitch on the setup screen so they count on the leaderboards.");
}
function showNote(text: string): void {
  const n = $('#gameNote'); n.textContent = text; show(n, true);
  setTimeout(() => show(n, false), 9000);
}

export async function startGame(): Promise<void> {
  if (S.busy) return;
  readSettings(); setupError(null);
  S.busy = true; $<HTMLButtonElement>('#startBtn').disabled = true;
  try {
    const g = await api.start(S.mode, S.rounds, S.secs, S.blind, S.demo, S.double, S.lightning, pickedCategories());
    connectChat();
    await startServerChat(g.session_id, g.is_test);   // a few seconds at most; the first question waits for it
    resetGame(g.session_id, g.is_test, !!g.double_final, g.lightning_at ?? null);
    S.idx = 1;
    try { await loadRound(); } catch (e) { showRoundError(friendly(e), loadRound); }
  } catch (e) {
    if (/^game_in_progress/.test((e as Error).message)) await offerResume();
    else setupError(friendly(e));
  } finally { S.busy = false; $<HTMLButtonElement>('#startBtn').disabled = false; }
}

/* ---------- resuming an unfinished game (after a reload or crash) ---------- */
let pendingResume: ActiveGame | null = null;
export async function checkActiveGame(): Promise<void> {
  try { pendingResume = await api.activeGame(); } catch { pendingResume = null; }
  const box = $('#resumeBox');
  if (!pendingResume) { show(box, false); return; }
  const g = pendingResume;
  $('#resumeText').textContent = `You have an unfinished game: ${MODE_NAME[g.mode]}, ` +
    (g.next_round ? `round ${g.next_round} of ${g.rounds}` : `all ${g.rounds} rounds played`) +
    `. Streamer ${g.streamer_score}, chat ${g.chat_score}.`;
  show(box, true);
}
async function offerResume(): Promise<void> {
  await checkActiveGame();
  setupError('Finish or end your unfinished game first (just above).');
}
export async function resumeGame(): Promise<void> {
  const g = pendingResume; if (!g || S.busy) return;
  S.busy = true;
  try {
    S.mode = g.mode; S.rounds = g.rounds; S.secs = g.seconds; S.blind = g.blind; S.demo = g.is_test;
    connectChat();
    resetGame(g.session_id, g.is_test, !!g.double_final, g.lightning_at ?? null);
    S.me = g.streamer_score; S.chat = g.chat_score; updateScore();
    show($('#resumeBox'), false);
    if (g.next_round == null) await finish();
    else { S.idx = g.next_round; await loadRound(); }
  } catch (e) { setupError(friendly(e)); }
  finally { S.busy = false; }
}
export async function endUnfinished(): Promise<void> {
  const g = pendingResume; if (!g) return;
  const ok = await confirmBox('End that game?', "It won't count, and its questions stay used for your channel.", 'End it');
  if (!ok) return;
  try { await api.abandon(g.session_id); } catch (e) { setupError(friendly(e)); }
  chatServer.stop(g.session_id);
  pendingResume = null; show($('#resumeBox'), false); setupError(null);
}

/** "End game" during play. */
export async function quitGame(): Promise<void> {
  if (!S.session) return;
  const ok = await confirmBox('End this game now?', "It won't count, and the questions already shown stay used for your channel.", 'End game');
  if (!ok) return;
  clearInterval(S.timer); clearBots();
  try { await api.abandon(S.session); } catch { /* already over: fine */ }
  chatServer.stop(S.session);
  S.session = null; goHome();
}
export function goHome(): void {
  clearInterval(S.timer); clearBots();
  S.R = null; show($('#scoreboard'), false); show($('#testTag'), false);
  $('#edition').textContent = 'Streamer vs chat';
  setPhase('setup'); show3('setup');
  checkActiveGame();
  loadSetupCommunity();
  refreshTopics();
}

/* ---------- a round ---------- */
function buildRound(d: RoundData): Round {
  const opts = d.type === 'ff' ? ['Fact', 'Fake'] : (d.items || []);
  return {
    idx: d.idx, type: d.type, category: d.category,
    statement: d.type === 'ff' ? (d.statement || '') : "Which one doesn't belong?",
    opts, colors: OPT_COLORS[d.type], answer: null, votes: new Map(), pick: null,
    weight: d.weight || 1, lightning: d.lightning ?? null,
  };
}

/** A short title card before the lightning block and the double-points final (only on screen; no timer runs). */
function introCard(title: string, sub: string, ms: number): Promise<void> {
  S.R = null; resetArena(); layout();          // empty arena behind the card
  $('#gRound').textContent = `Round ${S.idx} of ${S.rounds}`; $('#gRound').classList.add('special');
  $('#prompt').textContent = 'Get ready';
  const bn = $('#banner'); bn.replaceChildren(title, el('small', null, sub)); bn.style.setProperty('--c', 'var(--yellow)');
  bn.classList.add('show', 'intro');
  sfx.special();
  return new Promise((res) => setTimeout(() => { bn.classList.remove('show', 'intro'); res(); }, ms));
}

async function loadRound(): Promise<void> {
  setPhase('loading'); show3('game');
  $('#statement').textContent = `Loading round ${S.idx}…`;
  $('#opts').replaceChildren(); show($('#explain'), false); show($('#below'), false);
  if (S.lightningAt != null && S.idx === S.lightningAt) {
    $('#statement').textContent = 'Lightning round';
    await introCard('Lightning round', '3 Fact or Fake questions · 10 seconds each · answers at the end', 2600);
  } else if (S.doubleFinal && S.idx === S.rounds) {
    $('#statement').textContent = 'Final round';
    await introCard('Double points', 'The final round counts 2 · viewers earn double', 2600);
  }
  const d = await api.round(S.session!, S.idx);
  S.R = buildRound(d);
  S.secs = d.seconds;
  startRound();
}

function startRound(): void {
  const R = S.R!;
  resetArena();
  setPhase('vote'); layout();
  const modeName = R.type === 'ff' ? 'Fact or Fake' : 'Odd One Out';
  $('#edition').textContent = 'Streamer vs chat';
  $('#gMode').textContent = modeName;
  $('#gRound').textContent = `Round ${R.idx} of ${S.rounds}` + (R.lightning ? ` · ⚡ ${R.lightning}/3` : R.weight === 2 ? ' · 2× points' : '');
  $('#gRound').classList.toggle('special', !!R.lightning || R.weight === 2);
  $('#prompt').textContent = R.lightning ? `Lightning ${R.lightning} of 3` : R.weight === 2 ? 'Final round · double points' : R.type === 'ff' ? 'True or not?' : 'Odd one out';
  $('#statement').textContent = R.statement;
  const keys = KEYS[R.type];
  const box = $('#opts'); box.replaceChildren(); box.className = 'opts';
  box.style.gridTemplateColumns = `repeat(${R.opts.length},1fr)`;
  R.opts.forEach((o, i) => {
    const b = el('button', 'opt'); b.style.setProperty('--c', R.colors[i]); b.style.setProperty('--ball', SPHERE[R.colors[i]]);
    b.dataset.sfx = 'off';   // plays the pick sound instead of the button tap
    b.append(el('span', 'key', keys[i]), document.createTextNode(o));
    b.onclick = () => pick(i); box.append(b);
  });
  $('#hint').innerHTML = R.type === 'ff'
    ? 'Chat: type <code>1</code> for Fact or <code>2</code> for Fake. <span class="more">Your first answer counts. Same as last time? Type <code>11</code>.</span>'
    : 'Chat: type <code>A</code>, <code>B</code>, <code>C</code> or <code>D</code>. <span class="more">Your first answer counts. Same as last time? Type <code>AA</code>.</span>';
  show($('#below'), true); show($('#explain'), false);
  $('#banner').className = 'banner'; $('#callout').className = 'callout';
  S.deadline = Date.now() + S.secs * 1000;
  lastSec = -1;
  if (R.lightning && R.lightning > 1) sfx.next(); else sfx.roundStart();
  clearInterval(S.timer); S.timer = window.setInterval(tick, 100); tick();
  if (S.demo) scheduleBots(S.secs * 1000);
}

let lastSec = -1;
export function tick(): void {
  const R = S.R; if (!R) return;
  const left = Math.max(0, S.deadline - Date.now());
  const sec = Math.ceil(left / 1000);
  $('#timerBar').style.transform = `scaleX(${left / (S.secs * 1000)})`;
  $('#tnum').textContent = String(sec);
  // last 5 seconds: the timer turns orange and pulses once per second, with a soft tick
  const low = left > 0 && sec <= 5; $('#stamp').classList.toggle('low', low); $('#timer').classList.toggle('low', low);
  if (sec !== lastSec) {
    if (lastSec !== -1 && low) { sfx.tick(sec); beat($('#stamp')); }
    lastSec = sec;
  }
  const n = R.votes.size;
  if ((!S.blind || R.pick != null) && n >= 10) {
    const counts = new Array(R.opts.length).fill(0); for (const v of R.votes.values()) counts[v.choice]++;
    const top = Math.max(...counts) / n, sorted = [...counts].sort((a, b) => b - a);
    let msg = '';
    if (top >= 0.85) msg = `Chat is ${Math.round(top * 100)}% sure`;
    else if ((sorted[0] - sorted[1]) / n <= 0.06) msg = 'Chat is split down the middle';
    const c = $('#callout'); c.textContent = msg; c.classList.toggle('show', !!msg);
  }
  if (left <= 0) endVoting();
}

/** Restart the one-second pulse animation on the timer. */
function beat(n: HTMLElement): void { n.classList.remove('beat'); void n.offsetWidth; n.classList.add('beat'); }

export function pick(i: number): void {
  const R = S.R; if (S.phase !== 'vote' || !R || R.pick != null) return;
  R.pick = i;
  sfx.pick(); buzz();   // same sound for every answer, so the stream can't hear which one
  // Secret pick: viewers watch this screen, so nothing shows WHICH answer was picked until the reveal.
  $('#opts').classList.add('locked');
  if (S.blind) sortPool();
  $('#hint').innerHTML = '';
  $('#hint').append(el('b', null, 'Streamer locked in ✓'), ' Chat still has time…');
}
/** Streamer pressed Enter / Reveal now. Early reveal needs a pick first (database rule). */
export function revealNow(): void {
  const R = S.R; if (S.phase !== 'vote' || !R) return;
  if (R.pick == null) { $('#hint').textContent = 'Pick an answer first, then you can reveal early.'; return; }
  S.deadline = Date.now(); tick();
}

function endVoting(): void {
  if (S.phase !== 'vote') return;
  clearInterval(S.timer); clearBots();
  $('#stamp').classList.remove('low'); $('#timer').classList.remove('low');
  if (!S.R?.lightning || S.R.lightning === 3) sfx.timeUp();
  setPhase('sorting');
  const needSort = S.blind && S.R!.pick == null;
  if (needSort) sortPool();
  setTimeout(reveal, needSort ? 1300 : 250);
}

/* ---------- reveal ---------- */
async function reveal(): Promise<void> {
  const R = S.R!;
  const counts: number[] = new Array(R.opts.length).fill(0);
  for (const v of R.votes.values()) counts[v.choice]++;
  let res;
  try { res = await api.reveal(S.session!, R.idx, R.pick, counts); }
  catch {
    // the database is the judge: retry once after a moment (covers a brief network blip or clock difference)
    await new Promise((r) => setTimeout(r, 1200));
    try { res = await api.reveal(S.session!, R.idx, R.pick, counts); }
    catch (e2) { showRoundError(friendly(e2), reveal); return; }
  }
  R.answer = res.correct_position; R.explanation = res.explanation; R.questionId = res.question_id;
  setPhase('reveal');
  $('#callout').classList.remove('show');
  S.me = res.streamer_score; S.chat = res.chat_score;   // shown after lightning 1-2 are done (see below)

  const n = R.votes.size;
  const pctRight = res.chat_pct_right;
  const meRight = !!res.streamer_correct, chatRight = !!res.chat_correct;

  // viewers: same points rule the database checks (100 per right answer + streak bonus up to +100)
  for (const v of R.votes.values()) {
    const rec: Viewer = S.viewers.get(v.key) || { id: v.id, login: v.login, name: v.name, color: v.color, bot: v.bot, pts: 0, streak: 0, best: 0, answers: 0, correct: 0 };
    rec.answers++;
    if (v.choice === R.answer) { rec.correct++; rec.streak++; rec.pts += (100 + Math.min(5, rec.streak - 1) * 20) * R.weight; rec.best = Math.max(rec.best, rec.streak); }
    else rec.streak = 0;
    rec.color = v.color; S.viewers.set(v.key, rec);
  }
  S.history.push({ round: R, meRight, chatRight, pctRight, votes: n });

  // lightning 1 and 2: no answer on screen yet; chat goes straight to the next question
  if (R.lightning) S.lightBuf.push({ round: R, meRight, chatRight, pctRight });
  if (R.lightning && R.lightning < 3 && !res.is_last) {
    $('#hint').replaceChildren(el('b', null, '⚡ Next one…'), ' Answers come at the end of the lightning round.');
    setTimeout(() => { next(); }, 900);
    return;
  }
  updateScore(true);

  popWrong(R.answer);
  if (R.pick != null) {
    const login = (store.get('mz_login') || $<HTMLInputElement>('#channel').value || '').trim().replace(/^#/, '').toLowerCase();
    dropStreamerBall(login, $('#whoName').textContent || 'Streamer', R.pick, R.answer);
  }
  [...$('#opts').children].forEach((b, i) => b.classList.add(i === R.answer ? 'right' : 'wrong', ...(i === R.pick ? ['picked'] : [])));

  let head: string, color: string, sub: string;
  if (R.lightning) {
    const me3 = S.lightBuf.filter((x) => x.meRight).length, ch3 = S.lightBuf.filter((x) => x.chatRight).length;
    head = me3 > ch3 ? 'Lightning: streamer' : ch3 > me3 ? 'Lightning: chat' : 'Lightning: even';
    color = me3 > ch3 ? 'var(--yellow)' : ch3 > me3 ? 'var(--orange-hi)' : 'var(--mint)';
    sub = `You ${me3}/${S.lightBuf.length} · Chat ${ch3}/${S.lightBuf.length}`;
  } else {
    if (meRight && chatRight) { head = 'Both nailed it'; color = 'var(--mint)'; }
    else if (meRight) { head = 'Streamer wins it'; color = 'var(--yellow)'; }
    else if (chatRight) { head = 'Chat carried'; color = 'var(--orange-hi)'; }
    else { head = R.pick == null && !n ? 'Nobody answered' : 'Everyone got fooled'; color = 'var(--pink)'; }
    sub = n ? (pctRight >= 90 ? `In sync — ${pctRight}% of chat was right` : pctRight <= 25 ? `Bamboozled — only ${pctRight}% of chat was right` : `${pctRight}% of chat was right`) : 'no chat votes';
    if (R.weight === 2) sub += ' · worth 2';
  }
  const bn = $('#banner'); bn.replaceChildren(head, el('small', null, sub)); bn.style.setProperty('--c', color);
  setTimeout(() => bn.classList.add('show'), 200);
  // the reveal sound: from the streamer's side, since they're the one playing on screen
  if (R.lightning) {
    const me3 = S.lightBuf.filter((x) => x.meRight).length, ch3 = S.lightBuf.filter((x) => x.chatRight).length;
    if (me3 >= ch3 && me3 > 0) sfx.right(); else if (ch3 > 0) sfx.chat(); else sfx.wrong();
  } else if (meRight) sfx.right(); else if (chatRight) sfx.chat(); else sfx.wrong();

  const ex = $('#exText'); ex.replaceChildren();
  let top: Viewer | null = null; for (const r of S.viewers.values()) if (!top || r.streak > top.streak) top = r;
  if (R.lightning) {
    // the lightning recap: each of the 3 statements with its answer
    const list = el('ol', 'lightList');
    for (const x of S.lightBuf) {
      const li = el('li');
      const tag = el('b', null, x.round.answer === 0 ? 'Fact' : 'Fake'); tag.style.background = x.round.colors[x.round.answer!];
      li.append(tag, ' ' + x.round.statement, el('span', 'meta', `You ${x.meRight ? '✓' : '✗'} · chat ${x.pctRight}% right`));
      list.append(li);
    }
    ex.append(list);
    S.lightBuf = [];
  } else {
    const b = el('b', null, R.type === 'ff' ? (R.answer === 0 ? 'Fact' : 'Fake') : R.opts[R.answer]);
    b.style.background = R.colors[R.answer];
    ex.append(b, ' ' + res.explanation, el('span', 'meta', top && top.streak >= 3 ? `${top.name} is on a ${top.streak}-round streak` : `Streamer picked: ${R.pick == null ? 'nothing' : R.opts[R.pick]}`));
  }
  $('#nextBtn').replaceChildren(res.is_last ? 'Final results' : 'Next', el('kbd', null, 'Enter'));
  resetReportBtn(false);
  show($('#below'), false); show($('#explain'), true);
}

/** The small "Report this question" button on the reveal panel. */
export function resetReportBtn(done: boolean): void {
  const b = $<HTMLButtonElement>('#reportBtn');
  b.textContent = done ? 'Reported. Thanks!' : 'Report this question';
  b.disabled = done;
  show(b, !!S.R?.questionId);
}

/** Something failed mid-game: say so plainly and offer to retry exactly that step. */
let retryStep: (() => Promise<void>) | null = null;
function showRoundError(msg: string, retry: () => Promise<void>): void {
  setPhase('reveal'); show3('game');
  retryStep = retry;
  $('#exText').replaceChildren(el('b', null, 'Hmm.'), ' ' + msg + ' Try again, or use End game.');
  $('#nextBtn').replaceChildren('Try again', el('kbd', null, 'Enter'));
  show($('#reportBtn'), false);
  show($('#below'), false); show($('#explain'), true);
}

export async function next(): Promise<void> {
  if (S.phase !== 'reveal' || S.busy) return;
  S.busy = true;
  try {
    if (retryStep) {
      const step = retryStep; retryStep = null;
      if (step === reveal) setPhase('sorting');
      await step();
    } else if (S.idx >= S.rounds) await finish();
    else { S.idx++; try { await loadRound(); } catch (e) { showRoundError(friendly(e), loadRound); } }
  } finally { S.busy = false; }
}

/* ---------- final results ---------- */
async function finish(): Promise<void> {
  setPhase('final'); clearBots();
  // only real Twitch viewers go on the channel leaderboard
  const real: ViewerResult[] = [...S.viewers.values()]
    .filter((v) => !v.bot && v.id && /^[a-z0-9_]{1,25}$/.test(v.login.toLowerCase()))
    .map((v) => ({ id: v.id!, login: v.login.toLowerCase(), display_name: v.name.slice(0, 50), points: v.pts, answers: v.answers, correct: v.correct, best_streak: v.best }));
  let today = '', saved = false;
  try {
    const f = await api.finish(S.session!, real);
    S.me = f.streamer_score; S.chat = f.chat_score; saved = true;
    if (f.max_score) S.maxScore = f.max_score;
    if (!f.is_test && f.today && f.today.games_finished > 1) {
      today = `Across Mizavo today: chat beat the streamer in ${f.today.chat_won_pct ?? 0}% of ${f.today.games_finished} games.`;
    }
  } catch (e) { today = 'Your result could not be saved: ' + friendly(e); }
  chatServer.stop(S.session!);   // stop reading chat (a cleanup job also closes anything left over)
  S.session = null;

  $('#edition').textContent = 'Final results';
  const win = S.me > S.chat ? 'me' : S.chat > S.me ? 'ch' : 'tie';
  $('#fTitle').textContent = win === 'me' ? 'The streamer outsmarted chat.' : win === 'ch' ? 'Chat wins. The crowd was right.' : 'Dead even. Rematch?';
  $('#fTitle').style.color = '';   // the title stays ivory whoever wins
  const of = (n: number) => n + ' / ' + S.maxScore;
  $('#fMe').textContent = of(0); $('#fCh').textContent = of(0);
  sfx.finale(win === 'me' ? 'good' : win === 'ch' ? 'chat' : 'even');
  setTimeout(() => { countTo($('#fMe'), S.me, { from: 0, fmt: of, ms: 900 }); countTo($('#fCh'), S.chat, { from: 0, fmt: of, ms: 900, quiet: true }); }, 500);
  $('#fToday').textContent = (S.isTest ? 'Test game (simulated chat): it doesn\'t count toward question stats, your record or the leaderboard. ' : '') + today;
  show($('#fToday'), !!$('#fToday').textContent);
  const top = [...S.viewers.values()].sort((a, b) => b.pts - a.pts).slice(0, 5);
  $('#fN').textContent = `${S.viewers.size} player${S.viewers.size === 1 ? '' : 's'}`;
  const ul = $('#mvp'); ul.replaceChildren();
  if (!top.length) { const li = el('li'); li.append(el('span', 'r', '—'), el('span', 'muted', 'No chat votes this game'), el('span')); ul.append(li); }
  top.forEach((v, i) => {
    const li = el('li'), n = el('span', null, v.name); n.style.color = v.color; n.style.fontWeight = '700';
    li.append(el('span', 'r', '#' + (i + 1)), n, el('span', 's', v.pts.toLocaleString('en-US') + (v.best >= 3 ? ` · ${v.best} streak` : '')));
    ul.append(li);
  });
  show($('#copyBox'), false);
  show3('final');
  if (saved) loadFinalCommunity(); else show($('#fCommunity'), false);
}

export function summary(): string {
  const lines = [`MIZAVO — Streamer ${S.me} vs Chat ${S.chat} (${S.rounds} rounds)`];
  S.history.forEach((h, i) => {
    const q = h.round.type === 'ff' ? h.round.statement : h.round.opts.join(' / ');
    lines.push(`${i + 1}. ${q} → ${h.round.opts[h.round.answer!]} | streamer ${h.meRight ? '✓' : '✗'} | chat ${h.pctRight}% right`);
  });
  const top = [...S.viewers.values()].sort((a, b) => b.pts - a.pts)[0];
  if (top) lines.push(`Chat MVP: ${top.name} (${top.pts})`);
  lines.push(`Play Mizavo with your chat: ${SITE_URL}`);
  return lines.join('\n');
}

export function setMode(m: Mode): void { S.mode = m; }
