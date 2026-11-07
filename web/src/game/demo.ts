/* Mizavo — simulated chat: fake viewers for testing and practice.
   Games played with simulated chat are saved as test games, so fake votes never reach real stats.
   The bots don't know the answer (the page doesn't either until the reveal); each round they
   lean toward one random option, like a real chat that talks itself into something. */
import { clamp, rnd, shuffle } from '../lib/dom';
import { S, colorFor, KEYS } from './state';
import { onChat } from './chat';

const ADJ = ['pixel', 'turbo', 'sleepy', 'cosmic', 'lowkey', 'salty', 'spicy', 'frosty', 'chaotic', 'silent', 'mega', 'lucky', 'sneaky', 'fuzzy', 'hyper', 'retro', 'neon', 'tiny', 'grumpy', 'golden'];
const NOUN = ['panda', 'llama', 'goblin', 'wizard', 'taco', 'owl', 'gecko', 'ninja', 'waffle', 'otter', 'koala', 'yeti', 'muffin', 'comet', 'badger', 'noodle', 'raven', 'pickle', 'falcon', 'mochi'];

interface Bot { name: string; color: string; lean: number }
let bots: Bot[] = [];
let timers: number[] = [];

export function makeBots(): void {
  const names = new Set<string>();
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  while (names.size < 110) names.add(pick(ADJ) + (Math.random() < .5 ? '_' : '') + pick(NOUN) + (Math.random() < .4 ? Math.floor(Math.random() * 99) : ''));
  bots = [...names].map((n) => ({ name: n, color: colorFor(n), lean: rnd(-.15, .15) }));
}
export function clearBots(): void { timers.forEach(clearTimeout); timers = []; }

/** Schedule this round's simulated votes over `ms` milliseconds. */
export function scheduleBots(ms: number): void {
  clearBots();
  const R = S.R; if (!R || !bots.length) return;
  const n = 35 + Math.floor(Math.random() * 60);
  const nOpts = R.opts.length;
  const favourite = Math.floor(Math.random() * nOpts);
  const strength = rnd(0.3, 0.92);   // how strongly chat leans toward its favourite this round
  const keys = KEYS[R.type].map((k) => k.toLowerCase());
  const alt = R.type === 'ff' ? ['fact', 'fake'] : ['A', 'B', 'C', 'D'];
  shuffle(bots).slice(0, n).forEach((b) => {
    const choose = () => {
      if (Math.random() < clamp(strength + b.lean, 0.05, 0.97)) return favourite;
      let c; do { c = Math.floor(Math.random() * nOpts); } while (c === favourite && nOpts > 1);
      return c;
    };
    const send = () => { const c = choose(); onChat({ id: null, login: b.name, name: b.name, color: b.color, text: Math.random() < .3 ? alt[c] : keys[c], bot: true }); };
    timers.push(window.setTimeout(send, ms * Math.pow(Math.random(), 1.4) * 0.9 + 200));
    if (Math.random() < 0.1) timers.push(window.setTimeout(send, ms * rnd(0.6, 0.95)));
  });
}
