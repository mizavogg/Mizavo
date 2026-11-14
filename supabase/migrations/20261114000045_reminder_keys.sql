-- Mizavo migration 45 (Nov 14, 2026): reminder keys.
-- The schedule's password: made inside the database, stored only in Vault.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'reminder_cron_key', 'Mizavo: lets pg_cron call send-reminders');

-- The push signing keys are made by the send-reminders function the first time it runs and stored here (service role only).
create or replace function public.push_store_keys(p_public text, p_private text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from vault.secrets where name = 'vapid_private') then return; end if;   -- never replace existing keys
  perform vault.create_secret(p_public, 'vapid_public', 'Mizavo web push public key');
  perform vault.create_secret(p_private, 'vapid_private', 'Mizavo web push private key');
end $$;
revoke all on function public.push_store_keys(text, text) from public, anon, authenticated;
grant execute on function public.push_store_keys(text, text) to service_role;

-- The public key is public by design: browsers need it to sign up for reminders.
create or replace function public.push_public_key()
returns text language sql stable security definer set search_path to '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public';
$$;
grant execute on function public.push_public_key() to anon, authenticated;
