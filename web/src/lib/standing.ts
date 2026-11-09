/* Mizavo — "where you stand" curve on the daily challenge results.
   Asks the database how the day's finished scores are spread out (counts per 100-point bucket only,
   no names) and draws a smooth curve, a dashed line at the average, and a marker at the player's score.
   The database only sends the curve once a day has 10 finished players; before that we show a short note. */
import { el } from './dom';
import { rpc } from './supabase';

interface DayStats {
  date: string; players: number; min_players: number; ready: boolean;
  bucket_width?: number; max_points?: number; average?: number; buckets?: number[];
  points?: number | null; beat_pct?: number | null;
}

const SVG = 'http://www.w3.org/2000/svg';
const W = 600, H = 190, TOP = 14;          // drawing area (viewBox units); the svg scales to fit
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Smooth the bucket counts into a curve: each bucket spreads out as a little bell (a "kernel"). */
function smooth(buckets: number[], width: number, max: number, steps = 120): number[] {
  const sigma = width * 1.15;
  const ys: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const x = (s / steps) * max;
    let y = 0;
    buckets.forEach((n, i) => {
      if (!n) return;
      const c = Math.min(max, i * width + width / 2), d = (x - c) / sigma;
      y += n * Math.exp(-0.5 * d * d);
    });
    ys.push(y);
  }
  return ys;
}

function headline(s: DayStats, guest: boolean): string {
  const who = guest ? "of yesterday's players" : 'of players today';
  const p = s.beat_pct;
  if (p == null) return guest ? "Yesterday's scores" : "Today's scores";
  if (p >= 100) return guest ? "You'd have beaten every player yesterday" : 'You beat every player today';
  if (p <= 0) return guest ? "You'd be at the start of yesterday's curve" : "You're at the start of today's curve";
  return guest ? `You'd have beaten ${p}% ${who}` : `You beat ${p}% ${who}`;
}

function draw(box: HTMLElement, s: DayStats, guest: boolean): void {
  const width = s.bucket_width!, max = s.max_points!, ys = smooth(s.buckets!, width, max);
  const peak = Math.max(...ys) || 1;
  const X = (pts: number) => (Math.max(0, Math.min(max, pts)) / max) * W;
  const Y = (y: number) => H - (y / peak) * (H - TOP);
  const yAt = (pts: number) => ys[Math.round((Math.max(0, Math.min(max, pts)) / max) * (ys.length - 1))];

  const line = ys.map((y, i) => `${i ? 'L' : 'M'}${((i / (ys.length - 1)) * W).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', class: 'curve' });
  const defs = svg('defs', {});
  const grad = svg('linearGradient', { id: 'stFill', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svg('stop', { offset: '0%', 'stop-color': '#7F95AD', 'stop-opacity': .42 }),
              svg('stop', { offset: '100%', 'stop-color': '#7F95AD', 'stop-opacity': .04 }));
  defs.append(grad); g.append(defs);
  g.append(svg('path', { d: `${line} L${W},${H} L0,${H} Z`, fill: 'url(#stFill)', class: 'area' }));
  g.append(svg('path', { d: line, fill: 'none', stroke: '#A9BCD0', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', class: 'line' }));
  g.append(svg('line', { x1: 0, x2: W, y1: H - .5, y2: H - .5, stroke: 'rgba(242,232,220,.18)', 'vector-effect': 'non-scaling-stroke' }));

  const plot = el('div', 'plot');
  plot.append(g);
  const pin = (cls: string, pts: number, label: string) => {
    const x = X(pts) / W * 100, top = Y(yAt(pts)) / H * 100;
    const m = el('div', 'pin ' + cls); m.style.left = x + '%';
    m.style.setProperty('--top', top + '%');
    const tag = el('span', 'tag', label);
    if (x > 82) tag.classList.add('r'); else if (x < 18) tag.classList.add('l');
    m.append(el('i', 'stem'), el('b', 'dot'), tag);
    plot.append(m);
  };
  if (s.average != null) pin('avg', s.average, `Avg ${fmt(s.average)}`);
  if (s.points != null) pin('you', s.points, `You · ${fmt(s.points)}`);

  const axis = el('div', 'axis');
  axis.append(el('span', null, '0'), el('span', null, fmt(max / 2)), el('span', null, `${fmt(max)} pts`));

  box.replaceChildren(
    el('h2', null, headline(s, guest)),
    el('p', 'sub', `${s.players.toLocaleString('en-US')} players ${guest ? 'finished yesterday' : 'so far today'} · average ${fmt(s.average ?? 0)} points`),
    plot, axis);
}

/**
 * Fill `box` with the curve for `date`. Logged-in players are compared by their own saved score
 * (the database looks it up); guests pass the points from their local replay of yesterday's set.
 */
export async function showStanding(box: HTMLElement, opts: { date?: string; points?: number; guest?: boolean } = {}): Promise<void> {
  const guest = !!opts.guest;
  let s: DayStats;
  try {
    s = await rpc<DayStats>('solo_day_stats', { p_date: opts.date ?? null, p_points: opts.points ?? null });
  } catch { box.classList.add('hidden'); return; }   // the curve is a bonus: never block the results
  box.classList.remove('hidden');
  if (!s.ready) {
    const n = s.players;
    box.replaceChildren(
      el('h2', null, guest ? "Not enough players yesterday for a curve" : 'Where you stand'),
      el('p', 'sub', guest
        ? `Only ${n} ${n === 1 ? 'player' : 'players'} finished yesterday's set. The curve shows once ${s.min_players} have.`
        : n <= 1 ? "You're the first player to finish today. Check back later to see where you stand."
        : `You're one of the first ${n} players today. Check back later to see where you stand.`));
    box.classList.add('early');
    return;
  }
  box.classList.remove('early');
  draw(box, s, guest);
}
