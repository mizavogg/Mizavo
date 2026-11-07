/* Mizavo — leaderboard data + rows, shared by the game, the today board and channel pages.
   Every public call returns totals only: never questions, answers or a game in progress. */
import { el } from './dom';
import { rpc } from './supabase';

export interface GameRecord { games: number; wins: number; losses: number; ties: number }
export interface ViewerRow { rank: number; name: string; points: number; accuracy: number | null; best_streak: number; games: number }
export interface ChannelRow { rank: number; login: string; name: string; chat_pct: number; rounds: number; wins: number; losses: number; ties: number }
export interface PlayerRow { rank: number; name: string; points: number; accuracy: number | null; channels: number; games: number }
export interface Today { day: string; min_rounds: number; board: ChannelRow[] }
export type ChannelPage =
  | { status: 'ok'; login: string; name: string; record: GameRecord; today_rank: number | null; total_viewers: number; top: ViewerRow[] }
  | { status: 'private'; login: string }
  | { status: 'not_found' };

export const boards = {
  today: () => rpc<Today>('get_top_channels_today'),
  players: () => rpc<PlayerRow[]>('get_top_players'),
  channel: (login: string) => rpc<ChannelPage>('get_channel_page', { p_login: login }),
  solo: () => rpc<ViewerRow[]>('get_top_solo'),
};

export const plural = (n: number, word: string, many = word + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
export const channelUrl = (login: string) => `/channel.html?c=${encodeURIComponent(login)}`;

export function recordLine(r: GameRecord, who = 'You'): string {
  if (!r.games) return who === 'You' ? 'No real games yet. Your record against chat starts with your first one.' : 'No games yet. Check back after their first stream.';
  return `${who} vs chat: ${plural(r.games, 'game')} · ${plural(r.wins, 'win')} · ${plural(r.losses, 'loss', 'losses')} · ${plural(r.ties, 'tie')}`;
}

/** One leaderboard row: rank · name with a small stats line · score. */
export function row(rank: number, name: string | HTMLElement, stats: string, score: string): HTMLLIElement {
  const li = el('li');
  const nm = el('span', 'nm');
  nm.append(typeof name === 'string' ? el('b', null, name) : name, el('small', null, stats));
  li.append(el('span', 'r', '#' + rank), nm, el('span', 's', score));
  return li;
}

export function viewerRow(v: ViewerRow): HTMLLIElement {
  const stats = [v.accuracy != null ? `${v.accuracy}% right` : null, v.best_streak >= 3 ? `best streak ${v.best_streak}` : null, plural(v.games, 'game')]
    .filter(Boolean).join(' · ');
  return row(v.rank, v.name, stats, v.points.toLocaleString('en-US'));
}

export function emptyRow(text: string): HTMLLIElement { return el('li', 'empty', text); }
