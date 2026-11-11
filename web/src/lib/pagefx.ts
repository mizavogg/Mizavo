/* Mizavo — page transition "Pop & scatter" (chosen Nov 10, 2026).
   When you move from one Mizavo page to another, colored balls pop up in a ring around the Mizavo logo,
   then fly outward and clear the screen, revealing the new page (about 0.6 s).

   How it works:
   - A tiny script in each page's <head> adds the class `fx-in` to <html> when this page was opened by a link
     from another Mizavo page (not on a reload, the back button, Twitch login, or with reduce-motion on).
     That class covers the page in the background color before it's drawn, so there's no flash.
   - The browser's built-in page transition (theme.css, @view-transition) fades the old page into that cover.
   - This file then plays the balls and logo and fades the cover away. Nothing waits on it: the new page
     loads underneath, and clicks go straight through (pointer-events: none).
   - Silent on purpose, so it never stacks with the game's sounds. */

const COLORS = ['#7F95AD', '#B76935', '#F2E8DC', '#8FB39A', '#A99BC9', '#E7C39B'];
const LENGTH = 600; // ms

function ball(layer: HTMLElement, size: number, color: string): HTMLElement {
  const b = document.createElement('div');
  b.className = 'fxBall';
  b.style.width = b.style.height = size + 'px';
  b.style.background = `radial-gradient(circle at 34% 30%, rgba(255,255,255,.55) 0 8%, ${color} 38%, color-mix(in srgb, ${color} 55%, #000) 100%)`;
  layer.appendChild(b);
  return b;
}

function play(): void {
  const root = document.documentElement;
  const done = () => { root.classList.remove('fx-in'); layer.remove(); };

  const layer = document.createElement('div');
  layer.className = 'fxLayer';
  layer.setAttribute('aria-hidden', 'true');
  const veil = document.createElement('div');
  veil.className = 'fxVeil';
  const logo = document.createElement('img');
  logo.className = 'fxLogo'; logo.src = '/icon-192.png'; logo.alt = '';
  layer.append(veil, logo);
  document.body.appendChild(layer);
  root.classList.remove('fx-in'); // the layer's own veil takes over from the head cover

  const W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, n = 18, far = Math.hypot(W, H) * 0.65;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const jobs: Promise<unknown>[] = [];
  const opts = (delay = 0): KeyframeAnimationOptions => ({ duration: LENGTH, delay, fill: 'both' });

  jobs.push(veil.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], opts()).finished);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.12, 0.12), r = rnd(95, 140), s = rnd(16, 28);
    const b = ball(layer, s, COLORS[i % COLORS.length]);
    const at = (d: number) => `translate(${cx + Math.cos(a) * d - s / 2}px,${cy + Math.sin(a) * d - s / 2}px)`;
    jobs.push(b.animate([
      { transform: at(20) + ' scale(0)', opacity: 0, easing: 'cubic-bezier(.3,.7,.4,1)' },
      { transform: at(r) + ' scale(1.15)', opacity: 1, offset: 0.38 },
      { transform: at(r) + ' scale(1)', opacity: 1, offset: 0.55, easing: 'cubic-bezier(.5,0,.8,.4)' },
      { transform: at(far) + ' scale(.9)', opacity: 0 },
    ], opts(i * 6)).finished);
  }
  jobs.push(logo.animate([
    { opacity: 0, transform: 'scale(.5)', easing: 'cubic-bezier(.22,1,.36,1)' },
    { opacity: 1, transform: 'scale(1.08)', offset: 0.4 },
    { opacity: 1, transform: 'scale(1)', offset: 0.62 },
    { opacity: 0, transform: 'scale(1.1)' },
  ], opts()).finished);

  Promise.all(jobs).then(done, done);
  setTimeout(done, LENGTH + 600); // safety net: never leave the cover up
}

if (document.documentElement.classList.contains('fx-in')) {
  if (document.body) play();
  else document.addEventListener('DOMContentLoaded', play, { once: true });
}
