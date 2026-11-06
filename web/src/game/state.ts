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

export const OPT_COLORS: Record<RoundType, string[]> = {
  ff: ['#3d9be0', '#ff48b0'],
  ooo: ['#3d9be0', '#ff48b0', '#5fd39a', '#ff8c3b'],
};
export const KEYS: Record<RoundType, string[]> = { ff: ['1', '2'], ooo: ['A', 'B', 'C', 'D'] };

export const PALETTE = ['#3d9be0', '#ff48b0', '#ffe14d', '#f1ebdd', '#5fd39a', '#ff8c3b', '#7cc4ec', '#ffa3d6', '#c9a6ff', '#b8e86a'];
export function colorFor(k: string): string {
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
