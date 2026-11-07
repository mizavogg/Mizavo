-- Mizavo: fix — reason 'other' must have a note. The first version let a missing
-- (null) note through, because a check on a missing value counts as passing.
alter table public.reports drop constraint other_needs_note;
alter table public.reports
  add constraint other_needs_note
  check (reason <> 'other' or (note is not null and char_length(trim(note)) >= 5));
