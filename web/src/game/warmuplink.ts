/* Mizavo — setup screen: the streamer's Starting Soon warm-up link (Nov 13, 2026).
   The link holds a secret code for this channel, so it works in OBS without logging in.
   "New link" replaces the code; the old link stops working straight away (use it if a link leaks). */
import { $ } from '../lib/dom';
import { rpc } from '../lib/supabase';
import { confirmBox } from './flow';

const url = (code: string) => `${location.origin}/warmup?k=${code}`;

async function copy(text: string, btn: HTMLButtonElement, done: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); btn.textContent = done; }
  catch { window.prompt('Copy your warm-up link:', text); return; }
  setTimeout(() => (btn.textContent = 'Copy link'), 2200);
}

export function initWarmupLink(): void {
  const c = $<HTMLButtonElement>('#warmCopy'), n = $<HTMLButtonElement>('#warmNew');
  c.onclick = async () => {
    c.disabled = true;
    try { const r = await rpc<{ code: string }>('my_warmup_link'); await copy(url(r.code), c, 'Copied! Paste it in OBS'); }
    catch (e) { c.textContent = 'Could not get the link'; console.warn(e); setTimeout(() => (c.textContent = 'Copy link'), 2500); }
    finally { c.disabled = false; }
  };
  n.onclick = async () => {
    if (!await confirmBox('Make a new warm-up link?', 'Your old link stops working right away, so you\'ll need to paste the new one into OBS.', 'New link')) return;
    n.disabled = true;
    try { const r = await rpc<{ code: string }>('my_warmup_link', { p_new: true }); await copy(url(r.code), c, 'New link copied!'); }
    catch (e) { console.warn(e); }
    finally { n.disabled = false; }
  };
}
