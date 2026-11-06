-- Mizavo: the admin Reports tab shows which channel sent each report
-- (same as before, plus channel_login and channel_name).
create or replace function public.admin_list_reports(p_status text default 'open', p_limit integer default 50)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.reports_on_question desc, x.created_at)
    from (
      select r.id, r.reason, r.note, r.status, r.created_at, r.channel_id, r.resolution_note, r.resolved_at,
             c.login as channel_login, c.display_name as channel_name,
             q.id as question_id, q.mode, q.payload, q.answer, q.explanation, q.source_url, q.status as question_status,
             (select count(*) from public.reports r2 where r2.question_id = q.id and r2.status = 'open') as reports_on_question
      from public.reports r
      join public.questions q on q.id = r.question_id
      left join public.channels c on c.id = r.channel_id
      where r.status = p_status
      order by case when p_status = 'open' then r.created_at end,   -- open: oldest first
               r.created_at desc                                     -- resolved: newest first
      limit least(greatest(p_limit, 1), 500)
    ) x), '[]'::jsonb);
end;
$$;
