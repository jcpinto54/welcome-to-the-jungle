'use strict';
/* rules.js: the game's rules as numbers and pure functions (no THREE, no DOM), so Node can test
   them: spell stats and the pocket bonus, the XP and level curve, colour per carved stone, how
   loud the Hush's silence is, auto-aim, camera limits and a few geometry helpers for spells.
   game.js only glues these to the world. Angles follow the wizard: heading 0 faces +z and
   heading = atan2(dx, dz). */

const Rules = (() => {
  const TAU = Math.PI * 2;

  /* ---------- spells ---------- */

  // cd in seconds. At 170 BPM a beat is 0.353 s: a kick can land on every beat, the snare on
  // 8ths, the bass on every other beat. Ranges and sizes are in world units.
  const SPELLS = {
    stomp: { lane: 'kick', cd: 0.3, damage: 1, radius: 4.5 },
    bolt: { lane: 'snare', cd: 0.16, damage: 1, speed: 42, range: 38 },
    quake: { lane: 'bass', cd: 0.62, damage: 2, length: 11, width: 2.6 },
    dash: { lane: null, cd: 0.8, distance: 6.5, time: 0.2 },
  };
  // In the pocket (on the beat): multipliers per spell.
  const POCKET = {
    stomp: { damage: 2, radius: 1.35 },
    bolt: { damage: 2 },
    quake: { damage: 1.5, length: 1.3 },
  };

  function spell(name, onBeat = false) {
    const base = SPELLS[name];
    if (!base) return null;
    const s = Object.assign({ name }, base, { onBeat: !!onBeat && !!base.lane });
    const m = s.onBeat ? POCKET[name] : null;
    if (m) for (const k in m) s[k] = base[k] * m[k];
    return s;
  }

  // The press time (performance ms) that the rhythm judge hears exactly on the nearest quarter note.
  // pos is the song position heard at `now`; Sound.posAt() subtracts latencyMs, so it is added back.
  function beatPress(pos, now, latencyMs = 0) {
    const beat = Math.round(Math.max(pos, 0) / 4) * 4;
    return now + (beat - pos) * STEP * 1000 + latencyMs;
  }

  /* ---------- progression ---------- */

  const XP = { firefly: 1, moth: 3, warden: 25, carve: 6, spirit: 4 };
  const xpToNext = (lv) => 10 + 5 * (lv - 1);
  function level(xp) {
    let lv = 1, rest = Math.max(0, Math.floor(xp) || 0), need = xpToNext(1);
    while (rest >= need) { rest -= need; lv++; need = xpToNext(lv); }
    return { level: lv, xp01: rest / need, into: rest, need };
  }
  const maxVibe = (lv) => Math.min(10, 3 + Math.floor((Math.max(1, lv) - 1) / 2));

  // Vibe is health, in hearts. Hits cost half a heart; a short grace follows each one.
  const DAMAGE = { bite: 0.5, ring: 0.5 };
  const IFRAMES = 0.9;
  const REGEN = { after: 6, every: 4, amount: 0.5 }; // quiet seconds before healing, then +amount per `every`

  /* ---------- colour and silence ---------- */

  const SAT = [0.14, 0.46, 0.74, 1];
  const saturation = (carved, done = false) => (done ? 1.1 : SAT[clamp(Math.floor(carved) || 0, 0, 3)]);

  // Each Hush creature muffles the song by `amount` at point blank, fading out by `reach`.
  const HUSH = { moth: { reach: 12, amount: 0.34 }, warden: { reach: 30, amount: 0.8 } };
  function hush(near) {
    let h = 0;
    for (const e of near || []) {
      const c = HUSH[e.kind];
      if (!c || e.alive === false || !(e.d < c.reach)) continue;
      const k = 1 - Math.max(0, e.d) / c.reach;
      h += c.amount * k * k;
    }
    return clamp(h, 0, 1);
  }

  /* ---------- aiming ---------- */

  function wrapAngle(a) {
    let w = mod(a + Math.PI, TAU) - Math.PI;
    if (w <= -Math.PI) w += TAU;
    return w;
  }
  const heading = (dx, dz) => Math.atan2(dx, dz);

  // The nearest living candidate ({x, z}) within `range` and within `cone` radians of the facing.
  // null means: fly straight ahead.
  function autoAim(x, z, facing, candidates, { range = 24, cone = 0.62 } = {}) {
    let best = null, bestD = Infinity;
    for (const c of candidates || []) {
      if (!c || c.alive === false) continue;
      const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
      if (d > range || d < 1e-6) continue;
      if (Math.abs(wrapAngle(heading(dx, dz) - facing)) > cone) continue;
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  // Where (tx, tz) lies relative to a view looking along `yaw`: positive is to the right.
  const bearing = (yaw, fx, fz, tx, tz) => wrapAngle(yaw - heading(tx - fx, tz - fz));

  /* ---------- geometry ---------- */

  function segDist(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    const t = l2 > 1e-12 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
  }

  // Does the segment a-b cross the box {x0, z0, x1, z1} grown by pad? (Liang-Barsky clipping.)
  function segHitsBox(ax, az, bx, bz, b, pad = 0) {
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, ax - (b.x0 - pad)) && clip(dx, b.x1 + pad - ax) && clip(-dz, az - (b.z0 - pad)) && clip(dz, b.z1 + pad - az) && t0 <= t1;
  }

  /* ---------- camera ---------- */

  // pitch: the camera's angle above the wizard (positive looks down on him).
  const CAMERA = { dist: 7, minDist: 1.6, pitchMin: -0.3, pitchMax: 1.2, margin: 0.55 };
  const clampPitch = (p) => clamp(p, CAMERA.pitchMin, CAMERA.pitchMax);

  // How far the camera may sit from its target along the direction (dx, dy, dz) and stay `margin`
  // above the ground all the way: it pulls in rather than sinking into a hill.
  function cameraDistance(heightAt, tx, ty, tz, dx, dy, dz, want, { margin = CAMERA.margin, step = 0.25, min = CAMERA.minDist } = {}) {
    let ok = want;
    for (let s = step; s <= want + 1e-9; s += step) {
      if (ty + dy * s < heightAt(tx + dx * s, tz + dz * s) + margin) { ok = s - step; break; }
    }
    return clamp(ok, min, want);
  }

  /* ---------- the world ---------- */

  // Reach of the E / action button, pickup radius for fireflies (world units).
  const REACH = { stone: 5.6, spirit: 6.8, tree: 11, door: 6.5 };
  const PICKUP = 1.8;
  const WADE = { depth: -0.35, speed: 0.55 }; // ground below this is water: walk slower

  const ZONES = {
    swamp: 'the summoning swamp 召喚の沼',
    clearing: 'the first clearing 空き地',
    ruins: 'the panther ruins 黒豹の遺跡',
    hollow: 'moth hollow 蛾の窪地',
    falls: 'the falls 滝',
    plateau: 'the high plateau 高原',
    pyramid: 'the lost pyramid 失われたピラミッド',
    wilds: '', // the jungle between the named places: no banner
  };
  function zoneAt(x, z, L) {
    const d = (k) => (L[k] ? Math.hypot(x - L[k][0], z - L[k][1]) : Infinity);
    let id = 'wilds';
    if (d('pyramid') < 22) id = 'pyramid';
    else if (z < -76) id = 'plateau';
    else if (d('pool') < 16) id = 'falls';
    else if (z < -11) id = 'hollow';
    else if (Math.abs(x - 13) < 15 && Math.abs(z - 3) < 15) id = 'ruins';
    else if (d('clearing') < 18) id = 'clearing';
    else if (d('swamp') < 36 || d('spawn') < 22 || d('tree') < 22) id = 'swamp';
    return { id, name: ZONES[id] };
  }

  return {
    SPELLS, POCKET, spell, beatPress,
    XP, xpToNext, level, maxVibe, DAMAGE, IFRAMES, REGEN,
    saturation, HUSH, hush,
    wrapAngle, autoAim, bearing, segDist, segHitsBox,
    CAMERA, clampPitch, cameraDistance,
    REACH, PICKUP, WADE, ZONES, zoneAt,
  };
})();
