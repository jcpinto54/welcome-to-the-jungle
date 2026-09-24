'use strict';
/* pwa.js: registers the offline service worker (sw.js) when that is safe. Loaded last.
   PWA.skipReason(win) -> '' when the worker may be registered, else why not:
     'unsupported'  no navigator.serviceWorker (old browser, insecure origin)
     'protocol'     not http(s): file://, or an app wrapper like capacitor://
     'iframe'       embedded (the single-file build runs in a frame where workers can't)
     'localhost'    a dev server; add #sw to the URL to opt in
   PWA.register(win) -> promise of the registration or null; never throws. */
const PWA = (() => {
  // sw.js sits next to index.html, one folder up from this script.
  let script = '';
  try { script = (document.currentScript && document.currentScript.src) || ''; } catch (e) { /* not a page */ }

  const LOCAL = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$|\.localhost$/i;
  const hashFlags = (hash) => String(hash || '').replace(/^#/, '').split(/[&,]/);

  function framed(win) {
    try { return win.self !== win.top; } catch (e) { return true; }
  }

  function skipReason(win) {
    try {
      const nav = win.navigator, loc = win.location;
      if (!nav || !('serviceWorker' in nav)) return 'unsupported';
      if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return 'protocol';
      if (framed(win)) return 'iframe';
      if (LOCAL.test(loc.hostname) && !hashFlags(loc.hash).includes('sw')) return 'localhost';
      return '';
    } catch (e) {
      return 'error';
    }
  }

  function swUrl(win) {
    return script ? new URL('../sw.js', script).href : new URL('sw.js', win.location.href).href;
  }

  function register(win) {
    try {
      if (win === undefined && typeof window !== 'undefined') win = window;
      if (!win || skipReason(win)) return Promise.resolve(null);
      return Promise.resolve(win.navigator.serviceWorker.register(swUrl(win))).catch((e) => {
        console.warn('[pwa] offline cache unavailable:', e && e.message);
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // After load, so the precache doesn't compete with the game for the network.
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (document.readyState === 'complete') register(window);
      else window.addEventListener('load', () => register(window), { once: true });
    }
  } catch (e) { /* never break the page over an offline cache */ }

  return { skipReason, swUrl, register };
})();
