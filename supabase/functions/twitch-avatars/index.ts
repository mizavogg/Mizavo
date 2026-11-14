// Mizavo — twitch-avatars: looks up chatters' Twitch profile pictures for picture balls.
// Called with up to 100 Twitch logins at a time by either:
//   * a logged-in streamer's game page, or
//   * a Starting Soon warm-up panel in OBS (not logged in), which sends its channel's secret warm-up code instead (Nov 13).
// Answers from the twitch_avatars cache when it can (refreshed weekly); asks Twitch for the rest.
// Needs two Edge Function secrets set in the Supabase dashboard (never in code or chat):
//   TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (from the Mizavo app in the Twitch Developer Console).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET') ?? '';
const WEEK = 7 * 24 * 3600 * 1000;

// Twitch app token (no user involved), kept in memory until it's about to expire
let token = '', tokenUntil = 0;
async function appToken(): Promise<string> {
  if (token && Date.now() < tokenUntil) return token;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!r.ok) throw new Error('twitch_token_' + r.status);
  const t = await r.json();
  token = t.access_token; tokenUntil = Date.now() + (t.expires_in - 300) * 1000;
  return token;
}

/** Small picture (70×70) for a custom picture; null for Twitch's default pictures. */
function small(url: string | undefined): string | null {
  if (!url || url.includes('user-default-pictures')) return null;
  return url.replace(/-\d+x\d+\.(png|jpe?g|gif|webp)$/i, '-70x70.$1');
}

/** Who may use this: a logged-in Mizavo user, or a warm-up panel with a valid warm-up code. */
async function allowed(req: Request, body: { warmup?: unknown }): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (jwt) { const { data: who } = await db.auth.getUser(jwt); if (who?.user) return true; }
  const code = typeof body.warmup === 'string' ? body.warmup.toLowerCase() : '';
  if (!/^[a-f0-9]{24}$/.test(code)) return false;
  const { data } = await db.from('warmup_links').select('channel_id').eq('code', code).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let body: { logins?: unknown; warmup?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!(await allowed(req, body))) return json({ error: 'not_logged_in' }, 401);

  let logins: string[] = Array.isArray(body.logins) ? body.logins : [];
  logins = [...new Set(logins.map((l) => String(l).toLowerCase()).filter((l) => /^[a-z0-9_]{1,25}$/.test(l)))].slice(0, 100);
  if (!logins.length) return json({ pictures: {} });

  const pictures: Record<string, string | null> = {};
  const { data: cached } = await db.from('twitch_avatars').select('login,url,fetched_at').in('login', logins);
  for (const c of cached ?? []) if (Date.now() - Date.parse(c.fetched_at) < WEEK) pictures[c.login] = c.url;
  const missing = logins.filter((l) => !(l in pictures));
  if (!missing.length) return json({ pictures });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ pictures, setup: 'missing_twitch_secrets' });

  try {
    const q = missing.map((l) => 'login=' + encodeURIComponent(l)).join('&');
    let r = await fetch('https://api.twitch.tv/helix/users?' + q, { headers: { 'Client-Id': CLIENT_ID, Authorization: 'Bearer ' + await appToken() } });
    if (r.status === 401) { token = ''; r = await fetch('https://api.twitch.tv/helix/users?' + q, { headers: { 'Client-Id': CLIENT_ID, Authorization: 'Bearer ' + await appToken() } }); }
    if (!r.ok) return json({ pictures, error: 'twitch_' + r.status });
    const found = new Map<string, { id: string; url: string | null }>();
    for (const u of (await r.json()).data ?? []) found.set(String(u.login).toLowerCase(), { id: u.id, url: small(u.profile_image_url) });
    const rows = missing.map((l) => ({ login: l, user_id: found.get(l)?.id ?? null, url: found.get(l)?.url ?? null, fetched_at: new Date().toISOString() }));
    await db.from('twitch_avatars').upsert(rows);
    for (const row of rows) pictures[row.login] = row.url;
    return json({ pictures });
  } catch (e) {
    return json({ pictures, error: String((e as Error).message) });
  }
});
