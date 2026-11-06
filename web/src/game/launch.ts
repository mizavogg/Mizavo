/* Mizavo — the launch screen animation (logged out).
   Balls drop in to form the Mizavo M, which is also a balance scale
   (white frame, blue pan on the left, orange pan on the right).
   After a short hold they scatter and keep floating gently behind the page.
   All the motion is CSS (game.css: mzOut, mzFloat, mzFloor); this file only places the balls. */
import { $ } from '../lib/dom';
import { SPHERE, SLATE, COPPER } from './state';

type Tone = 'white' | 'blue' | 'orange';
interface Pt { x: number; y: number; tone: Tone }

/** The M-scale drawn as points on a 600 × 400 stage. */
function shape(): Pt[] {
  const pts: Pt[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, tone: Tone, step = 15) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let i = 0; i <= n; i++) pts.push({ x: x1 + (x2 - x1) * i / n, y: y1 + (y2 - y1) * i / n, tone });
  };
  const pan = (cx: number, cy: number, tone: Tone) => {
    for (let i = 0; i <= 8; i++) { const t = Math.PI * i / 8; pts.push({ x: cx - 48 * Math.cos(t), y: cy + 26 * Math.sin(t), tone }); }
  };
  line(120, 250, 120, 80, 'white');      // left leg
  line(135, 91, 300, 212, 'white');      // beam, left half
  line(315, 201, 480, 80, 'white');      // beam, right half
  line(480, 95, 480, 250, 'white');      // right leg
  line(300, 228, 300, 326, 'white');     // stand
  line(246, 342, 354, 342, 'white', 18); // base
  pan(120, 296, 'blue');                 // pans hang a little lower so the M reads clean
  pan(480, 296, 'orange');
  // drop points that sit on top of each other where lines meet
  const seen = new Set<string>();
  return pts.filter((p) => { const k = Math.round(p.x / 6) + ':' + Math.round(p.y / 6); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** (Re)build the balls; the CSS animation starts as soon as they're added. */
export function startLaunch(): void {
  const stage = $('#mscale');
  stage.replaceChildren();
  const k = (stage.clientWidth || 600) / 600;        // stage scales down on small screens
  let seed = 17; const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const floor = document.createElement('div'); floor.className = 'floor';
  stage.append(floor);
  for (const p of shape()) {
    const ang = Math.atan2(p.y - 200, p.x - 300) + (r() - 0.5) * 1.4;
    const dist = 220 + r() * 380, depth = r();       // depth: 0 = far back (small, faint), 1 = close
    let dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.7;
    // keep scattered balls out of the column where the headline and button sit (below the stage)
    if (Math.abs(p.x + dx - 300) < 380 && p.y + dy > 300) dy = -Math.abs(dy) - 40;
    const outer = document.createElement('span'); outer.className = 'md';
    outer.style.left = (p.x / 6) + '%'; outer.style.top = (p.y / 4) + '%';
    outer.style.setProperty('--dx', Math.round(dx * k) + 'px');
    outer.style.setProperty('--dy', Math.round(dy * k) + 'px');
    outer.style.setProperty('--z', (0.45 + depth * 0.9).toFixed(2));
    outer.style.setProperty('--o', (0.16 + depth * 0.32).toFixed(2));
    outer.style.animationDelay = (Math.hypot(p.x - 300, p.y - 200) / 1400).toFixed(2) + 's';
    const ball = document.createElement('span'); ball.className = 'mb';
    ball.style.background = SPHERE[p.tone === 'blue' ? SLATE : p.tone === 'orange' ? COPPER : '#F1F0EC'];
    ball.style.setProperty('--wx', Math.round((r() - 0.5) * 50) + 'px');
    ball.style.setProperty('--wy', Math.round((r() - 0.5) * 36) + 'px');
    outer.append(ball);
    stage.append(outer);
  }
}

export function stopLaunch(): void { $('#mscale').replaceChildren(); }
