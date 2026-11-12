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
    // the cover sheet: Mizavo ink with a soft copper glow, a lit top edge and soft curved ends (like the Blush veil)
    '.fxSheet{position:absolute;left:0;right:0;top:0;height:100%;transform:translateY(112%);will-change:transform;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;'+
      'background:radial-gradient(ellipse 55% 45% at 50% 50%,rgba(183,105,53,.22),rgba(183,105,53,0) 70%),linear-gradient(180deg,#191d1f,#121516 60%,#0f1213)}' +
    '.fxSheet::before,.fxSheet::after{content:"";position:absolute;left:-15%;right:-15%;height:120px;border-radius:50%}' +
    '.fxSheet::before{top:-58px;background:#191d1f;box-shadow:inset 0 2px 0 rgba(245,239,230,.16)}' +
    '.fxSheet::after{bottom:-58px;background:#0f1213}' +
    '.fxLogo{position:relative;z-index:1;width:min(110px,26vw);height:min(110px,26vw);opacity:0;filter:drop-shadow(0 14px 30px rgba(0,0,0,.6))}' +
    // three game balls bounce under the logo, but only if the page takes more than half a second
    '.fxDots{position:relative;z-index:1;display:flex;gap:10px;height:14px;opacity:0;transition:opacity .25s}' +
    '.fxDots.wait{opacity:1;transition-delay:.5s}' +
    '.fxDots i{width:12px;height:12px;border-radius:50%;animation:fxHop .9s ease-in-out infinite;box-shadow:inset -2px -3px 4px rgba(0,0,0,.3)}' +
    '.fxDots i:nth-child(1){background:radial-gradient(circle at 34% 30%,#fff 0 8%,#7F95AD 45%,#3d4a58)}' +
    '.fxDots i:nth-child(2){background:radial-gradient(circle at 34% 30%,#fff 0 8%,#B76935 45%,#5b3218);animation-delay:.15s}' +
    '.fxDots i:nth-child(3){background:radial-gradient(circle at 34% 30%,#fff 0 8%,#F2E8DC 45%,#7E848F);animation-delay:.3s}' +
    '@keyframes fxHop{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}';
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
