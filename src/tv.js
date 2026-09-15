/* TV remote + focus + video handling for CineJoy.
 * Pattern follows TizenTube's mods/ui/ui.js: disable the spatial-nav polyfill's
 * own key handler (keyMode NONE) and drive navigate() ourselves so text fields
 * keep native editing while everything else is arrow-navigable.
 */
/*global navigate*/
import { isEditable, isTextEditable, initSearchFix } from './search-fix.js';
import { isNavTarget } from './focus-policy.js';
import { rebuildRows, rememberFocus, moveInRow, moveAcrossRows, focusPlayerControl } from './rows.js';
import {
  ensureKeyboardDom, isKeyboardKey, isKeyboardVisible, showKeyboardFor,
  hideKeyboard, getKbTarget, setKbTarget, moveKb, activateFocusedKbKey,
  focusFirstKbKey,
} from './keyboard.js';

var toastTimer = null;

export function ensureToastDom() {
  var el = document.getElementById('tj-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tj-toast';
    el.setAttribute('role', 'status');
    try { document.body.appendChild(el); } catch (e) {}
  }
  return el;
}

export function showToast(title, subtitle) {
  try {
    var el = ensureToastDom();
    el.textContent = subtitle ? (title + ' — ' + subtitle) : title;
    el.classList.add('tj-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      try { el.classList.remove('tj-show'); } catch (e) {}
    }, 3200);
  } catch (e) {}
}

function ensureHelpDom() {
  var el = document.getElementById('tj-help');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'tj-help';
  el.innerHTML =
    '<div class="tj-card" tabindex="0">' +
    '<h2>CineJoy TV Remote</h2>' +
    '<p><kbd>◀▲▼▶</kbd> Move &nbsp; <kbd>OK</kbd> Select / Play-Pause (on video)</p>' +
    '<p><kbd>Return</kbd> Back (press twice in search) &nbsp; <kbd>Exit</kbd> Back</p>' +
    '<p><kbd style="background:#a00">R</kbd> Home &nbsp; ' +
    '<kbd style="background:#0a0">G</kbd> Search &nbsp; ' +
    '<kbd style="background:#aa0">Y</kbd> This help &nbsp; ' +
    '<kbd style="background:#00a">B</kbd> Fullscreen video</p>' +
    '<p><kbd>⏯ ▶ ⏸ ■</kbd> Play / Pause / Stop &nbsp; <kbd>⏩ ⏪</kbd> ±10s &nbsp; <kbd>0</kbd>–<kbd>9</kbd> Jump to %</p>' +
    '<p><kbd>CH ▲▼</kbd> Scroll page</p>' +
    '<p>Search: <kbd>G</kbd> or top-bar magnifier, then <kbd>▼</kbd> into the TV keyboard — ' +
    'arrows move, <kbd>OK</kbd> types, <kbd>▲</kbd> back to the field, <kbd>Done</kbd> jumps to results.</p>' +
    '<p>Type with a USB keyboard or the TV keyboard. In the field: <kbd>←→</kbd> move cursor, ' +
    '<kbd>▼</kbd> keyboard, <kbd>▲</kbd> top bar, <kbd>Return</kbd> closes keyboard first.</p>' +
    '<p class="tj-close-hint">Press YELLOW / Return / OK to close</p>' +
    '</div>';
  try { document.body.appendChild(el); } catch (e) {}
  return el;
}

function toggleHelp(force) {
  var el = ensureHelpDom();
  var show = typeof force === 'boolean' ? force : !el.classList.contains('tj-show');
  if (show) {
    el.classList.add('tj-show');
    try {
      var card = el.querySelector('.tj-card');
      if (card) card.focus();
    } catch (e) {}
  } else {
    el.classList.remove('tj-show');
  }
  return show;
}

function ensureSearchBtnDom() {
  var btn = document.getElementById('tj-tv-search-btn');
  if (btn) return btn;
  btn = document.createElement('button');
  btn.id = 'tj-tv-search-btn';
  btn.setAttribute('aria-label', 'Search');
  btn.setAttribute('tabindex', '0');
  btn.textContent = '⌕';
  btn.addEventListener('click', function () {
    try {
      if (window.__tjFocusSearch) window.__tjFocusSearch();
    } catch (e) {}
  });
  try { document.body.appendChild(btn); } catch (e) {}
  return btn;
}

// Candidates for arrow navigation. The focus-policy decides; this is just the
// widest net (the polyfill snaps to tabIndex>=0, so demotion = tabindex -1).
var CANDIDATE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), video, [role="button"], [role="link"], [role="option"], ' +
  '[role="tab"], [tabindex]';

function approveEl(el) {
  try {
    if (!el.classList.contains('tj-focusable')) el.classList.add('tj-focusable');
    // Restore anything we previously demoted.
    if (el.hasAttribute('data-tj-tab')) {
      var orig = el.getAttribute('data-tj-tab');
      el.removeAttribute('data-tj-tab');
      if (orig) el.setAttribute('tabindex', orig);
      else el.removeAttribute('tabindex');
    }
    // Ensure the target is actually reachable: tiles are often plain divs.
    if (el.tabIndex < 0) {
      if (!el.hasAttribute('data-tj-added')) el.setAttribute('data-tj-added', '1');
      el.setAttribute('tabindex', '0');
    }
  } catch (e) {}
}

function demoteEl(el) {
  try {
    if (el.classList.contains('tj-focusable')) el.classList.remove('tj-focusable');
    // Undo our own additions entirely.
    if (el.hasAttribute('data-tj-added')) {
      el.removeAttribute('data-tj-added');
      el.removeAttribute('tabindex');
      // Fall through to blur check below (it may still hold stale focus).
    } else {
      // Park natively-focusable junk at tabindex -1 (polyfill skips tabIndex<0),
      // remembering the original so approval restores it.
      var cur = el.getAttribute('tabindex');
      if ((cur !== null && Number(cur) >= 0) || (cur === null && el.tabIndex >= 0)) {
        if (!el.hasAttribute('data-tj-tab')) {
          el.setAttribute('data-tj-tab', cur === null ? '' : cur);
        }
        el.setAttribute('tabindex', '-1');
      }
    }
    // Never leave focus stranded on a demoted element (early-hydration
    // containers often grab it first): drop to body so the next pass lands
    // on a real tile. Editable elements and video are exempt — blurring
    // mid-typing would slam the IME shut.
    try {
      if (document.activeElement === el) {
        var tag = (el.tagName || '').toUpperCase();
        var editable = tag === 'VIDEO' || tag === 'INPUT' || tag === 'TEXTAREA' ||
          tag === 'SELECT' || el.isContentEditable;
        if (!editable && el.blur) el.blur();
      }
    } catch (e) {}
  } catch (e) {}
}

export function makeFocusable(root) {
  root = root || document;
  markPlayerZones();
  var nodes;
  try { nodes = root.querySelectorAll(CANDIDATE_SELECTOR); }
  catch (e) { return; }
  // No layout engine (tests/SSR) reports clientWidth 0 — policy then uses
  // semantic rules only instead of nuking everything it cannot measure.
  var hasLayout = false;
  try {
    hasLayout = !!(document.documentElement && document.documentElement.clientWidth > 0);
  } catch (e) {}
  // Phase 1: decide (reads only, no forced re-layouts interleaved)...
  var approve = [];
  var demote = [];
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (isNavTarget(el, hasLayout)) approve.push(el);
    else demote.push(el);
  }
  // Phase 2: ...then write.
  for (var a = 0; a < approve.length; a++) approveEl(approve[a]);
  // Phase 3: containers don't get focus — their tiles do. A hero billboard
  // or rail div that contains approved targets is itself demoted (links and
  // buttons are exempt: a card anchor stays the tile even if it wraps an
  // approved overlay control).
  for (var c = 0; c < approve.length; c++) {
    try {
      var tagC = (approve[c].tagName || '').toUpperCase();
      if (tagC === 'A' || tagC === 'BUTTON' || tagC === 'INPUT' ||
          tagC === 'VIDEO' || tagC === 'SELECT' || tagC === 'TEXTAREA') continue;
      if (approve[c].querySelector('.tj-focusable')) demoteEl(approve[c]);
    } catch (e) {}
  }
  for (var d = 0; d < demote.length; d++) demoteEl(demote[d]);
}

// Mark the containers around each <video> as player zones (data-tj-player).
// The focus policy uses this to approve icon-only player controls (play,
// subtitles, settings, sliders…) that the generic speck rules would eat.
// Geometric, not class-based: the direct parent holds the whole custom
// control bar (video + ~12 buttons), the grandparent is the page-level
// player shell on watch routes (no video exists on catalog pages, so this
// is a no-op there). Also guarantees the video itself is keyboard-focusable
// (custom players omit controls/tabindex, so .focus() silently fails).
function markPlayerZones() {
  var vids;
  try { vids = document.querySelectorAll('video'); }
  catch (e) { return; }
  for (var i = 0; i < vids.length; i++) {
    var v = vids[i];
    try {
      // Attribute-based: for media elements the tabIndex *property* may read
      // 0 while .focus() still fails — only an explicit tabindex attribute
      // makes <video> keyboard-focusable (verified live).
      if (!v.hasAttribute('tabindex')) v.setAttribute('tabindex', '0');
    } catch (e) {}
    try {
      var p = v.parentElement;
      var depth = 0;
      while (p && depth < 2) {
        if (!p.hasAttribute('data-tj-player')) p.setAttribute('data-tj-player', '1');
        p = p.parentElement;
        depth++;
      }
    } catch (e) {}
  }
}

// Wake an auto-hiding player UI: custom players fade the control bar on
// idle and only show it on pointer activity. A remote arrow press should
// count as activity, or focus moves to invisible controls.
function wakePlayer() {
  try {
    var zone = document.querySelector('[data-tj-player]');
    var target = zone || activeVideo() || document;
    var ev;
    try {
      ev = new MouseEvent('mousemove', { bubbles: true, cancelable: true });
    } catch (e) {
      ev = document.createEvent('Event');
      ev.initEvent('mousemove', true, true);
    }
    (zone || document).dispatchEvent(ev);
    if (target !== document && target !== zone) {
      try { target.dispatchEvent(ev); } catch (e) {}
    }
  } catch (e) {}
}

function isRangeSlider(el) {
  try {
    return !!el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'range';
  } catch (e) {
    return false;
  }
}

function activeVideo() {
  try {
    var vids = document.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (v && v.readyState > 0 && !v.ended) return v;
    }
    if (vids.length) return vids[0];
  } catch (e) {}
  return null;
}

function togglePlay(v) {
  v = v || activeVideo();
  if (!v) return false;
  try {
    if (v.paused) v.play();
    else v.pause();
    return true;
  } catch (e) { return false; }
}

function seekBy(sec) {
  var v = activeVideo();
  if (!v) return false;
  try {
    var d = isFinite(v.duration) ? v.duration : null;
    var t = v.currentTime + sec;
    if (t < 0) t = 0;
    if (d && t > d - 2) t = d - 2;
    v.currentTime = t;
    showToast((sec >= 0 ? '+' : '') + sec + 's');
    return true;
  } catch (e) { return false; }
}

function seekToFraction(f) {
  var v = activeVideo();
  if (!v) return false;
  try {
    if (!isFinite(v.duration) || !v.duration) return false;
    v.currentTime = v.duration * f;
    showToast(Math.round(f * 100) + '%');
    return true;
  } catch (e) { return false; }
}

function toggleFullscreen() {
  var v = activeVideo();
  var target = v || document.documentElement;
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return true;
    }
    if (target.requestFullscreen) target.requestFullscreen();
    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
    else if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    else if (v) { try { v.focus(); } catch (e) {} return true; }
    return true;
  } catch (e) { return false; }
}

function goHome() {
  try { window.location.href = '/'; }
  catch (e) { try { window.location.assign('/'); } catch (e2) {} }
}

function goBack() {
  // Close help first
  try {
    var help = document.getElementById('tj-help');
    if (help && help.classList.contains('tj-show')) {
      toggleHelp(false);
      return;
    }
  } catch (e) {}
  // If something overlay-ish has focus, blur it first
  try {
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) {
      var tag = (ae.tagName || '').toUpperCase();
      if (tag !== 'BODY' && tag !== 'HTML') {
        // Don't trap the user: blur once, only go back if body already focused
        // (search inputs handle their own double-Return, so skip them here).
        if (!isEditable(ae)) ae.blur();
      }
    }
  } catch (e) {}
  try {
    if (window.history.length > 1) window.history.back();
    else goHome();
  } catch (e) { goHome(); }
}

var NAV_KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

function handleKey(evt) {
  var type = evt.type;
  if (type !== 'keydown' && type !== 'keypress') return true;
  // Only act on keydown to avoid double handling (keypress mirrors it).
  if (type !== 'keydown') return true;

  var kc = evt.keyCode || evt.which;
  var key = evt.key;
  var ae = null;
  try { ae = document.activeElement; } catch (e) {}
  var editing = isEditable(ae);
  var textEditing = isTextEditable(ae);

  // IME composition: never interfere.
  if (kc === 229 || evt.isComposing) return true;

  // --- Arrows: row-aware first (Netflix feel), polyfill as fallback ---
  if (kc in NAV_KEYS) {
    var dir0 = NAV_KEYS[kc];
    // Inside the TV keyboard: grid navigation. Up off the top row returns
    // to the search field; Down off the last row goes to results.
    var inKb = false;
    try { inKb = isKeyboardKey(ae); } catch (e) {}
    if (inKb) {
      try { evt.preventDefault(); } catch (e) {}
      try { evt.stopPropagation(); } catch (e) {}
      var handled = false;
      try { handled = moveKb(dir0); } catch (e) {}
      if (handled) return false;
      if (dir0 === 'up') {
        var tgt = null;
        try { tgt = getKbTarget(); } catch (e) {}
        if (tgt) {
          try { tgt.focus({ preventScroll: true }); } catch (e) { try { tgt.focus(); } catch (e2) {} }
          return false;
        }
      } else if (dir0 === 'down') {
        try {
          var pick = null;
          var links = document.querySelectorAll('a[href]');
          for (var li = 0; li < links.length; li++) {
            try {
              var lr = links[li].getBoundingClientRect();
              if (lr.width >= 64 && lr.height >= 48) { pick = links[li]; break; }
            } catch (e) {}
          }
          if (pick) {
            try { pick.focus({ preventScroll: true }); } catch (e) { try { pick.focus(); } catch (e2) {} }
            return false;
          }
        } catch (e) {}
      }
      try { navigate(dir0); } catch (e) {}
      return false;
    }
    // Search field exits (the "stuck in the search box" fix): Left/Right
    // stay native for cursor movement, but Up/Down must leave — natively
    // they do nothing inside an <input>, trapping the remote.
    //  - Down: into the TV keyboard (shown on demand).
    //  - Up: back to the top bar / previous control via normal navigation.
    if (textEditing) {
      if (kc === 37 || kc === 39) return true; // cursor movement
      try { evt.preventDefault(); } catch (e) {}
      try { evt.stopPropagation(); } catch (e) {}
      if (dir0 === 'down') {
        try {
          var inp = ae;
          showKeyboardFor(inp);
          makeFocusable(document);
          if (focusFirstKbKey()) return false;
        } catch (e) {}
        try { navigate(dir0); } catch (e) {}
        return false;
      }
      // Up (and any other arrow here): leave the field via row/polyfill nav.
      // NOTE: do NOT blur first — moveAcrossRows/navigate read
      // document.activeElement for geometry, and blurring drops it to BODY
      // (full-page rect), which misroutes (e.g. Up landing below). Focusing
      // the new target auto-blurs the field.
      try {
        if (moveAcrossRows(dir0)) return false;
      } catch (e) {}
      try { navigate(dir0); } catch (e) {}
      return false;
    }
    // Scrub/volume sliders: Left/Right adjusts natively (native range keys
    // fire input/change, so the custom player UI follows). Up/Down falls
    // through to navigation so focus can leave — otherwise a focus trap.
    if (isRangeSlider(ae) && (kc === 37 || kc === 39)) return true;
    if (editing && (kc === 37 || kc === 39)) {
      return true; // e.g. SELECT dropdowns
    }
    // Focused video behaves like a native TV player: Left/Right scrubs ±10s
    // and stays on the video, Up/Down drops into the control bar (play,
    // skip, subtitles, settings…).
    var onVideo = false;
    try { onVideo = !!ae && ae.tagName === 'VIDEO'; } catch (e) {}
    if (onVideo) {
      try { evt.preventDefault(); } catch (e) {}
      try { evt.stopPropagation(); } catch (e) {}
      wakePlayer();
      if (kc === 37) { seekBy(-10); return false; }
      if (kc === 39) { seekBy(10); return false; }
      try { if (focusPlayerControl()) return false; } catch (e) {}
      // No focusable bar (edge case): fall through to the polyfill.
    } else if (activeVideo()) {
      // Keep the auto-hiding player UI awake while arrow-navigating it.
      try { wakePlayer(); } catch (e) {}
    }
    try { evt.preventDefault(); } catch (e) {}
    try { evt.stopPropagation(); } catch (e) {}
    var dir = NAV_KEYS[kc];
    try {
      // Left/Right stay inside rails (clamped at the ends); Up/Down hops
      // rows with focus memory. Outside rows these return false and the
      // free-2D polyfill takes over (header, hero, dialogs).
      if (dir === 'left' || dir === 'right') {
        if (moveInRow(dir)) return false;
      } else {
        if (moveAcrossRows(dir)) return false;
      }
    } catch (e) {}
    try { navigate(dir); } catch (e) {}
    return false;
  }

  switch (kc) {
    case 13: // OK / Enter
    case 32: // Space
      // TV keyboard key: type the letter, stay on the key for the next one.
      try {
        if (isKeyboardKey(ae)) {
          try { evt.preventDefault(); } catch (e) {}
          try { evt.stopPropagation(); } catch (e) {}
          // Space key on the remote while on a letter key should still type
          // the letter (not a space) — only the SPACE key types a space.
          if (kc === 32) {
            var dk = null;
            try { dk = ae.getAttribute('data-k'); } catch (e) {}
            if (dk !== ' ') return false; // swallow stray remote-space
          }
          try { activateFocusedKbKey(); } catch (e) {}
          return false;
        }
      } catch (e) {}
      if (textEditing) return true; // search-fix handles Enter-to-submit
      if (ae && (ae.tagName === 'VIDEO')) {
        try { evt.preventDefault(); } catch (e) {}
        togglePlay(ae);
        return false;
      }
      // Let native controls activate themselves; activate custom role=button.
      if (ae && ae.getAttribute && ae.getAttribute('role') === 'button') {
        try { evt.preventDefault(); } catch (e) {}
        try { ae.click(); } catch (e) {}
        return false;
      }
      if (kc === 32 && ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A')) {
        return true;
      }
      // If focus is on body (nothing selected), focus first card instead of nothing.
      if (!ae || ae === document.body) {
        var first = document.querySelector('a[href], button');
        if (first) {
          try { evt.preventDefault(); } catch (e) {}
          try { first.focus(); } catch (e) {}
          return false;
        }
      }
      return true;

    case 10009: // Return (Tizen)
    case 461:   // Return (legacy / Orsay)
    case 27:    // Escape / Back alias (also keyboards)
    case 10182: // Exit
      // TV keyboard open: first Back closes it (and returns to the field),
      // second Back does the normal blur/go-back flow.
      try {
        if (isKeyboardVisible()) {
          try { evt.preventDefault(); } catch (e) {}
          try { evt.stopPropagation(); } catch (e) {}
          hideKeyboard();
          var kt = null;
          try { kt = getKbTarget(); } catch (e) {}
          if (kt) {
            try { kt.focus({ preventScroll: true }); } catch (e) { try { kt.focus(); } catch (e2) {} }
          }
          return false;
        }
      } catch (e) {}
      if (textEditing) return true; // search-fix does blur-first there
      try { evt.preventDefault(); } catch (e) {}
      try { evt.stopPropagation(); } catch (e) {}
      goBack();
      return false;

    case 415: // Play
      togglePlay(); return false;
    case 19: // Pause
      (function () { var v = activeVideo(); if (v) try { v.pause(); } catch (e) {} })();
      return false;
    case 10252: // PlayPause
      togglePlay(); return false;
    case 413: // Stop
      (function () { var v = activeVideo(); if (v) try { v.pause(); } catch (e) {} })();
      return false;
    case 417: // FastForward
      seekBy(10); return false;
    case 412: // Rewind
      seekBy(-10); return false;
    case 425: // TrackNext
      if (!seekBy(30)) {
        try { evt.preventDefault(); } catch (e) {}
      }
      return false;
    case 424: // TrackPrevious
      if (!seekBy(-30)) {
        try { evt.preventDefault(); } catch (e) {}
      }
      return false;

    case 403: // Red -> Home
      goHome(); return false;
    case 404: // Green -> Search (+ TV keyboard, so typing works with no IME)
    case 172: // Green alias
      try { evt.preventDefault(); } catch (e) {}
      try {
        if (window.__tjFocusSearch) window.__tjFocusSearch();
      } catch (e) {}
      // The focus call above is async (SPA nav + retries); also hook the
      // field directly in case it already exists on this page.
      setTimeout(function () {
        try {
          var ae2 = document.activeElement;
          if (ae2 && isTextEditable(ae2)) {
            showKeyboardFor(ae2);
            makeFocusable(document);
          }
        } catch (e) {}
      }, 600);
      return false;
    case 405: // Yellow -> Help
    case 170: // Yellow alias
      try { evt.preventDefault(); } catch (e) {}
      toggleHelp();
      return false;
    case 406: // Blue -> Fullscreen video
    case 191: // Blue alias
      try { evt.preventDefault(); } catch (e) {}
      toggleFullscreen();
      return false;

    case 427: // ChannelUp -> page up
      try { window.scrollBy(0, -window.innerHeight * 0.85); } catch (e) {}
      return false;
    case 428: // ChannelDown -> page down
      try { window.scrollBy(0, window.innerHeight * 0.85); } catch (e) {}
      return false;

    default:
      // Number keys 0-9: percentage seek when a video is present.
      if (kc >= 48 && kc <= 57) {
        if (textEditing) return true; // typing in search
        var v = activeVideo();
        if (v && !v.paused) {
          seekToFraction(((kc - 48) * 10) / 100);
          try { evt.preventDefault(); } catch (e) {}
          return false;
        }
        return true;
      }
      // Printable physical keyboard keys must always reach the page.
      return true;
  }
}

export function initTV() {
  ensureToastDom();
  ensureHelpDom();
  ensureSearchBtnDom();
  try { ensureKeyboardDom(); } catch (e) {}
  initSearchFix(showToast);

  // Take over spatial navigation like TizenTube does.
  try {
    window.__spatialNavigation__ = window.__spatialNavigation__ || {};
    window.__spatialNavigation__.keyMode = 'NONE';
  } catch (e) {}

  makeFocusable(document);

  // Keep SPA content navigable. childList-only on purpose: observing attributes
  // here caused an observer→mutate→observer storm (see search-fix.js).
  // Debounced so SPA render bursts cost one pass — matters on low-end Tizen SoCs.
  var mo = null;
  var focusScheduled = false;
  function scheduleFocusable() {
    if (focusScheduled) return;
    focusScheduled = true;
    setTimeout(function () {
      focusScheduled = false;
      makeFocusable(document);
      try { rebuildRows(document); } catch (e) {}
    }, 150);
  }
  try {
    mo = new MutationObserver(function () { scheduleFocusable(); });
    mo.observe(document.documentElement || document.body, {
      childList: true, subtree: true
    });
  } catch (e) {}
  setInterval(function () {
    makeFocusable(document);
    try { rebuildRows(document); } catch (e) {}
  }, 2500);

  // Keep focused cards on screen (Svelte rows scroll horizontally) and feed
  // row focus memory (Up/Down returns to the tile you came from).
  document.addEventListener('focusin', function (e) {
    try { rememberFocus(e.target); } catch (e2) {}
    // Focusing a search field summons the TV keyboard (no IME needed).
    // Physical-keyboard users are unaffected: the keys just sit at the
    // bottom until arrowed into, and typing still goes to the field.
    try {
      if (e.target && isTextEditable(e.target)) {
        setKbTarget(e.target);
        showKeyboardFor(e.target);
        makeFocusable(document);
      }
    } catch (e2) {}
    // The seek slider itself is opacity:0 (the visible progress bar is a
    // plain div), so a ring on the input would be invisible — highlight the
    // visible bar (its parent) instead.
    try {
      if (isRangeSlider(e.target) && e.target.parentElement) {
        e.target.parentElement.classList.add('tj-seek-focus');
      }
    } catch (e2) {}
    try {
      var t = e.target;
      if (t && t.scrollIntoView) {
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
          t.scrollIntoView({ block: 'center' });
        } else {
          t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
    } catch (e2) {}
  }, false);
  document.addEventListener('focusout', function (e) {
    try {
      if (isRangeSlider(e.target) && e.target.parentElement) {
        e.target.parentElement.classList.remove('tj-seek-focus');
      }
    } catch (e2) {}
  }, false);

  // Global TV key handler (capture, like TizenTube).
  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('keypress', handleKey, true);

  // NOTE: popup blocking lives in ads.js (initAds runs before initTV).

  // Initial focus + hint (SPA may still be hydrating; retry).
  // Prefer the first tile-sized target (hero card / first rail tile), not
  // header chrome: focus should land on content, Netflix-style.
  function pickInitialTarget() {
    var cands = [];
    try { cands = [...document.querySelectorAll('.tj-focusable')]; } catch (e) {}
    for (var i = 0; i < cands.length; i++) {
      try {
        var r = cands[i].getBoundingClientRect();
        if (r.width >= 64 && r.height >= 48) return cands[i];
      } catch (e) {}
    }
    return cands[0] || null;
  }
  var tries = 0;
  var t = setInterval(function () {
    tries++;
    makeFocusable(document);
    try { rebuildRows(document); } catch (e) {}
    // Let the SPA hydrate and the policy settle before stealing focus —
    // early passes approve transient containers that later get demoted.
    if (tries < 4) return;
    var focusTarget = pickInitialTarget();
    if (focusTarget && (!document.activeElement || document.activeElement === document.body)) {
      try { focusTarget.focus({ preventScroll: true }); } catch (e) {
        try { focusTarget.focus(); } catch (e2) {}
      }
    }
    if (tries === 2) {
      showToast('CineJoy TV', 'Arrows + OK • GREEN search • YELLOW help');
    }
    if (tries > 12) clearInterval(t);
  }, 800);

  // Re-run focus logic after SPA navigation.
  function renav() {
    setTimeout(function () {
      makeFocusable(document);
      ensureSearchBtnDom();
    }, 400);
    setTimeout(function () { makeFocusable(document); }, 1500);
  }
  try {
    var push = window.history.pushState;
    window.history.pushState = function () {
      var r = push.apply(this, arguments);
      renav();
      return r;
    };
  } catch (e) {}
  window.addEventListener('popstate', renav);
  window.addEventListener('hashchange', renav);

  // Announce video controls when a player appears.
  var videoAnnounced = false;
  setInterval(function () {
    if (videoAnnounced) return;
    var v = activeVideo();
    if (v) {
      videoAnnounced = true;
      showToast('Player ready', 'OK play/pause • ◀▶ ±10s • BLUE fullscreen');
      setTimeout(function () { videoAnnounced = false; }, 60000);
    }
  }, 3000);
}
