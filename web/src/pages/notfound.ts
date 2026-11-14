/* Mizavo — the 404 page (404.html, Nov 14, 2026): shown for any address that doesn't exist.
   Same card as the daily challenge page, with two ways back into the game. */
import { initNav } from '../lib/nav';
import { ribbedGlass } from '../lib/ribbed';

initNav();
{ // the card's window of moving ribbed glass
  const card = document.getElementById('intro')!;
  ribbedGlass(card, card.querySelector<HTMLCanvasElement>('.rGlow')!, card.querySelector<HTMLCanvasElement>('.rEdges')!, 9, (blob, _w, _h, s, c) => {
    blob(0.78 + 0.14 * s(0.0002), 0.45 + 0.22 * c(0.00026), 0.3, 0.75, [[0, '#d68a52'], [0.3, '#b76935'], [0.6, 'rgba(147,94,56,.5)'], [1, 'rgba(111,82,59,0)']]);
    blob(0.3 + 0.15 * c(0.00018, 1), 0.65 + 0.15 * s(0.00022, 2), 0.22, 0.6, [[0, '#7a5a42'], [0.45, 'rgba(110,90,70,.5)'], [1, 'rgba(92,77,60,0)']]);
  });
}
