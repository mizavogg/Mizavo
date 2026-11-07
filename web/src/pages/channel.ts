/* Mizavo — a streamer's public channel page: channel.html?c=<twitch login>
   Record vs chat (real games), today's rank, all-time top 25 viewers. No login needed. */
import { $, el, show } from '../lib/dom';
import { initNav } from '../lib/nav';
import { boards, emptyRow, plural, recordLine, viewerRow } from '../lib/boards';

function stat(value: string, label: string, hi = false): HTMLElement {
  const d = el('div', 'stat' + (hi ? ' hi' : '')); d.append(el('b', null, value), el('span', null, label)); return d;
}

async function main(): Promise<void> {
  const login = (new URLSearchParams(location.search).get('c') || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(login)) {
    $('#title').textContent = 'Channel not found';
    $('#lede').textContent = 'This link is missing a channel name.';
    return;
  }
  let p;
  try { p = await boards.channel(login); }
  catch { $('#title').textContent = "Couldn't load this channel"; $('#lede').textContent = 'Check your connection and refresh.'; return; }

  if (p.status === 'not_found') {
    $('#title').textContent = 'Channel not found';
    $('#lede').textContent = `twitch.tv/${login} hasn't played Mizavo yet.`;
    return;
  }
  if (p.status === 'private') {
    $('#title').textContent = 'This page is private';
    $('#lede').textContent = 'This streamer has chosen to keep their Mizavo channel off the public pages.';
    return;
  }

  document.title = `Mizavo — ${p.name}`;
  $('#title').textContent = p.name;
  const lede = $('#lede'); lede.replaceChildren(recordLine(p.record, p.name) + '. ');
  const tw = el('a', null, 'twitch.tv/' + p.login); tw.href = 'https://twitch.tv/' + p.login; tw.target = '_blank'; tw.rel = 'noopener';
  lede.append('Watch at ', tw, '.');

  const r = p.record, st = $('#stats'); st.replaceChildren();
  if (p.today_rank) st.append(stat('#' + p.today_rank, "Today's board", true));
  st.append(stat(String(r.games), plural(r.games, 'game').replace(/^[\d,]+ /, '')),
            stat(`${r.wins}–${r.losses}`, 'Streamer vs chat'),
            stat(p.total_viewers.toLocaleString('en-US'), plural(p.total_viewers, 'viewer').replace(/^[\d,]+ /, '')));
  show(st, true);

  $('#viewerCount').textContent = p.total_viewers > 25 ? 'top 25' : '';
  const ol = $('#top'); ol.replaceChildren();
  if (!p.top.length) ol.append(emptyRow('Nobody on the board yet. Viewers join by answering in chat.'));
  for (const v of p.top) ol.append(viewerRow(v));
  show($('#topBox'), true);
}
initNav();
main();
