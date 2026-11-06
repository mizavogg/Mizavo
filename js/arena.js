/* Mizavo — arena.js
   The arena: vote dots, bins, physics and all canvas drawing. */

/* ---------- CANVAS / PHYSICS ---------- */
const cv = $('#cv'), ctx = cv.getContext('2d');
const SH = 6; // hard shadow offset, like ink printed slightly off
let W=0, H=0, DPR=1, bins=[], pool=null;
let orbs=[], parts=[], labels=[];
const patterns = {};
function halftone(col){
  if(patterns[col]) return patterns[col];
  const c=document.createElement('canvas'); c.width=c.height=9;
  const g=c.getContext('2d'); g.fillStyle=hexA(col,.3); g.beginPath(); g.arc(4.5,4.5,1.6,0,Math.PI*2); g.fill();
  return patterns[col]=ctx.createPattern(c,'repeat');
}
function layout(){
  const w = $('#arena').clientWidth;
  const h = clamp(Math.round(window.innerHeight*0.46), 260, 460);
  DPR = Math.min(2, window.devicePixelRatio||1);
  W = w; H = h;
  cv.width = Math.round(w*DPR); cv.height = Math.round(h*DPR); cv.style.height = h+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const n = S.R ? S.R.opts.length : 2;
  const gap = window.innerWidth < 820 ? 14 : 24;
  const bw = (W - SH - gap*(n-1))/n, top = Math.round(H*0.38);
  bins = Array.from({length:n}, (_,i) => ({x:i*(bw+gap), y:top, w:bw, h:H-top-SH}));
  pool = {x:W*0.12, y:10, w:W*0.76, h:top-30};
}
window.addEventListener('resize', applyZone);

function binTarget(i){ const b=bins[i]; return {x:rnd(b.x+14, b.x+b.w-14), y:b.y+6}; }
function poolTarget(){ return {x:rnd(pool.x+20,pool.x+pool.w-20), y:rnd(pool.y+20,pool.y+pool.h-20)}; }
function flyTo(o, dest, delay=0){
  const to = dest==='pool' ? poolTarget() : binTarget(dest);
  o.state='fly'; o.dest=dest; o.from={x:o.x,y:o.y}; o.to=to;
  o.t0=performance.now()+delay; o.dur=rnd(450,700);
  o.ctrl={x:(o.x+to.x)/2 + rnd(-60,60), y:Math.min(o.y,to.y) - rnd(40,110)};
}
function spawnOrb(v){
  const o = {x:W/2+rnd(-30,30), y:-12, vx:0, vy:0, r:9, tr:9, color:v.color, key:v.key, state:'fly'};
  orbs.push(o); v.orb=o;
  return o;
}
function addLabel(text,color,x,y){ labels.push({text,color,x,y,t0:performance.now()}); if(labels.length>7) labels.shift(); }

function containerOf(o){ return o.state==='fly' ? null : o.state==='pool' ? 'pool' : o.bin; }
function step(){
  const now = performance.now();
  // flights
  for(const o of orbs){
    if(o.state!=='fly') continue;
    const t = (now-o.t0)/o.dur;
    if(t<0) continue;
    if(t>=1){
      o.x=o.to.x; o.y=o.to.y;
      if(o.dest==='pool'){ o.state='pool'; o.vx=rnd(-1,1); o.vy=rnd(-1,1); }
      else { o.state='bin'; o.bin=o.dest; o.vx=rnd(-1,1); o.vy=2; }
      continue;
    }
    const e = t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2, u=1-e;
    o.x = u*u*o.from.x + 2*u*e*o.ctrl.x + e*e*o.to.x;
    o.y = u*u*o.from.y + 2*u*e*o.ctrl.y + e*e*o.to.y;
  }
  // group
  const groups = new Map();
  for(const o of orbs){ const c=containerOf(o); if(c==null) continue; if(!groups.has(c)) groups.set(c,[]); groups.get(c).push(o); }
  for(const [c,list] of groups){
    const rect = c==='pool' ? pool : bins[c];
    if(!rect) continue;
    const area = rect.w*rect.h, tr = clamp(Math.sqrt(area*0.42/(Math.PI*Math.max(1,list.length))), 3.5, c==='pool'?12:20);
    const g = c==='pool' ? 0 : 0.35;
    for(const o of list){
      o.r += (tr-o.r)*0.08;
      if(c==='pool'){ o.vx += rnd(-.12,.12); o.vy += rnd(-.12,.12); const cx=rect.x+rect.w/2, cy=rect.y+rect.h/2; o.vx += (cx-o.x)*0.0006; o.vy += (cy-o.y)*0.0012; o.vx*=0.97; o.vy*=0.97; }
      else { o.vy += g; o.vx*=0.99; o.vy*=0.995; }
      o.x += o.vx; o.y += o.vy;
      if(o.x < rect.x+o.r+3){ o.x=rect.x+o.r+3; o.vx=Math.abs(o.vx)*0.4; }
      if(o.x > rect.x+rect.w-o.r-3){ o.x=rect.x+rect.w-o.r-3; o.vx=-Math.abs(o.vx)*0.4; }
      if(o.y > rect.y+rect.h-o.r-3){ o.y=rect.y+rect.h-o.r-3; o.vy=-Math.abs(o.vy)*0.25; o.vx*=0.92; }
      if(c==='pool' && o.y < rect.y+o.r){ o.y=rect.y+o.r; o.vy=Math.abs(o.vy)*0.5; }
    }
    for(let it=0; it<2; it++){
      for(let i=0;i<list.length;i++){ const a=list[i];
        for(let j=i+1;j<list.length;j++){ const b=list[j];
          const dx=b.x-a.x, dy=b.y-a.y, m=a.r+b.r, d2=dx*dx+dy*dy;
          if(d2>=m*m || d2===0) continue;
          const d=Math.sqrt(d2), nx=dx/d, ny=dy/d, ov=(m-d)/2;
          a.x-=nx*ov; a.y-=ny*ov; b.x+=nx*ov; b.y+=ny*ov;
          const vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
          if(vn<0){ const imp=vn*0.45; a.vx+=nx*imp; a.vy+=ny*imp; b.vx-=nx*imp; b.vy-=ny*imp; }
        }
      }
    }
  }
  // pops
  for(const o of orbs){
    if(o.popAt && now>=o.popAt && !o.dead){
      o.dead=true;
      for(let k=0;k<7;k++){ const a=rnd(0,Math.PI*2), s=rnd(1.5,4.5); parts.push({x:o.x,y:o.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1,life:1,color:o.color,r:rnd(1.5,3)}); }
    }
  }
  orbs = orbs.filter(o=>!o.dead);
  for(const p of parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life-=0.025; }
  parts = parts.filter(p=>p.life>0);
}

function draw(){
  ctx.clearRect(0,0,W,H);
  const R = S.R; if(!R) return;
  const now = performance.now();
  const showSplit = !S.blind || R.pick!=null || S.phase==='reveal';
  const counts = new Array(R.opts.length).fill(0); for(const v of R.votes.values()) counts[v.choice]++;
  const total = R.votes.size;
  const keys = R.type==='ff' ? ['1','2'] : ['A','B','C','D'];

  // hidden pool (blind mode)
  if(S.blind && R.pick==null && S.phase==='vote'){
    ctx.save();
    ctx.setLineDash([7,7]); ctx.strokeStyle=hexA(PAPER,.45); ctx.lineWidth=2; ctx.strokeRect(pool.x,pool.y,pool.w,pool.h);
    ctx.restore();
    if(total===0){ ctx.fillStyle='#a39a8a'; ctx.font=`700 14px ${MONO_FONT}`; ctx.textAlign='center'; ctx.fillText('waiting for chat…', pool.x+pool.w/2, pool.y+pool.h/2+5); }
    ctx.fillStyle=PAPER; ctx.font=`700 11px ${MONO_FONT}`; ctx.textAlign='left';
    ctx.fillText("CHAT'S VOTES · HIDDEN UNTIL YOU PICK", pool.x+12, pool.y+20);
  }
  // bins
  bins.forEach((b,i) => {
    const col = R.colors[i];
    const right = S.phase==='reveal' && i===R.answer, wrong = S.phase==='reveal' && i!==R.answer;
    ctx.save();
    ctx.globalAlpha = wrong ? .3 : 1;
    ctx.fillStyle = col; ctx.fillRect(b.x+SH, b.y+SH, b.w, b.h);       // offset shadow
    ctx.fillStyle = INK; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = halftone(col); ctx.fillRect(b.x, b.y, b.w, b.h);  // halftone dots
    const lw = right ? 5 : 3;
    ctx.lineWidth = lw; ctx.strokeStyle = right ? col : PAPER;
    ctx.strokeRect(b.x+lw/2, b.y+lw/2, b.w-lw, b.h-lw);
    // label tab
    const narrow = b.w < 170;
    ctx.font = `400 ${narrow?15:20}px ${DISPLAY_FONT}`;
    let tab = keys[i] + ' ' + R.opts[i];
    if(narrow || ctx.measureText(tab).width > b.w*0.55) tab = keys[i];
    const tw = ctx.measureText(tab).width + 20;
    ctx.fillStyle = col; ctx.fillRect(b.x, b.y, tw, narrow?26:32);
    ctx.fillStyle = INK; ctx.textAlign='left'; ctx.fillText(tab, b.x+10, b.y+(narrow?19:24));
    ctx.restore();
    if(showSplit && total){
      const pct = Math.round(counts[i]/total*100);
      ctx.save(); ctx.globalAlpha = wrong ? .35 : 1; ctx.fillStyle = col;
      if(narrow){
        ctx.font = `400 18px ${DISPLAY_FONT}`; ctx.textAlign='left';
        ctx.fillText(pct+'%', b.x+8, b.y+50);
      } else {
        const fs = clamp(b.w*0.14,22,52);
        ctx.font = `400 ${fs}px ${DISPLAY_FONT}`; ctx.textAlign='right';
        ctx.fillText(pct+'%', b.x+b.w-12, b.y+fs+6);
        ctx.font=`700 12px ${MONO_FONT}`; ctx.fillStyle=hexA(PAPER,.8);
        ctx.fillText(counts[i]+' vote'+(counts[i]===1?'':'s'), b.x+b.w-12, b.y+fs+24);
      }
      ctx.restore();
    }
    if(R.pick===i){
      ctx.save(); ctx.translate(b.x+b.w/2, b.y-6); ctx.rotate(-0.05);
      const label = b.w<140 ? 'PICK' : "STREAMER'S PICK", w = b.w<140 ? 56 : 136;
      ctx.fillStyle=YELLOW; ctx.fillRect(-w/2,-14,w,24);
      ctx.fillStyle=INK; ctx.font=`700 11px ${MONO_FONT}`; ctx.textAlign='center'; ctx.fillText(label, 0, 2);
      ctx.restore();
    }
  });
  // orbs: flat ink dots with a paper outline
  for(const o of orbs){
    if(o.state==='fly' && performance.now()<o.t0 && o.y<0) continue;
    ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,Math.PI*2);
    ctx.fillStyle = o.color; ctx.fill();
    ctx.lineWidth = Math.max(1.5, o.r*0.2); ctx.strokeStyle = PAPER; ctx.stroke();
  }
  for(const p of parts){ ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=p.color; ctx.fillRect(p.x-p.r,p.y-p.r,p.r*2,p.r*2); }
  ctx.globalAlpha=1;
  // name labels
  ctx.font=`700 12px ${MONO_FONT}`; ctx.textAlign='center';
  labels = labels.filter(l => now-l.t0 < 1500);
  for(const l of labels){ const k=(now-l.t0)/1500; ctx.globalAlpha=1-k; ctx.fillStyle=l.color; ctx.fillText(l.text, l.x, l.y-k*22); }
  ctx.globalAlpha=1;
}
function loop(){ step(); draw(); requestAnimationFrame(loop); }
