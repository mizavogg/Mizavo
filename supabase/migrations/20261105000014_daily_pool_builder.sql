-- Mizavo: nightly pool builder
-- Builds the 200-question pool for one UTC day, following the build spec:
--   1. approved questions not pooled in the last 60 days
--   2. least-used first, so the whole bank rotates
--   3. fixed shape: 120 Fact or Fake + 80 Odd One Out, each ~30% easy / 40% medium / 30% hard,
--      spread across categories (target: at least 6)
--   4. once a day's pool exists it never changes
-- If the bank is too small, it falls back to questions pooled longest ago, and if still short
-- it saves what it can and records the shortfall (never fails silently).

-- a log of every build, for the ops dashboard
create table private.pool_builds (
  pool_date    date primary key,
  built_at     timestamptz not null default now(),
  total        int not null,
  ff           int not null,
  ooo          int not null,
  categories   int not null,
  reused_early int not null,   -- questions that had to come back within 60 days
  shortfall    int not null,   -- slots left empty because the bank ran out
  note         text
);

create function private.build_daily_pool(p_date date)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  -- (mode, difficulty, slots): 120 FF = 36/48/36, 80 OOO = 24/32/24
  buckets  constant text[] := array['ff','ff','ff','ooo','ooo','ooo'];
  diffs    constant int[]  := array[1, 2, 3, 1, 2, 3];
  needs    constant int[]  := array[36, 48, 36, 24, 32, 24];
  b int; got int; added int; v_reused int := 0; v_short int := 0;
  v_next int; v_total int; v_ff int; v_ooo int; v_cats int; v_note text;
begin
  if p_date < private.today_utc() then
    raise exception 'past_date: pools for past days are never rebuilt';
  end if;

  if exists (select 1 from public.daily_pools where pool_date = p_date) then
    return jsonb_build_object('pool_date', p_date, 'status', 'already_built');
  end if;

  -- serialize builds so two runs can't race
  perform pg_advisory_xact_lock(hashtext('mizavo_build_pool'));
  if exists (select 1 from public.daily_pools where pool_date = p_date) then
    return jsonb_build_object('pool_date', p_date, 'status', 'already_built');
  end if;

  for b in 1..6 loop
    got := 0;

    -- pass 1: not pooled in the last 60 days; least used; categories interleaved
    -- pass 2 (only if short): allow recently pooled, the longest-ago first
    for pass in 1..2 loop
      exit when got >= needs[b];
      select coalesce(max(slot), 0) into v_next from public.daily_pools where pool_date = p_date;

      with candidates as (
        select distinct on (q.fact_key)
               q.id, q.category, q.times_used, q.fact_key,
               (select max(p.pool_date) from public.daily_pools p where p.question_id = q.id) as last_pooled,
               md5(p_date::text || q.id::text) as h
        from public.questions q
        where q.status = 'approved' and q.mode = buckets[b] and q.difficulty = diffs[b]
          and not exists (select 1 from public.daily_pools p
                          join public.questions q2 on q2.id = p.question_id
                          where p.pool_date = p_date and (p.question_id = q.id or q2.fact_key = q.fact_key))
        order by q.fact_key, q.times_used, md5(p_date::text || q.id::text)
      ),
      eligible as (
        select c.*, row_number() over (partition by c.category
                                       order by c.last_pooled nulls first, c.times_used, c.h) as rn_cat
        from candidates c
        where (pass = 1 and (c.last_pooled is null or c.last_pooled < p_date - 60))
           or (pass = 2 and c.last_pooled >= p_date - 60)
      ),
      chosen as (
        select e.id, row_number() over (order by e.rn_cat, e.last_pooled nulls first, e.times_used, e.h) as k
        from eligible e
        order by e.rn_cat, e.last_pooled nulls first, e.times_used, e.h
        limit needs[b] - got
      )
      insert into public.daily_pools (pool_date, slot, question_id)
      select p_date, v_next + k, id from chosen;

      get diagnostics added = row_count;
      got := got + added;
      if pass = 2 then v_reused := v_reused + added; end if;
    end loop;

    v_short := v_short + (needs[b] - got);
  end loop;

  select count(*), count(*) filter (where q.mode = 'ff'), count(*) filter (where q.mode = 'ooo'),
         count(distinct q.category)
  into v_total, v_ff, v_ooo, v_cats
  from public.daily_pools p join public.questions q on q.id = p.question_id
  where p.pool_date = p_date;

  v_note := concat_ws('; ',
    case when v_short > 0 then v_short || ' slots empty: not enough approved questions' end,
    case when v_reused > 0 then v_reused || ' questions reused within 60 days' end,
    case when v_total > 0 and v_cats < 6 then 'only ' || v_cats || ' categories (target 6+)' end);

  insert into private.pool_builds (pool_date, total, ff, ooo, categories, reused_early, shortfall, note)
  values (p_date, v_total, v_ff, v_ooo, v_cats, v_reused, v_short, nullif(v_note, ''));

  return jsonb_build_object('pool_date', p_date, 'status', 'built', 'total', v_total, 'ff', v_ff,
                            'ooo', v_ooo, 'categories', v_cats, 'reused_early', v_reused,
                            'shortfall', v_short, 'note', nullif(v_note, ''));
end;
$$;

-- only the database itself (the scheduler, admins via the dashboard) may build pools
revoke all on table private.pool_builds from public, anon, authenticated;
revoke execute on function private.build_daily_pool(date) from public, anon, authenticated;
