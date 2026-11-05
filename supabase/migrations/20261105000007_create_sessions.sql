-- Mizavo: sessions — one row per game played
-- A session is created when a streamer presses Start and closed when the game
-- ends (finished) or is left unfinished (abandoned).

create table public.sessions (
  id           uuid primary key default gen_random_uuid(),
  channel_id   text not null references public.channels (id) on delete cascade,
  play_date    date not null default private.today_utc(),     -- UTC day the game was played
  game_number  integer not null check (game_number >= 1),     -- 1st, 2nd, 3rd game that day; set automatically
  seed         bigint not null
                 default floor(random() * 9007199254740991)::bigint,  -- makes this game's question draw repeatable

  -- the settings this game was played with (a snapshot; channel settings can change later)
  mode         text not null check (mode in ('ff', 'ooo', 'mix')),
  rounds       smallint not null check (rounds in (5, 10, 15, 20)),
  seconds      smallint not null check (seconds in (10, 15, 20, 30)),
  blind        boolean not null,

  status       text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,

  unique (channel_id, play_date, game_number),
  -- an open game has no end time; a closed game must have one, after it started
  constraint end_time_matches_status check (
    (status = 'active' and finished_at is null)
    or (status in ('finished', 'abandoned') and finished_at is not null and finished_at >= started_at)
  )
);

comment on table public.sessions is 'One row per game. Settings are a snapshot of what the game used.';

-- a channel can only have ONE game in progress at a time
create unique index sessions_one_active_per_channel
  on public.sessions (channel_id) where status = 'active';

-- number games automatically: the next number for this channel on this UTC day
create function private.sessions_assign_game_number() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select coalesce(max(s.game_number), 0) + 1 into new.game_number
  from public.sessions s
  where s.channel_id = new.channel_id and s.play_date = new.play_date;
  return new;
end;
$$;

create trigger sessions_assign_game_number
  before insert on public.sessions
  for each row execute function private.sessions_assign_game_number();

-- after creation, only status and finished_at may change, and a closed game stays closed
create function private.sessions_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.channel_id, new.play_date, new.game_number, new.seed,
      new.mode, new.rounds, new.seconds, new.blind, new.started_at)
     is distinct from
     (old.id, old.channel_id, old.play_date, old.game_number, old.seed,
      old.mode, old.rounds, old.seconds, old.blind, old.started_at) then
    raise exception 'session %: only status and finished_at can change', old.id;
  end if;
  if old.status <> 'active' and new.status is distinct from old.status then
    raise exception 'session % is already %, it cannot be reopened or changed', old.id, old.status;
  end if;
  if old.status <> 'active' and new.finished_at is distinct from old.finished_at then
    raise exception 'session % is already %, its end time is final', old.id, old.status;
  end if;
  return new;
end;
$$;

create trigger sessions_guard_update
  before update on public.sessions
  for each row execute function private.sessions_guard_update();

revoke execute on function private.sessions_assign_game_number() from public, anon, authenticated;
revoke execute on function private.sessions_guard_update() from public, anon, authenticated;

-- security: a logged-in streamer can READ only their own channel's games.
-- Creating and closing games happens through server-side API functions.
alter table public.sessions enable row level security;
revoke all on public.sessions from anon, authenticated;
grant select on public.sessions to authenticated;

create policy "streamer reads own sessions"
  on public.sessions for select
  to authenticated
  using (exists (
    select 1 from public.channels c
    where c.id = sessions.channel_id and c.owner_user_id = (select auth.uid())
  ));
