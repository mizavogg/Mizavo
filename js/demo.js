/* Mizavo — demo.js
   Simulated chat: fake viewers for testing without a live stream. */

/* ---------- DEMO VIEWERS ---------- */
const ADJ=['pixel','turbo','sleepy','cosmic','lowkey','salty','spicy','frosty','chaotic','silent','mega','lucky','sneaky','fuzzy','hyper','retro','neon','tiny','grumpy','golden'];
const NOUN=['panda','llama','goblin','wizard','taco','owl','gecko','ninja','waffle','otter','koala','yeti','muffin','comet','badger','noodle','raven','pickle','falcon','mochi'];
let BOTS=[], botTimers=[];
function makeBots(){ const out=new Set(); while(out.size<110){ const n=ADJ[Math.floor(Math.random()*ADJ.length)]+(Math.random()<.5?'_':'')+NOUN[Math.floor(Math.random()*NOUN.length)]+(Math.random()<.4?Math.floor(Math.random()*99):''); out.add(n); } return [...out].map(n=>({name:n,color:colorFor(n),smart:rnd(-.15,.15)})); }
function clearBots(){ botTimers.forEach(clearTimeout); botTimers=[]; }
function scheduleBots(){
  clearBots(); if(!S.demo) return;
  const R=S.R, ms=S.secs*1000, n=35+Math.floor(Math.random()*60);
  const ease = rnd(0.3,0.92); // how many bots get it right this round
  const nOpts=R.opts.length;
  shuffle(BOTS).slice(0,n).forEach(b=>{
    const choose=()=>{ if(Math.random()<clamp(ease+b.smart,0.05,0.97)) return R.answer; let c; do{ c=Math.floor(Math.random()*nOpts); }while(c===R.answer); return c; };
    const keys = R.type==='ff' ? ['1','2'] : ['a','b','c','d'];
    const alt = R.type==='ff' ? ['fact','fake'] : ['A','B','C','D'];
    const send=()=>{ const c=choose(); onChat(b.name,b.color, Math.random()<.3 ? alt[c] : keys[c]); };
    botTimers.push(setTimeout(send, ms*Math.pow(Math.random(),1.4)*0.9 + 200));
    if(Math.random()<0.1) botTimers.push(setTimeout(send, ms*rnd(0.6,0.95)));
  });
}
