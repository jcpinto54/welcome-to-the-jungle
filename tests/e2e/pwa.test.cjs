'use strict';
// The PWA layer: the manifest, the icons, the service worker's precache list, the rules
// src/pwa.js follows before registering, and real install -> offline round trips served
// by http-server. The browser tests use a copy of the site in a temp dir with a stand-in
// index.html (so they can edit files and don't depend on the game being finished); the
// last test runs the real index.html once all of its scripts exist.

// Playwright only routes a service worker's own fetches when this is set before the browser
// starts. (context.setOffline() reaches the worker too, but only until the page reloads, so
// "offline" below also aborts every routed request and checks the server saw nothing.)
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const INDEX = read('index.html');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* browser tests are skipped */ }
const HTTP_SERVER = [
  () => require.resolve('http-server/bin/http-server'),
  () => '/opt/node22/lib/node_modules/http-server/bin/http-server',
].map((f) => { try { return f(); } catch (e) { return null; } }).find((p) => p && fs.existsSync(p));

// ---------- index.html, manifest and sw.js as data ----------

const isLocal = (u) => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
const clean = (u) => (u === './' ? u : u.replace(/[?#].*$/, '').replace(/^\.\//, ''));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
const LINKS = [...INDEX.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
const link = (rel) => LINKS.find((l) => (l.rel || '').split(/\s+/).includes(rel));

// Every local file index.html points at, including the document.write fallback for three.js.
function localRefs(html) {
  const refs = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/gi)) if (isLocal(m[1])) refs.add(clean(m[1]));
  return [...refs];
}

const manifestFile = () => clean(link('manifest').href);
const manifest = () => JSON.parse(read(manifestFile()));

function pngSize(buf) {
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Runs sw.js in a bare worker-like global and hands back its top-level constants.
function loadSW(scope = 'https://jw.example/game/', src = read('sw.js')) {
  const listeners = {};
  const ctx = vm.createContext({ URL, console, setTimeout, clearTimeout, Response, Request, Headers });
  Object.assign(ctx, {
    self: ctx,
    registration: { scope },
    location: new URL('sw.js', scope),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  });
  vm.runInContext(src, ctx, { filename: 'sw.js' });
  // Arrays are copied out of the vm's realm, or deepStrictEqual sees a foreign prototype.
  const get = (name) => { const v = vm.runInContext(name, ctx); return Array.isArray(v) ? [...v] : v; };
  return { get, listeners };
}

// Loads src/pwa.js with the given globals; console output is captured, not printed.
function loadPWA(globals = {}) {
  const log = { error: [], warn: [] };
  const console = { error: (...a) => log.error.push(a.join(' ')), warn: (...a) => log.warn.push(a.join(' ')), log() {}, info() {} };
  const ctx = vm.createContext({ URL, console, ...globals });
  vm.runInContext(read('src/pwa.js'), ctx, { filename: 'src/pwa.js' });
  return { PWA: vm.runInContext('PWA', ctx), log };
}

function fakeWin(href, { framed = false, sw = true, topThrows = false, register } = {}) {
  const u = new URL(href);
  const calls = [];
  const win = { location: { href: u.href, protocol: u.protocol, hostname: u.hostname, hash: u.hash }, navigator: {} };
  if (sw) win.navigator.serviceWorker = { register: register || ((url) => { calls.push(url); return Promise.resolve({ scope: url }); }) };
  win.self = win;
  if (topThrows) Object.defineProperty(win, 'top', { get() { throw new Error('SecurityError'); } });
  else win.top = framed ? {} : win;
  return { win, calls };
}

// ---------- static checks ----------

test('the manifest describes a full-screen landscape app with relative URLs', () => {
  const m = manifest();
  assert.equal(m.name, 'Jungle Wizard');
  assert.equal(m.short_name, 'Jungle Wizard');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'fullscreen');
  assert.deepEqual(m.display_override, ['fullscreen', 'standalone']);
  assert.equal(m.orientation, 'landscape');
  assert.equal(m.background_color.toLowerCase(), '#07060f');
  assert.equal(m.theme_color.toLowerCase(), '#07060f');
  assert.ok(typeof m.description === 'string' && m.description.length >= 20 && m.description.length <= 160, 'a short description');
  const meta = INDEX.match(/<meta name="theme-color" content="([^"]+)"/i);
  if (meta) assert.equal(meta[1].toLowerCase(), m.theme_color.toLowerCase(), 'index.html theme-color matches the manifest');
  for (const u of [m.start_url, m.scope, ...m.icons.map((i) => i.src)]) {
    assert.ok(isLocal(u) && !u.startsWith('/'), `${u} is relative, so the app works under a GitHub Pages subpath`);
  }
  const purposes = (i) => (i.purpose || 'any').split(/\s+/);
  for (const size of ['192x192', '512x512']) {
    assert.ok(m.icons.some((i) => i.sizes === size && purposes(i).includes('any')), `an "any" icon at ${size}`);
  }
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && purposes(i).includes('maskable')), 'a 512 maskable icon');
});

test('every icon is a PNG of its declared size', () => {
  const m = manifest();
  const apple = link('apple-touch-icon');
  assert.ok(apple, 'index.html links an apple-touch-icon');
  const icons = [...m.icons, { src: apple.href, sizes: '180x180', type: 'image/png' }];
  for (const icon of icons) {
    const file = clean(icon.src);
    assert.ok(exists(file), `${file} exists`);
    const size = pngSize(fs.readFileSync(path.join(ROOT, file)));
    assert.ok(size, `${file} is a PNG`);
    assert.equal(`${size.width}x${size.height}`, icon.sizes, `${file} is ${icon.sizes}`);
    assert.equal(icon.type, 'image/png', `${file} is typed image/png`);
  }
  const plain = m.icons.find((i) => i.sizes === '512x512' && !(i.purpose || '').includes('maskable'));
  const mask = m.icons.find((i) => (i.purpose || '').includes('maskable'));
  assert.notEqual(clean(plain.src), clean(mask.src), 'the maskable icon is its own file');
  assert.ok(!fs.readFileSync(path.join(ROOT, clean(plain.src))).equals(fs.readFileSync(path.join(ROOT, clean(mask.src)))),
    'the maskable icon is drawn with a safe-zone margin, not a copy');
});

test('the service worker precaches everything index.html loads', () => {
  const list = loadSW().get('PRECACHE');
  for (const p of list) assert.ok(isLocal(p) && !p.startsWith('/'), `${p} is relative to sw.js`);
  const pre = list.map(clean);
  const need = new Set([...localRefs(INDEX), 'index.html', manifestFile(), ...manifest().icons.map((i) => clean(i.src))]);
  assert.deepEqual([...need].filter((r) => !pre.includes(r)), [], 'add these to PRECACHE in sw.js');
  assert.deepEqual(pre.filter((p) => p !== './' && !need.has(p)), [], 'PRECACHE has entries nothing loads any more');
  assert.ok(pre.includes('./'), 'the start URL itself is precached');
  for (const want of ['index.html', 'vendor/three.min.js', 'src/style.css', 'src/pwa.js']) assert.ok(pre.includes(want), want);
});

test('the cache is versioned and kept per install path', () => {
  const a = loadSW('https://jw.example/welcome-to-the-jungle/');
  const b = loadSW('https://jw.example/');
  assert.match(a.get('CACHE'), /^jungle-wizard-v\d+:/);
  assert.ok(a.get('CACHE').endsWith(':/welcome-to-the-jungle/'));
  assert.notEqual(a.get('CACHE'), b.get('CACHE'), 'two copies on one GitHub Pages origin keep separate caches');
  for (const type of ['install', 'activate', 'fetch']) assert.equal(typeof a.listeners[type], 'function', `handles ${type}`);
});

test('every precached file exists (game modules still being written are only reported)', (t) => {
  const missing = loadSW().get('PRECACHE').map(clean).filter((p) => p !== './' && !exists(p));
  const pending = missing.filter((p) => p.startsWith('src/'));
  if (pending.length) t.diagnostic(`not written yet: ${pending.join(', ')}`);
  assert.deepEqual(missing.filter((p) => !pending.includes(p)), []);
});

describe('src/pwa.js registers sw.js only when it is safe', () => {
  test('the rules: http(s), top-level window, localhost only with #sw', async () => {
    const cases = [
      ['https://jw.example/welcome-to-the-jungle/', {}, ''],
      ['http://jw.example/', {}, ''],
      ['https://jw.example/#sw', { framed: true }, 'iframe'],
      ['https://jw.example/', { topThrows: true }, 'iframe'],
      ['file:///home/jw/index.html#sw', {}, 'protocol'],
      ['capacitor://localhost/#sw', {}, 'protocol'],
      ['https://jw.example/', { sw: false }, 'unsupported'],
      ['http://localhost:8080/', {}, 'localhost'],
      ['http://127.0.0.1:8080/index.html', {}, 'localhost'],
      ['http://[::1]:8080/', {}, 'localhost'],
      ['https://localhost/', {}, 'localhost'],
      ['http://game.localhost/', {}, 'localhost'],
      ['http://localhost:8080/#sw', {}, ''],
      ['http://127.0.0.1:8080/#debug&sw', {}, ''],
      ['http://localhost:8080/#swamp', {}, 'localhost'],
    ];
    const { PWA, log } = loadPWA();
    for (const [href, opts, reason] of cases) {
      const { win, calls } = fakeWin(href, opts);
      const label = `${href}${opts.framed || opts.topThrows ? ' (iframe)' : ''}${opts.sw === false ? ' (no SW support)' : ''}`;
      assert.equal(PWA.skipReason(win), reason, label);
      const reg = await PWA.register(win);
      assert.equal(calls.length, reason ? 0 : 1, `${label} ${reason ? 'does not register' : 'registers'}`);
      if (!reason) assert.ok(reg, `${label} resolves to the registration`);
    }
    assert.deepEqual(log.error, []);
  });

  test('sw.js is found next to index.html, also under a subpath and from a test page', () => {
    const at = (script, href) => {
      const { win } = fakeWin(href);
      return loadPWA({ document: { currentScript: script ? { src: script } : null, readyState: 'complete' }, window: win }).PWA.swUrl(win);
    };
    assert.equal(at('https://jw.example/game/src/pwa.js', 'https://jw.example/game/'), 'https://jw.example/game/sw.js');
    assert.equal(at('https://jw.example/game/src/pwa.js', 'https://jw.example/game/tests/e2e/pages/x.html'), 'https://jw.example/game/sw.js');
    assert.equal(at(null, 'https://jw.example/game/index.html'), 'https://jw.example/game/sw.js', 'inlined (no script URL): next to the page');
  });

  test('it registers on load, and never throws or logs errors', async () => {
    const listeners = {};
    const { win, calls } = fakeWin('https://jw.example/game/');
    win.addEventListener = (type, fn) => { listeners[type] = fn; };
    const document = { currentScript: { src: 'https://jw.example/game/src/pwa.js' }, readyState: 'loading' };
    loadPWA({ window: win, document, navigator: win.navigator, location: win.location });
    assert.equal(calls.length, 0, 'waits for the load event');
    assert.equal(typeof listeners.load, 'function');
    listeners.load();
    assert.deepEqual(calls, ['https://jw.example/game/sw.js']);

    const hostile = [
      fakeWin('https://jw.example/', { register: () => Promise.reject(new Error('SecurityError')) }).win,
      fakeWin('https://jw.example/', { register: () => { throw new Error('boom'); } }).win,
      Object.defineProperty({}, 'navigator', { get() { throw new Error('denied'); } }),
      null,
    ];
    const { PWA, log } = loadPWA();
    for (const w of hostile) assert.equal(await PWA.register(w), null);
    assert.deepEqual(log.error, []);

    const broken = { addEventListener() { throw new Error('no events here'); }, navigator: {}, location: {} };
    assert.doesNotThrow(() => loadPWA({ window: broken, document: { readyState: 'loading' } }), 'loading pwa.js never throws');
  });
});

// ---------- in a browser, over http ----------

const THREE_CDN = (INDEX.match(/src="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+three\.min\.js)"/) || [])[1]
  || 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.159.0/three.min.js';
const FONTS_CSS = (INDEX.match(/href="(https:\/\/fonts\.googleapis\.com\/css[^"]*)"/) || [])[1];
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] };

// A stand-in for index.html with the same external resources, the vendored fallback and pwa.js.
function standInPage(marker) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Jungle Wizard</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">
${FONTS_CSS ? `<link rel="stylesheet" href="${FONTS_CSS}">` : ''}
</head>
<body>
<p id="marker">${marker}</p>
<script src="${THREE_CDN}"></script>
<script>window.THREE || document.write('<script src="vendor/three.min.js"><\\/script>');</script>
<script src="src/pwa.js"></script>
</body>
</html>
`;
}

function makeSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-pwa-'));
  for (const rel of ['sw.js', 'manifest.webmanifest', 'assets/icons', 'src', 'vendor/three.min.js']) {
    if (exists(rel)) fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'index.html'), standInPage('v1'));
  fs.writeFileSync(path.join(dir, 'frame.html'), '<!doctype html><title>embed</title><iframe src="index.html#sw"></iframe>\n');
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const ping = (url) => new Promise((resolve) => {
  http.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
});

// http-server with its request log on, so a test can prove nothing reached it while offline.
async function serve(dir) {
  const port = await freePort();
  const proc = spawn(process.execPath, [HTTP_SERVER, dir, '-p', String(port), '-a', '127.0.0.1', '-c-1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let requests = 0;
  proc.stdout.on('data', (d) => { requests += String(d).split('\n').filter((l) => /"GET /.test(l) && !/" Error \(/.test(l)).length; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100 && (await ping(base + '/sw.js')) !== 200; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(await ping(base + '/sw.js'), 200, 'http-server is up');
  return { base, stop: () => proc.kill(), requests: () => requests };
}

// Serves the CDN files locally and blocks everything else external. Offline, every request
// fails, same-origin ones included: context.setOffline() alone stops covering a service
// worker's own fetches after the page reloads.
async function fakeInternet(context, THREE_SRC) {
  const netState = { offline: false, three: 0, fonts: 0 };
  await context.route(/^https?:\/\//, (route) => {
    const url = route.request().url();
    if (netState.offline) return route.abort('internetdisconnected');
    if (new URL(url).hostname === '127.0.0.1') return route.continue();
    if (url === THREE_CDN) {
      netState.three++;
      return route.fulfill({ body: THREE_SRC + '\n;window.__threeFrom = "cdn";', contentType: 'application/javascript' });
    }
    if (url.startsWith('https://fonts.googleapis.com/')) {
      netState.fonts++;
      return route.fulfill({ body: ':root { --fonts: 1; }', contentType: 'text/css' });
    }
    return route.abort('blockedbyclient');
  });
  netState.goOffline = async (off = true) => { netState.offline = off; await context.setOffline(off); };
  return netState;
}

// Records calls to navigator.serviceWorker.register in every frame, then lets them through.
function spyOnRegister() {
  window.__swCalls = [];
  const proto = window.ServiceWorkerContainer && ServiceWorkerContainer.prototype;
  if (!proto) return;
  const register = proto.register;
  proto.register = function (url, opts) { window.__swCalls.push(String(url)); return register.call(this, url, opts); };
}

function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} @ ${m.location().url || ''}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return errors;
}

const controlled = async (page) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });
};

// Goes offline once the server's log has caught up; returns its request count at that point.
async function goOffline(net, page, server) {
  await page.waitForTimeout(300);
  await net.goOffline();
  return server.requests();
}

// Proves the page loads since goOffline() really were offline: the worker's own fetches
// fail, and the server saw no request since `since`.
async function assertStayedOffline(page, server, since) {
  const probe = await page.evaluate(() => fetch('probe.txt?' + Date.now()).then(() => 'online', () => 'offline'));
  assert.equal(probe, 'offline', 'the service worker cannot reach the network');
  await page.waitForTimeout(300); // let the server's log catch up
  assert.equal(server.requests(), since, 'no request reached the server while offline');
}

describe('in a browser over http', { skip: !chromium ? 'playwright is not installed' : !HTTP_SERVER ? 'http-server is not installed' : false }, () => {
  let browser, site, server, THREE_SRC, sw;

  before(async () => {
    THREE_SRC = read('vendor/three.min.js');
    site = makeSite();
    server = await serve(site);
    sw = loadSW(server.base + '/');
    browser = await chromium.launch(LAUNCH);
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) server.stop();
    if (site) fs.rmSync(site, { recursive: true, force: true });
  });

  async function open() {
    const context = await browser.newContext();
    const net = await fakeInternet(context, THREE_SRC);
    await context.addInitScript(spyOnRegister);
    const page = await context.newPage();
    return { context, net, page, errors: watchErrors(page) };
  }

  test('on localhost, pwa.js leaves the page alone unless the URL has #sw', { timeout: 30000 }, async () => {
    const { context, page, errors } = await open();
    try {
      await page.goto(server.base + '/');
      assert.equal(await page.evaluate(() => PWA.skipReason(window)), 'localhost');
      assert.deepEqual(await page.evaluate(() => window.__swCalls), []);
      assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)), 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('inside an iframe (the embedded single-file build), pwa.js does nothing', { timeout: 30000 }, async () => {
    const { context, page, errors } = await open();
    try {
      await page.goto(server.base + '/frame.html');
      const frame = page.frames().find((f) => f.url().endsWith('/index.html#sw'));
      assert.ok(frame, 'the embedded page loaded');
      await frame.waitForFunction(() => document.readyState === 'complete' && typeof PWA === 'object');
      assert.equal(await frame.evaluate(() => PWA.skipReason(window)), 'iframe');
      assert.deepEqual(await frame.evaluate(() => window.__swCalls), []);
      assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)), 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('opened from disk (file://), pwa.js does nothing', { timeout: 30000 }, async () => {
    const { context, page, errors } = await open();
    try {
      await page.goto('file://' + path.join(site, 'index.html') + '#sw');
      assert.match(await page.evaluate(() => PWA.skipReason(window)), /^(protocol|unsupported)$/);
      assert.deepEqual(await page.evaluate(() => window.__swCalls), []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('Chrome reads the manifest without errors', { timeout: 30000 }, async () => {
    const { context, page } = await open();
    try {
      await page.goto(server.base + '/');
      const cdp = await context.newCDPSession(page);
      const res = await cdp.send('Page.getAppManifest');
      assert.ok(res.url.endsWith('/manifest.webmanifest'), res.url);
      assert.deepEqual(res.errors, []);
    } finally {
      await context.close();
    }
  });

  test('the worker installs, precaches the app, clears its old caches and takes control', { timeout: 60000 }, async () => {
    const { context, page, errors } = await open();
    const [APP, VERSION, SCOPE, CACHE] = ['APP', 'VERSION', 'SCOPE', 'CACHE'].map(sw.get);
    const older = `${APP}-v${VERSION - 1}:${SCOPE}`;
    const keep = [`${APP}-v${VERSION - 1}:/another-copy/`, 'someone-elses-app'];
    try {
      // Leftovers on the same origin: an older version of ours, and caches that aren't ours to delete.
      await page.goto(server.base + '/manifest.webmanifest');
      await page.evaluate((names) => Promise.all(names.map((n) => caches.open(n))), [older, ...keep]);

      await page.goto(server.base + '/#sw');
      await controlled(page);
      assert.deepEqual(await page.evaluate(() => window.__swCalls), [server.base + '/sw.js']);

      const names = await page.evaluate(() => caches.keys());
      assert.ok(names.includes(CACHE), `${CACHE} was created`);
      assert.ok(!names.includes(older), 'the old version was deleted');
      for (const n of keep) assert.ok(names.includes(n), `${n} was left alone`);

      const want = sw.get('PRECACHE').filter((p) => p === './' || fs.existsSync(path.join(site, clean(p))));
      const inCache = await page.evaluate(async ([name, urls]) => {
        const cache = await caches.open(name);
        return Promise.all(urls.map(async (u) => !!(await cache.match(u))));
      }, [CACHE, want.map((p) => new URL(p, server.base + '/').href)]);
      assert.deepEqual(want.filter((p, i) => !inCache[i]), [], 'precached');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('after the first visit, a reload still works offline', { timeout: 60000 }, async () => {
    const { context, net, page, errors } = await open();
    try {
      await page.goto(server.base + '/#sw');
      await controlled(page);

      const since = await goOffline(net, page, server);
      await page.reload();
      assert.equal(await page.textContent('#marker'), 'v1', 'the cached page');
      assert.equal(await page.evaluate(() => typeof THREE), 'object', 'three.js ran (the vendored copy stands in for the CDN)');
      assert.equal(await page.evaluate(() => typeof PWA), 'object', 'src/pwa.js ran');
      assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), true);

      await page.goto(server.base + '/index.html#sw');
      assert.equal(await page.textContent('#marker'), 'v1', 'index.html is cached under its own name too');
      await page.goto(server.base + '/?source=homescreen#sw');
      assert.equal(await page.textContent('#marker'), 'v1', 'a launch URL with a query string still finds the page');
      assert.deepEqual(errors, []);
      await assertStayedOffline(page, server, since);
    } finally {
      await context.close();
    }
  });

  test('online, files come fresh from the network; CDN files are kept for offline', { timeout: 60000 }, async () => {
    const { context, net, page, errors } = await open();
    const index = path.join(site, 'index.html');
    try {
      await page.goto(server.base + '/#sw');
      await controlled(page);

      fs.writeFileSync(index, standInPage('v2'));
      await page.reload();
      assert.equal(await page.textContent('#marker'), 'v2', 'network first: an edited file shows up on the next reload');
      assert.equal(await page.evaluate(() => window.__threeFrom), 'cdn');

      const since = await goOffline(net, page, server);
      await page.reload();
      assert.equal(await page.textContent('#marker'), 'v2', 'the cache was refreshed from the network');
      assert.equal(await page.evaluate(() => window.__threeFrom), 'cdn', 'three.js from the CDN, kept by the worker');
      if (FONTS_CSS) {
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fonts').trim()), '1',
          'the Google Fonts stylesheet was kept too');
      }
      assert.deepEqual(errors, []);
      await assertStayedOffline(page, server, since);
      errors.length = 0; // the probe's failed fetch is logged

      // Back online a cached CDN file is served at once and refreshed in the background.
      await net.goOffline(false);
      const hits = net.three;
      await page.reload();
      assert.equal(await page.evaluate(() => window.__threeFrom), 'cdn');
      for (let i = 0; i < 50 && net.three === hits; i++) await page.waitForTimeout(100);
      assert.ok(net.three > hits, 'stale-while-revalidate asked the CDN again');
      assert.deepEqual(errors, []);
    } finally {
      fs.writeFileSync(index, standInPage('v1'));
      await context.close();
    }
  });
});

// The real game page, once every script it loads exists (other modules are still being written).
const pendingRefs = localRefs(INDEX).filter((r) => !exists(r));
test('the real index.html loads offline after the first visit', {
  timeout: 120000,
  skip: !chromium || !HTTP_SERVER ? 'needs playwright and http-server'
    : pendingRefs.length ? `index.html still waits for: ${pendingRefs.join(', ')}` : false,
}, async () => {
  const server = await serve(ROOT);
  const browser = await chromium.launch(LAUNCH);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const net = await fakeInternet(context, read('vendor/three.min.js'));
    const page = await context.newPage();
    const errors = watchErrors(page);
    const booted = () => page.waitForFunction(() => window.JW && JW.state === 'boot', null, { timeout: 45000 });

    await page.goto(server.base + '/#sw');
    await booted();
    await controlled(page);

    const since = await goOffline(net, page, server);
    await page.reload();
    await booted();
    assert.equal(await page.title(), 'Jungle Wizard');
    // assets/audio/welcome.mp3 is optional (see DESIGN.md): the probe for it may 404 or fail offline.
    assert.deepEqual(errors.filter((e) => !/\/assets\/audio\//.test(e)), []);
    await assertStayedOffline(page, server, since);
  } finally {
    await browser.close();
    server.stop();
  }
});
