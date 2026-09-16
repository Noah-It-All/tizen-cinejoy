# Tizen-CineJoy — cinejoy.to wrapper for Samsung Tizen TVs

A [TizenBrew](https://github.com/reisxd/TizenBrew) **site-modification module**
(`packageType: "mods"`, see `docs/MODULES.md` in the TizenBrew repo) that wraps
**https://cinejoy.to/** and makes it fully usable with a Samsung TV remote —
modeled on the [TizenTube](https://github.com/reisxd/TizenTube) module
(`@foxreis/tizentube`: `websiteURL` + injected `main` script + registered `keys`).

The injected script (`dist/cinejoy.js`, built from `src/`) adds:

- **No adblocking, by design**: no request is blocked, no DOM node removed,
  nothing hidden. Network-level filtering lives on your own Pi-hole — the
  bundle only drives remote, focus, keyboard, and player behavior, so it can
  never hang playback by 204'ing something the player needs.
- **Spatial navigation that snaps to what matters** (`src/focus-policy.js`,
  driven like TizenTube's `ui.js` with `__spatialNavigation__.keyMode = 'NONE'`)
  plus an always-visible `#95FF50` focus ring with tile zoom. Snappable:
  search/fields, poster tiles (by rendered size, even image-only),
  text-labeled controls (episodes, chips, CTAs), the `<video>` element,
  dialog buttons, **player controls** (play/pause, ±10s skip, seek/volume
  sliders, mute, subtitles, settings, PiP, fullscreen — approved via the
  `data-tj-player` zone around each `<video>`, so icon-only 40px bar buttons
  survive the speck rules), and the floating search button (only while shown;
  hidden it would be an invisible focus trap). Skipped (parked at
  `tabindex="-1"`, restored if they ever qualify): layout containers (rails,
  billboards, section blocks — their tiles get focus, never the wrapper),
  footer links, ad slots, icon-only micro-buttons *outside* the player,
  hidden/disabled, `aria-hidden`, and anything the site itself
  removed from tab order. Geometry + semantics only — no class names, so
  Svelte rebuilds can't break it.
- **Player arrows** (`src/tv.js` + `src/rows.js`): a focused video behaves like
  a native TV player — ◀/▶ scrubs ±10s and stays on the video, ▲/▼ drops into
  the control bar (remembered button first, else Play/Pause). On a focused
  seek/volume slider ◀/▶ adjusts natively (fires `input`/`change` so the
  custom bar follows); ▲/▼ leaves so it never traps focus. The slider itself
  is `opacity:0`, so focus highlights the visible progress bar instead
  (`.tj-seek-focus`). Any arrow press wakes the auto-hiding control bar via a
  synthetic `mousemove`. Left/Right inside the bar steps button-to-button
  through the row logic.
- **Row-aware arrows** (`src/rows.js`, the Netflix feel): Left/Right steps to
  the adjacent tile and stays clamped in the rail; Up/Down hops to the
  nearest rail preserving column, landing on the remembered tile (focus
  memory per row). Header, hero buttons and dialogs fall through to the
  spatial polyfill.
- **IME-safe search** (`src/search-fix.js`): fields are fully native — arrows,
  cursor and composition events are never hijacked, Up/Down never blurs
  mid-typing. Pristine-empty Enter passes through untouched because on Tizen
  that keypress *is* the keyboard show scene (`preventDefault` kills it).
  Enter after typing submits **only** through a real submit path (enclosing
  `<form>` or an in-form submit button); on live-filter pages like `/search`
  (no form — verified the site ignores `?q=`) Enter passes through natively
  so the site's own handling runs, and decorative icon buttons are never
   auto-clicked. Back closes the keyboard first, goes back on second press.
  GREEN focuses search anywhere and summons the on-screen TV keyboard (below),
  and `/search` routes autofocus on arrival — verified end-to-end by remote
  alone: tile → ▲▲ → header → ▶×5 → Search → OK → `/search` with the field
  focused.
- **On-screen TV keyboard** (`src/keyboard.js`, no IME needed): focusing any
  search field summons a 42-key grid (A–Z 0–9, Space, ⌫, Clear, Done, Exit)
  at the bottom of the screen. Arrows move in the grid (clamped at the edges),
  OK types the focused key without leaving it, results live-filter as you type.
  Exits: ▲ from the top row returns to the field, ▼ from the field enters the
  keyboard, ▲ from the field reaches the top bar, Done jumps to results,
  Back closes the keyboard first. Top-bar icon buttons (back, search,
  settings) are approved by a top-of-viewport (y < 120) rule since cinejoy
  uses divs instead of `<header>`.
- **Full remote map**: arrows/OK, Return/Exit back, media keys (play/pause/stop/
  ±10s seek/±30s chapter skip, `0`–`9` percentage seek), `CH ▲▼` page scroll,
  `RED` home, `GREEN` search, `YELLOW` help overlay, `BLUE` video fullscreen.
- **Working keyboard search** (the hard part on Tizen):
  - On-screen TV keyboard (see above) — works with zero IME / no USB keyboard.
  - IME-safe — composition events (`keyCode 229`) and `←/→` cursor moves are
    never hijacked inside text fields; `↑` leaves to the top bar, `↓` enters
    the TV keyboard, so focus can never get stuck in the field.
  - Physical USB/BT keyboards: printable keys always reach the field.
  - `OK/Enter` submits (native form → nearby search button → `/search?q=…`
    fallback), `Return` first closes the TV keyboard, second press goes back.
  - `GREEN` (or the floating ⌕ button) focuses search from anywhere.
- **Old-TV compat**: Rollup + Babel targeting **Chrome 47** (Tizen 3.0, like
  TizenTube's `rollup.config.js`), plus `compat.js` polyfills (`Array.flat`,
  `Element.closest`, `CustomEvent`, …) and `whatwg-fetch`.
- **Light popup-blocker** for mirror popunders (only allows `window.open` from
  a focused link/button).

## Test before touching the TV

1. **Unit/jsdom**: `npm test` — manifest schema, boot, search,
   GREEN key, focus policy, TV keyboard, player zones, network transparency.
   No TV needed.
2. **Visual, against the REAL site** (see the actual webpage):
   ```sh
   npm run test:visual   # builds + proxies https://cinejoy.to → http://localhost:8123/
   ```
   Open `http://localhost:8123/` — that's the live cinejoy.to, with the
   module injected plus an on-screen TV remote (bottom-right). Arrows move
   the green ring, GREEN focuses search, type + OK submits real searches,
   play a title and try OK/FF/RW/BLUE.
3. **No-proxy alternative**: load `dist/cinejoy.js` into
   [Tampermonkey](https://www.tampermonkey.net/) with
   `@match https://cinejoy.to/*` and browse the real site directly, driving
   keys via `test/remote-emulator.snippet.js` (`tv("green")`, `tv("back")`).
4. **True Tizen WebKit**: Tizen Studio's TV Emulator
   (`~/tizen-studio/tools/emulator`) + `sdb`/`tizen install`, same flow as a
   physical TV but slow to set up.
5. **On-TV final**: TizenBrew loads modules from the npm CDN, so the TV test
   requires `npm publish` first (use a beta, e.g. `1.0.0-beta.1`), then add
   the package in TizenBrew's module manager and launch CineJoy.

## Install on your TV

1. Install **TizenBrew** ([guide](https://github.com/reisxd/TizenBrew)) and open it.
2. Publish this package to npm (TizenBrew fetches modules from jsDelivr):
   ```sh
   npm run build
   npm publish --access public   # publishes dist/cinejoy.js + package.json
   ```
3. In TizenBrew's module manager add `tizen-cinejoy` (or
   `@your-scope/tizen-cinejoy` if you renamed it).
4. Launch **CineJoy** from the TizenBrew home screen.
5. Local dev loop without publishing: point `websiteURL` at a local mirror or
   sideload `dist/cinejoy.js` as a userscript — the bundle is self-contained.

> `package.json` (`appName`, `websiteURL`, `main`, `keys`) is the module
> manifest TizenBrew reads via `https://cdn.jsdelivr.net/<pkg>/package.json`,
> and `keys` are registered through `tizen.tvinputdevice.registerKey` —
> same mechanism as TizenTube.

## Remote map

| Key | Action |
|---|---|
| `◀▲▼▶` / `OK` | Move / select (`OK` on video = play-pause) |
| `Return` / `Exit` | Back (in search: 1st press closes keyboard) |
| `⏯ ▶ ⏸ ■` | Play / pause / stop |
| `⏩ ⏪` | Seek ±10s (`TrackNext/Prev`: ±30s) |
| `0`–`9` | Jump to % of video |
| `CH ▲▼` | Scroll page |
| `RED` | Home (`/`) |
| `GREEN` | Focus search |
| `YELLOW` | Help overlay |
| `BLUE` | Fullscreen video |

## Signing — you don't sign this module

This package needs **no Tizen signing**. TizenBrew fetches it at runtime from
jsDelivr (`https://cdn.jsdelivr.net/<pkg>/package.json` + `main` bundle) and
injects it into the page — there is no `.wgt`, no Certificate Manager step,
and no DUID involved. Only the **TizenBrew host app itself** must be signed
and installed once per TV:

- **Preferred:** [TizenBrew Installer Desktop](https://github.com/reisxd/TizenBrewInstaller/releases/latest)
  handles certificates for you. Put the TV in Developer Mode first: open
  **Apps**, type `12345`, set Developer Mode **On** with your PC's IP as
  **Host PC IP**, reboot. On **Tizen 7+** the installer prompts a Samsung
  account sign-in to create the Samsung certificate.
- **Manual resign** (expired cert, new TV): in Tizen Studio's Certificate
  Manager create a **Samsung certificate** (author + distributor, TV's DUID
  registered via `sdb connect <TV IP>`), then:
  ```sh
  tizen package -t wgt -s <profile> -o ./resigned -- path/to/TizenBrewStandalone.wgt
  tizen install -n ./resigned/TizenBrewStandalone.wgt
  ```
  (`tizen` lives in `~/tizen-studio/tools/ide/bin`, `sdb` in
  `~/tizen-studio/tools`.) Set Host PC IP to `127.0.0.1` afterwards.

The `http://tizen.org/privilege/tv.inputdevice` privilege behind `keys` is
public level, so no partner-level certificate is ever needed for this module.

## Develop

```sh
npm install
npm run build   # src/userScript.js -> dist/cinejoy.js (Chrome 47, ES5, minified)
npm test        # jsdom checks: manifest, boot, search, GREEN key, focus, keyboard
```

Layout: `src/userScript.js` (entry/host gate) · `src/compat.js` (ES5-safe
polyfills) · `src/spatial-navigation-polyfill.js` + `src/domrect-polyfill.js`
(same sources as TizenTube) · `src/tv.js` (focus/keys/video/help/toast) ·
`src/search-fix.js` (IME + keyboard search) · `src/keyboard.js` (on-screen TV
keyboard) · `src/rows.js` (row-aware arrows) · `src/focus-policy.js` (snap
targets) · `src/ui.css` (focus ring/toast/help/keyboard) · `test/tv.test.js` (jsdom suite) · `test/remote-emulator.snippet.js`
(console key sender) · `test/manual/server.mjs` (live dev proxy) +
`test/manual/demo.html` (ad-trap lab) · `test/manual/render.mjs` (headless
Chromium screenshots + DOM dumps of the real site; needs `npm i -D
playwright` + `npx playwright install --only-shell chromium`).

Gotcha we hit: observing `class`/`style` in a `MutationObserver` whose callback
writes classes loops forever (thousands of callbacks, timers starve — the page
looks frozen). Observers here are `childList`-scoped + debounced, and every
DOM write is guarded (`contains`/`hasAttribute` checks before `add`/`set`).
