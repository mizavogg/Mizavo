/* Mizavo — the launch screen (logged out).
   A big MIZAVO wordmark cut out of ribbed, frosted glass, with warm copper light
   drifting slowly behind it. Built from four canvases:
     light  (offscreen) soft moving blobs of copper/charcoal light, drawn small for speed
     gGlow  the light seen through vertical glass ribs. Each rib is a small curved lens (like a glass rod):
            across the rib the light behind it is magnified and flipped, and a highlight line picks up its color
     gEdges each rib's rounded shading (dark at both edges, a soft glint near the left) and the groove between ribs
     gCut   the letters, cut through thick glass: brighter light inside "MIZAVO", a shaded top wall, a lit
            bottom wall, a bright upper-left edge, and a soft shadow the glass casts around them
   (3D glass chosen Nov 11, 2026.)
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
let lightCut: HTMLCanvasElement;   // the light with the letters' color boost, at the light's small size
let light: HTMLCanvasElement, glowCv: HTMLCanvasElement, edgesCv: HTMLCanvasElement, cutCv: HTMLCanvasElement;
let wordMask: HTMLCanvasElement, wordRim: HTMLCanvasElement, wordShadow: HTMLCanvasElement, word = { size: 0, x: 0, y: 0 };
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

/** The light seen through the ribs. Each rib is drawn as thin strips that sample the light like a cylinder
 *  lens (magnified and flipped, bending harder near the edges), then a highlight a quarter of the way across
 *  adds back the light behind it, so the shine glows copper as the light drifts. */
const STRIPS = 8;
function paintGlow(): void {
  const g = glowCv.getContext('2d')!, w = glowCv.width, h = glowCv.height;
  const k = light.width / (W + BLEED * 2), lw = light.width;
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  for (const r of ribs) {
    const cx = r.x + r.w / 2;
    for (let i = 0; i < STRIPS; i++) {
      const u = ((i + 0.5) / STRIPS) * 2 - 1;                      // -1 left edge .. 1 right edge
      const bend = Math.sin(u * Math.PI / 2);
      const sc = cx - bend * r.w * 0.62 * r.k;                     // flipped and spread: a convex lens
      const sw = Math.max(0.6, (r.w / STRIPS) * (0.42 + 0.5 * Math.abs(u)));
      let sx = (sc - sw / 2) * k; sx = Math.min(Math.max(0, sx), lw - sw * k);
      g.drawImage(light, sx, 0, sw * k, light.height, (r.x + (i / STRIPS) * r.w) * LIGHT_SCALE, 0, (r.w / STRIPS) * LIGHT_SCALE + 0.6, h);
    }
  }
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.75;
  for (const r of ribs) {
    const hx = r.x + r.w * 0.24, hw = Math.max(1.2, r.w * 0.12);
    g.drawImage(light, Math.max(0, (hx - 1) * k), 0, Math.max(1, hw * k), light.height, hx * LIGHT_SCALE, 0, hw * LIGHT_SCALE, h);
  }
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}

/** The letters: brighter light, clipped to "MIZAVO", with the rim and inner shadow on top. */
function paintCut(): void {
  const g = cutCv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  g.drawImage(lightCut, -BLEED, -BLEED, W + BLEED * 2, H + BLEED * 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(wordMask, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.drawImage(wordShadow, 0, 0);                    // the thick glass's soft shadow around the letters
  g.globalCompositeOperation = 'source-over';
  g.drawImage(wordRim, 0, 0);
}

/** Pre-draw the word shapes once per resize: a mask, the walls of the cut, its edges, and the cast shadow. */
function buildWord(): void {
  const blank = () => { const c = document.createElement('canvas'); c.width = cutCv.width; c.height = cutCv.height; return c; };
  const text = (g: CanvasRenderingContext2D, dx = 0, dy = 0) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = WORD_FONT.replace('100px', word.size + 'px');
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('MIZAVO', word.x + dx, word.y + dy);
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  const minus = (g: CanvasRenderingContext2D, dx: number, dy: number) => {
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; text(g, dx, dy); g.globalCompositeOperation = 'source-over';
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
  r.shadowColor = 'rgba(5,6,7,.85)';
  r.shadowBlur = Math.max(6, word.size * 0.09) * dpr;
  r.shadowOffsetY = Math.max(1, word.size * 0.03) * dpr;
  r.drawImage(hole, 0, 0);
  r.shadowColor = 'transparent';
  r.globalCompositeOperation = 'source-over';
  const th = Math.max(1.5, word.size * 0.012);   // glass thickness
  const layer = (color: string, dx: number, dy: number, cutDx: number, cutDy: number, cut2?: [number, number]) => {
    const c = blank(), g = c.getContext('2d')!;
    g.fillStyle = color; text(g, dx, dy); minus(g, cutDx, cutDy); if (cut2) minus(g, cut2[0], cut2[1]);
    r.drawImage(c, 0, 0);
  };
  layer('rgba(245,239,230,.75)', 0, 0, 0, -th, [-th * 0.4, -th * 0.4]);  // bottom wall of the cut catches light
  layer('rgba(0,0,0,.55)', 0, 0, 0, th * 1.2);                           // top wall in shade
  layer('rgba(245,239,230,.6)', -0.9, -0.9, 0, 0);                        // glass edge: bright upper-left
  layer('rgba(245,239,230,.14)', 0.9, 0.9, 0, 0);                         // and dim lower-right
  wordShadow = blank();
  const sg = wordShadow.getContext('2d')!;
  sg.shadowColor = 'rgba(0,0,0,.55)'; sg.shadowBlur = word.size * 0.08 * dpr; sg.shadowOffsetY = word.size * 0.025 * dpr;
  sg.fillStyle = '#000'; text(sg); minus(sg, 0, 0);
}

/** The letters' brighter light: the color boost runs on the small light image (it's blurry anyway), not the
    full-size canvas, which is about 16x less work per frame on a phone (Nov 14). */
function paintLightCut(): void {
  const g = lightCut.getContext('2d')!;
  g.clearRect(0, 0, lightCut.width, lightCut.height);
  g.filter = 'saturate(1.45) brightness(1.2) contrast(1.1)';
  g.drawImage(light, 0, 0);
  g.filter = 'none';
}

/** The light drifts slowly, so 30 frames a second looks the same as 60 and halves the work (Nov 14). */
let lastPaint = -1e9;
function frame(t: number): void {
  if (t - lastPaint >= 32) { lastPaint = t; paintLight(t); paintLightCut(); paintGlow(); paintCut(); }
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
  lightCut = lightCut || document.createElement('canvas');
  lightCut.width = light.width; lightCut.height = light.height;
  glowCv.width = light.width; glowCv.height = light.height;
  cutCv.width = Math.round(W * dpr); cutCv.height = Math.round(H * dpr);
  edgesCv.width = Math.round(W * dpr); edgesCv.height = Math.round(H * dpr);
  ribs = [];
  // ribs 14–24px wide (wide enough for the curve to show); a fixed seed so they look the same on every visit
  let x = 0, seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  while (x < lw) { const w = Math.round(14 + rand() * 10); ribs.push({ x, w, k: 1.15 + rand() * 0.45 }); x += w; }
  const e = edgesCv.getContext('2d')!;
  e.setTransform(dpr, 0, 0, dpr, 0, 0); e.clearRect(0, 0, W, H);
  for (const r of ribs) {
    const rx = r.x - BLEED;
    if (rx + r.w < 0 || rx > W) continue;
    // a rounded rod: dark at both edges, a soft glint near the left, deeper shade on the right
    const g = e.createLinearGradient(rx, 0, rx + r.w, 0);
    g.addColorStop(0, 'rgba(0,0,0,.34)'); g.addColorStop(0.08, 'rgba(242,232,220,.05)'); g.addColorStop(0.2, 'rgba(242,232,220,.13)');
    g.addColorStop(0.3, 'rgba(242,232,220,.02)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(0.84, 'rgba(0,0,0,.14)'); g.addColorStop(1, 'rgba(0,0,0,.42)');
    e.fillStyle = g; e.fillRect(rx, 0, r.w, H);
    e.fillStyle = 'rgba(0,0,0,.45)'; e.fillRect(rx + r.w - 0.6, 0, 0.6, H);   // the fine groove between ribs
  }
  // light falls off toward the top and bottom of the pane
  const v = e.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(0,0,0,.18)'); v.addColorStop(0.35, 'rgba(0,0,0,0)'); v.addColorStop(0.75, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.22)');
  e.fillStyle = v; e.fillRect(0, 0, W, H);
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
  lastPaint = -1e9;   // always draw right away (a resize clears the canvases)
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
