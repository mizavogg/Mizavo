/* Mizavo — streamer mode: adjustable clear space on the right for a webcam and chat overlay.
   The space is a % of the window, so it looks the same in a browser tab and in an OBS browser source. */
import { $, clamp, show, store } from '../lib/dom';
import { S } from './state';
import { layout } from './arena';

const ZONE_MIN = 12, ZONE_MAX = 45, GAME_MIN_PX = 720;
const ZONE = { on: store.get('mz_stream') === '1', pct: clamp(+(store.get('mz_zone') || 25) || 25, ZONE_MIN, ZONE_MAX) };

const zoneMax = () => Math.min(ZONE_MAX, Math.floor((1 - GAME_MIN_PX / window.innerWidth) * 100));

function applyZone(): void {
  const max = zoneMax(), fits = max >= ZONE_MIN;
  const pct = clamp(ZONE.pct, ZONE_MIN, Math.max(ZONE_MIN, max));
  const r = $<HTMLInputElement>('#zoneRange'); r.max = String(Math.max(ZONE_MIN, max)); r.value = String(pct);
  $('#zoneVal').textContent = pct + '% · ' + Math.round(window.innerWidth * pct / 100) + 'px';
  document.documentElement.style.setProperty('--zone', pct + '%');
  document.body.classList.toggle('streaming', ZONE.on && fits);
  show($('#zoneCtl'), ZONE.on && fits);
  show($('#zoneNote'), ZONE.on && !fits);
  if (S.R && S.phase !== 'setup' && S.phase !== 'final') layout();
}
function setZonePct(p: number, save: boolean): void {
  ZONE.pct = clamp(Math.round(p), ZONE_MIN, Math.max(ZONE_MIN, zoneMax()));
  applyZone();
  if (save) store.set('mz_zone', String(ZONE.pct));
}

export function initStreamerMode(): void {
  const toggle = $<HTMLInputElement>('#streamer');
  toggle.checked = ZONE.on;
  toggle.onchange = () => { ZONE.on = toggle.checked; store.set('mz_stream', ZONE.on ? '1' : '0'); applyZone(); };
  $<HTMLInputElement>('#zoneRange').oninput = (e) => setZonePct(+(e.target as HTMLInputElement).value, true);

  const grip = $('#grip');
  grip.addEventListener('pointerdown', (e) => { e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('dragging'); });
  grip.addEventListener('pointermove', (e) => { if (grip.hasPointerCapture(e.pointerId)) setZonePct((1 - e.clientX / window.innerWidth) * 100, false); });
  const endDrag = (e: PointerEvent) => {
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
    document.body.classList.remove('dragging'); store.set('mz_zone', String(ZONE.pct));
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', applyZone);
  applyZone();
}
