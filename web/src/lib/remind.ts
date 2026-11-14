/* Mizavo — daily challenge reminders (Nov 14, 2026).
   The box under the daily challenge card: "Remind me each morning". Tapping it asks the browser for permission,
   signs this browser up with its push service, and saves the push address + time zone (save_push). The server sends
   one reminder at 9 am the player's time when a new challenge is live (send-reminders Edge Function).
   iPhone: notifications only work from the home-screen app, so in Safari we point to "Get the app" first. */
import { el, show } from './dom';
import { rpc } from './supabase';
import { openInstall, isIOS, isStandalone } from './install';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function render(box: HTMLElement, text: string, button?: HTMLButtonElement): void {
  box.replaceChildren(el('span', null, text), ...(button ? [button] : []));
  show(box, true);
}
const button = (label: string, cls: string, fn: () => void) => {
  const b = el('button', 'btn ' + cls + ' small', label) as HTMLButtonElement; b.type = 'button'; b.onclick = fn; return b;
};

export async function initRemind(): Promise<void> {
  const box = document.getElementById('remind');
  if (!box) return;
  // iPhone/iPad in the browser: reminders need the home-screen app first
  if (isIOS() && !isStandalone()) {
    render(box, '🔔 Want a reminder each morning? Add Mizavo to your Home Screen first.', button('Get the app', 'ghost', openInstall));
    return;
  }
  if (!supported()) return;   // the box stays hidden
  if (Notification.permission === 'denied') {
    render(box, '🔔 Reminders are blocked. Allow notifications for mizavo.gg in your settings to turn them on.');
    return;
  }
  const sub = await currentSub().catch(() => null);
  if (sub) return showOn(box, sub);
  showOff(box);
}

function showOff(box: HTMLElement): void {
  const b = button('Remind me', 'primary', async () => {
    b.disabled = true; b.textContent = 'Turning on…';
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { initRemind(); return; }
      const key = await rpc<string | null>('push_public_key');
      if (!key) throw new Error('no key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await save(sub);
      showOn(box, sub);
    } catch {
      b.disabled = false; b.textContent = 'Try again';
    }
  });
  render(box, '🔔 Get a reminder at 9 am (your time) when the new challenge is live.', b);
}

function showOn(box: HTMLElement, sub: PushSubscription): void {
  save(sub).catch(() => {});   // keep the time zone and login up to date
  const b = button('Turn off', 'ghost', async () => {
    b.disabled = true;
    try { await rpc('remove_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); } catch { /* gone already */ }
    showOff(box);
  });
  render(box, '🔔 Reminders on: 9 am your time, when a new challenge is live.', b);
}

async function save(sub: PushSubscription): Promise<void> {
  const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  await rpc('save_push', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '',
    p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  });
}
