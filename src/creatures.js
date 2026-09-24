'use strict';
/* creatures.js: the Hush (moths and the Warden) and the two spirits (Panther, Sub Toad).
   Creatures.steer holds the pure AI (no THREE), so Node can test it; the model
   factories wrap a steer state with low-poly meshes. */

const Creatures = (() => {
  /* ---------- pure AI ---------- */

  const MOTH = {
    hp: 2, aggro: 10, forget: 15, leash: 22, speed: 5.2, homeSpeed: 2.8, accel: 5,
    hoverMin: 1.5, hoverMax: 2.5, orbitR: 0.9, sepR: 1.6, minSep: 0.9,
    biteR: 1.1, biteCd: 1.2, kb: 9, kbDecay: 5, stun: 0.35, dieTime: 1.2,
  };
  const WARDEN = {
    hp: 12, aggro: 26, speed: 1.2, keep: 7, leash: 14, kb: 2.5, kbDecay: 4, stun: 0.15, dieTime: 2.4,
    ringEvery: 2, ringSpeed: 4.5, ringStart: 0.6, ringMax: 18, ringBand: 0.9, // rings: bars between, units/s, units
  };

  let nextId = 1;
  const base = (kind, cfg, x, y, z) => {
    const id = nextId++;
    return {
      kind, id, x, y, z, vx: 0, vy: 0, vz: 0, homeX: x, homeZ: z, hp: cfg.hp, maxHp: cfg.hp,
      alive: true, gone: false, aggro: false, kx: 0, kz: 0, kb: cfg.kb, kbDecay: cfg.kbDecay,
      stunTime: cfg.stun, stun: 0, flash: 0, cd: 0, dieT: 0, phase: (id * 2.39996) % (Math.PI * 2),
    };
  };
  const newMoth = (x, y, z) => base('moth', MOTH, x, y, z);
  const newWarden = (x, y, z) => Object.assign(base('warden', WARDEN, x, y, z), { rings: [], lastBar: null });

  // Song position in 16th steps; falls back to wall-clock time before the music starts.
  const songPos = (env) => (typeof env.songPos === 'number' && env.songPos >= 0 ? env.songPos : (env.t || 0) / STEP);

  // Damage with knockback away from (fx, fz). Returns true only on the killing blow.
  function hit(s, dmg, fx, fz) {
    if (!s.alive) return false;
    s.hp = Math.max(0, s.hp - dmg);
    s.flash = 0.18;
    s.stun = s.stunTime;
    let dx = s.x - fx, dz = s.z - fz, d = Math.hypot(dx, dz);
    if (d < 1e-6) { dx = Math.sin(s.phase); dz = Math.cos(s.phase); d = 1; }
    s.kx = (dx / d) * s.kb;
    s.kz = (dz / d) * s.kb;
    if (s.hp > 0) return false;
    s.alive = false;
    s.aggro = false;
    s.dieT = 0;
    s.vy = 1.5;
    return true;
  }

  // Ring band test: is the player standing on the expanding ring's edge?
  const ringHit = (ring, px, pz) => !ring.hit && Math.abs(Math.hypot(px - ring.x, pz - ring.z) - ring.r) <= ring.band / 2;

  function tick(s, dt) {
    s.cd = Math.max(0, s.cd - dt);
    s.stun = Math.max(0, s.stun - dt);
    s.flash = Math.max(0, s.flash - dt);
  }
  function knock(s, dt) {
    s.x += s.kx * dt; s.z += s.kz * dt;
    const k = Math.exp(-s.kbDecay * dt);
    s.kx *= k; s.kz *= k;
  }
  // Velocity steering toward (tx, tz), arriving smoothly.
  function seek(s, tx, tz, speed, accel, dt) {
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    const want = Math.min(speed, d * 3), ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 0;
    const k = Math.min(1, accel * dt);
    s.vx += (ux * want - s.vx) * k;
    s.vz += (uz * want - s.vz) * k;
  }

  // Hush Moth: drifts around home, chases inside its aggro radius (leashed), circles and bites.
  function moth(s, env, dt, flock) {
    const heightAt = env.heightAt || (() => 0);
    tick(s, dt);
    if (!s.alive) {
      s.dieT += dt;
      s.vy -= 7 * dt;
      s.y = Math.max(heightAt(s.x, s.z) + 0.1, s.y + s.vy * dt);
      knock(s, dt);
      if (s.dieT >= MOTH.dieTime) s.gone = true;
      return { bite: false };
    }
    const p = env.player, t = env.t || 0;
    const dP = Math.hypot(p.x - s.x, p.z - s.z);
    const pH = Math.hypot(p.x - s.homeX, p.z - s.homeZ);
    const dH = Math.hypot(s.x - s.homeX, s.z - s.homeZ);
    if (!s.aggro && dP < MOTH.aggro && pH < MOTH.leash) s.aggro = true;
    else if (s.aggro && (dP > MOTH.forget || pH > MOTH.leash + 2 || dH > MOTH.leash)) s.aggro = false;

    if (s.aggro && s.stun <= 0) {
      // circle the player at a per-moth angle so a swarm surrounds instead of stacking
      const a = s.phase + t * 1.3, orbit = dP > 3 ? 0 : MOTH.orbitR;
      seek(s, p.x + Math.cos(a) * orbit, p.z + Math.sin(a) * orbit, MOTH.speed, MOTH.accel, dt);
    } else {
      const a = s.phase + t * 0.6;
      seek(s, s.homeX + Math.cos(a) * 1.2, s.homeZ + Math.sin(a * 1.3) * 1.2, s.stun > 0 ? 0 : MOTH.homeSpeed, MOTH.accel, dt);
    }
    // soft separation, then a hard minimum spacing (horizontal, so hover height is untouched)
    if (flock) {
      for (const o of flock) {
        if (o === s || !o.alive) continue;
        const ex = s.x - o.x, ez = s.z - o.z, d = Math.hypot(ex, ez);
        if (d < MOTH.sepR && d > 1e-6) { const f = ((MOTH.sepR - d) / MOTH.sepR) * 6 * dt; s.vx += (ex / d) * f * MOTH.speed; s.vz += (ez / d) * f * MOTH.speed; }
      }
    }
    s.x += s.vx * dt; s.z += s.vz * dt;
    knock(s, dt);
    if (flock) {
      for (const o of flock) {
        if (o === s || !o.alive) continue;
        let ex = s.x - o.x, ez = s.z - o.z, d = Math.hypot(ex, ez);
        if (d >= MOTH.minSep) continue;
        if (d < 1e-6) { ex = Math.cos(s.phase); ez = Math.sin(s.phase); d = 1; } else { ex /= d; ez /= d; }
        s.x = o.x + ex * MOTH.minSep; s.z = o.z + ez * MOTH.minSep;
      }
    }
    // hover: bob inside the 1.5..2.5 band, dip lower when attacking
    const g = heightAt(s.x, s.z);
    const want = s.aggro ? MOTH.hoverMin + 0.2 : 2 + Math.sin(t * 1.7 + s.phase) * 0.35;
    s.y += (g + want - s.y) * Math.min(1, 4 * dt);
    s.y = clamp(s.y, g + MOTH.hoverMin, g + MOTH.hoverMax);

    let bite = false;
    if (s.aggro && s.stun <= 0 && s.cd <= 0 && Math.hypot(p.x - s.x, p.z - s.z) < MOTH.biteR) { bite = true; s.cd = MOTH.biteCd; }
    return { bite };
  }

  // Hush Warden: glides toward the player (keeping its distance, leashed to home) and
  // emits an expanding silence ring every `ringEvery` bars while the player is near.
  function warden(s, env, dt) {
    const heightAt = env.heightAt || (() => 0);
    tick(s, dt);
    const bar = Math.floor(songPos(env) / 16);
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.age += dt;
      r.r = WARDEN.ringStart + WARDEN.ringSpeed * r.age;
      if (r.r >= WARDEN.ringMax) s.rings.splice(i, 1);
    }
    let spawned = false, hitP = false;
    const p = env.player;
    if (s.alive) {
      const dP = Math.hypot(p.x - s.x, p.z - s.z);
      s.aggro = dP < WARDEN.aggro;
      if (s.aggro && s.stun <= 0) {
        const ux = (p.x - s.x) / (dP || 1), uz = (p.z - s.z) / (dP || 1), gap = dP - WARDEN.keep;
        seek(s, s.x + ux * gap, s.z + uz * gap, WARDEN.speed, 2, dt);
      } else seek(s, s.homeX, s.homeZ, s.stun > 0 ? 0 : WARDEN.speed, 2, dt);
      s.x += s.vx * dt; s.z += s.vz * dt;
      knock(s, dt);
      const hx = s.x - s.homeX, hz = s.z - s.homeZ, dH = Math.hypot(hx, hz);
      if (dH > WARDEN.leash) { s.x = s.homeX + (hx / dH) * WARDEN.leash; s.z = s.homeZ + (hz / dH) * WARDEN.leash; }
      s.y = heightAt(s.x, s.z);
      if (s.lastBar !== null && bar !== s.lastBar && s.aggro && mod(bar, WARDEN.ringEvery) === 0) {
        s.rings.push({ x: s.x, y: s.y, z: s.z, r: WARDEN.ringStart, band: WARDEN.ringBand, age: 0, hit: false });
        spawned = true;
      }
    } else {
      s.dieT += dt;
      knock(s, dt);
      if (s.dieT >= WARDEN.dieTime) s.gone = true;
    }
    s.lastBar = bar;
    for (const r of s.rings) if (ringHit(r, p.x, p.z)) { r.hit = true; hitP = true; }
    return { rings: s.rings, spawned, hit: hitP };
  }

  const steer = { MOTH, WARDEN, newMoth, newWarden, moth, warden, hit, ringHit, songPos };

  return { steer };
})();
