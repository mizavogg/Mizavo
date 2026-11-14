-- Mizavo — migration 42: site analytics (Nov 13, 2026).
-- Aiden's choices: our own tracker (no outside service, no cookies), shown in a new "Analytics" tab
-- on the admin page, with four sections: visitors & sources, game activity, players & channels, question bank health.
--
-- How visits are counted:
--   * Every public page calls track_view() once when it opens.
--   * The browser keeps a random, anonymous visitor ID in localStorage (no name, no IP address, no cookie),
--     so "unique visitors" and "new vs returning" can be counted. A "visit" ends after 30 idle minutes.
--   * Where people are is a rough guess from the browser's time zone (e.g. "America/Los_Angeles"), not their IP.
--   * Admins are never counted (checked here on the server). The admin page also marks its device so
--     Aiden's logged-out visits on that device aren't counted either (checked in the browser).
--   * Rows older than 400 days are deleted nightly.

create table public.page_views (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  day         date not null default private.today_utc(),   -- the Mizavo day (US Eastern)
  visitor     text not null check (visitor ~ '^[a-z0-9]{12,32}$'),
  visit       text not null check (visit ~ '^[a-z0-9]{12,32}$'),
  path        text not null check (length(path) between 1 and 60),
  referrer    text check (length(referrer) <= 80),          -- the other site's host only, e.g. "reddit.com"
  source      text check (length(source) <= 40),            -- ?utm_source= or ?ref= on the link, if any
  device      text not null check (device in ('phone', 'tablet', 'desktop')),
  browser     text check (length(browser) <= 20),
  tz          text check (length(tz) <= 40),                -- browser time zone
  lang        text check (length(lang) <= 12),
  logged_in   boolean not null default false,
  new_visitor boolean not null default false
);
comment on table public.page_views is 'One row per page opened on the public site. Anonymous: a random visitor ID, no IP, no cookies. Read only through admin_analytics().';
create index page_views_day on public.page_views (day);
create index page_views_visitor on public.page_views (visitor, at);

alter table public.page_views enable row level security;   -- no policies: nobody reads or writes it directly
revoke all on public.page_views from anon, authenticated;

-- ---------- the counter every public page calls ----------
create or replace function public.track_view(
  p_visitor text, p_visit text, p_path text, p_referrer text, p_source text,
  p_device text, p_browser text, p_tz text, p_lang text, p_new boolean)
returns void language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  -- admins are never counted
  if v_uid is not null and exists (select 1 from public.admins a where a.user_id = v_uid) then return; end if;
  -- quietly ignore anything malformed (a bad tracker call must never break a page)
  if p_visitor !~ '^[a-z0-9]{12,32}$' or p_visit !~ '^[a-z0-9]{12,32}$'
     or p_device not in ('phone', 'tablet', 'desktop') or coalesce(p_path, '') = '' then return; end if;
  -- flood guard: at most 40 pages a minute from one visitor
  if (select count(*) from public.page_views
      where visitor = p_visitor and at > now() - interval '1 minute') >= 40 then return; end if;

  insert into public.page_views (visitor, visit, path, referrer, source, device, browser, tz, lang, logged_in, new_visitor)
  values (p_visitor, p_visit, left(p_path, 60), nullif(left(lower(p_referrer), 80), ''), nullif(left(lower(p_source), 40), ''),
          p_device, nullif(left(p_browser, 20), ''), nullif(left(p_tz, 40), ''), nullif(left(p_lang, 12), ''),
          v_uid is not null, coalesce(p_new, false));
end;
$$;
revoke execute on function public.track_view(text, text, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.track_view(text, text, text, text, text, text, text, text, text, boolean) to anon, authenticated;

-- ---------- the report behind the admin Analytics tab ----------
-- p_days: how many Mizavo days to cover, today included (1–365).
create or replace function public.admin_analytics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare
  v_today date := private.today_utc();
  v_days  int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from  date;
  v_out   jsonb;
begin
  perform private.require_admin();
  v_from := v_today - (v_days - 1);

  with
  -- one row per day in the range, so quiet days still show as 0
  d as (select generate_series(v_from, v_today, interval '1 day')::date as day),
  pv as (select * from public.page_views where day between v_from and v_today),
  -- real streamer games (test games never count). Family logins can't host games, so they never appear here.
  sg as (select s.*, (s.started_at at time zone 'America/New_York')::date as d
         from public.sessions s where not s.is_test
           and (s.started_at at time zone 'America/New_York')::date between v_from and v_today),
  so as (select * from public.solo_games where play_date between v_from and v_today),
  pg as (select g.*, (g.started_at at time zone 'America/New_York')::date as d from public.practice_games g
         where (g.started_at at time zone 'America/New_York')::date between v_from and v_today),
  wu as (select w.*, (w.started_at at time zone 'America/New_York')::date as d from public.warmups w
         where (w.started_at at time zone 'America/New_York')::date between v_from and v_today),
  -- every individual answer we know the result of, per question (for "most missed")
  ans as (
    select sd.question_id, a.correct from public.solo_answers a
      join public.solo_days sd on sd.play_date = a.play_date and sd.idx = a.idx
      where a.answered_at is not null and a.correct is not null
    union all
    select r.question_id, r.correct from public.practice_rounds r where r.answered_at is not null and r.correct is not null
    union all
    select r.question_id, r.streamer_correct from public.session_rounds r
      join public.sessions s on s.id = r.session_id and not s.is_test
      where r.streamer_correct is not null),
  busiest as (select s.channel_id from public.sessions s where not s.is_test
              group by 1 order by count(*) desc limit 1)
  select jsonb_build_object(
    'from', v_from, 'to', v_today, 'days', v_days, 'generated_at', now(),

    -- ===== visitors & sources =====
    'visitors', jsonb_build_object(
      'views',        (select count(*) from pv),
      'visitors',     (select count(distinct visitor) from pv),
      'visits',       (select count(distinct visit) from pv),
      'new_visitors', (select count(distinct visitor) from pv where new_visitor),
      'logged_in_visitors', (select count(distinct visitor) from pv where logged_in),
      'today_views',    (select count(*) from pv where day = v_today),
      'today_visitors', (select count(distinct visitor) from pv where day = v_today),
      'tracking_since', (select min(day) from public.page_views),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day,
                   'views', (select count(*) from pv where pv.day = d.day),
                   'visitors', (select count(distinct visitor) from pv where pv.day = d.day)) order by d.day), '[]')
                 from d),
      'pages', (select coalesce(jsonb_agg(x order by (x->>'views')::int desc), '[]') from (
                  select jsonb_build_object('name', path, 'views', count(*), 'visitors', count(distinct visitor)) x
                  from pv group by path order by count(*) desc limit 12) t),
      'referrers', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('name', coalesce(referrer, 'Direct / no referrer'), 'visitors', count(distinct visitor)) x
                  from (select distinct on (visit) visit, visitor, referrer from pv order by visit, at) first_page
                  group by referrer order by count(distinct visitor) desc limit 10) t),
      'sources', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('name', source, 'visitors', count(distinct visitor)) x
                  from pv where source is not null group by source order by count(distinct visitor) desc limit 10) t),
      'devices', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('name', device, 'visitors', count(distinct visitor)) x
                  from pv group by device order by count(distinct visitor) desc) t),
      'browsers', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('name', coalesce(browser, 'Other'), 'visitors', count(distinct visitor)) x
                  from pv group by browser order by count(distinct visitor) desc limit 8) t),
      'places', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('name', coalesce(tz, 'Unknown'), 'visitors', count(distinct visitor)) x
                  from pv group by tz order by count(distinct visitor) desc limit 10) t)),

    -- ===== game activity =====
    'games', jsonb_build_object(
      'streamer_started',  (select count(*) from sg),
      'streamer_finished', (select count(*) from sg where status = 'finished'),
      'chat_votes',        (select coalesce(sum(r.chat_total), 0) from public.session_rounds r join sg on sg.id = r.session_id),
      'avg_voters_per_round', (select round(avg(r.chat_total)::numeric, 1) from public.session_rounds r
                               join sg on sg.id = r.session_id where r.revealed_at is not null),
      'solo_started',  (select count(*) from so),
      'solo_finished', (select count(*) from so where finished_at is not null),
      'practice_games', (select count(*) from pg),
      'warmups', (select count(*) from wu),
      'warmup_votes', (select coalesce(sum(r.votes), 0) from public.warmup_rounds r join wu on wu.id = r.warmup_id),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day,
                   'streamer', (select count(*) from sg where sg.d = d.day),
                   'solo',     (select count(*) from so where so.play_date = d.day),
                   'practice', (select count(*) from pg where pg.d = d.day),
                   'warmup',   (select count(*) from wu where wu.d = d.day)) order by d.day), '[]')
                 from d)),

    -- ===== players & channels ===== (family logins are counted on their own, not as channels)
    'players', jsonb_build_object(
      'channels_total',  (select count(*) from public.channels c where not exists (select 1 from public.family_logins f where f.channel_id = c.id)),
      'channels_new',    (select count(*) from public.channels c where (c.created_at at time zone 'America/New_York')::date between v_from and v_today
                          and not exists (select 1 from public.family_logins f where f.channel_id = c.id)),
      'channels_active', (select count(distinct channel_id) from sg),
      'solo_players_total', (select count(*) from public.solo_scores),
      'solo_players_active', (select count(distinct player_id) from so),
      'chatters_total', (select count(distinct viewer_id) from public.viewer_scores),
      'family_logins', (select count(*) from public.family_logins where active),
      'top_channels', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('name', coalesce(c.display_name, c.login, s.channel_id), 'login', c.login,
                    'games', count(*), 'finished', count(*) filter (where s.status = 'finished'),
                    'chat_votes', coalesce(sum((select sum(r.chat_total) from public.session_rounds r where r.session_id = s.id)), 0),
                    'last_played', max(s.started_at)) x
                  from sg s left join public.channels c on c.id = s.channel_id
                  group by s.channel_id, c.display_name, c.login order by count(*) desc, max(s.started_at) desc limit 10) t),
      'recent_channels', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('name', coalesce(display_name, login, id), 'login', login, 'joined', created_at,
                    'games', (select count(*) from public.sessions s where s.channel_id = c.id and not s.is_test)) x
                  from public.channels c where not exists (select 1 from public.family_logins f where f.channel_id = c.id) order by created_at desc limit 8) t)),

    -- ===== question bank health =====
    'questions', jsonb_build_object(
      'approved', (select count(*) from public.questions where status = 'approved'),
      'drafts',   (select count(*) from public.questions where status = 'draft'),
      'busiest_channel', (select coalesce(c.display_name, c.login, b.channel_id) from busiest b left join public.channels c on c.id = b.channel_id),
      'by_category', (select coalesce(jsonb_agg(x order by (x->>'approved')::int), '[]') from (
                  select jsonb_build_object('name', q.category,
                    'approved', count(*),
                    'ff', count(*) filter (where q.mode = 'ff'), 'ooo', count(*) filter (where q.mode = 'ooo'),
                    'easy', count(*) filter (where q.difficulty = 1), 'medium', count(*) filter (where q.difficulty = 2),
                    'hard', count(*) filter (where q.difficulty = 3),
                    'used', count(*) filter (where q.times_used > 0),
                    -- how many this category still has left for the channel that has played the most
                    'left_for_busiest', count(*) filter (where not exists (
                        select 1 from public.channel_seen cs, busiest b
                        where cs.channel_id = b.channel_id and (cs.question_id = q.id or cs.fact_key = q.fact_key)))) x
                  from public.questions q where q.status = 'approved' group by q.category) t),
      'most_missed', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('id', q.id, 'category', q.category, 'mode', q.mode, 'difficulty', q.difficulty,
                    'text', coalesce(q.payload->>'statement', array_to_string(array(select jsonb_array_elements_text(q.payload->'items')), ' · ')),
                    'answers', a.n, 'right_pct', round(100.0 * a.ok / a.n)) x
                  from (select question_id, count(*) n, count(*) filter (where correct) ok from ans group by question_id having count(*) >= 3) a
                  join public.questions q on q.id = a.question_id
                  order by a.ok::numeric / a.n, a.n desc limit 8) t))
  ) into v_out;
  return v_out;
end;
$$;
revoke execute on function public.admin_analytics(int) from public, anon;
grant execute on function public.admin_analytics(int) to authenticated;

-- ---------- keep the log small: delete views older than 400 days, nightly ----------
select cron.schedule('mizavo-trim-page-views', '20 9 * * *',
  $c$ delete from public.page_views where at < now() - interval '400 days' $c$);
