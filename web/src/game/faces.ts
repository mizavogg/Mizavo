/* Mizavo — special "face balls": a viewer's ball shows their emote instead of a plain color.
   Matched by Twitch user ID when we have it (survives name changes), otherwise by login.
   Each one needs the person's OK. To add someone: put their image in public/balls/ and add a line below. */

interface FaceBall { login: string; id?: string; src: string }

const FACE_BALLS: FaceBall[] = [
  // Added Nov 6, 2026 at his request. Add his Twitch user ID (id: '...') once he has voted in a game.
  { login: 'thebigslimehimself', src: '/balls/thebigslimehimself.png' },
];

const cache = new Map<string, HTMLImageElement>();

/** The loaded face image for a viewer, or null if they don't have one (or it hasn't loaded yet). */
export function faceFor(login: string, id: string | null): HTMLImageElement | null {
  const l = login.toLowerCase();
  const f = FACE_BALLS.find((b) => (id && b.id === id) || b.login === l);
  if (!f) return null;
  let img = cache.get(f.src);
  if (!img) { img = new Image(); img.src = f.src; cache.set(f.src, img); }
  return img;
}

/** Start loading every face image early so the first vote doesn't draw a blank ball. */
export function preloadFaces(): void { for (const f of FACE_BALLS) faceFor(f.login, f.id ?? null); }
