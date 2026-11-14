/* Mizavo — the moving glass background behind the settings, game and results screens (3D ribs since Nov 11).
   The same idea as the launch screen (copper light drifting behind vertical glass ribs),
   without the MIZAVO cut-out, and dimmer (decided Nov 7) so the settings stay easy to read.
   It only moves on the settings and results screens: during a round it stops, so the stream stays calm.
   With "reduce motion" turned on it draws one still frame. */

const BLEED = 20;          // light is drawn past each edge so the ribs never show a gap
const LIGHT_SCALE = 0.4;   // the light is blurry anyway, so draw it small (fast on big screens)
const SPEED = 0.7;         // a little slower than the launch screen
const MOVING_PHASES = new Set(['setup', 'final']);

let host: HTMLElement | null = null;
let light: HTMLCanvasElement, glowCv: HTMLCanvasElement, edgesCv: HTMLCanvasElement;
let ribs: { x: number; w: number; k: number }[] = [];
let W = 0, H = 0, dpr = 1, raf = 0, ready = false;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function blob(g: CanvasRenderingContext2D, w: number, h: number, x: number, y: number, rx: number, ry: number, stops: [number, string][]): void {
  g.save(); g.translate(x * w, y * h); g.scale(rx * w, ry * h);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, c] of stops) grad.addColorStop(at, c);
  g.fillStyle = grad; g.fillRect(-1, -1, 2, 2); g.restore();
}

/** The moving light for time t (ms): the launch screen's palette, toned down. */
function paintLight(t: number): void {
  const g = light.getContext('2d')!, w = light.width, h = light.height;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#1d2021'); bg.addColorStop(0.5, '#151819'); bg.addColorStop(1, '#101213');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  t *= SPEED;
  const s = (f: number, p = 0) => Math.sin(t * f + p), c = (f: number, p = 0) => Math.cos(t * f + p);
  blob(g, w, h, 0.72 + 0.18 * s(0.00026), 0.3 + 0.16 * c(0.00034), 0.24, 0.5,       // main copper light (right side)
    [[0, 'rgba(214,138,82,.75)'], [0.35, 'rgba(183,105,53,.5)'], [0.7, 'rgba(147,94,56,.2)'], [1, 'rgba(111,82,59,0)']]);
  blob(g, w, h, 0.2 + 0.16 * c(0.00022, 1), 0.75 + 0.1 * s(0.0003, 2), 0.2, 0.38,
    [[0, 'rgba(165,99,54,.45)'], [0.5, 'rgba(129,88,57,.2)'], [1, 'rgba(92,77,60,0)']]);
  blob(g, w, h, 0.9 + 0.06 * s(0.00041, 3), 0.7 + 0.12 * c(0.00027, 1), 0.15, 0.3,
    [[0, 'rgba(183,105,53,.45)'], [1, 'rgba(74,71,62,0)']]);
  blob(g, w, h, 0.5 + 0.2 * c(0.00019, 2), 0.1 + 0.08 * s(0.00023), 0.34, 0.3,       // charcoal shadow
    [[0, 'rgba(74,71,62,.6)'], [1, 'rgba(74,71,62,0)']]);
}

/** The light seen through the ribs, the 3D glass (Nov 11): each rib is a small curved lens, so the light
 *  behind it is magnified and flipped across the rib, plus a highlight line that picks up its color. */
const STRIPS = 8;
function paintGlow(): void {
  const g = glowCv.getContext('2d')!, k = light.width / (W + BLEED * 2), lw = light.width, h = glowCv.height;
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.clearRect(0, 0, glowCv.width, h);
  for (const r of ribs) {
    const cx = r.x + r.w / 2;
    for (let i = 0; i < STRIPS; i++) {
      const u = ((i + 0.5) / STRIPS) * 2 - 1, bend = Math.sin(u * Math.PI / 2);
      const sc = cx - bend * r.w * 0.62 * r.k, sw = Math.max(0.6, (r.w / STRIPS) * (0.42 + 0.5 * Math.abs(u)));
      let sx = (sc - sw / 2) * k; sx = Math.min(Math.max(0, sx), lw - sw * k);
      g.drawImage(light, sx, 0, sw * k, light.height, (r.x + (i / STRIPS) * r.w) * LIGHT_SCALE, 0, (r.w / STRIPS) * LIGHT_SCALE + 0.6, h);
    }
  }
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.6;
  for (const r of ribs) {
    const hx = r.x + r.w * 0.24, hw = Math.max(1.2, r.w * 0.12);
    g.drawImage(light, Math.max(0, (hx - 1) * k), 0, Math.max(1, hw * k), light.height, hx * LIGHT_SCALE, 0, hw * LIGHT_SCALE, h);
  }
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}

function measure(): void {
  W = window.innerWidth; H = window.innerHeight;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const lw = W + BLEED * 2, lh = H + BLEED * 2;
  light.width = Math.round(lw * LIGHT_SCALE); light.height = Math.round(lh * LIGHT_SCALE);
  glowCv.width = light.width; glowCv.height = light.height;
  edgesCv.width = Math.round(W * dpr); edgesCv.height = Math.round(H * dpr);
  ribs = [];
  let x = 0, seed = 7;   // same rib pattern as the launch screen
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  while (x < lw) { const w = Math.round(14 + rand() * 10); ribs.push({ x, w, k: 1.15 + rand() * 0.45 }); x += w; }
  const e = edgesCv.getContext('2d')!;
  e.setTransform(dpr, 0, 0, dpr, 0, 0); e.clearRect(0, 0, W, H);
  for (const r of ribs) {
    const rx = r.x - BLEED;
    if (rx + r.w < 0 || rx > W) continue;
    // a rounded rod: dark at both edges, a soft glint near the left, deeper shade on the right, a groove between
    const g = e.createLinearGradient(rx, 0, rx + r.w, 0);
    g.addColorStop(0, 'rgba(0,0,0,.34)'); g.addColorStop(0.08, 'rgba(242,232,220,.05)'); g.addColorStop(0.2, 'rgba(242,232,220,.13)');
    g.addColorStop(0.3, 'rgba(242,232,220,.02)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(0.84, 'rgba(0,0,0,.14)'); g.addColorStop(1, 'rgba(0,0,0,.42)');
    e.fillStyle = g; e.fillRect(rx, 0, r.w, H);
    e.fillStyle = 'rgba(0,0,0,.45)'; e.fillRect(rx + r.w - 0.6, 0, 0.6, H);
  }
  ready = true;
}

const shouldMove = () => !!host && MOVING_PHASES.has(document.body.dataset.phase || '') && !document.hidden && !reduceMotion.matches;

/** The light drifts slowly, so 30 frames a second looks the same as 60 and halves the work (Nov 14). */
let lastPaint = -1e9;
function frame(t: number): void {
  if (t - lastPaint >= 32) { lastPaint = t; paintLight(t); paintGlow(); }
  if (shouldMove()) raf = requestAnimationFrame(frame);
}

/** Draw now, and keep moving only if this screen should move. */
function kick(): void {
  cancelAnimationFrame(raf);
  lastPaint = -1e9;   // always draw right away (a resize clears the canvases)
  if (!host || !ready) return;
  if (MOVING_PHASES.has(document.body.dataset.phase || '')) raf = requestAnimationFrame(frame);
}

/** Set up once: adds the canvases to the page background and follows the screen changes. */
export function initPageMotion(): void {
  host = document.querySelector<HTMLElement>('.pageGlass');
  if (!host) return;
  light = document.createElement('canvas');
  glowCv = document.createElement('canvas'); glowCv.className = 'pgGlow';
  edgesCv = document.createElement('canvas'); edgesCv.className = 'pgEdges';
  host.prepend(glowCv, edgesCv);
  host.classList.add('moving');
  measure(); kick();
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = window.setTimeout(() => { measure(); kick(); }, 150); });
  document.addEventListener('visibilitychange', kick);
  reduceMotion.addEventListener?.('change', kick);
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ['data-phase'] });
}
