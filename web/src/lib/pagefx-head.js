/* Mizavo — page transition "Pop & scatter, covered" (Nov 11, 2026).
   1. Click a link to another Mizavo page: colored balls pop out into a ring around the Mizavo logo while the
      screen goes dark behind them, then the browser goes to the new page.
   2. The new page starts with that same picture (dark screen, logo, ring of balls), and the ring slowly turns
      while the page loads underneath, so nothing is ever seen loading in.
   3. Once the page is fully loaded (images, fonts, the glass effects' first frame), the balls burst outward,
      the logo fades and the cover clears.
   Every motion goes one way (no grow-and-shrink), so nothing pulses. vite.config.ts copies this file into the
   <head> of every page at build time (the logo is built in), so the cover is up on the very first frame.
   Not used for other sites, new tabs, downloads, same-page links, reloads, the back button, or with
   reduce-motion on. If anything goes wrong, the cover always clears itself within 3 seconds. Silent. */
(function () {
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce || !Element.prototype.animate) return;

  var POP_MS = 340, BURST_MS = 560, MIN_HOLD = 160, MAX_HOLD = 3000, KEY = 'mzCover';
  var COLORS = ['#7F95AD', '#B76935', '#F2E8DC', '#8FB39A', '#A99BC9', '#E7C39B'];
  var N = 16, R = 118;
  var SIZES = [22, 17, 26, 19, 24, 16, 21, 27, 18, 23, 20, 25, 17, 22, 26, 19];   // fixed, so both pages match
  var html = document.documentElement;

  function build() {
    var layer = document.createElement('div'); layer.className = 'fxLayer'; layer.setAttribute('aria-hidden', 'true');
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
    F.veil.style.opacity = '1'; F.logo.style.opacity = '1';
    for (var i = 0; i < F.balls.length; i++) F.balls[i].style.transform = at(F.balls[i], R);
  }

  /* ---------- arriving: start covered, ring turning, then burst once the page is fully loaded ---------- */
  var arriving = false;
  try { arriving = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); } catch (e) {}
  if (arriving) {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type !== 'navigate') arriving = false;   // reloads and back/forward don't get the cover
  }
  if (arriving) {
    var A = build(), t0 = performance.now(), done = false;
    settled(A); A.ring.classList.add('spin');
    html.appendChild(A.layer);   // <body> doesn't exist yet; <html> does
    var far = Math.sqrt(innerWidth * innerWidth + innerHeight * innerHeight) * 0.65;
    var burst = function () {
      if (done) return; done = true;
      setTimeout(function () {
        var jobs = [];
        for (var i = 0; i < A.balls.length; i++) {
          var b = A.balls[i];
          jobs.push(b.animate([{ transform: at(b, R), opacity: 1 }, { transform: at(b, far), opacity: 0 }],
            { duration: BURST_MS, delay: i * 8, easing: 'cubic-bezier(.3,.55,.4,1)', fill: 'forwards' }).finished);
        }
        jobs.push(A.logo.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.1)' }],
          { duration: 300, easing: 'ease-in', fill: 'forwards' }).finished);
        jobs.push(A.veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 120, easing: 'ease-out', fill: 'forwards' }).finished);
        var gone = function () { A.layer.remove(); };
        Promise.all(jobs).then(gone, gone);
        setTimeout(gone, BURST_MS + 600);
      }, Math.max(0, MIN_HOLD - (performance.now() - t0)));
    };
    var ready = function () {   // fully loaded, fonts ready, then two frames so the glass effects have drawn
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      fonts.then(function () { requestAnimationFrame(function () { requestAnimationFrame(burst); }); }, burst);
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
    L.veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out', fill: 'forwards' });
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
