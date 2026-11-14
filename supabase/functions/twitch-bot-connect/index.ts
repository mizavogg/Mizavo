// Mizavo — twitch-bot-connect: the one-time approval for the Mizavo chat bot (Nov 14, 2026).
// Open https://<project>.supabase.co/functions/v1/twitch-bot-connect while logged in to Twitch as mizavobot.
// It sends you to Twitch to approve two permissions for the bot account:
//   user:read:chat  (read chat)   and   user:bot  (be a chat bot)
// Twitch sends you back here; we check the approval really came from mizavobot with both permissions,
// save only its Twitch user id, and never store the token. After this, Mizavo reads chat with its own app token
// (no user token is ever stored), in channels whose streamer approved channel:bot at login.
// Needs Edge Function secrets TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (Supabase dashboard; never in code or chat).
import { createClient } from 'npm:@supabase/supabase-js@2';

const BOT_LOGIN = 'mizavobot';
const SCOPES = 'user:read:chat user:bot';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET') ?? '';
const SELF = Deno.env.get('SUPABASE_URL')! + '/functions/v1/twitch-bot-connect';

// Supabase shows function responses as plain text, so the result is a plain sentence.
const page = (title: string, text: string, ok = false) => new Response(
  (ok ? '✅ ' : '⚠️ ') + title + '\n\n' + text.replace(/<\/?b>/g, ''),
  { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

Deno.serve(async (req) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return page('Not set up yet', 'The Twitch keys are missing from the Edge Function secrets (TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET).');
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error')) return page('Not connected', 'Twitch said: ' + (url.searchParams.get('error_description') || 'the request was cancelled') + '.');
  if (!code) {   // step 1: off to Twitch
    const to = new URL('https://id.twitch.tv/oauth2/authorize');
    to.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: SELF, response_type: 'code', scope: SCOPES, force_verify: 'true' }).toString();
    return Response.redirect(to.toString(), 302);
  }
  // step 2: back from Twitch. Swap the code for a token only to check who approved and what.
  const t = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: SELF }) });
  if (!t.ok) return page('Not connected', 'Twitch did not accept the approval (' + t.status + '). Try again.');
  const tok = await t.json();
  const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + tok.access_token } });
  const info = v.ok ? await v.json() : null;
  // The token itself is never saved (it expires on its own in a few hours). We don't revoke it: on Twitch, revoking
  // can also undo the approval, and the approval is what lets Mizavo's app token read chat as the bot.
  if (!info || info.login !== BOT_LOGIN) return page('Wrong account', `This has to be approved while logged in to Twitch as <b>${BOT_LOGIN}</b>. You were logged in as <b>${info?.login ?? 'someone else'}</b>.`);
  const scopes: string[] = info.scopes || [];
  if (!scopes.includes('user:bot') || !scopes.includes('user:read:chat')) return page('Missing permissions', 'Both permissions are needed. Try again and approve both.');
  const { error } = await db.rpc('bot_save', { p_user_id: info.user_id, p_login: info.login });
  if (error) return page('Not saved', 'Approved, but saving failed. Try again.');
  return page('Mizavo bot connected', `${BOT_LOGIN} can now read chat in channels whose streamer allows it. You can close this page.`, true);
});
