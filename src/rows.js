/* Row-aware arrow navigation (the Netflix feel).
 *
 * Free-2D spatial navigation jumps wherever geometry says is closest, which
 * on a catalog page feels random: Left/Right escapes the row into headers,
 * Up/Down lands on a dot or a half-visible card. TV catalog UIs are ROWS
 * (cinejoy renders `overflow-x-auto` rails of 200x300 tiles), so:
 *
 *  - Left/Right inside a row moves to the adjacent tile and STAYS in the row
 *    (clamped at the ends — exactly like Netflix).
 *  - Up/Down jumps to the nearest row in that direction, landing on the
 *    remembered tile if it is still there (focus memory per row), else the
 *    tile nearest in x.
 *  - Anything outside rows (header, hero buttons, grids without rails)
 *    falls through to the spatial-navigation polyfill.
 *
 * Rows are detected geometrically (no class names): a horizontal scroll
 * container holding 2+ approved snap targets, or 3+ snap targets sharing a
 * horizontal band. Rebuilt on the same debounced pass as focus approval.
 */

var rowCache = []; // [{ el: container|null, band: {top,bottom}, items: [...] }]
var rowMemory = new Map(); // containerKey -> last focused child

function rect(el) {
  try {
    var r = el.getBoundingClientRect();
    return { x: r.left || 0, y: r.top || 0, w: r.width || 0, h: r.height || 0 };
  } catch (e) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function cx(r) { return r.x + r.w / 2; }

function isScrollableX(el) {
  try {
    return el.scrollWidth > el.clientWidth + 30 && el.clientWidth > 200;
  } catch (e) {
    return false;
  }
}

function snapItems(root) {
  try { return [...root.querySelectorAll('.tj-focusable')]; }
  catch (e) { return []; }
}

function rowKey(container, band) {
  if (container) {
    if (!container.__tjRowId) {
      try { container.__tjRowId = 'r' + Math.random().toString(36).slice(2); } catch (e) { return null; }
    }
    return container.__tjRowId;
  }
  return 'band:' + Math.round(band.top / 40);
}

export function rebuildRows(root) {
  root = root || document;
  var rows = [];
  var claimed = new Set();
  var items = snapItems(root).filter((el) => {
    try { return !!(el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)); } catch (e) { return false; }
  });

  // Pass 1: horizontal scroll rails.
  var seen = new Set();
  items.forEach((el) => {
    var p = null;
    try { p = el.parentElement; } catch (e) {}
    var depth = 0;
    while (p && depth < 6 && !seen.has(p)) {
      if (isScrollableX(p)) {
        seen.add(p);
        var members = items.filter((m) => { try { return p.contains(m); } catch (e) { return false; } });
        if (members.length >= 2) rows.push({ el: p, items: members });
        break;
      }
      try { p = p.parentElement; } catch (e) { p = null; }
      depth++;
    }
  });
  rows.forEach((r) => r.items.forEach((m) => claimed.add(m)));

  // Pass 2: band clusters for the rest (episode grids, chip rows).
  var rest = items.filter((m) => !claimed.has(m));
  var bands = [];
  rest.forEach((el) => {
    var r = rect(el);
    if (r.w <= 0 || r.h <= 0) return;
    var placed = false;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var overlap = Math.min(b.bottom, r.y + r.h) - Math.max(b.top, r.y);
      if (overlap > Math.min(b.height, r.h) * 0.5) {
        b.items.push(el);
        b.top = Math.min(b.top, r.y);
        b.bottom = Math.max(b.bottom, r.y + r.h);
        b.height = b.bottom - b.top;
        placed = true;
        break;
      }
    }
    if (!placed) bands.push({ top: r.y, bottom: r.y + r.h, height: r.h, items: [el] });
  });
  bands.forEach((b) => {
    if (b.items.length >= 3) rows.push({ el: null, band: b, items: b.items });
  });

  // Sort members left-to-right, prune dead memory.
  rows.forEach((r) => {
    r.items.sort((a, b) => rect(a).x - rect(b).x);
    r.rects = r.items.map(rect);
  });
  var alive = new Set();
  rows.forEach((r) => {
    var k = rowKey(r.el, r.band || r.items[0] && rect(r.items[0]));
    r.key = k;
    r.items.forEach((m) => alive.add(m));
  });
  try {
    [...rowMemory.keys()].forEach((k) => {
      var stillThere = rows.some((r) => r.key === k);
      if (!stillThere) rowMemory.delete(k);
    });
  } catch (e) {}

  rowCache = rows;
  return rows;
}

export function rememberFocus(el) {
  try {
    for (var i = 0; i < rowCache.length; i++) {
      if (rowCache[i].items.indexOf(el) !== -1) {
        rowMemory.set(rowCache[i].key, el);
        return;
      }
    }
  } catch (e) {}
}

function focusEl(el) {
  try {
    el.focus({ preventScroll: true });
  } catch (e) {
    try { el.focus(); } catch (e2) { return false; }
  }
  try {
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch (e) {}
  rememberFocus(el);
  return true;
}

function rowOf(el) {
  for (var i = 0; i < rowCache.length; i++) {
    if (rowCache[i].items.indexOf(el) !== -1) return rowCache[i];
  }
  return null;
}

// Left/Right: step to the adjacent tile, clamped at the rail ends.
export function moveInRow(dir) {
  var ae = null;
  try { ae = document.activeElement; } catch (e) {}
  if (!ae) return false;
  var row = rowOf(ae);
  if (!row) return false;
  var idx = row.items.indexOf(ae);
  if (idx === -1) return false;
  var next = dir === 'left' ? idx - 1 : idx + 1;
  if (next < 0 || next >= row.items.length) return true; // clamp: handled, stay put
  return focusEl(row.items[next]);
}

// Up/Down: nearest row in that direction; remembered tile wins, else nearest x.
export function moveAcrossRows(dir) {
  var ae = null;
  try { ae = document.activeElement; } catch (e) {}
  if (!ae) return false;
  var from = rect(ae);
  if (from.w <= 0 && from.h <= 0) return false;
  var fromX = cx(from);
  var best = null;
  var bestGap = Infinity;
  for (var i = 0; i < rowCache.length; i++) {
    var row = rowCache[i];
    if (row.items.indexOf(ae) !== -1) continue;
    var top = Infinity, bottom = -Infinity;
    row.items.forEach((m) => {
      var r = rect(m);
      if (r.y < top) top = r.y;
      if (r.y + r.h > bottom) bottom = r.y + r.h;
    });
    var gap = dir === 'up' ? from.y - bottom : top - (from.y + from.h);
    if (gap < -8) continue; // overlapping / wrong side
    if (gap < bestGap) { bestGap = gap; best = row; }
  }
  if (!best) return false;
  var remembered = null;
  try { remembered = rowMemory.get(best.key); } catch (e) {}
  if (remembered) {
    try {
      if (best.items.indexOf(remembered) !== -1 && remembered.isConnected !== false) {
        return focusEl(remembered);
      }
    } catch (e) {}
  }
  var pick = best.items[0];
  var pickDx = Infinity;
  best.items.forEach((m) => {
    var dx = Math.abs(cx(rect(m)) - fromX);
    if (dx < pickDx) { pickDx = dx; pick = m; }
  });
  return focusEl(pick);
}

export function rowCount() {
  return rowCache.length;
}

// Focus routing into the player control bar (Up/Down from a focused video).
// Prefers the remembered control (focus memory), else Play/Pause, else the
// seek slider, else the first bar control. Only considers approved
// (.tj-focusable) controls so hidden/demoted chrome stays out.
export function focusPlayerControl() {
  var zone = null;
  try { zone = document.querySelector('[data-tj-player]'); } catch (e) {}
  if (!zone) return false;
  var ctrls = [];
  try {
    ctrls = [...zone.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [role="button"]'
    )].filter((el) => {
      try { return el.classList.contains('tj-focusable'); } catch (e) { return false; }
    });
  } catch (e) {}
  if (!ctrls.length) return false;
  var pick = null;
  try {
    for (var i = 0; i < rowCache.length; i++) {
      var mem = rowMemory.get(rowCache[i].key);
      if (mem && ctrls.indexOf(mem) !== -1 && mem.isConnected !== false) {
        pick = mem;
        break;
      }
    }
  } catch (e) {}
  if (!pick) {
    try {
      pick = ctrls.filter((el) => {
        var a = '';
        try { a = (el.getAttribute('aria-label') || '').toLowerCase(); } catch (e) {}
        return a === 'pause' || a === 'play';
      })[0] || null;
    } catch (e) { pick = null; }
  }
  if (!pick) {
    try {
      pick = ctrls.filter((el) => {
        try { return el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'range'; }
        catch (e) { return false; }
      })[0] || null;
    } catch (e) { pick = null; }
  }
  if (!pick) pick = ctrls[0];
  return focusEl(pick);
}
