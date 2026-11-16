/* Mizavo — the game's calls to the database, with their exact shapes.
   Every call runs as the logged-in streamer; the database checks they own the game. */
import { supabase, rpc } from '../lib/supabase';
import type { Mode, RoundType } from './state';
import type { ReportReason } from '../lib/reasons';
import type { GameRecord, ViewerRow } from '../lib/boards';

export interface Channel {
  channel_id: string; login: string; display_name: string; is_admin: boolean; chat_ok?: boolean;
  settings: { mode?: Mode; rounds?: number; seconds?: number; blind?: boolean; double?: boolean; lightning?: boolean; categories?: string[] } | null;
}
export interface Started { session_id: string; game_number: number; rounds: number; seconds: number; blind: boolean; is_test: boolean; double_final: boolean; lightning_at: number | null; categories?: string[]; filled_from_other?: number }
export interface RoundData { idx: number; rounds: number; type: RoundType; category: string; statement?: string; items?: string[]; seconds: number; weight?: number; lightning?: number }
export interface Revealed {
  idx: number; correct_position: number; correct_label: string; explanation: string;
  streamer_correct: boolean | null; chat_correct: boolean | null; chat_total: number; chat_pct_right: number;
  streamer_score: number; chat_score: number; is_last: boolean; question_id: string; weight?: number;
}
export interface ViewerResult { id: string; login: string; display_name: string; points: number; answers: number; correct: number; best_streak: number }
export interface Finished {
  streamer_score: number; chat_score: number; rounds: number; viewers_saved: number; is_test: boolean; max_score?: number;
  today: { games_finished: number; chat_won_pct: number | null; streamer_won_pct: number | null } | null;
}
export interface ActiveGame {
  session_id: string; game_number: number; mode: Mode; rounds: number; seconds: number; blind: boolean; is_test: boolean;
  double_final?: boolean; lightning_at?: number | null;
  next_round: number | null; streamer_score: number; chat_score: number;
}

export interface Community {
  login: string; hidden: boolean;
  record: GameRecord;
  today_rank: number | null; today_rounds: number;
  total_viewers: number;
  top: ViewerRow[];
}

export interface Access { invite_only: boolean; can_play: boolean; login: string | null }
export interface Redeemed { status: 'joined' | 'already' | 'inactive' | 'full' }

/** The server-side chat reader (Edge Function twitch-chat). Never throws: problems just mean "not verified". */
async function chatFn<T>(body: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke('twitch-chat', { body });
    return error || !data ? fallback : (data as T);
  } catch { return fallback; }
}
export const chatServer = {
  start: (session: string) => chatFn<{ verified: boolean; reason?: string }>({ action: 'start', session }, { verified: false, reason: 'error' }),
  stop: (session: string) => { void chatFn({ action: 'stop', session }, null); },
  check: (providerToken: string) => chatFn<{ chat_ok: boolean }>({ action: 'check', provider_token: providerToken }, { chat_ok: false }),
  /** Wake the server function while the streamer is on the settings screen, so Start doesn't wait for it to boot. */
  warm: () => { void chatFn({ action: 'ping' }, null); },
};

export const api = {
  ensureChannel: () => rpc<Channel>('ensure_my_channel'),
  access: () => rpc<Access>('my_access'),
  redeemInvite: (code: string) => rpc<Redeemed>('redeem_invite', { p_code: code }),
  report: (question: string, reason: ReportReason, note: string | null) =>
    rpc<{ report_id: string }>('report_question', { p_question: question, p_reason: reason, p_note: note }),
  activeGame: () => rpc<ActiveGame | null>('get_active_game'),
  start: (mode: Mode, rounds: number, seconds: number, blind: boolean, test: boolean, double: boolean, lightning: boolean,
          categories: string[] | null) =>
    rpc<Started>('start_game', { p_mode: mode, p_rounds: rounds, p_seconds: seconds, p_blind: blind, p_test: test,
                                 p_double: double, p_lightning: lightning, p_categories: categories }),
  round: (session: string, idx: number) => rpc<RoundData>('get_round', { p_session: session, p_idx: idx }),
  reveal: (session: string, idx: number, pick: number | null, counts: number[]) =>
    rpc<Revealed>('reveal_round', { p_session: session, p_idx: idx, p_streamer_choice: pick, p_chat_counts: counts }),
  finish: (session: string, viewers: ViewerResult[]) => rpc<Finished>('finish_game', { p_session: session, p_viewers: viewers }),
  community: (top: number) => rpc<Community>('get_my_community', { p_top: top }),
  setVisibility: (hidden: boolean) => rpc<{ hidden: boolean }>('set_my_visibility', { p_hidden: hidden }),
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
    case 'too_many_reports': return "That's a lot of reports in one hour. Thanks! Try again a bit later.";
    case 'no_channel': return 'Your Mizavo channel isn\'t set up yet. Try logging out and back in.';
    case 'family_account': return 'Family logins can play the daily challenge and practice (at /solo). Playing against a Twitch chat needs a Twitch login.';
    case 'channel_conflict': return 'This Twitch channel is linked to a different Mizavo login.';
    case 'game_not_found': case 'game_over': return 'That game has already ended.';
    default:
      if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return "Couldn't reach Mizavo. Check your connection and try again.";
      return 'Something went wrong: ' + msg;
  }
}
