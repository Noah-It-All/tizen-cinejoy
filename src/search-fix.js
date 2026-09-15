/* Search / keyboard fix for CineJoy (cinejoy.to, SvelteKit SPA).
 *
 * Why this exists:
 * - On Tizen, the IME (virtual keyboard) and USB keyboards emit keyCode 229
 *   composition events plus `input` events. If a mods script hijacks arrows/Enter
 *   globally, typing breaks: cursor can't move, Enter never submits, Svelte never
 *   sees the change.
 * - SvelteKit search inputs are often "controlled": Svelte only updates state on
 *   a bubbling `input` event. Some TV wrappers break this by calling
 *   el.value = x without dispatching events, or by preventDefault-ing keys.
 *
 * Guarantees:
 *  1. Physical keyboard typing (a-z, 0-9, space, backspace) always reaches the
 *     focused field — we never preventDefault printable keys inside editable
 *     elements.
 *  2. Arrow Left/Right move the text cursor when editing (spatial nav suspended),
 *     Arrow Up/Down + Enter/Back get TV-friendly behavior (see below).
 *  3. Enter submits: form submit -> search button click -> SPA navigation to
 *     /search?q=... fallback, in that order.
 *  4. Return/Back (10009/461/27) while editing first blurs (closes IME),
 *     second press goes back in history.
 *  5. GREEN button (404) focuses search from anywhere.
 */

export function isEditable(el) {
  if (!el) return false;
  var tag = (el.tagName || '').toUpperCase();
  if (el.isContentEditable) return true;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    var type = (el.type || 'text').toLowerCase();
    // checkbox/radio/range shouldn't count as text editing
    if (type === 'checkbox' || type === 'radio' || type === 'button' ||
        type === 'submit' || type === 'reset' || type === 'range' ||
        type === 'color' || type === 'file') return false;
    return !el.readOnly && !el.disabled;
  }
  return false;
}

export function isTextEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  var tag = (el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    var type = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'password', 'email', 'number', 'tel'].indexOf(type) !== -1;
  }
  return false;
}

// Use the native setter so Svelte's reactivity picks up programmatic changes.
export function setNativeInputValue(el, value) {
  try {
    var proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  } catch (e) {
    el.value = value;
  }
  // Svelte listens for bubbling `input`; React listens too. Fire both.
  // Prefer the element's own window so the event is accepted even across
  // documents (jsdom tests swap globals).
  var ev;
  try {
    var win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var EE = (win && win.Event) || Event;
    ev = new EE('input', { bubbles: true, cancelable: true });
  } catch (e) {
    ev = document.createEvent('Event');
    ev.initEvent('input', true, true);
  }
  el.dispatchEvent(ev);
  try {
    var win2 = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var EE2 = (win2 && win2.Event) || Event;
    var ch = new EE2('change', { bubbles: true, cancelable: true });
    el.dispatchEvent(ch);
  } catch (e) { /* old Tizen: input is enough */ }
}

var SEARCH_SELECTORS = [
  'input[type="search"]',
  'input[type="text"]',
  'input[name*="search" i]',
  'input[id*="search" i]',
  'input[placeholder*="search" i]',
  'input[placeholder*="Search"]',
  'input[aria-label*="search" i]',
  'textarea[placeholder*="search" i]',
  '[role="searchbox"]',
  '[contenteditable="true"]'
];

// Visibility check that works with real layout AND without one (jsdom has no
// layout: offsetParent is always null there, so a naive offsetParent check
// hides every input and breaks __tjFocusSearch).
function isVisible(el) {
  try {
    if (!el || el.disabled) return false;
    if (el.type === 'hidden') return false;
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
    if (el.offsetParent !== null && typeof el.offsetParent !== 'undefined') return true;
    if (el.getClientRects && el.getClientRects().length > 0) return true;
    if (typeof window.getComputedStyle === 'function') {
      try {
        var cs = window.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
      } catch (e) {}
    }
    return true;
  } catch (e) {
    return true;
  }
}

export function findSearchInput(root) {
  root = root || document;
  for (var i = 0; i < SEARCH_SELECTORS.length; i++) {
    try {
      var el = root.querySelector(SEARCH_SELECTORS[i]);
      if (el && isVisible(el)) return el;
    } catch (e) { /* invalid selector on old webkit */ }
  }
  // Fallback: any visible text-ish input in a header/nav
  try {
    var inputs = root.querySelectorAll('input');
    for (var j = 0; j < inputs.length; j++) {
      var inp = inputs[j];
      if (isTextEditable(inp) && isVisible(inp)) return inp;
    }
  } catch (e) {}
  return null;
}

export function findSearchButton(scope) {
  scope = scope || document;
  var selectors = [
    'button[aria-label*="search" i]',
    'button[type="submit"]',
    'form[action*="search" i] button',
    'a[href^="/search"]'
  ];
  for (var i = 0; i < selectors.length; i++) {
    try {
      var el = scope.querySelector(selectors[i]);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}

// A button that genuinely submits a search: inside a form with a submitting
// type. Decorative icon buttons (e.g. the header magnifier that just routes
// to /search, or player-bar buttons) must NOT be auto-clicked — clicking
// them on Enter discards the typed query and breaks the site's own
// live/Enter handling. Note: a <button> with no type defaults to "submit"
// DOM-wise, so form membership (not just type) is the deciding factor.
export function isRealSubmit(btn) {
  if (!btn) return false;
  try {
    var tag = (btn.tagName || '').toUpperCase();
    if (tag === 'A') return false;
    if (!btn.closest || !btn.closest('form')) return false;
    if (tag === 'BUTTON') {
      var t = (btn.type || 'submit').toLowerCase();
      return t === 'submit';
    }
    if (tag === 'INPUT') {
      var it = (btn.type || '').toLowerCase();
      return it === 'submit' || it === 'image';
    }
  } catch (e) {}
  return false;
}

function submitSearch(input, showToast) {
  var value = (input.value || '').trim();
  // 1) Native form submit (SvelteKit <form> handles navigation itself)
  var form = input.form || (input.closest ? input.closest('form') : null);
  if (form) {
    try {
      if (form.requestSubmit) form.requestSubmit();
      else {
        var btn = form.querySelector('button[type="submit"]');
        if (btn) btn.click();
        else form.submit();
      }
      input.blur();
      return true;
    } catch (e) { /* fall through */ }
  }
  // 2) Nearby REAL submit control (type=submit or inside a form).
  var scope = (input.closest && (input.closest('header') || input.closest('nav') || input.closest('form') || input.parentElement)) || document;
  var btn2 = findSearchButton(scope) || findSearchButton(document);
  if (btn2 && isRealSubmit(btn2)) {
    try { btn2.click(); } catch (e) {}
    input.blur();
    return true;
  }
  // 3) No form and no real submit (e.g. the /search live-filter field):
  // just dismiss the keyboard and keep the results. Do NOT navigate to
  // /search?q= (the site ignores the param) and do NOT click decorative
  // icon buttons (that discards the query).
  try { input.blur(); } catch (e) {}
  if (value) return true;
  if (showToast) showToast('Type something to search');
  return false;
}

// Track "Return pressed once while editing" so first press closes IME.
var returnArmedFor = null;

export function initSearchFix(showToast, focusSearch) {
  // Harden every search-like input: correct inputmode, keep it focusable,
  // and make Enter submit while IME composition is respected.
  function enhance(input) {
    if (!input || input.__tjSearchEnhanced) return;
    input.__tjSearchEnhanced = true;
    var typedSinceFocus = false;
    try {
      if (input.tagName === 'INPUT' && !input.getAttribute('inputmode')) {
        input.setAttribute('inputmode', 'search');
      }
      if (input.tagName === 'INPUT' && !input.getAttribute('autocomplete')) {
        input.setAttribute('autocomplete', 'off');
      }
      if (input.tagName === 'INPUT' && !input.getAttribute('autocapitalize')) {
        input.setAttribute('autocapitalize', 'off');
      }
      input.classList.add('tj-focusable');
      if (!input.hasAttribute('tabindex')) input.setAttribute('tabindex', '0');
    } catch (e) {}

    input.addEventListener('focus', function () {
      input.classList.add('tj-search-active');
      returnArmedFor = null;
      typedSinceFocus = false;
    });
    input.addEventListener('blur', function () {
      input.classList.remove('tj-search-active');
      if (returnArmedFor === input) returnArmedFor = null;
    });

    // Any real typing marks the field dirty. Enter behavior depends on it:
    // pristine + empty Enter MUST reach Tizen natively — that is the documented
    // IME show scene ("press Enter on the input"), and preventDefault kills it.
    input.addEventListener('input', function () { typedSinceFocus = true; });

    // Key handling scoped to the field. Runs in bubble phase after the
    // global TV handler; we stop propagation ONLY for keys we consume.
    // Everything else stays fully native so cursor movement and the IME work.
    input.addEventListener('keydown', function (evt) {
      var kc = evt.keyCode || evt.which;
      var key = evt.key;
      // Let IME composition events through untouched.
      if (kc === 229 || key === 'Process' || evt.isComposing) return;
      if (kc === 13 || key === 'Enter') {
        // If IME is still composing, Enter confirms the composition — don't submit yet.
        if (evt.isComposing) return;
        var hasText = (input.value || '').trim().length > 0;
        if (!hasText && !typedSinceFocus) return true; // pristine: summon IME natively
        // Only hijack Enter when we have something to submit through (a form
        // or a real submit button). Otherwise let the event reach the site
        // natively — live-filter pages handle Enter themselves, and
        // preventDefault would silently break them.
        var form = input.form || (input.closest ? input.closest('form') : null);
        var scope = (input.closest && (input.closest('header') || input.closest('nav') || input.closest('form') || input.parentElement)) || document;
        var cand = null;
        try { cand = findSearchButton(scope) || findSearchButton(document); } catch (e) {}
        if (form || isRealSubmit(cand)) {
          try { evt.preventDefault(); } catch (e) {}
          try { evt.stopPropagation(); } catch (e) {}
          submitSearch(input, showToast);
          return false;
        }
        return true;
      }
      if (kc === 27 || kc === 10009 || kc === 461) {
        // First Return: close keyboard. Second: let global handler go back.
        if (returnArmedFor !== input) {
          returnArmedFor = input;
          try { evt.preventDefault(); } catch (e) {}
          try { evt.stopPropagation(); } catch (e) {}
          try { input.blur(); } catch (e) {}
          if (showToast) showToast('Press Back again to go back');
          setTimeout(function () { if (returnArmedFor === input) returnArmedFor = null; }, 2500);
          return false;
        }
        returnArmedFor = null;
        return; // let global handler history.back()
      }
      // Everything else (arrows, Home/End, Backspace, printables) stays fully
      // native: no preventDefault, no stopPropagation. The global TV handler
      // already leaves text fields alone, and the IME needs these untouched.
      return true;
    }, false);

    // Tizen IME sometimes only fires `input` with keyCode 229 keydowns; ensure
    // Svelte sees a proper change when the field is "compositionend".
    input.addEventListener('compositionend', function () {
      typedSinceFocus = true;
      try {
        var ev = new Event('input', { bubbles: true });
        input.dispatchEvent(ev);
      } catch (e) {}
    });
  }

  function scan() {
    var found = [];
    for (var i = 0; i < SEARCH_SELECTORS.length; i++) {
      var list;
      try { list = document.querySelectorAll(SEARCH_SELECTORS[i]); }
      catch (e) { continue; }
      for (var j = 0; j < list.length; j++) found.push(list[j]);
    }
    // De-dupe + enhance
    var seen = [];
    for (var k = 0; k < found.length; k++) {
      if (seen.indexOf(found[k]) === -1) {
        seen.push(found[k]);
        enhance(found[k]);
      }
    }
    // Floating TV search button: show only when no obvious search CTA is focused easily.
    // Guarded writes only — an unguarded classList.add here re-triggers the
    // MutationObserver on every scan and starves the event loop (real hang seen
    // in tests: thousands of observer callbacks, timers never firing).
    var btn = document.getElementById('tj-tv-search-btn');
    if (btn) {
      var inp = findSearchInput(document);
      if (inp && !btn.classList.contains('tj-show')) btn.classList.add('tj-show');
      else if (!inp && btn.classList.contains('tj-show')) btn.classList.remove('tj-show');
    }
  }

  function hintKeyboard() {
    // JS focus alone never summons the Tizen IME (platform rule) — the next
    // OK press on the focused field does. We ALSO show our own TV keyboard
    // (Down arrow from the field), so say both.
    if (showToast) showToast('Search', 'Type, or press Down for the TV keyboard');
  }

  // Expose a global so the GREEN key + floating button can focus search.
  window.__tjFocusSearch = function () {
    var inp = findSearchInput(document);
    if (!inp) {
      // No inline search field (maybe icon-only): try opening /search page.
      try { window.location.href = '/search'; } catch (e) {}
      if (showToast) showToast('Opening search…');
      // After nav, retry focus.
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        var el = findSearchInput(document);
        if (el) {
          clearInterval(t);
          try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
          try { el.focus(); } catch (e) {}
          try { el.click(); } catch (e) {}
          hintKeyboard();
        } else if (tries > 20) clearInterval(t);
      }, 250);
      return false;
    }
    try { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {
      try { inp.scrollIntoView(); } catch (e2) {}
    }
    try { inp.focus({ preventScroll: true }); } catch (e) {
      try { inp.focus(); } catch (e2) {}
    }
    try { inp.click(); } catch (e) {}
    hintKeyboard();
    return true;
  };
  if (focusSearch) focusSearch.fn = window.__tjFocusSearch;

  // Route-aware autofocus: a search icon usually routes to /search with
  // nothing focused, which reads as "keyboard never appears". Focus the
  // field on arrival (it still needs one OK press — platform rule).
  function autofocusSearchRoute() {
    var path = '';
    try { path = window.location.pathname || ''; } catch (e) {}
    if (path.indexOf('/search') !== 0) return;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var el = null;
      try { el = findSearchInput(document); } catch (e) {}
      if (el) {
        clearInterval(t);
        try { el.focus({ preventScroll: true }); } catch (e) {
          try { el.focus(); } catch (e2) {}
        }
        hintKeyboard();
      } else if (tries > 25) clearInterval(t);
    }, 300);
  }

  var observer = null;
  var scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(function () { scanScheduled = false; scan(); }, 150);
  }
  try {
    // NOTE: deliberately NOT observing `class`/`style` — scan() itself writes
    // classes (tj-show), and observing them caused an infinite
    // observer→scan→observer loop that hung the page. childList covers new
    // search fields; placeholder/type flips are rare and also covered by the
    // interval + SPA-navigation rescans below.
    observer = new MutationObserver(function () { scheduleScan(); });
    observer.observe(document.documentElement || document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['placeholder', 'type']
    });
  } catch (e) { /* old webkit without MutationObserver: rely on intervals */ }

  scan();
  setInterval(scan, 2000);
  autofocusSearchRoute();
  // Re-scan after SPA navigations (SvelteKit pushState).
  try {
    var push = window.history.pushState;
    window.history.pushState = function () {
      var r = push.apply(this, arguments);
      setTimeout(scan, 300);
      setTimeout(scan, 1200);
      setTimeout(autofocusSearchRoute, 400);
      return r;
    };
  } catch (e) {}
  window.addEventListener('popstate', function () { setTimeout(scan, 300); setTimeout(autofocusSearchRoute, 400); });
  window.addEventListener('hashchange', function () { setTimeout(scan, 300); });
}
