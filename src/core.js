'use strict';
/* core.js: shared constants and small helpers. Loaded first. */

// Music: 170 BPM jungle, 16th-note steps, a loop is two bars.
const BPM = 170;
const STEP = 60 / BPM / 4;
const BEAT = STEP * 4;
const LOOP = 32;

const LANES = ['kick', 'snare', 'bass'];
const LANE_COLOR = { kick: '#ffb13b', snare: '#ff4fd8', bass: '#a57bff' };
const LANE_HEX = { kick: 0xffb13b, snare: 0xff4fd8, bass: 0xa57bff };
const LANE_NAME = { kick: 'KICK', snare: 'SNARE', bass: 'BASS' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (a, n) => ((a % n) + n) % n;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Small deterministic RNG so the jungle grows the same way every visit.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 2D value noise, used for terrain and texture variation.
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); f *= 2; amp *= 0.5; }
  return s;
}

// Colours are used exactly as written (no colour management), like the old consoles.
if (window.THREE) THREE.ColorManagement.enabled = false;
