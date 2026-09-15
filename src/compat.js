/* Minimal compat polyfills for Tizen 3.0 (Chrome 47) before anything else runs.
 * Chrome 47 already has: arrow functions, template literals, Map/Set, Promise,
 * Array.includes, Object.assign (mostly). Missing / buggy: Array.flat/flatMap,
 * Element.closest/matches, CustomEvent constructor, Number.isFinite, String.includes.
 * Keep this file ES5-only (no arrows, no const/let) so it parses everywhere.
 */
(function () {
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth) {
      var d = depth === undefined ? 1 : Number(depth);
      var out = [];
      (function flatten(arr, n) {
        for (var i = 0; i < arr.length; i++) {
          var v = arr[i];
          if (Array.isArray(v) && n > 0) flatten(v, n - 1);
          else out.push(v);
        }
      })(this, isFinite(d) ? d : 1);
      return out;
    };
  }
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function (fn, thisArg) {
      var out = [];
      for (var i = 0; i < this.length; i++) {
        if (i in this) {
          var v = fn.call(thisArg, this[i], i, this);
          if (Array.isArray(v)) out.push.apply(out, v);
          else out.push(v);
        }
      }
      return out;
    };
  }
  if (!Array.prototype.includes) {
    Array.prototype.includes = function (search, fromIndex) {
      var len = this.length >>> 0;
      var i = Number(fromIndex) || 0;
      if (i < 0) i = Math.max(len + i, 0);
      for (; i < len; i++) {
        var cur = this[i];
        if (cur === search || (cur !== cur && search !== search)) return true;
      }
      return false;
    };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function (search, start) {
      if (typeof start !== 'number') start = 0;
      if (start + search.length > this.length) return false;
      return this.indexOf(search, start) !== -1;
    };
  }
  if (typeof Number.isFinite !== 'function') {
    Number.isFinite = function (n) {
      return typeof n === 'number' && isFinite(n);
    };
  }
  if (typeof Object.assign !== 'function') {
    Object.assign = function (target) {
      if (target == null) throw new TypeError('Cannot convert undefined or null to object');
      var to = Object(target);
      for (var i = 1; i < arguments.length; i++) {
        var src = arguments[i];
        if (src != null) {
          for (var k in src) {
            if (Object.prototype.hasOwnProperty.call(src, k)) to[k] = src[k];
          }
        }
      }
      return to;
    };
  }
  if (typeof window !== 'undefined' && window.Element && window.Element.prototype) {
    var proto = window.Element.prototype;
    if (typeof proto.matches !== 'function') {
      proto.matches = proto.msMatchesSelector || proto.webkitMatchesSelector ||
        function (sel) {
          var node = this;
          var list = (node.ownerDocument || document).querySelectorAll(sel);
          for (var i = 0; i < list.length; i++) {
            if (list[i] === node) return true;
          }
          return false;
        };
    }
    if (typeof proto.closest !== 'function') {
      proto.closest = function (sel) {
        var el = this;
        while (el) {
          if (el.matches && el.matches(sel)) return el;
          el = el.parentElement;
        }
        return null;
      };
    }
  }
  // CustomEvent constructor (Tizen 3 throws on `new CustomEvent`)
  try {
    if (typeof window !== 'undefined' && typeof window.CustomEvent !== 'function') {
      window.CustomEvent = function (type, params) {
        params = params || { bubbles: false, cancelable: false, detail: null };
        var ev = document.createEvent('CustomEvent');
        ev.initCustomEvent(type, !!params.bubbles, !!params.cancelable, params.detail);
        return ev;
      };
    }
  } catch (e) {}
})();
