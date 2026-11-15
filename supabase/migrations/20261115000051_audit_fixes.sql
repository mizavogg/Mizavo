-- Mizavo migration 51 (Nov 15, 2026): fixes from the full top-to-bottom check.
-- 1. The two scheduled calls to server functions (daily reminders, chat sweep) gave up after pg_net's default 5 seconds.
--    The functions take 2-4 s, more on a cold start, so some calls were cut off (8 in the last day). Now 30 s.
-- 2. Three tiny settings functions get a fixed search_path (Supabase security check).
-- 3. Indexes for four foreign keys that had none (Supabase performance check).

select cron.schedule('mizavo-daily-reminders', '0 * * * *', $cron$
  select net.http_post(
    url := 'https://puhnuwstlujkvevsromj.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$cron$);

select cron.schedule('mizavo-chat-sweep', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://puhnuwstlujkvevsromj.supabase.co/functions/v1/twitch-chat',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_key')),
    body := '{"action":"sweep"}'::jsonb,
    timeout_milliseconds := 30000);
$cron$);

alter function private.solo_seconds() set search_path = '';
alter function private.solo_grace() set search_path = '';
alter function private.warmup_seconds() set search_path = '';

create index if not exists invite_links_created_by on public.invite_links (created_by);
create index if not exists invites_invited_by on public.invites (invited_by);
create index if not exists practice_rounds_question on public.practice_rounds (question_id);
create index if not exists warmup_rounds_question on public.warmup_rounds (question_id);
