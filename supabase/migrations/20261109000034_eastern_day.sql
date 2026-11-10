-- Mizavo — migration 34: the Mizavo day now runs on US Eastern time (midnight in New York),
-- instead of midnight UTC. 'America/New_York' follows daylight saving on its own (EST in winter, EDT in summer).
-- The function keeps its old name (today_utc) because 16 functions and the cron jobs call it;
-- only what it returns changes.
create or replace function private.today_utc()
returns date language sql stable set search_path to ''
as $$ select (now() at time zone 'America/New_York')::date $$;
comment on function private.today_utc() is 'Today''s Mizavo date: the calendar day in US Eastern time (America/New_York). Name kept from when the day ran on UTC.';

-- when the next day starts (shown as a countdown on the daily challenge)
create or replace function public.solo_info()
returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'closed_test', (select invite_only from private.app_flags),
    'today', private.today_utc(),
    'next_reset_at', (private.today_utc() + 1)::timestamp at time zone 'America/New_York',
    'guest_ready', exists (select 1 from public.solo_days where play_date = private.today_utc() - 1));
$$;

create or replace function private.solo_state(p_player text, p_date date)
returns jsonb language sql stable set search_path to ''
as $$
  select jsonb_build_object(
    'date', p_date,
    'next_reset_at', (p_date + 1)::timestamp at time zone 'America/New_York',
    'state', case when g.player_id is null then 'new' when g.finished_at is not null then 'done' else 'playing' end,
    'next_idx', case when g.player_id is not null and g.finished_at is null then
                  coalesce((select max(idx) from public.solo_answers a
                            where a.player_id = p_player and a.play_date = p_date and a.answered_at is not null), 0) + 1 end,
    'points', coalesce(g.points, 0), 'correct', coalesce(g.correct, 0), 'best_streak', coalesce(g.best_streak, 0),
    'rank', case when g.finished_at is not null then
              (select count(*) + 1 from public.solo_games g2
               where g2.play_date = p_date and g2.finished_at is not null and g2.points > g.points) end,
    'players_today', (select count(*) from public.solo_games g3 where g3.play_date = p_date and g3.finished_at is not null),
    'results', coalesce((select jsonb_agg(coalesce(a.correct, false) order by a.idx) from public.solo_answers a
                         where a.player_id = p_player and a.play_date = p_date and a.answered_at is not null), '[]'::jsonb))
  from (select 1) one
  left join public.solo_games g on g.player_id = p_player and g.play_date = p_date;
$$;

-- Nightly jobs (pg_cron runs on UTC). Eastern midnight is 05:00 UTC in winter and 04:00 UTC in summer,
-- so tomorrow's question pool AND tomorrow's daily challenge are built at 03:50 UTC, before either.
-- An hourly safety net builds today's if anything was missed (both builders skip days already built).
select cron.unschedule(jobid) from cron.job where jobname in
  ('mizavo-build-tomorrows-pool', 'mizavo-build-todays-pool-safety-net', 'mizavo-build-todays-solo-challenge');
select cron.schedule('mizavo-build-tomorrows-pool', '50 3 * * *',
  $c$ select private.build_daily_pool(private.today_utc() + 1); select private.solo_build(private.today_utc() + 1); $c$);
select cron.schedule('mizavo-build-todays-safety-net', '5 * * * *',
  $c$ select private.build_daily_pool(private.today_utc()); select private.solo_build(private.today_utc()); $c$);
