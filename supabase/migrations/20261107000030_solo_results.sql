-- Migration 30: daily challenge share button
--
-- The player's own result for each round (right or wrong, in order) is now part of the solo state,
-- so the "Share result" grid still works after a page reload. Only the player's own answers are
-- returned (never the questions or the right answers), and nothing else changes.

create or replace function private.solo_state(p_player text, p_date date)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'date', p_date,
    'next_reset_at', (p_date + 1)::timestamp at time zone 'utc',
    'state', case when g.player_id is null then 'new' when g.finished_at is not null then 'done' else 'playing' end,
    'next_idx', case when g.player_id is not null and g.finished_at is null then
                  coalesce((select max(idx) from public.solo_answers a
                            where a.player_id = p_player and a.play_date = p_date and a.answered_at is not null), 0) + 1 end,
    'points', coalesce(g.points, 0), 'correct', coalesce(g.correct, 0), 'best_streak', coalesce(g.best_streak, 0),
    'rank', case when g.finished_at is not null then
              (select count(*) + 1 from public.solo_games g2
               where g2.play_date = p_date and g2.finished_at is not null and g2.points > g.points) end,
    'players_today', (select count(*) from public.solo_games g3 where g3.play_date = p_date and g3.finished_at is not null),
    -- new: right/wrong for each answered round, round 1 first (a miss counts as wrong)
    'results', coalesce((select jsonb_agg(coalesce(a.correct, false) order by a.idx) from public.solo_answers a
                         where a.player_id = p_player and a.play_date = p_date and a.answered_at is not null), '[]'::jsonb))
  from (select 1) one
  left join public.solo_games g on g.player_id = p_player and g.play_date = p_date;
$$;
