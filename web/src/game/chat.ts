/* Mizavo — reading votes: parsing chat messages and the anonymous Twitch chat connection. */
import { $ } from '../lib/dom';
import { S, colorFor, type RoundType, type Vote } from './state';
import { addLabel, bins, flyTo, spawnOrb } from './arena';

export interface ChatMessage { id: string | null; login: string; name: string; color: string | null; text: string; bot: boolean }

/** Turn a chat message into an option number, or null if it isn't a vote. */
export function parseVote(text: string, type: RoundType): number | null {
  const t = String(text).trim().toLowerCase().replace(/^!(?:vote|v)\s*/, '');
  if (type === 'ff') {
    if (/^(1|fact|true|real|yes|t)$/.test(t)) return 0;
    if (/^(2|fake|false|cap|no)$/.test(t)) return 1;
    return null;
  }
  const m = t.match(/^([a-d1-4])$/); if (!m) return null;
  return /[a-d]/.test(m[1]) ? m[1].charCodeAt(0) - 97 : +m[1] - 1;
}

/** A chat message arrived: count it as a vote if it is one.
 *  Each viewer's FIRST valid answer in a round counts; later messages are ignored (no switching). */
export function onChat(m: ChatMessage): void {
  const R = S.R;
  if (S.phase !== 'vote' && S.phase !== 'gate') return;
  if (!R) return;
  const choice = parseVote(m.text, R.type);
  if (choice == null || choice >= R.opts.length) return;
  const key = m.login.toLowerCase();
  if (R.votes.has(key)) return; // already answered this round: first answer stands
  const col = colorFor(key);   // soft palette color (Twitch name colors can be neon)
  const hidden = S.blind && R.pick == null && S.phase === 'vote';
  const v = { key, id: m.id, login: m.login, name: m.name, color: col, choice, bot: m.bot } as Vote;
  R.votes.set(key, v);
  const o = spawnOrb(v); flyTo(o, hidden ? 'pool' : choice);
  addLabel(m.name, col, o.to!.x, hidden ? o.to!.y - 12 : bins[choice].y - 6);
}

/** Extra listener for every chat message (the warm-up panel uses it to wake up when paused). */
let extra: ((m: ChatMessage) => void) | null = null;
export function onAnyChat(fn: ((m: ChatMessage) => void) | null): void { extra = fn; }

/* ---------- Twitch: anonymous, read-only chat (no login, no bot account) ---------- */
const TW = { ws: null as WebSocket | null, ch: '', want: false, retry: 0 };

export function setStatus(t: string, cls = ''): void {
  $('#status').className = 'pill ' + cls; $('#statusTxt').textContent = t;
}
export function connectTwitch(ch: string): void { disconnectTwitch(); TW.ch = ch; TW.want = true; TW.retry = 0; openWS(); }
export function disconnectTwitch(): void {
  TW.want = false;
  if (TW.ws) { const w = TW.ws; TW.ws = null; try { w.close(); } catch { /* already closed */ } }
}
function twFail(): void { TW.want = false; setStatus(S.demo ? "can't reach Twitch · demo on" : "can't reach Twitch", 'err'); }

function openWS(): void {
  setStatus('connecting #' + TW.ch + '…');
  let ws: WebSocket;
  try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch { return twFail(); }
  TW.ws = ws; let opened = false;
  ws.onopen = () => {
    opened = true; TW.retry = 0;
    ws.send('CAP REQ :twitch.tv/tags'); ws.send('PASS SCHMOOPIIE');
    ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000)); ws.send('JOIN #' + TW.ch);
  };
  ws.onmessage = (ev) => {
    for (const line of String(ev.data).split('\r\n')) {
      if (!line) continue;
      if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue; }
      if (line.includes(' JOIN #')) { setStatus('#' + TW.ch + (S.demo ? ' + demo' : ''), 'on'); continue; }
      const m = parseIRC(line); if (m) { onChat(m); extra?.(m); }
    }
  };
  ws.onclose = () => {
    if (TW.ws !== ws) return;
    if (!opened) return twFail();
    if (TW.want && TW.retry < 6) { TW.retry++; setStatus('reconnecting…', 'err'); setTimeout(() => TW.want && openWS(), 1000 * TW.retry); }
    else if (TW.want) twFail();
  };
}

function parseIRC(line: string): ChatMessage | null {
  const tags: Record<string, string> = {};
  if (line[0] === '@') {
    const sp = line.indexOf(' ');
    line.slice(1, sp).split(';').forEach((kv) => { const i = kv.indexOf('='); tags[kv.slice(0, i)] = kv.slice(i + 1); });
    line = line.slice(sp + 1);
  }
  const m = line.match(/^:([^!\s]+)!\S+ PRIVMSG #\S+ :(.*)$/); if (!m) return null;
  return { id: tags['user-id'] || null, login: m[1], name: tags['display-name'] || m[1], color: tags.color || null, text: m[2], bot: false };
}
