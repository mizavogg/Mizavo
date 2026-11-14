/* Mizavo — admin Analytics tab (src/admin/analytics.ts), Nov 13, 2026.
   One database call (admin_analytics) returns everything; this file only draws it.
   Four sections, as Aiden picked: visitors & sources, game activity, players & channels, question bank health.
   "Download CSV" saves the day-by-day numbers for Excel / Tableau. */
import { rpc } from '../lib/supabase';
import { el } from '../lib/dom';

type Row = { name: string; [k: string]: unknown };
interface Report {
  from: string; to: string; days: number; generated_at: string;
  visitors: {
    views: number; visitors: number; visits: number; new_visitors: number; logged_in_visitors: number;
    today_views: number; today_visitors: number; tracking_since: string | null;
    by_day: { day: string; views: number; visitors: number }[];
    pages: Row[]; referrers: Row[]; sources: Row[]; devices: Row[]; browsers: Row[]; places: Row[];
  };
  games: {
    streamer_started: number; streamer_finished: number; chat_votes: number; avg_voters_per_round: number | null;
    solo_started: number; solo_finished: number; practice_games: number; warmups: number; warmup_votes: number;
    by_day: { day: string; streamer: number; solo: number; practice: number; warmup: number }[];
  };
  players: {
    channels_total: number; channels_new: number; channels_active: number; solo_players_total: number;
    solo_players_active: number; chatters_total: number; family_logins: number;
    top_channels: { name: string; login: string | null; games: number; finished: number; chat_votes: number; last_played: string }[];
    recent_channels: { name: string; login: string | null; joined: string; games: number }[];
  };
  questions: {
    approved: number; drafts: number; busiest_channel: string | null;
    by_category: { name: string; approved: number; ff: number; ooo: number; easy: number; medium: number; hard: number; used: number; left_for_busiest: number }[];
    most_missed: { id: string; category: string; mode: string; difficulty: number; text: string; answers: number; right_pct: number }[];
  };
}

const RANGES = [7, 30, 90];
let days = 30;
let last: Report | null = null;

/* ---------- small pieces ---------- */
const fmt = (n: number | null | undefined) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) + '%' : '–');
const shortDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const prettyCat = (c: string) => c.replace('_', ' ');
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return m + 'm ago';
  if (m < 48 * 60) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
};

function section(title: string, note?: string) {
  const s = el('section', 'anSec');
  const h = el('h3', 'invHead', title);
  if (note) h.append(el('small', null, note));
  s.append(h);
  return s;
}

function tiles(items: [label: string, value: string, sub?: string][]) {
  const g = el('div', 'anTiles');
  for (const [k, v, sub] of items) {
    const t = el('div', 'stat anTile');
    t.append(el('div', 'k', k), el('div', 'v', v));
    if (sub) t.append(el('div', 'sub', sub));
    g.append(t);
  }
  return g;
}

/* one floating tooltip shared by every chart */
let tip: HTMLElement | null = null;
function showTip(target: HTMLElement, lines: string[]) {
  if (!tip) { tip = el('div', 'anTip'); tip.setAttribute('role', 'tooltip'); document.body.append(tip); }
  tip.replaceChildren(...lines.map((l, i) => el(i ? 'div' : 'b', null, l)));
  tip.classList.add('on');
  const r = target.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = (r.top + scrollY - tip.offsetHeight - 8) + 'px';
}
const hideTip = () => tip?.classList.remove('on');

/** Day-by-day columns (one series). `lines` gives the tooltip text for each day. */
function dayChart(title: string, data: { day: string; value: number; lines: string[] }[]) {
  const box = el('div', 'anChart');
  const max = Math.max(1, ...data.map((d) => d.value));
  const head = el('div', 'anChartHead');
  head.append(el('span', 'anChartTitle', title), el('span', 'anChartMax', 'peak ' + fmt(max)));
  const plot = el('div', 'anPlot');
  plot.style.setProperty('--n', String(data.length));
  for (const d of data) {
    const col = el('button', 'anCol'); col.type = 'button';
    col.setAttribute('aria-label', shortDay(d.day) + ': ' + d.lines.join(', '));
    const bar = el('span', 'anBar' + (d.value ? '' : ' zero'));
    bar.style.height = (d.value ? Math.max(3, (100 * d.value) / max) : 0) + '%';
    col.append(bar);
    const on = () => showTip(col, [shortDay(d.day), ...d.lines]);
    col.onmouseenter = on; col.onfocus = on; col.onmouseleave = hideTip; col.onblur = hideTip;
    plot.append(col);
  }
  const axis = el('div', 'anAxis');
  if (data.length) axis.append(el('span', null, shortDay(data[0].day)), el('span', null, shortDay(data[data.length - 1].day)));
  box.append(head, plot, axis);
  return box;
}

/** A ranked list with a bar behind each number (bar length = share of the top item). */
function rankList(title: string, rows: Row[], key: string, label = (r: Row) => r.name, empty = 'Nothing yet') {
  const box = el('div', 'anList');
  box.append(el('div', 'anListTitle', title));
  if (!rows.length) { box.append(el('p', 'anEmpty', empty)); return box; }
  const max = Math.max(1, ...rows.map((r) => Number(r[key]) || 0));
  for (const r of rows) {
    const v = Number(r[key]) || 0;
    const row = el('div', 'anRow');
    const fill = el('span', 'anFill'); fill.style.width = (100 * v) / max + '%';
    row.append(fill, el('span', 'anName', label(r)), el('span', 'anVal', fmt(v)));
    box.append(row);
  }
  return box;
}

function table(head: string[], rows: (string | HTMLElement)[][], numericFrom = 1) {
  const wrap = el('div', 'anTableWrap');
  const t = el('table', 'anTable');
  const tr = el('tr');
  head.forEach((h, i) => tr.append(el('th', i >= numericFrom ? 'num' : null, h)));
  t.append(tr);
  for (const r of rows) {
    const row = el('tr');
    r.forEach((c, i) => { const td = el('td', i >= numericFrom ? 'num' : null); td.append(c); row.append(td); });
    t.append(row);
  }
  wrap.append(t);
  return wrap;
}

/* ---------- the whole tab ---------- */
export async function renderAnalytics(pane: HTMLElement): Promise<void> {
  const bar = el('div', 'anBarTop');
  const seg = el('div', 'anRange'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Time range');
  for (const n of RANGES) {
    const b = el('button', 'btn ghost small' + (n === days ? ' sel' : ''), 'Last ' + n + ' days'); b.type = 'button';
    b.setAttribute('aria-pressed', String(n === days));
    b.onclick = () => { days = n; renderAnalytics(pane); };
    seg.append(b);
  }
  const refresh = el('button', 'btn ghost small', 'Refresh'); refresh.type = 'button';
  refresh.onclick = () => renderAnalytics(pane);
  const csv = el('button', 'btn ghost small', 'Download CSV'); csv.type = 'button';
  csv.onclick = () => last && downloadCsv(last);
  bar.append(seg, el('span', 'spacer'), refresh, csv);

  const body = el('div', 'anBody');
  body.append(el('p', 'empty', 'Loading analytics…'));
  pane.replaceChildren(bar, body);

  let r: Report;
  try { r = await rpc<Report>('admin_analytics', { p_days: days }); }
  catch (e) { body.replaceChildren(el('p', 'err', 'Could not load analytics: ' + (e as Error).message)); return; }
  last = r;
  body.replaceChildren(visitorsSec(r), gamesSec(r), playersSec(r), questionsSec(r),
    el('p', 'anFoot', 'Mizavo days run midnight to midnight US Eastern. ' + shortDay(r.from) + ' – ' + shortDay(r.to) +
      '. Test games, admins and robots are never counted. Updated ' + new Date(r.generated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '.'));
}

function visitorsSec(r: Report) {
  const v = r.visitors;
  const s = section('Visitors & sources', v.tracking_since ? 'counting since ' + shortDay(v.tracking_since) : 'counting starts once this build is live');
  s.append(tiles([
    ['VISITORS', fmt(v.visitors), fmt(v.new_visitors) + ' new'],
    ['PAGE VIEWS', fmt(v.views), v.visits ? (v.views / v.visits).toFixed(1) + ' pages per visit' : undefined],
    ['VISITS', fmt(v.visits)],
    ['TODAY', fmt(v.today_visitors), fmt(v.today_views) + ' views'],
    ['LOGGED IN', fmt(v.logged_in_visitors), pct(v.logged_in_visitors, v.visitors) + ' of visitors'],
  ]));
  s.append(dayChart('Visitors per day', v.by_day.map((d) => ({
    day: d.day, value: d.visitors, lines: [fmt(d.visitors) + ' visitors', fmt(d.views) + ' page views'] }))));
  const grid = el('div', 'anGrid');
  grid.append(
    rankList('Top pages (views)', v.pages, 'views'),
    rankList('Where they came from', v.referrers, 'visitors', undefined, 'No visits yet'),
    rankList('Link tags (?ref= / utm_source)', v.sources, 'visitors', undefined, 'Add ?ref=reddit (etc.) to links you post to see them here'),
    rankList('Devices', v.devices, 'visitors', (x) => cap(x.name)),
    rankList('Browsers', v.browsers, 'visitors'),
    rankList('Time zones (rough location)', v.places, 'visitors', (x) => x.name.replace(/_/g, ' ')),
  );
  s.append(grid);
  return s;
}

function gamesSec(r: Report) {
  const g = r.games;
  const s = section('Game activity');
  s.append(tiles([
    ['STREAMER GAMES', fmt(g.streamer_started), pct(g.streamer_finished, g.streamer_started) + ' finished'],
    ['CHAT VOTES', fmt(g.chat_votes), g.avg_voters_per_round != null ? g.avg_voters_per_round + ' voters per round' : undefined],
    ['DAILY CHALLENGE', fmt(g.solo_started), pct(g.solo_finished, g.solo_started) + ' finished'],
    ['PRACTICE GAMES', fmt(g.practice_games)],
    ['WARM-UPS', fmt(g.warmups), fmt(g.warmup_votes) + ' votes'],
  ]));
  s.append(dayChart('Games per day (all kinds)', g.by_day.map((d) => {
    const total = d.streamer + d.solo + d.practice + d.warmup;
    return { day: d.day, value: total, lines: [
      fmt(total) + ' games', 'Streamer: ' + d.streamer, 'Daily challenge: ' + d.solo, 'Practice: ' + d.practice, 'Warm-up: ' + d.warmup] };
  })));
  return s;
}

function playersSec(r: Report) {
  const p = r.players;
  const s = section('Players & channels', 'family logins counted on their own');
  s.append(tiles([
    ['STREAMERS SIGNED UP', fmt(p.channels_total), fmt(p.channels_new) + ' new in range'],
    ['STREAMERS WHO PLAYED', fmt(p.channels_active), 'in range'],
    ['DAILY PLAYERS', fmt(p.solo_players_active), fmt(p.solo_players_total) + ' all time'],
    ['CHATTERS ON BOARDS', fmt(p.chatters_total), 'all time'],
    ['FAMILY LOGINS', fmt(p.family_logins), 'active'],
  ]));
  const grid = el('div', 'anGrid two');
  const top = el('div', 'anList');
  top.append(el('div', 'anListTitle', 'Most active streamers (in range)'));
  if (!p.top_channels.length) top.append(el('p', 'anEmpty', 'No streamer games in this range'));
  else top.append(table(['Streamer', 'Games', 'Finished', 'Chat votes', 'Last'],
    p.top_channels.map((c) => [chanLink(c.name, c.login), fmt(c.games), fmt(c.finished), fmt(c.chat_votes), ago(c.last_played)])));
  const rec = el('div', 'anList');
  rec.append(el('div', 'anListTitle', 'Newest sign-ups'));
  rec.append(table(['Streamer', 'Joined', 'Games'],
    p.recent_channels.map((c) => [chanLink(c.name, c.login), ago(c.joined), fmt(c.games)])));
  grid.append(top, rec);
  s.append(grid);
  return s;
}

function questionsSec(r: Report) {
  const q = r.questions;
  const s = section('Question bank health', q.busiest_channel ? '"left" = still unseen by ' + q.busiest_channel + ', the channel that has played the most' : undefined);
  const lowest = q.by_category.length ? Math.min(...q.by_category.map((c) => c.left_for_busiest)) : 0;
  s.append(tiles([
    ['APPROVED', fmt(q.approved)],
    ['DRAFTS', fmt(q.drafts), 'waiting for review'],
    ['CATEGORIES', fmt(q.by_category.length)],
    ['FEWEST LEFT', fmt(lowest), q.by_category.find((c) => c.left_for_busiest === lowest)?.name.replace('_', ' ')],
  ]));
  const maxApproved = Math.max(1, ...q.by_category.map((c) => c.approved));
  s.append(table(['Category', 'Approved', 'Fact/Fake', 'Odd One', 'Easy', 'Med', 'Hard', 'Used', 'Left'],
    q.by_category.map((c) => {
      const left = el('span', 'anLeft');
      const f = el('span', 'anLeftFill'); f.style.width = (100 * c.left_for_busiest) / maxApproved + '%';
      left.append(f, el('b', null, fmt(c.left_for_busiest)));
      return [prettyCat(c.name), fmt(c.approved), fmt(c.ff), fmt(c.ooo), fmt(c.easy), fmt(c.medium), fmt(c.hard), fmt(c.used), left];
    })));
  const missed = el('div', 'anList');
  missed.append(el('div', 'anListTitle', 'Most missed questions (3+ answers from players and streamers)'));
  if (!q.most_missed.length) missed.append(el('p', 'anEmpty', 'Not enough answers yet'));
  else missed.append(table(['Question', 'Category', 'Answers', 'Right'],
    q.most_missed.map((m) => [m.text, prettyCat(m.category), fmt(m.answers), m.right_pct + '%'])));
  s.append(missed);
  return s;
}

/* ---------- helpers ---------- */
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
function chanLink(name: string, login: string | null): HTMLElement {
  if (!login) return el('span', null, name);
  const a = el('a', null, name); a.href = '/channel?c=' + encodeURIComponent(login); a.target = '_blank'; a.rel = 'noopener';
  return a;
}

/** Day-by-day numbers as a CSV file (opens in Excel; drag into Tableau). */
function downloadCsv(r: Report) {
  const games = new Map(r.games.by_day.map((d) => [d.day, d]));
  const lines = ['date,visitors,page_views,streamer_games,daily_challenge_games,practice_games,warmups'];
  for (const v of r.visitors.by_day) {
    const g = games.get(v.day);
    lines.push([v.day, v.visitors, v.views, g?.streamer ?? 0, g?.solo ?? 0, g?.practice ?? 0, g?.warmup ?? 0].join(','));
  }
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'mizavo-analytics-' + r.from + '-to-' + r.to + '.csv';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
