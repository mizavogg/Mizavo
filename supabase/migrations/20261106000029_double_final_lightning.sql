-- Migration 29: double-points final round + lightning round (streamer games only)
--
-- Double-points final: the last round counts 2 for streamer vs chat, and viewers earn double points on it.
-- Lightning round: 3 Fact or Fake questions back to back, 10 s each, in the middle of the game
--   (rounds 5-7 of 10, 7-9 of 15, 10-12 of 20). Not in 5-round games or Odd One Out-only games.
-- Both are settings, on by default. Each round now stores its own timer and point weight,
-- and every score (reveal, resume, finish, records, today's board) adds up the weights.

-- 1. columns -----------------------------------------------------------------------------------------
alter table public.sessions add column double_final boolean not null default false;
alter table public.sessions add column lightning_at smallint;            -- first lightning round, or null
comment on column public.sessions.double_final is 'Last round counts 2 (streamer vs chat) and pays viewers double.';
comment on column public.sessions.lightning_at is 'First of the 3 lightning rounds (10 s Fact or Fake), or null for none.';

alter table public.session_rounds add column seconds smallint;            -- null = the game's timer
alter table public.session_rounds add column weight smallint not null default 1 check (weight in (1, 2));

-- remembered settings may now include the two switches
alter table public.channels drop constraint settings_valid;
alter table public.channels add constraint settings_valid check (
  jsonb_typeof(settings) = 'object'
  and settings - array['mode', 'rounds', 'seconds', 'blind', 'double', 'lightning'] = '{}'::jsonb
  and (not settings ? 'mode'      or settings ->> 'mode'    in ('ff', 'ooo', 'mix'))
  and (not settings ? 'rounds'    or settings ->> 'rounds'  in ('5', '10', '15', '20'))
  and (not settings ? 'seconds'   or settings ->> 'seconds' in ('10', '15', '20', '30'))
  and (not settings ? 'blind'     or jsonb_typeof(settings -> 'blind') = 'boolean')
  and (not settings ? 'double'    or jsonb_typeof(settings -> 'double') = 'boolean')
  and (not settings ? 'lightning' or jsonb_typeof(settings -> 'lightning') = 'boolean'));

-- 2. guards: the new game settings and round timers/weights are fixed once written ---------------------
create or replace function private.sessions_guard_update() returns trigger
language plpgsql set search_path to '' as $function$
begin
  if (new.id, new.channel_id, new.play_date, new.game_number, new.seed,
      new.mode, new.rounds, new.seconds, new.blind, new.is_test, new.started_at,
      new.double_final, new.lightning_at)
     is distinct from
     (old.id, old.channel_id, old.play_date, old.game_number, old.seed,
      old.mode, old.rounds, old.seconds, old.blind, old.is_test, old.started_at,
      old.double_final, old.lightning_at) then
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
$function$;

create or replace function private.session_rounds_validate() returns trigger
language plpgsql set search_path to '' as $function$
declare
  s_rounds smallint; s_mode text; s_status text;
  q_mode text; q_answer jsonb;
  n_opts int; correct_pos int; top int; top_count int;
begin
  if tg_op = 'UPDATE' then
    if old.revealed_at is not null then
      raise exception 'round % of session % is already revealed and cannot change', old.idx, old.session_id;
    end if;
    if (new.session_id, new.idx, new.question_id, new.option_order, new.seconds, new.weight)
       is distinct from (old.session_id, old.idx, old.question_id, old.option_order, old.seconds, old.weight) then
      raise exception 'the question, timer and weight drawn for a round cannot be changed';
    end if;
  end if;

  select s.rounds, s.mode, s.status into s_rounds, s_mode, s_status
  from public.sessions s where s.id = new.session_id;
  if s_status is null then raise exception 'session % does not exist', new.session_id; end if;
  if s_status <> 'active' then raise exception 'session % is %, its rounds cannot change', new.session_id, s_status; end if;
  if new.idx > s_rounds then raise exception 'round % is beyond this game''s % rounds', new.idx, s_rounds; end if;

  select q.mode, q.answer into q_mode, q_answer from public.questions q where q.id = new.question_id;
  if q_mode is null then raise exception 'question % does not exist', new.question_id; end if;
  if s_mode <> 'mix' and s_mode <> q_mode then
    raise exception 'a % question cannot be played in a % game', q_mode, s_mode;
  end if;

  if q_mode = 'ff' then
    if new.option_order is not null then raise exception 'Fact or Fake rounds have no option order'; end if;
    n_opts := 2;
    correct_pos := case when q_answer = 'true'::jsonb then 0 else 1 end;
  else
    if new.option_order is null
       or array_length(new.option_order, 1) <> 4
       or (select array_agg(x order by x) from unnest(new.option_order) as x) <> array[0,1,2,3]::smallint[] then
      raise exception 'Odd One Out option order must be a shuffle of 0,1,2,3';
    end if;
    n_opts := 4;
    correct_pos := array_position(new.option_order, (q_answer #>> '{}')::smallint) - 1;
  end if;

  if new.revealed_at is not null and new.shown_at is null then
    raise exception 'a round cannot be revealed before it is shown';
  end if;
  if new.revealed_at < new.shown_at then raise exception 'reveal time cannot be before show time'; end if;

  if new.revealed_at is null then
    if new.streamer_choice is not null or new.chat_counts is not null or new.chat_total is not null
       or new.streamer_correct is not null or new.chat_correct is not null then
      raise exception 'picks, votes and results are only saved at the reveal';
    end if;
    return new;
  end if;

  if new.streamer_choice is not null and new.streamer_choice >= n_opts then
    raise exception 'streamer picked option %, but there are only % options', new.streamer_choice, n_opts;
  end if;
  if new.chat_counts is null or coalesce(array_length(new.chat_counts, 1), 0) <> n_opts
     or exists (select 1 from unnest(new.chat_counts) as c where c is null or c < 0) then
    raise exception 'chat_counts must have one non-negative count per option (% options)', n_opts;
  end if;

  new.chat_total := (select sum(c) from unnest(new.chat_counts) as c);
  new.streamer_correct := coalesce(new.streamer_choice = correct_pos, false);

  select max(c) into top_count from unnest(new.chat_counts) as c;
  if new.chat_total = 0 or (select count(*) from unnest(new.chat_counts) as c where c = top_count) > 1 then
    new.chat_correct := false;
  else
    top := array_position(new.chat_counts, top_count) - 1;
    new.chat_correct := (top = correct_pos);
  end if;
  return new;
end;
$function$;

-- 3. weighted score helper ------------------------------------------------------------------------
create or replace function private.session_scores(p_session uuid, out me int, out chat int)
language sql stable set search_path to '' as $$
  select coalesce(sum(weight) filter (where streamer_correct), 0)::int,
         coalesce(sum(weight) filter (where chat_correct), 0)::int
  from public.session_rounds where session_id = p_session;
$$;

-- 4. start_game: two new switches (on by default) --------------------------------------------------
drop function public.start_game(text, int, int, boolean, boolean);
create function public.start_game(p_mode text, p_rounds int, p_seconds int, p_blind boolean,
                                  p_test boolean default false, p_double boolean default true,
                                  p_lightning boolean default true)
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
  v_need  int[];
  v_light smallint;
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
  i int; j int; k2 int; tmp int; best int;
begin
  if p_mode not in ('ff', 'ooo', 'mix') or p_rounds not in (5, 10, 15, 20)
     or p_seconds not in (10, 15, 20, 30) or p_blind is null or p_test is null
     or p_double is null or p_lightning is null then
    raise exception 'bad_settings: mode, rounds, seconds or a switch is not a valid option';
  end if;

  if exists (select 1 from public.sessions s where s.channel_id = v_ch and s.status = 'active') then
    raise exception 'game_in_progress: finish or abandon the current game first';
  end if;

  select coalesce(max(s.game_number), 0) + 1 into v_game
  from public.sessions s where s.channel_id = v_ch and s.play_date = v_date;

  v_seed := hashtextextended(v_ch || ':' || v_date::text || ':' || v_game::text, 0);

  v_need := array[round(p_rounds * 0.3)::int, 0, floor(p_rounds * 0.3)::int];
  v_need[2] := p_rounds - v_need[1] - v_need[3];

  for d in 1..3 loop
    got := 0;
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

  -- order: easy -> medium -> hard, shuffled inside each group by the seed
  select array_agg(k order by diffs[k], hashes[k]) into ord from generate_subscripts(ids, 1) as k;

  -- no two neighbours share a category
  for i in 2..array_length(ord, 1) loop
    if cats[ord[i]] = cats[ord[i - 1]] then
      j := null;
      for k2 in i + 1 .. array_length(ord, 1) loop
        if cats[ord[k2]] <> cats[ord[i - 1]] then
          if diffs[ord[k2]] = diffs[ord[i]] then j := k2; exit; end if;
          if j is null then j := k2; end if;
        end if;
      end loop;
      if j is not null then tmp := ord[i]; ord[i] := ord[j]; ord[j] := tmp; end if;
    end if;
  end loop;

  -- lightning: 3 Fact or Fake rounds in the middle (10 -> 5-7, 15 -> 7-9, 20 -> 10-12).
  -- Odd One Out questions in that block swap with the nearest Fact or Fake outside it
  -- (same difficulty if possible). Skipped quietly if a mixed game drew fewer than 3 Fact or Fake.
  if p_lightning and p_rounds >= 10 and p_mode in ('ff', 'mix')
     and (select count(*) from unnest(modes) m where m = 'ff') >= 3 then
    v_light := (p_rounds / 2)::smallint;
    for i in v_light .. v_light + 2 loop
      if modes[ord[i]] <> 'ff' then
        best := null;
        -- nearest Fact or Fake outside the block with the same difficulty; otherwise the nearest one
        for k2 in 1 .. array_length(ord, 1) loop
          continue when k2 between v_light and v_light + 2 or modes[ord[k2]] <> 'ff' or diffs[ord[k2]] <> diffs[ord[i]];
          if best is null or abs(k2 - i) < abs(best - i) then best := k2; end if;
        end loop;
        if best is null then
          for k2 in 1 .. array_length(ord, 1) loop
            continue when k2 between v_light and v_light + 2 or modes[ord[k2]] <> 'ff';
            if best is null or abs(k2 - i) < abs(best - i) then best := k2; end if;
          end loop;
        end if;
        tmp := ord[i]; ord[i] := ord[best]; ord[best] := tmp;
      end if;
    end loop;
  end if;

  insert into public.sessions (channel_id, play_date, game_number, seed, mode, rounds, seconds, blind, is_test,
                               double_final, lightning_at)
  values (v_ch, v_date, v_game, v_seed, p_mode, p_rounds, p_seconds, p_blind, p_test, p_double, v_light)
  returning id into v_sid;

  for i in 1..array_length(ord, 1) loop
    insert into public.session_rounds (session_id, idx, question_id, option_order, seconds, weight)
    values (
      v_sid, i, ids[ord[i]],
      case when modes[ord[i]] = 'ooo' then
        (select array_agg(k::smallint order by md5(v_seed::text || ids[ord[i]]::text || k::text))
         from generate_series(0, 3) as k)
      end,
      case when v_light is not null and i between v_light and v_light + 2 then 10 end,
      case when p_double and i = p_rounds then 2 else 1 end
    );
  end loop;

  update public.channels
  set settings = jsonb_build_object('mode', p_mode, 'rounds', p_rounds, 'seconds', p_seconds, 'blind', p_blind,
                                    'double', p_double, 'lightning', p_lightning)
  where id = v_ch;

  return jsonb_build_object('session_id', v_sid, 'game_number', v_game, 'mode', p_mode,
                            'rounds', p_rounds, 'seconds', p_seconds, 'blind', p_blind,
                            'is_test', p_test, 'double_final', p_double, 'lightning_at', v_light);
end;
$$;
revoke execute on function public.start_game(text, int, int, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.start_game(text, int, int, boolean, boolean, boolean, boolean) to authenticated;

-- 5. get_round: per-round timer, plus lightning position and weight --------------------------------
create or replace function public.get_round(p_session uuid, p_idx integer)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_ch text := private.my_channel();
  s public.sessions; r public.session_rounds; q public.questions;
  v_items jsonb; v_secs int;
begin
  select * into s from public.sessions where id = p_session and channel_id = v_ch;
  if not found then raise exception 'game_not_found: no such game for this channel'; end if;
  if s.status <> 'active' then raise exception 'game_over: this game is already %', s.status; end if;

  select * into r from public.session_rounds where session_id = p_session and idx = p_idx;
  if not found then raise exception 'round_not_found: this game has no round %', p_idx; end if;

  if p_idx > 1 and exists (select 1 from public.session_rounds
                           where session_id = p_session and idx = p_idx - 1 and revealed_at is null) then
    raise exception 'out_of_order: reveal round % first', p_idx - 1;
  end if;

  if r.shown_at is null then
    update public.session_rounds set shown_at = now()
    where session_id = p_session and idx = p_idx returning * into r;
    insert into public.channel_seen (channel_id, question_id) values (v_ch, r.question_id) on conflict do nothing;
    update public.questions set times_used = times_used + 1 where id = r.question_id;
  end if;

  select * into q from public.questions where id = r.question_id;
  if q.mode = 'ooo' then
    select jsonb_agg(q.payload -> 'items' -> o.pos::int order by o.n) into v_items
    from unnest(r.option_order) with ordinality as o(pos, n);
  end if;
  v_secs := coalesce(r.seconds, s.seconds);

  return jsonb_strip_nulls(jsonb_build_object(
    'idx', r.idx, 'rounds', s.rounds, 'type', q.mode, 'category', q.category,
    'statement', q.payload ->> 'statement', 'items', v_items,
    'seconds', v_secs, 'shown_at', r.shown_at,
    'ends_at', r.shown_at + make_interval(secs => v_secs),
    'weight', r.weight,
    'lightning', case when s.lightning_at is not null and r.idx between s.lightning_at and s.lightning_at + 2
                      then r.idx - s.lightning_at + 1 end
  ));
end;
$function$;

-- 6. reveal_round: per-round timer for the early-reveal rule, weighted scores ---------------------
create or replace function public.reveal_round(p_session uuid, p_idx integer, p_streamer_choice integer, p_chat_counts integer[])
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_ch text := private.my_channel();
  s public.sessions; r public.session_rounds; q public.questions;
  v_pos int; sc record;
begin
  select * into s from public.sessions where id = p_session and channel_id = v_ch;
  if not found then raise exception 'game_not_found: no such game for this channel'; end if;
  if s.status <> 'active' then raise exception 'game_over: this game is already %', s.status; end if;

  select * into r from public.session_rounds where session_id = p_session and idx = p_idx;
  if not found then raise exception 'round_not_found: this game has no round %', p_idx; end if;
  if r.shown_at is null then raise exception 'not_shown: round % has not been shown yet', p_idx; end if;
  if r.revealed_at is not null then raise exception 'already_revealed: round % is already revealed', p_idx; end if;

  -- early reveal is only allowed once the streamer has locked in a pick
  if p_streamer_choice is null and now() < r.shown_at + make_interval(secs => coalesce(r.seconds, s.seconds) - 1) then
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

  select * into sc from private.session_scores(p_session);

  return jsonb_build_object(
    'idx', r.idx,
    'correct_position', v_pos,
    'correct_label', case when q.mode = 'ff' then (case when v_pos = 0 then 'FACT' else 'FAKE' end)
                          else q.payload -> 'items' ->> (q.answer #>> '{}')::int end,
    'explanation', q.explanation,
    'streamer_correct', r.streamer_correct,
    'chat_correct', r.chat_correct,
    'chat_total', r.chat_total,
    'chat_pct_right', case when r.chat_total > 0 then round(100.0 * r.chat_counts[v_pos + 1] / r.chat_total) else 0 end,
    'streamer_score', sc.me,
    'chat_score', sc.chat,
    'weight', r.weight,
    'is_last', r.idx = s.rounds,
    'question_id', q.id
  );
end;
$function$;

-- 7. get_active_game: weighted scores, and the switches for a resumed game -------------------------
create or replace function public.get_active_game()
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_ch text := private.my_channel();
  s public.sessions; v_next int; sc record;
begin
  select * into s from public.sessions where channel_id = v_ch and status = 'active';
  if not found then return null; end if;
  select min(idx) into v_next from public.session_rounds where session_id = s.id and revealed_at is null;
  select * into sc from private.session_scores(s.id);
  return jsonb_build_object(
    'session_id', s.id, 'game_number', s.game_number, 'mode', s.mode, 'rounds', s.rounds,
    'seconds', s.seconds, 'blind', s.blind, 'is_test', s.is_test, 'started_at', s.started_at,
    'double_final', s.double_final, 'lightning_at', s.lightning_at,
    'next_round', v_next,
    'streamer_score', sc.me, 'chat_score', sc.chat
  );
end;
$function$;

-- 8. finish_game: viewer points may include one double round; weighted scores ---------------------
create or replace function public.finish_game(p_session uuid, p_viewers jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_ch text := private.my_channel();
  s public.sessions;
  v_total_votes bigint; v_right_votes bigint;
  v_n int; v_extra int; sc record;
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

  -- a double final round can add up to 200 on top of the normal 100-200 per right answer
  v_extra := case when s.double_final then 200 else 0 end;

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
     or (v ->> 'points')::int < (v ->> 'correct')::int * 100
     or (v ->> 'points')::int > (v ->> 'correct')::int * 200 + case when (v ->> 'correct')::int > 0 then v_extra else 0 end
  limit 1;
  if found then raise exception 'bad_viewers: impossible numbers for viewer %', coalesce(bad, '(no id)'); end if;

  if (select count(distinct v ->> 'id') from jsonb_array_elements(p_viewers) as v) <> v_n then
    raise exception 'bad_viewers: the same viewer appears twice';
  end if;

  select coalesce(sum(r.chat_total), 0),
         coalesce(sum(r.chat_counts[private.correct_position(q.mode, q.answer, r.option_order) + 1]), 0)
  into v_total_votes, v_right_votes
  from public.session_rounds r join public.questions q on q.id = r.question_id
  where r.session_id = p_session;

  if (select coalesce(sum((v ->> 'answers')::int), 0) from jsonb_array_elements(p_viewers) as v) > v_total_votes
     or (select coalesce(sum((v ->> 'correct')::int), 0) from jsonb_array_elements(p_viewers) as v) > v_right_votes then
    raise exception 'bad_viewers: viewer totals are higher than the votes recorded in the rounds';
  end if;

  if s.is_test then
    v_n := 0;   -- test games never add to the leaderboard
  else
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
  end if;

  update public.sessions set status = 'finished', finished_at = now() where id = p_session;
  select * into sc from private.session_scores(p_session);

  return jsonb_build_object(
    'streamer_score', sc.me, 'chat_score', sc.chat, 'rounds', s.rounds, 'viewers_saved', v_n,
    'is_test', s.is_test,
    'max_score', s.rounds + case when s.double_final then 1 else 0 end,
    'today', (
      select jsonb_build_object(
        'games_finished', count(*),
        'chat_won_pct', round(100.0 * count(*) filter (where t.chat > t.me) / nullif(count(*), 0)),
        'streamer_won_pct', round(100.0 * count(*) filter (where t.me > t.chat) / nullif(count(*), 0)),
        'avg_streamer_pct', round(avg(100.0 * t.me / t.total)),
        'avg_chat_pct', round(avg(100.0 * t.chat / t.total)))
      from (
        select sum(rr.weight) as total,
               coalesce(sum(rr.weight) filter (where rr.streamer_correct), 0) as me,
               coalesce(sum(rr.weight) filter (where rr.chat_correct), 0) as chat
        from public.sessions ss join public.session_rounds rr on rr.session_id = ss.id
        where ss.play_date = s.play_date and ss.status = 'finished' and not ss.is_test
        group by ss.id
      ) t
    )
  );
end;
$function$;

-- 9. records and today's board use the weighted scores -------------------------------------------
create or replace function private.channel_record(p_ch text)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'games',  count(*),
    'wins',   count(*) filter (where t.me > t.chat),
    'losses', count(*) filter (where t.chat > t.me),
    'ties',   count(*) filter (where t.me = t.chat))
  from (
    select s.id,
           coalesce(sum(r.weight) filter (where r.streamer_correct), 0) as me,
           coalesce(sum(r.weight) filter (where r.chat_correct), 0)     as chat
    from public.sessions s
    join public.session_rounds r on r.session_id = s.id
    where s.channel_id = p_ch and s.status = 'finished' and not s.is_test
    group by s.id
  ) t;
$$;

create or replace function private.today_board()
returns table (rank bigint, channel_id text, login text, display_name text,
               rounds bigint, chat_pct int, wins bigint, losses bigint, ties bigint)
language sql stable set search_path to '' as $$
  with rnd as (
    select s.channel_id, s.id as session_id, r.streamer_correct, r.chat_correct, r.weight,
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
           coalesce(sum(weight) filter (where streamer_correct), 0) as me,
           coalesce(sum(weight) filter (where chat_correct), 0)     as chat
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

revoke all on function private.session_scores(uuid), private.channel_record(text), private.today_board()
  from public, anon, authenticated;
