-- Mizavo: test games
-- A game played with simulated (demo) chat is marked is_test.
-- Test games never change a question's chat accuracy (correct_rate) and are left out of
-- the "today" numbers, so fake votes can't skew real data. Real viewers who vote in a
-- test game still get their points. Questions shown in a test game still count as seen.

alter table public.sessions add column is_test boolean not null default false;
comment on column public.sessions.is_test is 'true when the game was played with simulated (demo) chat';

-- is_test is set when the game starts and can never change afterwards
create or replace function private.sessions_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.channel_id, new.play_date, new.game_number, new.seed,
      new.mode, new.rounds, new.seconds, new.blind, new.is_test, new.started_at)
     is distinct from
     (old.id, old.channel_id, old.play_date, old.game_number, old.seed,
      old.mode, old.rounds, old.seconds, old.blind, old.is_test, old.started_at) then
    raise exception 'session %: only status and finished_at can change', old.id;
  end if;
  if old.status <> 'active' and new.status is distinct from old.status then
    raise exception 'session % is already %, it cannot be reopened or changed', old.id, old.status;
  end if;
  if old.status <> 'active' and new.finished_at is distinct from old.finished_at then
    raise exception 'session % is already %, its end time is final', old.id, old.status;
  end if;
  return new;
end;
$$;

-- start_game gains p_test (defaults to false, so a call without it is a normal game)
drop function public.start_game(text, int, int, boolean);
create function public.start_game(p_mode text, p_rounds int, p_seconds int, p_blind boolean, p_test boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ch    text := private.my_channel();
  v_date  date := private.today_utc();
  v_game  int;
  v_seed  bigint;
  v_sid   uuid;
  v_need  int[];          -- how many easy / medium / hard
  d       int;
  got     int;
  r       record;
  ids     uuid[] := '{}';
  keys    text[] := '{}';
  cats    text[] := '{}';
  diffs   int[]  := '{}';
  modes   text[] := '{}';
  hashes  text[] := '{}';
  ord     int[];
  i int; j int; tmp int;
begin
  if p_mode not in ('ff', 'ooo', 'mix') or p_rounds not in (5, 10, 15, 20)
     or p_seconds not in (10, 15, 20, 30) or p_blind is null or p_test is null then
    raise exception 'bad_settings: mode, rounds, seconds or blind is not a valid option';
  end if;

  if exists (select 1 from public.sessions s where s.channel_id = v_ch and s.status = 'active') then
    raise exception 'game_in_progress: finish or abandon the current game first';
  end if;

  select coalesce(max(s.game_number), 0) + 1 into v_game
  from public.sessions s where s.channel_id = v_ch and s.play_date = v_date;

  -- seed = channel + date + game number (from the spec): reloading can't reroll an easier version
  v_seed := hashtextextended(v_ch || ':' || v_date::text || ':' || v_game::text, 0);

  -- 30 / 40 / 30 split; 10 rounds -> 3 / 4 / 3
  v_need := array[round(p_rounds * 0.3)::int, 0, floor(p_rounds * 0.3)::int];
  v_need[2] := p_rounds - v_need[1] - v_need[3];

  for d in 1..3 loop
    got := 0;
    -- 1) today's pool, minus everything this channel has seen (question or fact)
    for r in
      select q.id, q.fact_key, q.category, q.mode, md5(v_seed::text || q.id::text) as h
      from public.daily_pools p
      join public.questions q on q.id = p.question_id
      where p.pool_date = v_date and q.status = 'approved' and q.difficulty = d
        and (p_mode = 'mix' or q.mode = p_mode)
        and not exists (select 1 from public.channel_seen s
                        where s.channel_id = v_ch and (s.question_id = q.id or s.fact_key = q.fact_key))
      order by md5(v_seed::text || q.id::text)
    loop
      exit when got = v_need[d];
      continue when r.fact_key = any(keys);
      ids := ids || r.id; keys := keys || r.fact_key; cats := cats || r.category;
      diffs := diffs || d; modes := modes || r.mode; hashes := hashes || r.h;
      got := got + 1;
    end loop;

    -- 2) top up from the reserve (approved, not in today's pool), least-used first
    if got < v_need[d] then
      for r in
        select q.id, q.fact_key, q.category, q.mode, md5(v_seed::text || q.id::text) as h
        from public.questions q
        where q.status = 'approved' and q.difficulty = d
          and (p_mode = 'mix' or q.mode = p_mode)
          and not exists (select 1 from public.daily_pools p where p.pool_date = v_date and p.question_id = q.id)
          and not exists (select 1 from public.channel_seen s
                          where s.channel_id = v_ch and (s.question_id = q.id or s.fact_key = q.fact_key))
        order by q.times_used, md5(v_seed::text || q.id::text)
      loop
        exit when got = v_need[d];
        continue when r.fact_key = any(keys);
        ids := ids || r.id; keys := keys || r.fact_key; cats := cats || r.category;
        diffs := diffs || d; modes := modes || r.mode; hashes := hashes || r.h;
        got := got + 1;
      end loop;
    end if;

    if got < v_need[d] then
      raise exception 'not_enough_questions: only % unseen questions of difficulty % available, % needed',
        got, d, v_need[d];
    end if;
  end loop;

  -- order: easy -> medium -> hard (already grouped), shuffled inside each group by the seed
  select array_agg(k order by diffs[k], hashes[k]) into ord from generate_subscripts(ids, 1) as k;

  -- no two neighbours share a category: swap with the next round that differs (same difficulty if possible)
  for i in 2..array_length(ord, 1) loop
    if cats[ord[i]] = cats[ord[i - 1]] then
      j := null;
      for k2 in i + 1 .. array_length(ord, 1) loop
        if cats[ord[k2]] <> cats[ord[i - 1]] then
          if diffs[ord[k2]] = diffs[ord[i]] then j := k2; exit; end if;   -- best: same difficulty
          if j is null then j := k2; end if;                               -- fallback: nearest that differs
        end if;
      end loop;
      if j is not null then
        tmp := ord[i]; ord[i] := ord[j]; ord[j] := tmp;
      end if;
    end if;
  end loop;

  insert into public.sessions (channel_id, play_date, game_number, seed, mode, rounds, seconds, blind, is_test)
  values (v_ch, v_date, v_game, v_seed, p_mode, p_rounds, p_seconds, p_blind, p_test)
  returning id into v_sid;

  for i in 1..array_length(ord, 1) loop
    insert into public.session_rounds (session_id, idx, question_id, option_order)
    values (
      v_sid, i, ids[ord[i]],
      case when modes[ord[i]] = 'ooo' then
        (select array_agg(k::smallint order by md5(v_seed::text || ids[ord[i]]::text || k::text))
         from generate_series(0, 3) as k)
      end
    );
  end loop;

  -- remember these settings for next time
  update public.channels
  set settings = jsonb_build_object('mode', p_mode, 'rounds', p_rounds, 'seconds', p_seconds, 'blind', p_blind)
  where id = v_ch;

  return jsonb_build_object('session_id', v_sid, 'game_number', v_game, 'mode', p_mode,
                            'rounds', p_rounds, 'seconds', p_seconds, 'blind', p_blind,
                            'is_test', p_test);
end;
$$;

create or replace function public.reveal_round(p_session uuid, p_idx int, p_streamer_choice int, p_chat_counts int[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ch text := private.my_channel();
  s public.sessions;
  r public.session_rounds;
  q public.questions;
  v_pos int;
  v_me int; v_chat int;
begin
  select * into s from public.sessions where id = p_session and channel_id = v_ch;
  if not found then raise exception 'game_not_found: no such game for this channel'; end if;
  if s.status <> 'active' then raise exception 'game_over: this game is already %', s.status; end if;

  select * into r from public.session_rounds where session_id = p_session and idx = p_idx;
  if not found then raise exception 'round_not_found: this game has no round %', p_idx; end if;
  if r.shown_at is null then raise exception 'not_shown: round % has not been shown yet', p_idx; end if;
  if r.revealed_at is not null then raise exception 'already_revealed: round % is already revealed', p_idx; end if;

  -- early reveal is only allowed once the streamer has locked in a pick
  if p_streamer_choice is null and now() < r.shown_at + make_interval(secs => s.seconds - 1) then
    raise exception 'too_early: the timer has not ended and the streamer has not picked';
  end if;

  if (select coalesce(sum(c), 0) from unnest(p_chat_counts) as c) > 100000 then
    raise exception 'too_many_votes: more than 100,000 votes in one round';
  end if;

  update public.session_rounds
  set revealed_at = now(), streamer_choice = p_streamer_choice, chat_counts = p_chat_counts
  where session_id = p_session and idx = p_idx
  returning * into r;

  select * into q from public.questions where id = r.question_id;
  v_pos := private.correct_position(q.mode, q.answer, r.option_order);

  -- keep the question's real chat accuracy up to date (feeds difficulty review later).
  -- test games (simulated chat) never count: fake votes would skew the numbers.
  if not s.is_test then
  update public.questions qq set correct_rate = sub.rate
  from (
    select avg(rr.chat_counts[private.correct_position(q.mode, q.answer, rr.option_order) + 1]::numeric
               / rr.chat_total) as rate
    from public.session_rounds rr
    join public.sessions ss on ss.id = rr.session_id and not ss.is_test
    where rr.question_id = q.id and rr.revealed_at is not null and rr.chat_total > 0
  ) sub
  where qq.id = q.id and sub.rate is not null;
  end if;

  select count(*) filter (where streamer_correct), count(*) filter (where chat_correct)
  into v_me, v_chat
  from public.session_rounds where session_id = p_session;

  return jsonb_build_object(
    'idx', r.idx,
    'correct_position', v_pos,
    'correct_label', case when q.mode = 'ff' then (case when v_pos = 0 then 'FACT' else 'FAKE' end)
                          else q.payload -> 'items' ->> (q.answer #>> '{}')::int end,
    'explanation', q.explanation,
    'streamer_correct', r.streamer_correct,
    'chat_correct', r.chat_correct,
    'chat_total', r.chat_total,
    'chat_pct_right', case when r.chat_total > 0
                           then round(100.0 * r.chat_counts[v_pos + 1] / r.chat_total) else 0 end,
    'streamer_score', v_me,
    'chat_score', v_chat,
    'is_last', r.idx = s.rounds,
    'question_id', q.id
  );
end;
$$;

create or replace function public.finish_game(p_session uuid, p_viewers jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ch text := private.my_channel();
  s public.sessions;
  v_total_votes bigint; v_right_votes bigint;
  v_me int; v_chat int; v_n int;
  bad text;
begin
  select * into s from public.sessions where id = p_session and channel_id = v_ch for update;
  if not found then raise exception 'game_not_found: no such game for this channel'; end if;
  if s.status <> 'active' then raise exception 'game_over: this game is already %', s.status; end if;

  if (select count(*) from public.session_rounds where session_id = p_session and revealed_at is not null) <> s.rounds then
    raise exception 'rounds_left: reveal every round before finishing (or abandon the game)';
  end if;

  p_viewers := coalesce(p_viewers, '[]'::jsonb);
  if jsonb_typeof(p_viewers) <> 'array' then raise exception 'bad_viewers: viewers must be a list'; end if;
  v_n := jsonb_array_length(p_viewers);
  if v_n > 20000 then raise exception 'bad_viewers: too many viewers in one game'; end if;

  -- each viewer's numbers must be possible for this game
  select v ->> 'id' into bad
  from jsonb_array_elements(p_viewers) as v
  where coalesce(v ->> 'id', '') !~ '^[0-9]{1,20}$'
     or lower(coalesce(v ->> 'login', '')) !~ '^[a-z0-9_]{1,25}$'
     or char_length(coalesce(v ->> 'display_name', '')) not between 1 and 50
     or jsonb_typeof(v -> 'points') <> 'number' or jsonb_typeof(v -> 'answers') <> 'number'
     or jsonb_typeof(v -> 'correct') <> 'number' or jsonb_typeof(v -> 'best_streak') <> 'number'
     or (v ->> 'answers')::int not between 1 and s.rounds
     or (v ->> 'correct')::int not between 0 and (v ->> 'answers')::int
     or (v ->> 'best_streak')::int not between 0 and (v ->> 'correct')::int
     or (v ->> 'correct')::int > 0 and (v ->> 'best_streak')::int < 1
     -- 100 per right answer, plus a streak bonus of at most +100 per round
     or (v ->> 'points')::int not between (v ->> 'correct')::int * 100 and (v ->> 'correct')::int * 200
  limit 1;
  if found then raise exception 'bad_viewers: impossible numbers for viewer %', coalesce(bad, '(no id)'); end if;

  if (select count(distinct v ->> 'id') from jsonb_array_elements(p_viewers) as v) <> v_n then
    raise exception 'bad_viewers: the same viewer appears twice';
  end if;

  -- totals across viewers can't exceed the votes the rounds actually recorded
  select coalesce(sum(r.chat_total), 0),
         coalesce(sum(r.chat_counts[private.correct_position(q.mode, q.answer, r.option_order) + 1]), 0)
  into v_total_votes, v_right_votes
  from public.session_rounds r join public.questions q on q.id = r.question_id
  where r.session_id = p_session;

  if (select coalesce(sum((v ->> 'answers')::int), 0) from jsonb_array_elements(p_viewers) as v) > v_total_votes
     or (select coalesce(sum((v ->> 'correct')::int), 0) from jsonb_array_elements(p_viewers) as v) > v_right_votes then
    raise exception 'bad_viewers: viewer totals are higher than the votes recorded in the rounds';
  end if;

  insert into public.viewer_scores as vs
    (channel_id, viewer_id, viewer_login, display_name, points, answers, correct, best_streak, games_played, last_played_at)
  select v_ch, v ->> 'id', lower(v ->> 'login'), v ->> 'display_name',
         (v ->> 'points')::bigint, (v ->> 'answers')::int, (v ->> 'correct')::int,
         (v ->> 'best_streak')::smallint, 1, now()
  from jsonb_array_elements(p_viewers) as v
  on conflict (channel_id, viewer_id) do update set
    viewer_login   = excluded.viewer_login,
    display_name   = excluded.display_name,
    points         = vs.points + excluded.points,
    answers        = vs.answers + excluded.answers,
    correct        = vs.correct + excluded.correct,
    best_streak    = greatest(vs.best_streak, excluded.best_streak),
    games_played   = vs.games_played + 1,
    last_played_at = now();

  update public.sessions set status = 'finished', finished_at = now() where id = p_session;

  select count(*) filter (where streamer_correct), count(*) filter (where chat_correct)
  into v_me, v_chat from public.session_rounds where session_id = p_session;

  return jsonb_build_object(
    'streamer_score', v_me, 'chat_score', v_chat, 'rounds', s.rounds, 'viewers_saved', v_n,
    'is_test', s.is_test,
    'today', (
      select jsonb_build_object(
        'games_finished', count(*),
        'chat_won_pct', round(100.0 * count(*) filter (where t.chat > t.me) / nullif(count(*), 0)),
        'streamer_won_pct', round(100.0 * count(*) filter (where t.me > t.chat) / nullif(count(*), 0)),
        'avg_streamer_pct', round(avg(100.0 * t.me / t.rounds)),
        'avg_chat_pct', round(avg(100.0 * t.chat / t.rounds)))
      from (
        select ss.rounds,
               count(*) filter (where rr.streamer_correct) as me,
               count(*) filter (where rr.chat_correct) as chat
        from public.sessions ss join public.session_rounds rr on rr.session_id = ss.id
        where ss.play_date = s.play_date and ss.status = 'finished' and not ss.is_test
        group by ss.id, ss.rounds
      ) t
    )
  );
end;
$$;

create or replace function public.get_active_game()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ch text := private.my_channel();
  s public.sessions;
  v_next int; v_me int; v_chat int;
begin
  select * into s from public.sessions where channel_id = v_ch and status = 'active';
  if not found then return null; end if;

  select min(idx) into v_next from public.session_rounds where session_id = s.id and revealed_at is null;
  select count(*) filter (where streamer_correct), count(*) filter (where chat_correct)
  into v_me, v_chat from public.session_rounds where session_id = s.id;

  return jsonb_build_object(
    'session_id', s.id, 'game_number', s.game_number, 'mode', s.mode, 'rounds', s.rounds,
    'seconds', s.seconds, 'blind', s.blind, 'is_test', s.is_test, 'started_at', s.started_at,
    'next_round', v_next,            -- null means every round is revealed: call finish_game
    'streamer_score', v_me, 'chat_score', v_chat
  );
end;
$$;

revoke execute on function public.start_game(text, int, int, boolean, boolean) from public, anon;
grant execute on function public.start_game(text, int, int, boolean, boolean) to authenticated;
