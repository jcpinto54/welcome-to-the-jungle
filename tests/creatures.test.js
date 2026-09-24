'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// creatures.js must load without THREE: only the pure steering code runs here.
const { Creatures, STEP } = load(['src/core.js', 'src/creatures.js'], ['Creatures', 'STEP']);
const S = Creatures.steer;
const DT = 1 / 60;
const flat = () => 0;
const env = (px, pz, extra = {}) => ({ player: { x: px, y: 0, z: pz }, heightAt: flat, t: 0, pulse: 0, ...extra });
const hdist = (a, x, z) => Math.hypot(a.x - x, a.z - z);

// Runs moth steering for `secs`, optionally moving the player each frame.
function runMoth(s, e, secs, { flock, each } = {}) {
  let out = null;
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    e.t += DT;
    if (each) each(e, i);
    out = S.moth(s, e, DT, flock);
  }
  return out;
}

test('moth state starts alive at home with 2 hp', () => {
  const s = S.newMoth(3, 1, -4);
  assert.equal(s.hp, 2);
  assert.equal(s.alive, true);
  assert.equal(s.homeX, 3);
  assert.equal(s.homeZ, -4);
  assert.equal(s.aggro, false);
});

test('moth ignores a far player and drifts around home', () => {
  const s = S.newMoth(0, 2, 0);
  const e = env(40, 0);
  runMoth(s, e, 6);
  assert.equal(s.aggro, false);
  assert.ok(hdist(s, 0, 0) < 2.5, 'stays near home, got ' + hdist(s, 0, 0));
});

test('moth aggroes on a near player and closes in', () => {
  const s = S.newMoth(0, 2, 0);
  const e = env(S.MOTH.aggro - 2, 0);
  runMoth(s, e, 3);
  assert.equal(s.aggro, true);
  assert.ok(hdist(s, e.player.x, e.player.z) < 1.8, 'reaches the player, got ' + hdist(s, e.player.x, e.player.z));
});

test('moth gives up and flies home when the player leaves', () => {
  const s = S.newMoth(0, 2, 0);
  const e = env(6, 0);
  runMoth(s, e, 1.5);
  assert.equal(s.aggro, true);
  e.player.x = 80;
  runMoth(s, e, 10);
  assert.equal(s.aggro, false);
  assert.ok(hdist(s, 0, 0) < 2.5, 'back home, got ' + hdist(s, 0, 0));
});

test('moth never chases past its leash', () => {
  const s = S.newMoth(0, 2, 0);
  const e = env(4, 0);
  let far = 0;
  // the player walks slowly away; the moth could keep up but must turn back at the leash
  runMoth(s, e, 20, { each: (en) => { en.player.x += 3 * DT; far = Math.max(far, hdist(s, 0, 0)); } });
  assert.ok(far <= S.MOTH.leash + 1, 'max distance from home ' + far);
  assert.ok(hdist(s, 0, 0) < S.MOTH.leash, 'turned back');
});

test('moth hovers 1.5..2.5 above uneven ground, idle and chasing', () => {
  const hill = (x, z) => Math.sin(x * 0.4) * 2 + z * 0.15;
  const s = S.newMoth(0, 30, 0); // spawned far too high on purpose
  const e = env(30, 0, { heightAt: hill });
  let lo = Infinity, hi = -Infinity;
  const track = () => { const h = s.y - hill(s.x, s.z); lo = Math.min(lo, h); hi = Math.max(hi, h); };
  runMoth(s, e, 4, { each: () => { if (e.t > DT * 2) track(); } });
  e.player.x = 3; e.player.z = 2; // now chase across the slope
  runMoth(s, e, 4, { each: (en) => { en.player.x += 2 * DT; track(); } });
  assert.ok(lo >= 1.5 - 1e-9, 'lowest hover ' + lo);
  assert.ok(hi <= 2.5 + 1e-9, 'highest hover ' + hi);
});

test('moths in a flock keep apart', () => {
  const flock = [S.newMoth(0, 2, 0), S.newMoth(0, 2, 0), S.newMoth(0.05, 2, 0)];
  const e = env(5, 0);
  for (let i = 0; i < 180; i++) { e.t += DT; for (const m of flock) S.moth(m, e, DT, flock); }
  for (let i = 0; i < flock.length; i++) {
    for (let j = i + 1; j < flock.length; j++) {
      const a = flock[i], b = flock[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      assert.ok(d >= S.MOTH.minSep * 0.95, `moths ${i},${j} are ${d.toFixed(2)} apart`);
    }
  }
});

test('moth bites a touching player, then waits for its cooldown', () => {
  const s = S.newMoth(0, 2, 0);
  const e = env(0, 0);
  s.aggro = true;
  s.x = 0.2; s.z = 0;
  e.t += DT;
  assert.equal(S.moth(s, e, DT).bite, true);
  let again = 0;
  const frames = Math.floor((S.MOTH.biteCd - 0.1) / DT);
  for (let i = 0; i < frames; i++) { e.t += DT; s.x = 0.2; s.z = 0; if (S.moth(s, e, DT).bite) again++; }
  assert.equal(again, 0, 'no second bite inside the cooldown');
  runMoth(s, e, 0.3, { each: () => { s.x = 0.2; s.z = 0; } });
  assert.ok(s.cd > 0, 'bit again after the cooldown');
});

test('hit(): damage, one death, no damage after death', () => {
  const s = S.newMoth(0, 2, 0);
  assert.equal(S.hit(s, 1, -1, 0), false);
  assert.equal(s.hp, 1);
  assert.equal(s.alive, true);
  assert.ok(s.flash > 0, 'flashes when hit');
  assert.equal(S.hit(s, 1, -1, 0), true, 'the killing blow reports death');
  assert.equal(s.alive, false);
  assert.equal(S.hit(s, 5, -1, 0), false, 'a dead moth cannot die again');
  assert.equal(s.hp, 0);
});

test('hit(): knockback pushes away from the source, then decays', () => {
  const s = S.newMoth(0, 2, 0);
  S.hit(s, 0.5, -1, 0);
  assert.ok(s.kx > 0 && Math.abs(s.kz) < 1e-9, 'pushed along +x, away from the hit');
  const e = env(60, 0);
  runMoth(s, e, 0.25);
  assert.ok(s.x > 0.8, 'moved away, x = ' + s.x);
  runMoth(s, e, 2);
  assert.ok(Math.hypot(s.kx, s.kz) < 0.05, 'knockback decayed');
  // a hit from exactly on top still pushes somewhere
  const t = S.newMoth(0, 2, 0);
  S.hit(t, 0.5, 0, 0);
  assert.ok(Math.hypot(t.kx, t.kz) > 0);
});

test('the warden is heavier: 12 hp and less knockback', () => {
  const w = S.newWarden(0, 0, 0), m = S.newMoth(0, 2, 0);
  assert.equal(w.hp, 12);
  S.hit(w, 1, -1, 0); S.hit(m, 1, -1, 0);
  assert.equal(w.hp, 11);
  assert.ok(w.kx > 0 && w.kx < m.kx);
  for (let i = 0; i < 10; i++) S.hit(w, 1, -1, 0);
  assert.equal(w.alive, true);
  assert.equal(S.hit(w, 1, -1, 0), true);
});

test('a dead moth falls and is gone after its death animation', () => {
  const s = S.newMoth(0, 2, 0);
  S.hit(s, 9, -1, 0);
  const y0 = s.y;
  runMoth(s, env(0, 0), 0.5);
  assert.ok(s.y < y0, 'falls');
  assert.equal(s.gone, false);
  runMoth(s, env(0, 0), 1.5);
  assert.equal(s.gone, true);
});

// ---- Hush Warden ----

// Steps the warden with a song position that advances `stepsPerFrame` 16ths each frame.
function runWarden(w, e, frames, stepsPerFrame, onFrame) {
  let out;
  for (let i = 0; i < frames; i++) {
    e.t += DT;
    if (typeof e.songPos === 'number') e.songPos += stepsPerFrame;
    out = S.warden(w, e, DT);
    if (onFrame) onFrame(out, i);
  }
  return out;
}

test('warden emits silence rings exactly on its bar lines', () => {
  const w = S.newWarden(0, 0, 0);
  const e = env(6, 0, { songPos: 10 });
  const every = S.WARDEN.ringEvery;
  const spawnedAt = [];
  runWarden(w, e, 400, 0.5, (out) => { if (out.spawned) spawnedAt.push(e.songPos); });
  // song ran from 10 to 210: expect one ring per `every` bars, each on the first frame of that bar
  const expected = [];
  for (let bar = 1; bar * 16 <= 210; bar++) if (bar % every === 0) expected.push(bar * 16);
  assert.deepEqual(spawnedAt, expected);
});

test('warden falls back to wall-clock time when there is no song', () => {
  const w = S.newWarden(0, 0, 0);
  const e = env(6, 0); // no songPos
  let n = 0;
  const bars = 6;
  const frames = Math.round((bars * 16 * STEP) / DT) + 2; // just past the last bar line
  runWarden(w, e, frames, 0, (out) => { if (out.spawned) n++; });
  assert.equal(n, Math.floor(bars / S.WARDEN.ringEvery));
});

test('warden stays quiet when the player is far away', () => {
  const w = S.newWarden(0, 0, 0);
  const e = env(S.WARDEN.aggro + 20, 0, { songPos: 0 });
  const out = runWarden(w, e, 300, 0.5);
  assert.equal(out.rings.length, 0);
});

test('rings expand at a steady speed and vanish at their max radius', () => {
  const w = S.newWarden(0, 0, 0);
  const e = env(6, 0, { songPos: 15.9 });
  S.warden(w, e, DT); // first frame only syncs the bar
  e.songPos = 16 * S.WARDEN.ringEvery;
  const out = S.warden(w, e, DT);
  assert.equal(out.spawned, true);
  const ring = out.rings[0];
  assert.equal(ring.x, w.x);
  const r0 = ring.r;
  for (let i = 0; i < 30; i++) S.warden(w, e, DT);
  assert.ok(Math.abs(ring.r - r0 - S.WARDEN.ringSpeed * 30 * DT) < 1e-6, 'r grows by speed * time');
  const life = S.WARDEN.ringMax / S.WARDEN.ringSpeed;
  for (let i = 0; i < Math.ceil(life / DT); i++) S.warden(w, e, DT);
  assert.equal(w.rings.includes(ring), false, 'ring removed at max radius');
});

test('ringHit tests the ring band against the player distance', () => {
  const ring = { x: 0, z: 0, r: 5, band: 1, hit: false };
  assert.equal(S.ringHit(ring, 5, 0), true);
  assert.equal(S.ringHit(ring, 0, -5.45), true);
  assert.equal(S.ringHit(ring, 3, 4), true);
  assert.equal(S.ringHit(ring, 5.6, 0), false);
  assert.equal(S.ringHit(ring, 4.4, 0), false);
  assert.equal(S.ringHit(ring, 0, 0), false);
  ring.hit = true;
  assert.equal(S.ringHit(ring, 5, 0), false, 'a ring hits only once');
});

test('an expanding ring hits a standing player exactly once', () => {
  const w = S.newWarden(0, 0, 0);
  w.x = 0; w.z = 0;
  const e = env(7, 0, { songPos: 0 });
  let hits = 0;
  runWarden(w, e, 900, 0.25, (out) => { if (out.hit) hits++; w.x = 0; w.z = 0; });
  assert.ok(w.rings.length <= Math.ceil(S.WARDEN.ringMax / S.WARDEN.ringSpeed / (16 * STEP * S.WARDEN.ringEvery)) + 1);
  // 900 frames at 0.25 steps/frame = 225 steps = 14 bars: one hit per ring that reached radius 7
  const rings = Math.floor(225 / 16 / S.WARDEN.ringEvery);
  assert.ok(hits >= rings - 1 && hits <= rings, `hits ${hits} for ${rings} rings`);
});

test('warden drifts toward the player but keeps its distance and its leash', () => {
  const w = S.newWarden(0, 0, 0);
  const e = env(14, 0, { songPos: 0 });
  runWarden(w, e, 600, 0.25);
  const d = hdist(w, 14, 0);
  assert.ok(w.x > 1, 'moved toward the player');
  assert.ok(d >= S.WARDEN.keep - 0.5, 'keeps its distance, d = ' + d);
  e.player.x = 60;
  runWarden(w, e, 1800, 0.25);
  assert.ok(hdist(w, 0, 0) <= S.WARDEN.leash + 0.5, 'leashed to home');
});
