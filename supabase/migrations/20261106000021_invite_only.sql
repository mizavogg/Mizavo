-- Mizavo: invite-only closed test
-- While invite_only is on, only channels on the invite list (and admins) can play.
-- Invites are by Twitch login, so a streamer can be invited before they ever log in.
-- Anyone can still log in; they just see "not on the invite list yet".
-- Turning invite_only off later (one admin call) opens the game to everyone.

-- the on/off switch: exactly one row
create table private.app_flags (
  only_one    boolean primary key default true check (only_one),
  invite_only boolean not null default true,
  updated_at  timestamptz not null default now()
);
insert into private.app_flags default values;

create table public.invites (
  login       text primary key check (login ~ '^[a-z0-9_]{1,25}$'),   -- twitch.tv/<login>, lowercase
  note        text check (char_length(note) <= 100),                  -- e.g. 'friend from Discord'
  invited_at  timestamptz not null default now(),
  invited_by  uuid references public.admins (user_id) on delete set null
);
comment on table public.invites is 'Twitch channels allowed to play while Mizavo is invite-only.';
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;

-- may this login play right now?
create function private.can_play(p_login text) returns boolean
language sql stable
set search_path = ''
as $$
  select not (select invite_only from private.app_flags)
      or exists (select 1 from public.invites i where i.login = lower(p_login))
      or exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
$$;
revoke execute on function private.can_play(text) from public, anon, authenticated;

-- my_channel: every game function goes through this, so the invite check lives here once
create or replace function private.my_channel() returns text
language plpgsql stable
set search_path = ''
as $$
declare v text; v_login text;
begin
  select c.id, c.login into v, v_login from public.channels c where c.owner_user_id = (select auth.uid());
  if v is null then
    raise exception 'no_channel: this login has no Mizavo channel yet';
  end if;
  if not private.can_play(v_login) then
    raise exception 'not_invited: Mizavo is in a closed test and this channel is not on the invite list yet';
  end if;
  return v;
end;
$$;

-- for the game page: can I play, and why not?
create function public.my_access() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_login text;
begin
  select c.login into v_login from public.channels c where c.owner_user_id = (select auth.uid());
  return jsonb_build_object(
    'invite_only', (select invite_only from private.app_flags),
    'can_play', v_login is not null and private.can_play(v_login),
    'login', v_login);
end;
$$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- ---------------------------------------------------------------------------
-- admin tools for invites
-- ---------------------------------------------------------------------------
create function public.admin_list_invites()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'invite_only', (select invite_only from private.app_flags),
    'invites', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.invited_at desc)
      from (
        select i.login, i.note, i.invited_at,
               c.display_name,                                   -- null until they first log in
               (select count(*) from public.sessions s
                 where s.channel_id = c.id and s.status = 'finished') as games_finished,
               (select max(s.started_at) from public.sessions s where s.channel_id = c.id) as last_played
        from public.invites i left join public.channels c on c.login = i.login
      ) x), '[]'::jsonb));
end;
$$;

create function public.admin_add_invite(p_login text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_admin uuid := private.require_admin();
        v_login text := lower(trim(regexp_replace(coalesce(p_login, ''), '^(https?://)?(www\.)?twitch\.tv/|^@', '', 'i')));
begin
  if v_login !~ '^[a-z0-9_]{1,25}$' then
    raise exception 'bad_login: use the Twitch name as in twitch.tv/name (letters, numbers, underscores)';
  end if;
  insert into public.invites (login, note, invited_by)
  values (v_login, nullif(trim(p_note), ''), v_admin)
  on conflict (login) do update set note = coalesce(excluded.note, public.invites.note);
  return jsonb_build_object('login', v_login, 'invited', true);
end;
$$;

create function public.admin_remove_invite(p_login text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  delete from public.invites where login = lower(trim(p_login));
  return jsonb_build_object('login', lower(trim(p_login)), 'removed', found);
end;
$$;

create function public.admin_set_invite_only(p_on boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_on is null then raise exception 'bad_value: choose on or off'; end if;
  update private.app_flags set invite_only = p_on, updated_at = now();
  return jsonb_build_object('invite_only', p_on);
end;
$$;

revoke execute on function public.admin_list_invites() from public, anon;
revoke execute on function public.admin_add_invite(text, text) from public, anon;
revoke execute on function public.admin_remove_invite(text) from public, anon;
revoke execute on function public.admin_set_invite_only(boolean) from public, anon;
grant execute on function public.admin_list_invites() to authenticated;
grant execute on function public.admin_add_invite(text, text) to authenticated;
grant execute on function public.admin_remove_invite(text) to authenticated;
grant execute on function public.admin_set_invite_only(boolean) to authenticated;
