/* On-screen TV keyboard for search (remote-friendly).
 *
 * Why: the Tizen IME only appears on real hardware after a native OK press,
 * and once focus is inside a text field our arrows pass through natively —
 * so Up/Down does nothing and the remote feels "stuck in the search box".
 * This module provides a guaranteed keyboard:
 *  - grid of A-Z 0-9 plus SPACE / backspace / clear / DONE,
 *  - fully arrow-navigable (Left/Right within a row, Up/Down between rows),
 *  - OK types the focused key without moving focus, so multi-letter entry works,
 *  - typing writes through setNativeInputValue so Svelte live-filter sees input events.
 *
 * Geometry-free: keys live in #tj-kb[data-tj-kb] so focus-policy approves them
 * like player controls (single-char labels would otherwise fail the speck gate).
 */

import { setNativeInputValue } from './search-fix.js';

var KB_ID = 'tj-kb';
var KB_COLS = 7;

// Last row holds wide action keys.
var KB_ROWS = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  ['H', 'I', 'J', 'K', 'L', 'M', 'N'],
  ['O', 'P', 'Q', 'R', 'S', 'T', 'U'],
  ['V', 'W', 'X', 'Y', 'Z', '0', '1'],
  ['2', '3', '4', '5', '6', '7', '8'],
  ['9', 'SPACE', 'BKSP', 'CLR', 'DONE', 'EXIT', '_'],
];

var kbTarget = null;

export function getKbTarget() {
  try {
    if (kbTarget && kbTarget.isConnected !== false && document.contains(kbTarget)) return kbTarget;
  } catch (e) {}
  return null;
}

export function setKbTarget(input) {
  try {
    if (input && input.tagName && /INPUT|TEXTAREA/.test(input.tagName)) kbTarget = input;
  } catch (e) {}
}

function keyDef(label) {
  if (label === 'SPACE') return { label: 'Space', k: ' ', wide: true };
  if (label === 'BKSP') return { label: '⌫', k: '__BKSP__' };
  if (label === 'CLR') return { label: 'Clear', k: '__CLR__' };
  if (label === 'DONE') return { label: 'Done', k: '__DONE__' };
  if (label === 'EXIT') return { label: 'Exit', k: '__EXIT__' };
  return { label: label, k: label };
}

export function ensureKeyboardDom() {
  var kb = null;
  try { kb = document.getElementById(KB_ID); } catch (e) {}
  if (kb) return kb;
  try {
    kb = document.createElement('div');
    kb.id = KB_ID;
    kb.setAttribute('data-tj-kb', '1');
    kb.setAttribute('role', 'group');
    kb.setAttribute('aria-label', 'TV keyboard');
    var title = document.createElement('div');
    title.className = 'tj-kb-title';
    title.textContent = 'TV keyboard — arrows move, OK types, DONE exits';
    kb.appendChild(title);
    var grid = document.createElement('div');
    grid.className = 'tj-kb-grid';
    for (var r = 0; r < KB_ROWS.length; r++) {
      for (var c = 0; c < KB_ROWS[r].length; c++) {
        var def = keyDef(KB_ROWS[r][c]);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tj-kb-key tj-focusable';
        b.setAttribute('tabindex', '0');
        b.setAttribute('data-k', def.k);
        b.setAttribute('data-r', String(r));
        b.setAttribute('data-c', String(c));
        b.setAttribute('aria-label', 'Key ' + def.label);
        b.textContent = def.label;
        (function (btn, kk) {
          btn.addEventListener('click', function () { pressKbKey(kk, btn); });
        })(b, def.k);
        grid.appendChild(b);
      }
    }
    kb.appendChild(grid);
    document.body.appendChild(kb);
  } catch (e) {}
  return kb;
}

export function isKeyboardKey(el) {
  try {
    return !!el && !!el.classList && el.classList.contains('tj-kb-key');
  } catch (e) {
    return false;
  }
}

export function isKeyboardVisible() {
  try {
    var kb = document.getElementById(KB_ID);
    return !!kb && kb.classList.contains('tj-show');
  } catch (e) {
    return false;
  }
}

export function showKeyboardFor(input) {
  try { setKbTarget(input); } catch (e) {}
  var kb = null;
  try { kb = ensureKeyboardDom(); } catch (e) {}
  try {
    if (kb && !kb.classList.contains('tj-show')) kb.classList.add('tj-show');
  } catch (e) {}
  return kb;
}

export function hideKeyboard() {
  try {
    var kb = document.getElementById(KB_ID);
    if (kb && kb.classList.contains('tj-show')) kb.classList.remove('tj-show');
  } catch (e) {}
}

function focusKeyAt(row, col) {
  try {
    var kb = document.getElementById(KB_ID);
    if (!kb) return false;
    var sel = '.tj-kb-key[data-r=\"' + row + '\"][data-c=\"' + col + '\"]';
    var el = kb.querySelector(sel);
    if (!el) return false;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { return false; } }
    try { if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

export function focusFirstKbKey() {
  return focusKeyAt(0, 0);
}

// Grid navigation for the keyboard. Up from the top row returns false so the
// caller can route focus back to the search field; Down from the last row
// returns false so the caller can route to results.
export function moveKb(dir) {
  var ae = null;
  try { ae = document.activeElement; } catch (e) {}
  if (!isKeyboardKey(ae)) return false;
  var r = 0, c = 0;
  try {
    r = parseInt(ae.getAttribute('data-r'), 10) || 0;
    c = parseInt(ae.getAttribute('data-c'), 10) || 0;
  } catch (e) {}
  if (dir === 'left') {
    if (c <= 0) return true; // clamp at row start
    return focusKeyAt(r, c - 1);
  }
  if (dir === 'right') {
    if (c >= KB_COLS - 1) return true; // clamp at row end
    return focusKeyAt(r, c + 1);
  }
  if (dir === 'up') {
    if (r <= 0) return false; // caller: back to search input
    return focusKeyAt(r - 1, c);
  }
  if (dir === 'down') {
    if (r >= KB_ROWS.length - 1) return false; // caller: to results
    return focusKeyAt(r + 1, c);
  }
  return false;
}

export function kbRowCount() {
  return KB_ROWS.length;
}

export function kbCols() {
  return KB_COLS;
}

// Type a key into the target input. Focus stays on the key so the user can
// keep typing. Returns true when the keypress was consumed.
export function pressKbKey(k, btn) {
  if (k === '__EXIT__') {
    try { hideKeyboard(); } catch (e) {}
    var t = getKbTarget();
    try { if (t && t.blur) t.blur(); } catch (e) {}
    return true;
  }
  if (k === '__DONE__') {
    try { hideKeyboard(); } catch (e) {}
    var tgt = getKbTarget();
    try { if (tgt && tgt.blur) tgt.blur(); } catch (e) {}
    // Move to results: first tile-sized link, else first result link.
    try {
      var pick = null;
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        try {
          var rr = links[i].getBoundingClientRect();
          if (rr.width >= 64 && rr.height >= 48) { pick = links[i]; break; }
        } catch (e) {}
      }
      if (!pick && links.length) pick = links[0];
      if (pick) {
        try { pick.focus({ preventScroll: true }); } catch (e) { try { pick.focus(); } catch (e2) {} }
        try { if (pick.scrollIntoView) pick.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }
    } catch (e) {}
    return true;
  }
  var target = getKbTarget();
  if (!target) {
    try {
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) target = ae;
    } catch (e) {}
  }
  if (!target) return false;
  try {
    var cur = target.value || '';
    var next = cur;
    if (k === '__BKSP__') next = cur.slice(0, -1);
    else if (k === '__CLR__') next = '';
    else next = cur + k;
    try { setNativeInputValue(target, next); }
    catch (e) {
      target.value = next;
      try {
        var win = (target.ownerDocument && target.ownerDocument.defaultView) || window;
        var EE = (win && win.Event) || Event;
        target.dispatchEvent(new EE('input', { bubbles: true }));
      } catch (e2) {}
    }
    // Keep focus on the pressed key (click would move it to the input).
    try { if (btn && document.activeElement !== btn) btn.focus({ preventScroll: true }); }
    catch (e) { try { if (btn) btn.focus(); } catch (e2) {} }
    return true;
  } catch (e) {
    return false;
  }
}

// OK on a focused key.
export function activateFocusedKbKey() {
  var ae = null;
  try { ae = document.activeElement; } catch (e) {}
  if (!isKeyboardKey(ae)) return false;
  var k = null;
  try { k = ae.getAttribute('data-k'); } catch (e) {}
  return pressKbKey(k, ae);
}
