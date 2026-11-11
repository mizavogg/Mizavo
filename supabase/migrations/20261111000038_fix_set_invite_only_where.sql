-- Mizavo — migration 38: fix the admin "Open to everyone" / "Back to closed test" button.
-- Requests from the website run with Supabase's safe-update guard, which refuses an UPDATE without WHERE
-- ("UPDATE requires a WHERE clause"). app_flags has exactly one row (only_one = true), so target it by name.
create or replace function public.admin_set_invite_only(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.require_admin();
  if p_on is null then raise exception 'bad_value: choose on or off'; end if;
  update private.app_flags set invite_only = p_on, updated_at = now() where only_one;
  return jsonb_build_object('invite_only', p_on);
end;
$function$;
