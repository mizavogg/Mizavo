// Mizavo — twitch-chat: the server reads Twitch chat during games (Nov 14, 2026).
// Two kinds of callers:
//  1. Twitch (EventSub webhook): every chat message in a channel that's mid-game. We check Twitch's signature,
//     then hand the message to chat_record(), which keeps each viewer's first valid answer for the open round.
//  2. Mizavo (a logged-in streamer's game page):
//       start  { session }        ask Twitch to send this channel's chat (read as mizavobot) while the game runs
//       stop   { session }        stop it (game over)
//       check  { provider_token } right after Twitch login: did this streamer approve "Mizavo's bot in your chat"?
//     and pg_cron:  sweep          close any leftover subscriptions (needs the schedule's password)
// No user tokens are stored. Twitch is asked with Mizavo's own app token (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET secrets).
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPA, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET') ?? '';
const SELF = SUPA + '/functions/v1/twitch-chat';
const HELIX = 'https://api.twitch.tv/helix/eventsub/subscriptions';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- Mizavo's app token and settings (kept in memory for a while) ----------
let token = '', tokenUntil = 0;
async function appToken(): Promise<string> {
  if (token && Date.now() < tokenUntil) return token;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST', body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' }) });
  if (!r.ok) throw new Error('twitch_token_' + r.status);
  const t = await r.json();
  token = t.access_token; tokenUntil = Date.now() + (t.expires_in - 300) * 1000;
  return token;
}
let cfg: { bot_id?: string; eventsub_secret?: string; cron_key?: string } | null = null, cfgAt = 0;
async function config() {
  if (cfg && Date.now() - cfgAt < 5 * 60_000) return cfg;
  const { data, error } = await db.rpc('chat_config');
  if (error) throw new Error('config');
  cfg = data; cfgAt = Date.now();
  return cfg!;
}
const helix = async (method: string, url: string, body?: unknown) => fetch(url, {
  method, headers: { 'Client-Id': CLIENT_ID, Authorization: 'Bearer ' + await appToken(), 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined });

// ---------- 1. Twitch → Mizavo ----------
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a: string, b: string): boolean {   // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function fromTwitch(req: Request, type: string): Promise<Response> {
  const raw = await req.text();
  const id = req.headers.get('Twitch-Eventsub-Message-Id') ?? '';
  const ts = req.headers.get('Twitch-Eventsub-Message-Timestamp') ?? '';
  const sig = req.headers.get('Twitch-Eventsub-Message-Signature') ?? '';
  const { eventsub_secret } = await config();
  if (!eventsub_secret || !sameText(sig, 'sha256=' + await hmacHex(eventsub_secret, id + ts + raw))) return new Response('bad signature', { status: 403 });
  if (Math.abs(Date.now() - Date.parse(ts)) > 10 * 60_000) return new Response('too old', { status: 403 });   // replayed message
  const p = JSON.parse(raw);
  if (type === 'webhook_callback_verification') return new Response(p.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  if (type === 'notification' && p.subscription?.type === 'channel.chat.message') {
    const e = p.event, text = String(e?.message?.text ?? '').trim();
    if (text && text.length <= 12) {   // answers are short ("1", "fake", "!vote b"); skip everything else
      await db.rpc('chat_record', { p_broadcaster: e.broadcaster_user_id, p_viewer_id: e.chatter_user_id,
        p_login: e.chatter_user_login, p_name: e.chatter_user_name, p_text: text, p_sent: ts });
    }
  }
  return new Response(null, { status: 204 });   // notification or revocation: acknowledged
}

// ---------- 2. Mizavo → Twitch ----------
async function startChat(channelId: string, session: string): Promise<Response> {
  const { data: s } = await db.from('sessions').select('id,channel_id,status').eq('id', session).maybeSingle();
  if (!s || s.channel_id !== channelId || s.status !== 'active') return json({ verified: false, reason: 'no_game' }, 400);
  const c = await config();
  if (!c.bot_id || !c.eventsub_secret) return json({ verified: false, reason: 'no_bot' });
  const body = { type: 'channel.chat.message', version: '1',
    condition: { broadcaster_user_id: channelId, user_id: c.bot_id },
    transport: { method: 'webhook', callback: SELF, secret: c.eventsub_secret } };
  let r = await helix('POST', HELIX, body);
  if (r.status === 409) {   // a leftover subscription for this channel: remove it and try once more
    await removeChannelSubs(channelId);
    r = await helix('POST', HELIX, body);
  }
  if (r.status === 403) {   // the streamer hasn't approved channel:bot yet
    await db.rpc('chat_set_sub', { p_session: session, p_sub: null, p_ok: false });
    return json({ verified: false, reason: 'reconnect' });
  }
  if (r.status !== 202) return json({ verified: false, reason: 'twitch_' + r.status });
  const sub = (await r.json()).data?.[0]?.id as string;
  await db.rpc('chat_set_sub', { p_session: session, p_sub: sub, p_ok: true });
  // wait (up to ~5 s) for Twitch to confirm our address, so the first round's answers aren't missed
  for (let i = 0; i < 10; i++) {
    const g = await helix('GET', HELIX + '?id=' + encodeURIComponent(sub));
    const st = g.ok ? (await g.json()).data?.[0]?.status : null;
    if (st === 'enabled') return json({ verified: true });
    await new Promise((res) => setTimeout(res, 500));
  }
  return json({ verified: true, pending: true });
}
async function removeChannelSubs(channelId: string): Promise<void> {
  const r = await helix('GET', HELIX + '?type=channel.chat.message&user_id=' + encodeURIComponent((await config()).bot_id ?? ''));
  if (!r.ok) return;
  for (const s of (await r.json()).data ?? []) {
    if (s.condition?.broadcaster_user_id === channelId) await helix('DELETE', HELIX + '?id=' + encodeURIComponent(s.id));
  }
}
async function closeSub(session: string, sub: string | null): Promise<void> {
  if (sub) await helix('DELETE', HELIX + '?id=' + encodeURIComponent(sub)).catch(() => null);
  await db.rpc('chat_sub_closed', { p_session: session });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'not_set_up' }, 500);
  const twitchType = req.headers.get('Twitch-Eventsub-Message-Type');
  if (twitchType) return fromTwitch(req, twitchType);

  const body = await req.json().catch(() => ({}));
  if (body.action === 'sweep') {   // pg_cron: close subscriptions of games that are over
    if (req.headers.get('x-cron-key') !== (await config()).cron_key) return json({ error: 'forbidden' }, 403);
    const { data } = await db.rpc('chat_subs_to_close');
    for (const row of data ?? []) await closeSub(row.session_id, row.sub);
    return json({ closed: (data ?? []).length });
  }

  // everything else: a logged-in streamer
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'not_logged_in' }, 401);
  const { data: ch } = await db.from('channels').select('id').eq('owner_user_id', u.user.id).maybeSingle();
  if (!ch) return json({ error: 'no_channel' }, 400);

  if (body.action === 'start') return startChat(ch.id, String(body.session ?? ''));
  if (body.action === 'stop') {
    const { data: s } = await db.from('sessions').select('id,channel_id,chat_sub').eq('id', String(body.session ?? '')).maybeSingle();
    if (s && s.channel_id === ch.id) await closeSub(s.id, s.chat_sub);
    return json({ ok: true });
  }
  if (body.action === 'check') {   // just logged in: what did this streamer approve?
    const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + String(body.provider_token ?? '') } });
    const info = v.ok ? await v.json() : null;
    const ok = !!info && info.user_id === ch.id && (info.scopes ?? []).includes('channel:bot');
    if (info && info.user_id === ch.id) await db.rpc('chat_set_channel_ok', { p_channel: ch.id, p_ok: ok });
    return json({ chat_ok: ok });
  }
  return json({ error: 'unknown_action' }, 400);
});
