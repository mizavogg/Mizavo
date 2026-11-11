// Mizavo — Vite build settings.
// Each page is its own entry. `npm run build` writes the finished site to dist/,
// and dist/ is what gets uploaded to Cloudflare.
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error: Node's type definitions aren't installed; Vite runs this file in Node, where node:fs exists
import { readFileSync } from 'node:fs';

/** Page transition: put src/lib/pagefx-head.js (with the logo built in) into the <head> of every page,
    so the animation starts on the first frame instead of waiting for the page's code to download. */
function pageTransition(): Plugin {
  const css =
    '.fxLayer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden}' +
    // the glass screen: copper light behind vertical glass ribs, blurring the page underneath
    '.fxVeil{position:absolute;inset:0;-webkit-backdrop-filter:blur(18px) saturate(1.2);backdrop-filter:blur(18px) saturate(1.2);'+
      'background:repeating-linear-gradient(90deg,rgba(0,0,0,.30) 0,rgba(242,232,220,.05) 2px,rgba(242,232,220,.14) 4px,rgba(242,232,220,.02) 6px,rgba(0,0,0,0) 10px,rgba(0,0,0,.12) 15px,rgba(0,0,0,.30) 18px),'+
      'radial-gradient(ellipse 60% 55% at 50% 50%,rgba(183,105,53,.38),rgba(183,105,53,0) 70%),rgba(18,21,22,.55)}' +
    '.fxBall{position:absolute;left:0;top:0;border-radius:50%;will-change:transform,opacity;box-shadow:inset -6px -8px 14px rgba(0,0,0,.35),0 8px 16px -6px rgba(0,0,0,.6)}' +
    '.fxLogo{position:absolute;left:50%;top:50%;width:min(120px,26vw);height:min(120px,26vw);margin:calc(min(120px,26vw)/-2) 0 0 calc(min(120px,26vw)/-2);opacity:0;will-change:transform,opacity;filter:drop-shadow(0 14px 30px rgba(0,0,0,.6))}';
  return {
    name: 'mizavo-page-transition',
    transformIndexHtml() {
      const logo = 'data:image/webp;base64,' + readFileSync('src/lib/pagefx-logo.webp').toString('base64');
      const js = readFileSync('src/lib/pagefx-head.js', 'utf8').replace('__FX_LOGO__', logo);
      return [
        { tag: 'style', children: css, injectTo: 'head' },
        { tag: 'script', children: js, injectTo: 'head' },
      ];
    },
  };
}

export default defineConfig({
  plugins: [pageTransition()],
  build: {
    rollupOptions: {
      input: {
        game: 'index.html',
        admin: 'admin.html',
        guide: 'guide.html',
        today: 'today.html',
        channel: 'channel.html',
        solo: 'solo.html',
      },
    },
  },
});
