-- Mizavo: admin API + question lifecycle rules
-- Admins (people in public.admins) review the bank: add drafts, edit drafts, approve, retire,
-- resolve reports, see the dashboard, and build a pool on demand.
-- The content pipeline (Python, server-side service key) may ADD drafts but never approve:
-- every question needs a human admin's approval before it can be played.

-- ---------------------------------------------------------------------------
-- 1. question lifecycle, enforced on the table itself
--    draft -> approved -> retired, or draft -> retired. Nothing comes back from retired.
--    Once approved, what players see and the answer are frozen (only difficulty may be
--    re-rated from real stats). Fixing an approved question = retire it, add a new draft.
-- ---------------------------------------------------------------------------
create function private.questions_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('approved', 'retired'))
         or (old.status = 'approved' and new.status = 'retired')) then
      raise exception 'question %: status cannot go from % to %', old.id, old.status, new.status;
    end if;
  end if;

  if old.status <> 'draft' and
     (new.mode, new.language, new.payload, new.answer, new.explanation, new.category,
      new.fact_key, new.source_url, new.origin, new.created_at)
     is distinct from
     (old.mode, old.language, old.payload, old.answer, old.explanation, old.category,
      old.fact_key, old.source_url, old.origin, old.created_at) then
    raise exception 'question % is %: its content is frozen (retire it and add a corrected draft)', old.id, old.status;
  end if;

  if old.status <> 'draft' and (new.approved_at, new.approved_by) is distinct from (old.approved_at, old.approved_by) then
    raise exception 'question %: approval details cannot be changed', old.id;
  end if;

  if old.status = 'retired' and new.difficulty is distinct from old.difficulty then
    raise exception 'question % is retired', old.id;
  end if;

  return new;
end;
$$;

create trigger questions_guard_update
  before update on public.questions
  for each row execute function private.questions_guard_update();

revoke execute on function private.questions_guard_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create function private.require_admin() returns uuid
language plpgsql stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.admins where user_id = (select auth.uid())) then
    raise exception 'not_admin: only Mizavo admins can do this';
  end if;
  return (select auth.uid());
end;
$$;

revoke execute on function private.require_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_add_questions: add a batch of DRAFTS (admins, or the pipeline's service key)
-- p_questions: [{"mode":"ff","statement":"...","answer":true,"explanation":"...","difficulty":1,
--                "category":"animals","fact_key":"octopus-hearts","source_url":"https://...",
--                "origin":"handwritten"},
--               {"mode":"ooo","items":["a","b","c","d"],"answer":2, ...}]
-- Each row is checked on its own: good rows go in, bad rows come back with the reason.
-- ---------------------------------------------------------------------------
create function public.admin_add_questions(p_questions jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  q jsonb; n bigint; v_id uuid;
  added jsonb := '[]'; skipped jsonb := '[]'; failed jsonb := '[]';
begin
  if (select auth.role()) is distinct from 'service_role' then
    perform private.require_admin();
  end if;
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'bad_batch: send a list of questions'; end if;
  if jsonb_array_length(p_questions) > 1000 then raise exception 'bad_batch: at most 1,000 questions per batch'; end if;

  for q, n in select e, i from jsonb_array_elements(p_questions) with ordinality as t(e, i) loop
    begin
      insert into public.questions
        (mode, language, payload, answer, explanation, difficulty, category, fact_key, source_url, origin, status)
      values (
        q ->> 'mode',
        coalesce(q ->> 'language', 'en'),
        coalesce(q -> 'payload',
                 case q ->> 'mode' when 'ff' then jsonb_build_object('statement', q -> 'statement')
                                   when 'ooo' then jsonb_build_object('items', q -> 'items') end),
        q -> 'answer',
        q ->> 'explanation',
        (q ->> 'difficulty')::smallint,
        q ->> 'category',
        q ->> 'fact_key',
        q ->> 'source_url',
        coalesce(q ->> 'origin', 'handwritten'),
        'draft'
      )
      returning id into v_id;
      added := added || jsonb_build_object('row', n, 'id', v_id);
    exception
      when unique_violation then
        skipped := skipped || jsonb_build_object('row', n, 'reason', 'exact duplicate of an existing question');
      when others then
        failed := failed || jsonb_build_object('row', n, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('added', jsonb_array_length(added), 'skipped', jsonb_array_length(skipped),
                            'failed', jsonb_array_length(failed),
                            'added_ids', added, 'skipped_rows', skipped, 'failed_rows', failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_questions: the review queue (includes answers: admins only)
-- ---------------------------------------------------------------------------
create function public.admin_list_questions(p_status text default 'draft', p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at, x.id)
    from (
      select q.id, q.mode, q.language, q.payload, q.answer, q.explanation, q.difficulty, q.category,
             q.fact_key, q.source_url, q.origin, q.status, q.approved_at, q.times_used, q.correct_rate,
             q.created_at,
             (select count(*) from public.reports r where r.question_id = q.id and r.status = 'open') as open_reports
      from public.questions q
      where q.status = p_status
      order by q.created_at, q.id
      limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)
    ) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_edit_draft: change fields of a DRAFT (approved/retired content is frozen)
-- ---------------------------------------------------------------------------
create function public.admin_edit_draft(p_id uuid, p_changes jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare q public.questions;
begin
  perform private.require_admin();
  select * into q from public.questions where id = p_id for update;
  if not found then raise exception 'question_not_found'; end if;
  if q.status <> 'draft' then raise exception 'not_draft: only drafts can be edited (this one is %)', q.status; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k
             where k not in ('mode','language','payload','statement','items','answer','explanation',
                             'difficulty','category','fact_key','source_url','origin')) then
    raise exception 'bad_field: only question content fields can be edited';
  end if;

  update public.questions set
    mode        = coalesce(p_changes ->> 'mode', mode),
    language    = coalesce(p_changes ->> 'language', language),
    payload     = coalesce(p_changes -> 'payload',
                    case when p_changes ? 'statement' then jsonb_build_object('statement', p_changes -> 'statement')
                         when p_changes ? 'items' then jsonb_build_object('items', p_changes -> 'items') end,
                    payload),
    answer      = coalesce(p_changes -> 'answer', answer),
    explanation = coalesce(p_changes ->> 'explanation', explanation),
    difficulty  = coalesce((p_changes ->> 'difficulty')::smallint, difficulty),
    category    = coalesce(p_changes ->> 'category', category),
    fact_key    = coalesce(p_changes ->> 'fact_key', fact_key),
    source_url  = coalesce(p_changes ->> 'source_url', source_url),
    origin      = coalesce(p_changes ->> 'origin', origin)
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'draft', 'edited', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_approve_questions: drafts -> approved (records who and when)
-- ---------------------------------------------------------------------------
create function public.admin_approve_questions(p_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_admin uuid := private.require_admin(); n int; v_not_draft int;
begin
  select count(*) into v_not_draft from public.questions where id = any(p_ids) and status <> 'draft';
  update public.questions set status = 'approved', approved_at = now(), approved_by = v_admin
  where id = any(p_ids) and status = 'draft';
  get diagnostics n = row_count;
  return jsonb_build_object('approved', n, 'not_drafts_ignored', v_not_draft,
                            'not_found', coalesce(cardinality(p_ids), 0) - n - v_not_draft);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_retire_questions: take questions out of play for good
-- ---------------------------------------------------------------------------
create function public.admin_retire_questions(p_ids uuid[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare n int;
begin
  perform private.require_admin();
  update public.questions set status = 'retired' where id = any(p_ids) and status in ('draft', 'approved');
  get diagnostics n = row_count;
  return jsonb_build_object('retired', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_reports / admin_resolve_report
-- ---------------------------------------------------------------------------
create function public.admin_list_reports(p_status text default 'open', p_limit int default 50)
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
             q.id as question_id, q.mode, q.payload, q.answer, q.explanation, q.source_url, q.status as question_status,
             (select count(*) from public.reports r2 where r2.question_id = q.id and r2.status = 'open') as reports_on_question
      from public.reports r join public.questions q on q.id = r.question_id
      where r.status = p_status
      order by r.created_at
      limit least(greatest(p_limit, 1), 500)
    ) x), '[]'::jsonb);
end;
$$;

create function public.admin_resolve_report(p_report uuid, p_decision text, p_note text default null,
                                             p_retire_question boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_admin uuid := private.require_admin(); r public.reports; v_retired boolean := false;
begin
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'bad_decision: choose accepted or rejected';
  end if;
  if p_retire_question and p_decision <> 'accepted' then
    raise exception 'bad_decision: only an accepted report can retire its question';
  end if;

  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'report_not_found'; end if;
  if r.status <> 'open' then raise exception 'already_resolved: this report was already %', r.status; end if;

  update public.reports set status = p_decision, resolved_at = now(), resolved_by = v_admin,
                            resolution_note = nullif(trim(p_note), '')
  where id = p_report;

  if p_retire_question then
    update public.questions set status = 'retired' where id = r.question_id and status in ('draft', 'approved');
    v_retired := found;
  end if;

  return jsonb_build_object('report_id', p_report, 'status', p_decision, 'question_retired', v_retired);
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_dashboard: the content health numbers from the spec
-- ---------------------------------------------------------------------------
create function public.admin_dashboard()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_today date := private.today_utc();
begin
  perform private.require_admin();
  return jsonb_build_object(
    'today', v_today,
    'approved_by_mode_and_difficulty', (
      select coalesce(jsonb_object_agg(k, c), '{}') from (
        select q.mode || '_' || q.difficulty as k, count(*) as c
        from public.questions q where q.status = 'approved' group by 1) z),
    'approved', (select count(*) from public.questions where status = 'approved'),
    'drafts', (select count(*) from public.questions where status = 'draft'),
    'retired', (select count(*) from public.questions where status = 'retired'),
    'fresh_for_pools', (   -- approved and not pooled in the last 60 days
      select count(*) from public.questions q
      where q.status = 'approved'
        and not exists (select 1 from public.daily_pools p where p.question_id = q.id and p.pool_date > v_today - 60)),
    'shown_this_week', (select count(*) from public.channel_seen where seen_at > now() - interval '7 days'),
    'games_this_week', (select count(*) from public.sessions where started_at > now() - interval '7 days'),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'top_reported', (
      select coalesce(jsonb_agg(to_jsonb(z)), '[]') from (
        select r.question_id, count(*) as open_reports
        from public.reports r where r.status = 'open'
        group by 1 order by 2 desc limit 10) z),
    'recent_pool_builds', (
      select coalesce(jsonb_agg(to_jsonb(z) order by z.pool_date desc), '[]') from (
        select distinct on (b.pool_date) b.pool_date, b.total, b.ff, b.ooo, b.categories,
               b.reused_early, b.shortfall, b.note, b.built_at
        from private.pool_builds b
        where b.pool_date > v_today - 7
        order by b.pool_date, b.built_at desc) z)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_build_pool: build a day's pool now (normally the nightly job does this)
-- ---------------------------------------------------------------------------
create function public.admin_build_pool(p_date date default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.build_daily_pool(coalesce(p_date, private.today_utc()));
end;
$$;

-- ---------------------------------------------------------------------------
-- permissions: logged-in users may CALL these, but each one checks admin rights first
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_add_questions(jsonb) from public, anon;
revoke execute on function public.admin_list_questions(text, int, int) from public, anon;
revoke execute on function public.admin_edit_draft(uuid, jsonb) from public, anon;
revoke execute on function public.admin_approve_questions(uuid[]) from public, anon;
revoke execute on function public.admin_retire_questions(uuid[]) from public, anon;
revoke execute on function public.admin_list_reports(text, int) from public, anon;
revoke execute on function public.admin_resolve_report(uuid, text, text, boolean) from public, anon;
revoke execute on function public.admin_dashboard() from public, anon;
revoke execute on function public.admin_build_pool(date) from public, anon;

grant execute on function public.admin_add_questions(jsonb) to authenticated, service_role;
grant execute on function public.admin_list_questions(text, int, int) to authenticated;
grant execute on function public.admin_edit_draft(uuid, jsonb) to authenticated;
grant execute on function public.admin_approve_questions(uuid[]) to authenticated;
grant execute on function public.admin_retire_questions(uuid[]) to authenticated;
grant execute on function public.admin_list_reports(text, int) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_build_pool(date) to authenticated;
