/* Mizavo — the family login page (family.html, Nov 13, 2026).
   A hidden page (not linked anywhere, kept out of search engines) where people too young for Twitch
   log in with the username + password Aiden made for them on the admin page.
   Behind the scenes each family login is a Supabase account whose address is <username>@family.mizavo.gg.
   That address is never emailed; it only exists because Supabase's password login needs one.
   After logging in, the player goes to the daily challenge page (/solo), which knows about family logins. */
import { $, el, show } from '../lib/dom';
import { supabase } from '../lib/supabase';
import { initNav } from '../lib/nav';
import { initSound } from '../lib/sound';
import { ribbedGlass } from '../lib/ribbed';

const FAMILY_DOMAIN = 'family.mizavo.gg';

function err(msg: string | null): void { const e = $('#err'); e.textContent = msg || ''; show(e, !!msg); }

/** Already logged in: family logins go straight to the game; a Twitch login gets a note. */
async function checkSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return;
  if (user.app_metadata?.family) { location.replace('/solo'); return; }
  show($('#famForm'), false);
  $('#famText').textContent = "You're already logged in with Twitch, so you don't need a family login.";
  const go = el('a', 'btn primary', 'Go to the daily challenge'); go.href = '/solo';
  $('#famDone').replaceChildren(go); show($('#famDone'), true);
}

$('#famForm').onsubmit = async (e) => {
  e.preventDefault(); err(null);
  const user = $<HTMLInputElement>('#famUser').value.trim().toLowerCase();
  const pass = $<HTMLInputElement>('#famPass').value;
  if (!user || !pass) return err('Type your username and password.');
  if (!/^[a-z0-9_]{2,20}$/.test(user)) return err("That username and password don't match. Check the spelling and try again.");
  const btn = $<HTMLButtonElement>('#famBtn'); btn.disabled = true; btn.textContent = 'Logging in…';
  const { error } = await supabase.auth.signInWithPassword({ email: `${user}@${FAMILY_DOMAIN}`, password: pass });
  if (!error) { location.replace('/solo'); return; }
  btn.disabled = false; btn.textContent = 'Log in';
  const m = error.message.toLowerCase();
  if (m.includes('banned')) err('This login has been turned off. Ask the person who gave it to you.');
  else if (m.includes('invalid')) err("That username and password don't match. Check the spelling and try again.");
  else if (m.includes('rate') || m.includes('too many')) err('Too many tries. Wait a minute, then try again.');
  else err('Login failed: ' + error.message);
};

initNav();
initSound();
{ // the card's window of moving ribbed glass, same as the daily challenge page
  const card = document.getElementById('intro')!;
  ribbedGlass(card, card.querySelector<HTMLCanvasElement>('.rGlow')!, card.querySelector<HTMLCanvasElement>('.rEdges')!, 9, (blob, _w, _h, s, c) => {
    blob(0.78 + 0.14 * s(0.0002), 0.45 + 0.22 * c(0.00026), 0.3, 0.75, [[0, '#d68a52'], [0.3, '#b76935'], [0.6, 'rgba(147,94,56,.5)'], [1, 'rgba(111,82,59,0)']]);
    blob(0.3 + 0.15 * c(0.00018, 1), 0.65 + 0.15 * s(0.00022, 2), 0.22, 0.6, [[0, '#7a5a42'], [0.45, 'rgba(110,90,70,.5)'], [1, 'rgba(92,77,60,0)']]);
  });
}
checkSession();
