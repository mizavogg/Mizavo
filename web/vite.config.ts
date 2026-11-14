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
    // the cover: Mizavo ink with a soft copper glow behind the logo. The glow fades over many steps (so no rings show)
    // and a faint film grain on top breaks up any banding that's left.
    '.fxVeil{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse 62% 58% at 50% 50%,rgba(183,105,53,.21) 0%,rgba(183,105,53,.185) 12%,rgba(183,105,53,.15) 24%,'+
      'rgba(183,105,53,.112) 36%,rgba(183,105,53,.076) 48%,rgba(183,105,53,.046) 60%,rgba(183,105,53,.024) 72%,rgba(183,105,53,.009) 85%,rgba(183,105,53,0) 100%),#121516}' +
    '.fxVeil::after{content:"";position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.9%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")}' +
    // arriving: a hole opens from the center (its radius --hole grows), soft-edged. A plain gradient, not a mask:
    // Safari draws frosted-glass panels underneath a masked layer as flat grey.
    '.fxHole{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,transparent var(--hole),#121516 calc(var(--hole) + 40px))}' +
    // the ring of balls around the logo; it turns slowly while the next page loads
    '.fxRing{position:absolute;left:50%;top:50%;width:0;height:0}' +
    '.fxRing.spin{animation:fxSpin 7s linear infinite}' +
    '@keyframes fxSpin{to{transform:rotate(360deg)}}' +
    '.fxBall{position:absolute;left:0;top:0;border-radius:50%;opacity:0;will-change:transform,opacity;box-shadow:inset -6px -8px 14px rgba(0,0,0,.35),0 8px 16px -6px rgba(0,0,0,.6)}' +
    '.fxRing.spin .fxBall{opacity:1}' +
    '.fxLogo{position:absolute;left:50%;top:50%;width:min(110px,26vw);height:min(110px,26vw);margin:calc(min(110px,26vw)/-2) 0 0 calc(min(110px,26vw)/-2);opacity:0;will-change:transform,opacity;filter:drop-shadow(0 14px 30px rgba(0,0,0,.6))}';
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
        family: 'family.html',
        warmup: 'warmup.html',
        notfound: '404.html',
        privacy: 'privacy.html',
      },
    },
  },
});
