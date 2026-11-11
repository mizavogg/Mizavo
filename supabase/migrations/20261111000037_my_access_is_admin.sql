-- Mizavo — migration 37: my_access() also says whether you're an admin,
-- so the site can show an "Admin" link in the menu to admins only.
-- (The admin page and every admin_* function still check admin rights on the server themselves.)
create or replace function public.my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_login text;
begin
  select c.login into v_login from public.channels c where c.owner_user_id = (select auth.uid());
  return jsonb_build_object(
    'invite_only', (select invite_only from private.app_flags),
    'can_play', v_login is not null and private.can_play(v_login),
    'login', v_login,
    'is_admin', coalesce(private.is_admin(), false));
end;
$function$;
