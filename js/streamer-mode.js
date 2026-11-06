/* Mizavo — streamer-mode.js
   Streamer mode: the adjustable clear space on the right for a webcam and chat overlay. */

/* ---------- STREAMER MODE (overlay space) ---------- */
// The space is a % of the window so it looks the same in a browser tab and in an OBS browser source.
const ZONE_MIN = 12, ZONE_MAX = 45, GAME_MIN_PX = 720;
const ZONE = { on: store.get('mz_stream')==='1', pct: clamp(+(store.get('mz_zone')||25) || 25, ZONE_MIN, ZONE_MAX) };
function zoneMax(){ return Math.min(ZONE_MAX, Math.floor((1 - GAME_MIN_PX/window.innerWidth)*100)); }
function applyZone(){
  const max = zoneMax(), fits = max >= ZONE_MIN;
  const pct = clamp(ZONE.pct, ZONE_MIN, Math.max(ZONE_MIN, max));
  const r = $('#zoneRange'); r.max = Math.max(ZONE_MIN, max); r.value = pct;
  $('#zoneVal').textContent = pct + '% · ' + Math.round(window.innerWidth*pct/100) + 'px';
  document.documentElement.style.setProperty('--zone', pct + '%');
  document.body.classList.toggle('streaming', ZONE.on && fits);
  $('#zoneCtl').classList.toggle('hidden', !ZONE.on || !fits);
  $('#zoneNote').classList.toggle('hidden', !(ZONE.on && !fits));
  if(S.phase!=='setup' && S.phase!=='final' && S.R) layout();
}
function setZonePct(p, save){ ZONE.pct = clamp(Math.round(p), ZONE_MIN, Math.max(ZONE_MIN, zoneMax())); applyZone(); if(save) store.set('mz_zone', ZONE.pct); }
