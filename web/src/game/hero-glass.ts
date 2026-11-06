/* Mizavo — frosted glass hero on the launch screen (logged out). TEST DESIGN.
   A copper and teal glow moves slowly behind a panel of ribbed, frosted glass,
   and the name MIZAVO is cut out of the glass, so the clear glow is what spells it.

   Layers inside #glass, bottom to top:
     .gGlow   the glow seen through the glass: drawn in strips (one per rib, slightly
              magnified, like reeded glass) and blurred with CSS (the frost)
     .gEdges  the light edge and shadow edge of each rib (drawn once per resize)
     .gGrain  fine noise (CSS), the sandblasted texture
     .gShade  a light frost wash + darker top and bottom so the header and text stay readable (CSS)
     .gCut    the clear glow, kept only inside the MIZAVO letters
   The old M-scale launch animation is still in launch.ts; main.ts just doesn't call it on this branch. */
import { $ } from '../lib/dom';

/* palette: copper family over a neutral charcoal (no blue base) */
const TOP = '#1d2021', MID = '#151819', DEEP = '#101213';
const BLEED = 20;            // the blurred layer reaches past the panel edge so the blur doesn't fade at the sides
const SCENE_SCALE = 0.5;     // the glow is soft, so it's drawn at half size and scaled up
const FONT = '700 100px "DM Sans", system-ui, sans-serif';

interface Rib { x: number; w: number; k: number }

let raf = 0, running = false, visible = true, built = false;
let ro: ResizeObserver | null = null, io: IntersectionObserver | null = null;
let ribs: Rib[] = [];
let W = 0, H = 0, dpr = 1;
let scene: HTMLCanvasElement, glow: HTMLCanvasElement, edges: HTMLCanvasElement, cut: HTMLCanvasElement;
let mask: HTMLCanvasElement, rim: HTMLCanvasElement;
let word = { size: 0, x: 0, y: 0 };
const still = matchMedia('(prefers-reduced-motion: reduce)');

/** One soft oval of light. cx, cy, rx, ry are fractions of the scene size. */
function blob(c: CanvasRenderingContext2D, sw: number, sh: number, cx: number, cy: number, rx: number, ry: number, stops: [number, string][]): void {
  c.save();
  c.translate(cx * sw, cy * sh);
  c.scale(rx * sw, ry * sh);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(-1, -1, 2, 2);
  c.restore();
}

/** The glow behind the glass at time t (ms). */
function drawScene(t: number): void {
  const c = scene.getContext('2d')!, sw = scene.width, sh = scene.height;
  const bg = c.createLinearGradient(0, 0, 0, sh);
  bg.addColorStop(0, TOP); bg.addColorStop(0.5, MID); bg.addColorStop(1, DEEP);
  c.fillStyle = bg; c.fillRect(0, 0, sw, sh);
  const s = (f: number, p = 0) => Math.sin(t * f + p), k = (f: number, p = 0) => Math.cos(t * f + p);
  // big copper light, drifting across the middle (where the name sits)
  blob(c, sw, sh, 0.5 + 0.3 * s(0.00026), 0.42 + 0.14 * k(0.00034), 0.26, 0.55,
    [[0, '#d68a52'], [0.28, '#b76935'], [0.55, 'rgba(147,94,56,.55)'], [1, 'rgba(111,82,59,0)']]);
  // cinnamon light, upper left
  blob(c, sw, sh, 0.24 + 0.2 * k(0.00022, 1), 0.3 + 0.12 * s(0.0003, 2), 0.22, 0.42,
    [[0, '#a56336'], [0.4, 'rgba(129,88,57,.6)'], [1, 'rgba(92,77,60,0)']]);
  // smaller toffee light, right side
  blob(c, sw, sh, 0.8 + 0.1 * s(0.00041, 3), 0.62 + 0.14 * k(0.00027, 1), 0.17, 0.34,
    [[0, 'rgba(183,105,53,.85)'], [0.5, 'rgba(147,94,56,.35)'], [1, 'rgba(74,71,62,0)']]);
  // charcoal-brown and iron-grey haze for depth, so the dark parts aren't flat
  blob(c, sw, sh, 0.62 + 0.2 * k(0.00019, 2), 0.2 + 0.1 * s(0.00023), 0.3, 0.32,
    [[0, 'rgba(74,71,62,.75)'], [1, 'rgba(74,71,62,0)']]);
  blob(c, sw, sh, 0.12 + 0.08 * s(0.00021, 1), 0.75 + 0.08 * k(0.00025), 0.25, 0.3,
    [[0, 'rgba(56,65,63,.6)'], [1, 'rgba(56,65,63,0)']]);
}

/** Glass: each rib shows a magnified slice of the glow. CSS blurs the canvas (frost). */
function drawGlass(): void {
  const c = glow.getContext('2d')!, gw = glow.width, gh = glow.height;
  const sx = scene.width / (W + BLEED * 2);
  c.clearRect(0, 0, gw, gh);
  for (const r of ribs) {
    const srcW = (r.w / r.k) * sx, srcX = (r.x + r.w / 2) * sx - srcW / 2;
    c.drawImage(scene, Math.max(0, srcX), 0, srcW, scene.height, r.x * SCENE_SCALE, 0, r.w * SCENE_SCALE, gh);
  }
}

/** The clear glow, kept only inside the letters, plus a thin cut edge. */
function drawCut(): void {
  const c = cut.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, W, H);
  // the scene canvas includes the bleed, so line it up with the panel.
  // No frost here, so the light comes through clearer, richer and brighter than through the glass.
  c.filter = 'saturate(1.45) brightness(1.2) contrast(1.1)';
  c.drawImage(scene, -BLEED, -BLEED, W + BLEED * 2, H + BLEED * 2);
  c.filter = 'none';
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(mask, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.drawImage(rim, 0, 0);
}

/** Static pieces of the cut-out, made once per resize (device pixels):
    mask = the letters; rim = a soft shadow just inside each letter + a thin light line where the glass was cut.
    Built from filled shapes, not outlines, so letters with overlapping parts (like the A) stay clean. */
function buildLetters(): void {
  const make = () => { const n = document.createElement('canvas'); n.width = cut.width; n.height = cut.height; return n; };
  const text = (c: CanvasRenderingContext2D, dx = 0, dy = 0) => {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.font = FONT.replace('100px', word.size + 'px');
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText('MIZAVO', word.x + dx, word.y + dy);
    c.setTransform(1, 0, 0, 1, 0, 0);
  };
  mask = make(); const mc = mask.getContext('2d')!; mc.fillStyle = '#fff'; text(mc);

  // everything except the letters
  const inv = make(), ic = inv.getContext('2d')!;
  ic.fillStyle = '#000'; ic.fillRect(0, 0, inv.width, inv.height);
  ic.globalCompositeOperation = 'destination-out'; text(ic);

  rim = make(); const rc = rim.getContext('2d')!;
  // inner shadow: the "everything else" shape casts a shadow into the letters, and only the shadow is kept
  rc.fillStyle = '#fff'; text(rc);
  rc.globalCompositeOperation = 'source-in';
  rc.shadowColor = 'rgba(8,9,10,.7)';
  rc.shadowBlur = Math.max(6, word.size * 0.06) * dpr;
  rc.shadowOffsetY = Math.max(1, word.size * 0.012) * dpr;
  rc.drawImage(inv, 0, 0);
  rc.shadowColor = 'transparent';

  // thin light line hugging the outside of each letter
  const ring = make(), gc = ring.getContext('2d')!;
  gc.fillStyle = 'rgba(242,232,220,.42)';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]]) text(gc, dx, dy);
  gc.globalCompositeOperation = 'destination-out'; gc.fillStyle = '#000'; text(gc);
  rc.globalCompositeOperation = 'source-over';
  rc.drawImage(ring, 0, 0);
}

function frame(t: number): void {
  drawScene(t); drawGlass(); drawCut();
  if (running && visible && !still.matches) raf = requestAnimationFrame(frame);
}

/** Size everything to the panel: ribs, canvases, and the name. */
function build(): void {
  const box = $('#glass');
  W = box.clientWidth; H = box.clientHeight;
  if (!W || !H) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const fullW = W + BLEED * 2, fullH = H + BLEED * 2;

  scene.width = Math.round(fullW * SCENE_SCALE); scene.height = Math.round(fullH * SCENE_SCALE);
  glow.width = scene.width; glow.height = scene.height;
  cut.width = Math.round(W * dpr); cut.height = Math.round(H * dpr);
  edges.width = Math.round(W * dpr); edges.height = Math.round(H * dpr);

  // ribs of slightly different widths, same pattern every load
  ribs = []; let x = 0, seed = 7;
  const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  while (x < fullW) { const w = Math.round(10 + r() * 8); ribs.push({ x, w, k: 1.15 + r() * 0.45 }); x += w; }

  // rib edges: light on the left, shadow on the right
  const e = edges.getContext('2d')!;
  e.setTransform(dpr, 0, 0, dpr, 0, 0); e.clearRect(0, 0, W, H);
  for (const rb of ribs) {
    const lx = rb.x - BLEED; if (lx + rb.w < 0 || lx > W) continue;
    const g = e.createLinearGradient(lx, 0, lx + rb.w, 0);
    g.addColorStop(0, 'rgba(242,232,220,.1)'); g.addColorStop(0.25, 'rgba(242,232,220,.02)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,.05)'); g.addColorStop(1, 'rgba(0,0,0,.16)');
    e.fillStyle = g; e.fillRect(lx, 0, rb.w, H);
  }

  // the name: up to 76% of the width, never taller than ~30% of the hero, and at most 320px
  const m = cut.getContext('2d')!; m.font = FONT;
  const at100 = m.measureText('MIZAVO').width || 1;
  word.size = Math.round(Math.min((W * 0.76) / at100 * 100, H * 0.3 / 0.72, 320));
  word.x = W / 2;
  word.y = H * 0.42 + word.size * 0.36;   // cap height of DM Sans is ~0.7em, so this centers it around 42%
  buildLetters();
  built = true;
}

function play(): void {
  cancelAnimationFrame(raf);
  if (!built) return;
  raf = requestAnimationFrame(frame);
}

export function startGlass(): void {
  const box = $('#glass');
  scene = scene || document.createElement('canvas');
  glow = $<HTMLCanvasElement>('#glass .gGlow');
  edges = $<HTMLCanvasElement>('#glass .gEdges');
  cut = $<HTMLCanvasElement>('#glass .gCut');
  running = true;
  const go = () => { if (!running) return; build(); play(); };
  // wait for DM Sans, otherwise the cut-out letters are drawn in a fallback font
  document.fonts.load(FONT).then(go, go);
  ro?.disconnect(); ro = new ResizeObserver(() => { if (running) { build(); play(); } }); ro.observe(box);
  io?.disconnect(); io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) play(); }); io.observe(box);
}

export function stopGlass(): void {
  running = false; cancelAnimationFrame(raf);
  ro?.disconnect(); io?.disconnect(); ro = io = null;
}

document.addEventListener('visibilitychange', () => {
  visible = !document.hidden;
  if (visible && running) play();
});
