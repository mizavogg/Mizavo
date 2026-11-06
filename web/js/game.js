/* Mizavo — game.js
   Game flow: start, rounds, timer, picking, reveal, final results. */

/* ---------- GAME FLOW ---------- */
function buildList(){
  const ff = shuffle(FF).map(q => ({type:'ff', q}));
  const oo = shuffle(OOO).map(q => ({type:'ooo', q}));
  if(S.mode==='ff') return ff.slice(0,S.rounds);
  if(S.mode==='ooo') return oo.slice(0,S.rounds);
  const out=[]; let i=0,j=0;
  while(out.length<S.rounds){ out.push((Math.random()<0.6 && i<ff.length) || j>=oo.length ? ff[i++] : oo[j++]); }
  return out;
}
function startGame(){
  S.rounds=+$('#rounds').value; S.secs=+$('#secs').value; S.blind=$('#blind').checked; S.demo=$('#demo').checked;
  const ch=$('#channel').value.trim().replace(/^#/,'').toLowerCase(); store.set('hm_channel',ch);
  if(ch) connectTwitch(ch); else { disconnectTwitch(); setStatus(S.demo?'demo chat':'chat off', S.demo?'on':''); }
  S.list=buildList(); S.idx=0; S.me=0; S.chat=0; S.viewers.clear(); S.history=[];
  BOTS = makeBots();
  $('#scoreboard').classList.remove('hidden'); updateScore();
  startRound();
}
function show(id){ ['setup','game','final'].forEach(s=>$('#'+s).classList.toggle('hidden',s!==id)); document.body.dataset.phase=id; }
function updateScore(){ $('#sMe').textContent=S.me; $('#sCh').textContent=S.chat; }

function startRound(){
  const item = S.list[S.idx];
  let opts, answer, colors;
  if(item.type==='ff'){ opts=['FACT','FAKE']; answer=item.q.a?0:1; colors=OPT_COLORS.ff; }
  else { const order=shuffle([0,1,2,3]); opts=order.map(k=>item.q.o[k]); answer=order.indexOf(item.q.a); colors=OPT_COLORS.ooo; }
  S.R = {item, type:item.type, opts, answer, colors, votes:new Map(), pick:null, t0:Date.now()};
  orbs=[]; parts=[]; labels=[];
  show('game'); S.phase='vote'; layout();
  const modeName = item.type==='ff' ? 'Fact or Fake' : 'Odd One Out';
  $('#edition').textContent = `No. ${pad2(S.idx+1)} of ${pad2(S.rounds)} — ${modeName}`;
  $('#gMode').textContent = modeName;
  $('#gRound').textContent = `Round ${S.idx+1} / ${S.rounds}`;
  $('#prompt').textContent = item.type==='ff' ? 'TRUE OR NOT?' : 'ODD ONE OUT';
  $('#statement').textContent = item.type==='ff' ? item.q.t : 'Which one doesn\'t belong?';
  const keys = item.type==='ff' ? ['1','2'] : ['A','B','C','D'];
  const box=$('#opts'); box.innerHTML=''; box.className='opts'; box.style.gridTemplateColumns=`repeat(${opts.length},1fr)`;
  opts.forEach((o,i)=>{ const b=document.createElement('button'); b.className='opt'; b.style.setProperty('--c', colors[i]);
    b.innerHTML=`<span class="key">${keys[i]}</span>`; b.append(document.createTextNode(o)); b.onclick=()=>pick(i); box.appendChild(b); });
  $('#hint').innerHTML = item.type==='ff' ? 'CHAT: TYPE <code>1</code> FOR FACT OR <code>2</code> FOR FAKE' : 'CHAT: TYPE <code>A</code> <code>B</code> <code>C</code> OR <code>D</code>';
  $('#below').classList.remove('hidden'); $('#explain').classList.add('hidden');
  $('#banner').className='banner'; $('#callout').className='callout';
  S.deadline = Date.now()+S.secs*1000;
  clearInterval(S.timer); S.timer=setInterval(tick,100); tick();
  scheduleBots();
}
function tick(){
  const left=Math.max(0,S.deadline-Date.now());
  $('#timerBar').style.transform=`scaleX(${left/(S.secs*1000)})`;
  $('#tnum').textContent=Math.ceil(left/1000);
  const low=left<4000; $('#stamp').classList.toggle('low',low); $('#timer').classList.toggle('low',low);
  // live callout
  const R=S.R, n=R.votes.size;
  if((!S.blind || R.pick!=null) && n>=10){
    const counts=new Array(R.opts.length).fill(0); for(const v of R.votes.values()) counts[v.choice]++;
    const top=Math.max(...counts)/n, sorted=[...counts].sort((a,b)=>b-a);
    let msg='';
    if(top>=0.85) msg=`Chat is ${Math.round(top*100)}% sure`;
    else if((sorted[0]-sorted[1])/n <= 0.06) msg='Chat is split down the middle';
    const c=$('#callout'); c.textContent=msg; c.classList.toggle('show',!!msg);
  }
  if(left<=0) endVoting();
}

function pick(i){
  const R=S.R; if(S.phase!=='vote' || R.pick!=null) return;
  R.pick=i;
  const btns=[...$('#opts').children]; btns[i].classList.add('picked'); $('#opts').classList.add('locked');
  if(S.blind) sortPool();
  $('#hint').innerHTML = `LOCKED IN <b>${R.opts[i]}</b> — CHAT STILL HAS TIME…`;
}
function sortPool(){
  let d=0;
  for(const v of S.R.votes.values()){ if(v.orb && (v.orb.state==='pool' || v.orb.dest==='pool')){ flyTo(v.orb, v.choice, d); d+=Math.min(18, 700/Math.max(1,S.R.votes.size)); } }
}
function endVoting(){
  if(S.phase!=='vote') return;
  clearInterval(S.timer); clearBots();
  S.phase='sorting';
  const needSort = S.blind && S.R.pick==null;
  if(needSort) sortPool();
  setTimeout(reveal, needSort ? 1300 : 250);
}
function reveal(){
  const R=S.R; S.phase='reveal';
  $('#callout').classList.remove('show');
  const counts=new Array(R.opts.length).fill(0); for(const v of R.votes.values()) counts[v.choice]++;
  const n=R.votes.size, max=Math.max(0,...counts), leaders=counts.map((c,i)=>c===max?i:-1).filter(i=>i>=0);
  const chatPick = n && leaders.length===1 ? leaders[0] : null;
  const meRight = R.pick===R.answer, chatRight = chatPick===R.answer;
  if(meRight) S.me++; if(chatRight) S.chat++; updateScore();
  const pctRight = n ? Math.round(counts[R.answer]/n*100) : 0;

  // viewers
  for(const v of R.votes.values()){
    const rec=S.viewers.get(v.key)||{name:v.name,color:v.color,pts:0,streak:0,best:0};
    if(v.choice===R.answer){ rec.streak++; rec.pts += 100 + Math.min(5,rec.streak-1)*20; rec.best=Math.max(rec.best,rec.streak); } else rec.streak=0;
    rec.color=v.color; S.viewers.set(v.key,rec);
  }
  S.history.push({R, meRight, chatRight, pctRight, n});

  // visuals
  const now=performance.now();
  for(const v of R.votes.values()){
    const o=v.orb; if(!o) continue;
    if(v.choice!==R.answer) o.popAt = now + 350 + Math.random()*900;
    else { o.vy = -rnd(4,10); o.vx += rnd(-2,2); }
  }
  setTimeout(()=>{ for(const v of R.votes.values()) if(v.orb && v.choice===R.answer && !v.orb.dead){ v.orb.vy=-rnd(3,8); } }, 900);
  [...$('#opts').children].forEach((b,i)=>{ b.classList.add(i===R.answer?'right':'wrong'); });

  let head, color;
  if(meRight && chatRight){ head='Both nailed it'; color='var(--mint)'; }
  else if(meRight){ head='Streamer wins it'; color='var(--yellow)'; }
  else if(chatRight){ head='Chat carried'; color='var(--blue)'; }
  else { head= R.pick==null && !n ? 'Nobody answered' : 'Everyone got fooled'; color='var(--pink)'; }
  const sub = n ? (pctRight>=90 ? `Hivemind — ${pctRight}% of chat was right` : pctRight<=25 ? `Bamboozled — only ${pctRight}% of chat was right` : `${pctRight}% of chat was right`) : 'no chat votes';
  const bn=$('#banner'); bn.innerHTML=''; bn.style.background=color; bn.append(document.createTextNode(head)); const sm=document.createElement('small'); sm.textContent=sub; bn.append(sm);
  setTimeout(()=>bn.classList.add('show'), 200);

  const ansTxt = R.type==='ff' ? (R.answer===0 ? 'FACT.' : 'FAKE.') : `${R.opts[R.answer]}.`;
  const ex=$('#exText'); ex.innerHTML='';
  const b=document.createElement('b'); b.textContent=ansTxt; b.style.background = R.colors[R.answer];
  ex.append(b, document.createTextNode(' '+R.item.q.e));
  let top=null; for(const r of S.viewers.values()) if(!top || r.streak>top.streak) top=r;
  const meta=document.createElement('span'); meta.className='meta';
  meta.textContent = (top && top.streak>=3) ? `${top.name} is on a ${top.streak}-round streak` : `Streamer picked: ${R.pick==null?'nothing':R.opts[R.pick]}`;
  ex.append(meta);
  $('#nextBtn').innerHTML = (S.idx+1>=S.rounds ? 'Final results' : 'Next') + ' <kbd>Enter</kbd>';
  $('#below').classList.add('hidden'); $('#explain').classList.remove('hidden');
}
function next(){ S.idx++; if(S.idx>=S.rounds) finish(); else startRound(); }

function finish(){
  S.phase='final'; clearBots();
  $('#edition').textContent = 'Final edition';
  const win=S.me>S.chat?'me':S.chat>S.me?'ch':'tie';
  $('#fTitle').textContent = win==='me' ? 'The streamer outsmarted chat.' : win==='ch' ? 'Chat wins. Hivemind confirmed.' : 'Dead even. Rematch?';
  $('#fTitle').style.color = win==='me' ? 'var(--yellow)' : win==='ch' ? 'var(--blue)' : '';
  $('#fMe').textContent=S.me+' / '+S.rounds; $('#fCh').textContent=S.chat+' / '+S.rounds;
  const top=[...S.viewers.values()].sort((a,b)=>b.pts-a.pts).slice(0,5);
  $('#fN').textContent=`${S.viewers.size} player${S.viewers.size===1?'':'s'}`;
  const ul=$('#mvp'); ul.innerHTML='';
  if(!top.length){ const li=document.createElement('li'); li.innerHTML='<span class="r">—</span><span style="color:var(--muted)">No chat votes this game</span><span></span>'; ul.append(li); }
  top.forEach((v,i)=>{ const li=document.createElement('li');
    const r=document.createElement('span'); r.className='r'; r.textContent='#'+(i+1);
    const n=document.createElement('span'); n.textContent=v.name; n.style.color=v.color; n.style.fontWeight='700';
    const s=document.createElement('span'); s.className='s'; s.textContent=v.pts.toLocaleString('en-US')+(v.best>=3?` · ${v.best} streak`:'');
    li.append(r,n,s); ul.append(li); });
  $('#copyBox').classList.add('hidden');
  show('final');
}
function summary(){
  const lines=[`MIZAVO — Streamer ${S.me} vs Chat ${S.chat} (${S.rounds} rounds)`];
  S.history.forEach((h,i)=>{ const q=h.R.type==='ff'?h.R.item.q.t:h.R.opts.join(' / '); lines.push(`${i+1}. ${q} → ${h.R.opts[h.R.answer]} | streamer ${h.meRight?'✓':'✗'} | chat ${h.pctRight}% right`); });
  const top=[...S.viewers.values()].sort((a,b)=>b.pts-a.pts)[0]; if(top) lines.push(`Chat MVP: ${top.name} (${top.pts})`);
  return lines.join('\n');
}
