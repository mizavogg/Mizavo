/* Mizavo — the arena: vote dots, bins, physics and all canvas drawing. */
import { $, clamp, rnd } from '../lib/dom';
import { S, KEYS, WHITE, hexA, shade, type Orb, type Vote } from './state';
import { faceFor, preloadFaces } from './faces';
import { pictureFor } from './avatars';
import { sfx } from '../lib/sound';

preloadFaces();
const FACE_MIN_R = 11;   // face balls never shrink below this, so the face stays readable
const STREAMER_R = 15;   // the streamer's ball is a bit bigger than everyone else's

const INK = '#121516', PAPER = '#F2E8DC', MUTED = '#B3ADA3', SAND = '#E7C39B';
const SANS = '"DM Sans", system-ui, sans-serif';
const RADIUS = 20;

interface Rect { x: number; y: number; w: number; h: number; head?: number }  // head: space kept clear for the label (phone cards)
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; r: number }
interface Label { text: string; color: string; x: number; y: number; t0: number }

export const cv = $<HTMLCanvasElement>('#cv');
const ctx = cv.getContext('2d')!;
let W = 0, H = 0, DPR = 1;
export let bins: Rect[] = [];
let pool: Rect = { x: 0, y: 0, w: 0, h: 0 };
let orbs: Orb[] = [], parts: Particle[] = [], labels: Label[] = [];
/** Effects: each bin glows a little brighter for a moment when a ball lands in it (0–1, fades out),
 *  and on the reveal the right bin lifts up with a soft ring of light. */
let glow: number[] = [];
let revealAt = 0;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** How far the right bin is lifted (px): up quickly with a little overshoot, then settles. */
function liftNow(now: number): number {
  if (!revealAt || reducedMotion()) return 0;
  const t = (now - revealAt) / 1000;
  if (t < 0) return 0;
  if (t < 0.28) { const k = t / 0.28; return 9 * (1 - Math.pow(1 - k, 3)); }
  return 5 + 4 * Math.exp(-(t - 0.28) * 6);
}
/** Phone layout: the bins become cards (name and % on top, balls below) that replace the answer
 *  buttons, so a whole round fits on one screen. Odd One Out is a 2×2 grid; Fact or Fake is 2 side by side. */
export let cards = false;

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

/** A face ball: the emote clipped to a circle, lit like the other balls, with a ring in the answer's color
 *  (white while hidden in blind mode, so chat sees who voted but not what they picked). */
function drawFace(x: number, y: number, r: number, color: string, img: HTMLImageElement): void {
  const s = shade(color);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.55, r * 0.95, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  const ring = Math.max(2, r * 0.16), inner = r - ring;
  ctx.fillStyle = s.base;                                   // the ring
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, inner, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#121516'; ctx.fillRect(x - inner, y - inner, inner * 2, inner * 2);   // behind a cut-out emote:
  ctx.fillStyle = hexA(s.lo, .55); ctx.fillRect(x - inner, y - inner, inner * 2, inner * 2); // dark tint of the ring color
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x - inner, y - inner, inner * 2, inner * 2);
  const g = ctx.createRadialGradient(x - inner * 0.35, y - inner * 0.4, inner * 0.05, x, y, inner);  // round, lit look
  g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = g; ctx.fillRect(x - inner, y - inner, inner * 2, inner * 2);
  ctx.restore();
  ctx.lineWidth = 1; ctx.strokeStyle = s.lo;                // thin dark edge so the ring reads on any background
  ctx.beginPath(); ctx.arc(x, y, r - 0.5, 0, Math.PI * 2); ctx.stroke();
}

/** Optional: a page can decide the arena's height itself (the warm-up panel fills whatever space is left). */
let fitHeight: (() => number) | null = null, poolShare = 0.38;
export function setFitHeight(fn: (() => number) | null, share = 0.38): void { fitHeight = fn; poolShare = share; }

/** Size the canvas to the page and work out where the bins go. */
export function layout(): void {
  const w = $('#arena').clientWidth;
  const n = S.R ? S.R.opts.length : 2;
  cards = w < 560;
  document.body.classList.toggle('cards', cards);
  const h = fitHeight ? Math.max(140, Math.round(fitHeight())) : cards ? clamp(Math.round(window.innerHeight * (n === 4 ? 0.5 : 0.42)), n === 4 ? 290 : 250, 430) : clamp(Math.round(window.innerHeight * 0.46), 260, 460);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = w; H = h;
  cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR); cv.style.height = h + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (cards) {
    // cards under a shorter pool: 2 per row (2 × 2 for Odd One Out, one row for Fact or Fake)
    const gap = 10, top = Math.round(H * 0.3), rows = Math.ceil(n / 2);
    const bw = (W - gap) / 2, bh = (H - top - gap * (rows - 1) - 4) / rows;
    bins = Array.from({ length: n }, (_, i) => ({ x: (i % 2) * (bw + gap), y: top + Math.floor(i / 2) * (bh + gap), w: bw, h: bh, head: 58 }));
    pool = { x: W * 0.06, y: 6, w: W * 0.88, h: top - 18 };
    return;
  }
  const gap = window.innerWidth < 820 ? 14 : 24;
  const bw = (W - gap * (n - 1)) / n, top = Math.round(H * poolShare);
  bins = Array.from({ length: n }, (_, i) => ({ x: i * (bw + gap), y: top, w: bw, h: H - top - 4 }));
  pool = { x: W * 0.12, y: 10, w: W * 0.76, h: top - 30 };
}

/** Which bin is at this point on the canvas (for tapping a bin to pick)? -1 if none. */
export function binAt(x: number, y: number): number {
  return bins.findIndex((b) => x >= b.x && x <= b.x + b.w && (!cards || (y >= b.y && y <= b.y + b.h)));
}

export function resetArena(): void { orbs = []; parts = []; labels = []; glow = []; revealAt = 0; }

function binTarget(i: number) { const b = bins[i]; return { x: rnd(b.x + 14, b.x + b.w - 14), y: b.y + (b.head ?? 0) + 6 }; }
function poolTarget() { return { x: rnd(pool.x + 20, pool.x + pool.w - 20), y: rnd(pool.y + 20, pool.y + pool.h - 20) }; }

export function flyTo(o: Orb, dest: 'pool' | number, delay = 0): void {
  const to = dest === 'pool' ? poolTarget() : binTarget(dest);
  o.state = 'fly'; o.dest = dest; o.from = { x: o.x, y: o.y }; o.to = to;
  o.t0 = performance.now() + delay; o.dur = rnd(450, 700);
  o.ctrl = { x: (o.x + to.x) / 2 + rnd(-60, 60), y: Math.min(o.y, to.y) - rnd(40, 110) };
}
export function spawnOrb(v: Vote): Orb {
  const o: Orb = { x: W / 2 + rnd(-30, 30), y: -12, vx: 0, vy: 0, r: 9, color: v.color, key: v.key, state: 'fly', face: faceFor(v.login, v.id), login: v.bot ? undefined : v.login };
  if (o.face) o.r = FACE_MIN_R;
  orbs.push(o); v.orb = o;
  return o;
}
export function addLabel(text: string, color: string, x: number, y: number): void {
  labels.push({ text, color, x, y, t0: performance.now() });
  if (labels.length > 7) labels.shift();
}
/** Reveal: the streamer's own ball (their face ball if they have one) drops into the bin they picked.
 *  It isn't a vote, so it never changes chat's counts. It pops with the wrong pile, or bounces with the right one. */
export function dropStreamerBall(login: string, name: string, pick: number, answer: number): void {
  const face = faceFor(login, null);
  const o: Orb = { x: W / 2, y: -16, vx: 0, vy: 0, r: STREAMER_R, color: SAND, key: '__streamer', state: 'fly', face, streamer: true, login };
  orbs.push(o);
  flyTo(o, pick, 150);
  o.dur = 650;
  if (pick !== answer) o.popAt = performance.now() + 150 + 650 + 900;
  const b = bins[pick];
  setTimeout(() => addLabel(name, SAND, b.x + b.w / 2, b.y - 6), 450);
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
  revealAt = now;
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
      else { o.state = 'bin'; o.bin = o.dest; o.vx = rnd(-1, 1); o.vy = 2; if (o.bin != null) glow[o.bin] = Math.min(1, (glow[o.bin] || 0) + 0.35); }
      if (S.phase !== 'gate') sfx.land();
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
    const area = rect.w * (rect.h - (rect.head ?? 0)), tr = clamp(Math.sqrt(area * 0.42 / (Math.PI * Math.max(1, list.length))), 3.5, c === 'pool' ? 12 : 20);
    const g = c === 'pool' ? 0 : 0.35;
    for (const o of list) {
      o.r += ((o.streamer ? Math.max(tr, STREAMER_R) : o.face ? Math.max(tr, FACE_MIN_R) : tr) - o.r) * 0.08;
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
      sfx.pop();
      const pc = ballColor(o);
      for (let k = 0; k < 7; k++) { const a = rnd(0, Math.PI * 2), s = rnd(1.5, 4.5); parts.push({ x: o.x, y: o.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 1, color: pc, r: rnd(1.5, 3) }); }
    }
  }
  orbs = orbs.filter((o) => !o.dead);
  for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.025; }
  parts = parts.filter((p) => p.life > 0);
  for (let i = 0; i < glow.length; i++) if (glow[i]) glow[i] = glow[i] < 0.01 ? 0 : glow[i] * 0.94;
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

  // bins: frosted glass panes with a soft glow of their color at the bottom
  const lift = reveal ? liftNow(now) : 0;
  bins.forEach((b, i) => {
    const col = R.colors[i], sh = shade(col);
    const right = reveal && i === R.answer, wrong = reveal && i !== R.answer;
    const pulse = glow[i] || 0;
    ctx.save();
    if (right && lift) ctx.translate(0, -lift);
    ctx.globalAlpha = wrong ? .35 : 1;
    rr(b.x, b.y, b.w, b.h, RADIUS);
    // a well cut into the glass (Nov 11): dark inside, shaded along the top inner edge, lit along the bottom
    const well = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    well.addColorStop(0, 'rgba(0,0,0,.35)'); well.addColorStop(0.12, 'rgba(0,0,0,0)'); well.addColorStop(1, 'rgba(232,226,214,.03)');
    ctx.fillStyle = 'rgba(6,8,9,.6)'; ctx.fill();
    ctx.fillStyle = well; ctx.fill();
    ctx.save(); ctx.clip();
    const gl = ctx.createRadialGradient(b.x + b.w / 2, b.y + b.h, 0, b.x + b.w / 2, b.y + b.h, Math.max(b.w, b.h) * 0.8);
    gl.addColorStop(0, hexA(col, right ? .38 : .20 + pulse * .22)); gl.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = gl; ctx.fillRect(b.x, b.y, b.w, b.h);
    const lip = ctx.createLinearGradient(0, b.y + b.h - 3, 0, b.y + b.h);   // light catching the bottom inner edge
    lip.addColorStop(0, 'rgba(245,239,230,0)'); lip.addColorStop(1, 'rgba(245,239,230,.16)');
    ctx.fillStyle = lip; ctx.fillRect(b.x, b.y + b.h - 3, b.w, 3);
    ctx.restore();
    rr(b.x + .5, b.y + .5, b.w - 1, b.h - 1, RADIUS);
    ctx.lineWidth = right ? 2 : 1;
    // the streamer's pick stays secret until the reveal, so chat can't copy it
    const showPick = R.pick === i && S.phase === 'reveal';
    ctx.strokeStyle = right ? col : showPick ? hexA(SAND, .65) : pulse > .05 ? hexA(col, .2 + pulse * .45) : 'rgba(0,0,0,.35)';
    ctx.stroke();
    if (right && revealAt && !reducedMotion()) {
      // a soft ring of light that grows out from the right bin once
      const k = (now - revealAt) / 900;
      if (k >= 0 && k < 1) {
        const pad = 2 + k * 14;
        rr(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, RADIUS + pad);
        ctx.lineWidth = 2; ctx.strokeStyle = hexA(col, .5 * (1 - k)); ctx.stroke();
      }
    }
    // label: small ball with the key, then the answer
    const narrow = b.w < 170 && !cards;
    drawBall(b.x + 26, b.y + 26, 11, col);
    ctx.fillStyle = INK; ctx.font = `700 11px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(keys[i], b.x + 26, b.y + 30);
    if (!narrow) {
      // phone cards have the whole width for the name (the % goes on the line below)
      ctx.font = `600 ${cards ? 15 : 16}px ${SANS}`; ctx.textAlign = 'left'; ctx.fillStyle = PAPER;
      let name = R.opts[i];
      const maxW = cards ? b.w - 58 : b.w * 0.5;
      while (ctx.measureText(name).width > maxW && name.length > 3) name = name.slice(0, -2) + '…';
      ctx.fillText(name, b.x + 46, b.y + 31);
    }
    if (showPick) {
      const label = narrow || cards ? 'Pick' : "Streamer's pick";
      ctx.font = `600 12px ${SANS}`;
      const w = ctx.measureText(label).width + 20;
      // phone cards: top-right of the second line, clear of the %; otherwise under the name
      const x = cards ? b.x + b.w - 12 - w : b.x + 14, y = cards ? b.y + 40 : b.y + 48;
      rr(x, y, w, 24, 12); ctx.fillStyle = PAPER; ctx.fill();
      ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(label, x + 10, y + 16);
    }
    ctx.restore();
    ctx.save(); if (right && lift) ctx.translate(0, -lift);
    if (showSplit && total && cards) {
      // phone cards: "42%  12 votes" on the line under the name
      const pct = Math.round(counts[i] / total * 100);
      ctx.save(); ctx.globalAlpha = wrong ? .4 : 1; ctx.textAlign = 'left';
      ctx.font = `600 16px ${SANS}`; ctx.fillStyle = sh.text;
      const pw = ctx.measureText(pct + '%').width;
      ctx.fillText(pct + '%', b.x + 46, b.y + 55);
      ctx.font = `500 12px ${SANS}`; ctx.fillStyle = MUTED;
      ctx.fillText(String(counts[i]), b.x + 46 + pw + 7, b.y + 55);
      ctx.restore();
    } else if (showSplit && total) {
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
    ctx.restore();
  });

  // balls
  for (const o of orbs) {
    if (o.state === 'fly' && o.t0 != null && now < o.t0 && o.y < 0) continue;
    const up = lift && o.state === 'bin' && o.bin === R.answer ? lift : 0;
    if (up) { ctx.save(); ctx.translate(0, -up); }
    // custom face ball first, then their Twitch picture (only once the ball is big enough to see it)
    const pic = o.face && o.face.complete && o.face.naturalWidth ? o.face : o.login && (o.r >= 6 || o.streamer) ? pictureFor(o.login) : null;
    if (pic) drawFace(o.x, o.y, o.r, ballColor(o), pic);
    else drawBall(o.x, o.y, o.r, ballColor(o));
    if (o.streamer) {   // a thin sand ring marks the streamer's ball
      ctx.lineWidth = 2; ctx.strokeStyle = hexA(SAND, .9);
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 2.5, 0, Math.PI * 2); ctx.stroke();
    }
    if (up) ctx.restore();
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
