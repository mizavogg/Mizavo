/* Mizavo — page transition "Pop & scatter, covered" (Nov 11, 2026).
   1. Click a link to another Mizavo page: the logo pops up in the center and colored balls burst out into a ring
      behind it, while the dark cover grows out of the center with them until it covers the page; then the browser
      goes to the new page.
   2. The new page starts with that same picture (dark screen, logo, ring of balls), and the ring slowly turns
      while the page loads underneath, so nothing is ever seen loading in.
   3. Once the page is fully loaded (images, fonts, the glass effects' first frame), the balls burst outward and
      a hole opens in the cover from the center, following them, so the page appears from the middle out.
   Every motion goes one way (no grow-and-shrink), so nothing pulses. vite.config.ts copies this file into the
   <head> of every page at build time (the logo is built in), so the cover is up on the very first frame.
   4. Opening Mizavo (typing the address, a bookmark, the home-screen icon, a link from another site, a reload):
      the logo and ring pop up on a dark screen right away, then open the same way once the page is ready (Nov 14).
   A page can ask the cover to wait longer by putting the class "fxWait" on <html> (the Play page does this until it
   knows whether to show the launch screen or the settings screen). Not used for new tabs opened from Mizavo links
   kept in memory, the back button, the OBS warm-up page, or with reduce-motion on. If anything goes wrong, the cover
   always clears itself within 3 seconds. Silent. */
(function () {
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce || !Element.prototype.animate) return;

  var POP_MS = 340, BURST_MS = 560, MIN_HOLD = 160, MAX_HOLD = 3000, KEY = 'mzCover';
  var COLORS = ['#7F95AD', '#B76935', '#F2E8DC', '#8FB39A', '#A99BC9', '#E7C39B'];
  var N = 16, R = 118;
  // The cover is 99% solid, never 100%: Safari stops drawing frosted-glass panels hidden behind a fully solid layer
  // and doesn't bring them back until the layer is removed, so they showed flat grey while the cover opened (Nov 14).
  var VEIL = '0.99';
  var SIZES = [22, 17, 26, 19, 24, 16, 21, 27, 18, 23, 20, 25, 17, 22, 26, 19];   // fixed, so both pages match
  var html = document.documentElement;
  var standalone = false;
  try { standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (e) {}
  var holeOK = false;   // the opening hole needs an animatable length; older browsers just fade instead
  try { CSS.registerProperty({ name: '--hole', syntax: '<length>', inherits: false, initialValue: '0px' }); holeOK = true; }
  catch (e) { holeOK = !!(window.CSS && CSS.supports && CSS.supports('mask-image', 'radial-gradient(#000,#000)')) && e && e.name === 'InvalidModificationError'; }

  function build() {
    var layer = document.createElement('div'); layer.className = 'fxLayer'; layer.setAttribute('aria-hidden', 'true');
    // Home-screen app (iPhone): while a new page starts, iOS briefly reports the window height without the status bar,
    // then corrects it, so a cover centered on the window jumped for a frame (Nov 14). The screen's height never
    // changes, so size the cover by that instead; both pages then put the logo in exactly the same spot.
    if (standalone) {   // iPhones report the screen in portrait even when turned sideways
      var land = false; try { land = matchMedia('(orientation: landscape)').matches; } catch (e) {}
      var sh = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
      layer.style.bottom = 'auto'; layer.style.height = sh + 'px';
    }
    var veil = document.createElement('div'); veil.className = 'fxVeil';
    var ring = document.createElement('div'); ring.className = 'fxRing';
    var balls = [];
    for (var i = 0; i < N; i++) {
      var a = (i / N) * Math.PI * 2, s = SIZES[i], c = COLORS[i % COLORS.length], b = document.createElement('div');
      b.className = 'fxBall'; b.style.width = b.style.height = s + 'px'; b.style.margin = (-s / 2) + 'px 0 0 ' + (-s / 2) + 'px';
      b.style.background = 'radial-gradient(circle at 34% 30%, rgba(255,255,255,.55) 0 8%, ' + c + ' 38%, color-mix(in srgb, ' + c + ' 55%, #000) 100%)';
      b._a = a; ring.appendChild(b); balls.push(b);
    }
    var logo = document.createElement('img'); logo.className = 'fxLogo'; logo.alt = ''; logo.src = '__FX_LOGO__';
    layer.appendChild(veil); layer.appendChild(ring); layer.appendChild(logo);
    return { layer: layer, veil: veil, ring: ring, balls: balls, logo: logo };
  }
  var at = function (b, d) { return 'translate(' + (Math.cos(b._a) * d).toFixed(1) + 'px,' + (Math.sin(b._a) * d).toFixed(1) + 'px)'; };
  function settled(F) {   // the picture both pages share: dark screen, logo, ring of balls
    F.veil.style.opacity = VEIL; F.logo.style.opacity = '1';
    for (var i = 0; i < F.balls.length; i++) F.balls[i].style.transform = at(F.balls[i], R);
  }

  /* ---------- arriving: start covered, ring turning, then burst once the page is fully loaded ---------- */
  var arriving = false;
  try { arriving = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); } catch (e) {}
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var navType = nav ? nav.type : 'navigate';
  if (arriving && navType !== 'navigate') arriving = false;   // back/forward from memory: no cover
  // opening Mizavo fresh (or reloading): the same cover, popping in first. Never on the OBS warm-up overlay.
  var opening = !arriving && (navType === 'navigate' || navType === 'reload') && !/^\/warmup/.test(location.pathname);
  if (arriving || opening) {
    var A = build(), t0 = performance.now(), done = false, hold = MIN_HOLD;
    if (arriving) { settled(A); A.ring.classList.add('spin'); }
    else {   // dark from the first frame; the logo and balls pop out into the ring, then it turns while the page loads
      A.veil.style.opacity = VEIL; hold = POP_MS + 260;
      A.logo.animate([{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'scale(1)' }], { duration: POP_MS, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
      for (var k = 0; k < A.balls.length; k++) {
        var bb = A.balls[k];
        bb.style.opacity = '1';
        bb.animate([{ transform: at(bb, 24) + ' scale(.3)', opacity: 0 }, { transform: at(bb, R) + ' scale(1)', opacity: 1 }],
          { duration: POP_MS - 40, delay: k * 6, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
      }
      setTimeout(function () { for (var j = 0; j < A.balls.length; j++) A.balls[j].getAnimations().forEach(function (an) { an.commitStyles(); an.cancel(); }); A.ring.classList.add('spin'); }, POP_MS + 60);
    }
    html.appendChild(A.layer);   // <body> doesn't exist yet; <html> does
    var far = Math.sqrt(innerWidth * innerWidth + innerHeight * innerHeight) * 0.65;
    var burst = function () {
      if (done) return; done = true;
      setTimeout(function () {
        html.classList.add('fxRepaint');   // give the glass panels fresh layers so Safari redraws what's behind them
        var jobs = [];
        for (var i = 0; i < A.balls.length; i++) {
          var b = A.balls[i];
          jobs.push(b.animate([{ transform: at(b, R), opacity: 1 }, { transform: at(b, far), opacity: 0 }],
            { duration: BURST_MS, delay: i * 8, easing: 'cubic-bezier(.3,.55,.4,1)', fill: 'forwards' }).finished);
        }
        jobs.push(A.logo.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.1)' }],
          { duration: 300, easing: 'ease-in', fill: 'forwards' }).finished);
        if (holeOK) {   // a hole opens from the center and follows the balls out
          // Drawn as a plain gradient (no mask, no blend mode) on its own sheet: Safari draws the page's frosted
          // glass panels as flat grey under a masked or blended layer (Nov 14). The glow sheet fades away under it.
          var hole = document.createElement('div'); hole.className = 'fxHole';
          A.layer.insertBefore(hole, A.ring);
          A.veil.animate([{ opacity: VEIL }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
          jobs.push(hole.animate([{ '--hole': '0px' }, { '--hole': far + 'px' }], { duration: BURST_MS + 80, easing: 'cubic-bezier(.3,.55,.4,1)', fill: 'forwards' }).finished);
        } else {
          jobs.push(A.veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 120, easing: 'ease-out', fill: 'forwards' }).finished);
        }
        var gone = function () { A.layer.remove(); };
        Promise.all(jobs).then(gone, gone);
        setTimeout(gone, BURST_MS + 600);
      }, Math.max(0, hold - (performance.now() - t0)));
    };
    var ready = function () {   // fully loaded, fonts ready, the page says it's ready, then two frames so the glass effects have drawn
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      var pageReady = new Promise(function (res) {
        if (!html.classList.contains('fxWait')) return res();
        new MutationObserver(function (m, o) { if (!html.classList.contains('fxWait')) { o.disconnect(); res(); } })
          .observe(html, { attributes: true, attributeFilter: ['class'] });
      });
      Promise.all([fonts, pageReady]).then(function () { requestAnimationFrame(function () { requestAnimationFrame(burst); }); }, burst);
    };
    if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready, { once: true });
    setTimeout(burst, MAX_HOLD);   // safety net: never leave the cover up
  }

  /* ---------- leaving: balls pop out into the ring as the screen goes dark, then go ---------- */
  function internal(a, e) {
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    if (a.target && a.target !== '_self') return null;
    if (a.hasAttribute('download') || a.getAttribute('href') == null) return null;
    var url; try { url = new URL(a.href, location.href); } catch (er) { return null; }
    if (url.origin !== location.origin) return null;
    if (url.pathname === location.pathname && url.search === location.search) return null;   // same page (#anchors)
    return url.href;
  }
  var leaving = false;
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    var href = internal(a, e); if (!href || leaving) return;
    e.preventDefault(); leaving = true;
    var L = build();
    (document.body || html).appendChild(L.layer);
    var reach = Math.sqrt(innerWidth * innerWidth + innerHeight * innerHeight) / 2 + 20;
    L.veil.style.opacity = VEIL;   // the dark cover grows out of the center with the balls
    L.veil.animate([{ clipPath: 'circle(0px at 50% 50%)' }, { clipPath: 'circle(' + reach + 'px at 50% 50%)' }],
      { duration: POP_MS, easing: 'cubic-bezier(.33,0,.2,1)', fill: 'forwards' });
    L.logo.animate([{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'scale(1)' }], { duration: POP_MS, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    for (var i = 0; i < L.balls.length; i++) {
      var b = L.balls[i];
      b.animate([{ transform: at(b, 24) + ' scale(.3)', opacity: 0 }, { transform: at(b, R) + ' scale(1)', opacity: 1 }],
        { duration: POP_MS - 40, delay: i * 6, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    }
    try { sessionStorage.setItem(KEY, '1'); } catch (er) {}
    setTimeout(function () { location.href = href; }, POP_MS + 60);
  }, false);
  // coming back with the back button (page restored from memory): make sure no cover is left over
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { leaving = false; var l = document.querySelectorAll('.fxLayer'); for (var i = 0; i < l.length; i++) l[i].remove(); }
  });
})();
