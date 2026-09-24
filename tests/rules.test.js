'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// rules.js is pure: it loads with core.js alone (no THREE, no DOM).
const { Rules, Sequencer, STEP } = load(['src/core.js', 'src/rules.js', 'src/sequencer.js'], ['Rules', 'Sequencer', 'STEP']);
const plain = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ---------- spells ---------- */

test('every spell has a cooldown; the drums play their lanes, dash plays none', () => {
  assert.equal(Rules.spell('stomp').lane, 'kick');
  assert.equal(Rules.spell('bolt').lane, 'snare');
  assert.equal(Rules.spell('quake').lane, 'bass');
  assert.equal(Rules.spell('dash').lane, null);
  assert.equal(Rules.spell('fireball'), null);
  for (const name of ['stomp', 'bolt', 'quake', 'dash']) assert.ok(Rules.spell(name).cd > 0, `${name} has a cooldown`);
});

test('cooldowns let each drum keep up with its part of a 170 BPM groove', () => {
  const beat = STEP * 4;
  assert.ok(Rules.spell('stomp').cd < beat, 'a kick on every beat');
  assert.ok(Rules.spell('bolt').cd < beat / 2, 'snare rolls on 8ths');
  assert.ok(Rules.spell('quake').cd < beat * 2, 'bass on every other beat');
  assert.ok(Rules.spell('quake').cd > Rules.spell('stomp').cd, 'the heavy spell is the slowest');
});

test('casting in the pocket makes each drum spell stronger', () => {
  for (const name of ['stomp', 'bolt', 'quake']) {
    const off = Rules.spell(name, false), on = Rules.spell(name, true);
    assert.equal(off.onBeat, false);
    assert.equal(on.onBeat, true);
    assert.ok(on.damage > off.damage, `${name} hits harder on the beat`);
    assert.equal(on.cd, off.cd, `${name} keeps its cooldown`);
  }
  assert.ok(Rules.spell('stomp', true).radius > Rules.spell('stomp').radius, 'a wider shockwave');
  assert.ok(Rules.spell('quake', true).length > Rules.spell('quake').length, 'longer roots');
  assert.equal(Rules.spell('dash', true).onBeat, false, 'dash is not recorded, so it has no pocket');
});

test('a moth (2 hp) takes two plain bolts or one in the pocket', () => {
  assert.equal(Rules.spell('bolt').damage, 1);
  assert.ok(Rules.spell('bolt', true).damage >= 2);
  assert.ok(Rules.spell('quake').damage >= 2, 'a quake always kills a moth');
});

test('spell() hands out copies, so the table cannot be changed by accident', () => {
  const s = Rules.spell('stomp', true);
  s.damage = 999;
  assert.notEqual(Rules.spell('stomp', true).damage, 999);
});

test('beatPress() times a press so the judge hears it exactly on the nearest beat', () => {
  const seq = Sequencer.create();
  for (const pos of [0, 0.3, 3.1, 5.9, 6.1, 37.2, 101.99]) {
    const now = 5000;
    const t = Rules.beatPress(pos, now, 0);
    const heard = pos + (t - now) / 1000 / STEP; // the position the press will be judged at
    const j = seq.judge(heard);
    assert.equal(j.onBeat, true, `pos ${pos}`);
    assert.ok(Math.abs(j.errMs) < 1e-6, `pos ${pos} err ${j.errMs}`);
    assert.ok(Math.abs(t - now) <= 2 * STEP * 1000 + 1e-6, 'the nearest beat is at most two 16ths away');
  }
  assert.ok(Rules.beatPress(-3, 1000, 0) >= 1000, 'before the first beat, the first beat');
  assert.ok(near(Rules.beatPress(4, 1000, 40), 1040), 'input latency is added back');
});

/* ---------- progression ---------- */

test('the level curve: 10 XP to level 2, each level a little further', () => {
  assert.deepEqual(plain(Rules.level(0)), { level: 1, xp01: 0, into: 0, need: 10 });
  assert.equal(Rules.level(9).level, 1);
  assert.equal(Rules.level(10).level, 2);
  assert.equal(Rules.level(10).into, 0);
  let prev = 0;
  for (let lv = 1; lv < 12; lv++) {
    const need = Rules.xpToNext(lv);
    assert.ok(need > prev, `level ${lv} needs more than the one before`);
    prev = need;
  }
  const r = Rules.level(12);
  assert.ok(r.xp01 > 0 && r.xp01 < 1);
  assert.equal(Rules.level(-5).level, 1);
});

test('levelling up grows the vibe (health) bar, but not past what the HUD shows', () => {
  assert.equal(Rules.maxVibe(1), 3);
  for (let lv = 1; lv < 40; lv++) assert.ok(Rules.maxVibe(lv + 1) >= Rules.maxVibe(lv));
  assert.ok(Rules.maxVibe(6) > Rules.maxVibe(1));
  assert.ok(Rules.maxVibe(99) <= 12);
});

test('XP: fireflies are small, the Warden is big', () => {
  assert.equal(Rules.XP.firefly, 1);
  assert.ok(Rules.XP.moth > Rules.XP.firefly);
  assert.ok(Rules.XP.warden > Rules.XP.moth);
});

test('fireflies along the path can carry a player to about level 7', () => {
  const lv = Rules.level(120 + 14 * Rules.XP.moth).level;
  assert.ok(lv >= 6 && lv <= 9, `level ${lv}`);
});

/* ---------- colour and silence ---------- */

test('each carved stone brings colour back, from grey to full', () => {
  const s = [0, 1, 2, 3].map((n) => Rules.saturation(n));
  assert.ok(s[0] > 0.05 && s[0] < 0.25, 'the start is grey but still reads');
  for (let i = 1; i < 4; i++) assert.ok(s[i] > s[i - 1] + 0.1, `stone ${i} adds colour`);
  assert.ok(near(s[3], 1), 'three stones: full colour');
  assert.ok(Rules.saturation(3, true) >= s[3], 'the finale is at least as vivid');
  assert.equal(Rules.saturation(7), s[3]);
  assert.equal(Rules.saturation(-1), s[0]);
});

test('hush grows as the Hush close in, and the Warden weighs most', () => {
  assert.equal(Rules.hush([]), 0);
  const moth = (d) => ({ kind: 'moth', d, alive: true });
  assert.equal(Rules.hush([moth(50)]), 0, 'far moths are silent');
  assert.ok(Rules.hush([moth(2)]) > Rules.hush([moth(8)]), 'closer is louder silence');
  assert.ok(Rules.hush([moth(3), moth(3)]) > Rules.hush([moth(3)]), 'a swarm hushes more');
  assert.ok(Rules.hush([{ kind: 'warden', d: 8, alive: true }]) > Rules.hush([moth(8)]));
  assert.equal(Rules.hush([{ kind: 'moth', d: 1, alive: false }]), 0, 'the dead are quiet');
  const many = Array.from({ length: 20 }, () => moth(0.5));
  assert.equal(Rules.hush(many), 1, 'never more than full hush');
  assert.ok(Rules.hush([moth(0)]) < 0.6, 'one moth alone never mutes the song');
});

/* ---------- aiming ---------- */

test('auto-aim picks the nearest target inside the cone, else straight ahead', () => {
  // facing 0 = +z (the wizard faces local +Z)
  const a = { x: 0, z: 10, id: 'ahead' }, b = { x: 1, z: 5, id: 'closer' }, side = { x: 6, z: 0.5, id: 'side' }, back = { x: 0, z: -3, id: 'back' };
  assert.equal(Rules.autoAim(0, 0, 0, [a, b, side, back]).id, 'closer');
  assert.equal(Rules.autoAim(0, 0, 0, [a, side, back]).id, 'ahead', 'side and back are outside the cone');
  assert.equal(Rules.autoAim(0, 0, 0, [side, back]), null, 'nothing in front: straight ahead');
  assert.equal(Rules.autoAim(0, 0, Math.PI, [a, back]).id, 'back', 'turning round finds the one behind');
  assert.equal(Rules.autoAim(0, 0, Math.PI / 2, [side]).id, 'side', 'facing +x');
  assert.equal(Rules.autoAim(0, 0, 0, [{ x: 0, z: 200 }]), null, 'out of range');
  assert.equal(Rules.autoAim(0, 0, 0, [{ x: 0, z: 4, alive: false }]), null, 'the dead are not targets');
  assert.equal(Rules.autoAim(0, 0, 0, []), null);
});

test('auto-aim works across the -pi/pi seam', () => {
  const t = { x: -0.5, z: -8 };
  assert.equal(Rules.autoAim(0, 0, Math.PI - 0.01, [t]), t);
  assert.equal(Rules.autoAim(0, 0, -Math.PI + 0.01, [t]), t);
});

test('bearing: positive means the target is to the right of the view', () => {
  // yaw 0 looks along +z (south); your right hand points west (-x)
  assert.ok(near(Rules.bearing(0, 0, 0, -5, 0), Math.PI / 2));
  assert.ok(near(Rules.bearing(0, 0, 0, 5, 0), -Math.PI / 2));
  assert.ok(near(Rules.bearing(0, 0, 0, 0, 5), 0));
  assert.ok(near(Math.abs(Rules.bearing(0, 0, 0, 0, -5)), Math.PI));
  assert.ok(near(Rules.bearing(Math.PI / 2, 0, 0, 0, 5), Math.PI / 2), 'looking east, south is on the right');
});

test('wrapAngle keeps angles in (-pi, pi]', () => {
  for (const a of [0, 1, -1, 3.5, -3.5, 7, -7, 100]) {
    const w = Rules.wrapAngle(a);
    assert.ok(w > -Math.PI - 1e-12 && w <= Math.PI + 1e-12, `${a} -> ${w}`);
    assert.ok(near(Math.cos(w), Math.cos(a), 1e-9) && near(Math.sin(w), Math.sin(a), 1e-9));
  }
});

/* ---------- geometry for spells ---------- */

test('segment distance and box hits for the quake line', () => {
  assert.ok(near(Rules.segDist(0, 5, -3, 0, 3, 0), 5));
  assert.ok(near(Rules.segDist(5, 0, -3, 0, 3, 0), 2), 'past the end: distance to the end point');
  const gate = { x0: 56.6, z0: -70.9, x1: 65.4, z1: -69.1 };
  assert.equal(Rules.segHitsBox(61, -65, 61, -76, gate), true, 'roots running north through the gate');
  assert.equal(Rules.segHitsBox(61, -65, 61, -68, gate), false, 'roots that stop short');
  assert.equal(Rules.segHitsBox(61, -65, 61, -68, gate, 1.2), true, '... unless they are wide');
  assert.equal(Rules.segHitsBox(70, -65, 70, -76, gate), false, 'roots beside the gate');
});

/* ---------- camera ---------- */

test('camera pitch is clamped between a low angle and nearly top-down', () => {
  assert.equal(Rules.clampPitch(5), Rules.CAMERA.pitchMax);
  assert.equal(Rules.clampPitch(-5), Rules.CAMERA.pitchMin);
  assert.equal(Rules.clampPitch(0.3), 0.3);
  assert.ok(Rules.CAMERA.pitchMax < Math.PI / 2, 'never flips over the top');
  assert.ok(Rules.CAMERA.pitchMin < 0, 'can look up a little');
});

test('the camera pulls in instead of sinking into a hill', () => {
  const flat = () => 0;
  const d = Rules.cameraDistance(flat, 0, 2, 0, 0, 0.3, -0.95, 8);
  assert.equal(d, 8, 'nothing in the way: full distance');
  const hill = (x, z) => (z < -4 ? 6 : 0); // a wall of ground 4 units behind the target
  const d2 = Rules.cameraDistance(hill, 0, 2, 0, 0, 0.3, -0.95, 8);
  assert.ok(d2 < 4.3 && d2 >= Rules.CAMERA.minDist, `pulled in to ${d2}`);
  const buried = () => 50;
  assert.equal(Rules.cameraDistance(buried, 0, 2, 0, 0, 0.3, -0.95, 8), Rules.CAMERA.minDist, 'never closer than the minimum');
});

/* ---------- world helpers ---------- */

test('zones name where you are, for the zone banners', () => {
  const L = {
    tree: [-74, 70], spawn: [-64, 58], swamp: [-80, 82], clearing: [-30, 6], stone1: [-26, 1], ruins: [13, 3], altar: [14, -2], gate1: [14, -11],
    hollow: [30, -34], pool: [36, -58], falls: [36, -67.6], stone2: [21, -51], toad: [39, -57], gate2: [61, -70], stone3: [70, -86], pyramid: [90, -102], warden: [76, -94],
  };
  const z = (k) => Rules.zoneAt(L[k][0], L[k][1], L).id;
  assert.equal(z('spawn'), 'swamp');
  assert.equal(z('stone1'), 'clearing');
  assert.equal(z('altar'), 'ruins');
  assert.equal(z('hollow'), 'hollow');
  assert.equal(z('toad'), 'falls');
  assert.equal(z('stone3'), 'plateau');
  assert.equal(z('pyramid'), 'pyramid');
  for (const k of Object.keys(L)) assert.match(Rules.zoneAt(L[k][0], L[k][1], L).name, /\S/, `${k} has a name`);
  // the jungle between the named places is quiet: no banner, and never "the swamp"
  for (const [x, z] of [[-12, 5], [-44, 28]]) {
    const w = Rules.zoneAt(x, z, L);
    assert.equal(w.id, 'wilds', `(${x}, ${z}) lies between zones`);
    assert.equal(w.name, '');
  }
});

test('damage numbers keep the game chill', () => {
  assert.ok(Rules.DAMAGE.bite > 0 && Rules.DAMAGE.bite <= 0.5);
  assert.ok(Rules.DAMAGE.ring > 0 && Rules.DAMAGE.ring <= 1);
  assert.ok(Rules.IFRAMES >= 0.5, 'a moment of grace after each hit');
  assert.ok(Rules.maxVibe(1) / Rules.DAMAGE.bite >= 6, 'six bites before you crumble');
});
