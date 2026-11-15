-- Mizavo migration 50 (Nov 14, 2026): answers can carry a little extra.
-- Twitch won't let a viewer send the exact same message twice within 30 seconds, so a repeated character or a
-- trailing symbol still counts: "1" = "11" = "1." = "1!", "b" = "bb" = "b?". Same rules as parseVote (game/chat.ts).
-- (File recovered from the live database on Nov 15: build 68's source zip never reached the Mac.)

create or replace function private.parse_vote(p_text text, p_mode text)
returns smallint language plpgsql immutable set search_path to '' as $$
declare t text := regexp_replace(lower(trim(coalesce(p_text, ''))), '^!(vote|v)\s*', ''); w text;
begin
  if length(t) > 12 then return null; end if;
  w := substring(t from '^([a-z]+|[0-9]+)(?:[^a-z0-9].*)?$');
  if w is null then return null; end if;
  if w ~ '^(.)\1+$' then w := left(w, 1); end if;
  if p_mode = 'ff' then
    if w ~ '^(1|fact|true|real|yes|t)$' then return 0; end if;
    if w ~ '^(2|fake|false|cap|no)$' then return 1; end if;
    return null;
  end if;
  if w ~ '^[a-d]$' then return ascii(w) - 97; end if;
  if w ~ '^[1-4]$' then return w::int - 1; end if;
  return null;
end $$;
