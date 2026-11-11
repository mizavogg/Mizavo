/* Mizavo — a window of moving ribbed glass (the hero's 3D glass, without the letters).
   Used behind the homepage round card, the daily challenge panel, the settings screen and the game screen.
   Two canvases inside `box`: glow (the light seen through lens-shaped ribs) and edges (each rib's rounded shading).
   It pauses when off screen, when the tab is hidden, or (one still frame) when the viewer prefers reduced motion. */

export type Painter = (blob: Blob, w: number, h: number, sin: Wave, cos: Wave) => void;
type Wave = (f: number, p?: number) => number;
type Blob = (x: number, y: number, rx: number, ry: number, stops: [number, string][]) => void;

const BLEED = 20, LIGHT_SCALE = 0.5, STRIPS = 8;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

export function ribbedGlass(box: HTMLElement, glowCv: HTMLCanvasElement, edgesCv: HTMLCanvasElement, seed0: number, paint: Painter): void {
  const light = document.createElement('canvas');
  let ribs: { x: number; w: number; k: number }[] = [], W = 0, H = 0, dpr = 1, raf = 0, visible = true;

  function paintLight(t: number): void {
    const g = light.getContext('2d')!, w = light.width, h = light.height;
    g.fillStyle = '#151819'; g.fillRect(0, 0, w, h);
    const blob: Blob = (x, y, rx, ry, stops) => {
      g.save(); g.translate(x * w, y * h); g.scale(rx * w, ry * h);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const [at, c] of stops) grad.addColorStop(at, c);
      g.fillStyle = grad; g.fillRect(-1, -1, 2, 2); g.restore();
    };
    paint(blob, w, h, (f, p = 0) => Math.sin(t * f + p), (f, p = 0) => Math.cos(t * f + p));
  }
  function paintGlow(): void {
    const g = glowCv.getContext('2d')!, h = glowCv.height, k = light.width / (W + BLEED * 2), lw = light.width;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, glowCv.width, h);
    for (const r of ribs) {
      const cx = r.x + r.w / 2;
      for (let i = 0; i < STRIPS; i++) {
        const u = ((i + 0.5) / STRIPS) * 2 - 1, bend = Math.sin(u * Math.PI / 2);
        const sc = cx - bend * r.w * 0.62 * r.k, sw = Math.max(0.6, (r.w / STRIPS) * (0.42 + 0.5 * Math.abs(u)));
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
  function paintEdges(): void {
    const e = edgesCv.getContext('2d')!;
    e.setTransform(dpr, 0, 0, dpr, 0, 0); e.clearRect(0, 0, W, H);
    for (const r of ribs) {
      const rx = r.x - BLEED; if (rx + r.w < 0 || rx > W) continue;
      const g = e.createLinearGradient(rx, 0, rx + r.w, 0);
      g.addColorStop(0, 'rgba(0,0,0,.34)'); g.addColorStop(0.08, 'rgba(242,232,220,.05)'); g.addColorStop(0.2, 'rgba(242,232,220,.13)');
      g.addColorStop(0.3, 'rgba(242,232,220,.02)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(0.84, 'rgba(0,0,0,.14)'); g.addColorStop(1, 'rgba(0,0,0,.42)');
      e.fillStyle = g; e.fillRect(rx, 0, r.w, H);
      e.fillStyle = 'rgba(0,0,0,.45)'; e.fillRect(rx + r.w - 0.6, 0, 0.6, H);
    }
  }
  function measure(): boolean {
    W = box.clientWidth; H = box.clientHeight; if (!W || !H) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const lw = W + BLEED * 2, lh = H + BLEED * 2;
    light.width = Math.round(lw * LIGHT_SCALE); light.height = Math.round(lh * LIGHT_SCALE);
    glowCv.width = light.width; glowCv.height = light.height;
    edgesCv.width = Math.round(W * dpr); edgesCv.height = Math.round(H * dpr);
    ribs = []; let x = 0, seed = seed0;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    while (x < lw) { const w = Math.round(14 + rand() * 10); ribs.push({ x, w, k: 1.15 + rand() * 0.45 }); x += w; }
    paintEdges();
    return true;
  }
  function frame(t: number): void {
    paintLight(t); paintGlow();
    if (visible && !document.hidden && !reduce.matches) raf = requestAnimationFrame(frame);
  }
  const go = () => { cancelAnimationFrame(raf); if (measure()) raf = requestAnimationFrame(frame); };
  new ResizeObserver(go).observe(box);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) go(); }).observe(box);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) go(); });
}

/** The usual warm light: a big copper glow that drifts, a darker bronze one, and a hint of blue. */
export const warmLight: Painter = (blob, _w, _h, s, c) => {
  blob(0.5 + 0.32 * s(0.00016), 0.55 + 0.2 * c(0.00022), 0.3, 0.6, [[0, '#d68a52'], [0.3, '#b76935'], [0.6, 'rgba(147,94,56,.5)'], [1, 'rgba(111,82,59,0)']]);
  blob(0.2 + 0.12 * c(0.00014, 1), 0.3 + 0.15 * s(0.0002, 2), 0.2, 0.45, [[0, '#7a5a42'], [0.45, 'rgba(110,90,70,.5)'], [1, 'rgba(92,77,60,0)']]);
  blob(0.85 + 0.1 * c(0.00018, 3), 0.25 + 0.12 * s(0.00019, 1), 0.18, 0.4, [[0, 'rgba(127,149,173,.45)'], [1, 'rgba(127,149,173,0)']]);
};
