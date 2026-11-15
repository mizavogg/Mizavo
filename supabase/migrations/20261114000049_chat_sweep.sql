-- Mizavo migration 49 (Nov 14, 2026): every 15 minutes, close any leftover Twitch chat subscriptions
-- (games that ended without the page saying "stop"). Calls the twitch-chat function's "sweep" action with
-- the schedule's password from Vault. (File recovered from the live database on Nov 15.)
select cron.schedule('mizavo-chat-sweep', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://puhnuwstlujkvevsromj.supabase.co/functions/v1/twitch-chat',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_key')),
    body := '{"action":"sweep"}'::jsonb);
$cron$);
