/* Mizavo — the logged-out preview: simulated votes pour into FACT / FAKE on a loop,
   behind the "Log in with Twitch to play" panel. No real questions are loaded here. */
import { S, OPT_COLORS } from './state';
import { layout, popWrong, resetArena } from './arena';
import { clearBots, makeBots, scheduleBots } from './demo';

let timers: number[] = [];

function cycle(): void {
  if (S.phase !== 'gate') return;
  resetArena();
  S.R = { idx: 0, type: 'ff', category: '', statement: '', opts: ['FACT', 'FAKE'], colors: OPT_COLORS.ff, answer: null, votes: new Map(), pick: null };
  layout();
  scheduleBots(5000);
  timers.push(window.setTimeout(() => { if (S.phase === 'gate') popWrong(Math.random() < 0.5 ? 0 : 1); }, 6200));
  timers.push(window.setTimeout(cycle, 8600));
}

export function startAttract(): void {
  stopAttract();
  makeBots();
  cycle();
}
export function stopAttract(): void {
  timers.forEach(clearTimeout); timers = [];
  clearBots(); resetArena();
}
