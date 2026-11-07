-- Mizavo: invite links
-- An admin makes a link like https://mizavo.../?invite=K7QX2M9PBD for one friend.
-- Anyone who opens it and logs in with Twitch is added to the invite list automatically.
-- Each link has a label, an optional cap on how many people can join, and an on/off switch.
-- Turning a link off only stops NEW people: anyone who already joined stays invited.

create table public.invite_links (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),   -- 10 random chars, no 0/O/1/I
  label       text not null check (char_length(label) between 1 and 60),  -- e.g. 'Jake + his friends'
  max_uses    int check (max_uses between 1 and 1000),                    -- null = no limit
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.admins (user_id) on delete set null
);
comment on table public.invite_links is 'Shareable links that add whoever uses them to the closed-test invite list.';
alter table public.invite_links enable row level security;
revoke all on public.invite_links from anon, authenticated;

-- which link (if any) brought each invited channel in
alter table public.invites
  add column via_link uuid references public.invite_links (id) on delete set null;
create index invites_via_link_idx on public.invites (via_link);

-- a random, unguessable code: 10 characters from a 32-letter alphabet (~50 bits)
create function private.new_invite_code() returns text
language sql volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(10) as b) r, generate_series(0, 9) as i
$$;
revoke execute on function private.new_invite_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- for the game page: use an invite code after logging in
-- ---------------------------------------------------------------------------
-- Returns status: 'joined' | 'already' (already invited, an admin, or closed test is off)
--               | 'inactive' (wrong code or switched off) | 'full'
create function public.redeem_invite(p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_login text; v_link public.invite_links; v_used int;
begin
  select c.login into v_login from public.channels c where c.owner_user_id = (select auth.uid());
  if v_login is null then
    raise exception 'no_channel: this login has no Mizavo channel yet';
  end if;

  if private.can_play(v_login) then
    return jsonb_build_object('status', 'already');
  end if;

  -- lock the link row so two people can't both take the last spot
  select * into v_link from public.invite_links l
   where l.code = upper(trim(coalesce(p_code, '')))
   for update;
  if v_link.id is null or not v_link.active then
    return jsonb_build_object('status', 'inactive');
  end if;

  select count(*) into v_used from public.invites i where i.via_link = v_link.id;
  if v_link.max_uses is not null and v_used >= v_link.max_uses then
    return jsonb_build_object('status', 'full');
  end if;

  insert into public.invites (login, note, via_link)
  values (v_login, left('via link: ' || v_link.label, 100), v_link.id)
  on conflict (login) do nothing;
  return jsonb_build_object('status', 'joined');
end;
$$;
revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin tools for invite links
-- ---------------------------------------------------------------------------
create function public.admin_list_invite_links()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select l.id, l.code, l.label, l.max_uses, l.active, l.created_at,
             (select count(*) from public.invites i where i.via_link = l.id) as joined
      from public.invite_links l
    ) x), '[]'::jsonb);
end;
$$;

create function public.admin_create_invite_link(p_label text, p_max_uses int default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_admin uuid := private.require_admin();
        v_label text := trim(coalesce(p_label, ''));
        v_row public.invite_links;
begin
  if char_length(v_label) not between 1 and 60 then
    raise exception 'bad_label: give the link a short name (1 to 60 characters)';
  end if;
  if p_max_uses is not null and p_max_uses not between 1 and 1000 then
    raise exception 'bad_max_uses: max uses must be between 1 and 1000, or blank for no limit';
  end if;
  insert into public.invite_links (code, label, max_uses, created_by)
  values (private.new_invite_code(), v_label, p_max_uses, v_admin)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'label', v_row.label, 'max_uses', v_row.max_uses);
end;
$$;

create function public.admin_set_invite_link_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_active is null then raise exception 'bad_value: choose on or off'; end if;
  update public.invite_links set active = p_active where id = p_id;
  if not found then raise exception 'not_found: no invite link with that id'; end if;
  return jsonb_build_object('id', p_id, 'active', p_active);
end;
$$;

revoke execute on function public.admin_list_invite_links() from public, anon;
revoke execute on function public.admin_create_invite_link(text, int) from public, anon;
revoke execute on function public.admin_set_invite_link_active(uuid, boolean) from public, anon;
grant execute on function public.admin_list_invite_links() to authenticated;
grant execute on function public.admin_create_invite_link(text, int) to authenticated;
grant execute on function public.admin_set_invite_link_active(uuid, boolean) to authenticated;
