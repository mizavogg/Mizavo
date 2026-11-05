-- Mizavo: private schema for internal helpers
-- Functions here are never reachable through the public web API.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

drop function public.is_admin();

create function private.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;

revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- the question-shape helper is internal too
revoke execute on function public.ooo_items_valid(jsonb) from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
