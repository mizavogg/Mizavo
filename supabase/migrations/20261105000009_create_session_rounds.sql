-- Mizavo: session_rounds — each round of a game and how it went
-- Rows are created when a game starts (the drawn question order), then filled in:
--   shown_at    when the question appears on screen
--   revealed_at when the answer is revealed, together with the streamer's pick and chat's vote counts.
-- "Correct" results are always calculated by the database from the real answer, never trusted from outside.

create table public.session_rounds (
  session_id       uuid not null references public.sessions (id) on delete cascade,
  idx              smallint not null check (idx between 1 and 20),        -- round number
  question_id      uuid not null references public.questions (id) on delete restrict,
  option_order     smallint[],      -- Odd One Out only: the shuffled order the 4 items are shown in
  shown_at         timestamptz,
  revealed_at      timestamptz,
  streamer_choice  smallint check (streamer_choice between 0 and 3),      -- on-screen position picked; null = no pick
  chat_counts      integer[],       -- votes per on-screen option, e.g. {48, 12}
  chat_total       integer check (chat_total >= 0),
  streamer_correct boolean,
  chat_correct     boolean,
  primary key (session_id, idx),
  unique (session_id, question_id)   -- the same question can't appear twice in one game
);

comment on table public.session_rounds is 'Each round of a game: drawn question, timing, streamer pick, chat votes, results.';

create index session_rounds_question_id on public.session_rounds (question_id);

create function private.session_rounds_validate() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s_rounds smallint; s_mode text; s_status text;
  q_mode text; q_answer jsonb;
  n_opts int; correct_pos int; top int; top_count int;
begin
  -- once revealed, a round is final
  if tg_op = 'UPDATE' then
    if old.revealed_at is not null then
      raise exception 'round % of session % is already revealed and cannot change', old.idx, old.session_id;
    end if;
    if (new.session_id, new.idx, new.question_id, new.option_order)
       is distinct from (old.session_id, old.idx, old.question_id, old.option_order) then
      raise exception 'the question drawn for a round cannot be swapped';
    end if;
  end if;

  select s.rounds, s.mode, s.status into s_rounds, s_mode, s_status
  from public.sessions s where s.id = new.session_id;
  if s_status is null then
    raise exception 'session % does not exist', new.session_id;
  end if;
  if s_status <> 'active' then
    raise exception 'session % is %, its rounds cannot change', new.session_id, s_status;
  end if;
  if new.idx > s_rounds then
    raise exception 'round % is beyond this game''s % rounds', new.idx, s_rounds;
  end if;

  select q.mode, q.answer into q_mode, q_answer from public.questions q where q.id = new.question_id;
  if q_mode is null then
    raise exception 'question % does not exist', new.question_id;
  end if;
  if s_mode <> 'mix' and s_mode <> q_mode then
    raise exception 'a % question cannot be played in a % game', q_mode, s_mode;
  end if;

  -- option order: none for Fact or Fake; a shuffle of 0,1,2,3 for Odd One Out
  if q_mode = 'ff' then
    if new.option_order is not null then
      raise exception 'Fact or Fake rounds have no option order';
    end if;
    n_opts := 2;
    correct_pos := case when q_answer = 'true'::jsonb then 0 else 1 end;   -- 0 = FACT, 1 = FAKE
  else
    if new.option_order is null
       or array_length(new.option_order, 1) <> 4
       or (select array_agg(x order by x) from unnest(new.option_order) as x) <> array[0,1,2,3]::smallint[] then
      raise exception 'Odd One Out option order must be a shuffle of 0,1,2,3';
    end if;
    n_opts := 4;
    correct_pos := array_position(new.option_order, (q_answer #>> '{}')::smallint) - 1;
  end if;

  -- timing
  if new.revealed_at is not null and new.shown_at is null then
    raise exception 'a round cannot be revealed before it is shown';
  end if;
  if new.revealed_at < new.shown_at then
    raise exception 'reveal time cannot be before show time';
  end if;

  if new.revealed_at is null then
    -- not revealed yet: no picks, votes or results may be stored
    if new.streamer_choice is not null or new.chat_counts is not null or new.chat_total is not null
       or new.streamer_correct is not null or new.chat_correct is not null then
      raise exception 'picks, votes and results are only saved at the reveal';
    end if;
    return new;
  end if;

  -- revealed: check the votes and calculate the results
  if new.streamer_choice is not null and new.streamer_choice >= n_opts then
    raise exception 'streamer picked option %, but there are only % options', new.streamer_choice, n_opts;
  end if;
  if new.chat_counts is null or coalesce(array_length(new.chat_counts, 1), 0) <> n_opts
     or exists (select 1 from unnest(new.chat_counts) as c where c is null or c < 0) then
    raise exception 'chat_counts must have one non-negative count per option (% options)', n_opts;
  end if;

  new.chat_total := (select sum(c) from unnest(new.chat_counts) as c);
  new.streamer_correct := coalesce(new.streamer_choice = correct_pos, false);

  -- chat is correct only if its single top answer is the right one (ties and no votes = not correct)
  select max(c) into top_count from unnest(new.chat_counts) as c;
  if new.chat_total = 0
     or (select count(*) from unnest(new.chat_counts) as c where c = top_count) > 1 then
    new.chat_correct := false;
  else
    top := array_position(new.chat_counts, top_count) - 1;
    new.chat_correct := (top = correct_pos);
  end if;

  return new;
end;
$$;

create trigger session_rounds_validate
  before insert or update on public.session_rounds
  for each row execute function private.session_rounds_validate();

revoke execute on function private.session_rounds_validate() from public, anon, authenticated;

-- security: a logged-in streamer can READ only rounds from their own games.
-- (Answers stay hidden: the questions table itself is still locked.)
alter table public.session_rounds enable row level security;
revoke all on public.session_rounds from anon, authenticated;
grant select on public.session_rounds to authenticated;

create policy "streamer reads own rounds"
  on public.session_rounds for select
  to authenticated
  using (exists (
    select 1 from public.sessions s
    join public.channels c on c.id = s.channel_id
    where s.id = session_rounds.session_id and c.owner_user_id = (select auth.uid())
  ));
