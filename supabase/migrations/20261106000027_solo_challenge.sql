-- Migration 27: daily solo challenge
--
-- Everyone gets the same 10 questions each UTC day (Mix, 3 easy / 4 medium / 3 hard, 15 s each),
-- drawn from today's daily pool and never used in an earlier solo challenge.
-- Logged-in players: one game a day, scored by the database, saved to solo_scores (its own board).
-- Guests: play YESTERDAY's challenge (finished, can't be scored), so playing as a guest can't spoil today's.
-- Solo follows the invite-only switch: during the closed test only invited people and admins play,
-- and guest play is off.

-- 1. tables ----------------------------------------------------------------------------------------
create table public.solo_days (
  play_date    date not null,
  idx          smallint not null check (idx between 1 and 10),
  question_id  uuid not null references public.questions (id) on delete restrict,
  option_order smallint[],                     -- Odd One Out: the same shuffled order for everyone
  primary key (play_date, idx),
  unique (play_date, question_id)
);
comment on table public.solo_days is 'The 10 solo challenge questions for each UTC day (the same for everyone).';
create index solo_days_question on public.solo_days (question_id);

create table public.solo_games (
  player_id    text not null references public.channels (id) on delete cascade,  -- Twitch user ID
  play_date    date not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  points       integer not null default 0,
  correct      smallint not null default 0,
  streak       smallint not null default 0,
  best_streak  smallint not null default 0,
  primary key (player_id, play_date)
);
comment on table public.solo_games is 'One solo challenge per player per UTC day.';

create table public.solo_answers (
  player_id    text not null,
  play_date    date not null,
  idx          smallint not null check (idx between 1 and 10),
  shown_at     timestamptz not null default now(),
  answered_at  timestamptz,
  choice       smallint,                      -- null = no answer in time
  correct      boolean,
  points       integer not null default 0,
  primary key (player_id, play_date, idx),
  foreign key (player_id, play_date) references public.solo_games (player_id, play_date) on delete cascade
);
comment on table public.solo_answers is 'Each solo round a player was shown, and their answer.';

create table public.solo_scores (
  player_id      text primary key references public.channels (id) on delete cascade,
  display_name   text not null,
  points         bigint not null default 0,
  answers        integer not null default 0,
  correct        integer not null default 0,
  best_streak    smallint not null default 0,
  games_played   integer not null default 0,
  last_played_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
comment on table public.solo_scores is 'All-time solo totals per player (the solo board). Separate from chat points.';
create index solo_scores_board on public.solo_scores (points desc);

-- only the functions below touch these tables
alter table public.solo_days    enable row level security;
alter table public.solo_games   enable row level security;
alter table public.solo_answers enable row level security;
alter table public.solo_scores  enable row level security;
revoke all on public.solo_days, public.solo_games, public.solo_answers, public.solo_scores from anon, authenticated;

-- 2. rules -----------------------------------------------------------------------------------------
create or replace function private.solo_seconds() returns int language sql immutable as $$ select 15 $$;
create or replace function private.solo_grace()   returns interval language sql immutable as $$ select interval '3 seconds' $$;

-- build a day's 10 questions once (safe if two players start at the same moment).
-- Spread across categories: first pass takes only categories not used yet; a second pass fills any gap.
create or replace function private.solo_build(p_date date)
returns void language plpgsql set search_path to '' as $$
declare
  v_need int[] := array[3, 4, 3];
  d int; got int; pass int; r record; n int := 0;
  keys text[] := '{}';
  cats text[] := '{}';
begin
  if exists (select 1 from public.solo_days where play_date = p_date) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('solo:' || p_date::text, 0));
  if exists (select 1 from public.solo_days where play_date = p_date) then return; end if;

  for d in 1..3 loop
    got := 0;
    for pass in 1..2 loop
      exit when got = v_need[d];
      for r in
        -- today's pool first, then the reserve (least used first); never a question or fact from an earlier solo day
        select q.id, q.fact_key, q.mode, q.category
        from public.questions q
        left join public.daily_pools p on p.pool_date = p_date and p.question_id = q.id
        where q.status = 'approved' and q.difficulty = d
          and not exists (select 1 from public.solo_days x where x.play_date = p_date and x.question_id = q.id)
          and not exists (select 1 from public.solo_days sd join public.questions q2 on q2.id = sd.question_id
                          where sd.play_date < p_date and (sd.question_id = q.id or q2.fact_key = q.fact_key))
        order by (p.question_id is null), q.times_used, md5('solo:' || p_date::text || q.id::text)
      loop
        exit when got = v_need[d];
        continue when r.fact_key = any(keys);
        continue when pass = 1 and r.category = any(cats);
        n := n + 1; got := got + 1; keys := keys || r.fact_key; cats := cats || r.category;
        insert into public.solo_days (play_date, idx, question_id, option_order)
        values (p_date, n, r.id,
          case when r.mode = 'ooo' then
            (select array_agg(k::smallint order by md5('solo:' || p_date::text || r.id::text || k::text))
             from generate_series(0, 3) as k)
          end);
        update public.questions set times_used = times_used + 1 where id = r.id;
      end loop;
    end loop;
    if got < v_need[d] then
      raise exception 'not_enough_questions: only % unused questions of difficulty % for the solo challenge', got, d;
    end if;
  end loop;
end;
$$;

-- end a player's game for the day and add it to their all-time solo totals
create or replace function private.solo_finish(p_player text, p_date date)
returns void language plpgsql set search_path to '' as $$
declare g public.solo_games;
begin
  update public.solo_games set finished_at = now()
  where player_id = p_player and play_date = p_date and finished_at is null
  returning * into g;
  if not found then return; end if;
  insert into public.solo_scores as s (player_id, display_name, points, answers, correct, best_streak, games_played)
  select p_player, c.display_name, g.points, 10, g.correct, g.best_streak, 1
  from public.channels c where c.id = p_player
  on conflict (player_id) do update set
    display_name = excluded.display_name, points = s.points + excluded.points,
    answers = s.answers + 10, correct = s.correct + excluded.correct,
    best_streak = greatest(s.best_streak, excluded.best_streak),
    games_played = s.games_played + 1, last_played_at = now();
end;
$$;

-- a shown round that ran out of time (plus grace) without an answer counts as a miss;
-- if that was round 10, the game is over
create or replace function private.solo_expire(p_player text, p_date date)
returns void language plpgsql set search_path to '' as $$
declare v_n int; v_last boolean;
begin
  update public.solo_answers
  set answered_at = shown_at + make_interval(secs => private.solo_seconds()), correct = false, points = 0
  where player_id = p_player and play_date = p_date and answered_at is null
    and now() > shown_at + make_interval(secs => private.solo_seconds()) + private.solo_grace();
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;
  update public.solo_games set streak = 0 where player_id = p_player and play_date = p_date;   -- a miss breaks the streak
  select exists (select 1 from public.solo_answers where player_id = p_player and play_date = p_date
                 and idx = 10 and answered_at is not null) into v_last;
  if v_last then perform private.solo_finish(p_player, p_date); end if;
end;
$$;

-- the round as the player sees it (never the answer)
create or replace function private.solo_question(p_date date, p_idx int)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'idx', sd.idx, 'rounds', 10, 'type', q.mode, 'category', q.category,
    'statement', q.payload ->> 'statement',
    'items', case when q.mode = 'ooo' then
               (select jsonb_agg(q.payload -> 'items' -> o.pos::int order by o.n)
                from unnest(sd.option_order) with ordinality as o(pos, n)) end,
    'seconds', private.solo_seconds()))
  from public.solo_days sd join public.questions q on q.id = sd.question_id
  where sd.play_date = p_date and sd.idx = p_idx;
$$;

-- where a logged-in player is today
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
    'players_today', (select count(*) from public.solo_games g3 where g3.play_date = p_date and g3.finished_at is not null))
  from (select 1) one
  left join public.solo_games g on g.player_id = p_player and g.play_date = p_date;
$$;

-- 3. logged-in player --------------------------------------------------------------------------------
create or replace function public.solo_status()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_me text := private.my_channel(); v_date date := private.today_utc();
begin
  perform private.solo_expire(v_me, v_date);
  return private.solo_state(v_me, v_date);
end;
$$;

create or replace function public.solo_start()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_me text := private.my_channel(); v_date date := private.today_utc();
begin
  perform private.solo_build(v_date);
  insert into public.solo_games (player_id, play_date) values (v_me, v_date) on conflict do nothing;
  perform private.solo_expire(v_me, v_date);
  return private.solo_state(v_me, v_date);
end;
$$;

create or replace function public.solo_round(p_idx int)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_me text := private.my_channel(); v_date date := private.today_utc();
  g public.solo_games; a public.solo_answers; v_next int;
begin
  select * into g from public.solo_games where player_id = v_me and play_date = v_date;
  if not found then raise exception 'not_started: start today''s challenge first'; end if;
  if g.finished_at is not null then raise exception 'already_played: you''ve played today''s challenge'; end if;
  perform private.solo_expire(v_me, v_date);
  v_next := (private.solo_state(v_me, v_date) ->> 'next_idx')::int;
  if p_idx <> v_next then raise exception 'out_of_order: you''re on round %', v_next; end if;

  insert into public.solo_answers (player_id, play_date, idx) values (v_me, v_date, p_idx)
  on conflict do nothing;                                  -- reloading keeps the first shown_at
  select * into a from public.solo_answers where player_id = v_me and play_date = v_date and idx = p_idx;
  insert into public.channel_seen (channel_id, question_id)  -- a streamer won't get it again on stream
  select v_me, sd.question_id from public.solo_days sd where sd.play_date = v_date and sd.idx = p_idx
  on conflict do nothing;

  return private.solo_question(v_date, p_idx) || jsonb_build_object(
    'shown_at', a.shown_at, 'ends_at', a.shown_at + make_interval(secs => private.solo_seconds()));
end;
$$;

create or replace function public.solo_answer(p_idx int, p_choice int)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_me text := private.my_channel(); v_date date := private.today_utc();
  g public.solo_games; a public.solo_answers; sd public.solo_days; q public.questions;
  v_pos int; v_late boolean; v_right boolean; v_pts int := 0; v_n int;
begin
  select * into g from public.solo_games where player_id = v_me and play_date = v_date for update;
  if not found then raise exception 'not_started: start today''s challenge first'; end if;
  if g.finished_at is not null then raise exception 'already_played: you''ve played today''s challenge'; end if;
  select * into a from public.solo_answers where player_id = v_me and play_date = v_date and idx = p_idx;
  if not found then raise exception 'round_not_shown: open round % first', p_idx; end if;
  if a.answered_at is not null then raise exception 'already_answered: round % is done', p_idx; end if;

  select * into sd from public.solo_days where play_date = v_date and idx = p_idx;
  select * into q from public.questions where id = sd.question_id;
  v_n := case when q.mode = 'ff' then 2 else 4 end;
  if p_choice is not null and (p_choice < 0 or p_choice >= v_n) then
    raise exception 'bad_choice: pick 0-%', v_n - 1;
  end if;

  v_pos   := private.correct_position(q.mode, q.answer, sd.option_order);
  v_late  := now() > a.shown_at + make_interval(secs => private.solo_seconds()) + private.solo_grace();
  v_right := not v_late and p_choice is not null and p_choice = v_pos;

  if v_right then
    g.streak := g.streak + 1;
    v_pts := 100 + least(5, g.streak - 1) * 20;     -- same rule as chat points
  else
    g.streak := 0;
  end if;

  update public.solo_answers
  set answered_at = now(), choice = case when v_late then null else p_choice end, correct = v_right, points = v_pts
  where player_id = v_me and play_date = v_date and idx = p_idx;

  update public.solo_games
  set points = points + v_pts, correct = correct + v_right::int, streak = g.streak,
      best_streak = greatest(best_streak, g.streak)
  where player_id = v_me and play_date = v_date
  returning * into g;

  if p_idx = 10 then perform private.solo_finish(v_me, v_date); end if;

  return jsonb_build_object(
    'idx', p_idx, 'correct_position', v_pos, 'explanation', q.explanation,
    'correct', v_right, 'late', v_late, 'points_gained', v_pts,
    'points', g.points, 'score', g.correct, 'streak', g.streak, 'is_last', p_idx = 10,
    'question_id', q.id)
    || case when p_idx = 10 then jsonb_build_object('state', private.solo_state(v_me, v_date)) else '{}'::jsonb end;
end;
$$;

-- 4. guests: yesterday's challenge (nothing saved) ----------------------------------------------------
create or replace function private.guest_check() returns date
language plpgsql stable set search_path to '' as $$
declare v_date date := private.today_utc() - 1;
begin
  if (select invite_only from private.app_flags) then
    raise exception 'closed_test: guest play opens when Mizavo leaves the closed test';
  end if;
  if not exists (select 1 from public.solo_days where play_date = v_date) then
    raise exception 'no_challenge: there''s no guest challenge yet. Check back tomorrow';
  end if;
  return v_date;
end;
$$;

create or replace function public.guest_round(p_idx int)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_date date := private.guest_check();
begin
  if p_idx not between 1 and 10 then raise exception 'round_not_found: rounds are 1-10'; end if;
  return private.solo_question(v_date, p_idx) || jsonb_build_object('date', v_date);
end;
$$;

create or replace function public.guest_answer(p_idx int, p_choice int)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_date date := private.guest_check(); sd public.solo_days; q public.questions; v_pos int;
begin
  select * into sd from public.solo_days where play_date = v_date and idx = p_idx;
  if not found then raise exception 'round_not_found: rounds are 1-10'; end if;
  select * into q from public.questions where id = sd.question_id;
  v_pos := private.correct_position(q.mode, q.answer, sd.option_order);
  return jsonb_build_object('idx', p_idx, 'correct_position', v_pos, 'explanation', q.explanation,
                            'correct', p_choice is not null and p_choice = v_pos, 'is_last', p_idx = 10);
end;
$$;

-- is solo open for logged-out visitors right now? (for the page, before it tries)
create or replace function public.solo_info()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'closed_test', (select invite_only from private.app_flags),
    'today', private.today_utc(),
    'next_reset_at', (private.today_utc() + 1)::timestamp at time zone 'utc',
    'guest_ready', exists (select 1 from public.solo_days where play_date = private.today_utc() - 1));
$$;

-- 5. solo board (public) ---------------------------------------------------------------------------
create or replace function public.get_top_solo()
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', x.rank, 'name', x.display_name, 'points', x.points,
           'accuracy', x.accuracy, 'best_streak', x.best_streak, 'games', x.games_played)
         order by x.rank), '[]'::jsonb)
  from (
    select row_number() over (order by points desc, correct desc, created_at) as rank,
           display_name, points, best_streak, games_played,
           round(100.0 * correct / nullif(answers, 0))::int as accuracy
    from public.solo_scores
    order by rank
    limit 10
  ) x;
$$;

-- 6. who can call what -----------------------------------------------------------------------------
revoke all on function private.solo_seconds(), private.solo_grace(), private.solo_build(date),
  private.solo_expire(text, date), private.solo_finish(text, date), private.solo_question(date, int), private.solo_state(text, date),
  private.guest_check()
  from public, anon, authenticated;

revoke all on function public.solo_status(), public.solo_start(), public.solo_round(int), public.solo_answer(int, int),
  public.guest_round(int), public.guest_answer(int, int), public.solo_info(), public.get_top_solo()
  from public;
grant execute on function public.solo_status(), public.solo_start(), public.solo_round(int), public.solo_answer(int, int)
  to authenticated;
grant execute on function public.guest_round(int), public.guest_answer(int, int), public.solo_info(), public.get_top_solo()
  to anon, authenticated;
