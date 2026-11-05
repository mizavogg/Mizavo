-- Mizavo: channels
-- One row per streamer. Keyed by the permanent Twitch user ID (not the name),
-- so renaming a Twitch channel never resets its question history.

create table public.channels (
  id            text primary key check (id ~ '^[0-9]{1,20}$'),          -- Twitch user ID, e.g. '141981764'
  owner_user_id uuid not null unique
                  references auth.users (id) on delete restrict,       -- the Supabase login that owns it
  login         text not null check (login ~ '^[a-z0-9_]{1,25}$'),     -- twitch.tv/<login>, lowercase
  display_name  text not null check (char_length(display_name) between 1 and 50),
  settings      jsonb not null
                  default '{"mode":"ff","rounds":10,"seconds":15,"blind":true}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- remembered game settings must use the same choices as the game screen
  constraint settings_valid check (
    jsonb_typeof(settings) = 'object'
    and settings - array['mode', 'rounds', 'seconds', 'blind'] = '{}'::jsonb
    and (not settings ? 'mode'    or settings ->> 'mode'    in ('ff', 'ooo', 'mix'))
    and (not settings ? 'rounds'  or settings ->> 'rounds'  in ('5', '10', '15', '20'))
    and (not settings ? 'seconds' or settings ->> 'seconds' in ('10', '15', '20', '30'))
    and (not settings ? 'blind'   or jsonb_typeof(settings -> 'blind') = 'boolean')
  )
);

comment on table public.channels is 'One row per streamer, keyed by Twitch user ID.';

-- not unique: Twitch can give an old login to a new person after a rename
create index channels_login on public.channels (login);

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

-- security: a logged-in streamer can READ only their own channel row.
-- All changes go through server-side API functions.
alter table public.channels enable row level security;
revoke all on public.channels from anon, authenticated;
grant select on public.channels to authenticated;

create policy "streamer reads own channel"
  on public.channels for select
  to authenticated
  using (owner_user_id = (select auth.uid()));
