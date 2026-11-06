/* Mizavo — game state: the one object every game module reads and updates. */

export type Mode = 'ff' | 'ooo' | 'mix';
export type RoundType = 'ff' | 'ooo';
export type Phase = 'gate' | 'setup' | 'loading' | 'vote' | 'sorting' | 'reveal' | 'final';

/** A dot on screen: one viewer's vote. */
export interface Orb {
  x: number; y: number; vx: number; vy: number; r: number;
  color: string; key: string;
  state: 'fly' | 'pool' | 'bin';
  dest?: 'pool' | number; bin?: number;
  from?: { x: number; y: number }; to?: { x: number; y: number }; ctrl?: { x: number; y: number };
  t0?: number; dur?: number; popAt?: number; dead?: boolean;
}

/** One viewer's vote in the current round (their first answer counts; no switching). */
export interface Vote {
  key: string;            // lowercase login, unique per viewer
  id: string | null;      // Twitch user id (null for simulated viewers)
  login: string; name: string; color: string;
  choice: number; bot: boolean; orb?: Orb;
}

/** The round on screen. The answer is unknown (null) until the database reveals it. */
export interface Round {
  idx: number; type: RoundType; category: string;
  statement: string; opts: string[]; colors: string[];
  answer: number | null;
  votes: Map<string, Vote>;
  pick: number | null;
  explanation?: string;
  questionId?: string;          // arrives with the reveal; used for "Report this question"
  reported?: boolean;
}

/** A viewer's running totals for this game (sent to the database at the end). */
export interface Viewer {
  id: string | null; login: string; name: string; color: string; bot: boolean;
  pts: number; streak: number; best: number; answers: number; correct: number;
}

export interface HistoryItem { round: Round; meRight: boolean; chatRight: boolean; pctRight: number; votes: number }

export const S = {
  phase: 'gate' as Phase,
  // settings for the next game
  mode: 'ff' as Mode, rounds: 10, secs: 15, blind: true, demo: true,
  // the game in progress
  session: null as string | null,
  isTest: false,
  idx: 0,                       // round number, 1-based like the database
  R: null as Round | null,
  me: 0, chat: 0,
  viewers: new Map<string, Viewer>(),
  history: [] as HistoryItem[],
  timer: 0 as number,           // interval id for the countdown
  deadline: 0,                  // when voting ends (ms)
  busy: false,                  // waiting on the database
};

/* Ink & Cream answer colors: muted blue and orange (told apart by colorblind viewers too),
   plus sage and lilac for the 3rd and 4th Odd One Out answers. */
export const OPT_COLORS: Record<RoundType, string[]> = {
  ff: ['#7C9CC4', '#C48A58'],
  ooo: ['#7C9CC4', '#C48A58', '#8FB39A', '#A99BC9'],
};
export const KEYS: Record<RoundType, string[]> = { ff: ['1', '2'], ooo: ['A', 'B', 'C', 'D'] };

/** Light, base and dark shade of each ball color: drawn as a sphere (light top-left, dark edge).
 *  White is the neutral ball (blind-mode pool, the logo). Skins can add their own entries later. */
export const SHADES: Record<string, { hi: string; base: string; lo: string; text: string }> = {
  '#7C9CC4': { hi: '#C9D7EA', base: '#7C9CC4', lo: '#3E5677', text: '#A9C0DE' },
  '#C48A58': { hi: '#EBCBAE', base: '#C48A58', lo: '#6E4526', text: '#DDAA80' },
  '#8FB39A': { hi: '#D3E3D7', base: '#8FB39A', lo: '#465E4D', text: '#B3CDBA' },
  '#A99BC9': { hi: '#DCD4EC', base: '#A99BC9', lo: '#544870', text: '#C6BCE0' },
  '#F1F0EC': { hi: '#FFFFFF', base: '#F1F0EC', lo: '#7E848F', text: '#ECE3D2' },
};
export const WHITE = '#F1F0EC';
export function shade(c: string) { return SHADES[c] || SHADES[WHITE]; }
/** The same sphere as a CSS background (for buttons and the launch screen). */
export const SPHERE: Record<string, string> = Object.fromEntries(Object.entries(SHADES).map(([c, s]) =>
  [c, `radial-gradient(circle at 35% 30%, ${s.hi} 0%, ${s.base} 45%, ${s.lo} 100%)`]));

/** Viewer name colors (labels, MVP list): soft tones that sit on the dark page. */
export const PALETTE = ['#ECE3D2', '#A9C0DE', '#DDAA80', '#B3CDBA', '#C6BCE0', '#E2CFA6', '#C9D7EA', '#EBCBAE'];
export function colorFor(k: string): string {
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
