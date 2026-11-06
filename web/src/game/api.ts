/* Mizavo — the game's calls to the database, with their exact shapes.
   Every call runs as the logged-in streamer; the database checks they own the game. */
import { rpc } from '../lib/supabase';
import type { Mode, RoundType } from './state';
import type { ReportReason } from '../lib/reasons';

export interface Channel {
  channel_id: string; login: string; display_name: string; is_admin: boolean;
  settings: { mode?: Mode; rounds?: number; seconds?: number; blind?: boolean } | null;
}
export interface Started { session_id: string; game_number: number; rounds: number; seconds: number; blind: boolean; is_test: boolean }
export interface RoundData { idx: number; rounds: number; type: RoundType; category: string; statement?: string; items?: string[]; seconds: number }
export interface Revealed {
  idx: number; correct_position: number; correct_label: string; explanation: string;
  streamer_correct: boolean | null; chat_correct: boolean | null; chat_total: number; chat_pct_right: number;
  streamer_score: number; chat_score: number; is_last: boolean; question_id: string;
}
export interface ViewerResult { id: string; login: string; display_name: string; points: number; answers: number; correct: number; best_streak: number }
export interface Finished {
  streamer_score: number; chat_score: number; rounds: number; viewers_saved: number; is_test: boolean;
  today: { games_finished: number; chat_won_pct: number | null; streamer_won_pct: number | null } | null;
}
export interface ActiveGame {
  session_id: string; game_number: number; mode: Mode; rounds: number; seconds: number; blind: boolean; is_test: boolean;
  next_round: number | null; streamer_score: number; chat_score: number;
}

export interface Access { invite_only: boolean; can_play: boolean; login: string | null }

export const api = {
  ensureChannel: () => rpc<Channel>('ensure_my_channel'),
  access: () => rpc<Access>('my_access'),
  report: (question: string, reason: ReportReason, note: string | null) =>
    rpc<{ report_id: string }>('report_question', { p_question: question, p_reason: reason, p_note: note }),
  activeGame: () => rpc<ActiveGame | null>('get_active_game'),
  start: (mode: Mode, rounds: number, seconds: number, blind: boolean, test: boolean) =>
    rpc<Started>('start_game', { p_mode: mode, p_rounds: rounds, p_seconds: seconds, p_blind: blind, p_test: test }),
  round: (session: string, idx: number) => rpc<RoundData>('get_round', { p_session: session, p_idx: idx }),
  reveal: (session: string, idx: number, pick: number | null, counts: number[]) =>
    rpc<Revealed>('reveal_round', { p_session: session, p_idx: idx, p_streamer_choice: pick, p_chat_counts: counts }),
  finish: (session: string, viewers: ViewerResult[]) => rpc<Finished>('finish_game', { p_session: session, p_viewers: viewers }),
  abandon: (session: string) => rpc<unknown>('abandon_game', { p_session: session }),
};

/** Turn a database error into a sentence a streamer understands. */
export function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = msg.split(':')[0];
  switch (code) {
    case 'not_enough_questions':
      return "There aren't enough new questions for that game right now. Try fewer rounds or another mode (Odd One Out needs more hard questions).";
    case 'game_in_progress': return 'You already have a game in progress.';
    case 'not_invited': return "Mizavo is in a closed test, and this channel isn't on the invite list yet.";
    case 'already_reported': return "You've already reported this question. Thanks, it's in the queue.";
    case 'no_channel': return 'Your Mizavo channel isn\'t set up yet. Try logging out and back in.';
    case 'channel_conflict': return 'This Twitch channel is linked to a different Mizavo login.';
    case 'game_not_found': case 'game_over': return 'That game has already ended.';
    default: return 'Something went wrong: ' + msg;
  }
}
