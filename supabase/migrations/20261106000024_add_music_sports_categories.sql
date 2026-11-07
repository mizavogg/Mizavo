-- Migration 24: allow two new worldwide categories, music and sports (Aiden, Nov 6).
-- (Recovered from the live database's migration history; it was applied before the file was saved.)
alter table public.questions drop constraint questions_category_check;
alter table public.questions add constraint questions_category_check
  check (category = any (array['animals','space','geography','history','food','science',
                               'human_body','pop_culture','language','music','sports']));
