/* Mizavo — the launch screen (logged out).
   A big MIZAVO wordmark cut out of ribbed, frosted glass, with warm copper light
   drifting slowly behind it. Built from four canvases:
     light  (offscreen) soft moving blobs of copper/charcoal light, drawn small for speed
     gGlow  the light seen through vertical glass ribs (each rib shows a squeezed slice)
     gEdges a fixed sheen on each rib's edges
     gCut   the letters: the light, brighter, shown only inside "MIZAVO", with a thin ivory rim
   The animation pauses when the screen is hidden, off-screen, or the viewer prefers reduced motion. */
import { $ } from '../lib/dom';

const BG_TOP = '#1d2021', BG_MID = '#151819', BG_BOT = '#101213';
const BLEED = 20;          // light is drawn this far past each edge so the ribs never show a gap
const LIGHT_SCALE = 0.5;   // the light canvas is half size (it's blurry anyway)
const WORD_FONT = '700 100px "DM Sans", system-ui, sans-serif';

let raf = 0, running = false, visible = true, ready = false;
let resizeObs: ResizeObserver | null = null, viewObs: IntersectionObserver | null = null;
let ribs: { x: number; w: number; k: number }[] = [];
let W = 0, H = 0, dpr = 1;
let light: HTMLCanvasElement, glowCv: HTMLCanvasElement, edgesCv: HTMLCanvasElement, cutCv: HTMLCanvasElement;
let wordMask: HTMLCanvasElement, wordRim: HTMLCanvasElement, word = { size: 0, x: 0, y: 0 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** One soft oval of light. x, y, rx, ry are fractions of the canvas size. */
function blob(g: CanvasRenderingContext2D, w: number, h: number, x: number, y: number, rx: number, ry: number, stops: [number, string][]): void {
  g.save(); g.translate(x * w, y * h); g.scale(rx * w, ry * h);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, c] of stops) grad.addColorStop(at, c);
  g.fillStyle = grad; g.fillRect(-1, -1, 2, 2); g.restore();
}

/** Paint the moving light for time t (ms). Each blob drifts on its own slow sine wave. */
function paintLight(t: number): void {
  const g = light.getContext('2d')!, w = light.width, h = light.height;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, BG_TOP); bg.addColorStop(0.5, BG_MID); bg.addColorStop(1, BG_BOT);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const s = (f: number, p = 0) => Math.sin(t * f + p);
  const c = (f: number, p = 0) => Math.cos(t * f + p);
  blob(g, w, h, 0.5 + 0.3 * s(0.00026), 0.42 + 0.14 * c(0.00034), 0.26, 0.55,   // main copper light
    [[0, '#d68a52'], [0.28, '#b76935'], [0.55, 'rgba(147,94,56,.55)'], [1, 'rgba(111,82,59,0)']]);
  blob(g, w, h, 0.24 + 0.2 * c(0.00022, 1), 0.3 + 0.12 * s(0.0003, 2), 0.22, 0.42,
    [[0, '#a56336'], [0.4, 'rgba(129,88,57,.6)'], [1, 'rgba(92,77,60,0)']]);
  blob(g, w, h, 0.8 + 0.1 * s(0.00041, 3), 0.62 + 0.14 * c(0.00027, 1), 0.17, 0.34,
    [[0, 'rgba(183,105,53,.85)'], [0.5, 'rgba(147,94,56,.35)'], [1, 'rgba(74,71,62,0)']]);
  blob(g, w, h, 0.62 + 0.2 * c(0.00019, 2), 0.2 + 0.1 * s(0.00023), 0.3, 0.32,      // charcoal shadows
    [[0, 'rgba(74,71,62,.75)'], [1, 'rgba(74,71,62,0)']]);
  blob(g, w, h, 0.12 + 0.08 * s(0.00021, 1), 0.75 + 0.08 * c(0.00025), 0.25, 0.3,
    [[0, 'rgba(56,65,63,.6)'], [1, 'rgba(56,65,63,0)']]);
}

/** The light seen through the ribs: each rib shows a slightly squeezed slice of what's behind it. */
function paintGlow(): void {
  const g = glowCv.getContext('2d')!, w = glowCv.width, h = glowCv.height;
  const k = light.width / (W + BLEED * 2);
  g.clearRect(0, 0, w, h);
  for (const r of ribs) {
    const sw = r.w / r.k * k, sx = (r.x + r.w / 2) * k - sw / 2;
    g.drawImage(light, Math.max(0, sx), 0, sw, light.height, r.x * LIGHT_SCALE, 0, r.w * LIGHT_SCALE, h);
  }
}

/** The letters: brighter light, clipped to "MIZAVO", with the rim and inner shadow on top. */
function paintCut(): void {
  const g = cutCv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  g.filter = 'saturate(1.45) brightness(1.2) contrast(1.1)';
  g.drawImage(light, -BLEED, -BLEED, W + BLEED * 2, H + BLEED * 2);
  g.filter = 'none';
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(wordMask, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(wordRim, 0, 0);
}

/** Pre-draw the word shapes once per resize: a mask, plus an inner shadow and a thin ivory rim. */
function buildWord(): void {
  const blank = () => { const c = document.createElement('canvas'); c.width = cutCv.width; c.height = cutCv.height; return c; };
  const text = (g: CanvasRenderingContext2D, dx = 0, dy = 0) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = WORD_FONT.replace('100px', word.size + 'px');
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('MIZAVO', word.x + dx, word.y + dy);
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  wordMask = blank();
  const m = wordMask.getContext('2d')!;
  m.fillStyle = '#fff'; text(m);
  // inner shadow: a black sheet with the word punched out, shadowed back into the letters
  const hole = blank(), hg = hole.getContext('2d')!;
  hg.fillStyle = '#000'; hg.fillRect(0, 0, hole.width, hole.height);
  hg.globalCompositeOperation = 'destination-out'; text(hg);
  wordRim = blank();
  const r = wordRim.getContext('2d')!;
  r.fillStyle = '#fff'; text(r);
  r.globalCompositeOperation = 'source-in';
  r.shadowColor = 'rgba(8,9,10,.7)';
  r.shadowBlur = Math.max(6, word.size * 0.06) * dpr;
  r.shadowOffsetY = Math.max(1, word.size * 0.012) * dpr;
  r.drawImage(hole, 0, 0);
  r.shadowColor = 'transparent';
  // rim: the word nudged 1px in 8 directions, minus the word itself = a thin outline
  const rim = blank(), rg = rim.getContext('2d')!;
  rg.fillStyle = 'rgba(242,232,220,.42)';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) text(rg, dx, dy);
  rg.globalCompositeOperation = 'destination-out'; rg.fillStyle = '#000'; text(rg);
  r.globalCompositeOperation = 'source-over';
  r.drawImage(rim, 0, 0);
}

function frame(t: number): void {
  paintLight(t); paintGlow(); paintCut();
  if (running && visible && !reduceMotion.matches) raf = requestAnimationFrame(frame);
}

/** Size every canvas to the screen, lay out the ribs, and fit the word. */
function measure(): void {
  const box = $('#glass');
  W = box.clientWidth; H = box.clientHeight;
  if (!W || !H) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const lw = W + BLEED * 2, lh = H + BLEED * 2;
  light.width = Math.round(lw * LIGHT_SCALE); light.height = Math.round(lh * LIGHT_SCALE);
  glowCv.width = light.width; glowCv.height = light.height;
  cutCv.width = Math.round(W * dpr); cutCv.height = Math.round(H * dpr);
  edgesCv.width = Math.round(W * dpr); edgesCv.height = Math.round(H * dpr);
  ribs = [];
  // ribs 10–18px wide; a fixed seed so they look the same on every visit
  let x = 0, seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  while (x < lw) { const w = Math.round(10 + rand() * 8); ribs.push({ x, w, k: 1.15 + rand() * 0.45 }); x += w; }
  const e = edgesCv.getContext('2d')!;
  e.setTransform(dpr, 0, 0, dpr, 0, 0); e.clearRect(0, 0, W, H);
  for (const r of ribs) {
    const rx = r.x - BLEED;
    if (rx + r.w < 0 || rx > W) continue;
    const g = e.createLinearGradient(rx, 0, rx + r.w, 0);
    g.addColorStop(0, 'rgba(242,232,220,.1)'); g.addColorStop(0.25, 'rgba(242,232,220,.02)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,.05)'); g.addColorStop(1, 'rgba(0,0,0,.16)');
    e.fillStyle = g; e.fillRect(rx, 0, r.w, H);
  }
  // the word fills 76% of the width, at most 30% of the height (and never over 320px)
  const c = cutCv.getContext('2d')!;
  c.font = WORD_FONT;
  const wAt100 = c.measureText('MIZAVO').width || 1;
  word.size = Math.round(Math.min(W * 0.76 / wAt100 * 100, H * 0.3 / 0.72, 320));
  word.x = W / 2;
  word.y = H * 0.42 + word.size * 0.36;
  buildWord();
  ready = true;
}

/** (Re)start the animation loop. With reduced motion it draws one still frame. */
function kick(): void {
  cancelAnimationFrame(raf);
  if (ready) raf = requestAnimationFrame(frame);
}

export function startLaunch(): void {
  const box = $('#glass');
  light = light || document.createElement('canvas');
  glowCv = $<HTMLCanvasElement>('#glass .gGlow');
  edgesCv = $<HTMLCanvasElement>('#glass .gEdges');
  cutCv = $<HTMLCanvasElement>('#glass .gCut');
  running = true;
  const go = () => { if (running) { measure(); kick(); } };
  document.fonts.load(WORD_FONT).then(go, go);   // wait for DM Sans so the word is measured right
  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(() => { if (running) { measure(); kick(); } });
  resizeObs.observe(box);
  viewObs?.disconnect();
  viewObs = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) kick(); });
  viewObs.observe(box);
}

export function stopLaunch(): void {
  running = false;
  cancelAnimationFrame(raf);
  resizeObs?.disconnect();
  viewObs?.disconnect();
  resizeObs = viewObs = null;
}

document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible && running) kick(); });
