/* Mizavo — sound effects. Every sound is made in code with the browser's Web Audio API
   (no sound files to download or license). Style: soft marbles — wooden clacks, glassy taps, warm chimes.

   Fairness rule: sounds go out on stream, so no sound may give away a secret. The streamer's pick
   sounds the same whichever answer it is, and a landing ball sounds the same whichever bin it lands in.

   Browsers only allow sound after the visitor clicks or presses a key, so the audio starts on the
   first click/key. Volume and mute are remembered in this browser. */
import { el, store } from './dom';

const VOL_KEY = 'mz_vol', MUTE_KEY = 'mz_mute';
let vol = Math.min(1, Math.max(0, +(store.get(VOL_KEY) ?? '0.5') || 0));
if (store.get(VOL_KEY) == null) vol = 0.5;                 // medium by default
let muted = store.get(MUTE_KEY) === '1';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function level(): number { return muted ? 0 : vol * vol; }   // squared: the slider feels even to the ear

/** Start the audio on the first click/key (browser rule). Safe to call many times. */
function unlock(): void {
  try {
    if (!ac) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();             // keeps big vote waves from getting loud
      comp.threshold.value = -18; comp.ratio.value = 4;
      master = ac.createGain(); master.gain.value = level();
      master.connect(comp).connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  } catch { /* no audio in this browser: the game works silently */ }
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

function ready(): boolean { return !!ac && !!master && ac.state === 'running' && level() > 0; }

/** One tone: a sine/triangle with a quick attack and a smooth fade. */
function tone(freq: number, opts: { at?: number; dur?: number; gain?: number; type?: OscillatorType; attack?: number; bend?: number; lp?: number } = {}): void {
  if (!ac || !master) return;
  const t = ac.currentTime + (opts.at ?? 0), dur = opts.dur ?? 0.3, g = opts.gain ?? 0.2;
  const o = ac.createOscillator(), v = ac.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (opts.bend) o.frequency.exponentialRampToValueAtTime(freq * opts.bend, t + dur);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(g, t + (opts.attack ?? 0.004));
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out: AudioNode = v;
  if (opts.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; v.connect(f); out = f; }
  o.connect(v); out.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
/** A tiny burst of filtered noise: the "click" on the front of a clack or tap. */
function click(freq: number, opts: { at?: number; dur?: number; gain?: number; q?: number } = {}): void {
  if (!ac || !master || !noiseBuf) return;
  const t = ac.currentTime + (opts.at ?? 0), dur = opts.dur ?? 0.03;
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = opts.q ?? 3;
  const v = ac.createGain();
  v.gain.setValueAtTime(opts.gain ?? 0.15, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(v).connect(master);
  s.start(t, Math.random() * 0.2); s.stop(t + dur + 0.02);
}
/** A soft bell: a few partials that fade at different speeds (used for chimes). */
function bell(freq: number, at = 0, gain = 0.12, dur = 1.1): void {
  tone(freq, { at, dur, gain, attack: 0.008 });
  tone(freq * 2, { at, dur: dur * 0.6, gain: gain * 0.35, attack: 0.006 });
  tone(freq * 3.01, { at, dur: dur * 0.3, gain: gain * 0.12, attack: 0.004 });
}
const jitter = (f: number, amt = 0.07) => f * (1 + (Math.random() * 2 - 1) * amt);

/* Landing clacks can come in waves (hundreds of votes): at most one every 40 ms, and quieter in a crowd. */
let lastLand = 0, landRate = 0;
let lastPop = 0;

export const sfx = {
  /** Any button or tap: a soft wooden tock. */
  tap(): void { if (!ready()) return; click(1800, { gain: 0.06, dur: 0.025 }); tone(jitter(620, 0.03), { dur: 0.06, gain: 0.07 }); },
  /** A ball landing in a bin or the blind pool: a small glassy marble clack (same sound for every bin). */
  land(): void {
    if (!ready()) return;
    const now = performance.now();
    landRate = landRate * Math.exp(-(now - lastLand) / 400) + 1;
    if (now - lastLand < 40) return;
    lastLand = now;
    const g = 0.09 / Math.sqrt(Math.min(landRate, 9));
    const f = jitter(2100, 0.18);
    click(f * 1.6, { gain: g * 1.2, dur: 0.012, q: 5 });
    tone(f, { dur: 0.07, gain: g }); tone(f * 2.76, { dur: 0.035, gain: g * 0.4 });
  },
  /** A wrong-answer ball popping on the reveal: a tiny soft bubble. */
  pop(): void {
    if (!ready()) return;
    const now = performance.now(); if (now - lastPop < 55) return; lastPop = now;
    tone(jitter(900, 0.25), { dur: 0.08, gain: 0.05, bend: 1.8 });
  },
  /** The streamer locks in (or a solo player answers). Same sound for every answer. */
  pick(): void {
    if (!ready()) return;
    click(1200, { gain: 0.1, dur: 0.03 });
    tone(330, { dur: 0.16, gain: 0.16, type: 'triangle', lp: 1400 });
    tone(495, { at: 0.06, dur: 0.18, gain: 0.12, type: 'triangle', lp: 1600 });
  },
  /** Countdown in the last 5 seconds: a woodblock tick, a little brighter on the final second. */
  tick(secLeft: number): void {
    if (!ready()) return;
    const f = secLeft <= 1 ? 1250 : 980;
    click(2600, { gain: 0.07, dur: 0.02 }); tone(f, { dur: 0.05, gain: 0.11 });
  },
  /** Voting closes. */
  timeUp(): void { if (!ready()) return; tone(196, { dur: 0.45, gain: 0.14, type: 'triangle', lp: 900 }); click(700, { gain: 0.08, dur: 0.05 }); },
  /** A new round appears: a soft rising glass "ting-ting". */
  roundStart(): void { if (!ready()) return; bell(784, 0, 0.06, 0.5); bell(1175, 0.09, 0.05, 0.6); },
  /** Lightning round / double points title card: a quick rising shimmer. */
  special(): void { if (!ready()) return; [523, 659, 784, 1047, 1319].forEach((f, i) => bell(f, i * 0.06, 0.05, 0.7)); },
  /** Right answer: a warm three-note chime. */
  right(): void { if (!ready()) return; bell(659, 0, 0.11); bell(831, 0.08, 0.1); bell(988, 0.16, 0.1, 1.4); },
  /** Chat got it but the streamer didn't: friendly, lower chime. */
  chat(): void { if (!ready()) return; bell(440, 0, 0.1); bell(554, 0.09, 0.09); bell(659, 0.18, 0.09, 1.2); },
  /** Everyone wrong / out of time: a soft, low two-note "aw". */
  wrong(): void {
    if (!ready()) return;
    tone(294, { dur: 0.32, gain: 0.13, type: 'triangle', lp: 900 });
    tone(220, { at: 0.18, dur: 0.5, gain: 0.13, type: 'triangle', lp: 800 });
  },
  /** Lightning 1–2 (answers come later): a light whoosh to the next question. */
  next(): void { if (!ready()) return; tone(500, { dur: 0.22, gain: 0.05, bend: 2.2 }); },
  /** Score counting up: tiny ticks that climb in pitch, then a pop at the end. */
  count(step: number): void { if (!ready()) return; tone(700 + Math.min(step, 12) * 60, { dur: 0.04, gain: 0.05 }); },
  countEnd(): void { if (!ready()) return; tone(1400, { dur: 0.09, gain: 0.07, bend: 1.4 }); },
  /** End of a game. good: streamer won / great solo score; chat: chat won; even: tie or middling. */
  finale(kind: 'good' | 'chat' | 'even' | 'low'): void {
    if (!ready()) return;
    const seq = kind === 'good' ? [523, 659, 784, 1047] : kind === 'chat' ? [392, 494, 587, 784] : kind === 'even' ? [523, 659, 523, 659] : [440, 392, 330];
    seq.forEach((f, i) => bell(f, i * 0.12, 0.1, i === seq.length - 1 ? 1.6 : 0.8));
  },
};

/* ---------- volume ---------- */
function apply(): void {
  if (master && ac) master.gain.setTargetAtTime(level(), ac.currentTime, 0.03);
  document.querySelectorAll<HTMLElement>('.sfx').forEach((n) => {
    n.classList.toggle('off', muted || vol === 0);
    const r = n.querySelector<HTMLInputElement>('input'); if (r) r.value = String(Math.round(vol * 100));
    const m = n.querySelector<HTMLButtonElement>('.sfxMute'); if (m) m.textContent = muted ? 'Unmute' : 'Mute';
    const b = n.querySelector<HTMLButtonElement>('.sfxBtn'); if (b) b.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  });
}
export function setVolume(v: number): void { vol = Math.min(1, Math.max(0, v)); if (vol > 0) muted = false; store.set(VOL_KEY, String(vol)); store.set(MUTE_KEY, muted ? '1' : '0'); apply(); }
export function toggleMute(): void { muted = !muted; if (!muted && vol === 0) vol = 0.5; store.set(MUTE_KEY, muted ? '1' : '0'); store.set(VOL_KEY, String(vol)); apply(); }

const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>' +
  '<path class="w" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  '<path class="x" d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** Put the sound button (speaker icon → mute + volume slider) in the page header, and give every
 *  button a soft tap sound. Buttons with data-sfx="off" stay silent (they play their own sound). */
export function initSound(): void {
  const mast = document.querySelector('.mast');
  if (mast && !mast.querySelector('.sfx')) {
    const box = el('div', 'sfx');
    const btn = el('button', 'sfxBtn'); btn.type = 'button'; btn.innerHTML = ICON; btn.dataset.sfx = 'off'; btn.title = 'Sound';
    const panel = el('div', 'sfxPanel');
    const label = el('span', null, 'Sound');
    const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5'; range.setAttribute('aria-label', 'Volume');
    const mute = el('button', 'btn ghost small sfxMute', 'Mute'); mute.type = 'button';
    panel.append(label, range, mute);
    box.append(btn, panel);
    btn.onclick = (e) => { e.stopPropagation(); box.classList.toggle('open'); };
    range.oninput = () => setVolume(+range.value / 100);
    range.onchange = () => sfx.tap();                          // a sample at the new volume
    mute.onclick = () => { toggleMute(); };
    document.addEventListener('click', (e) => { if (!box.contains(e.target as Node)) box.classList.remove('open'); });
    const score = mast.querySelector('#scoreboard');
    if (score) mast.insertBefore(box, score); else mast.append(box);
  }
  apply();
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button, .btn, summary, .mode');
    if (!b || (b as HTMLElement).dataset.sfx === 'off' || b.closest('[data-sfx=off]')) return;
    sfx.tap();
  }, true);
}

/** Phones (Android): a very light buzz on a tap, where the browser supports it. */
export function buzz(ms = 8): void {
  try { if (matchMedia('(pointer: coarse)').matches && 'vibrate' in navigator) navigator.vibrate(ms); } catch { /* not supported */ }
}
