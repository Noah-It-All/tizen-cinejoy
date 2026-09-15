// Plain functional checks for the built TizenBrew mods bundle.
// Runs as a normal script (not node:test) so the process can exit deterministically
// even though the bundle intentionally installs setInterval-based observers.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = fs.readFileSync(path.join(root, 'dist/cinejoy.js'), 'utf8');
let failures = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!cond) failures++;
};

const waitFor = async (fn, ms = 6000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!fn();
};

// 1. Manifest follows the TizenBrew MODULES.md "site modification" schema (mirrors TizenTube).
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ok(pkg.packageType === 'mods', 'manifest packageType=mods');
ok(pkg.websiteURL === 'https://cinejoy.to/', 'manifest websiteURL=cinejoy.to');
ok(typeof pkg.main === 'string' && fs.existsSync(path.join(root, pkg.main)), 'manifest main bundle exists');
for (const k of ['MediaPlayPause', 'ColorF1Green', 'ColorF3Blue']) {
  ok(pkg.keys.includes(k), `manifest keys include ${k}`);
}
// registerKey throws on unknown names and TizenBrew registers keys in an
// unguarded loop BEFORE navigating — one bad name bricks the launch click.
// Allowlist mirrors Samsung's remote-control key table (+ TizenTube's set).
{
  const valid = new Set([
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
    'MediaFastForward', 'MediaRewind', 'MediaRecord',
    'MediaTrackNext', 'MediaTrackPrevious',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'ChannelUp', 'ChannelDown', 'VolumeUp', 'VolumeDown', 'VolumeMute',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ]);
  const bad = pkg.keys.filter((k) => !valid.has(k));
  ok(bad.length === 0, 'all manifest keys are registerKey-safe' + (bad.length ? ' (bad: ' + bad.join(',') + ')' : ''));
}

// 2. Bundle boots on cinejoy host, injects TV UI + hardens search.
{
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head></head><body><header><form action="/search">' +
    '<input type="search" placeholder="Search movies..." /><button type="submit">Go</button>' +
    '</form></header><main><a href="/movie/1">Movie 1</a><button>Play</button></main></body></html>',
    { url: 'https://cinejoy.to/', runScripts: 'dangerously' }
  );
  dom.window.eval(dist);
  const booted = await waitFor(() => typeof dom.window.__tjFocusSearch === 'function');
  ok(booted, 'bundle exposes __tjFocusSearch on cinejoy host');
  ok(!!dom.window.document.getElementById('tj-toast'), 'toast element injected');
  ok(!!dom.window.document.getElementById('tj-help'), 'help overlay injected');
  ok(!!dom.window.document.getElementById('tj-tv-search-btn'), 'floating TV search button injected');
  const css = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  ok(css.includes('#95FF50'), 'focus CSS uses CineJoy brand color');
  const input = dom.window.document.querySelector('input[type="search"]');
  ok(input && input.getAttribute('inputmode') === 'search', 'search input gets inputmode=search');
  dom.window.close();
}

// 3. Bundle stays inert on foreign hosts.
{
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://example.com/', runScripts: 'dangerously',
  });
  dom.window.eval(dist);
  await new Promise((r) => setTimeout(r, 800));
  ok(!dom.window.document.getElementById('tj-toast'), 'no TV UI injected off-site');
  dom.window.close();
}

// 4. Keyboard search: printable keys reach the field, Enter submits the form.
{
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><form id="f" action="/search">' +
    '<input id="q" type="search" /><button type="submit">Go</button></form></body></html>',
    { url: 'https://cinejoy.to/search', runScripts: 'dangerously' }
  );
  dom.window.eval(dist);
  await waitFor(() => typeof dom.window.__tjFocusSearch === 'function');
  const { document } = dom.window;
  const input = document.getElementById('q');
  const form = document.getElementById('f');
  let submitted = false;
  form.addEventListener('submit', (e) => { submitted = true; e.preventDefault(); });
  input.focus();
  const keyA = new dom.window.KeyboardEvent('keydown', { key: 'a', keyCode: 65, bubbles: true, cancelable: true });
  input.dispatchEvent(keyA);
  ok(!keyA.defaultPrevented, 'printable key is not blocked inside search');
  // Keyboard search contract (Tizen IME rules):
  //  - pristine empty Enter must pass through natively (that keypress IS the
  //    IME show scene; preventDefault would kill the keyboard);
  //  - Enter after typing submits.
  const enterPristine = new dom.window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
  input.dispatchEvent(enterPristine);
  await new Promise((r) => setTimeout(r, 50));
  ok(!submitted && !enterPristine.defaultPrevented, 'pristine Enter passes through to summon IME');
  input.value = 'tron';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
  input.dispatchEvent(enter);
  await new Promise((r) => setTimeout(r, 50));
  ok(submitted, 'Enter inside search submits the form');
  dom.window.close();
}

// 5. Remote: GREEN key focuses search from body.
{
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><input type="search" placeholder="Search" />' +
    '<main><a href="/a">A</a></main></body></html>',
    { url: 'https://cinejoy.to/', runScripts: 'dangerously' }
  );
  dom.window.eval(dist);
  await waitFor(() => typeof dom.window.__tjFocusSearch === 'function');
  const { document } = dom.window;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { keyCode: 404, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 150));
  ok(document.activeElement && document.activeElement.tagName === 'INPUT', 'GREEN key moves focus into search');
  dom.window.close();
}

import { isAdUrl } from '../src/ads.js';
import { isNavTarget } from '../src/focus-policy.js';
import {
  ensureKeyboardDom, isKeyboardKey, isKeyboardVisible, showKeyboardFor,
  hideKeyboard, pressKbKey, moveKb, kbRowCount, kbCols,
} from '../src/keyboard.js';

// 6. Adblocking: pure URL classifier.
{
  ok(isAdUrl('https://adsterra.com/pup.js'), 'ad host blocked (adsterra)');
  ok(isAdUrl('https://www.propellerads.com/x.js'), 'ad host blocked (propeller)');
  ok(isAdUrl('https://monetag.com/tag.js'), 'ad host blocked (monetag)');
  ok(isAdUrl('https://cdn.example.com/atOptions.js'), 'ad pattern blocked (atOptions)');
  ok(isAdUrl('https://sub.adsterra.com/pup.js'), 'ad subdomain blocked');
  ok(!isAdUrl('https://notadsterra.com/x.js'), 'lookalike domain passes');
  ok(!isAdUrl('/api/trending'), 'first-party relative URL passes');
  ok(!isAdUrl('https://cinejoy.to/search?q=x'), 'first-party absolute URL passes');
  ok(!isAdUrl('https://cdn.cinejoy.to/hls/seg.m3u8'), 'video CDN passes');
  ok(!isAdUrl(''), 'empty URL passes');
}

// 7. Adblocking: live bundle behavior (no real network touched).
{
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'https://cinejoy.to/', runScripts: 'dangerously',
  });
  dom.window.eval(dist);
  await waitFor(() => typeof dom.window.__tjFocusSearch === 'function');
  const res = await dom.window.fetch('https://adsterra.com/pup.js');
  ok(res && res.status === 204, 'ad fetch short-circuits to empty 204');
  ok(dom.window.open('https://example.com/') === null, 'window.open popunder blocked');
  ok(!!dom.window.document.querySelector('style[data-tj-ads]'), 'ad-hiding CSS injected');
  const s = dom.window.document.createElement('script');
  s.setAttribute('src', 'https://popads.net/pop.js');
  dom.window.document.body.appendChild(s);
  await new Promise((r) => setTimeout(r, 400));
  ok(!s.parentNode, 'injected ad script node removed');
  const legit = dom.window.document.createElement('script');
  legit.setAttribute('src', 'https://cinejoy.to/_app/immutable/chunks/app.js');
  dom.window.document.body.appendChild(legit);
  await new Promise((r) => setTimeout(r, 400));
  ok(!!legit.parentNode, 'first-party script node untouched');
  dom.window.close();
}

// 8. Focus policy: tiles + labeled controls snap, chrome does not.
{
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://cinejoy.to/' });
  const doc = dom.window.document;
  const mk = (tag, { text = '', w = 0, h = 0, x = 0, y = 500, attrs = {}, parent = null, layout = true } = {}) => {
    const el = doc.createElement(tag);
    el.textContent = text;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.getBoundingClientRect = () => ({ width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, x, y });
    (parent || doc.body).appendChild(el);
    return [el, layout];
  };
  const footer = doc.createElement('footer');
  doc.body.appendChild(footer);
  const dialog = doc.createElement('div');
  dialog.setAttribute('role', 'dialog');
  doc.body.appendChild(dialog);

  let [tile] = mk('a', { text: 'Neon Harbor', w: 180, h: 260 });
  ok(isNavTarget(tile, true), 'poster tile snaps');
  let [icon] = mk('button', { text: '', w: 16, h: 16, attrs: { 'aria-label': '' } });
  icon.textContent = '';
  ok(!isNavTarget(icon, true), 'unlabeled micro-button skipped');
  let [foot] = mk('a', { text: 'Privacy', w: 120, h: 40, parent: footer });
  ok(!isNavTarget(foot, true), 'footer link skipped');
  let [search] = mk('input', { attrs: { type: 'search', placeholder: 'Search' } });
  ok(isNavTarget(search, false), 'search input snaps without layout');
  let [ep] = mk('button', { text: 'E12', w: 44, h: 30 });
  ok(isNavTarget(ep, true), 'labeled episode button snaps despite small size');
  let [chev] = mk('button', { text: '›', w: 24, h: 40 });
  ok(!isNavTarget(chev, true), 'single-glyph chevron skipped');
  let [goback] = mk('button', { text: '', w: 28, h: 28, y: 30, attrs: { 'aria-label': 'Go back' } });
  ok(isNavTarget(goback, true), 'top-bar icon button snaps despite small size');
  let [closeIn] = mk('button', { text: '×', w: 24, h: 24, parent: dialog });
  ok(isNavTarget(closeIn, true), 'dialog close stays reachable');
  let [closeOut] = mk('button', { text: '×', w: 24, h: 24 });
  ok(!isNavTarget(closeOut, true), 'same × outside dialog skipped');
  let [imgLink] = mk('a', { w: 180, h: 260 });
  const img = doc.createElement('img');
  img.setAttribute('alt', 'Neon Harbor');
  imgLink.appendChild(img);
  ok(isNavTarget(imgLink, true), 'image-only tile with alt snaps');
  let [hidden] = mk('a', { text: 'Ghost', w: 180, h: 260, attrs: { 'aria-hidden': 'true' } });
  ok(!isNavTarget(hidden, true), 'aria-hidden tile skipped');
  let [optOut] = mk('a', { text: 'Nope', w: 180, h: 260, attrs: { tabindex: '-1' } });
  ok(!isNavTarget(optOut, true), 'site tabindex=-1 respected');
  let [hid] = mk('input', { attrs: { type: 'hidden' } });
  ok(!isNavTarget(hid, true), 'hidden input skipped');
  let [vid] = mk('video', { w: 0, h: 0 });
  ok(isNavTarget(vid, true), 'video always snaps');
  const wrap = doc.createElement('div');
  wrap.setAttribute('tabindex', '0');
  wrap.textContent = 'Rail wrapper with a tile inside but no direct label';
  const innerBtn = doc.createElement('button');
  innerBtn.textContent = 'Play';
  wrap.appendChild(innerBtn);
  doc.body.appendChild(wrap);
  wrap.getBoundingClientRect = () => ({ width: 500, height: 130, left: 0, top: 0, right: 500, bottom: 130, x: 0, y: 0 });
  innerBtn.getBoundingClientRect = () => ({ width: 130, height: 52, left: 0, top: 0, right: 130, bottom: 52, x: 0, y: 0 });
  ok(!isNavTarget(wrap, true), 'wrapper div with controls inside is not a target');
  ok(isNavTarget(innerBtn, true), 'control inside wrapper still snaps');
  const leaf = doc.createElement('div');
  leaf.setAttribute('tabindex', '0');
  leaf.setAttribute('style', 'cursor:pointer');
  leaf.textContent = 'Featured';
  doc.body.appendChild(leaf);
  leaf.getBoundingClientRect = () => ({ width: 300, height: 100, left: 0, top: 0, right: 300, bottom: 100, x: 0, y: 0 });
  ok(isNavTarget(leaf, true), 'leaf div tile with own label + pointer snaps');
  const shell = doc.createElement('div');
  shell.setAttribute('tabindex', '0');
  shell.setAttribute('style', 'cursor:pointer');
  doc.body.appendChild(shell);
  shell.getBoundingClientRect = () => ({ width: 499, height: 129, left: 0, top: 0, right: 499, bottom: 129, x: 0, y: 0 });
  ok(!isNavTarget(shell, true), 'empty clickable shell without label does not snap');
  dom.window.close();
}

// 9. Player zone + scrub slider + floating search button visibility.
{
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://cinejoy.to/' });
  const doc = dom.window.document;
  const rect = (el, w, h, y = 500) => {
    el.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: y, right: w, bottom: y + h, x: 0, y });
  };
  // Range slider is always a target (scrub/volume), even outside a player zone.
  const seek = doc.createElement('input');
  seek.setAttribute('type', 'range');
  seek.setAttribute('aria-label', 'Seek Video');
  doc.body.appendChild(seek);
  rect(seek, 1856, 32);
  ok(isNavTarget(seek, true), 'seek slider snaps');
  // Small icon-only player button: skipped outside, approved inside the zone.
  const zone = doc.createElement('div');
  zone.setAttribute('data-tj-player', '1');
  doc.body.appendChild(zone);
  const mkBtn = (parent, w, h) => {
    const b = doc.createElement('button');
    b.setAttribute('aria-label', 'Subtitles');
    b.textContent = '';
    parent.appendChild(b);
    rect(b, w, h);
    return b;
  };
  const loneIcon = mkBtn(doc.body, 24, 24);
  ok(!isNavTarget(loneIcon, true), 'tiny icon button skipped outside player');
  const playerIcon = mkBtn(zone, 24, 24);
  ok(isNavTarget(playerIcon, true), 'tiny icon button snaps inside player zone');
  // Floating TV search button: invisible = trap (skip), shown = target.
  const fab = doc.createElement('button');
  fab.id = 'tj-tv-search-btn';
  fab.setAttribute('aria-label', 'Search');
  fab.textContent = '⌕';
  doc.body.appendChild(fab);
  rect(fab, 0, 0);
  ok(!isNavTarget(fab, true), 'hidden floating search button does not snap');
  fab.classList.add('tj-show');
  rect(fab, 56, 56);
  ok(isNavTarget(fab, true), 'shown floating search button snaps');
  dom.window.close();
}

// 10. Live-filter search (no form): Enter passes through natively, the
// decorative icon is not auto-clicked, the query is kept.
{
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div><button aria-label="Search">icon</button></div>' +
    '<input id="q" type="text" placeholder="Search for movies &amp; TV shows..." /></body></html>',
    { url: 'https://cinejoy.to/search', runScripts: 'dangerously' }
  );
  dom.window.eval(dist);
  await waitFor(() => typeof dom.window.__tjFocusSearch === 'function');
  const { document } = dom.window;
  const input = document.getElementById('q');
  const icon = document.querySelector('button[aria-label="Search"]');
  let iconClicked = false;
  icon.addEventListener('click', () => { iconClicked = true; });
  input.focus();
  input.value = 'tron';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
  input.dispatchEvent(enter);
  await new Promise((r) => setTimeout(r, 50));
  ok(!iconClicked, 'decorative search icon is not auto-clicked on Enter');
  ok(!enter.defaultPrevented, 'Enter passes through natively on live-filter field');
  ok(input.value === 'tron', 'typed query is kept');
  dom.window.close();
}

// 11. TV keyboard: grid exists, typing works, single-char keys snap,
// Down from the search field reaches the keyboard (no trap).
{
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
    '<input id="q" type="text" placeholder="Search for movies..." />' +
    '<a href="/m/1">Movie 1</a></body></html>',
    { url: 'https://cinejoy.to/search', runScripts: 'outside-only' }
  );
  const doc = dom.window.document;
  // Run the module functions against this document by temporarily swapping globals.
  const prevDoc = global.document;
  const prevWin = global.window;
  global.document = doc;
  global.window = dom.window;
  try {
    const kbEl = ensureKeyboardDom();
    ok(!!kbEl && !!doc.getElementById('tj-kb'), 'TV keyboard DOM injected');
    const keys = kbEl.querySelectorAll('.tj-kb-key');
    ok(keys.length === kbRowCount() * kbCols(), 'keyboard grid is complete (' + keys.length + ' keys)');
    ok(isKeyboardKey(keys[0]), 'keyboard keys recognized');
    ok(!isKeyboardVisible(), 'keyboard hidden by default');
    const input = doc.getElementById('q');
    showKeyboardFor(input);
    ok(isKeyboardVisible(), 'keyboard shows for search input');
    // Single-char key must snap even without layout (semantic fallback).
    const keyA = kbEl.querySelector('.tj-kb-key[data-k=\"A\"]');
    ok(isNavTarget(keyA, false), 'single-char keyboard key snaps');
    // Typing appends through native setter + input event (Svelte sees it).
    let sawInput = false;
    input.addEventListener('input', () => { sawInput = true; });
    keyA.focus();
    pressKbKey('T', keyA);
    pressKbKey('R', keyA);
    pressKbKey('O', keyA);
    pressKbKey('N', keyA);
    ok(input.value === 'TRON', 'keyboard typing builds the query (got \"' + input.value + '\")');
    ok(sawInput, 'typing dispatches input events for live-filter');
    pressKbKey('__BKSP__', keyA);
    ok(input.value === 'TRO', 'keyboard backspace deletes');
    pressKbKey('__CLR__', keyA);
    ok(input.value === '', 'keyboard clear empties');
    // Grid nav: first key, Right steps, Left clamps, Down goes to next row.
    const first = kbEl.querySelector('.tj-kb-key[data-r=\"0\"][data-c=\"0\"]');
    first.focus();
    ok(moveKb('right') && doc.activeElement.getAttribute('data-c') === '1', 'keyboard Right steps');
    ok(moveKb('left') && doc.activeElement.getAttribute('data-c') === '0', 'keyboard Left steps back');
    ok(moveKb('left'), 'keyboard Left clamps at row start (handled)');
    ok(moveKb('down') && doc.activeElement.getAttribute('data-r') === '1', 'keyboard Down goes to next row');
    ok(moveKb('up') && doc.activeElement.getAttribute('data-r') === '0', 'keyboard Up returns to previous row');
    hideKeyboard();
    ok(!isKeyboardVisible(), 'keyboard hides');
  } finally {
    global.document = prevDoc;
    global.window = prevWin;
    dom.window.close();
  }
}

// 12. Search-field trap: Down from the field reaches the keyboard, Up leaves.
{
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
    '<input id=\"q\" type=\"text\" placeholder=\"Search for movies...\" />' +
    '<main><a href=\"/m/1\">Movie 1</a></main></body></html>',
    { url: 'https://cinejoy.to/search', runScripts: 'dangerously' }
  );
  dom.window.eval(dist);
  await waitFor(() => typeof dom.window.__tjFocusSearch === 'function');
  const { document } = dom.window;
  const input = document.getElementById('q');
  input.focus();
  await new Promise((r) => setTimeout(r, 300));
  const kbShown = !!document.getElementById('tj-kb') &&
    document.getElementById('tj-kb').classList.contains('tj-show');
  ok(kbShown, 'focusing search summons the TV keyboard');
  // Down arrow must move focus into the keyboard (not stay trapped).
  const before = document.activeElement;
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
  document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 300));
  const inKb = document.activeElement && document.activeElement.classList &&
    document.activeElement.classList.contains('tj-kb-key');
  ok(inKb, 'Down from search field lands in the TV keyboard (was ' + (before && before.tagName) + ')');
  dom.window.close();
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
