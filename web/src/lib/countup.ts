/* Mizavo — numbers that roll up to their new value (scores, points), with a small pop at the end. */
import { sfx } from './sound';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const running = new WeakMap<HTMLElement, number>();

/** Roll the number shown in `node` up (or down) to `to`. `fmt` writes it (e.g. "7 / 11", "1,240").
 *  `from` overrides the start (e.g. 0 on the final screen). Plays light ticks unless quiet is set. */
export function countTo(node: HTMLElement, to: number, opts: { fmt?: (n: number) => string; from?: number; ms?: number; quiet?: boolean } = {}): void {
  const fmt = opts.fmt ?? ((n: number) => n.toLocaleString('en-US'));
  const from = opts.from ?? (+(node.dataset.n ?? (node.textContent || '0').replace(/[^\d-]/g, '')) || 0);
  node.dataset.n = String(to);
  cancelAnimationFrame(running.get(node) ?? 0);
  if (from === to || reduced()) { node.textContent = fmt(to); return; }
  const ms = opts.ms ?? Math.min(900, 260 + Math.abs(to - from) * 90);
  const t0 = performance.now();
  let shown = from, steps = 0;
  const frame = (now: number) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    const v = Math.round(from + (to - from) * e);
    if (v !== shown) {
      shown = v; node.textContent = fmt(v);
      // tick at most ~10 times however big the jump is
      if (!opts.quiet && Math.floor(e * 10) > steps) { steps = Math.floor(e * 10); sfx.count(steps); }
    }
    if (k < 1) { running.set(node, requestAnimationFrame(frame)); return; }
    node.textContent = fmt(to);
    node.classList.remove('popNum'); void node.offsetWidth; node.classList.add('popNum');
    if (!opts.quiet) sfx.countEnd();
  };
  running.set(node, requestAnimationFrame(frame));
}
