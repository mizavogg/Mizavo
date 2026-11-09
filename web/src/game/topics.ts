/* Mizavo — topic picker on the setup screen (decided Nov 9: free for every streamer).
   Streamers pick any mix of the 11 categories, or "All topics" (the default). The database draws
   picked categories from today's pool first, then the whole bank, and fills from other topics if the
   channel runs out (start_game, migration 32). Here we only show how many new questions are left and
   warn before the game starts if some rounds will come from other topics. */
import { $, el, show } from '../lib/dom';
import { rpc } from '../lib/supabase';
import { S } from './state';

export const CATEGORIES = [
  ['animals', 'Animals'], ['space', 'Space'], ['geography', 'Geography'], ['history', 'History'],
  ['food', 'Food'], ['science', 'Science'], ['human_body', 'Human body'], ['pop_culture', 'Pop culture'],
  ['language', 'Language'], ['music', 'Music'], ['sports', 'Sports'],
] as const;

type Counts = Record<string, { ff: number[]; ooo: number[] }>;   // new questions left: [easy, medium, hard]
let counts: Counts | null = null;
let picked = new Set<string>();                                      // empty = all topics

/** The pick to send to start_game: null = all topics. */
export function pickedCategories(): string[] | null {
  return picked.size && picked.size < CATEGORIES.length ? [...picked].sort() : null;
}

/** New questions left for the current mode, per difficulty, in these categories. */
function left(cats: readonly string[]): number[] {
  const out = [0, 0, 0];
  if (!counts) return out;
  for (const c of cats) {
    const x = counts[c]; if (!x) continue;
    for (let d = 0; d < 3; d++) {
      if (S.mode !== 'ooo') out[d] += x.ff[d] || 0;
      if (S.mode !== 'ff') out[d] += x.ooo[d] || 0;
    }
  }
  return out;
}
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

/** Same 30/40/30 split as the database. */
function need(rounds: number): number[] {
  const easy = Math.round(rounds * 0.3), hard = Math.floor(rounds * 0.3);
  return [easy, rounds - easy - hard, hard];
}

function render(): void {
  const box = $('#topicChips');
  const all = el('button', 'chip2' + (picked.size ? '' : ' on'), 'All topics');
  all.type = 'button'; all.setAttribute('aria-pressed', String(!picked.size));
  all.onclick = () => { picked.clear(); render(); };
  const chips: HTMLElement[] = [all];
  for (const [id, label] of CATEGORIES) {
    const on = picked.has(id);
    const b = el('button', 'chip2' + (on ? ' on' : ''));
    b.type = 'button'; b.setAttribute('aria-pressed', String(on));
    b.append(label);
    if (counts) b.append(el('small', null, String(sum(left([id])))));
    b.onclick = () => {
      if (on) picked.delete(id); else picked.add(id);
      if (picked.size === CATEGORIES.length) picked.clear();      // every topic picked = All
      render();
    };
    chips.push(b);
  }
  box.replaceChildren(...chips);
  note();
}

function note(): void {
  const rounds = +$<HTMLSelectElement>('#rounds').value || 10;
  const cats = pickedCategories();
  const warn = $('#topicWarn');
  if (!counts || !cats) {
    $('#topicNote').textContent = counts ? `${sum(left(CATEGORIES.map((c) => c[0]))).toLocaleString('en-US')} new for you` : '';
    show(warn, false);
    return;
  }
  const have = left(cats), want = need(rounds);
  const filled = want.reduce((s, n, d) => s + Math.max(0, n - have[d]), 0);
  $('#topicNote').textContent = `${sum(have).toLocaleString('en-US')} new in ${cats.length === 1 ? 'this topic' : 'these topics'}`;
  if (filled > 0) {
    warn.textContent = filled >= rounds
      ? `You've played every question in ${cats.length === 1 ? 'this topic' : 'these topics'}. This game will use other topics.`
      : `Only enough new questions for ${rounds - filled} of ${rounds} rounds (we keep easy, medium and hard balanced). The other ${filled} will come from other topics.`;
  }
  show(warn, filled > 0);
}

/** The channel's last pick (from its saved settings). */
export function setTopicPick(saved: string[] | null | undefined): void {
  picked = new Set((saved || []).filter((c) => CATEGORIES.some(([id]) => id === c)));
  render();
}

/** Load how many new questions are left. Runs whenever the setup screen opens (they go down after each game). */
export async function refreshTopics(): Promise<void> {
  render();
  try { counts = await rpc<Counts>('my_category_counts'); } catch { counts = null; }   // the counts are a bonus
  render();
}

// the warning depends on mode and rounds too
document.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.addEventListener('click', () => setTimeout(render, 0)));
$('#rounds').addEventListener('change', note);
