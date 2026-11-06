/* Mizavo — chat.js
   Reading votes: parsing chat messages and the anonymous Twitch chat connection. */

/* ---------- CHAT INPUT ---------- */
function parseVote(text, type){
  const t=String(text).trim().toLowerCase().replace(/^!(?:vote|v)\s*/,'');
  if(type==='ff'){
    if(/^(1|fact|true|real|yes|t)$/.test(t)) return 0;
    if(/^(2|fake|false|cap|no)$/.test(t)) return 1;
    return null;
  }
  const m=t.match(/^([a-d1-4])$/); if(!m) return null;
  return /[a-d]/.test(m[1]) ? m[1].charCodeAt(0)-97 : +m[1]-1;
}
function onChat(name, color, text){
  if(S.phase!=='vote') return;
  const R=S.R, choice=parseVote(text, R.type);
  if(choice==null || choice>=R.opts.length) return;
  const key=name.toLowerCase(), col=color||colorFor(key);
  let v=R.votes.get(key);
  if(v && v.choice===choice) return;
  const hidden = S.blind && R.pick==null;
  if(!v){
    v={key,name,color:col,choice}; R.votes.set(key,v);
    const o=spawnOrb(v); flyTo(o, hidden ? 'pool' : choice);
    addLabel(name, col, o.to.x, hidden ? o.to.y-12 : bins[choice].y-6);
  }else{
    v.choice=choice;
    if(!hidden && v.orb){ flyTo(v.orb, choice); addLabel(name+' switched', col, v.orb.to.x, bins[choice].y-6); }
  }
}

/* ---------- TWITCH (anonymous read-only IRC) ---------- */
const TW={ws:null,ch:null,want:false,retry:0};
function setStatus(t,cls){ $('#status').className='pill '+(cls||''); $('#statusTxt').textContent=t; }
function connectTwitch(ch){ disconnectTwitch(); TW.ch=ch; TW.want=true; TW.retry=0; openWS(); }
function openWS(){
  setStatus('connecting #'+TW.ch+'…');
  let ws; try{ ws=new WebSocket('wss://irc-ws.chat.twitch.tv:443'); }catch(e){ return twFail(); }
  TW.ws=ws; let opened=false;
  ws.onopen=()=>{ opened=true; TW.retry=0; ws.send('CAP REQ :twitch.tv/tags'); ws.send('PASS SCHMOOPIIE'); ws.send('NICK justinfan'+Math.floor(10000+Math.random()*80000)); ws.send('JOIN #'+TW.ch); };
  ws.onmessage=ev=>{ for(const line of String(ev.data).split('\r\n')){ if(!line) continue;
      if(line.startsWith('PING')){ ws.send('PONG :tmi.twitch.tv'); continue; }
      if(line.includes(' JOIN #')){ setStatus('#'+TW.ch+(S.demo?' + demo':''),'on'); continue; }
      const m=parseIRC(line); if(m) onChat(m.user,m.color,m.text); } };
  ws.onclose=()=>{ if(TW.ws!==ws) return; if(!opened) return twFail();
    if(TW.want && TW.retry<6){ TW.retry++; setStatus('reconnecting…','err'); setTimeout(()=>TW.want&&openWS(),1000*TW.retry); } else if(TW.want) twFail(); };
}
function twFail(){ TW.want=false; setStatus(S.demo?"can't reach Twitch · demo on":"can't reach Twitch",'err'); }
function disconnectTwitch(){ TW.want=false; if(TW.ws){ const w=TW.ws; TW.ws=null; try{w.close()}catch(e){} } }
function parseIRC(line){
  const tags={};
  if(line[0]==='@'){ const sp=line.indexOf(' '); line.slice(1,sp).split(';').forEach(kv=>{const i=kv.indexOf('='); tags[kv.slice(0,i)]=kv.slice(i+1);}); line=line.slice(sp+1); }
  const m=line.match(/^:([^!\s]+)!\S+ PRIVMSG #\S+ :(.*)$/); if(!m) return null;
  return {user:tags['display-name']||m[1], color:tags.color||null, text:m[2]};
}
