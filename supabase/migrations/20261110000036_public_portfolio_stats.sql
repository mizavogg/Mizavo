-- Mizavo — migration 36: read-only daily totals for Aiden's portfolio site (aidenjajo.com).
-- Aggregates only: no names, logins, IDs or answers. Real games only (test games excluded).
-- Days follow Mizavo's own day (private.today_utc(), Eastern time).
create or replace function public.get_portfolio_stats(p_days integer default 45)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with d as (
    select (private.today_utc() - (g || ' days')::interval)::date as day
    from generate_series(0, greatest(1, least(coalesce(p_days, 45), 120)) - 1) g
  ),
  r as (
    select s.play_date as day, count(*) as rounds, coalesce(sum(sr.chat_total), 0) as answers
    from public.sessions s
    join public.session_rounds sr on sr.session_id = s.id
    where not s.is_test and sr.revealed_at is not null
    group by 1
  ),
  so as (
    select play_date as day, count(*) as solo
    from public.solo_games
    where finished_at is not null
    group by 1
  )
  select jsonb_build_object(
    'today', private.today_utc(),
    'days', (select jsonb_agg(jsonb_build_object(
                 'date', d.day,
                 'rounds', coalesce(r.rounds, 0),
                 'answers', coalesce(r.answers, 0),
                 'solo', coalesce(so.solo, 0)) order by d.day)
             from d left join r on r.day = d.day left join so on so.day = d.day),
    'totals', jsonb_build_object(
      'games',     (select count(*) from public.sessions where not is_test and status = 'finished'),
      'rounds',    (select coalesce(sum(rounds), 0) from r),
      'answers',   (select coalesce(sum(answers), 0) from r),
      'solo',      (select coalesce(sum(solo), 0) from so),
      'questions', (select count(*) from public.questions where status = 'approved'))
  );
$$;

revoke all on function public.get_portfolio_stats(integer) from public;
grant execute on function public.get_portfolio_stats(integer) to anon, authenticated;
comment on function public.get_portfolio_stats(integer) is
  'Public daily totals (rounds, chat answers, solo plays) for the portfolio hero on aidenjajo.com. Aggregates only.';
