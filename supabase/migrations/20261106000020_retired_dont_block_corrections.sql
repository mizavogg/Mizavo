-- Mizavo: retired questions don't block their corrections
-- Approved questions are frozen; a mistake is fixed by retiring the question and adding a
-- corrected draft. When only the explanation or source changes, the corrected draft has the
-- same text as the retired one, which the old "no exact duplicates" rule blocked.
-- Now only questions still in use (draft or approved) count as exact duplicates.
drop index public.questions_no_exact_duplicate;
create unique index questions_no_exact_duplicate
  on public.questions (language, mode, payload) where status <> 'retired';
