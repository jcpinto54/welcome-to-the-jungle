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
  function steerMoth(s, env, dt, flock) {
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
  function steerWarden(s, env, dt) {
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

  const steer = { MOTH, WARDEN, newMoth, newWarden, moth: steerMoth, warden: steerWarden, hit, ringHit, songPos };

  /* ---------- models (THREE is only touched inside these functions) ---------- */

  const ps1 = (m) => (typeof World !== 'undefined' && World.ps1 ? World.ps1(m) : m);
  const TIME = { value: 0 };
  let E, Q, V, S1;
  function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, order = 'XYZ') {
    if (!E) { E = new THREE.Euler(); Q = new THREE.Quaternion(); V = new THREE.Vector3(); S1 = new THREE.Vector3(); }
    return new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, order)), typeof s === 'number' ? S1.set(s, s, s) : S1.set(s[0], s[1], s[2]));
  }
  function gnarl(geo, amt, seed) {
    const r = rng(seed), p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!seen.has(k)) seen.set(k, [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]);
      const d = seen.get(k);
      p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
    }
    return geo;
  }
  const ball = (sx, sy, sz, detail = 1) => new THREE.IcosahedronGeometry(1, detail).scale(sx, sy, sz);
  const tube = (r0, r1, len, seg = 5) => new THREE.CylinderGeometry(r1, r0, len, seg, 1, true).translate(0, -len / 2, 0); // hangs down from its joint
  const col3 = (c) => (Array.isArray(c) ? c : new THREE.Color(c).toArray());

  // Merge primitives into one non-indexed geometry: vertex colours, uvs, optional per-part
  // float attributes (e.g. which wing) and, for rigs, rigid skin weights.
  function merge(parts, extra = []) {
    const gs = parts.map((p) => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); if (p.m) g.applyMatrix4(p.m); return g; });
    const n = gs.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const ex = extra.map(() => new Float32Array(n));
    const skin = parts.some((p) => p.bone !== undefined), si = skin && new Uint16Array(n * 4), sw = skin && new Float32Array(n * 4);
    let o = 0;
    gs.forEach((g, gi) => {
      const p = parts[gi], c = col3(p.color === undefined ? 0xffffff : p.color), cnt = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      for (let k = 0; k < cnt; k++) {
        col.set(c, (o + k) * 3);
        extra.forEach((name, j) => { ex[j][o + k] = p[name] || 0; });
        if (skin) { si[(o + k) * 4] = p.bone || 0; sw[(o + k) * 4] = 1; }
      }
      o += cnt;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    extra.forEach((name, j) => geo.setAttribute(name, new THREE.BufferAttribute(ex[j], 1)));
    if (skin) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    }
    geo.computeVertexNormals();
    return geo;
  }

  // Rigid rig: parts follow bones, the whole creature is one skinned mesh (one draw call).
  function Rig() {
    const bones = [], parts = [];
    const bone = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); return b; };
    const add = (b, geo, m, color) => parts.push({ b, geo, m, color });
    function build(mat) {
      bones[0].updateMatrixWorld(true);
      const geo = merge(parts.map((p) => ({ geo: p.geo, m: p.m ? p.b.matrixWorld.clone().multiply(p.m) : p.b.matrixWorld, color: p.color, bone: bones.indexOf(p.b) })));
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.add(bones[0]);
      mesh.bind(new THREE.Skeleton(bones));
      mesh.frustumCulled = false;
      return mesh;
    }
    return { bone, add, build };
  }

  // Shader tweaks, stacked on whatever World.ps1 installed. `lit` = a floor of self-light.
  function patch(mat, key, { lit = 0, vert = '', head = '', frag = '' } = {}) {
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.bind(mat);
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      sh.uniforms.uTime = TIME;
      const decl = /uniform float uTime;/.test(sh.vertexShader) ? '' : 'uniform float uTime;\n'; // World.ps1 may declare it
      sh.vertexShader = decl + head + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vert);
      if (lit) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ' + lit.toFixed(3) + ';');
      if (frag) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', frag + '\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => prevKey() + '|' + key;
    return mat;
  }
  function canvasTex(w, h, draw) {
    const c = makeCanvas(w, h), x = c.getContext('2d');
    draw((col, X, Y, ww = 1, hh = 1) => { x.fillStyle = col; x.fillRect(X, Y, ww, hh); }, x);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }
  // Flat expanding ring drawn by a shader so its band keeps a constant width (silence rings, croaks).
  function ringMesh(color) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { r: { value: 1 }, band: { value: 0.9 }, amt: { value: 1 }, color: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec2 vP; uniform float r, band; void main(){ vP = position.xy * (r + band); gl_Position = projectionMatrix * modelViewMatrix * vec4(vP.x, vP.y, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vP; uniform float r, band, amt; uniform vec3 color;
        void main(){ float d = abs(length(vP) - r) / (band * 0.5); if (d > 1.0) discard;
          float a = (1.0 - d * d) * amt; float stripe = step(0.5, fract(length(vP) * 2.0)) * 0.25;
          gl_FragColor = vec4(color * (a * (0.8 + stripe)), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    m.name = 'ring';
    m.rotation.x = -Math.PI / 2;
    m.frustumCulled = false;
    m.renderOrder = 2;
    return m;
  }
  function glowSprite(color, scale, opacity) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(scale, scale, 1);
    return s;
  }
  function triangles(obj) {
    let n = 0;
    obj.traverse((m) => {
      if (m.isSprite) n += 2;
      else if (m.isMesh && m.geometry) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
    return n;
  }

  /* ----- Hush Moth: one shared geometry and two shared materials for every moth ----- */

  let mothKit = null;
  function getMothKit() {
    if (mothKit) return mothKit;
    // 32x32 atlas: wing (0,0)-(16,16), fuzz (16,0)-(32,16), white (0,16)-(8,24)
    const tex = canvasTex(32, 32, (P) => {
      // a moth forewing: u runs from the body to the tip, v from the back edge (-1) to the front (+1)
      for (let Y = 0; Y < 16; Y++) for (let X = 0; X < 16; X++) {
        const u = X / 15, v = (Y - 7.5) / 7.5, margin = 1.02 - 0.17 * (0.95 - v) - u;
        if (!(v < 0.35 + 0.62 * u && v > -0.3 - 0.8 * u && margin > 0)) continue;
        let c = (X + Y * 3) % 5 ? '#d3cfe3' : '#bdb9d0';
        if (Math.abs(v - 0.25 - u * 0.2) < 0.08 || Math.abs(v + 0.25 + u * 0.35) < 0.08) c = '#9f9bb6';
        if (margin < 0.13) c = (X + Y) % 2 ? '#6d6986' : '#57536f';
        const spot = Math.hypot(u - 0.6, (v - 0.05) * 0.9);
        if (spot < 0.19) c = spot > 0.11 ? '#2f2c45' : '#eceaf5';
        P(c, X, Y);
      }
      const r = rng(8);
      P('#d9d6e6', 16, 0, 16, 16);
      for (let i = 0; i < 70; i++) P(['#f2f0f8', '#aeaac2', '#8d89a3'][(r() * 3) | 0], 16 + ((r() * 16) | 0), (r() * 16) | 0);
      P('#ffffff', 0, 16, 8, 8);
    });
    const reg = (g, X, Y, w, h) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (X + 0.5 + uv.getX(i) * (w - 1)) / 32, 1 - (Y + 0.5 + (1 - uv.getY(i)) * (h - 1)) / 32); return g; };
    const fuzz = (g) => reg(g, 16, 0, 16, 16), white = (g) => reg(g, 0, 16, 8, 8), wingUV = (g) => reg(g, 0, 0, 16, 16);
    const parts = [
      { geo: fuzz(ball(0.15, 0.14, 0.2, 0)), m: M(0, 0, 0.02), color: [1, 1, 1] },
      { geo: fuzz(new THREE.CylinderGeometry(0.025, 0.11, 0.5, 5, 2)), m: M(0, -0.03, -0.25, -Math.PI / 2 + 0.15, 0, 0), color: [0.85, 0.84, 0.92] },
      { geo: fuzz(ball(0.085, 0.08, 0.085, 0)), m: M(0, 0.01, 0.2), color: [0.95, 0.94, 1] },
      { geo: white(new THREE.OctahedronGeometry(0.042)), m: M(0.056, 0.03, 0.24), color: [6, 0.5, 0.6] },
      { geo: white(new THREE.OctahedronGeometry(0.042)), m: M(-0.056, 0.03, 0.24), color: [6, 0.5, 0.6] },
      { geo: white(new THREE.PlaneGeometry(0.08, 0.32).translate(0, 0.16, 0)), m: M(0.04, 0.06, 0.25, 0.9, 0, -0.45), color: [0.75, 0.73, 0.85] },
      { geo: white(new THREE.PlaneGeometry(0.08, 0.32).translate(0, 0.16, 0)), m: M(-0.04, 0.06, 0.25, 0.9, 0, 0.45), color: [0.75, 0.73, 0.85] },
    ];
    // wings lie flat, span along x; `wing` = +1 left, -1 right (flapped in the vertex shader)
    for (const s of [1, -1]) {
      parts.push({ geo: wingUV(new THREE.PlaneGeometry(0.82, 0.52).translate(0.46, 0, 0)), m: M(0, 0.03, 0.06, -Math.PI / 2, -0.28 * s, 0, [s, 1, 1]), color: [1, 1, 1], wing: s });
      parts.push({ geo: wingUV(new THREE.PlaneGeometry(0.56, 0.42).translate(0.32, 0, 0)), m: M(0, 0.0, -0.14, -Math.PI / 2, -0.62 * s, 0, [s, 1, 1]), color: [0.88, 0.87, 0.95], wing: s });
    }
    const geo = merge(parts, ['wing']);
    const flap = {
      head: 'attribute float wing;\n',
      vert: `if (wing != 0.0) {
        float ph = uTime * 19.0 + dot(modelMatrix[3].xz, vec2(1.7, 2.3));
        float a = (0.35 + 0.8 * sin(ph)) * wing, c = cos(a), s = sin(a);
        transformed.xy = vec2(transformed.x * c - transformed.y * s, transformed.x * s + transformed.y * c);
      }`,
    };
    const make = (lit, key) => patch(ps1(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, flatShading: true, alphaTest: 0.5, side: THREE.DoubleSide })), key, { lit, ...flap });
    mothKit = { geo, mat: make(0.6, 'moth'), flash: make(2.5, 'mothflash') };
    return mothKit;
  }

  const flock = [];
  function moth(scene, x, y, z) {
    const K = getMothKit(), s = newMoth(x, y, z);
    flock.push(s);
    const group = new THREE.Group(), body = new THREE.Mesh(K.geo, K.mat);
    group.name = 'moth';
    body.scale.setScalar(1.35);
    group.add(body);
    group.position.set(x, y, z);
    if (scene) scene.add(group);
    const pos = new THREE.Vector3(x, y, z);
    let yaw = 0, roll = 0;
    return {
      group, pos, state: s,
      get hp() { return s.hp; }, get alive() { return s.alive; }, get gone() { return s.gone; },
      update(dt, env) {
        TIME.value = env.t || 0;
        const out = steer.moth(s, env, dt, flock);
        if (s.gone) {
          group.visible = false;
          const i = flock.indexOf(s);
          if (i >= 0) flock.splice(i, 1);
          return out;
        }
        const t = env.t || 0, sp = Math.hypot(s.vx, s.vz);
        let want = yaw;
        if (s.aggro) want = Math.atan2(env.player.x - s.x, env.player.z - s.z);
        else if (sp > 0.3) want = Math.atan2(s.vx, s.vz);
        const turn = mod(want - yaw + Math.PI, Math.PI * 2) - Math.PI;
        yaw += turn * Math.min(1, dt * 6);
        roll += (clamp(-turn * 1.5, -0.6, 0.6) - roll) * Math.min(1, dt * 5);
        group.position.set(s.x, s.y + Math.sin(t * 3.1 + s.phase) * 0.08, s.z);
        pos.set(s.x, s.y, s.z);
        body.rotation.set(s.aggro ? 0.25 : 0.1, yaw, roll);
        body.material = s.flash > 0 ? K.flash : K.mat;
        if (!s.alive) {
          const k = clamp(1 - s.dieT / MOTH.dieTime, 0, 1);
          body.rotation.y = yaw + s.dieT * 14;
          body.rotation.z = 1.2 * (1 - k);
          body.scale.setScalar(Math.max(0.01, k) * 1.35);
        }
        return out;
      },
      hit(dmg, from) { return hit(s, dmg, from ? from.x : s.x, from ? from.z : s.z - 1); },
    };
  }

  /* ----- Hush Warden: a floating hooded figure with a blank mask ----- */

  function warden(scene, x, y, z) {
    const s = newWarden(x, y, z);
    const robeTex = canvasTex(16, 32, (P) => {
      const r = rng(21);
      P('#8c8a98', 0, 0, 16, 32);
      for (let X = 0; X < 16; X += 3) { P('#6e6c7c', X, 0, 1, 32); P('#a5a3b2', X + 1, 0, 1, 32); }
      for (let i = 0; i < 40; i++) P(r() < 0.5 ? '#77758a' : '#b3b1c0', (r() * 16) | 0, (r() * 32) | 0, 1, 2);
    });
    const ripple = {
      vert: `float hem = 1.0 - smoothstep(0.0, 1.4, position.y);
        float an = atan(position.z, position.x);
        transformed.xz += normalize(position.xz + 1e-4) * sin(uTime * 2.2 + an * 3.0 + position.y * 2.0) * 0.09 * hem;
        transformed.y += sin(uTime * 3.0 + an * 5.0) * 0.05 * hem;`,
    };
    const robeMat = patch(ps1(new THREE.MeshLambertMaterial({ map: robeTex, vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: true })), 'warden', { lit: 0.35, ...ripple });
    // robe (floats: the hem hangs 0.3 above the ground), hood and shoulders, all one mesh
    const robe = new THREE.CylinderGeometry(0.36, 1.15, 2.55, 11, 4, true).translate(0, 1.28 + 0.3, 0);
    const rp = robe.attributes.position, rr = rng(5);
    for (let i = 0; i < rp.count; i++) if (rp.getY(i) < 0.4) rp.setY(i, rp.getY(i) + (rr() - 0.5) * 0.3);
    const hood = new THREE.CylinderGeometry(0.02, 0.48, 1.1, 8, 2, true, 0.6, Math.PI * 2 - 1.2).translate(0, 0.55, 0);
    const parts = [
      { geo: gnarl(robe, 0.06, 3), color: [1, 1, 1.05] },
      { geo: gnarl(ball(0.5, 0.26, 0.4), 0.05, 4), m: M(0, 2.8, -0.02), color: [0.9, 0.9, 0.98] },
      { geo: gnarl(hood, 0.04, 6), m: M(0, 2.76, -0.06, -0.22, 0, 0), color: [0.82, 0.82, 0.9] },
      { geo: ball(0.3, 0.36, 0.2), m: M(0, 3.12, -0.06), color: [0.02, 0.02, 0.03] },
    ];
    for (let i = 0; i < 12; i++) {
      const a = i * 0.52 + 0.2, len = 0.45 + rr() * 0.45, g = new THREE.PlaneGeometry(0.34, len, 1, 2).translate(0, -len / 2, 0), gp = g.attributes.position;
      for (let k = 0; k < gp.count; k++) if (gp.getY(k) < -len + 0.01) gp.setX(k, gp.getX(k) * 0.3);
      parts.push({ geo: g, m: M(Math.sin(a) * 1.08, 0.5, Math.cos(a) * 1.08, -0.15, a, 0, 1, 'YXZ'), color: i % 2 ? [0.8, 0.8, 0.88] : [0.95, 0.95, 1.02] });
    }
    const group = new THREE.Group();
    group.name = 'warden';
    const body = new THREE.Mesh(merge(parts), robeMat);
    group.add(body);
    // the blank white mask: no features at all
    const maskMat = ps1(new THREE.MeshBasicMaterial({ color: 0xeeeaf6, transparent: true }));
    const mask = new THREE.Mesh(gnarl(ball(0.22, 0.29, 0.1, 1), 0.012, 9), maskMat);
    mask.position.set(0, 3.08, 0.12);
    mask.rotation.x = 0.12;
    group.add(mask);
    // empty sleeves that drift
    const sleeves = [1, -1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.42 * side, 2.72, 0);
      const g = merge([
        { geo: gnarl(tube(0.12, 0.26, 1.15, 6), 0.04, 12 + side), color: [0.92, 0.92, 1] },
        { geo: new THREE.PlaneGeometry(0.26, 0.5).translate(0, -1.35, 0), m: M(0, 0, 0.05), color: [0.8, 0.8, 0.88] },
      ]);
      pivot.add(new THREE.Mesh(g, robeMat));
      group.add(pivot);
      return pivot;
    });
    const aura = glowSprite(0xcfc8ff, 5.5, 0.18);
    aura.position.y = 2.2;
    group.add(aura);
    group.position.set(x, y, z);
    if (scene) scene.add(group);
    const pos = new THREE.Vector3(x, y, z);
    const ringPool = [];
    let yaw = 0, pulse = 0;
    return {
      group, pos, state: s,
      get hp() { return s.hp; }, get alive() { return s.alive; }, get gone() { return s.gone; },
      update(dt, env) {
        TIME.value = env.t || 0;
        const out = steer.warden(s, env, dt);
        const t = env.t || 0;
        if (out.spawned) pulse = 1;
        pulse = Math.max(0, pulse - dt * 1.6);
        if (s.alive) {
          const want = Math.atan2(env.player.x - s.x, env.player.z - s.z);
          yaw += (mod(want - yaw + Math.PI, Math.PI * 2) - Math.PI) * Math.min(1, dt * 1.5);
        }
        const k = s.alive ? 1 : clamp(1 - s.dieT / WARDEN.dieTime, 0, 1);
        group.position.set(s.x, s.y + Math.sin(t * 1.3 + s.phase) * 0.12 - (1 - k) * 1.2, s.z);
        group.rotation.y = yaw;
        pos.set(s.x, s.y, s.z);
        sleeves.forEach((sl, i) => { sl.rotation.z = (i ? -1 : 1) * (0.12 + pulse * 0.5 + Math.sin(t * 1.1 + i) * 0.05); sl.rotation.x = -0.15 - pulse * 0.5 + Math.sin(t * 0.9 + i * 2) * 0.06; });
        mask.rotation.x = 0.12 - pulse * 0.25;
        robeMat.opacity = maskMat.opacity = k;
        robeMat.emissive.setScalar(s.flash > 0 ? 0.9 : 0);
        maskMat.color.setScalar(s.flash > 0 ? 1.4 : 0.93 + pulse * 0.3);
        aura.material.opacity = (0.14 + pulse * 0.3) * k;
        if (s.gone) group.visible = false;
        // silence rings live in the world, not on the warden (they fade out with it)
        while (ringPool.length < out.rings.length) { const m = ringMesh(0xd8d2ff); ringPool.push(m); if (scene) scene.add(m); }
        ringPool.forEach((m, i) => {
          const r = out.rings[i];
          m.visible = !!r;
          if (!r) return;
          m.position.set(r.x, r.y + 0.08, r.z);
          m.material.uniforms.r.value = r.r;
          m.material.uniforms.band.value = r.band;
          m.material.uniforms.amt.value = 0.9 * k * (1 - smoothstep(WARDEN.ringMax * 0.6, WARDEN.ringMax, r.r));
        });
        if (s.gone) ringPool.forEach((m) => { m.visible = false; });
        return out;
      },
      hit(dmg, from) { return hit(s, dmg, from ? from.x : s.x, from ? from.z : s.z - 1); },
    };
  }

  /* ----- Panther Spirit: a translucent magenta panther that sits on the altar ----- */

  function panther(scene, x, y, z) {
    const R = Rig();
    const C = [1, 0.25, 0.85], D = [0.7, 0.14, 0.6], H = [2.4, 1.7, 2.4];
    const hips = R.bone(null, 0, 1.0, -0.55);
    const spine = R.bone(hips, 0, 0.05, 0.1);
    const chest = R.bone(spine, 0, 0.05, 0.95);
    const neck = R.bone(chest, 0, 0.18, 0.28);
    const head = R.bone(neck, 0, 0.36, 0.14);
    const jaw = R.bone(head, 0, -0.08, 0.1);
    const legs = [];
    for (const sd of [1, -1]) {
      const fu = R.bone(chest, 0.23 * sd, -0.2, 0.12), fl = R.bone(fu, 0, -0.5, 0), fp = R.bone(fl, 0, -0.45, 0);
      const th = R.bone(hips, 0.26 * sd, -0.05, -0.02), sh = R.bone(th, 0, -0.46, 0), rp = R.bone(sh, 0, -0.45, 0);
      legs.push({ fu, fl, fp, th, sh, rp, sd });
      R.add(fu, tube(0.13, 0.095, 0.5), null, C);
      R.add(fl, tube(0.09, 0.07, 0.45), null, C);
      R.add(fp, ball(0.11, 0.07, 0.16, 0), M(0, -0.02, 0.05), D);
      R.add(th, ball(0.2, 0.34, 0.32), M(0, -0.12, 0.06), C);
      R.add(sh, tube(0.075, 0.05, 0.46), null, C);
      R.add(rp, ball(0.1, 0.06, 0.16, 0), M(0, -0.02, 0.06), D);
    }
    R.add(hips, ball(0.36, 0.38, 0.42), null, C);
    R.add(spine, new THREE.CylinderGeometry(0.34, 0.4, 0.95, 7, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.47), M(0, 0, 0, 0, 0, 0, [1, 0.88, 1]), C);
    R.add(chest, ball(0.4, 0.46, 0.42), null, C);
    R.add(neck, new THREE.CylinderGeometry(0.2, 0.28, 0.44, 7, 1, true).translate(0, 0.2, 0), M(0, 0, 0, 0.35, 0, 0), C);
    R.add(head, ball(0.23, 0.2, 0.24), null, C);
    R.add(head, ball(0.12, 0.09, 0.12, 0), M(0, -0.07, 0.2), C);
    R.add(head, ball(0.1, 0.09, 0.09, 0), M(0.13, -0.06, 0.08), C);
    R.add(head, ball(0.1, 0.09, 0.09, 0), M(-0.13, -0.06, 0.08), C);
    R.add(head, new THREE.BoxGeometry(0.07, 0.04, 0.04), M(0, -0.03, 0.31), D);
    R.add(head, new THREE.ConeGeometry(0.075, 0.13, 5), M(0.13, 0.19, -0.05, -0.15, 0, -0.45), C);
    R.add(head, new THREE.ConeGeometry(0.075, 0.13, 5), M(-0.13, 0.19, -0.05, -0.15, 0, 0.45), C);
    R.add(head, new THREE.OctahedronGeometry(0.042), M(0.09, 0.04, 0.2, 0, 0.3, 0.3, [1.6, 0.6, 0.7]), H);
    R.add(head, new THREE.OctahedronGeometry(0.042), M(-0.09, 0.04, 0.2, 0, -0.3, -0.3, [1.6, 0.6, 0.7]), H);
    R.add(jaw, new THREE.BoxGeometry(0.13, 0.045, 0.16), M(0, -0.03, 0.12), D);
    R.add(jaw, new THREE.ConeGeometry(0.02, 0.07, 3), M(0.06, 0.03, 0.22, Math.PI, 0, 0), H);
    R.add(jaw, new THREE.ConeGeometry(0.02, 0.07, 3), M(-0.06, 0.03, 0.22, Math.PI, 0, 0), H);
    const tail = [];
    let prev = hips;
    for (let i = 0; i < 6; i++) {
      const b = R.bone(prev, 0, i ? 0 : 0.08, i ? -0.27 : -0.36);
      R.add(b, new THREE.CylinderGeometry(0.065 - i * 0.007, 0.07 - i * 0.007, 0.28, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.14), null, C);
      tail.push(b);
      prev = b;
    }
    // spectral: faceted, additive, brighter at the silhouette like a hologram
    const mat = patch(ps1(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })), 'panther',
      { lit: 0.4, frag: 'float rim = 1.0 - abs(dot(normal, normalize(vViewPosition))); outgoingLight += diffuseColor.rgb * rim * rim * 1.8;' });
    const body = R.build(mat);
    const group = new THREE.Group();
    group.name = 'panther';
    group.add(body);
    const aura = glowSprite(0xff4fd8, 5.5, 0.3);
    aura.position.set(0, 1.4, 0.1);
    group.add(aura);
    group.position.set(x, y, z);
    if (scene) scene.add(group);

    // k = 0 sitting, 1 standing; the roar overlays on top
    let k = 0, awakeT = -1;
    function pose(t, pulse) {
      const sit = 1 - k;
      hips.position.y = lerp(1.0, 0.42, sit);
      hips.position.z = lerp(-0.55, -0.3, sit);
      const lift = 1.0 * sit, breath = Math.sin(t * 1.6) * 0.02;
      spine.rotation.x = -lift * 0.75 + breath;
      chest.rotation.x = -lift * 0.3;
      const roar = awakeT > 0.9 && awakeT < 2.4 ? Math.sin(((awakeT - 0.9) / 1.5) * Math.PI) : 0;
      neck.rotation.x = lift * 0.55 - 0.2 * k - roar * 0.5 + Math.sin(t * 0.7) * 0.04;
      head.rotation.x = lift * 0.45 + 0.1 * k - roar * 0.3 + pulse * 0.05;
      head.rotation.y = Math.sin(t * 0.37) * 0.25 * (1 - roar);
      jaw.rotation.x = 0.05 + roar * 0.7;
      for (const L of legs) {
        L.fu.rotation.x = lift * 1.05 - 0.05;
        L.fl.rotation.x = 0;
        L.fp.rotation.x = -lift * 0.0;
        L.th.rotation.x = -lift * 1.35;
        L.sh.rotation.x = lift * 2.35;
        L.rp.rotation.x = -lift * 1.0;
        L.th.rotation.z = L.sd * sit * 0.15;
      }
      tail.forEach((b, i) => {
        b.rotation.y = Math.sin(t * 2.2 - i * 0.6) * (0.18 + i * 0.05) + sit * (i === 0 ? 0.9 : 0.35);
        b.rotation.x = i === 0 ? lerp(-0.2, 1.2, sit) : sit * 0.06 - k * 0.12;
      });
      const flare = roar + pulse * 0.4;
      aura.scale.setScalar(5 + flare * 3.5);
      aura.material.opacity = 0.22 + flare * 0.3;
      mat.opacity = 0.42 + Math.sin(t * 13) * 0.04 + flare * 0.2;
      body.scale.setScalar(1 + roar * 0.06);
    }
    pose(0, 0);
    return {
      group,
      get awake() { return awakeT >= 0; },
      get roaring() { return awakeT > 0.9 && awakeT < 2.4; },
      update(dt, t, pulse = 0) {
        if (awakeT >= 0) { awakeT += dt; k = smoothstep(0, 0.9, awakeT); }
        pose(t || 0, pulse);
      },
      awaken() { if (awakeT < 0) awakeT = 0; },
    };
  }

  /* ----- Sub Toad: a big violet toad with a throat sac that booms ----- */

  function toad(scene, x, y, z) {
    const tex = canvasTex(32, 32, (P) => {
      const r = rng(66);
      P('#6a4fb0', 0, 0, 32, 32);
      for (let i = 0; i < 26; i++) { const X = (r() * 30) | 0, Y = (r() * 30) | 0; P('#4a3585', X, Y, 2 + ((r() * 2) | 0), 2); P('#9a7fe0', X, Y, 1, 1); }
      for (let i = 0; i < 60; i++) P(r() < 0.5 ? '#3a2a6a' : '#8466cc', (r() * 32) | 0, (r() * 32) | 0);
    });
    const SK = [1.9, 1.25, 1.75], BELLY = [2.3, 1.9, 2.2], DARK = [0.5, 0.45, 0.7], EYE = [3, 1.8, 0.35];
    const parts = [
      { geo: gnarl(ball(1.05, 0.62, 0.95), 0.08, 1), m: M(0, 0.58, -0.1), color: SK },
      { geo: gnarl(ball(0.85, 0.44, 0.62), 0.05, 2), m: M(0, 0.78, 0.5), color: SK },
      { geo: ball(0.9, 0.38, 0.8), m: M(0, 0.4, 0.12), color: BELLY },
      { geo: new THREE.BoxGeometry(0.7, 0.05, 0.06), m: M(0.36, 0.64, 1.0, 0, 0.55, -0.12), color: DARK },
      { geo: new THREE.BoxGeometry(0.7, 0.05, 0.06), m: M(-0.36, 0.64, 1.0, 0, -0.55, 0.12), color: DARK },
    ];
    for (const sd of [1, -1]) {
      parts.push({ geo: ball(0.21, 0.2, 0.21), m: M(0.42 * sd, 1.08, 0.58), color: SK });
      parts.push({ geo: ball(0.15, 0.15, 0.1), m: M(0.44 * sd, 1.12, 0.72), color: EYE });
      parts.push({ geo: new THREE.BoxGeometry(0.17, 0.035, 0.02), m: M(0.44 * sd, 1.12, 0.825), color: [0.02, 0.02, 0.02] });
      parts.push({ geo: gnarl(ball(0.34, 0.3, 0.55), 0.05, 3 + sd), m: M(0.85 * sd, 0.42, -0.35), color: SK });
      parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.13, 0.55, 6, 1, true), m: M(0.62 * sd, 0.3, 0.72, 0.35, 0, 0.45 * sd), color: SK });
      for (let i = 0; i < 3; i++) {
        parts.push({ geo: ball(0.05, 0.03, 0.16, 0), m: M(0.72 * sd + (i - 1) * 0.08, 0.05, 0.92 + (i === 1 ? 0.05 : 0), 0, (i - 1) * 0.4, 0), color: SK });
        parts.push({ geo: ball(0.06, 0.03, 0.28, 0), m: M(1.0 * sd + (i - 1) * 0.1, 0.05, 0.12, 0, (i - 1) * 0.35 + 0.2 * sd, 0), color: SK });
      }
    }
    const wr = rng(12);
    for (let i = 0; i < 14; i++) {
      const a = wr() * Math.PI * 2, u = 0.3 + wr() * 0.6;
      parts.push({ geo: ball(0.07 + wr() * 0.05, 0.05, 0.07 + wr() * 0.05, 0), m: M(Math.sin(a) * u * 0.9, 0.58 + Math.sqrt(1 - u * u) * 0.58, Math.cos(a) * u * 0.85 - 0.15), color: [1.1, 0.95, 1.5] });
    }
    const skinMat = patch(ps1(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, flatShading: true })), 'toad', { lit: 0.28 });
    const group = new THREE.Group();
    group.name = 'toad';
    const body = new THREE.Mesh(merge(parts), skinMat);
    group.add(body);
    const sacMat = patch(ps1(new THREE.MeshLambertMaterial({ color: 0xd9a8ff, flatShading: true, transparent: true, opacity: 0.9 })), 'toadsac', { lit: 0.45 });
    const sac = new THREE.Mesh(gnarl(ball(0.36, 0.3, 0.3), 0.03, 7).translate(0, -0.22, 0.12), sacMat);
    sac.position.set(0, 0.62, 0.72);
    group.add(sac);
    const ring = ringMesh(0xa57bff);
    ring.visible = false;
    group.position.set(x, y, z);
    if (scene) { scene.add(group); scene.add(ring); }
    let croakT = -1;
    return {
      group,
      get croaking() { return croakT >= 0 && croakT < 1.2; },
      update(dt, t, pulse = 0) {
        t = t || 0;
        let inflate = 0.08 * pulse + 0.04 * Math.sin(t * 2);
        if (croakT >= 0) {
          croakT += dt;
          inflate = croakT < 0.16 ? croakT / 0.16 : croakT < 0.55 ? 1 : Math.max(0, 1 - (croakT - 0.55) / 0.45);
          ring.visible = croakT < 1.4;
          ring.position.set(group.position.x, group.position.y + 0.1, group.position.z);
          ring.material.uniforms.r.value = 0.8 + croakT * 6;
          ring.material.uniforms.band.value = 0.7;
          ring.material.uniforms.amt.value = Math.max(0, 1 - croakT / 1.4);
          if (croakT > 1.5) croakT = -1;
        }
        sac.scale.set(1 + inflate * 1.9, 1 + inflate * 1.7, 1 + inflate * 1.6);
        const squash = croakT >= 0 && croakT < 0.55 ? Math.sin((croakT / 0.55) * Math.PI) * 0.06 : 0;
        body.scale.set(1 + squash, 1 - squash * 1.2 + Math.sin(t * 2) * 0.012, 1 + squash);
      },
      croak() { croakT = 0; },
    };
  }

  // Forget every moth (for a restart); the next moth() builds a fresh flock.
  function clear() { flock.length = 0; }

  return { steer, moth, warden, panther, toad, triangles, clear };
})();
