// Mizavo — send-reminders: daily challenge reminders by web push (Nov 14, 2026).
// pg_cron calls this every hour on the hour (migration 44) with the schedule's password in the x-cron-key header.
// It asks the database who is due (it's the 9 o'clock hour where they are, no reminder yet today, they haven't
// played today), sends each one "Today's challenge is live", then marks them sent. Push addresses the push service
// says are gone (the player turned notifications off or uninstalled) are deleted.
// The signing keys (VAPID) are made here the first time this runs and kept in Supabase Vault. Nothing secret is in code.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MESSAGE = {
  title: "Today's Mizavo challenge is live",
  body: 'Ten questions, the same for everyone. How far can your streak go?',
  url: '/solo',
};

Deno.serve(async (req) => {
  let { data: cfg, error } = await db.rpc('push_config');
  if (error) return json({ error: 'config' }, 500);
  cfg = cfg || {};
  if (!cfg.reminder_cron_key || req.headers.get('x-cron-key') !== cfg.reminder_cron_key) return json({ error: 'forbidden' }, 403);

  // First run: make the signing keys and keep them in Vault.
  if (!cfg.vapid_private) {
    const k = webpush.generateVAPIDKeys();
    const { error: e2 } = await db.rpc('push_store_keys', { p_public: k.publicKey, p_private: k.privateKey });
    if (e2) return json({ error: 'keys' }, 500);
    ({ data: cfg } = await db.rpc('push_config'));
  }
  webpush.setVapidDetails('mailto:mizavogg@gmail.com', cfg.vapid_public, cfg.vapid_private);

  const body = await req.json().catch(() => ({}));
  if (body?.setup) return json({ ok: true, setup: true });   // used once to create the keys

  // Test: send right now, but only to admins' devices (used to check reminders work end to end)
  const { data: due, error: e3 } = body?.test_admins ? await db.rpc('push_admin_test') : await db.rpc('push_due');
  if (e3) return json({ error: 'due' }, 500);
  const sent: string[] = [], gone: string[] = [];
  const payload = JSON.stringify(MESSAGE);
  const list = (due ?? []) as { endpoint: string; p256dh: string; auth: string }[];
  for (let i = 0; i < list.length; i += 50) {   // 50 at a time
    await Promise.all(list.slice(i, i + 50).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'normal' });
        sent.push(s.endpoint);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);   // unsubscribed or expired
      }
    }));
  }
  if (!body?.test_admins && (sent.length || gone.length)) await db.rpc('push_done', { p_sent: sent, p_gone: gone });
  return json({ due: list.length, sent: sent.length, gone: gone.length });
});
