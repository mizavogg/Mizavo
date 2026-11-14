/* Mizavo — the Starting Soon warm-up (warmup.html?k=<code>), Nov 13, 2026.
   Streamers add this page once as an OBS Browser Source on their "starting soon" scene. Nobody is logged in
   here: the secret code in the link tells the server which channel it is. While the scene shows, chat plays
   on its own, on a loop:
     20 seconds to answer (each viewer's first answer counts) → the answer and a one-line explanation (~6 s) → next.
   The server hands out one question at a time and only reveals the answer once time is up. It scores the
   answers onto the channel's main viewer board (warm-ups aren't streamer games: no record, no today board).
   After 3 rounds in a row with no answers it pauses; the next answer typed in chat starts it again.
   Silent: OBS never clicks the page, so the browser never allows sound. Balls are plain (Twitch pictures need a login). */
import { $, el } from '../lib/dom';
import { rpc } from '../lib/supabase';
import { S, OPT_COLORS, type RoundType, type Round } from '../game/state';
import { layout, resetArena, startLoop, popWrong, setFitHeight } from '../game/arena';
import { connectTwitch, onAnyChat, parseVote } from '../game/chat';

interface Start { warmup_id: string; login: string; display_name: string; seconds: number }
interface WQ { idx: number; type: RoundType; category: string; statement?: string; items?: string[]; seconds: number; ends_at: string }
interface Top { name: string; correct: number; points: number; streak: number }
interface Reveal { idx: number; correct_position: number; explanation: string; votes: number; right: number; top: Top[] }

const REVEAL_MS = 6500;     // how long the answer stays up before the next question
const EMPTY_LIMIT = 3;      // rounds in a row with no answers before pausing
const code = (new URLSearchParams(location.search).get('k') || '').trim().toLowerCase();

let warmup: Start | null = null;
let empty = 0, timer = 0, deadline = 0, total = 20000, busy = false;

type State = 'loading' | 'vote' | 'reveal' | 'idle' | 'error';
function setState(s: State): void { document.body.dataset.state = s; }
function idle(title: string, text: string, state: State = 'idle'): void {
  $('#wIdleTitle').textContent = title; $('#wIdleText').textContent = text; setState(state);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function code0(e: unknown): string { return (e instanceof Error ? e.message : String(e)).split(':')[0]; }

/* ---------- start ---------- */
async function start(): Promise<void> {
  if (!/^[a-f0-9]{24}$/.test(code)) {
    return idle('Warm-up link missing', 'Copy your Starting Soon link from mizavo.gg (Play → More options → Your channel) and paste it into this Browser Source.', 'error');
  }
  for (let tries = 0; ; tries++) {
    try { warmup = await rpc<Start>('warmup_start', { p_code: code }); break; }
    catch (e) {
      const c = code0(e);
      if (c === 'bad_link') return idle("This warm-up link doesn't work", 'It may have been replaced with a new one. Copy the current link from mizavo.gg (Play → More options → Your channel).', 'error');
      idle('Chat warm-up', 'Connecting to Mizavo…', 'loading');
      await wait(c === 'slow_down' ? 5000 : Math.min(30000, 3000 * (tries + 1)));
    }
  }
  total = warmup.seconds * 1000;
  $('#wSub').textContent = `Chat warm-up · ${warmup.display_name}`;
  connectTwitch(warmup.login);
  setFitHeight(fitArena, 0.16);
  startLoop();
  nextRound();
}

/** The arena takes whatever height is left in the panel after the question, timer and explanation. */
function fitArena(): number {
  return $('#arena').clientHeight - $('#wTimer').offsetHeight - 12;
}

/* ---------- one round ---------- */
async function nextRound(): Promise<void> {
  if (!warmup || busy) return; busy = true;
  let q: WQ;
  try { q = await rpc<WQ>('warmup_round', { p_code: code, p_warmup: warmup.warmup_id }); }
  catch (e) {
    busy = false;
    const c = code0(e);
    if (c === 'bad_link') return idle("This warm-up link doesn't work", 'It was replaced with a new one. Copy the current link from mizavo.gg.', 'error');
    if (c === 'not_enough_questions') { idle('All questions played!', "This channel has seen every question. More are on the way."); setTimeout(nextRound, 10 * 60 * 1000); return; }
    if (c === 'bad_warmup') { location.reload(); return; }
    setTimeout(nextRound, 4000);   // network hiccup or "too soon": try again shortly
    return;
  }
  busy = false;
  const opts = q.type === 'ff' ? ['Fact', 'Fake'] : (q.items || []);
  const R: Round = { idx: q.idx, type: q.type, category: q.category, statement: q.statement || '', opts, colors: OPT_COLORS[q.type],
    answer: null, votes: new Map(), pick: null, weight: 1, lightning: null };
  S.R = R; S.blind = false; S.demo = false; S.phase = 'vote';
  resetArena();
  $('#wStatement').textContent = q.type === 'ff' ? R.statement : "Which one doesn't belong?";
  $('#wMode').textContent = q.type === 'ff' ? 'Fact or Fake' : 'Odd One Out';
  $('#wHow').innerHTML = q.type === 'ff' ? 'Type <kbd>1</kbd> Fact or <kbd>2</kbd> Fake in chat' : 'Type <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> or <kbd>D</kbd> in chat';
  $('#wExplain').replaceChildren();
  setState('vote');
  layout();
  // count down from now rather than from the server's clock time (the streamer's PC clock may be off);
  // the server only reveals once its own 20 seconds are up
  deadline = Date.now() + total;
  clearInterval(timer); timer = window.setInterval(tick, 100); tick();
}

function tick(): void {
  const left = Math.max(0, deadline - Date.now()), sec = Math.ceil(left / 1000);
  $('#wTimerBar').style.transform = `scaleX(${left / total})`;
  $('#wSec').textContent = String(sec);
  const low = left > 0 && sec <= 5; $('#wClock').classList.toggle('low', low); $('#wTimer').classList.toggle('low', low);
  if (left <= 0) { clearInterval(timer); reveal(); }
}

async function reveal(): Promise<void> {
  const R = S.R; if (!R || !warmup) return;
  S.phase = 'sorting';   // no more votes
  const votes = [...R.votes.values()].filter((v) => v.id && !v.bot)
    .map((v) => ({ id: v.id, login: v.login.toLowerCase(), name: v.name.slice(0, 50), choice: v.choice }));
  let res: Reveal | null = null;
  for (let i = 0; i < 4 && !res; i++) {
    try { res = await rpc<Reveal>('warmup_reveal', { p_code: code, p_warmup: warmup.warmup_id, p_idx: R.idx, p_votes: votes }); }
    catch (e) {
      const c = code0(e);
      if (c === 'too_soon') { await wait(1500); continue; }
      if (c === 'bad_link') return idle("This warm-up link doesn't work", 'It was replaced with a new one. Copy the current link from mizavo.gg.', 'error');
      await wait(2000);
    }
  }
  if (!res) { setTimeout(nextRound, 3000); return; }   // couldn't reveal: skip to the next question
  R.answer = res.correct_position; S.phase = 'reveal'; setState('reveal');
  popWrong(R.answer);
  const label = R.type === 'ff' ? (R.answer === 0 ? 'Fact' : 'Fake') : R.opts[R.answer];
  const tag = el('b', null, label); tag.style.background = R.colors[R.answer];
  const who = res.votes ? el('span', 'n', ` ${res.right} of ${res.votes} got it.`) : el('span', 'n', '');
  $('#wExplain').replaceChildren(tag, res.explanation, who);
  showTop(res.top);
  layout();

  empty = res.votes ? 0 : empty + 1;
  await wait(REVEAL_MS);
  if (empty >= EMPTY_LIMIT) return pause();
  nextRound();
}

function showTop(top: Top[]): void {
  const ol = $('#wTop');
  if (!top.length) { ol.replaceChildren(el('li', 'empty', 'First right answer takes the lead')); return; }
  ol.replaceChildren(...top.map((t) => {
    const li = el('li'); li.append(el('span', 'nm', t.name), el('span', 'pt', `${t.correct} right`)); return li;
  }));
}

/* ---------- paused: nobody answering ---------- */
let paused = false;
function pause(): void {
  paused = true; S.phase = 'setup'; S.R = null;
  idle('Chat warm-up', 'Type 1 in chat to start a round.');
}
onAnyChat((m) => {
  if (!paused) return;
  // any answer-looking message wakes it up: 1, 2, A–D, fact, fake…
  if (parseVote(m.text, 'ooo') == null && parseVote(m.text, 'ff') == null) return;
  paused = false; empty = 0;
  idle('Chat warm-up', `${m.name} started a round!`, 'loading');
  setTimeout(nextRound, 1200);
});

addEventListener('resize', () => { if (S.R) layout(); });
start();
