-- Migration 25: community panel (option B, in-game only)
-- One read-only function for the logged-in streamer's OWN channel:
--   record vs chat (finished, non-test games), total viewers, top N viewers by points.
-- Option A (public page) can reuse this logic later.

create or replace function public.get_my_community(p_top int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_ch text := private.my_channel();   -- raises if not logged in / not invited
begin
  p_top := least(greatest(coalesce(p_top, 10), 1), 50);

  return jsonb_build_object(
    -- streamer vs chat, one row per finished real game
    'record', (
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
        where s.channel_id = v_ch and s.status = 'finished' and not s.is_test
        group by s.id
      ) t),

    'total_viewers', (select count(*) from public.viewer_scores where channel_id = v_ch),

    -- leaderboard: points first; ties go to more correct answers, then whoever got there first
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', x.rank, 'name', x.display_name, 'points', x.points,
               'accuracy', x.accuracy, 'best_streak', x.best_streak, 'games', x.games_played)
             order by x.rank)
      from (
        select row_number() over (order by points desc, correct desc, updated_at asc) as rank,
               display_name, points, best_streak, games_played,
               round(100.0 * correct / nullif(answers, 0))::int as accuracy
        from public.viewer_scores
        where channel_id = v_ch
        order by rank
        limit p_top
      ) x), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_community(int) from public, anon;
grant execute on function public.get_my_community(int) to authenticated;

-- Test games never touch viewer_scores (server-side guard; Aiden's rule: test games don't count).
-- Same as before except: the viewer_scores insert is skipped when s.is_test,
-- and viewers_saved reports 0 for test games.
create or replace function public.finish_game(p_session uuid, p_viewers jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;
