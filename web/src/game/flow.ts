/* Mizavo — game flow: start, rounds, timer, picking, reveal, final results.
   Questions come from the database one round at a time, never with the answer.
   The answer only arrives from reveal_round, after the timer ends or the streamer locks in. */
import { $, el, pad2, show } from '../lib/dom';
import { S, OPT_COLORS, KEYS, type Mode, type Round, type Viewer } from './state';
import { api, friendly, type ActiveGame, type RoundData, type ViewerResult } from './api';
import { layout, popWrong, resetArena, sortPool } from './arena';
import { clearBots, makeBots, scheduleBots } from './demo';
import { connectTwitch, disconnectTwitch, setStatus } from './chat';

const MODE_NAME = { ff: 'Fact or Fake', ooo: 'Odd One Out', mix: 'Mix' } as const;

/* ---------- screens ---------- */
export function show3(id: 'setup' | 'game' | 'final'): void {
  for (const s of ['setup', 'game', 'final']) show($('#' + s), s === id);
}
export function setPhase(p: typeof S.phase): void { S.phase = p; document.body.dataset.phase = p; }
function updateScore(): void { $('#sMe').textContent = String(S.me); $('#sCh').textContent = String(S.chat); }
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
}
function connectChat(): void {
  const ch = $<HTMLInputElement>('#channel').value.trim().replace(/^#/, '').toLowerCase();
  if (ch) connectTwitch(ch); else { disconnectTwitch(); setStatus(S.demo ? 'demo chat' : 'chat off', S.demo ? 'on' : ''); }
  if (S.demo) makeBots();
}
function resetGame(session: string, isTest: boolean): void {
  S.session = session; S.isTest = isTest; S.me = 0; S.chat = 0;
  S.viewers.clear(); S.history = [];
  show($('#scoreboard'), true); show($('#testTag'), isTest); updateScore();
}

export async function startGame(): Promise<void> {
  if (S.busy) return;
  readSettings(); setupError(null);
  S.busy = true; $<HTMLButtonElement>('#startBtn').disabled = true;
  try {
    const g = await api.start(S.mode, S.rounds, S.secs, S.blind, S.demo);
    connectChat();
    resetGame(g.session_id, g.is_test);
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
    resetGame(g.session_id, g.is_test);
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
  pendingResume = null; show($('#resumeBox'), false); setupError(null);
}

/** "End game" during play. */
export async function quitGame(): Promise<void> {
  if (!S.session) return;
  const ok = await confirmBox('End this game now?', "It won't count, and the questions already shown stay used for your channel.", 'End game');
  if (!ok) return;
  clearInterval(S.timer); clearBots();
  try { await api.abandon(S.session); } catch { /* already over: fine */ }
  S.session = null; goHome();
}
export function goHome(): void {
  clearInterval(S.timer); clearBots();
  S.R = null; show($('#scoreboard'), false); show($('#testTag'), false);
  $('#edition').textContent = 'Night edition · streamer vs chat';
  setPhase('setup'); show3('setup');
  checkActiveGame();
}

/* ---------- a round ---------- */
function buildRound(d: RoundData): Round {
  const opts = d.type === 'ff' ? ['FACT', 'FAKE'] : (d.items || []);
  return {
    idx: d.idx, type: d.type, category: d.category,
    statement: d.type === 'ff' ? (d.statement || '') : "Which one doesn't belong?",
    opts, colors: OPT_COLORS[d.type], answer: null, votes: new Map(), pick: null,
  };
}

async function loadRound(): Promise<void> {
  setPhase('loading'); show3('game');
  $('#statement').textContent = `Loading round ${S.idx}…`;
  $('#opts').replaceChildren(); show($('#explain'), false); show($('#below'), false);
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
  $('#edition').textContent = `No. ${pad2(R.idx)} of ${pad2(S.rounds)} — ${modeName}`;
  $('#gMode').textContent = modeName;
  $('#gRound').textContent = `Round ${R.idx} / ${S.rounds}`;
  $('#prompt').textContent = R.type === 'ff' ? 'TRUE OR NOT?' : 'ODD ONE OUT';
  $('#statement').textContent = R.statement;
  const keys = KEYS[R.type];
  const box = $('#opts'); box.replaceChildren(); box.className = 'opts';
  box.style.gridTemplateColumns = `repeat(${R.opts.length},1fr)`;
  R.opts.forEach((o, i) => {
    const b = el('button', 'opt'); b.style.setProperty('--c', R.colors[i]);
    b.append(el('span', 'key', keys[i]), document.createTextNode(o));
    b.onclick = () => pick(i); box.append(b);
  });
  $('#hint').innerHTML = R.type === 'ff' ? 'CHAT: TYPE <code>1</code> FOR FACT OR <code>2</code> FOR FAKE' : 'CHAT: TYPE <code>A</code> <code>B</code> <code>C</code> OR <code>D</code>';
  show($('#below'), true); show($('#explain'), false);
  $('#banner').className = 'banner'; $('#callout').className = 'callout';
  S.deadline = Date.now() + S.secs * 1000;
  clearInterval(S.timer); S.timer = window.setInterval(tick, 100); tick();
  if (S.demo) scheduleBots(S.secs * 1000);
}

export function tick(): void {
  const R = S.R; if (!R) return;
  const left = Math.max(0, S.deadline - Date.now());
  $('#timerBar').style.transform = `scaleX(${left / (S.secs * 1000)})`;
  $('#tnum').textContent = String(Math.ceil(left / 1000));
  const low = left < 4000; $('#stamp').classList.toggle('low', low); $('#timer').classList.toggle('low', low);
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

export function pick(i: number): void {
  const R = S.R; if (S.phase !== 'vote' || !R || R.pick != null) return;
  R.pick = i;
  ($('#opts').children[i] as HTMLElement).classList.add('picked'); $('#opts').classList.add('locked');
  if (S.blind) sortPool();
  $('#hint').innerHTML = '';
  $('#hint').append('LOCKED IN ', el('b', null, R.opts[i]), ' — CHAT STILL HAS TIME…');
}
/** Streamer pressed Enter / Reveal now. Early reveal needs a pick first (database rule). */
export function revealNow(): void {
  const R = S.R; if (S.phase !== 'vote' || !R) return;
  if (R.pick == null) { $('#hint').textContent = 'PICK AN ANSWER FIRST, THEN YOU CAN REVEAL EARLY.'; return; }
  S.deadline = Date.now(); tick();
}

function endVoting(): void {
  if (S.phase !== 'vote') return;
  clearInterval(S.timer); clearBots();
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
  S.me = res.streamer_score; S.chat = res.chat_score; updateScore();

  const n = R.votes.size;
  const pctRight = res.chat_pct_right;
  const meRight = !!res.streamer_correct, chatRight = !!res.chat_correct;

  // viewers: same points rule the database checks (100 per right answer + streak bonus up to +100)
  for (const v of R.votes.values()) {
    const rec: Viewer = S.viewers.get(v.key) || { id: v.id, login: v.login, name: v.name, color: v.color, bot: v.bot, pts: 0, streak: 0, best: 0, answers: 0, correct: 0 };
    rec.answers++;
    if (v.choice === R.answer) { rec.correct++; rec.streak++; rec.pts += 100 + Math.min(5, rec.streak - 1) * 20; rec.best = Math.max(rec.best, rec.streak); }
    else rec.streak = 0;
    rec.color = v.color; S.viewers.set(v.key, rec);
  }
  S.history.push({ round: R, meRight, chatRight, pctRight, votes: n });

  popWrong(R.answer);
  [...$('#opts').children].forEach((b, i) => b.classList.add(i === R.answer ? 'right' : 'wrong'));

  let head: string, color: string;
  if (meRight && chatRight) { head = 'Both nailed it'; color = 'var(--mint)'; }
  else if (meRight) { head = 'Streamer wins it'; color = 'var(--yellow)'; }
  else if (chatRight) { head = 'Chat carried'; color = 'var(--blue)'; }
  else { head = R.pick == null && !n ? 'Nobody answered' : 'Everyone got fooled'; color = 'var(--pink)'; }
  const sub = n ? (pctRight >= 90 ? `Hivemind — ${pctRight}% of chat was right` : pctRight <= 25 ? `Bamboozled — only ${pctRight}% of chat was right` : `${pctRight}% of chat was right`) : 'no chat votes';
  const bn = $('#banner'); bn.replaceChildren(head, el('small', null, sub)); bn.style.background = color;
  setTimeout(() => bn.classList.add('show'), 200);

  const ex = $('#exText'); ex.replaceChildren();
  const b = el('b', null, R.type === 'ff' ? (R.answer === 0 ? 'FACT.' : 'FAKE.') : `${R.opts[R.answer]}.`);
  b.style.background = R.colors[R.answer];
  let top: Viewer | null = null; for (const r of S.viewers.values()) if (!top || r.streak > top.streak) top = r;
  ex.append(b, ' ' + res.explanation, el('span', 'meta', top && top.streak >= 3 ? `${top.name} is on a ${top.streak}-round streak` : `Streamer picked: ${R.pick == null ? 'nothing' : R.opts[R.pick]}`));
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
  let today = '';
  try {
    const f = await api.finish(S.session!, real);
    S.me = f.streamer_score; S.chat = f.chat_score;
    if (!f.is_test && f.today && f.today.games_finished > 1) {
      today = `Across Mizavo today: chat beat the streamer in ${f.today.chat_won_pct ?? 0}% of ${f.today.games_finished} games.`;
    }
  } catch (e) { today = 'Your result could not be saved: ' + friendly(e); }
  S.session = null;

  $('#edition').textContent = 'Final edition';
  const win = S.me > S.chat ? 'me' : S.chat > S.me ? 'ch' : 'tie';
  $('#fTitle').textContent = win === 'me' ? 'The streamer outsmarted chat.' : win === 'ch' ? 'Chat wins. Hivemind confirmed.' : 'Dead even. Rematch?';
  $('#fTitle').style.color = win === 'me' ? 'var(--yellow)' : win === 'ch' ? 'var(--blue)' : '';
  $('#fMe').textContent = S.me + ' / ' + S.rounds; $('#fCh').textContent = S.chat + ' / ' + S.rounds;
  $('#fToday').textContent = (S.isTest ? 'Test game (simulated chat): it doesn\'t count toward question stats. ' : '') + today;
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
}

export function summary(): string {
  const lines = [`MIZAVO — Streamer ${S.me} vs Chat ${S.chat} (${S.rounds} rounds)`];
  S.history.forEach((h, i) => {
    const q = h.round.type === 'ff' ? h.round.statement : h.round.opts.join(' / ');
    lines.push(`${i + 1}. ${q} → ${h.round.opts[h.round.answer!]} | streamer ${h.meRight ? '✓' : '✗'} | chat ${h.pctRight}% right`);
  });
  const top = [...S.viewers.values()].sort((a, b) => b.pts - a.pts)[0];
  if (top) lines.push(`Chat MVP: ${top.name} (${top.pts})`);
  return lines.join('\n');
}

export function setMode(m: Mode): void { S.mode = m; }
