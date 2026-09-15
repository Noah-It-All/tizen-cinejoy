/* Tizen-CineJoy — TizenBrew site-modification script for https://cinejoy.to/
 *
 * Injected by TizenBrew (packageType "mods", see ../package.json) via:
 *   fetch(`https://cdn.jsdelivr.net/<npm-name>/<main>`) + Runtime.evaluate
 * following the TizenTube pattern (reisxd/TizenTube, mods/userScript.js).
 *
 * What it does:
 *  - Polyfills old Tizen browsers (Chrome 47) so the SvelteKit site boots.
 *  - Adblocking: ad-host fetch/XHR/beacon blocks, popunder blocking,
 *    injected ad script/iframe removal, cosmetic ad CSS.
 *  - Full remote support: arrows/OK/Back + media + color + channel + numbers.
 *  - Working keyboard search: IME-safe, physical-keyboard-safe, Enter submits,
 *    GREEN focuses search from anywhere.
 */
import './compat.js';
import './domrect-polyfill.js';
import './spatial-navigation-polyfill.js';
import 'whatwg-fetch';
import 'core-js/proposals/object-getownpropertydescriptors';
import css from './ui.css';
import { initAds } from './ads.js';
import { initTV } from './tv.js';

(function boot() {
  // Only run on cinejoy hosts (and localhost during dev).
  try {
    var host = window.location.hostname || '';
    if (host.indexOf('cinejoy') === -1 && host !== 'localhost' && host !== '127.0.0.1') return;
  } catch (e) {}

  function injectCss() {
    try {
      var existing = document.querySelector('style[data-tj]');
      if (existing) return;
      var style = document.createElement('style');
      style.setAttribute('data-tj', '1');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (e) {}
  }

  function ready(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(fn, 0);
    } else {
      document.addEventListener('DOMContentLoaded', function onReady() {
        document.removeEventListener('DOMContentLoaded', onReady);
        fn();
      });
      // Safety: SPA shell may never fire it on old webkit.
      setTimeout(fn, 2500);
    }
  }

  var booted = false;
  function start() {
    if (booted) return;
    // Document-start injection can run before <html> exists; retry instead
    // of throwing (a single early throw used to kill the whole bundle).
    try {
      if (!document.documentElement) return setTimeout(start, 100);
    } catch (e) { return setTimeout(start, 100); }
    booted = true;
    injectCss();
    try {
      initAds(); // network hooks first, before the SPA pulls ad scripts
    } catch (e) {
      console.error('[tj] ads init failed', e);
    }
    try {
      initTV();
    } catch (e) {
      console.error('[tj] init failed', e);
    }
  }

  // SvelteKit hydrates async; start on DOM ready and re-assert CSS on nav.
  ready(start);
  setTimeout(start, 3500);
  window.addEventListener('load', function () { injectCss(); });
})();
