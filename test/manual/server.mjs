// Live dev proxy for visual testing against the REAL cinejoy.to.
//
// Run: npm run test:visual  →  open http://localhost:8123/
//
// Everything except /dist/*, /test/* and /demo is forwarded to
// https://cinejoy.to, with absolute site URLs rewritten to stay on localhost
// and our bundle (+ remote emulator + on-screen remote bar) injected into
// every HTML page. This is the same technique TizenTube Standalone uses
// (localhost proxy + injected userscript), minus video transmuxing.
//
// What the proxy does, in order:
//  - Serves local files: /dist/cinejoy.js, /test/remote-emulator.snippet.js,
//    and the synthetic ad-trap lab at /demo (still useful for ad checks).
//  - Forwards method/headers/body to the upstream; forces identity encoding
//    so text can be rewritten; forwards Range so video seeking works.
//  - Rewrites redirects, cookies (Domain/Secure/SameSite for plain http),
//    Referer/Origin, and absolute https://cinejoy.to URLs in text bodies.
//  - Strips Content-Security-Policy (it would block the injected scripts)
//    and injects the bundle before </body>.
// Caveats: hard-refresh (Cmd/Ctrl+Shift+R) if the service worker serves a
// stale copy; video bytes for third-party providers stream straight through.
import http from 'node:http';
import https from 'node:https';

const UPSTREAM = 'https://cinejoy.to';
const UPSTREAM_HOST = 'cinejoy.to';
const PORT = Number(process.env.PORT || 8123);
const LOCAL = 'http://localhost:' + PORT;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function localFile(res, file, type) {
  import('node:fs').then((fs) => {
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found (run npm run build first)');
      return;
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(file));
  });
}

function remoteBtn(label, key, extra) {
  return '<button tabindex="-1" onmousedown="event.preventDefault()" onclick="window.tv&&tv(\'' +
    key + '\')" style="padding:8px 2px;font-size:13px;' + (extra || '') + '">' + label + '</button>';
}

function toolbarHtml() {
  return '<div id="__tjbar" style="position:fixed;right:10px;bottom:10px;z-index:2147483647;' +
    'background:rgba(5,5,5,.92);border:2px solid #95FF50;border-radius:12px;padding:8px;' +
    'color:#fff;font:14px sans-serif;max-width:190px">' +
    '<div style="color:#95FF50;font-weight:700;margin-bottom:6px">TV REMOTE ' +
    '<span style="float:right;cursor:pointer" onclick="document.getElementById(\'__tjbar\').style.display=\'none\'">[x]</span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,40px);gap:4px;justify-content:center">' +
    '<span></span>' + remoteBtn('&#9650;', 'up') + '<span></span>' +
    remoteBtn('&#9664;', 'left') + remoteBtn('OK', 'ok') + remoteBtn('&#9654;', 'right') +
    '<span></span>' + remoteBtn('&#9660;', 'down') + '<span></span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(2,62px);gap:4px;margin-top:4px">' +
    remoteBtn('BACK', 'back') + remoteBtn('PLAY', 'play') +
    remoteBtn('RW', 'rw') + remoteBtn('FF', 'ff') +
    remoteBtn('RED', 'red', 'background:#a00') + remoteBtn('GREEN', 'green', 'background:#0a0;color:#000') +
    remoteBtn('YELLOW', 'yellow', 'background:#aa0;color:#000') + remoteBtn('BLUE', 'blue', 'background:#00a') +
    '</div></div>';
}

function inject(html) {
  const tag = '<script src="/dist/cinejoy.js"></script>' +
    '<script src="/test/remote-emulator.snippet.js"></script>' + toolbarHtml();
  if (html.includes('</body>')) return html.replace('</body>', tag + '</body>');
  return html + tag;
}

function rewriteBody(text) {
  return text
    .split('https://www.cinejoy.to').join(LOCAL)
    .split('https://cinejoy.to').join(LOCAL)
    .split('//cinejoy.to').join('//localhost:' + PORT);
}

function rewriteLocation(loc) {
  if (!loc) return loc;
  if (loc.startsWith('https://www.cinejoy.to/')) return LOCAL + loc.slice('https://www.cinejoy.to'.length);
  if (loc.startsWith('https://cinejoy.to/')) return LOCAL + loc.slice('https://cinejoy.to'.length);
  if (loc === 'https://cinejoy.to' || loc === 'https://www.cinejoy.to') return LOCAL + '/';
  return loc; // relative or third-party (e.g. video CDN) — pass through
}

function rewriteCookies(setCookies) {
  return setCookies.map((c) =>
    c
      .replace(/;\s*Domain=[^;]*/gi, '')
      .replace(/;\s*Secure/gi, '')
      .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
  );
}

const STRIP_RES_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'content-length',
  'content-encoding',
  'transfer-encoding',
]);

function proxy(req, res) {
  const incoming = new URL(req.url, LOCAL);
  const target = UPSTREAM + incoming.pathname + incoming.search;
  const headers = { ...req.headers, host: UPSTREAM_HOST };
  headers['accept-encoding'] = 'identity'; // need plain text to rewrite + inject
  for (const h of ['referer', 'origin']) {
    if (typeof headers[h] === 'string' && headers[h].includes('localhost')) {
      headers[h] = headers[h].split(LOCAL).join(UPSTREAM);
    }
  }

  const up = https.request(target, { method: req.method, headers }, (upRes) => {
    if ([301, 302, 303, 307, 308].includes(upRes.statusCode) && upRes.headers.location) {
      res.writeHead(upRes.statusCode, { Location: rewriteLocation(upRes.headers.location) });
      res.end();
      upRes.resume();
      return;
    }
    const chunks = [];
    upRes.on('data', (c) => chunks.push(c));
    upRes.on('end', () => {
      let body = Buffer.concat(chunks);
      const ct = String(upRes.headers['content-type'] || '');
      const isText = /text|javascript|json|xml|svg/.test(ct);
      const out = {};
      for (const k of Object.keys(upRes.headers)) {
        if (!STRIP_RES_HEADERS.has(k.toLowerCase())) out[k] = upRes.headers[k];
      }
      if (upRes.headers['set-cookie']) out['set-cookie'] = rewriteCookies(upRes.headers['set-cookie']);
      if (isText) {
        let text = rewriteBody(body.toString('utf8'));
        if (ct.includes('html')) text = inject(text);
        body = Buffer.from(text, 'utf8');
      }
      out['content-length'] = body.length;
      res.writeHead(upRes.statusCode || 200, out);
      res.end(body);
    });
  });
  up.on('timeout', () => up.destroy(new Error('upstream timeout')));
  up.setTimeout(25000);
  up.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('upstream fetch failed (is cinejoy.to reachable from here?)');
    }
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  import('node:fs').then((fs) => {
    import('node:path').then((path) => {
      import('node:url').then(({ fileURLToPath }) => {
        const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
        const url = new URL(req.url, LOCAL);
        if (url.pathname === '/dist/cinejoy.js') {
          localFile(res, path.join(root, 'dist/cinejoy.js'), 'text/javascript; charset=utf-8');
          return;
        }
        if (url.pathname === '/test/remote-emulator.snippet.js') {
          localFile(res, path.join(root, 'test/remote-emulator.snippet.js'), 'text/javascript; charset=utf-8');
          return;
        }
        if (url.pathname === '/demo') {
          let html = fs.readFileSync(path.join(root, 'test/manual/demo.html'), 'utf8');
          const q = url.searchParams.get('q');
          html = html.replace('<!--QUERY-->',
            q ? '<span style="color:#95FF50">Results for “' + esc(q) + '” (native form submit worked)</span>'
              : '<span style="color:#666">No query yet — submit the search (GREEN, type, OK).</span>');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        proxy(req, res);
      });
    });
  });
});

server.listen(PORT, () => {
  console.log('LIVE cinejoy.to test proxy:');
  console.log('  real site (bundled + remote)  http://localhost:' + PORT + '/');
  console.log('  ad-trap lab                   http://localhost:' + PORT + '/demo');
  console.log('If the page looks stale, hard-refresh to bypass the service worker.');
});
