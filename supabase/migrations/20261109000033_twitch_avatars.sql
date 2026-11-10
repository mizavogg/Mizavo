-- Mizavo — migration 33: a cache of viewers' Twitch profile pictures (for picture balls).
-- Filled only by the twitch-avatars Edge Function (service role). Nobody else can read or write it:
-- RLS is on with no policies. Pictures are public on Twitch; we keep just login -> picture address,
-- and refresh it after a week so changed pictures show up.
create table if not exists public.twitch_avatars (
  login      text primary key check (login ~ '^[a-z0-9_]{1,25}$'),
  user_id    text,
  url        text,                 -- null: no custom picture (Twitch default) or account not found
  fetched_at timestamptz not null default now()
);
alter table public.twitch_avatars enable row level security;
revoke all on public.twitch_avatars from anon, authenticated;
comment on table public.twitch_avatars is 'Twitch profile picture cache for picture balls. Written by the twitch-avatars Edge Function only.';
