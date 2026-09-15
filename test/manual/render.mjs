// Render the REAL cinejoy.to in headless Chromium with our bundle injected,
// screenshot it, and dump the DOM structure that matters for TV navigation.
// Usage: node test/manual/render.mjs [home|search]  (screenshots → /tmp/tj-*.png)
import { chromium } from 'playwright';
import fs from 'node:fs';

const dist = fs.readFileSync(new URL('../../dist/cinejoy.js', import.meta.url), 'utf8');
const page2 = process.argv[2] === 'search' ? 'search' : 'home';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[tj')) console.log('PAGE:', t.slice(0, 160));
});
await page.addInitScript(dist);
await page.goto(page2 === 'search' ? 'https://cinejoy.to/search' : 'https://cinejoy.to/', {
  waitUntil: 'domcontentloaded', timeout: 45000,
});
await page.waitForTimeout(9000); // SPA hydration + our boot
await page.screenshot({ path: `/tmp/tj-${page2}-1.png` });

const dump = await page.evaluate(() => {
  const out = { url: location.href, title: document.title };
  out.counts = {
    links: document.querySelectorAll('a[href]').length,
    buttons: document.querySelectorAll('button').length,
    inputs: [...document.querySelectorAll('input')].map((i) => i.type + '|' + (i.placeholder || '') + '|' + (i.name || '')),
    videos: document.querySelectorAll('video').length,
    tjFocusable: document.querySelectorAll('.tj-focusable').length,
  };
  // search markup: first few candidate inputs with context
  out.search = [...document.querySelectorAll('input')].slice(0, 4).map((i) => ({
    type: i.type, ph: i.placeholder, name: i.name, id: i.id, cls: String(i.className).slice(0, 80),
    parentForm: !!i.form, header: !!(i.closest && i.closest('header')),
  }));
  // rows: horizontal scroll containers with cards
  const rows = [];
  document.querySelectorAll('*').forEach((el) => {
    try {
      if (el.scrollWidth > el.clientWidth + 30 && el.clientWidth > 300) {
        const cards = el.querySelectorAll('a[href],button');
        if (cards.length >= 2) {
          rows.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), w: el.clientWidth, cards: cards.length });
        }
      }
    } catch (e) {}
  });
  out.rows = rows.slice(0, 12);
  // sample card links: size + text
  out.cards = [...document.querySelectorAll('main a[href], a[href]')]
    .filter((a) => {
      try { const r = a.getBoundingClientRect(); return r.width > 100 && r.height > 100; } catch (e) { return false; }
    })
    .slice(0, 6)
    .map((a) => {
      const r = a.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: (a.textContent || '').trim().slice(0, 30), cls: String(a.className).slice(0, 60) };
    });
  out.headerLinks = [...document.querySelectorAll('header a[href]')].slice(0, 10).map((a) => (a.textContent || '').trim().slice(0, 24));
  out.footerLinks = document.querySelectorAll('footer a[href]').length;
  return out;
});
console.log(JSON.stringify(dump, null, 2));
await browser.close();
process.exit(0);
