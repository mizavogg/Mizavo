-- Mizavo: viewer_scores — each channel's chat leaderboard (all-time)
-- Viewers are keyed by their permanent Twitch user ID, so renaming on Twitch
-- keeps their points. Login and display name are just the latest known names.

create table public.viewer_scores (
  channel_id     text not null references public.channels (id) on delete cascade,
  viewer_id      text not null check (viewer_id ~ '^[0-9]{1,20}$'),           -- Twitch user ID
  viewer_login   text not null check (viewer_login ~ '^[a-z0-9_]{1,25}$'),
  display_name   text not null check (char_length(display_name) between 1 and 50),
  points         bigint  not null default 0 check (points >= 0),
  answers        integer not null default 0 check (answers >= 0),           -- rounds voted in
  correct        integer not null default 0 check (correct >= 0),           -- rounds voted right
  best_streak    smallint not null default 0 check (best_streak between 0 and 20),  -- longest run in one game
  games_played   integer not null default 0 check (games_played >= 0),
  last_played_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (channel_id, viewer_id),
  constraint correct_not_more_than_answers check (correct <= answers),
  constraint streak_not_more_than_correct check (best_streak <= correct)
);

comment on table public.viewer_scores is 'Per-channel all-time chat leaderboard, keyed by Twitch user ID.';

-- fast "top 10 for this channel"
create index viewer_scores_leaderboard on public.viewer_scores (channel_id, points desc);

-- totals only ever go up: points, answers, correct and games can't be lowered,
-- and the best streak can't shrink. (Resets, if ever needed, are a separate admin job.)
create function private.viewer_scores_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel_id is distinct from old.channel_id or new.viewer_id is distinct from old.viewer_id then
    raise exception 'a score row cannot move to another channel or viewer';
  end if;
  if new.points < old.points or new.answers < old.answers or new.correct < old.correct
     or new.games_played < old.games_played or new.best_streak < old.best_streak then
    raise exception 'viewer totals can only go up';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot change';
  end if;
  return new;
end;
$$;

create trigger viewer_scores_guard_update
  before update on public.viewer_scores
  for each row execute function private.viewer_scores_guard_update();

create trigger viewer_scores_set_updated_at
  before update on public.viewer_scores
  for each row execute function public.set_updated_at();

revoke execute on function private.viewer_scores_guard_update() from public, anon, authenticated;

-- security: a logged-in streamer can READ their own channel's leaderboard.
-- Points are only added through server-side API functions.
alter table public.viewer_scores enable row level security;
revoke all on public.viewer_scores from anon, authenticated;
grant select on public.viewer_scores to authenticated;

create policy "streamer reads own leaderboard"
  on public.viewer_scores for select
  to authenticated
  using (exists (
    select 1 from public.channels c
    where c.id = viewer_scores.channel_id and c.owner_user_id = (select auth.uid())
  ));
