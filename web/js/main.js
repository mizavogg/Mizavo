/* Mizavo — main.js
   Wiring: connects buttons, keys and settings to the game, then starts the draw loop. */

/* ---------- WIRING ---------- */
$('#channel').value=store.get('hm_channel')||'';
document.querySelectorAll('.mode').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.mode').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); S.mode=b.dataset.mode; });
$('#startBtn').onclick=startGame;
$('#revealBtn').onclick=()=>{ if(S.phase==='vote'){ S.deadline=Date.now(); tick(); } };
$('#nextBtn').onclick=next;
$('#againBtn').onclick=startGame;
$('#homeBtn').onclick=()=>{ $('#scoreboard').classList.add('hidden'); S.phase='setup'; $('#edition').textContent='Night edition · streamer vs chat'; show('setup'); };
$('#copyBtn').onclick=async()=>{ const t=summary();
  try{ await navigator.clipboard.writeText(t); $('#copyBtn').textContent='Copied!'; setTimeout(()=>$('#copyBtn').textContent='Copy results',1500); }
  catch(e){ const box=$('#copyBox'); box.value=t; box.classList.remove('hidden'); box.select(); } };
cv.addEventListener('click', e=>{
  if(S.phase!=='vote') return;
  const r=cv.getBoundingClientRect(), x=e.clientX-r.left;
  const i=bins.findIndex(b=>x>=b.x && x<=b.x+b.w); if(i>=0) pick(i);
});
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT' && S.phase==='setup' && e.key!=='Enter') return;
  const k=e.key.toLowerCase();
  if(S.phase==='setup' && k==='enter'){ e.preventDefault(); startGame(); return; }
  if(S.phase==='vote'){
    const R=S.R;
    if(R.type==='ff'){ if(k==='1'||k==='arrowleft') pick(0); else if(k==='2'||k==='arrowright') pick(1); }
    else { const m='abcd'.indexOf(k); if(m>=0) pick(m); else if('1234'.includes(k)&&k.length===1) pick(+k-1); }
    if(k==='enter' && R.pick!=null){ e.preventDefault(); S.deadline=Date.now(); tick(); }
    return;
  }
  if(S.phase==='reveal' && k==='enter'){ e.preventDefault(); next(); return; }
  if(S.phase==='final' && k==='enter'){ e.preventDefault(); startGame(); }
});

// streamer mode controls
$('#streamer').checked = ZONE.on;
$('#streamer').onchange = e => { ZONE.on = e.target.checked; store.set('mz_stream', ZONE.on?'1':'0'); applyZone(); };
$('#zoneRange').oninput = e => setZonePct(+e.target.value, true);
const grip = $('#grip');
grip.addEventListener('pointerdown', e => { e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('dragging'); });
grip.addEventListener('pointermove', e => { if(!grip.hasPointerCapture(e.pointerId)) return; setZonePct((1 - e.clientX/window.innerWidth)*100, false); });
const endDrag = e => { if(grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); document.body.classList.remove('dragging'); store.set('mz_zone', ZONE.pct); };
grip.addEventListener('pointerup', endDrag);
grip.addEventListener('pointercancel', endDrag);
applyZone();

requestAnimationFrame(loop);
