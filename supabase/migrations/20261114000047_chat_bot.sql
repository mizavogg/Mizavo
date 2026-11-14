-- Mizavo migration 47 (Nov 14, 2026): the chat bot's identity.
-- Saved once by the twitch-bot-connect Edge Function after mizavobot approves user:read:chat + user:bot.
-- Only the bot's Twitch user id and login: no tokens. Service role only.
create table private.chat_bot (
  only_one  boolean primary key default true check (only_one),
  user_id   text not null,
  login     text not null,
  connected_at timestamptz not null default now()
);
create or replace function public.bot_save(p_user_id text, p_login text)
returns void language sql security definer set search_path to '' as $$
  insert into private.chat_bot (only_one, user_id, login) values (true, p_user_id, p_login)
  on conflict (only_one) do update set user_id = excluded.user_id, login = excluded.login, connected_at = now();
$$;
revoke all on function public.bot_save(text, text) from public, anon, authenticated;
grant execute on function public.bot_save(text, text) to service_role;
