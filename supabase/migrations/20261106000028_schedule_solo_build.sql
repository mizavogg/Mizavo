-- Migration 28: build each day's solo challenge automatically.
-- 00:10 UTC, after the pool safety net (00:05), so the set comes from today's pool.
-- This also guarantees tomorrow's guests have "yesterday's challenge" even if nobody logged in played today.
-- (Does nothing if the set already exists.)
select cron.schedule(
  'mizavo-build-todays-solo-challenge',
  '10 0 * * *',
  $$ select private.solo_build(private.today_utc()) $$
);
