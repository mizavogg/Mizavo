-- Mizavo: daily_pools
-- Which 200 questions are live each day. A "day" runs midnight to midnight UTC
-- (decided Nov 4, 2026), the same moment for every streamer worldwide.

create table public.daily_pools (
  pool_date   date not null,                                      -- the UTC date
  slot        smallint not null check (slot between 1 and 200),  -- position 1..200
  question_id uuid not null references public.questions (id) on delete restrict,
  primary key (pool_date, question_id),
  unique (pool_date, slot)                                         -- max 200 per day, no shared slots
);

comment on table public.daily_pools is 'The 200 live questions for each UTC day.';

-- only APPROVED questions may ever enter a pool
create function private.daily_pools_require_approved() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.questions q
                 where q.id = new.question_id and q.status = 'approved') then
    raise exception 'question % is not approved and cannot enter a daily pool', new.question_id;
  end if;
  return new;
end;
$$;

create trigger daily_pools_require_approved
  before insert or update on public.daily_pools
  for each row execute function private.daily_pools_require_approved();

revoke execute on function private.daily_pools_require_approved() from public, anon, authenticated;

-- helps the "not used in the last 60 days" rule when building tomorrow's pool
create index daily_pools_question_date on public.daily_pools (question_id, pool_date);

-- the current UTC day, used everywhere so "today" means the same thing in every function
create function private.today_utc() returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'utc')::date $$;

revoke execute on function private.today_utc() from public, anon;
grant execute on function private.today_utc() to authenticated;

-- security: no browser access; the game only gets questions through API functions
alter table public.daily_pools enable row level security;
revoke all on public.daily_pools from anon, authenticated;
