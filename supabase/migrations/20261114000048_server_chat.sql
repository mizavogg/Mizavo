-- Mizavo migration 48 (Nov 14, 2026): the server reads Twitch chat, so viewer scores can't be faked.
-- How it works:
--   * Streamers approve "Mizavo's bot in your chat" (channel:bot) when they log in with Twitch.
--   * When a game starts, the twitch-chat Edge Function asks Twitch to send that channel's chat to Mizavo
--     (EventSub channel.chat.message, read as mizavobot). If Twitch agrees, the game is "chat verified".
--   * Each chat message goes to chat_record(): a viewer's FIRST valid answer in a round is saved in chat_votes,
--     only while that round is open (same rules as the game page).
--   * Verified games: reveal_round counts chat from chat_votes, and finish_game works out every viewer's points
--     from chat_votes (the browser's list is ignored).
--   * Not verified (the streamer hasn't re-connected Twitch yet): the game still plays the old way, but it stays
--     off the public boards (today's board, channel records) and doesn't add to viewer leaderboards. (Aiden, Nov 14: option a)
--   * Games from before this change keep counting (chat_verified is true for them).

alter table public.sessions add column chat_verified boolean not null default true;   -- existing games: keep counting
alter table public.sessions alter column chat_verified set default false;             -- new games: false until Twitch agrees
alter table public.sessions add column chat_sub text;                                   -- the Twitch EventSub subscription id
alter table public.channels add column chat_ok boolean not null default false;          -- did this streamer approve channel:bot?

create table public.chat_votes (
  session_id   uuid not null references public.sessions (id) on delete cascade,
  idx          smallint not null,
  viewer_id    text not null check (viewer_id ~ '^[0-9]{1,20}$'),
  viewer_login text not null check (viewer_login ~ '^[a-z0-9_]{1,25}$'),
  display_name text not null check (char_length(display_name) between 1 and 50),
  choice       smallint not null check (choice between 0 and 3),
  sent_at      timestamptz not null,
  primary key (session_id, idx, viewer_id)                -- first answer per viewer per round; later ones are ignored
);
alter table public.chat_votes enable row level security;  -- no policies: only the functions below use it

-- Same rules as the game page's parseVote (game/chat.ts): Fact/Fake = 1/2 (or fact/fake/true/false...), Odd One Out = A–D or 1–4.
create or replace function private.parse_vote(p_text text, p_mode text)
returns smallint language plpgsql immutable set search_path to '' as $$
declare t text := regexp_replace(lower(trim(coalesce(p_text, ''))), '^!(vote|v)\s*', '');
begin
  if p_mode = 'ff' then
    if t ~ '^(1|fact|true|real|yes|t)$' then return 0; end if;
    if t ~ '^(2|fake|false|cap|no)$' then return 1; end if;
    return null;
  end if;
  if t ~ '^[a-d]$' then return ascii(t) - 97; end if;
  if t ~ '^[1-4]$' then return t::int - 1; end if;
  return null;
end $$;

-- One chat message from Twitch (service role only, called by the twitch-chat Edge Function).
-- p_sent = when Twitch sent it. Counts for the newest round that was shown before it and wasn't revealed
-- more than a second before it (chat can arrive a moment after the reveal).
create or replace function public.chat_record(p_broadcaster text, p_viewer_id text, p_login text, p_name text, p_text text, p_sent timestamptz)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_session uuid; r record; v_choice smallint;
begin
  select s.id into v_session from public.sessions s
  where s.channel_id = p_broadcaster and s.status = 'active' and s.chat_verified
  order by s.started_at desc limit 1;
  if v_session is null then return false; end if;

  select rr.idx, q.mode into r
  from public.session_rounds rr join public.questions q on q.id = rr.question_id
  where rr.session_id = v_session and rr.shown_at is not null and rr.shown_at <= p_sent
    and (rr.revealed_at is null or p_sent <= rr.revealed_at + interval '1 second')
  order by rr.idx desc limit 1;
  if not found then return false; end if;

  v_choice := private.parse_vote(p_text, r.mode);
  if v_choice is null or (r.mode = 'ff' and v_choice > 1) then return false; end if;

  insert into public.chat_votes (session_id, idx, viewer_id, viewer_login, display_name, choice, sent_at)
  values (v_session, r.idx, p_viewer_id, lower(p_login), left(coalesce(nullif(trim(p_name), ''), p_login), 50), v_choice, p_sent)
  on conflict do nothing;
  return found;
end $$;

-- After the Edge Function asks Twitch for chat: remember the subscription, and whether it worked.
create or replace function public.chat_set_sub(p_session uuid, p_sub text, p_ok boolean)
returns void language sql security definer set search_path to '' as $$
  update public.sessions set chat_sub = p_sub, chat_verified = (p_ok and p_sub is not null)
  where id = p_session and status = 'active';
  update public.channels set chat_ok = p_ok where id = (select channel_id from public.sessions where id = p_session);
$$;
create or replace function public.chat_set_channel_ok(p_channel text, p_ok boolean)
returns void language sql security definer set search_path to '' as $$
  update public.channels set chat_ok = p_ok where id = p_channel;
$$;
-- Subscriptions to close: games that are over but still have one.
create or replace function public.chat_subs_to_close()
returns table (session_id uuid, sub text) language sql security definer set search_path to '' as $$
  select id, chat_sub from public.sessions
  where chat_sub is not null and (status <> 'active' or started_at < now() - interval '6 hours');
$$;
create or replace function public.chat_sub_closed(p_session uuid)
returns void language sql security definer set search_path to '' as $$
  update public.sessions set chat_sub = null where id = p_session;
$$;
-- Settings for the Edge Function: the bot's Twitch id and the secret Twitch signs chat messages with.
create or replace function public.chat_config()
returns jsonb language sql security definer set search_path to '' as $$
  select jsonb_build_object(
    'bot_id', (select user_id from private.chat_bot),
    'eventsub_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'twitch_eventsub_secret'),
    'cron_key', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_key'));
$$;
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'twitch_eventsub_secret', 'Mizavo: Twitch signs chat messages with this');

revoke all on function public.chat_record(text, text, text, text, text, timestamptz), public.chat_set_sub(uuid, text, boolean),
  public.chat_set_channel_ok(text, boolean), public.chat_subs_to_close(), public.chat_sub_closed(uuid), public.chat_config()
  from public, anon, authenticated;
grant execute on function public.chat_record(text, text, text, text, text, timestamptz), public.chat_set_sub(uuid, text, boolean),
  public.chat_set_channel_ok(text, boolean), public.chat_subs_to_close(), public.chat_sub_closed(uuid), public.chat_config()
  to service_role;

-- Verified games: every viewer's numbers from chat_votes, with the same points rule as the game page
-- (100 per right answer + 20 per answer already in their streak, bonus capped at +100, times the round's weight;
--  a wrong answer resets the streak; skipped rounds don't).
create or replace function private.server_viewers(p_session uuid)
returns jsonb language plpgsql stable set search_path to '' as $$
declare rec record; cur text; o jsonb := '[]'::jsonb;
  pts bigint := 0; ans int := 0; cor int := 0; streak int := 0; best int := 0; v_login text; v_name text;
begin
  for rec in
    select v.viewer_id, v.viewer_login, v.display_name, v.choice, r.weight,
           private.correct_position(q.mode, q.answer, r.option_order) as pos
    from public.chat_votes v
    join public.session_rounds r on r.session_id = v.session_id and r.idx = v.idx
    join public.questions q on q.id = r.question_id
    where v.session_id = p_session and r.revealed_at is not null
    order by v.viewer_id, v.idx
  loop
    if cur is distinct from rec.viewer_id then
      if cur is not null then
        o := o || jsonb_build_object('id', cur, 'login', v_login, 'display_name', v_name,
                                     'points', pts, 'answers', ans, 'correct', cor, 'best_streak', best);
      end if;
      cur := rec.viewer_id; pts := 0; ans := 0; cor := 0; streak := 0; best := 0;
    end if;
    v_login := rec.viewer_login; v_name := rec.display_name; ans := ans + 1;
    if rec.choice = rec.pos then
      cor := cor + 1; streak := streak + 1;
      pts := pts + (100 + least(5, streak - 1) * 20) * rec.weight;
      best := greatest(best, streak);
    else
      streak := 0;
    end if;
  end loop;
  if cur is not null then
    o := o || jsonb_build_object('id', cur, 'login', v_login, 'display_name', v_name,
                                 'points', pts, 'answers', ans, 'correct', cor, 'best_streak', best);
  end if;
  return o;
end $$;

-- Patch the existing functions in place (each piece must match exactly, or the whole migration stops).
do $patch$
declare d text; n text;
begin
  -- reveal_round: verified games count chat from chat_votes
  d := pg_get_functiondef('public.reveal_round(uuid, integer, integer, integer[])'::regprocedure);
  n := replace(d, E'  if p_streamer_choice is null and now()', E'  if s.chat_verified then   -- the server read chat: count from chat_votes, not the browser\n    select coalesce(array_agg(coalesce(c.n, 0)::int order by k.k), ''{}'') into p_chat_counts\n    from generate_series(0, case when (select qq.mode from public.questions qq where qq.id = r.question_id) = ''ff'' then 1 else 3 end) as k(k)\n    left join (select v.choice, count(*) as n from public.chat_votes v where v.session_id = p_session and v.idx = p_idx group by v.choice) c\n      on c.choice = k.k;\n  end if;\n\n  if p_streamer_choice is null and now()');
  if n = d then raise exception 'patch failed: reveal_round'; end if;
  execute n;

  -- finish_game: verified games work out viewers on the server; unverified games don't add to viewer leaderboards
  d := pg_get_functiondef('public.finish_game(uuid, jsonb)'::regprocedure);
  n := replace(d, E'  p_viewers := coalesce(p_viewers, ''[]''::jsonb);', E'  if s.chat_verified then p_viewers := private.server_viewers(p_session); end if;   -- server-read chat wins\n  p_viewers := coalesce(p_viewers, ''[]''::jsonb);');
  n := replace(n, E'  if (select coalesce(sum((v ->> ''answers'')::int), 0) from jsonb_array_elements(p_viewers) as v) > v_total_votes',
    E'  if not s.chat_verified and ((select coalesce(sum((v ->> ''answers'')::int), 0) from jsonb_array_elements(p_viewers) as v) > v_total_votes');
  n := replace(n, E'> v_right_votes then', E'> v_right_votes) then');
  n := replace(n, E'  if s.is_test then\n    v_n := 0;', E'  if s.is_test or not s.chat_verified then   -- unverified games stay off viewer leaderboards\n    v_n := 0;');
  n := replace(n, E'''is_test'', s.is_test,', E'''is_test'', s.is_test, ''chat_verified'', s.chat_verified,');
  if (length(n) - length(d)) < 200 then raise exception 'patch failed: finish_game'; end if;
  execute n;

  -- public boards: only verified games
  d := pg_get_functiondef('private.channel_record(text)'::regprocedure);
  n := replace(d, E'and not s.is_test', E'and not s.is_test and s.chat_verified');
  if n = d then raise exception 'patch failed: channel_record'; end if;
  execute n;
  d := pg_get_functiondef('private.today_board()'::regprocedure);
  n := replace(d, E'and not s.is_test', E'and not s.is_test and s.chat_verified');
  if n = d then raise exception 'patch failed: today_board'; end if;
  execute n;

  -- the game page learns whether this streamer has approved the bot
  d := pg_get_functiondef('public.ensure_my_channel()'::regprocedure);
  n := replace(d, E'''is_admin'', exists', E'''chat_ok'', c.chat_ok,\n    ''is_admin'', exists');
  if n = d then raise exception 'patch failed: ensure_my_channel'; end if;
  execute n;
end $patch$;
