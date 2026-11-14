-- Migration 41: warm-up rounds are 35 seconds (was 20), to leave room for stream delay (Aiden, Nov 13)
create or replace function private.warmup_seconds() returns int language sql immutable as $$ select 35 $$;
revoke execute on function private.warmup_seconds() from public, anon, authenticated;
