/* Mizavo — share a bit of text: the phone's share menu on touch screens, otherwise copy it. */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareText(text: string): Promise<ShareOutcome> {
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.share === 'function') {
    try { await navigator.share({ text }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; /* else fall back to copying */ }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; }
  catch { return 'failed'; }
}
