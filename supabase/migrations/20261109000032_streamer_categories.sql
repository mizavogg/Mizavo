-- Migration 32: streamers pick question categories (free), streamer vs chat only
--
-- Decided Nov 9: streamers can pick any mix of the 11 categories (or All, the default) for
-- streamer vs chat. The worldwide daily challenge doesn't change.
--   * A game still keeps the 30/40/30 easy/medium/hard balance and never repeats a question for the channel.
--   * Questions in the picked categories come from today's pool first, then from the whole bank
--     (least used first), because today's pool only has ~20 of each category.
--   * If the picked categories run out, the game fills the rest from other categories (today's pool
--     first) and says how many it filled, so a game never breaks halfway.
--   * The picked categories are saved on the game (sessions.categories) and remembered in the
--     channel's settings for next time.
--   * my_category_counts() tells the setup screen how many new questions the channel has left in
--     each category, by mode and difficulty, so it can warn before the game starts.

-- 1. remember the pick on the game, and allow it in channel settings
alter table public.sessions add column categories text[];
comment on column public.sessions.categories is 'Categories the streamer picked for this game; null = all.';

alter table public.channels drop constraint settings_valid;
alter table public.channels add constraint settings_valid check (
  jsonb_typeof(settings) = 'object'
  and settings - array['mode', 'rounds', 'seconds', 'blind', 'double', 'lightning', 'categories'] = '{}'::jsonb
  and (not settings ? 'mode'       or settings ->> 'mode'    in ('ff', 'ooo', 'mix'))
  and (not settings ? 'rounds'     or settings ->> 'rounds'  in ('5', '10', '15', '20'))
  and (not settings ? 'seconds'    or settings ->> 'seconds' in ('10', '15', '20', '30'))
  and (not settings ? 'blind'      or jsonb_typeof(settings -> 'blind') = 'boolean')
  and (not settings ? 'double'     or jsonb_typeof(settings -> 'double') = 'boolean')
  and (not settings ? 'lightning'  or jsonb_typeof(settings -> 'lightning') = 'boolean')
  and (not settings ? 'categories' or jsonb_typeof(settings -> 'categories') = 'array')
);

-- 2. the one list of categories (same as the questions table's check)
create or replace function private.all_categories() returns text[] language sql immutable set search_path to '' as $$
  select array['animals', 'space', 'geography', 'history', 'food', 'science',
               'human_body', 'pop_culture', 'language', 'music', 'sports']
$$;

-- clean up a pick: null, empty, or all 11 → null (= all); anything unknown is an error
create or replace function private.clean_categories(p text[]) returns text[]
language plpgsql immutable set search_path to '' as $$
declare v text[];
begin
  if p is null then return null; end if;
  select array_agg(distinct c order by c) into v from unnest(p) c where c is not null;
  if v is null then return null; end if;
  if not (v <@ private.all_categories()) then
    raise exception 'bad_settings: unknown category in %', p;
  end if;
  if private.all_categories() <@ v then return null; end if;
  return v;
end;
$$;

-- 3. how many new questions this channel has left, per category, mode and difficulty
--    e.g. {"music": {"ff": [8, 12, 10], "ooo": [5, 7, 6]}, ...}  (easy, medium, hard)
create or replace function public.my_category_counts()
returns jsonb language sql stable security definer set search_path to '' as $$
  with me as (select private.my_channel() as ch),
  fresh as (
    select q.category, q.mode, q.difficulty, count(*) n
    from public.questions q, me
    where q.status = 'approved'
      and not exists (select 1 from public.channel_seen s
                      where s.channel_id = me.ch and (s.question_id = q.id or s.fact_key = q.fact_key))
    group by 1, 2, 3)
  select coalesce(jsonb_object_agg(c.cat, jsonb_build_object(
           'ff',  jsonb_build_array(coalesce(ff1.n, 0), coalesce(ff2.n, 0), coalesce(ff3.n, 0)),
           'ooo', jsonb_build_array(coalesce(oo1.n, 0), coalesce(oo2.n, 0), coalesce(oo3.n, 0)))), '{}'::jsonb)
  from unnest(private.all_categories()) c(cat)
  left join fresh ff1 on ff1.category = c.cat and ff1.mode = 'ff'  and ff1.difficulty = 1
  left join fresh ff2 on ff2.category = c.cat and ff2.mode = 'ff'  and ff2.difficulty = 2
  left join fresh ff3 on ff3.category = c.cat and ff3.mode = 'ff'  and ff3.difficulty = 3
  left join fresh oo1 on oo1.category = c.cat and oo1.mode = 'ooo' and oo1.difficulty = 1
  left join fresh oo2 on oo2.category = c.cat and oo2.mode = 'ooo' and oo2.difficulty = 2
  left join fresh oo3 on oo3.category = c.cat and oo3.mode = 'ooo' and oo3.difficulty = 3;
$$;

-- 4. start_game with categories (same as migration 29 except where marked "new")
drop function public.start_game(text, int, int, boolean, boolean, boolean, boolean);

create function public.start_game(p_mode text, p_rounds integer, p_seconds integer, p_blind boolean,
                                  p_test boolean default false, p_double boolean default true,
                                  p_lightning boolean default true, p_categories text[] default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_ch    text := private.my_channel();
  v_date  date := private.today_utc();
  v_cats  text[] := private.clean_categories(p_categories);   -- new: null = all
  v_game  int;
  v_seed  bigint;
  v_sid   uuid;
  v_need  int[];
  v_light smallint;
  v_filled int := 0;                                            -- new: rounds filled from other categories
  d       int;
  pass    int;
  got     int;
  r       record;
  ids     uuid[] := '{}';
  keys    text[] := '{}';
  cats    text[] := '{}';
  diffs   int[]  := '{}';
  modes   text[] := '{}';
  hashes  text[] := '{}';
  ord     int[];
  i int; j int; k2 int; tmp int; best int;
begin
  if p_mode not in ('ff', 'ooo', 'mix') or p_rounds not in (5, 10, 15, 20)
     or p_seconds not in (10, 15, 20, 30) or p_blind is null or p_test is null
     or p_double is null or p_lightning is null then
    raise exception 'bad_settings: mode, rounds, seconds or a switch is not a valid option';
  end if;

  if exists (select 1 from public.sessions s where s.channel_id = v_ch and s.status = 'active') then
    raise exception 'game_in_progress: finish or abandon the current game first';
  end if;

  select coalesce(max(s.game_number), 0) + 1 into v_game
  from public.sessions s where s.channel_id = v_ch and s.play_date = v_date;

  v_seed := hashtextextended(v_ch || ':' || v_date::text || ':' || v_game::text, 0);

  v_need := array[round(p_rounds * 0.3)::int, 0, floor(p_rounds * 0.3)::int];
  v_need[2] := p_rounds - v_need[1] - v_need[3];

  -- new: four passes per difficulty
  --   1 = today's pool, picked categories   2 = whole bank, picked categories
  --   3 = today's pool, other categories    4 = whole bank, other categories (fillers)
  -- With no pick (all categories), passes 1–2 behave exactly like before and 3–4 find nothing.
  for d in 1..3 loop
    got := 0;
    for pass in 1..4 loop
      exit when got = v_need[d];
      for r in
        select q.id, q.fact_key, q.category, q.mode, md5(v_seed::text || q.id::text) as h
        from public.questions q
        where q.status = 'approved' and q.difficulty = d
          and (p_mode = 'mix' or q.mode = p_mode)
          and not (q.id = any(ids))
          and (exists (select 1 from public.daily_pools p where p.pool_date = v_date and p.question_id = q.id))
              = (pass in (1, 3))
          and (v_cats is null or q.category = any(v_cats)) = (pass in (1, 2))
          and not exists (select 1 from public.channel_seen s
                          where s.channel_id = v_ch and (s.question_id = q.id or s.fact_key = q.fact_key))
        order by case when pass in (1, 3) then 0 else q.times_used end, md5(v_seed::text || q.id::text)
      loop
        exit when got = v_need[d];
        continue when r.fact_key = any(keys);
        ids := ids || r.id; keys := keys || r.fact_key; cats := cats || r.category;
        diffs := diffs || d; modes := modes || r.mode; hashes := hashes || r.h;
        got := got + 1;
        if pass >= 3 then v_filled := v_filled + 1; end if;
      end loop;
    end loop;

    if got < v_need[d] then
      raise exception 'not_enough_questions: only % unseen questions of difficulty % available, % needed',
        got, d, v_need[d];
    end if;
  end loop;

  select array_agg(k order by diffs[k], hashes[k]) into ord from generate_subscripts(ids, 1) as k;

  for i in 2..array_length(ord, 1) loop
    if cats[ord[i]] = cats[ord[i - 1]] then
      j := null;
      for k2 in i + 1 .. array_length(ord, 1) loop
        if cats[ord[k2]] <> cats[ord[i - 1]] then
          if diffs[ord[k2]] = diffs[ord[i]] then j := k2; exit; end if;
          if j is null then j := k2; end if;
        end if;
      end loop;
      if j is not null then tmp := ord[i]; ord[i] := ord[j]; ord[j] := tmp; end if;
    end if;
  end loop;

  if p_lightning and p_rounds >= 10 and p_mode in ('ff', 'mix')
     and (select count(*) from unnest(modes) m where m = 'ff') >= 3 then
    v_light := (p_rounds / 2)::smallint;
    for i in v_light .. v_light + 2 loop
      if modes[ord[i]] <> 'ff' then
        best := null;
        for k2 in 1 .. array_length(ord, 1) loop
          continue when k2 between v_light and v_light + 2 or modes[ord[k2]] <> 'ff' or diffs[ord[k2]] <> diffs[ord[i]];
          if best is null or abs(k2 - i) < abs(best - i) then best := k2; end if;
        end loop;
        if best is null then
          for k2 in 1 .. array_length(ord, 1) loop
            continue when k2 between v_light and v_light + 2 or modes[ord[k2]] <> 'ff';
            if best is null or abs(k2 - i) < abs(best - i) then best := k2; end if;
          end loop;
        end if;
        tmp := ord[i]; ord[i] := ord[best]; ord[best] := tmp;
      end if;
    end loop;
  end if;

  insert into public.sessions (channel_id, play_date, game_number, seed, mode, rounds, seconds, blind, is_test,
                               double_final, lightning_at, categories)
  values (v_ch, v_date, v_game, v_seed, p_mode, p_rounds, p_seconds, p_blind, p_test, p_double, v_light, v_cats)
  returning id into v_sid;

  for i in 1..array_length(ord, 1) loop
    insert into public.session_rounds (session_id, idx, question_id, option_order, seconds, weight)
    values (
      v_sid, i, ids[ord[i]],
      case when modes[ord[i]] = 'ooo' then
        (select array_agg(k::smallint order by md5(v_seed::text || ids[ord[i]]::text || k::text))
         from generate_series(0, 3) as k)
      end,
      case when v_light is not null and i between v_light and v_light + 2 then 10 end,
      case when p_double and i = p_rounds then 2 else 1 end
    );
  end loop;

  update public.channels
  set settings = jsonb_strip_nulls(jsonb_build_object(
        'mode', p_mode, 'rounds', p_rounds, 'seconds', p_seconds, 'blind', p_blind,
        'double', p_double, 'lightning', p_lightning, 'categories', to_jsonb(v_cats)))
  where id = v_ch;

  return jsonb_strip_nulls(jsonb_build_object(
    'session_id', v_sid, 'game_number', v_game, 'mode', p_mode,
    'rounds', p_rounds, 'seconds', p_seconds, 'blind', p_blind,
    'is_test', p_test, 'double_final', p_double, 'lightning_at', v_light,
    'categories', to_jsonb(v_cats), 'filled_from_other', v_filled));
end;
$$;

revoke execute on function public.start_game(text, int, int, boolean, boolean, boolean, boolean, text[]) from public, anon;
grant execute on function public.start_game(text, int, int, boolean, boolean, boolean, boolean, text[]) to authenticated;
revoke execute on function public.my_category_counts() from public, anon;
grant execute on function public.my_category_counts() to authenticated;
revoke all on function private.all_categories(), private.clean_categories(text[]) from public;
