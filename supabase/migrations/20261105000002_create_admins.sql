-- Mizavo: admins
-- People allowed to approve or retire questions. Each admin is a logged-in
-- Supabase user (Twitch login), identified by their user id, never by name.

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete restrict,
  note       text check (char_length(note) <= 100),   -- e.g. 'Aiden (owner)'
  created_at timestamptz not null default now()
);

comment on table public.admins is 'Users allowed to approve or retire questions.';

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- Helper for future access rules: "is the person making this request an admin?"
-- security definer = it can look inside the locked admins table, but only answers yes/no.
create function public.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Every approval now records WHO approved it, and that person must be an admin.
alter table public.questions
  add column approved_by uuid references public.admins (user_id) on delete restrict;

alter table public.questions drop constraint approved_has_date;
alter table public.questions
  add constraint approved_needs_admin_and_date
  check (status <> 'approved' or (approved_at is not null and approved_by is not null));
