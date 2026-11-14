-- Migration 40: Starting Soon warm-up (Nov 13, 2026)
--
-- A panel streamers add once to their OBS "starting soon" scene as a Browser Source.
-- While the scene shows, chat plays by itself: 20-second rounds, ~6 seconds showing the answer, on a loop.
-- Nobody is logged in inside OBS, so each channel has a secret warm-up link (a 24-character code) instead.
-- Aiden's decisions (Nov 13):
--   * warm-up questions count against the channel's no-repeat rule (channel_seen)
--   * viewer points go on the channel's main viewer board (viewer_scores), same points rule as real games
--   * 20-second rounds; the panel pauses itself after 3 rounds in a row with no answers (client side)
-- Warm-ups have no streamer pick, so they are not games: no sessions row, nothing on the streamer's record
-- or the "top channels today" board.
-- Trust: the server hands out one question at a time, never before the last one's time is up, and only
-- reveals the answer once the 20 seconds are over. Like real games, votes are read from chat by the browser.

create table public.warmup_links (
  channel_id  text primary key references public.channels (id) on delete cascade,
  code        text not null unique check (code ~ '^[a-f0-9]{24}$'),
  created_at  timestamptz not null default now()
);
create table public.warmups (
  id          uuid primary key default gen_random_uuid(),
  channel_id  text not null references public.channels (id) on delete cascade,
  started_at  timestamptz not null default now()
);
create index warmups_channel on public.warmups (channel_id, started_at desc);
create table public.warmup_rounds (
  warmup_id    uuid not null references public.warmups (id) on delete cascade,
  idx          int not null check (idx >= 1),
  question_id  uuid not null references public.questions (id) on delete restrict,
  option_order smallint[],
  shown_at     timestamptz not null default now(),
  ends_at      timestamptz not null,
  revealed_at  timestamptz,
  votes        int,
  right_votes  int,
  primary key (warmup_id, idx)
);
-- each viewer's running numbers in one warm-up (for the streak bonus and the "Top this warm-up" list)
create table public.warmup_viewers (
  warmup_id    uuid not null references public.warmups (id) on delete cascade,
  viewer_id    text not null,
  display_name text not null,
  points       int not null default 0,
  answers      int not null default 0,
  correct      int not null default 0,
  streak       int not null default 0,
  best_streak  int not null default 0,
  primary key (warmup_id, viewer_id)
);
alter table public.warmup_links enable row level security;
alter table public.warmups enable row level security;
alter table public.warmup_rounds enable row level security;
alter table public.warmup_viewers enable row level security;

create or replace function private.warmup_seconds() returns int language sql immutable as $$ select 20 $$;

-- the secret code -> its channel (only real Twitch channels; family logins never get a link)
create or replace function private.warmup_channel(p_code text) returns text
language plpgsql stable set search_path to '' as $$
declare v text;
begin
  if coalesce(p_code, '') !~ '^[a-f0-9]{24}$' then raise exception 'bad_link: this warm-up link isn''t valid'; end if;
  select l.channel_id into v from public.warmup_links l where l.code = p_code;
  if v is null then raise exception 'bad_link: this warm-up link isn''t valid (it may have been replaced with a new one)'; end if;
  return v;
end;
$$;

-- ---------- the streamer's link (logged in, on the setup screen) ----------
create or replace function public.my_warmup_link(p_new boolean default false) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_ch text := private.my_channel(); v_code text;
begin
  if exists (select 1 from public.family_logins f where f.channel_id = v_ch) then
    raise exception 'family_account: warm-ups need a Twitch channel';
  end if;
  if p_new then delete from public.warmup_links where channel_id = v_ch; end if;   -- the old link stops working
  select code into v_code from public.warmup_links where channel_id = v_ch;
  if v_code is null then
    v_code := encode(extensions.gen_random_bytes(12), 'hex');                      -- 96 random bits: unguessable
    insert into public.warmup_links (channel_id, code) values (v_ch, v_code);
  end if;
  return jsonb_build_object('code', v_code);
end;
$$;

-- ---------- the OBS panel (not logged in; uses the code) ----------
create or replace function public.warmup_start(p_code text) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_ch text := private.warmup_channel(p_code); c public.channels; v_id uuid;
begin
  select * into c from public.channels where id = v_ch;
  -- a channel can't open warm-ups faster than one every 5 seconds (OBS reloads are fine; spam isn't)
  if exists (select 1 from public.warmups w where w.channel_id = v_ch and w.started_at > now() - interval '5 seconds') then
    raise exception 'slow_down: try again in a few seconds';
  end if;
  insert into public.warmups (channel_id) values (v_ch) returning id into v_id;
  return jsonb_build_object('warmup_id', v_id, 'login', c.login, 'display_name', c.display_name,
                            'seconds', private.warmup_seconds());
end;
$$;

-- next question. Picks like a real game: unseen by this channel (question and fact), today's pool first,
-- the channel's chosen topics if it picked any, a 30/40/30 easy/medium/hard mix. Never today's daily challenge.
create or replace function public.warmup_round(p_code text, p_warmup uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_ch text := private.warmup_channel(p_code); v_date date := private.today_utc();
  v_cats text[]; v_diff int; v_idx int; v_last public.warmup_rounds; q public.questions; r public.warmup_rounds; pass int;
  v_rand float8 := random();
begin
  perform 1 from public.warmups where id = p_warmup and channel_id = v_ch for update;
  if not found then raise exception 'bad_warmup: no such warm-up'; end if;
  select * into v_last from public.warmup_rounds where warmup_id = p_warmup order by idx desc limit 1;
  if v_last.warmup_id is not null and now() < v_last.ends_at then
    raise exception 'too_soon: the current round isn''t over yet';
  end if;
  v_idx := coalesce(v_last.idx, 0) + 1;
  select private.clean_categories(array(select jsonb_array_elements_text(c.settings -> 'categories')))
    into v_cats from public.channels c where c.id = v_ch and c.settings ? 'categories';
  v_diff := case when v_rand < 0.3 then 1 when v_rand < 0.7 then 2 else 3 end;

  -- passes: 1 = today's pool + picked topics + this difficulty, 2 = whole bank + picked topics + this difficulty,
  --         3 = whole bank + picked topics + any difficulty, 4 = whole bank + any topic + any difficulty
  for pass in 1..4 loop
    select qq.* into q
    from public.questions qq
    where qq.status = 'approved'
      and (pass >= 3 or qq.difficulty = v_diff)
      and (pass = 4 or v_cats is null or qq.category = any(v_cats))
      and (pass <> 1 or exists (select 1 from public.daily_pools p where p.pool_date = v_date and p.question_id = qq.id))
      and not exists (select 1 from public.channel_seen s where s.channel_id = v_ch and (s.question_id = qq.id or s.fact_key = qq.fact_key))
      and not exists (select 1 from public.solo_days sd join public.questions q4 on q4.id = sd.question_id
                      where sd.play_date >= v_date and (sd.question_id = qq.id or q4.fact_key = qq.fact_key))
    order by qq.times_used, random()
    limit 1;
    exit when q.id is not null;
  end loop;
  if q.id is null then raise exception 'not_enough_questions: this channel has seen every question'; end if;

  insert into public.warmup_rounds (warmup_id, idx, question_id, option_order, ends_at)
  values (p_warmup, v_idx, q.id,
    case when q.mode = 'ooo' then (select array_agg(k::smallint order by random()) from generate_series(0, 3) as k) end,
    now() + make_interval(secs => private.warmup_seconds()))
  returning * into r;
  insert into public.channel_seen (channel_id, question_id) values (v_ch, q.id) on conflict do nothing;

  return jsonb_strip_nulls(jsonb_build_object(
    'idx', v_idx, 'type', q.mode, 'category', q.category,
    'statement', q.payload ->> 'statement',
    'items', case when q.mode = 'ooo' then
               (select jsonb_agg(q.payload -> 'items' -> o.pos::int order by o.n)
                from unnest(r.option_order) with ordinality as o(pos, n)) end,
    'seconds', private.warmup_seconds(), 'ends_at', r.ends_at));
end;
$$;

-- time's up: the panel sends chat's first answers; the server scores them and reveals the answer.
-- p_votes: [{"id": "<twitch user id>", "login": "...", "name": "...", "choice": 0-3}, ...]
create or replace function public.warmup_reveal(p_code text, p_warmup uuid, p_idx int, p_votes jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_ch text := private.warmup_channel(p_code);
  r public.warmup_rounds; q public.questions; v_pos int; v_n int; v_opts int; bad text; v record;
  w public.warmup_viewers; v_right boolean; v_pts int; v_new boolean; v_right_n int := 0;
begin
  select wr.* into r from public.warmup_rounds wr join public.warmups w2 on w2.id = wr.warmup_id
  where wr.warmup_id = p_warmup and wr.idx = p_idx and w2.channel_id = v_ch for update of wr;
  if not found then raise exception 'bad_round: no such warm-up round'; end if;
  if r.revealed_at is not null then raise exception 'already_revealed: round % is done', p_idx; end if;
  if now() < r.ends_at - interval '2 seconds' then raise exception 'too_soon: time isn''t up yet'; end if;
  select * into q from public.questions where id = r.question_id;
  v_pos := private.correct_position(q.mode, q.answer, r.option_order);
  v_opts := case when q.mode = 'ff' then 2 else 4 end;

  p_votes := coalesce(p_votes, '[]'::jsonb);
  if jsonb_typeof(p_votes) <> 'array' then raise exception 'bad_votes: votes must be a list'; end if;
  v_n := jsonb_array_length(p_votes);
  if v_n > 5000 then raise exception 'bad_votes: too many votes in one round'; end if;
  -- a round left open too long (the panel was closed mid-round) is revealed without scoring anyone
  if now() > r.ends_at + interval '2 minutes' then p_votes := '[]'::jsonb; v_n := 0; end if;
  select x ->> 'id' into bad from jsonb_array_elements(p_votes) x
  where coalesce(x ->> 'id', '') !~ '^[0-9]{1,20}$'
     or lower(coalesce(x ->> 'login', '')) !~ '^[a-z0-9_]{1,25}$'
     or char_length(coalesce(x ->> 'name', '')) not between 1 and 50
     or jsonb_typeof(x -> 'choice') <> 'number' or (x ->> 'choice')::int not between 0 and v_opts - 1
  limit 1;
  if found then raise exception 'bad_votes: a vote isn''t valid (%)', coalesce(bad, 'no id'); end if;
  if (select count(distinct x ->> 'id') from jsonb_array_elements(p_votes) x) <> v_n then
    raise exception 'bad_votes: the same viewer appears twice';
  end if;

  for v in select x ->> 'id' as id, lower(x ->> 'login') as login, x ->> 'name' as name, (x ->> 'choice')::int as choice
           from jsonb_array_elements(p_votes) x loop
    v_right := v.choice = v_pos;
    -- this warm-up's running numbers for the viewer (streak bonus: same rule as real games, 100 + up to +100)
    insert into public.warmup_viewers (warmup_id, viewer_id, display_name) values (p_warmup, v.id, v.name)
    on conflict do nothing;
    v_new := found;
    select * into w from public.warmup_viewers where warmup_id = p_warmup and viewer_id = v.id for update;
    if v_right then w.streak := w.streak + 1; v_pts := 100 + least(5, w.streak - 1) * 20; v_right_n := v_right_n + 1;
    else w.streak := 0; v_pts := 0; end if;
    update public.warmup_viewers set display_name = v.name, points = points + v_pts, answers = answers + 1,
      correct = correct + v_right::int, streak = w.streak, best_streak = greatest(best_streak, w.streak)
    where warmup_id = p_warmup and viewer_id = v.id;
    -- the channel's main viewer board; each warm-up counts once in "games played"
    insert into public.viewer_scores as vs
      (channel_id, viewer_id, viewer_login, display_name, points, answers, correct, best_streak, games_played, last_played_at)
    values (v_ch, v.id, v.login, v.name, v_pts, 1, v_right::int, case when v_right then w.streak else 0 end, 1, now())
    on conflict (channel_id, viewer_id) do update set
      viewer_login = excluded.viewer_login, display_name = excluded.display_name,
      points = vs.points + excluded.points, answers = vs.answers + 1, correct = vs.correct + excluded.correct,
      best_streak = greatest(vs.best_streak, excluded.best_streak),
      games_played = vs.games_played + case when v_new then 1 else 0 end,
      last_played_at = now();
  end loop;

  update public.warmup_rounds set revealed_at = now(), votes = v_n, right_votes = v_right_n
  where warmup_id = p_warmup and idx = p_idx;

  return jsonb_build_object(
    'idx', p_idx, 'correct_position', v_pos, 'explanation', q.explanation, 'votes', v_n, 'right', v_right_n,
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', t.display_name, 'correct', t.correct, 'points', t.points, 'streak', t.streak)
                                      order by t.points desc, t.correct desc)
                     from (select * from public.warmup_viewers where warmup_id = p_warmup and correct > 0
                           order by points desc, correct desc limit 5) t), '[]'::jsonb));
end;
$$;

revoke execute on function public.my_warmup_link(boolean) from public, anon;
grant execute on function public.my_warmup_link(boolean) to authenticated;
revoke execute on function public.warmup_start(text), public.warmup_round(text, uuid), public.warmup_reveal(text, uuid, int, jsonb) from public;
grant execute on function public.warmup_start(text), public.warmup_round(text, uuid), public.warmup_reveal(text, uuid, int, jsonb) to anon, authenticated;
revoke execute on function private.warmup_channel(text), private.warmup_seconds() from public, anon, authenticated;
