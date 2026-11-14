-- Mizavo migration 43 (Nov 14, 2026): spam limits.
-- 1. "Report this question": at most 10 reports per channel per hour (one open report per question was already the rule).
-- 2. Visit counter: besides 40 views a minute per visitor ID, the whole site counts at most 600 views a minute,
--    so someone making up new visitor IDs can't flood the table. Real traffic is far below that today.
--    (If Mizavo ever gets more than 600 views a minute, raise this number.)

create index if not exists page_views_at on public.page_views (at);

create or replace function public.report_question(p_question uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ch text := private.my_channel();
  v_id uuid;
begin
  if exists (select 1 from public.reports
             where question_id = p_question and channel_id = v_ch and status = 'open') then
    raise exception 'already_reported: you already have an open report on this question';
  end if;
  if (select count(*) from public.reports
      where channel_id = v_ch and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_reports: at most 10 reports an hour';
  end if;
  insert into public.reports (question_id, channel_id, reason, note)
  values (p_question, v_ch, p_reason, nullif(trim(p_note), ''))
  returning id into v_id;
  return jsonb_build_object('report_id', v_id, 'status', 'open');
end;
$function$;

create or replace function public.track_view(p_visitor text, p_visit text, p_path text, p_referrer text, p_source text,
  p_device text, p_browser text, p_tz text, p_lang text, p_new boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and exists (select 1 from public.admins a where a.user_id = v_uid) then return; end if;
  if p_visitor !~ '^[a-z0-9]{12,32}$' or p_visit !~ '^[a-z0-9]{12,32}$'
     or p_device not in ('phone', 'tablet', 'desktop') or coalesce(p_path, '') = '' then return; end if;
  if (select count(*) from public.page_views
      where visitor = p_visitor and at > now() - interval '1 minute') >= 40 then return; end if;
  if (select count(*) from public.page_views where at > now() - interval '1 minute') >= 600 then return; end if;
  insert into public.page_views (visitor, visit, path, referrer, source, device, browser, tz, lang, logged_in, new_visitor)
  values (p_visitor, p_visit, left(p_path, 60), nullif(left(lower(p_referrer), 80), ''), nullif(left(lower(p_source), 40), ''),
          p_device, nullif(left(p_browser, 20), ''), nullif(left(p_tz, 40), ''), nullif(left(p_lang, 12), ''),
          v_uid is not null, coalesce(p_new, false));
end;
$function$;
