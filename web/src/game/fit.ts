/* Mizavo — keep a whole round on one screen (Nov 15).
   1. The question shrinks until it fits in 2 lines (3 on phones), never below a readable size.
   2. The ball area takes whatever height is left, so the answer buttons and the hint stay above the fold.
   Long questions get smaller text and a slightly shorter ball area; short ones keep the big headline. */
import { setFitHeight } from './arena';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const phone = () => window.innerWidth < 600;

/** Shrink the question text until it fits its line budget. */
export function fitStatement(): void {
  const st = $('#statement');
  st.style.fontSize = '';                                    // start from the CSS size (the big headline)
  const lines = phone() ? 3 : 2, min = phone() ? 20 : 26;
  // short windows: the headline also scales with the window's height, so it never eats the ball area
  let size = parseFloat(getComputedStyle(st).fontSize);
  if (!phone()) { const cap = Math.max(min, Math.round(window.innerHeight * 0.068)); if (size > cap) { size = cap; st.style.fontSize = size + 'px'; } }
  const lh = () => parseFloat(getComputedStyle(st).lineHeight) || size * 1.04;
  while (size > min && st.scrollHeight > lh() * lines + 2) {
    size -= 2; st.style.fontSize = size + 'px';
  }
}

/** Height for the ball area: what's left of the screen after everything else in the round. */
function arenaHeight(): number {
  const cv = $('#cv');
  const top = cv.getBoundingClientRect().top + window.scrollY;           // where the ball area starts on the page
  const opts = $('#opts'), below = $('#below'), playAt = document.querySelector<HTMLElement>('#game .playAt');
  const optsH = opts.offsetParent ? opts.offsetHeight + 10 : 0;          // hidden on phones (the cards are the answers)
  const belowH = below.offsetParent ? below.offsetHeight + 18 : 66;      // the hint row (or room for it)
  const playH = playAt ? playAt.offsetHeight + 12 : 0;
  const left = window.innerHeight - top - optsH - belowH - playH - 12;
  const n = (document.querySelectorAll('#opts .opt').length) || 2;
  const min = phone() ? (n === 4 ? 260 : 220) : window.innerHeight < 700 ? 150 : 180;                   // smaller than this and the bins get cramped
  return Math.min(phone() ? 430 : 460, Math.max(min, left));
}

export function initFit(): void { setFitHeight(arenaHeight); }
