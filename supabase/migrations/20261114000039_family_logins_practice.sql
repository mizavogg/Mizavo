-- Migration 39: family logins + practice mode (Nov 13, 2026)
--
-- Family logins: accounts Aiden makes on the admin page for people too young for Twitch.
--   * Username + password only. No email is ever sent or stored (the account's address is a
--     made-up <username>@family.mizavo.gg that only exists so Supabase's password login works).
--   * Each family login gets its own player record in `channels` (id starts with 99, login fam_<name>),
--     so it plays today's daily challenge and shows on the solo boards under its board name.
--   * It can NOT host streamer-vs-chat games (that needs a Twitch login).
--   * Turning a login off blocks sign-in and play straight away.
-- Practice mode (family logins only, for now): after today's daily, unlimited 10-question rounds.
--   * Never on any board. Never touches question use counts, so it doesn't use up daily questions.
--   * Never repeats a question for that player (same no-repeat rule as everything else).
--   * Prefers questions that have already been in past dailies (they can never be in a future daily).
--   * Never shows today's daily questions.

-- ---------- family logins ----------
create table public.family_logins (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{2,20}$'),
  shown_name   text not null check (char_length(shown_name) between 2 and 20),  -- the name as typed (e.g. "Doc")
  channel_id   text not null unique references public.channels (id) on delete cascade,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.family_logins enable row level security;   -- no policies: only the functions below read it
create sequence private.family_channel_seq;

create or replace function private.is_family() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.family_logins where user_id = (select auth.uid()))
$$;

-- a turned-off family login can't play anything, even with a session still open
create or replace function private.my_channel() returns text
language plpgsql stable set search_path to '' as $function$
declare v text; v_login text;
begin
  select c.id, c.login into v, v_login from public.channels c where c.owner_user_id = (select auth.uid());
  if v is null then
    raise exception 'no_channel: this login has no Mizavo channel yet';
  end if;
  if exists (select 1 from public.family_logins f where f.user_id = (select auth.uid()) and not f.active) then
    raise exception 'family_off: this family login has been turned off';
  end if;
  if not private.can_play(v_login) then
    raise exception 'not_invited: Mizavo is in a closed test and this channel is not on the invite list yet';
  end if;
  return v;
end;
$function$;

-- family logins can always play, even if the closed test is switched back on
create or replace function private.can_play(p_login text) returns boolean
language sql stable set search_path to '' as $function$
  select not (select invite_only from private.app_flags)
      or exists (select 1 from public.invites i where i.login = lower(p_login))
      or exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
      or exists (select 1 from public.family_logins f where f.user_id = (select auth.uid()) and f.active)
$function$;

-- the game page: a family login gets a clear message instead of "needs Twitch"
create or replace function public.ensure_my_channel() returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_twitch_id text; v_data jsonb;
  v_login text; v_display text;
  c public.channels;
begin
  if v_uid is null then raise exception 'not_logged_in: log in with Twitch first'; end if;

  if exists (select 1 from public.family_logins f where f.user_id = v_uid) then
    raise exception 'family_account: family logins can play the daily challenge and practice. Playing against a Twitch chat needs a Twitch login';
  end if;

  select i.provider_id, i.identity_data into v_twitch_id, v_data
  from auth.identities i
  where i.user_id = v_uid and i.provider = 'twitch'
  order by i.last_sign_in_at desc nulls last
  limit 1;
  if v_twitch_id is null then raise exception 'not_twitch: Mizavo channels need a Twitch login'; end if;

  select lower(x) into v_login
  from unnest(array[v_data ->> 'slug', v_data ->> 'preferred_username', v_data ->> 'user_name',
                    v_data ->> 'name', v_data ->> 'nickname', v_data ->> 'full_name']) as x
  where lower(x) ~ '^[a-z0-9_]{1,25}$'
  limit 1;
  v_login := coalesce(v_login, 'user_' || left(v_twitch_id, 20));

  select x into v_display
  from unnest(array[v_data ->> 'nickname', v_data ->> 'full_name', v_data ->> 'name',
                    v_data ->> 'preferred_username']) as x
  where char_length(trim(coalesce(x, ''))) between 1 and 50
  limit 1;
  v_display := coalesce(trim(v_display), v_login);

  insert into public.channels (id, owner_user_id, login, display_name)
  values (v_twitch_id, v_uid, v_login, v_display)
  on conflict (id) do update
    set login = excluded.login, display_name = excluded.display_name
    where public.channels.owner_user_id = excluded.owner_user_id;

  select * into c from public.channels where id = v_twitch_id;
  if c.owner_user_id <> v_uid then
    raise exception 'channel_conflict: this Twitch channel is already linked to a different Mizavo login';
  end if;

  return jsonb_build_object(
    'channel_id', c.id, 'login', c.login, 'display_name', c.display_name,
    'settings', c.settings, 'created_at', c.created_at,
    'is_admin', exists (select 1 from public.admins a where a.user_id = v_uid)
  );
end;
$function$;

-- belt and braces: a family player record can never host a streamer-vs-chat game, even by calling start_game directly
create or replace function private.sessions_no_family() returns trigger
language plpgsql set search_path to '' as $$
begin
  if exists (select 1 from public.family_logins f where f.channel_id = new.channel_id) then
    raise exception 'family_account: family logins can''t host games against a Twitch chat';
  end if;
  return new;
end;
$$;
create trigger sessions_no_family before insert on public.sessions
  for each row execute function private.sessions_no_family();

-- the family page asks "who am I?"
create or replace function public.family_me() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare f public.family_logins; c public.channels;
begin
  select * into f from public.family_logins where user_id = (select auth.uid());
  if not found then raise exception 'not_family: this isn''t a family login'; end if;
  if not f.active then raise exception 'family_off: this family login has been turned off'; end if;
  select * into c from public.channels where id = f.channel_id;
  return jsonb_build_object('username', f.shown_name, 'login', c.login, 'display_name', c.display_name);
end;
$$;

-- ---------- admin: make / list / switch off / reset password ----------
create or replace function public.admin_create_family_login(p_username text, p_password text, p_board_name text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_name text := trim(coalesce(p_username, ''));
  v_user text := lower(v_name);
  v_board text := trim(coalesce(nullif(trim(coalesce(p_board_name, '')), ''), v_name));
  v_uid uuid := gen_random_uuid();
  v_email text;
  v_ch text;
begin
  if not private.is_admin() then raise exception 'not_admin: admins only'; end if;
  if v_user !~ '^[a-z0-9_]{2,20}$' then
    raise exception 'bad_username: 2 to 20 letters, numbers or underscores';
  end if;
  if char_length(coalesce(p_password, '')) < 6 or char_length(p_password) > 72 then
    raise exception 'bad_password: 6 to 72 characters';
  end if;
  if char_length(v_board) not between 2 and 20 then
    raise exception 'bad_board_name: 2 to 20 characters';
  end if;
  if exists (select 1 from public.family_logins where username = v_user)
     or exists (select 1 from public.channels where login = 'fam_' || v_user) then
    raise exception 'username_taken: that username is already used';
  end if;
  v_email := v_user || '@family.mizavo.gg';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'username_taken: that username is already used';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token,
                          is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'family', true),
          jsonb_build_object('name', v_board), now(), now(),
          '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text, 'email',
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
          null, now(), now());

  v_ch := '99' || lpad(nextval('private.family_channel_seq')::text, 18, '0');
  insert into public.channels (id, owner_user_id, login, display_name) values (v_ch, v_uid, 'fam_' || v_user, v_board);
  insert into public.family_logins (user_id, username, shown_name, channel_id) values (v_uid, v_user, v_name, v_ch);
  return jsonb_build_object('user_id', v_uid, 'username', v_name, 'board_name', v_board);
end;
$$;

create or replace function public.admin_list_family_logins() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_admin() then raise exception 'not_admin: admins only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', f.user_id, 'username', f.shown_name, 'board_name', c.display_name, 'active', f.active,
      'created_at', f.created_at,
      'dailies', (select count(*) from public.solo_games g where g.player_id = f.channel_id and g.finished_at is not null),
      'practice', (select count(*) from public.practice_games p where p.player_id = f.channel_id and p.finished_at is not null),
      'last_played', greatest((select max(started_at) from public.solo_games g where g.player_id = f.channel_id),
                              (select max(started_at) from public.practice_games p where p.player_id = f.channel_id)))
      order by f.created_at)
    from public.family_logins f join public.channels c on c.id = f.channel_id), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_family_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_admin() then raise exception 'not_admin: admins only'; end if;
  update public.family_logins set active = p_active where user_id = p_user;
  if not found then raise exception 'not_found: no such family login'; end if;
  -- off: Supabase refuses to sign this account in; on: allowed again
  update auth.users set banned_until = case when p_active then null else 'infinity'::timestamptz end, updated_at = now()
  where id = p_user;
  if not p_active then delete from auth.sessions where user_id = p_user; end if;   -- logs out any open session
end;
$$;

create or replace function public.admin_set_family_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_admin() then raise exception 'not_admin: admins only'; end if;
  if char_length(coalesce(p_password, '')) < 6 or char_length(p_password) > 72 then
    raise exception 'bad_password: 6 to 72 characters';
  end if;
  if not exists (select 1 from public.family_logins where user_id = p_user) then
    raise exception 'not_found: no such family login';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user;
end;
$$;

-- ---------- practice mode ----------
create table public.practice_games (
  id           uuid primary key default gen_random_uuid(),
  player_id    text not null references public.channels (id) on delete cascade,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  points       int not null default 0,
  correct      int not null default 0,
  streak       int not null default 0,
  best_streak  int not null default 0
);
create unique index practice_one_open on public.practice_games (player_id) where finished_at is null;
create table public.practice_rounds (
  game_id      uuid not null references public.practice_games (id) on delete cascade,
  idx          int not null check (idx between 1 and 10),
  question_id  uuid not null references public.questions (id) on delete restrict,
  option_order smallint[],
  shown_at     timestamptz,
  answered_at  timestamptz,
  choice       int,
  correct      boolean,
  points       int not null default 0,
  primary key (game_id, idx)
);
alter table public.practice_games enable row level security;
alter table public.practice_rounds enable row level security;

-- who may practice: active family logins (for now)
create or replace function private.practice_player() returns text
language plpgsql stable set search_path to '' as $$
declare v text := private.my_channel();
begin
  if not exists (select 1 from public.family_logins f where f.channel_id = v and f.active) then
    raise exception 'practice_off: practice is only open to family logins for now';
  end if;
  return v;
end;
$$;

-- rounds opened but not answered within 15 s (+ grace) count as misses
create or replace function private.practice_expire(p_game uuid) returns void
language plpgsql set search_path to '' as $$
declare v_n int;
begin
  update public.practice_rounds
  set answered_at = shown_at + make_interval(secs => private.solo_seconds()), correct = false, points = 0
  where game_id = p_game and shown_at is not null and answered_at is null
    and now() > shown_at + make_interval(secs => private.solo_seconds()) + private.solo_grace();
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;
  update public.practice_games set streak = 0 where id = p_game;
  if exists (select 1 from public.practice_rounds where game_id = p_game and idx = 10 and answered_at is not null) then
    update public.practice_games set finished_at = now() where id = p_game and finished_at is null;
  end if;
end;
$$;

create or replace function private.practice_state(p_player text) returns jsonb
language sql stable set search_path to '' as $$
  with g as (select * from public.practice_games where player_id = p_player
             order by (finished_at is null) desc, started_at desc limit 1)   -- the open game, else the latest
  select jsonb_build_object(
    'game_id', g.id,
    'state', case when g.id is null then 'new' when g.finished_at is not null then 'done' else 'playing' end,
    'next_idx', case when g.id is not null and g.finished_at is null then
                  coalesce((select max(idx) from public.practice_rounds r where r.game_id = g.id and r.answered_at is not null), 0) + 1 end,
    'points', coalesce(g.points, 0), 'correct', coalesce(g.correct, 0), 'best_streak', coalesce(g.best_streak, 0),
    'results', coalesce((select jsonb_agg(coalesce(r.correct, false) order by r.idx) from public.practice_rounds r
                         where r.game_id = g.id and r.answered_at is not null), '[]'::jsonb),
    'games_done', (select count(*) from public.practice_games x where x.player_id = p_player and x.finished_at is not null),
    'daily_done', exists (select 1 from public.solo_games s where s.player_id = p_player
                          and s.play_date = private.today_utc() and s.finished_at is not null))
  from (select 1) one left join g on true;
$$;

create or replace function public.practice_status() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_me text := private.practice_player(); v_g uuid;
begin
  select id into v_g from public.practice_games where player_id = v_me and finished_at is null;
  if v_g is not null then perform private.practice_expire(v_g); end if;
  return private.practice_state(v_me);
end;
$$;

-- start a practice game (or carry on the one already open). Picks all 10 questions now: 3 easy, 4 medium, 3 hard.
create or replace function public.practice_start() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_me text := private.practice_player(); v_today date := private.today_utc();
  v_g uuid; v_need int[] := array[3, 4, 3]; d int; got int; n int := 0; r record;
  keys text[] := '{}';
begin
  perform pg_advisory_xact_lock(hashtextextended('practice:' || v_me, 0));
  select id into v_g from public.practice_games where player_id = v_me and finished_at is null;
  if v_g is not null then
    perform private.practice_expire(v_g);
    if exists (select 1 from public.practice_games where id = v_g and finished_at is null) then
      return private.practice_state(v_me);
    end if;
  end if;
  if not exists (select 1 from public.solo_games s where s.player_id = v_me and s.play_date = v_today and s.finished_at is not null) then
    raise exception 'daily_first: play today''s challenge first, then practice is unlocked';
  end if;

  insert into public.practice_games (player_id) values (v_me) returning id into v_g;
  for d in 1..3 loop
    got := 0;
    for r in
      select q.id, q.fact_key, q.mode
      from public.questions q
      where q.status = 'approved' and q.difficulty = d
        -- never a question (or the same fact) this player has already seen anywhere
        and not exists (select 1 from public.channel_seen cs join public.questions q2 on q2.id = cs.question_id
                        where cs.channel_id = v_me and (cs.question_id = q.id or q2.fact_key = q.fact_key))
        and not exists (select 1 from public.practice_rounds pr join public.practice_games pg on pg.id = pr.game_id
                        join public.questions q3 on q3.id = pr.question_id
                        where pg.player_id = v_me and (pr.question_id = q.id or q3.fact_key = q.fact_key))
        -- never today's (or a future, already-built) daily
        and not exists (select 1 from public.solo_days sd join public.questions q4 on q4.id = sd.question_id
                        where sd.play_date >= v_today and (sd.question_id = q.id or q4.fact_key = q.fact_key))
      order by
        exists (select 1 from public.solo_days sd where sd.question_id = q.id) desc,   -- past dailies first
        q.times_used desc,                                                             -- then the most-used (least likely in a future daily)
        md5(v_g::text || q.id::text)
    loop
      exit when got = v_need[d];
      continue when r.fact_key = any(keys);
      n := n + 1; got := got + 1; keys := keys || r.fact_key;
      insert into public.practice_rounds (game_id, idx, question_id, option_order)
      values (v_g, n, r.id,
        case when r.mode = 'ooo' then
          (select array_agg(k::smallint order by md5(v_g::text || r.id::text || k::text)) from generate_series(0, 3) as k)
        end);
    end loop;
    if got < v_need[d] then
      raise exception 'practice_empty: you''ve played every practice question there is. Amazing! More are coming';
    end if;
  end loop;
  return private.practice_state(v_me);
end;
$$;

create or replace function public.practice_round(p_idx int) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_me text := private.practice_player(); g public.practice_games; pr public.practice_rounds; q public.questions; v_next int;
begin
  select * into g from public.practice_games where player_id = v_me and finished_at is null;
  if not found then raise exception 'not_started: start a practice game first'; end if;
  perform private.practice_expire(g.id);
  v_next := (private.practice_state(v_me) ->> 'next_idx')::int;
  if v_next is null then raise exception 'game_over: this practice game is finished'; end if;
  if p_idx <> v_next then raise exception 'out_of_order: you''re on round %', v_next; end if;
  update public.practice_rounds set shown_at = coalesce(shown_at, now()) where game_id = g.id and idx = p_idx
  returning * into pr;
  select * into q from public.questions where id = pr.question_id;
  insert into public.channel_seen (channel_id, question_id) values (v_me, q.id) on conflict do nothing;
  return jsonb_strip_nulls(jsonb_build_object(
    'idx', p_idx, 'rounds', 10, 'type', q.mode, 'category', q.category,
    'statement', q.payload ->> 'statement',
    'items', case when q.mode = 'ooo' then
               (select jsonb_agg(q.payload -> 'items' -> o.pos::int order by o.n)
                from unnest(pr.option_order) with ordinality as o(pos, n)) end,
    'seconds', private.solo_seconds(),
    'shown_at', pr.shown_at, 'ends_at', pr.shown_at + make_interval(secs => private.solo_seconds())));
end;
$$;

create or replace function public.practice_answer(p_idx int, p_choice int) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_me text := private.practice_player();
  g public.practice_games; pr public.practice_rounds; q public.questions;
  v_pos int; v_late boolean; v_right boolean; v_pts int := 0; v_n int;
begin
  select * into g from public.practice_games where player_id = v_me and finished_at is null for update;
  if not found then raise exception 'not_started: start a practice game first'; end if;
  select * into pr from public.practice_rounds where game_id = g.id and idx = p_idx;
  if not found or pr.shown_at is null then raise exception 'round_not_shown: open round % first', p_idx; end if;
  if pr.answered_at is not null then raise exception 'already_answered: round % is done', p_idx; end if;
  select * into q from public.questions where id = pr.question_id;
  v_n := case when q.mode = 'ff' then 2 else 4 end;
  if p_choice is not null and (p_choice < 0 or p_choice >= v_n) then raise exception 'bad_choice: pick 0-%', v_n - 1; end if;
  v_pos   := private.correct_position(q.mode, q.answer, pr.option_order);
  v_late  := now() > pr.shown_at + make_interval(secs => private.solo_seconds()) + private.solo_grace();
  v_right := not v_late and p_choice is not null and p_choice = v_pos;
  if v_right then g.streak := g.streak + 1; v_pts := 100 + least(5, g.streak - 1) * 20; else g.streak := 0; end if;
  update public.practice_rounds
  set answered_at = now(), choice = case when v_late then null else p_choice end, correct = v_right, points = v_pts
  where game_id = g.id and idx = p_idx;
  update public.practice_games
  set points = points + v_pts, correct = correct + v_right::int, streak = g.streak,
      best_streak = greatest(best_streak, g.streak),
      finished_at = case when p_idx = 10 then now() end
  where id = g.id returning * into g;
  return jsonb_build_object(
    'idx', p_idx, 'correct_position', v_pos, 'explanation', q.explanation,
    'correct', v_right, 'late', v_late, 'points_gained', v_pts,
    'points', g.points, 'score', g.correct, 'streak', g.streak, 'is_last', p_idx = 10)
    || case when p_idx = 10 then jsonb_build_object('state', private.practice_state(v_me)) else '{}'::jsonb end;
end;
$$;

-- who can call what: logged-in users only for the game functions; admin functions check admin themselves
revoke execute on function public.family_me(), public.practice_status(), public.practice_start(),
  public.practice_round(int), public.practice_answer(int, int),
  public.admin_create_family_login(text, text, text), public.admin_list_family_logins(),
  public.admin_set_family_active(uuid, boolean), public.admin_set_family_password(uuid, text)
  from public, anon;
grant execute on function public.family_me(), public.practice_status(), public.practice_start(),
  public.practice_round(int), public.practice_answer(int, int),
  public.admin_create_family_login(text, text, text), public.admin_list_family_logins(),
  public.admin_set_family_active(uuid, boolean), public.admin_set_family_password(uuid, text)
  to authenticated;
revoke execute on function private.is_family(), private.practice_player(), private.practice_expire(uuid),
  private.practice_state(text), private.sessions_no_family() from public, anon, authenticated;
