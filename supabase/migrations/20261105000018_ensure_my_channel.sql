-- Mizavo: ensure_my_channel — called by the game right after a streamer logs in with Twitch.
-- First login: creates their channel (keyed by Twitch user ID). Later logins: refreshes their
-- Twitch login/display name (renames). Returns the channel, saved settings, and admin flag.
-- Identity comes ONLY from Supabase's verified Twitch login, never from what the browser sends.

create function public.ensure_my_channel()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_twitch_id text; v_data jsonb;
  v_login text; v_display text;
  c public.channels;
begin
  if v_uid is null then raise exception 'not_logged_in: log in with Twitch first'; end if;

  select i.provider_id, i.identity_data into v_twitch_id, v_data
  from auth.identities i
  where i.user_id = v_uid and i.provider = 'twitch'
  order by i.last_sign_in_at desc nulls last
  limit 1;
  if v_twitch_id is null then raise exception 'not_twitch: Mizavo channels need a Twitch login'; end if;

  -- Twitch login (lowercase handle) and display name, from whichever fields Twitch filled in
  select lower(x) into v_login
  from unnest(array[v_data ->> 'slug', v_data ->> 'preferred_username', v_data ->> 'user_name',
                    v_data ->> 'name', v_data ->> 'nickname', v_data ->> 'full_name']) as x
  where lower(x) ~ '^[a-z0-9_]{1,25}$'
  limit 1;
  v_login := coalesce(v_login, 'user_' || left(v_twitch_id, 20));

  select x into v_display
  from unnest(array[v_data ->> 'nickname', v_data ->> 'full_name', v_data ->> 'name',
                    v_data ->> 'preferred_username']) as x
  where char_length(trim(coalesce(x, ''))) between 1 and 50
  limit 1;
  v_display := coalesce(trim(v_display), v_login);

  insert into public.channels (id, owner_user_id, login, display_name)
  values (v_twitch_id, v_uid, v_login, v_display)
  on conflict (id) do update
    set login = excluded.login, display_name = excluded.display_name
    where public.channels.owner_user_id = excluded.owner_user_id;

  select * into c from public.channels where id = v_twitch_id;
  if c.owner_user_id <> v_uid then
    raise exception 'channel_conflict: this Twitch channel is already linked to a different Mizavo login';
  end if;

  return jsonb_build_object(
    'channel_id', c.id, 'login', c.login, 'display_name', c.display_name,
    'settings', c.settings, 'created_at', c.created_at,
    'is_admin', exists (select 1 from public.admins a where a.user_id = v_uid)
  );
end;
$$;

revoke execute on function public.ensure_my_channel() from public, anon;
grant execute on function public.ensure_my_channel() to authenticated;
