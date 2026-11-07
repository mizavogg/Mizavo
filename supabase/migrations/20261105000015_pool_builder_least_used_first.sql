-- Mizavo: fix — the pool builder must favor least-used questions FIRST (spec step 2),
-- then spread categories among equally-used questions. Version 1 let category
-- spreading pick heavily used questions while fresh ones were still available.
create or replace function private.build_daily_pool(p_date date)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
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

  perform pg_advisory_xact_lock(hashtext('mizavo_build_pool'));
  if exists (select 1 from public.daily_pools where pool_date = p_date) then
    return jsonb_build_object('pool_date', p_date, 'status', 'already_built');
  end if;

  for b in 1..6 loop
    got := 0;
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
        select c.*,
               -- spread categories: 1st of each category, then 2nd of each, ... among equally-used questions
               row_number() over (partition by c.category, c.times_used
                                  order by c.last_pooled nulls first, c.h) as rn_cat
        from candidates c
        where (pass = 1 and (c.last_pooled is null or c.last_pooled < p_date - 60))
           or (pass = 2 and c.last_pooled >= p_date - 60)
      ),
      chosen as (
        select e.id,
               row_number() over (order by
                 case when pass = 2 then e.last_pooled end nulls first,   -- pass 2: oldest pool first
                 e.times_used, e.rn_cat, e.last_pooled nulls first, e.h) as k
        from eligible e
        order by case when pass = 2 then e.last_pooled end nulls first,
                 e.times_used, e.rn_cat, e.last_pooled nulls first, e.h
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

revoke execute on function private.build_daily_pool(date) from public, anon, authenticated;
