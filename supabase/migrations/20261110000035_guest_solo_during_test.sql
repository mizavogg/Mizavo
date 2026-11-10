-- Mizavo — migration 35: guests can play yesterday's daily challenge during the closed test.
-- Before, guest play followed the invite-only switch (off during the test). Now it's always on.
-- Today's challenge and the solo board still need an invited, logged-in account while invite-only is on.
-- Nothing a guest does is saved, and guests only ever see yesterday's (finished) set.
create or replace function private.guest_check() returns date
language plpgsql stable set search_path to '' as $$
declare v_date date := private.today_utc() - 1;
begin
  if not exists (select 1 from public.solo_days where play_date = v_date) then
    raise exception 'no_challenge: there''s no guest challenge yet. Check back tomorrow';
  end if;
  return v_date;
end;
$$;
