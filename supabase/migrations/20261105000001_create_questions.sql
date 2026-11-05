-- Mizavo: the question bank
-- Every question the game can ever play lives here.
-- Only rows with status = 'approved' may be played.

create table public.questions (
  id           uuid primary key default gen_random_uuid(),

  -- what kind of question
  mode         text not null check (mode in ('ff', 'ooo')),        -- ff = Fact or Fake, ooo = Odd One Out
  language     text not null default 'en' check (language ~ '^[a-z]{2}$'),

  -- what is shown, and the hidden answer
  payload      jsonb not null,   -- ff: {"statement": "..."}   ooo: {"items": ["a","b","c","d"]}
  answer       jsonb not null,   -- ff: true / false           ooo: 0-3 (position of the odd item)
  explanation  text  not null check (char_length(explanation) between 10 and 300),

  -- balancing and variety
  difficulty   smallint not null check (difficulty between 1 and 3),   -- 1 easy, 2 medium, 3 hard
  category     text not null check (category in (
                 'animals', 'space', 'geography', 'history', 'food',
                 'science', 'human_body', 'pop_culture', 'language')),

  -- no-repeat + accuracy
  fact_key     text not null check (fact_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- e.g. octopus-hearts
  source_url   text not null check (source_url ~ '^https?://\S+$'),
  origin       text not null default 'handwritten'
                 check (origin in ('handwritten', 'generated', 'community')),

  -- review workflow
  status       text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_at  timestamptz,

  -- stats (filled in by the game later)
  times_used   integer not null default 0 check (times_used >= 0),
  correct_rate numeric(5,4) check (correct_rate between 0 and 1),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- shape rules: the payload and answer must match the mode
  constraint payload_matches_mode check (
    (mode = 'ff'
       and jsonb_typeof(payload) = 'object'
       and jsonb_typeof(payload -> 'statement') = 'string'
       and char_length(payload ->> 'statement') between 10 and 200
       and payload - 'statement' = '{}'::jsonb)
    or
    (mode = 'ooo'
       and jsonb_typeof(payload) = 'object'
       and jsonb_typeof(payload -> 'items') = 'array'
       and jsonb_array_length(payload -> 'items') = 4
       and payload - 'items' = '{}'::jsonb)
  ),
  constraint answer_matches_mode check (
    (mode = 'ff'  and jsonb_typeof(answer) = 'boolean')
    or
    (mode = 'ooo' and jsonb_typeof(answer) = 'number' and answer::text in ('0', '1', '2', '3'))
  ),
  -- an approved question must record when it was approved
  constraint approved_has_date check (status <> 'approved' or approved_at is not null)
);

comment on table public.questions is 'Mizavo question bank. Only status = approved rows are playable.';

-- Odd One Out: all 4 items must be non-empty text and different from each other
create function public.ooo_items_valid(items jsonb) returns boolean
language sql immutable
set search_path = ''
as $$
  select bool_and(jsonb_typeof(i) = 'string' and char_length(trim(i #>> '{}')) between 1 and 40)
     and count(distinct lower(trim(i #>> '{}'))) = 4
  from jsonb_array_elements(items) as i
$$;

alter table public.questions
  add constraint ooo_items_unique_text
  check (mode <> 'ooo' or public.ooo_items_valid(payload -> 'items'));

-- no exact duplicates of the same question
create unique index questions_no_exact_duplicate
  on public.questions (language, mode, payload);

-- fast lookups when building the daily pool (from the build spec)
create index questions_status_mode_difficulty
  on public.questions (status, mode, difficulty);
create index questions_fact_key on public.questions (fact_key);

-- keep updated_at current on every edit
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- security: lock the table. Browsers (anon / logged-in users) get nothing.
-- The game will reach questions only through server-side API functions,
-- so answers can never be read before the reveal.
alter table public.questions enable row level security;
revoke all on public.questions from anon, authenticated;
