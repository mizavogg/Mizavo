-- Migration 26: public boards (option A + today board + worldwide players) and "hide my channel"
--
--   public.get_top_channels_today()   anyone   top 20 channels today by smartest chat (>= 10 rounds, real games)
--   public.get_top_players()          anyone   worldwide top 10 viewers by total points (all channels, real games)
--   public.get_channel_page(login)    anyone   a channel's record, today's rank, all-time top 25 viewers
--   public.get_my_community(top)      streamer same numbers for your own channel + whether you're hidden
--   public.set_my_visibility(hidden)  streamer hide/show your channel on the public pages
--
-- Public functions return totals and leaderboards only: never questions, answers or a game in progress.
-- The shared private helpers below make every page show the same numbers.

-- 1. hide my channel ------------------------------------------------------------------------------
alter table public.channels add column public_hidden boolean not null default false;
comment on column public.channels.public_hidden is
  'Streamer chose to hide this channel from the public pages (today board + channel page). Viewers still earn points.';

-- 2. shared helpers (private: not callable from the website) ------------------------------------

-- streamer vs chat across finished real games
create or replace function private.channel_record(p_ch text)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'games',  count(*),
    'wins',   count(*) filter (where t.me > t.chat),
    'losses', count(*) filter (where t.chat > t.me),
    'ties',   count(*) filter (where t.me = t.chat))
  from (
    select s.id,
           count(*) filter (where r.streamer_correct) as me,
           count(*) filter (where r.chat_correct)     as chat
    from public.sessions s
    join public.session_rounds r on r.session_id = s.id
    where s.channel_id = p_ch and s.status = 'finished' and not s.is_test
    group by s.id
  ) t;
$$;

-- a channel's all-time top viewers (points first; ties: more correct answers, then who got there first)
create or replace function private.channel_top(p_ch text, p_top int)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', x.rank, 'name', x.display_name, 'points', x.points,
           'accuracy', x.accuracy, 'best_streak', x.best_streak, 'games', x.games_played)
         order by x.rank), '[]'::jsonb)
  from (
    select row_number() over (order by points desc, correct desc, updated_at asc) as rank,
           display_name, points, best_streak, games_played,
           round(100.0 * correct / nullif(answers, 0))::int as accuracy
    from public.viewer_scores
    where channel_id = p_ch
    order by rank
    limit greatest(1, least(coalesce(p_top, 10), 50))
  ) x;
$$;

-- today's board: every visible channel with >= 10 real rounds today, ranked by smartest chat.
-- "% right" for a round = chat votes on the right answer / all chat votes; rounds nobody voted on are skipped.
create or replace function private.today_board()
returns table (rank bigint, channel_id text, login text, display_name text,
               rounds bigint, chat_pct int, wins bigint, losses bigint, ties bigint)
language sql stable set search_path to '' as $$
  with rnd as (
    select s.channel_id, s.id as session_id, r.streamer_correct, r.chat_correct,
           case when r.chat_total > 0 then
             100.0 * r.chat_counts[private.correct_position(q.mode, q.answer, r.option_order) + 1] / r.chat_total
           end as pct
    from public.sessions s
    join public.session_rounds r on r.session_id = s.id
    join public.questions q on q.id = r.question_id
    where s.play_date = private.today_utc() and s.status = 'finished' and not s.is_test
  ),
  games as (
    select channel_id, session_id,
           count(*) filter (where streamer_correct) as me,
           count(*) filter (where chat_correct)     as chat
    from rnd group by channel_id, session_id
  ),
  per as (
    select r.channel_id, count(*) as rounds, round(avg(r.pct))::int as chat_pct
    from rnd r group by r.channel_id
  ),
  rec as (
    select channel_id,
           count(*) filter (where me > chat) as wins,
           count(*) filter (where chat > me) as losses,
           count(*) filter (where me = chat) as ties
    from games group by channel_id
  )
  select row_number() over (order by p.chat_pct desc, p.rounds desc, c.login) as rank,
         c.id, c.login, c.display_name, p.rounds, p.chat_pct, rec.wins, rec.losses, rec.ties
  from per p
  join rec on rec.channel_id = p.channel_id
  join public.channels c on c.id = p.channel_id
  where p.rounds >= 10 and p.chat_pct is not null and not c.public_hidden;
$$;

-- 3. public (logged out is fine) -------------------------------------------------------------------

create or replace function public.get_top_channels_today()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'day', private.today_utc(),
    'min_rounds', 10,
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', b.rank, 'login', b.login, 'name', b.display_name, 'chat_pct', b.chat_pct,
               'rounds', b.rounds, 'wins', b.wins, 'losses', b.losses, 'ties', b.ties)
             order by b.rank)
      from private.today_board() b where b.rank <= 20), '[]'::jsonb));
$$;

-- worldwide players: each viewer's points added up across every channel (hidden channels included:
-- no channel is named here). The newest display name is shown.
create or replace function public.get_top_players()
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', x.rank, 'name', x.name, 'points', x.points,
           'accuracy', x.accuracy, 'channels', x.channels, 'games', x.games)
         order by x.rank), '[]'::jsonb)
  from (
    select row_number() over (order by sum(points) desc, sum(correct) desc, min(created_at)) as rank,
           (array_agg(display_name order by last_played_at desc))[1] as name,
           sum(points)::bigint as points,
           round(100.0 * sum(correct) / nullif(sum(answers), 0))::int as accuracy,
           count(*) as channels,
           sum(games_played)::bigint as games
    from public.viewer_scores
    group by viewer_id
    order by rank
    limit 10
  ) x;
$$;

create or replace function public.get_channel_page(p_login text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  c public.channels;
  v_rank bigint;
begin
  select * into c from public.channels where login = lower(trim(coalesce(p_login, '')));
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if c.public_hidden then return jsonb_build_object('status', 'private', 'login', c.login); end if;
  select b.rank into v_rank from private.today_board() b where b.channel_id = c.id;
  return jsonb_build_object(
    'status', 'ok', 'login', c.login, 'name', c.display_name,
    'record', private.channel_record(c.id),
    'today_rank', v_rank,
    'total_viewers', (select count(*) from public.viewer_scores where channel_id = c.id),
    'top', private.channel_top(c.id, 25));
end;
$$;

-- 4. streamer (logged in) ------------------------------------------------------------------------

create or replace function public.get_my_community(p_top int default 10)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_ch text := private.my_channel();   -- raises if not logged in / not invited
  c public.channels;
  v_rank bigint;
begin
  select * into c from public.channels where id = v_ch;
  select b.rank into v_rank from private.today_board() b where b.channel_id = v_ch;   -- null when hidden or < 10 rounds
  return jsonb_build_object(
    'login', c.login, 'hidden', c.public_hidden,
    'record', private.channel_record(v_ch),
    'today_rank', v_rank,
    'today_rounds', (select count(*) from public.sessions s join public.session_rounds r on r.session_id = s.id
                     where s.channel_id = v_ch and s.play_date = private.today_utc()
                       and s.status = 'finished' and not s.is_test),
    'total_viewers', (select count(*) from public.viewer_scores where channel_id = v_ch),
    'top', private.channel_top(v_ch, p_top));
end;
$$;

create or replace function public.set_my_visibility(p_hidden boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_ch text := private.my_channel();
begin
  if p_hidden is null then raise exception 'bad_value: hidden must be true or false'; end if;
  update public.channels set public_hidden = p_hidden, updated_at = now() where id = v_ch;
  return jsonb_build_object('hidden', p_hidden);
end;
$$;

-- 5. who can call what ---------------------------------------------------------------------------
revoke all on function private.channel_record(text), private.channel_top(text, int), private.today_board()
  from public, anon, authenticated;

revoke all on function public.get_top_channels_today(), public.get_top_players(), public.get_channel_page(text),
                       public.get_my_community(int), public.set_my_visibility(boolean)
  from public;
grant execute on function public.get_top_channels_today(), public.get_top_players(), public.get_channel_page(text)
  to anon, authenticated;
grant execute on function public.get_my_community(int), public.set_my_visibility(boolean) to authenticated;
