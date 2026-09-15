/* Tizen remote emulator — paste into DevTools Console on https://cinejoy.to/
 * with the Tizen-CineJoy userscript (dist/cinejoy.js) active, e.g. via Tampermonkey.
 *
 * Desktop keyboards can't produce Tizen keyCodes (404, 10009, 415, ...), so this
 * snippet dispatches synthetic keydown events the module handles identically to
 * real remote keys. Usage:
 *   tv('green')   tv('back')   tv('play')   tv('ff')   tv('red')   tv('help')
 *   tv(404)       tv('up')     tv('ok')     tv(13)
 *   tvHelp()      // prints the map
 */
(function () {
  var CODES = {
    left: 37, up: 38, right: 39, down: 40, ok: 13, enter: 13, space: 32,
    back: 10009, ret: 10009, return: 10009, esc: 27, exit: 10182,
    play: 415, pause: 19, playpause: 10252, stop: 413, ff: 417, rw: 412,
    next: 425, prev: 424,
    red: 403, green: 404, yellow: 405, blue: 406,
    chup: 427, chdown: 428
  };
  for (var n = 0; n <= 9; n++) CODES[String(n)] = 48 + n;

  window.tv = function (name) {
    var kc = typeof name === 'number' ? name : CODES[String(name).toLowerCase()];
    if (!kc) {
      console.warn('[tv-emu] unknown key:', name, '- try tvHelp()');
      return false;
    }
    var target = document.activeElement || document.body;
    var evt;
    try {
      evt = new KeyboardEvent('keydown', { keyCode: kc, which: kc, bubbles: true, cancelable: true });
    } catch (e) {
      evt = document.createEvent('Event');
      evt.initEvent('keydown', true, true);
    }
    // keyCode is read-only on some engines — force it.
    try {
      if (evt.keyCode !== kc) {
        Object.defineProperty(evt, 'keyCode', { value: kc });
        Object.defineProperty(evt, 'which', { value: kc });
      }
    } catch (e) {}
    console.log('[tv-emu] dispatching keyCode ' + kc + ' on <' + (target.tagName || '?').toLowerCase() + '>');
    return target.dispatchEvent(evt);
  };

  window.tvHelp = function () {
    console.log('tv(name|code): arrows left/up/right/down, ok, back, exit, play, pause, playpause, stop, ff, rw, next, prev, red, green, yellow, blue, chup, chdown, 0-9');
  };

  console.log('[tv-emu] ready. Type tvHelp() for the key map. Example: tv("green") focuses search.');
})();
