-- Mizavo migration 52 (Nov 15, 2026): the server functions' account (service_role) could not read or write any table.
-- This project's default privileges give new tables no read/write to service_role, so twitch-chat (trusted scoring),
-- the "Re-connect Twitch" check and twitch-avatars (picture cache + warm-up pictures) silently got nothing back.
-- service_role only exists on Supabase's servers (Edge Functions); visitors (anon) and players (authenticated) are unchanged.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
