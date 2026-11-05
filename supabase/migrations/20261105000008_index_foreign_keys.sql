-- Mizavo: indexes on foreign keys flagged by the Supabase performance advisor
create index channel_seen_question_id on public.channel_seen (question_id);
create index questions_approved_by on public.questions (approved_by);
