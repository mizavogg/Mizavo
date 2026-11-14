-- Mizavo migration 46 (Nov 14, 2026): a test path for reminders. Only admins' own devices, only via send-reminders
-- (which needs the schedule's password from Vault). Used to check a real notification arrives.
create or replace function public.push_admin_test()
returns table (endpoint text, p256dh text, auth text, local_day date)
language sql security definer set search_path to '' as $$
  select s.endpoint, s.p256dh, s.auth, (now() at time zone s.tz)::date
  from public.push_subs s join public.admins a on a.user_id = s.user_id;
$$;
revoke all on function public.push_admin_test() from public, anon, authenticated;
grant execute on function public.push_admin_test() to service_role;
