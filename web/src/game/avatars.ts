/* Mizavo — picture balls: a chatter's Twitch profile picture fills their ball.
   Pictures come from the twitch-avatars server function (it asks Twitch, and caches for a week).
   Logins are collected as votes arrive and looked up in small batches. Until a picture loads, or if the
   viewer has Twitch's default picture, the ball stays a plain colored ball. Streamers can switch this off. */
import { store } from '../lib/dom';
import { supabase } from '../lib/supabase';

const KEY = 'mz_pics';
let on = store.get(KEY) !== '0';                 // on by default
const pics = new Map<string, HTMLImageElement | null>();   // login -> loaded picture (null: none)
const queue = new Set<string>();
let timer = 0, broken = false;
let warmupKey: string | null = null;   // the Starting Soon panel isn't logged in: it shows its warm-up code instead

/** Warm-up panel only: let the picture service know this page is a real channel's warm-up. */
export function setPictureKey(code: string | null): void { warmupKey = code; }

export const picturesOn = () => on;
export function setPictures(v: boolean): void { on = v; store.set(KEY, v ? '1' : '0'); }

/** The picture for this login if it's loaded (else null). Asks for it the first time. */
export function pictureFor(login: string): HTMLImageElement | null {
  if (!on) return null;
  const l = login.toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(l)) return null;     // simulated viewers, odd names
  if (pics.has(l)) { const img = pics.get(l); return img && img.complete && img.naturalWidth ? img : null; }
  if (!broken && !queue.has(l)) { queue.add(l); if (!timer) timer = window.setTimeout(flush, 350); }
  return null;
}

async function flush(): Promise<void> {
  timer = 0;
  const batch = [...queue].slice(0, 100);
  batch.forEach((l) => { queue.delete(l); pics.set(l, null); });   // asked once per page load
  if (queue.size) timer = window.setTimeout(flush, 350);
  try {
    const { data, error } = await supabase.functions.invoke('twitch-avatars', { body: warmupKey ? { logins: batch, warmup: warmupKey } : { logins: batch } });
    if (error) { if (/401|not_logged_in/.test(String(error.message))) broken = true; return; }
    const got = (data?.pictures || {}) as Record<string, string | null>;
    for (const [login, url] of Object.entries(got)) {
      if (!url || !/^https:\/\/static-cdn\.jtvnw\.net\//.test(url)) continue;   // only Twitch's own image server
      const img = new Image(); img.decoding = 'async'; img.src = url;
      pics.set(login, img);
    }
  } catch { /* no pictures this time: plain balls */ }
}
