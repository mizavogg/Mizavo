/* Mizavo — the arena: vote dots, bins, physics and all canvas drawing. */
import { $, clamp, rnd } from '../lib/dom';
import { S, KEYS, WHITE, hexA, shade, type Orb, type Vote } from './state';

const INK = '#0B0F17', PAPER = '#ECE3D2', MUTED = '#B5AB98', SAND = '#E2CFA6';
const SANS = '"DM Sans", system-ui, sans-serif';
const RADIUS = 20;

interface Rect { x: number; y: number; w: number; h: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; r: number }
interface Label { text: string; color: string; x: number; y: number; t0: number }

export const cv = $<HTMLCanvasElement>('#cv');
const ctx = cv.getContext('2d')!;
let W = 0, H = 0, DPR = 1;
export let bins: Rect[] = [];
let pool: Rect = { x: 0, y: 0, w: 0, h: 0 };
let orbs: Orb[] = [], parts: Particle[] = [], labels: Label[] = [];

/** Rounded rectangle path (drawn by hand so older OBS browsers work too). */
function rr(x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** A ball's color: its answer's color once it's in (or flying to) a bin; white while hidden in the pool. */
function ballColor(o: Orb): string {
  const R = S.R; if (!R) return WHITE;
  const i = o.state === 'bin' ? o.bin : (o.state === 'fly' && typeof o.dest === 'number' ? o.dest : null);
  return i == null ? WHITE : (R.colors[i] || WHITE);
}

/** Draw one round 3D-looking ball: soft shadow, then a sphere lit from the top left. */
function drawBall(x: number, y: number, r: number, color: string): void {
  const s = shade(color);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.55, r * 0.95, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
  g.addColorStop(0, s.hi); g.addColorStop(0.45, s.base); g.addColorStop(1, s.lo);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/** Size the canvas to the page and work out where the bins go. */
export function layout(): void {
  const w = $('#arena').clientWidth;
  const h = clamp(Math.round(window.innerHeight * 0.46), 260, 460);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = w; H = h;
  cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR); cv.style.height = h + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const n = S.R ? S.R.opts.length : 2;
  const gap = window.innerWidth < 820 ? 14 : 24;
  const bw = (W - gap * (n - 1)) / n, top = Math.round(H * 0.38);
  bins = Array.from({ length: n }, (_, i) => ({ x: i * (bw + gap), y: top, w: bw, h: H - top - 4 }));
  pool = { x: W * 0.12, y: 10, w: W * 0.76, h: top - 30 };
}

export function resetArena(): void { orbs = []; parts = []; labels = []; }

function binTarget(i: number) { const b = bins[i]; return { x: rnd(b.x + 14, b.x + b.w - 14), y: b.y + 6 }; }
function poolTarget() { return { x: rnd(pool.x + 20, pool.x + pool.w - 20), y: rnd(pool.y + 20, pool.y + pool.h - 20) }; }

export function flyTo(o: Orb, dest: 'pool' | number, delay = 0): void {
  const to = dest === 'pool' ? poolTarget() : binTarget(dest);
  o.state = 'fly'; o.dest = dest; o.from = { x: o.x, y: o.y }; o.to = to;
  o.t0 = performance.now() + delay; o.dur = rnd(450, 700);
  o.ctrl = { x: (o.x + to.x) / 2 + rnd(-60, 60), y: Math.min(o.y, to.y) - rnd(40, 110) };
}
export function spawnOrb(v: Vote): Orb {
  const o: Orb = { x: W / 2 + rnd(-30, 30), y: -12, vx: 0, vy: 0, r: 9, color: v.color, key: v.key, state: 'fly' };
  orbs.push(o); v.orb = o;
  return o;
}
export function addLabel(text: string, color: string, x: number, y: number): void {
  labels.push({ text, color, x, y, t0: performance.now() });
  if (labels.length > 7) labels.shift();
}
/** Blind mode: send every hidden vote from the mixed pool to its real bin. */
export function sortPool(): void {
  const R = S.R; if (!R) return;
  let d = 0;
  for (const v of R.votes.values()) {
    if (v.orb && (v.orb.state === 'pool' || v.orb.dest === 'pool')) { flyTo(v.orb, v.choice, d); d += Math.min(18, 700 / Math.max(1, R.votes.size)); }
  }
}
/** Reveal: wrong dots pop, right dots bounce. */
export function popWrong(answer: number): void {
  const R = S.R; if (!R) return;
  const now = performance.now();
  for (const v of R.votes.values()) {
    const o = v.orb; if (!o) continue;
    if (v.choice !== answer) o.popAt = now + 350 + Math.random() * 900;
    else { o.vy = -rnd(4, 10); o.vx += rnd(-2, 2); }
  }
  setTimeout(() => { for (const v of R.votes.values()) if (v.orb && v.choice === answer && !v.orb.dead) v.orb.vy = -rnd(3, 8); }, 900);
}

function containerOf(o: Orb): 'pool' | number | null { return o.state === 'fly' ? null : o.state === 'pool' ? 'pool' : (o.bin ?? null); }

function step(): void {
  const now = performance.now();
  for (const o of orbs) {
    if (o.state !== 'fly' || o.t0 == null || !o.to || !o.from || !o.ctrl || !o.dur) continue;
    const t = (now - o.t0) / o.dur;
    if (t < 0) continue;
    if (t >= 1) {
      o.x = o.to.x; o.y = o.to.y;
      if (o.dest === 'pool') { o.state = 'pool'; o.vx = rnd(-1, 1); o.vy = rnd(-1, 1); }
      else { o.state = 'bin'; o.bin = o.dest; o.vx = rnd(-1, 1); o.vy = 2; }
      continue;
    }
    const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, u = 1 - e;
    o.x = u * u * o.from.x + 2 * u * e * o.ctrl.x + e * e * o.to.x;
    o.y = u * u * o.from.y + 2 * u * e * o.ctrl.y + e * e * o.to.y;
  }
  const groups = new Map<'pool' | number, Orb[]>();
  for (const o of orbs) { const c = containerOf(o); if (c == null) continue; if (!groups.has(c)) groups.set(c, []); groups.get(c)!.push(o); }
  for (const [c, list] of groups) {
    const rect = c === 'pool' ? pool : bins[c];
    if (!rect) continue;
    const area = rect.w * rect.h, tr = clamp(Math.sqrt(area * 0.42 / (Math.PI * Math.max(1, list.length))), 3.5, c === 'pool' ? 12 : 20);
    const g = c === 'pool' ? 0 : 0.35;
    for (const o of list) {
      o.r += (tr - o.r) * 0.08;
      if (c === 'pool') {
        o.vx += rnd(-.12, .12); o.vy += rnd(-.12, .12);
        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
        o.vx += (cx - o.x) * 0.0006; o.vy += (cy - o.y) * 0.0012; o.vx *= 0.97; o.vy *= 0.97;
      } else { o.vy += g; o.vx *= 0.99; o.vy *= 0.995; }
      o.x += o.vx; o.y += o.vy;
      if (o.x < rect.x + o.r + 3) { o.x = rect.x + o.r + 3; o.vx = Math.abs(o.vx) * 0.4; }
      if (o.x > rect.x + rect.w - o.r - 3) { o.x = rect.x + rect.w - o.r - 3; o.vx = -Math.abs(o.vx) * 0.4; }
      if (o.y > rect.y + rect.h - o.r - 3) { o.y = rect.y + rect.h - o.r - 3; o.vy = -Math.abs(o.vy) * 0.25; o.vx *= 0.92; }
      if (c === 'pool' && o.y < rect.y + o.r) { o.y = rect.y + o.r; o.vy = Math.abs(o.vy) * 0.5; }
    }
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const dx = b.x - a.x, dy = b.y - a.y, m = a.r + b.r, d2 = dx * dx + dy * dy;
          if (d2 >= m * m || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (m - d) / 2;
          a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) { const imp = vn * 0.45; a.vx += nx * imp; a.vy += ny * imp; b.vx -= nx * imp; b.vy -= ny * imp; }
        }
      }
    }
  }
  for (const o of orbs) {
    if (o.popAt && now >= o.popAt && !o.dead) {
      o.dead = true;
      const pc = ballColor(o);
      for (let k = 0; k < 7; k++) { const a = rnd(0, Math.PI * 2), s = rnd(1.5, 4.5); parts.push({ x: o.x, y: o.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 1, color: pc, r: rnd(1.5, 3) }); }
    }
  }
  orbs = orbs.filter((o) => !o.dead);
  for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.025; }
  parts = parts.filter((p) => p.life > 0);
}

function draw(): void {
  ctx.clearRect(0, 0, W, H);
  const R = S.R; if (!R) return;
  const now = performance.now();
  const reveal = S.phase === 'reveal' && R.answer != null;
  const showSplit = !S.blind || R.pick != null || S.phase === 'reveal' || S.phase === 'gate';
  const counts = new Array(R.opts.length).fill(0); for (const v of R.votes.values()) counts[v.choice]++;
  const total = R.votes.size;
  const keys = KEYS[R.type];

  // blind mode: the mixed pool of hidden votes
  if (S.blind && R.pick == null && S.phase === 'vote') {
    ctx.save();
    rr(pool.x, pool.y, pool.w, pool.h, 18);
    ctx.fillStyle = 'rgba(236,227,210,.025)'; ctx.fill();
    ctx.setLineDash([6, 8]); ctx.strokeStyle = hexA(PAPER, .22); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    if (total === 0) { ctx.fillStyle = MUTED; ctx.font = `500 15px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText('Waiting for chat…', pool.x + pool.w / 2, pool.y + pool.h / 2 + 5); }
    ctx.fillStyle = MUTED; ctx.font = `500 13px ${SANS}`; ctx.textAlign = 'left';
    ctx.fillText("Chat's answers stay hidden until you pick", pool.x + 16, pool.y + 24);
  }

  // bins: sunken wells with a soft glow of their color at the bottom
  bins.forEach((b, i) => {
    const col = R.colors[i], sh = shade(col);
    const right = reveal && i === R.answer, wrong = reveal && i !== R.answer;
    ctx.save();
    ctx.globalAlpha = wrong ? .35 : 1;
    rr(b.x, b.y, b.w, b.h, RADIUS);
    const well = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    well.addColorStop(0, '#090C12'); well.addColorStop(1, '#131925');
    ctx.fillStyle = well; ctx.fill();
    ctx.save(); ctx.clip();
    const glow = ctx.createRadialGradient(b.x + b.w / 2, b.y + b.h, 0, b.x + b.w / 2, b.y + b.h, Math.max(b.w, b.h) * 0.8);
    glow.addColorStop(0, hexA(col, right ? .30 : .15)); glow.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = glow; ctx.fillRect(b.x, b.y, b.w, b.h);
    const lip = ctx.createLinearGradient(0, b.y, 0, b.y + 26);       // inner shadow along the top edge
    lip.addColorStop(0, 'rgba(0,0,0,.55)'); lip.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lip; ctx.fillRect(b.x, b.y, b.w, 26);
    ctx.restore();
    rr(b.x + .5, b.y + .5, b.w - 1, b.h - 1, RADIUS);
    ctx.lineWidth = right ? 2 : 1;
    // the streamer's pick stays secret until the reveal, so chat can't copy it
    const showPick = R.pick === i && S.phase === 'reveal';
    ctx.strokeStyle = right ? col : showPick ? hexA(SAND, .65) : hexA(PAPER, .10);
    ctx.stroke();
    // label: small ball with the key, then the answer
    const narrow = b.w < 170;
    drawBall(b.x + 26, b.y + 26, 11, col);
    ctx.fillStyle = INK; ctx.font = `700 11px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(keys[i], b.x + 26, b.y + 30);
    if (!narrow) {
      ctx.font = `600 16px ${SANS}`; ctx.textAlign = 'left'; ctx.fillStyle = PAPER;
      let name = R.opts[i];
      const maxW = b.w * 0.5;
      while (ctx.measureText(name).width > maxW && name.length > 3) name = name.slice(0, -2) + '…';
      ctx.fillText(name, b.x + 46, b.y + 31);
    }
    if (showPick) {
      const label = narrow ? 'Pick' : "Streamer's pick";
      ctx.font = `600 12px ${SANS}`;
      const w = ctx.measureText(label).width + 20, y = b.y + 48;
      rr(b.x + 14, y, w, 24, 12); ctx.fillStyle = PAPER; ctx.fill();
      ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(label, b.x + 24, y + 16);
    }
    ctx.restore();
    if (showSplit && total) {
      const pct = Math.round(counts[i] / total * 100);
      ctx.save(); ctx.globalAlpha = wrong ? .4 : 1; ctx.textAlign = 'right';
      if (narrow) {
        ctx.font = `600 20px ${SANS}`; ctx.fillStyle = sh.text;
        ctx.fillText(pct + '%', b.x + b.w - 12, b.y + 33);
      } else {
        const fs = clamp(b.w * 0.12, 24, 44);
        ctx.font = `600 ${fs}px ${SANS}`; ctx.fillStyle = sh.text;
        ctx.fillText(pct + '%', b.x + b.w - 16, b.y + fs + 8);
        ctx.font = `500 13px ${SANS}`; ctx.fillStyle = MUTED;
        ctx.fillText(counts[i] + ' vote' + (counts[i] === 1 ? '' : 's'), b.x + b.w - 16, b.y + fs + 27);
      }
      ctx.restore();
    }
  });

  // balls
  for (const o of orbs) {
    if (o.state === 'fly' && o.t0 != null && now < o.t0 && o.y < 0) continue;
    drawBall(o.x, o.y, o.r, ballColor(o));
  }
  for (const p of parts) {
    ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = shade(p.color).base;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // viewer names as their ball lands
  ctx.font = `600 13px ${SANS}`; ctx.textAlign = 'center';
  labels = labels.filter((l) => now - l.t0 < 1500);
  for (const l of labels) { const k = (now - l.t0) / 1500; ctx.globalAlpha = 1 - k; ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, l.y - k * 22); }
  ctx.globalAlpha = 1;
}

export function startLoop(): void {
  const loop = () => { step(); draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
