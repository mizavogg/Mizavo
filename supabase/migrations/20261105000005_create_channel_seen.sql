-- Mizavo: channel_seen — the no-repeat guarantee
-- One row every time a channel is shown a question. A channel can never be shown
-- the same question, or the same underlying fact (fact_key), twice.

create table public.channel_seen (
  channel_id  text not null references public.channels (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  fact_key    text not null,                       -- copied from the question automatically
  seen_at     timestamptz not null default now(),
  primary key (channel_id, question_id)
);

comment on table public.channel_seen is 'Every question each channel has been shown. Enforces no repeats.';

-- the same FACT can never be shown to a channel twice, even if reworded
create unique index channel_seen_one_per_fact on public.channel_seen (channel_id, fact_key);

-- fact_key always comes from the question itself, never from whoever inserts the row
create function private.channel_seen_fill_fact_key() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select q.fact_key into new.fact_key from public.questions q where q.id = new.question_id;
  return new;  -- if the question doesn't exist, the foreign key rejects the row
end;
$$;

create trigger channel_seen_fill_fact_key
  before insert or update on public.channel_seen
  for each row execute function private.channel_seen_fill_fact_key();

-- once a question has been shown anywhere, its fact_key is frozen
create function private.questions_freeze_seen_fact_key() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fact_key is distinct from old.fact_key
     and exists (select 1 from public.channel_seen s where s.question_id = old.id) then
    raise exception 'fact_key of question % cannot change: it has already been shown to a channel', old.id;
  end if;
  return new;
end;
$$;

create trigger questions_freeze_seen_fact_key
  before update of fact_key on public.questions
  for each row execute function private.questions_freeze_seen_fact_key();

revoke execute on function private.channel_seen_fill_fact_key() from public, anon, authenticated;
revoke execute on function private.questions_freeze_seen_fact_key() from public, anon, authenticated;

-- security: no browser access at all; only server-side API functions touch this
alter table public.channel_seen enable row level security;
revoke all on public.channel_seen from anon, authenticated;
