-- Mizavo: run the pool builder automatically every night (all times UTC)

-- the build log keeps every attempt (a retry after an empty bank used to clash on the date)
alter table private.pool_builds drop constraint pool_builds_pkey;
alter table private.pool_builds add column id bigint generated always as identity primary key;
create index pool_builds_date on private.pool_builds (pool_date);

create extension if not exists pg_cron;

-- 23:50 UTC: build TOMORROW's pool, ready before the day starts at midnight
select cron.schedule(
  'mizavo-build-tomorrows-pool',
  '50 23 * * *',
  $$ select private.build_daily_pool(private.today_utc() + 1) $$
);

-- 00:05 UTC: safety net, builds TODAY's pool if last night's run failed (does nothing otherwise)
select cron.schedule(
  'mizavo-build-todays-pool-safety-net',
  '5 0 * * *',
  $$ select private.build_daily_pool(private.today_utc()) $$
);
