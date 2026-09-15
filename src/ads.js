/* Generic adblocking for CineJoy (cinejoy.to).
 *
 * The static app shell references no ad network directly (only Plausible
 * analytics + Cloudflare beacon), but free-streaming aggregators of this kind
 * overwhelmingly monetize at runtime: popunders, banner/pop ad scripts and
 * ad iframes injected by the player/mirror pages. This module blocks those
 * generically without touching video traffic:
 *
 *  1. Network: fetch/XHR/sendBeacon to known ad hosts -> benign empty result.
 *  2. Popunders: window.open blocked unless it comes from a focused link/button
 *     AND the target is not an ad URL (owns the blocker previously in tv.js).
 *  3. Injected nodes: external <script>/<iframe> with ad-host src removed.
 *  4. Cosmetic: well-known ad-container selectors hidden via CSS.
 *
 * Deliberately NOT blocked: video CDNs, the site's own API, analytics pixels
 * that ride on first-party endpoints. Pre-roll/VAST inside third-party player
 * iframes cannot be skipped generically — report what you actually see and we
 * can target it.
 */

import { AD_HOSTS } from './ad-hosts.js';

var AD_URL_PATTERN = /atOptions|popunder|popads|pops\.js|epom|shorte\.st|ouo\.io|linkshrink/i;

function getHost(url) {
  try {
    var u = url;
    if (u.indexOf('//') === 0) u = 'http:' + u;
    var m = /^https?:\/\/([^\/:?#]+)/i.exec(u);
    return m ? m[1].toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

export function isAdUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  // Only inspect absolute remote URLs — never first-party/relative traffic.
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0 && url.indexOf('//') !== 0) return false;
  var host = getHost(url);
  if (host) {
    for (var i = 0; i < AD_HOSTS.length; i++) {
      var h = AD_HOSTS[i];
      if (host === h || host.slice(-h.length - 1) === '.' + h) return true;
    }
  }
  if (AD_URL_PATTERN.test(url)) return true;
  return false;
}

function emptyFetchResponse() {
  try {
    return Promise.resolve(new Response('', { status: 204, statusText: 'Blocked' }));
  } catch (e) {
    // Ancient WebKit without Response constructor: reject; callers on this
    // site treat it as a failed ad load, which is the desired outcome.
    return Promise.reject(new Error('blocked'));
  }
}

function patchFetch() {
  try {
    var originalFetch = window.fetch;
    if (!originalFetch || originalFetch.__tjPatched) return;
    var wrapped = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isAdUrl(url)) {
        console.warn('[tj-ads] blocked fetch:', url);
        return emptyFetchResponse();
      }
      return originalFetch.apply(this, arguments);
    };
    wrapped.__tjPatched = true;
    window.fetch = wrapped;
  } catch (e) {}
}

function patchXhr() {
  try {
    if (!window.XMLHttpRequest || window.XMLHttpRequest.prototype.open.__tjPatched) return;
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var patched = function (method, url) {
      if (isAdUrl(url)) {
        console.warn('[tj-ads] blocked XHR:', url);
        arguments[1] = 'data:,';
      }
      return originalOpen.apply(this, arguments);
    };
    patched.__tjPatched = true;
    window.XMLHttpRequest.prototype.open = patched;
  } catch (e) {}
}

function patchBeacon() {
  try {
    if (!navigator.sendBeacon || navigator.sendBeacon.__tjPatched) return;
    var originalBeacon = navigator.sendBeacon;
    var patched = function (url) {
      if (isAdUrl(url)) {
        console.warn('[tj-ads] blocked beacon:', url);
        return true; // lie: report "sent" so callers move on
      }
      return originalBeacon.apply(this, arguments);
    };
    patched.__tjPatched = true;
    navigator.sendBeacon = patched;
  } catch (e) {}
}

function patchWindowOpen() {
  try {
    if (window.open.__tjPatched) return;
    var originalOpen = window.open;
    var patched = function (url) {
      var target = typeof url === 'string' ? url : '';
      var ae = null;
      try { ae = document.activeElement; } catch (e) {}
      var fromContent = ae && (ae.tagName === 'A' || ae.tagName === 'BUTTON');
      if (!fromContent || isAdUrl(target)) {
        console.warn('[tj-ads] blocked popup:', target || '(empty)');
        return null;
      }
      return originalOpen.apply(window, arguments);
    };
    patched.__tjPatched = true;
    window.open = patched;
  } catch (e) {}
}

function killAdNodes(root) {
  var nodes;
  try {
    nodes = (root || document).querySelectorAll('script[src], iframe[src]');
  } catch (e) { return; }
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    try {
      var src = el.getAttribute('src') || '';
      if (src && isAdUrl(src)) {
        console.warn('[tj-ads] removed node:', el.tagName, src);
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    } catch (e) {}
  }
}

/* One rule hiding well-known ad slots. Deliberately tight: never matches
 * generic .banner/.hero/.container classes the catalog UI itself may use. */
var ADS_CSS =
  '.adsbygoogle, .adsbox, #adsbox, [id^="div-gpt-ad"], .gpt-ad,' +
  'iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"],' +
  'iframe[src*="adsterra"], iframe[src*="popads"], iframe[src*="monetag"],' +
  'iframe[src*="propeller"], iframe[src*="exoclick"],' +
  '[class*="popunder"], [id*="popunder"],' +
  'a[href*="adsterra"], a[href*="popads"], a[href*="monetag"]' +
  '{ display: none !important; }';

export function initAds() {
  patchFetch();
  patchXhr();
  patchBeacon();
  patchWindowOpen();
  killAdNodes(document);

  try {
    if (!document.querySelector('style[data-tj-ads]')) {
      var style = document.createElement('style');
      style.setAttribute('data-tj-ads', '1');
      style.textContent = ADS_CSS;
      (document.head || document.documentElement).appendChild(style);
    }
  } catch (e) {}

  // childList-only (same lesson as tv.js/search-fix.js: never observe the
  // attributes you write). Removal is one-shot, so no feedback loop.
  try {
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (!node || node.nodeType !== 1) continue;
          if (node.tagName === 'SCRIPT' || node.tagName === 'IFRAME') {
            var src = (node.getAttribute && node.getAttribute('src')) || '';
            if (src && isAdUrl(src)) {
              console.warn('[tj-ads] removed node:', node.tagName, src);
              try { if (node.parentNode) node.parentNode.removeChild(node); } catch (e) {}
            }
          } else if (node.querySelectorAll) {
            killAdNodes(node);
          }
        }
      }
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch (e) {}
}
