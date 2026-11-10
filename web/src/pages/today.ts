/* Mizavo — today's board: top channels today (smartest chat) + top players worldwide.
   Public page: no login. Refreshes every minute while open. */
import { $, el, show } from '../lib/dom';
import { initNav } from '../lib/nav';
import { boards, channelUrl, emptyRow, plural, row, viewerRow } from '../lib/boards';

function err(msg: string | null): void { const e = $('#err'); e.textContent = msg || ''; show(e, !!msg); }

async function loadChannels(): Promise<void> {
  const t = await boards.today();
  const day = new Date(t.day + 'T00:00:00Z');
  $('#dayLabel').textContent = 'Today · ' + day.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) + ' (Eastern time)';
  $('#chCount').textContent = t.board.length ? plural(t.board.length, 'channel') : '';
  const ol = $('#channels'); ol.replaceChildren();
  if (!t.board.length) ol.append(emptyRow(`No channels yet today. A channel shows up after ${t.min_rounds} real rounds. Check back later.`));
  for (const c of t.board) {
    const a = el('a', null, c.name); a.href = channelUrl(c.login);
    const li = row(c.rank, a, `${plural(c.rounds, 'round')} · streamer ${c.wins}–${c.losses} vs chat` + (c.ties ? ` (${plural(c.ties, 'tie')})` : ''), '');
    const s = li.querySelector('.s')!; s.replaceChildren(`${c.chat_pct}%`, el('small', null, 'chat right'));
    ol.append(li);
  }
}

async function loadPlayers(): Promise<void> {
  const p = await boards.players();
  const ol = $('#players'); ol.replaceChildren();
  if (!p.length) ol.append(emptyRow('No players yet. Answer in a Mizavo streamer\'s chat to get on the board.'));
  for (const v of p) {
    const stats = [v.accuracy != null ? `${v.accuracy}% right` : null, plural(v.channels, 'channel'), plural(v.games, 'game')].filter(Boolean).join(' · ');
    ol.append(row(v.rank, v.name, stats, v.points.toLocaleString('en-US')));
  }
}

async function loadSolo(): Promise<void> {
  const p = await boards.solo();
  const ol = $('#solo'); ol.replaceChildren();
  if (!p.length) ol.append(emptyRow('No solo players yet. Be the first: play today\'s challenge.'));
  for (const v of p) ol.append(viewerRow(v));
}

async function load(): Promise<void> {
  try { await Promise.all([loadChannels(), loadPlayers(), loadSolo()]); err(null); }
  catch { err("Couldn't load the boards. Check your connection; this page retries every minute."); }
}
initNav();
load();
setInterval(() => { if (!document.hidden) load(); }, 60_000);
