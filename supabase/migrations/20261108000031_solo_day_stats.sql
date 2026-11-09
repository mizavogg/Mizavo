-- Migration 31: "where you stand" curve on the daily challenge results
--
-- solo_day_stats(date, points) returns how a day's finished daily-challenge scores are spread out,
-- so the results screen can draw a curve and say "You beat 72% of players today".
--   * Only counts: no names, no player ids. Scores are grouped into 100-point buckets (0..1700).
--   * Until a day has 10 finished players, only the player count comes back (no curve, no average),
--     so a handful of early scores can't be picked apart.
--   * Logged in and finished that day: the player's own saved score is used, and they are left out of
--     "how many you beat". Otherwise (a guest replaying yesterday's set) the points passed in are compared
--     against everyone who finished that day.
--   * Days in the future are refused (nothing to show, and no peeking ahead).

create or replace function public.solo_day_stats(p_date date default null, p_points int default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_today date := private.today_utc();
  v_date  date := coalesce(p_date, v_today);
  v_min   constant int := 10;        -- players needed before the curve shows
  v_width constant int := 100;       -- points per bucket
  v_max   constant int := 1700;      -- best possible daily score (10 right in a row)
  v_n     int;
  v_me    int;
  v_pts   int;
  v_lower int;
  v_others int;
begin
  if v_date > v_today then raise exception 'future_date'; end if;

  select count(*) into v_n from public.solo_games
  where play_date = v_date and finished_at is not null;

  if v_n < v_min then
    return jsonb_build_object('date', v_date, 'players', v_n, 'min_players', v_min, 'ready', false);
  end if;

  -- the caller's own finished score that day, if they're logged in and finished
  if auth.uid() is not null then
    select g.points into v_me from public.solo_games g
    join public.channels c on c.id = g.player_id
    where c.owner_user_id = (select auth.uid()) and g.play_date = v_date and g.finished_at is not null;
  end if;

  v_pts := coalesce(v_me, p_points);
  if v_pts is not null then
    v_pts := greatest(0, least(v_max, v_pts));
    select count(*) into v_lower from public.solo_games
    where play_date = v_date and finished_at is not null and points < v_pts;
    v_others := v_n - (case when v_me is not null then 1 else 0 end);
  end if;

  return jsonb_build_object(
    'date', v_date, 'players', v_n, 'min_players', v_min, 'ready', true,
    'bucket_width', v_width, 'max_points', v_max,
    'average', (select round(avg(points)) from public.solo_games where play_date = v_date and finished_at is not null),
    'buckets', (select jsonb_agg(coalesce(c.n, 0) order by b.i)
                from generate_series(0, v_max / v_width) b(i)
                left join (select least(points / v_width, v_max / v_width) i, count(*) n
                           from public.solo_games where play_date = v_date and finished_at is not null
                           group by 1) c on c.i = b.i),
    'points', v_pts,
    'beat_pct', case when v_pts is null or v_others <= 0 then null
                     else floor(100.0 * v_lower / v_others)::int end);
end;
$$;

revoke all on function public.solo_day_stats(date, int) from public;
grant execute on function public.solo_day_stats(date, int) to anon, authenticated;
