/* Mizavo — helpers.js
   Small shared helpers, colors and the game state object. */

/* ---------- HELPERS ---------- */
const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rnd = (a,b) => a + Math.random()*(b-a);
const pad2 = n => String(n).padStart(2,'0');
const store = { get(k){ try{return localStorage.getItem(k)}catch(e){return null} }, set(k,v){ try{localStorage.setItem(k,v)}catch(e){} } };
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
const PALETTE = ['#3d9be0','#ff48b0','#ffe14d','#f1ebdd','#5fd39a','#ff8c3b','#7cc4ec','#ffa3d6','#c9a6ff','#b8e86a'];
function colorFor(k){ let h=0; for(const c of k) h=(h*31+c.charCodeAt(0))>>>0; return PALETTE[h%PALETTE.length]; }
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }

const INK='#161616', PAPER='#f1ebdd', YELLOW='#ffe14d';
const OPT_COLORS = { ff:['#3d9be0','#ff48b0'], ooo:['#3d9be0','#ff48b0','#5fd39a','#ff8c3b'] };
const DISPLAY_FONT = '"Archivo Black", Impact, sans-serif';
const MONO_FONT = '"IBM Plex Mono", ui-monospace, monospace';

/* ---------- STATE ---------- */
const S = {
  phase:'setup', mode:'ff', rounds:10, secs:15, blind:true, demo:true,
  list:[], idx:0, R:null, me:0, chat:0, viewers:new Map(), history:[], timer:null
};
