-- Mizavo: reports — "this question is wrong" flags from streamers
-- A streamer can only report a question their channel has actually been shown.
-- An admin reviews each report and accepts or rejects it.

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references public.questions (id) on delete restrict,
  channel_id      text references public.channels (id) on delete set null,   -- kept if the channel is deleted
  reason          text not null check (reason in (
                    'wrong_answer', 'outdated', 'unclear', 'too_local', 'offensive', 'typo', 'other')),
  note            text check (char_length(note) <= 500),
  status          text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  resolved_at     timestamptz,
  resolved_by     uuid references public.admins (user_id) on delete restrict,
  resolution_note text check (char_length(resolution_note) <= 500),
  created_at      timestamptz not null default now(),

  -- "other" needs an explanation
  constraint other_needs_note check (reason <> 'other' or char_length(trim(note)) >= 5),
  -- open reports have no resolution; resolved ones record who and when
  constraint resolution_matches_status check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status in ('accepted', 'rejected') and resolved_at is not null and resolved_by is not null)
  )
);

comment on table public.reports is 'Streamer flags on questions, reviewed by admins.';

-- one open report per channel per question (no spamming the same flag)
create unique index reports_one_open_per_channel
  on public.reports (question_id, channel_id) where status = 'open';
create index reports_status_created on public.reports (status, created_at);
create index reports_channel_id on public.reports (channel_id);
create index reports_resolved_by on public.reports (resolved_by);

create function private.reports_validate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'new reports must start as open';
    end if;
    if new.channel_id is null then
      raise exception 'a report must come from a channel';
    end if;
    if not exists (select 1 from public.channel_seen s
                   where s.channel_id = new.channel_id and s.question_id = new.question_id) then
      raise exception 'channel % can only report questions it has been shown', new.channel_id;
    end if;
    return new;
  end if;

  -- UPDATE: the report itself never changes; only its review does, once
  if (new.id, new.question_id, new.reason, new.note, new.created_at)
     is distinct from (old.id, old.question_id, old.reason, old.note, old.created_at)
     or (new.channel_id is distinct from old.channel_id and new.channel_id is not null) then
    raise exception 'the contents of a report cannot be edited';
  end if;
  if old.status <> 'open'
     and (new.status, new.resolved_at, new.resolved_by, new.resolution_note)
         is distinct from (old.status, old.resolved_at, old.resolved_by, old.resolution_note) then
    raise exception 'report % is already %, its review is final', old.id, old.status;
  end if;
  return new;
end;
$$;

create trigger reports_validate
  before insert or update on public.reports
  for each row execute function private.reports_validate();

revoke execute on function private.reports_validate() from public, anon, authenticated;

-- security: a logged-in streamer can READ their own channel's reports (to see the outcome).
-- Filing and reviewing reports happens through server-side API functions.
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

create policy "streamer reads own reports"
  on public.reports for select
  to authenticated
  using (exists (
    select 1 from public.channels c
    where c.id = reports.channel_id and c.owner_user_id = (select auth.uid())
  ));
