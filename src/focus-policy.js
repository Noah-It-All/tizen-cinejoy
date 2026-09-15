/* Focus-priority policy: what the TV remote is allowed to snap to.
 *
 * Top-down analysis for a streaming catalog (cinejoy.to structure: header
 * nav + search, hero billboard, rows of poster cards, title detail with
 * player + episode grid, filter chips, footer). The old behavior made EVERY
 * link/button focusable, so arrows landed on social icons, carousel
 * chevrons, footer legal links and other micro-chrome — feeling random.
 *
 * Necessary snap targets, in priority order:
 *  1. Search + form fields (header search, selects like season pickers).
 *     Small but essential — always included.
 *  2. Media tiles: anchor-wrapped posters (~150-220px). The primary targets.
 *     Included by rendered size, even without text (posters are often
 *     image-only with alt text).
 *  3. Text-labeled controls in main content: episode buttons ("E12"),
 *     filter chips, "Load more", hero CTAs ("Watch Now"), pagination.
 *     Included by label, even when small.
 *  4. The <video> element itself (OK toggles play; media keys do the rest).
 *  5. Dialog controls (modal close "x") — only while a dialog is open.
 *
 * Always excluded: footer content, ad slots, hidden/disabled elements,
 * aria-hidden subtrees, icon-only micro-buttons (carousel chevrons, social
 * icons, player-bar buttons — media keys + video focus cover the player),
 * and anything the site itself removed from tab order (tabindex="-1").
 *
 * Deliberately NOT class-name based: Svelte compiles to hashed/utility
 * classes that churn every deploy. Geometry + semantics survive rebuilds.
 */

// A tile counts as "large" from this rendered size up (posters are ~150x220).
export var MIN_TILE_W = 64;
export var MIN_TILE_H = 48;
// A visible label from this length up marks a control as meaningful ("E12",
// "Play", "More"; single glyphs like "x" or ">" don't).
export var MIN_LABEL_LEN = 2;

var AD_SELECTORS = '.adsbox,.adsbygoogle,[id^="div-gpt-ad"],.gpt-ad,' +
  '[class*="popunder"],[id*="popunder"]';

function attr(el, name) {
  try { return el.getAttribute(name); } catch (e) { return null; }
}

function closest(el, sel) {
  try { return el.closest ? el.closest(sel) : null; } catch (e) { return null; }
}

function rectOf(el) {
  try {
    if (typeof el.getBoundingClientRect !== 'function') return { w: 0, h: 0, x: 0, y: 0 };
    var r = el.getBoundingClientRect();
    return { w: r.width || 0, h: r.height || 0, x: r.left || 0, y: r.top || 0 };
  } catch (e) {
    return { w: 0, h: 0, x: 0, y: 0 };
  }
}

// Direct (non-inherited) text: containers must not borrow their children's
// words. A 1920px billboard is not a "labeled control" just because a title
// span lives somewhere inside it.
function ownText(el) {
  var s = '';
  try {
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3) s += nodes[i].nodeValue + ' ';
    }
  } catch (e) {}
  return s.trim();
}

function wrapsControls(el) {
  try {
    return !!el.querySelector('a[href],button,input,select,textarea,video,[role="button"],[role="link"]');
  } catch (e) {
    return false;
  }
}

// Interactive tags carry the meaning themselves; containers only count.
var INTERACTIVE_TAGS = { A: 1, BUTTON: 1, INPUT: 1, VIDEO: 1, SELECT: 1, TEXTAREA: 1 };

// Visible label: own text, control value, poster alt, or accessible name.
function labelOf(el) {
  try {
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return ((el.value || '') + ' ' + (attr(el, 'placeholder') || '') + ' ' +
        (attr(el, 'aria-label') || '')).trim();
    }
    var text = (el.textContent || '').trim();
    if (text) return text;
    var img = null;
    try { img = el.querySelector ? el.querySelector('img[alt]') : null; } catch (e) {}
    if (img) {
      var alt = attr(img, 'alt');
      if (alt && alt.trim()) return alt.trim();
    }
    return ((attr(el, 'aria-label') || '') + ' ' + (attr(el, 'title') || '')).trim();
  } catch (e) {
    return '';
  }
}

function isEditableTag(tag, el) {
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    var type = '';
    try { type = (el.type || 'text').toLowerCase(); } catch (e) {}
    return type !== 'hidden' && type !== 'checkbox' && type !== 'radio' &&
      type !== 'button' && type !== 'submit' && type !== 'reset' &&
      type !== 'file' && type !== 'image';
  }
  if (tag === 'BUTTON' && false) return false;
  try { if (el.isContentEditable) return true; } catch (e) {}
  return false;
}

// The decision. `hasLayout` lets callers in layout-less environments (tests,
// SSR) say "no geometry available" so measurable rules are skipped instead
// of nuking everything to zero-size.
export function isNavTarget(el, hasLayout) {
  if (!el || el.nodeType !== 1) return false;
  var tag = '';
  try { tag = (el.tagName || '').toUpperCase(); } catch (e) { return false; }
  var layout = typeof hasLayout === 'boolean' ? hasLayout : true;

  // --- hard excludes ---
  try { if (el.disabled) return false; } catch (e) {}
  if (tag === 'INPUT') {
    try { if ((el.type || '').toLowerCase() === 'hidden') return false; } catch (e) {}
  }
  try { if (el.hasAttribute && el.hasAttribute('hidden')) return false; } catch (e) {}
  if (closest(el, '[aria-hidden="true"]')) return false;
  try {
    var st = el.style;
    if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) return false;
  } catch (e) {}
  // Respect the site's own tab order — unless the -1 is ours (re-evaluate).
  try {
    var ti = attr(el, 'tabindex');
    if (ti !== null && Number(ti) < 0 && !(el.hasAttribute && el.hasAttribute('data-tj-tab'))) return false;
  } catch (e) {}
  if (closest(el, 'footer')) return false;
  try { if (closest(el, AD_SELECTORS)) return false; } catch (e) {}
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') return false;

  // --- hard includes ---
  if (tag === 'VIDEO') return true;
  if (isEditableTag(tag, el)) return true;
  // Sliders are the only keyboard path for scrub/volume (the player renders
  // the visible progress bar as a div; the range input underneath is the
  // operable control). Always reachable — arrow pass-through is handled in
  // tv.js so Left/Right adjusts instead of moving focus away.
  try {
    if (tag === 'INPUT' && (el.type || '').toLowerCase() === 'range') return true;
  } catch (e) {}
  // Our floating search button only when actually shown (it reports 0x0 and
  // would otherwise be an invisible focus trap when hidden).
  try {
    if (el.id === 'tj-tv-search-btn') {
      if (el.classList && el.classList.contains('tj-show')) return true;
      // hidden: fall through to the normal rules (zero-size demotes it)
    }
  } catch (e) {}

  // Player zone: controls around a <video> (marked data-tj-player by tv.js).
  // Icon-only 40px buttons (play, subtitles, settings, PiP…) are the whole
  // UI here — the speck/label gates below must not eat them. Still respects
  // disabled/hidden/tabindex/aria-hidden above.
  // Same for our TV keyboard (#tj-kb[data-tj-kb]): single-char keys ("A")
  // would fail the MIN_LABEL_LEN gate, so approve by zone.
  var inPlayer = !!closest(el, '[data-tj-player]');
  var inKb = !!closest(el, '[data-tj-kb]');
  if ((inPlayer && (tag === 'BUTTON' || tag === 'SELECT' ||
      attr(el, 'role') === 'button' || attr(el, 'role') === 'slider' ||
      (tag === 'INPUT' && (attr(el, 'type') || 'text').toLowerCase() !== 'hidden'))) ||
      (inKb && (tag === 'BUTTON' || attr(el, 'role') === 'button'))) {
    var pr = rectOf(el);
    if (layout && pr.w <= 1 && pr.h <= 1) return false;
    return true;
  }

  var navigable = tag === 'A' || tag === 'BUTTON' || tag === 'SELECT' ||
    attr(el, 'role') === 'button' || attr(el, 'role') === 'link' ||
    attr(el, 'role') === 'option' || attr(el, 'role') === 'tab' ||
    (attr(el, 'tabindex') !== null && Number(attr(el, 'tabindex')) >= 0);
  if (!navigable) return false;

  // Dialog controls matter while a dialog is open (e.g. modal close "x").
  if (closest(el, '[role="dialog"],[role="alertdialog"],.modal')) return true;

  var interactive = !!INTERACTIVE_TAGS[tag] ||
    attr(el, 'role') === 'button' || attr(el, 'role') === 'link';

  // Containers are never snap targets by default — not section headings, not
  // rails, not billboards. Exception: a deliberate leaf tile (site-tabbed,
  // click-affordance, no wrapped controls). Our own past additions
  // (data-tj-added) re-qualify through the same gate, never by tabindex alone.
  if (!interactive) {
    var tabAttr = attr(el, 'tabindex');
    if (tabAttr === null || Number(tabAttr) < 0) return false;
    if (wrapsControls(el)) return false;
    var clickable = false;
    try {
      clickable = !!attr(el, 'onclick') || (el.style && el.style.cursor === 'pointer');
      if (!clickable && typeof window.getComputedStyle === 'function') {
        clickable = window.getComputedStyle(el).cursor === 'pointer';
      }
    } catch (e) {}
    if (!clickable) return false;
  }

  var r = rectOf(el);
  var measured = layout && (r.w > 0 || r.h > 0);

  // With real layout, zero-size means invisible (or an empty shell) — never
  // a snap target. (Without layout we cannot judge; see the fallback below.)
  if (layout && r.w <= 1 && r.h <= 1) return false;

  // Containers may only spend their OWN words (direct text + accessible
  // name + a leaf poster's alt), never descendants'. Interactive elements
  // keep full subtree text (tile titles) and poster alt text — handled below.
  // A container needs BOTH a label and tile size: size alone would bless
  // empty clickable shells and section blocks.
  if (!interactive) {
    var leafAlt = '';
    try {
      var poster = el.querySelector ? el.querySelector('img[alt]') : null;
      if (poster) leafAlt = attr(poster, 'alt') || '';
    } catch (e) {}
    var clen = (ownText(el) + ' ' + (attr(el, 'aria-label') || '') + ' ' +
      (attr(el, 'title') || '') + ' ' + leafAlt).trim().length;
    if (clen < MIN_LABEL_LEN) return false;
    var cr = rectOf(el);
    if (layout && (cr.w > 0 || cr.h > 0)) return cr.w >= MIN_TILE_W && cr.h >= MIN_TILE_H;
    return true; // no geometry to judge by — keep, like interactive elements
  }

  var labelLen = labelOf(el).length;

  // Text-labeled controls: episode buttons, chips, CTAs, pagination.
  // ...unless they are specks (carousel dots, thumbs): labeled but smaller
  // than 40px in both dimensions is decoration — except in the top bar
  // (y < 120: back buttons, icon nav; cinejoy uses divs, not <header>, so
  // the header check alone misses it) and dialogs, where small icon
  // buttons are the whole navigation.
  if (labelLen >= MIN_LABEL_LEN) {
    var inTopBar = measured && r.y < 120;
    if (measured && r.w < 40 && r.h < 40 && !inTopBar &&
        !closest(el, 'header') && !closest(el, '[role="dialog"],[role="alertdialog"],.modal') &&
        tag !== 'INPUT' && tag !== 'VIDEO') return false;
    return true;
  }

  // Large tiles: poster cards, hero art, big buttons — even image-only.
  if (measured) return r.w >= MIN_TILE_W && r.h >= MIN_TILE_H;

  // No geometry to judge by (jsdom/tests): keep semantic candidates so we
  // never nuke what we cannot measure. Real browsers always have layout.
  return true;
}
