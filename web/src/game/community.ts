/* Mizavo — "Your community": the streamer's record vs chat and the all-time top viewers.
   One database call (get_my_community) that only ever returns the logged-in streamer's own channel.
   Test games don't count toward any of it. */
import { $, el, show } from '../lib/dom';
import { api, type Community } from './api';

const plural = (n: number, word: string, many = word + 's') => `${n} ${n === 1 ? word : many}`;

function recordLine(c: Community): string {
  const r = c.record;
  if (!r.games) return 'No real games yet. Your record against chat starts with your first one.';
  return `You vs chat: ${plural(r.games, 'game')} · ${plural(r.wins, 'win')} · ${plural(r.losses, 'loss', 'losses')} · ${plural(r.ties, 'tie')}`;
}

function fill(c: Community, ids: { box: string; count: string; record: string; board: string }): void {
  $(ids.count).textContent = plural(c.total_viewers, 'viewer') + ' all-time';
  $(ids.record).textContent = recordLine(c);
  const ol = $(ids.board); ol.replaceChildren();
  if (!c.top.length) {
    ol.append(el('li', 'empty', 'Nobody on the board yet. Viewers join by answering in chat.'));
  }
  for (const v of c.top) {
    const li = el('li');
    const stats = [v.accuracy != null ? `${v.accuracy}% right` : null, v.best_streak >= 3 ? `best streak ${v.best_streak}` : null, plural(v.games, 'game')]
      .filter(Boolean).join(' · ');
    const who = el('span', 'nm');
    who.append(el('b', null, v.name), el('small', null, stats));
    li.append(el('span', 'r', '#' + v.rank), who, el('span', 's', v.points.toLocaleString('en-US')));
    ol.append(li);
  }
  show($(ids.box), true);
}

let run = 0;
/** Setup screen: record + top 10. Fails quietly (the panel just stays hidden). */
export async function loadSetupCommunity(): Promise<void> {
  const mine = ++run;
  try {
    const c = await api.community(10);
    if (mine !== run) return;
    fill(c, { box: '#community', count: '#cmCount', record: '#cmRecord', board: '#cmBoard' });
  } catch { show($('#community'), false); }
}

/** Final screen: record + top 5, loaded after the game is saved so it includes this game. */
export async function loadFinalCommunity(): Promise<void> {
  show($('#fCommunity'), false);
  try {
    const c = await api.community(5);
    fill(c, { box: '#fCommunity', count: '#fcCount', record: '#fcRecord', board: '#fcBoard' });
  } catch { /* stays hidden */ }
}
