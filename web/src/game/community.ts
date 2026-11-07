/* Mizavo — "Your community" on the setup and final screens, plus the "show my channel" switch.
   One call (get_my_community) that only ever returns the logged-in streamer's own channel.
   Test games don't count toward any of it. */
import { $, el, show } from '../lib/dom';
import { channelUrl, emptyRow, plural, recordLine, viewerRow } from '../lib/boards';
import { api, type Community } from './api';

let mine: Community | null = null;

function fill(c: Community, ids: { box: string; count: string; record: string; board: string }): void {
  $(ids.count).textContent = plural(c.total_viewers, 'viewer') + ' all-time';
  $(ids.record).textContent = recordLine(c.record);
  const ol = $(ids.board); ol.replaceChildren();
  if (!c.top.length) ol.append(emptyRow('Nobody on the board yet. Viewers join by answering in chat.'));
  for (const v of c.top) ol.append(viewerRow(v));
  show($(ids.box), true);
}

/** "#3 today" / "hidden" / "N more rounds to get on today's board" */
function todayLine(c: Community): string {
  if (c.hidden) return 'Your channel is hidden from the public pages.';
  if (c.today_rank) return `Your chat is #${c.today_rank} on today's board.`;
  const left = 10 - c.today_rounds;
  return left > 0 ? `Play ${plural(left, 'more round')} today to get on today's board.` : '';
}

function fillLinks(c: Community, linksId: string): void {
  // the pages themselves are in the top bar; here just today's standing and a quick copy of your page link
  const box = $(linksId); box.replaceChildren();
  const line = todayLine(c);
  if (line) box.append(el('span', 'todayLine', line));
  if (!c.hidden) {
    const copy = el('button', 'btn link', 'Copy your page link');
    copy.onclick = async () => {
      const url = location.origin + channelUrl(c.login);
      try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied!'; }
      catch { copy.textContent = url; }
      setTimeout(() => copy.textContent = 'Copy your page link', 1800);
    };
    box.append(copy);
  }
}

function syncSwitch(c: Community): void {
  const sw = $<HTMLInputElement>('#publicSw');
  sw.checked = !c.hidden; sw.disabled = false;
}

let run = 0;
/** Setup screen: record + top 10. Fails quietly (the panel just stays hidden). */
export async function loadSetupCommunity(): Promise<void> {
  const me = ++run;
  try {
    const c = await api.community(10);
    if (me !== run) return;
    mine = c;
    fill(c, { box: '#community', count: '#cmCount', record: '#cmRecord', board: '#cmBoard' });
    fillLinks(c, '#cmLinks');
    syncSwitch(c);
  } catch { show($('#community'), false); }
}

/** Final screen: record + top 5, loaded after the game is saved so it includes this game. */
export async function loadFinalCommunity(): Promise<void> {
  show($('#fCommunity'), false);
  try {
    const c = await api.community(5);
    mine = c;
    fill(c, { box: '#fCommunity', count: '#fcCount', record: '#fcRecord', board: '#fcBoard' });
    fillLinks(c, '#fcLinks');
  } catch { /* stays hidden */ }
}

/** The "Public channel" switch in game settings. */
export function initPublicSwitch(): void {
  const sw = $<HTMLInputElement>('#publicSw');
  sw.onchange = async () => {
    const hidden = !sw.checked;
    sw.disabled = true;
    try {
      await api.setVisibility(hidden);
      if (mine) { mine.hidden = hidden; fillLinks(mine, '#cmLinks'); }
      loadSetupCommunity();
    } catch {
      sw.checked = !sw.checked;   // put it back: the change didn't save
    } finally { sw.disabled = false; }
  };
}
