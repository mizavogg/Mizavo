-- Mizavo migration 44 (Nov 14, 2026): daily challenge reminders (web push).
-- A player taps "Remind me" on the daily challenge page; their browser gives us a push address (an "endpoint" plus two
-- public keys), saved here with their time zone. Every hour, the send-reminders Edge Function (called by pg_cron)
-- sends "Today's challenge is live" to everyone for whom it's now 9 am, once a day.
-- Nothing personal is stored: the push address is random, made by the browser's push service. If the player is
-- logged in, their user id is kept too, only so we can skip the reminder when they've already played today.
-- The signing keys and the schedule's password live in Supabase Vault (encrypted), never in code.

create extension if not exists pg_net with schema extensions;

create table public.push_subs (
  endpoint   text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 800),
  p256dh     text not null check (char_length(p256dh) between 20 and 200),
  auth       text not null check (char_length(auth) between 8 and 100),
  tz         text not null check (char_length(tz) <= 50),
  user_id    uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_sent  date
);
alter table public.push_subs enable row level security;   -- no policies: only the functions below touch it
create index push_subs_user on public.push_subs (user_id);

-- Turn reminders on (or refresh them) for this browser.
create or replace function public.save_push(p_endpoint text, p_p256dh text, p_auth text, p_tz text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_tz text := p_tz;
begin
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then v_tz := 'America/New_York'; end if;
  if (select count(*) from public.push_subs where created_at > now() - interval '1 minute') >= 120 then
    raise exception 'busy: try again in a minute';
  end if;
  insert into public.push_subs (endpoint, p256dh, auth, tz, user_id)
  values (p_endpoint, p_p256dh, p_auth, v_tz, (select auth.uid()))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz,
        user_id = coalesce(excluded.user_id, public.push_subs.user_id);
end $$;

-- Turn reminders off for this browser.
create or replace function public.remove_push(p_endpoint text)
returns void language sql security definer set search_path to '' as $$
  delete from public.push_subs where endpoint = p_endpoint;
$$;

grant execute on function public.save_push(text, text, text, text), public.remove_push(text) to anon, authenticated;

-- ---------- for the send-reminders Edge Function only (service role) ----------
-- Who gets a reminder now: it's the 9 o'clock hour where they are, they haven't had one today (their day),
-- today's challenge exists, and (if logged in) they haven't played it yet.
create or replace function public.push_due()
returns table (endpoint text, p256dh text, auth text, local_day date)
language sql security definer set search_path to '' as $$
  select s.endpoint, s.p256dh, s.auth, (now() at time zone s.tz)::date
  from public.push_subs s
  where extract(hour from now() at time zone s.tz) = 9
    and (s.last_sent is null or s.last_sent < (now() at time zone s.tz)::date)
    and exists (select 1 from public.solo_days d where d.play_date = private.today_utc())
    and (s.user_id is null or not exists (       -- daily scores are kept by channel id
          select 1 from public.solo_games g join public.channels c on c.id = g.player_id
          where c.owner_user_id = s.user_id and g.play_date = private.today_utc()))
  limit 5000;
$$;

-- After sending: mark who got it today, and forget push addresses the push service says are gone.
create or replace function public.push_done(p_sent text[], p_gone text[])
returns void language sql security definer set search_path to '' as $$
  update public.push_subs set last_sent = (now() at time zone tz)::date where endpoint = any (p_sent);
  delete from public.push_subs where endpoint = any (p_gone);
$$;

-- The signing keys and the schedule's password, from Vault.
create or replace function public.push_config()
returns jsonb language sql security definer set search_path to '' as $$
  select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets
  where name in ('vapid_public', 'vapid_private', 'reminder_cron_key');
$$;

revoke all on function public.push_due(), public.push_done(text[], text[]), public.push_config() from public, anon, authenticated;
grant execute on function public.push_due(), public.push_done(text[], text[]), public.push_config() to service_role;

-- Every hour on the hour: ask the Edge Function to send whatever is due.
select cron.schedule('mizavo-daily-reminders', '0 * * * *', $cron$
  select net.http_post(
    url := 'https://puhnuwstlujkvevsromj.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_key')),
    body := '{}'::jsonb);
$cron$);
