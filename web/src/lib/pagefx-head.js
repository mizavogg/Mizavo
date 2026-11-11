/* Mizavo — page transition "Pop & scatter" (chosen Nov 10, 2026).
   Colored balls burst outward from the Mizavo logo over a flat sheet of frosted glass; the new page shows blurred
   behind the glass and comes into focus as it fades (about 0.6 s). Updated Nov 11: a flat frosted-glass screen instead of a dark one (ribs tried, too busy),
   and every motion goes one way only so nothing pulses.

   vite.config.ts copies this file into the <head> of every page at build time, so it starts on the very
   first frame, before the page's own code loads (starting late made it look choppy). The logo is built in
   (the build swaps in the image) so it never waits on a download.

   Plays only when this page was opened by a link from another Mizavo page: not on a first visit, a reload,
   the back button, Twitch login, or with reduce-motion on. Clicks go straight through. Silent on purpose. */
(function () {
  try {
    var nav = performance.getEntriesByType('navigation')[0], ref = document.referrer;
    if (!nav || nav.type !== 'navigate' || !ref || new URL(ref).origin !== location.origin) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate) return;
  } catch (e) { return; }

  var LENGTH = 600, N = 18;
  var COLORS = ['#7F95AD', '#B76935', '#F2E8DC', '#8FB39A', '#A99BC9', '#E7C39B'];
  var html = document.documentElement;
  var layer = document.createElement('div');
  layer.className = 'fxLayer';
  layer.setAttribute('aria-hidden', 'true');
  var veil = document.createElement('div');
  veil.className = 'fxVeil';
  var logo = document.createElement('img');
  logo.className = 'fxLogo'; logo.alt = ''; logo.src = '__FX_LOGO__';
  layer.appendChild(veil); layer.appendChild(logo);
  html.appendChild(layer); // <body> doesn't exist yet; <html> does

  var W = innerWidth, H = innerHeight, cx = W / 2, cy = H / 2, far = Math.sqrt(W * W + H * H) * 0.65;
  var jobs = [];
  function opts(delay) { return { duration: LENGTH, delay: delay || 0, fill: 'both' }; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // the glass screen: the new page shows blurred behind ribbed glass, then comes into focus as the glass fades
  jobs.push(veil.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0, easing: 'ease-out' }], opts()));
  for (var i = 0; i < N; i++) {
    (function (i) {
      var a = (i / N) * Math.PI * 2 + rnd(-0.12, 0.12), s = Math.round(rnd(16, 28));
      var c = COLORS[i % COLORS.length], b = document.createElement('div');
      b.className = 'fxBall';
      b.style.width = b.style.height = s + 'px';
      b.style.background = 'radial-gradient(circle at 34% 30%, rgba(255,255,255,.55) 0 8%, ' + c + ' 38%, color-mix(in srgb, ' + c + ' 55%, #000) 100%)';
      layer.appendChild(b);
      function at(d) { return 'translate(' + (cx + Math.cos(a) * d - s / 2) + 'px,' + (cy + Math.sin(a) * d - s / 2) + 'px)'; }
      // one continuous motion outward: no pause in the ring and no grow-then-shrink, so nothing pulses
      jobs.push(b.animate([
        { transform: at(40) + ' scale(.4)', opacity: 0 },
        { transform: at(150) + ' scale(1)', opacity: 1, offset: 0.3 },
        { transform: at(far) + ' scale(1)', opacity: 0 }
      ], { duration: LENGTH, delay: i * 6, fill: 'both', easing: 'cubic-bezier(.25,.6,.35,1)' }));
    })(i);
  }
  jobs.push(logo.animate([
    // one steady motion: grows the whole time while it fades in and out (no hold, no bounce)
    { opacity: 0, transform: 'scale(.86)' },
    { opacity: 1, transform: 'scale(.95)', offset: 0.3 },
    { opacity: 1, transform: 'scale(1)', offset: 0.55 },
    { opacity: 0, transform: 'scale(1.08)' }
  ], { duration: LENGTH, fill: 'both', easing: 'linear' }));

  var gone = false;
  function done() { if (!gone) { gone = true; layer.remove(); } }
  Promise.all(jobs.map(function (j) { return j.finished; })).then(done, done);
  setTimeout(done, LENGTH + 800); // safety net: never leave the cover up
})();
