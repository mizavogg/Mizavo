/* Mizavo — page transition "Cover sheet" (Nov 11, 2026; modeled on the Blush SD "Blush Veil").
   1. Click a link to another Mizavo page: a dark sheet with a soft copper glow slides up over the screen,
      the Mizavo logo appears, then the browser goes to the new page.
   2. The new page starts fully covered and stays covered until it has completely loaded (images, fonts,
      the glass effects' first frame), so nothing is ever seen loading in. If that takes more than half a
      second, three game balls bounce under the logo.
   3. The sheet lifts away upward and the page is there.
   vite.config.ts copies this file into the <head> of every page at build time (the logo is built in), so the
   cover is up on the very first frame. Not used for other sites, new tabs, downloads, same-page links, or with
   reduce-motion on. If anything goes wrong, the cover always clears itself within 3 seconds. Silent. */
(function () {
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce || !Element.prototype.animate) return;

  var COVER_MS = 380, REVEAL_MS = 620, MIN_HOLD = 180, MAX_HOLD = 3000, KEY = 'mzCover';
  var EASE_IN = 'cubic-bezier(.7,0,.25,1)', EASE_OUT = 'cubic-bezier(.65,0,.3,1)';
  var html = document.documentElement;

  function build(covered) {
    var layer = document.createElement('div');
    layer.className = 'fxLayer'; layer.setAttribute('aria-hidden', 'true');
    var sheet = document.createElement('div'); sheet.className = 'fxSheet';
    var logo = document.createElement('img'); logo.className = 'fxLogo'; logo.alt = ''; logo.src = '__FX_LOGO__';
    var dots = document.createElement('div'); dots.className = 'fxDots';
    dots.innerHTML = '<i></i><i></i><i></i>';
    sheet.appendChild(logo); sheet.appendChild(dots); layer.appendChild(sheet);
    if (covered) { sheet.style.transform = 'none'; logo.style.opacity = '1'; }
    return { layer: layer, sheet: sheet, logo: logo, dots: dots };
  }

  /* ---------- arriving: start covered, wait until the page is fully loaded, then lift the sheet ---------- */
  var arriving = false;
  try { arriving = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); } catch (e) {}
  if (arriving) {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type !== 'navigate') arriving = false;   // reloads and back/forward don't get the sheet
  }
  if (arriving) {
    var A = build(true), t0 = performance.now(), lifted = false;
    html.appendChild(A.layer);                                 // <body> doesn't exist yet; <html> does
    A.dots.classList.add('wait');                              // the bouncing balls only show after 0.5 s (CSS delay)
    var lift = function () {
      if (lifted) return; lifted = true;
      var hold = Math.max(0, MIN_HOLD - (performance.now() - t0));
      setTimeout(function () {
        A.dots.classList.remove('wait');
        A.logo.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
        var a = A.sheet.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-112%)' }], { duration: REVEAL_MS, delay: 60, easing: EASE_OUT, fill: 'forwards' });
        var gone = function () { A.layer.remove(); };
        a.finished.then(gone, gone);
        setTimeout(gone, REVEAL_MS + 400);
      }, hold);
    };
    var ready = function () {   // fully loaded, fonts ready, then two frames so the glass effects have drawn
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      fonts.then(function () { requestAnimationFrame(function () { requestAnimationFrame(lift); }); }, lift);
    };
    if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready, { once: true });
    setTimeout(lift, MAX_HOLD);   // safety net: never leave the cover up
  }

  /* ---------- leaving: cover the screen, then go ---------- */
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
    var L = build(false);
    (document.body || html).appendChild(L.layer);
    L.sheet.animate([{ transform: 'translateY(112%)' }, { transform: 'translateY(0)' }], { duration: COVER_MS, easing: EASE_IN, fill: 'forwards' });
    L.logo.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: COVER_MS - 120, easing: 'ease-out', fill: 'forwards' });
    try { sessionStorage.setItem(KEY, '1'); } catch (er) {}
    setTimeout(function () { location.href = href; }, COVER_MS + 40);
  }, false);
  // coming back with the back button (page restored from memory): make sure no sheet is left over
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { leaving = false; var l = document.querySelectorAll('.fxLayer'); for (var i = 0; i < l.length; i++) l[i].remove(); }
  });
})();
