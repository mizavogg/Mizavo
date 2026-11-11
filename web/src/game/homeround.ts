/* Mizavo — the homepage's example round (logged-out launch screen), and its glass panels.
   On a loop: chat votes fly in and tumble into the Fact / Fake bins, the timer runs down, then the wrong pile
   pops and the right pile bounces. The motion is the game's own (arena.ts): curved flights, gravity, collisions,
   ball size shrinking as a bin fills, 7 fragments per popped ball. Runs only while it's on screen; with reduced
   motion it shows one settled round. Also starts the ribbed glass behind the round card and the daily panel. */
import { ribbedGlass } from '../lib/ribbed';

type Orb = { x: number; y: number; vx: number; vy: number; r: number; bin: number; state: 'fly' | 'bin';
  from?: { x: number; y: number }; to?: { x: number; y: number }; ctrl?: { x: number; y: number }; t0?: number; dur?: number; popAt?: number; dead?: boolean };
type Part = { x: number; y: number; vx: number; vy: number; life: number; color: string; r: number };

const COLORS = ['#7F95AD', '#B76935'], DARK = ['#3d4a58', '#5b3218'];
const VOTES = [46, 27], ANSWER = 0;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function startRound(): void {
  const card = document.querySelector<HTMLElement>('#homeRound .rIn');
  const cv = document.querySelector<HTMLCanvasElement>('#homeRound .balls');
  if (!card || !cv) return;
  const ctx = cv.getContext('2d')!;
  const piles = [0, 1].map((i) => document.getElementById('hrPile' + i)!);
  const binEls = [0, 1].map((i) => document.getElementById('hrBin' + i)!);
  const nEls = [0, 1].map((i) => document.getElementById('hrN' + i)!);
  const timerEl = document.getElementById('hrTimer')!, chatEl = document.getElementById('hrChat')!;
  let W = 0, H = 0, dpr = 1, bins: { x: number; y: number; w: number; h: number }[] = [];
  let orbs: Orb[] = [], parts: Part[] = [], counts = [0, 0], timers: number[] = [], raf = 0, running = false;
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };

  function measure(): void {
    const cr = card!.getBoundingClientRect(); W = cr.width; H = cr.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    cv!.width = Math.round(W * dpr); cv!.height = Math.round(H * dpr);
    bins = piles.map((p) => { const r = p.getBoundingClientRect(); return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }; });
  }
  function spawn(bin: number): void {
    const b = bins[bin], to = { x: rnd(b.x + 14, b.x + b.w - 14), y: b.y + 6 }, from = { x: W / 2 + rnd(-30, 30), y: -12 };
    orbs.push({ x: from.x, y: from.y, vx: 0, vy: 0, r: 9, bin, state: 'fly', from, to,
      ctrl: { x: (from.x + to.x) / 2 + rnd(-60, 60), y: Math.min(from.y, to.y) - rnd(40, 110) }, t0: performance.now(), dur: rnd(450, 700) });
  }
  function step(now: number): void {
    for (const o of orbs) {
      if (o.state !== 'fly' || !o.from || !o.to || !o.ctrl || o.t0 == null || !o.dur) continue;
      const t = (now - o.t0) / o.dur; if (t < 0) continue;
      if (t >= 1) { o.x = o.to.x; o.y = o.to.y; o.state = 'bin'; o.vx = rnd(-1, 1); o.vy = 2; counts[o.bin]++; nEls[o.bin].textContent = String(counts[o.bin]); continue; }
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, u = 1 - e;
      o.x = u * u * o.from.x + 2 * u * e * o.ctrl.x + e * e * o.to.x;
      o.y = u * u * o.from.y + 2 * u * e * o.ctrl.y + e * e * o.to.y;
    }
    for (let c = 0; c < 2; c++) {
      const rect = bins[c], list = orbs.filter((o) => o.state === 'bin' && o.bin === c); if (!rect || !list.length) continue;
      const tr = clamp(Math.sqrt(rect.w * rect.h * 0.42 / (Math.PI * Math.max(1, list.length))), 3.5, 20);
      for (const o of list) {
        o.r += (tr - o.r) * 0.08; o.vy += 0.35; o.vx *= 0.99; o.vy *= 0.995; o.x += o.vx; o.y += o.vy;
        if (o.x < rect.x + o.r + 3) { o.x = rect.x + o.r + 3; o.vx = Math.abs(o.vx) * 0.4; }
        if (o.x > rect.x + rect.w - o.r - 3) { o.x = rect.x + rect.w - o.r - 3; o.vx = -Math.abs(o.vx) * 0.4; }
        if (o.y > rect.y + rect.h - o.r - 3) { o.y = rect.y + rect.h - o.r - 3; o.vy = -Math.abs(o.vy) * 0.25; o.vx *= 0.92; }
      }
      for (let it = 0; it < 2; it++) for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j], dx = b.x - a.x, dy = b.y - a.y, m = a.r + b.r, d2 = dx * dx + dy * dy;
          if (d2 >= m * m || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (m - d) / 2;
          a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) { const imp = vn * 0.45; a.vx += nx * imp; a.vy += ny * imp; b.vx -= nx * imp; b.vy -= ny * imp; }
        }
      }
    }
    for (const o of orbs) if (o.popAt && now >= o.popAt && !o.dead) {
      o.dead = true;
      for (let k = 0; k < 7; k++) { const a = rnd(0, Math.PI * 2), s = rnd(1.5, 4.5); parts.push({ x: o.x, y: o.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 1, color: COLORS[o.bin], r: rnd(1.5, 3) }); }
    }
    orbs = orbs.filter((o) => !o.dead);
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.025; }
    parts = parts.filter((p) => p.life > 0);
  }
  function draw(): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (const o of orbs) {
      const g = ctx.createRadialGradient(o.x - o.r * 0.32, o.y - o.r * 0.4, o.r * 0.05, o.x, o.y, o.r);
      g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(0.18, COLORS[o.bin]); g.addColorStop(1, DARK[o.bin]);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    }
    for (const p of parts) { ctx.globalAlpha = Math.max(0, p.life); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function loop(now: number): void { step(now); draw(); if (running) raf = requestAnimationFrame(loop); }
  function reset(): void {
    timers.forEach(clearTimeout); timers = []; orbs = []; parts = []; counts = [0, 0];
    nEls.forEach((n) => (n.textContent = '0')); binEls.forEach((b) => b.classList.remove('right', 'wrong'));
    chatEl.textContent = '1'; timerEl.textContent = '30'; timerEl.classList.remove('low'); measure();
  }
  function play(): void {
    reset();
    const order: number[] = []; VOTES.forEach((v, i) => { for (let k = 0; k < v; k++) order.push(i); }); order.sort(() => Math.random() - 0.5);
    order.forEach((bin, i) => later(() => spawn(bin), 200 + Math.pow(i / order.length, 1.6) * 4800));
    for (let s = 29; s >= 0; s--) later(() => { timerEl.textContent = String(s); timerEl.classList.toggle('low', s <= 5); }, (30 - s) * 190);
    later(() => {
      const now = performance.now();
      for (const o of orbs) { if (o.bin !== ANSWER) o.popAt = now + 350 + Math.random() * 900; else { o.vy = -rnd(4, 10); o.vx += rnd(-2, 2); } }
      binEls[ANSWER].classList.add('right'); binEls[1 - ANSWER].classList.add('wrong');
      later(() => { for (const o of orbs) if (o.bin === ANSWER) o.vy = -rnd(3, 8); chatEl.textContent = '2'; }, 900);
    }, 6000);
    later(play, 10500);
  }
  function still(): void {   // reduced motion: one settled round, no movement
    reset(); timerEl.textContent = '18';
    VOTES.forEach((v, c) => { nEls[c].textContent = String(v); const b = bins[c]; for (let k = 0; k < v; k++) orbs.push({ x: rnd(b.x + 14, b.x + b.w - 14), y: rnd(b.y, b.y + b.h), vx: 0, vy: 0, r: 9, bin: c, state: 'bin' }); });
    for (let i = 0; i < 500; i++) step(performance.now());
    draw();
  }
  function start(): void { if (reduce.matches) { still(); return; } if (running) return; running = true; play(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
  function stop(): void { running = false; timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf); }
  new IntersectionObserver(([en]) => { if (en.isIntersecting && !document.hidden) start(); else stop(); }, { threshold: 0.25 }).observe(card);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  new ResizeObserver(() => { if (running) measure(); else if (reduce.matches && card!.offsetWidth) still(); }).observe(card);
}

function startPanels(): void {
  const round = document.getElementById('homeRound'), daily = document.getElementById('homeDaily');
  if (round) ribbedGlass(round, round.querySelector('.rGlow')!, round.querySelector('.rEdges')!, 5, (blob, _w, _h, s, c) => {
    blob(0.3 + 0.2 * s(0.00019), 0.5 + 0.25 * c(0.00025), 0.3, 0.75, [[0, '#d68a52'], [0.3, '#b76935'], [0.6, 'rgba(147,94,56,.5)'], [1, 'rgba(111,82,59,0)']]);
    blob(0.78 + 0.12 * c(0.00017, 1), 0.4 + 0.2 * s(0.00021, 2), 0.24, 0.6, [[0, '#8a6a52'], [0.45, 'rgba(110,98,84,.5)'], [1, 'rgba(92,77,60,0)']]);
  });
  if (daily) ribbedGlass(daily, daily.querySelector('.rGlow')!, daily.querySelector('.rEdges')!, 11, (blob, _w, _h, s, c) => {
    blob(0.75 + 0.15 * s(0.0002), 0.45 + 0.2 * c(0.00026), 0.28, 0.7, [[0, '#d68a52'], [0.3, '#b76935'], [0.6, 'rgba(147,94,56,.5)'], [1, 'rgba(111,82,59,0)']]);
    blob(0.3 + 0.15 * c(0.00018, 1), 0.6 + 0.15 * s(0.00022, 2), 0.22, 0.6, [[0, '#a56336'], [0.45, 'rgba(129,88,57,.55)'], [1, 'rgba(92,77,60,0)']]);
  });
}

export function startHome(): void { startPanels(); startRound(); }
