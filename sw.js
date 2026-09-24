'use strict';
/* sw.js: the offline cache, registered by src/pwa.js.
   Same-origin files are network first, so a reload always gets fresh code; the cache only
   answers when the network fails (or hangs with a cached copy ready). three.js from cdnjs
   and Google Fonts are stale-while-revalidate. Bump VERSION when PRECACHE changes. */

const APP = 'jungle-wizard';
const VERSION = 1;
// GitHub Pages sites share one origin, so the cache name carries the install path too.
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE = `${APP}-v${VERSION}:${SCOPE}`;

// Everything index.html loads, relative to this file (tests/e2e/pwa.test.cjs keeps it in sync).
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/style.css',
  'src/core.js',
  'src/sequencer.js',
  'src/sound.js',
  'src/terrain.js',
  'src/textures.js',
  'src/world.js',
  'src/render.js',
  'src/wizard.js',
  'src/creatures.js',
  'src/quest.js',
  'src/input.js',
  'src/ui.js',
  'src/game.js',
  'src/pwa.js',
  'vendor/three.min.js',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
];

const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const THREE_CDN = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/[^/]+\/three\.min\.js$/;
const NET_TIMEOUT = 4000; // ms a hanging network gets before a cached copy is served instead

const local = (p) => new URL(p, self.location).href;
const noop = () => {};
// A cache that can't be opened or read (private modes, storage pressure) must never take
// the page down with it: the strategies below then fall back to the plain network.
const openCache = () => caches.open(CACHE).catch(() => null);
const lookup = (cache, req, opts) => cache.match(req, opts).catch(() => undefined);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const mine = (name) => name.startsWith(APP + '-v') && name.endsWith(':' + SCOPE);
    for (const name of await caches.keys()) if (mine(name) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return; // Chrome devtools quirk
  if (req.url.startsWith(self.registration.scope)) event.respondWith(networkFirst(event));
  else if (CDN.test(req.url)) event.respondWith(staleWhileRevalidate(event));
});

// Fresh copies of every file. One that can't be fetched keeps its copy from an older cache,
// so a flaky connection never leaves the new cache worse off than the old one.
async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(PRECACHE.map(async (path) => {
    const url = local(path);
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) return await cache.put(url, res.redirected ? await unredirect(res) : res);
    } catch (e) { /* offline or blocked: keep the older copy below */ }
    const old = await caches.match(url);
    if (old) await cache.put(url, old);
  }));
}

// Safari won't use a redirected response for a navigation, so store a clean copy.
async function unredirect(res) {
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Fetches the request and keeps a copy of the response when keep(response) says so.
function fetchAndKeep(event, cache, keep) {
  const network = fetch(event.request).then((res) => {
    if (keep(res)) event.waitUntil(cache.put(event.request, res.clone()).catch(noop));
    return res;
  });
  event.waitUntil(network.then(noop, noop));
  return network;
}

async function networkFirst(event) {
  const req = event.request;
  const nav = req.mode === 'navigate';
  const cache = await openCache();
  if (!cache) return fetch(req);
  const network = fetchAndKeep(event, cache, (res) => res.status === 200 && res.type === 'basic');
  const cached = lookup(cache, req, { ignoreVary: true, ignoreSearch: nav })
    .then((hit) => hit || (nav ? lookup(cache, local('index.html')) : undefined));
  const slow = cached.then((hit) => (hit ? new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT, hit)) : network));
  try {
    return await Promise.race([network, slow]);
  } catch (e) {
    return (await cached) || Response.error();
  }
}

// Answers from the cache at once and refreshes it in the background. Opaque (no-cors)
// responses are kept as they are. With nothing cached and no network, three.js falls
// back to the vendored copy and the font stylesheet to an empty one.
async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await openCache();
  if (!cache) return fetch(req);
  const network = fetchAndKeep(event, cache, (res) => res.ok || res.type === 'opaque');
  const hit = await lookup(cache, req, { ignoreVary: true });
  if (hit) return hit;
  try {
    return await network;
  } catch (e) {
    if (THREE_CDN.test(req.url)) return (await lookup(cache, local('vendor/three.min.js'))) || Response.error();
    if (req.url.startsWith('https://fonts.googleapis.com/')) return new Response('', { headers: { 'Content-Type': 'text/css' } });
    return Response.error();
  }
}
