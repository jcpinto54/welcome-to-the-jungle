'use strict';
/* world.js: the jungle. Terrain, water, sky, vegetation, landmarks and collision.
   Layout (x = east, z = south):
     Zone A (south):   the Summoning Swamp, the first clearing, the Panther Ruins.
     Ridge at z=-11:   one gap, blocked by a vine wall (burn it with the snare bolt).
     Zone B (middle):  Moth Hollow, the waterfall pool and the Sub Toad.
     Cliff at z=-68:   one ramp, blocked by cracked stone (break it with the bass quake).
     Zone C (north):   the plateau, the Warden and the Lost Pyramid on its neon grid. */

const World = (() => {
  const HALF = 130;
  const SNAP = { value: new THREE.Vector2(240, 135) }; // PS1 vertex snapping grid
  const TIME = { value: 0 };

  // Landmarks, as [x, z].
  const L = {
    tree: [-74, 70], spawn: [-64, 58], swamp: [-76, 78],
    clearing: [-30, 6], stone1: [-26, 1],
    ruins: [13, 3], altar: [14, -2], gate1: [14, -11],
    hollow: [30, -34], pool: [36, -58], falls: [36, -67.6], stone2: [21, -51], toad: [39, -57],
    gate2: [61, -70], stone3: [70, -86], pyramid: [90, -102], warden: [76, -94],
  };
  const PATHS = [
    [[-64, 58], [-56, 44], [-44, 28], [-34, 14], [-30, 6]],
    [[-30, 6], [-14, 5], [2, 4], [13, 3]],
    [[13, 3], [14, -6], [14, -16], [20, -24], [28, -34], [30, -44], [24, -51]],
    [[24, -51], [44, -52], [56, -57], [61, -63], [61, -72], [64, -80], [70, -86]],
    [[70, -86], [80, -94], [90, -102]],
  ];
  const SEGS = [];
  for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) SEGS.push([path[i], path[i + 1]]);

  function pathDist(x, z) {
    let best = 1e9;
    for (const [[ax, az], [bx, bz]] of SEGS) {
      const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
    }
    return best;
  }

  /* ---------- terrain ---------- */

  const PLATEAU_Y = 9;
  function heightAt(x, z) {
    let h = 0.9 + (fbm(x * 0.025 + 11, z * 0.025 - 7, 4) - 0.5) * 3.2 + (vnoise(x * 0.18, z * 0.18) - 0.5) * 0.5;
    // the Summoning Swamp, with the tree's island
    h = lerp(h, -1.1 + (vnoise(x * 0.3, z * 0.3) - 0.5) * 0.9, smoothstep(27, 14, dist2(x, z, L.swamp[0], L.swamp[1])));
    h = lerp(h, 1.2, smoothstep(9, 5, dist2(x, z, L.tree[0], L.tree[1])));
    // clearings and paths
    h = lerp(h, 1.0, smoothstep(15, 9, dist2(x, z, L.clearing[0], L.clearing[1])));
    const pd = pathDist(x, z);
    h = lerp(h, Math.max(h * 0.4 + 0.5, 0.35), 0.6 * smoothstep(4, 1.2, pd));
    // ruins courtyard
    h = lerp(h, 1.2, smoothstep(14, 10, Math.max(Math.abs(x - L.ruins[0]), Math.abs(z - L.ruins[1] - 1))));
    // Moth Hollow sinks, the pool is a basin under the falls
    h -= 1.2 * smoothstep(15, 6, dist2(x, z, L.hollow[0], L.hollow[1]));
    h = lerp(h, -1.4, smoothstep(10, 6.5, dist2(x, z, L.pool[0], L.pool[1])));
    // Ridge at z=-11 with a single gap at x=14
    const ridge = smoothstep(4.6, 2.6, Math.abs(z + 11)) * (1 - smoothstep(4.2, 2.9, Math.abs(x - 14)));
    h += 7 * ridge;
    // Plateau to the north, reached by one ramp at x=61
    const plateau = PLATEAU_Y + (fbm(x * 0.04, z * 0.04, 3) - 0.5) * 1.6 * smoothstep(8, 30, dist2(x, z, L.pyramid[0], L.pyramid[1]));
    h = lerp(h, plateau, smoothstep(-65.5, -69, z));
    const rampMask = smoothstep(4.2, 2.8, Math.abs(x - 61)) * smoothstep(-59, -62, z);
    const rampY = lerp(1.1, PLATEAU_Y, clamp((-z - 62) / 17, 0, 1));
    h = lerp(h, rampY, rampMask * smoothstep(-86, -80, z));
    // hills around the edge of the world
    const e = Math.max(Math.abs(x) - 98, z - 96, -z - 116);
    if (e > 0) h += e * 2.2;
    return h;
  }

  // Can you walk from a to b? Blocks cliffs and the world's edge.
  function canStep(ax, az, bx, bz) {
    if (Math.abs(bx) > 106 || bz > 104 || bz < -124) return false;
    const d = Math.hypot(bx - ax, bz - az) || 1e-6;
    return heightAt(bx, bz) - heightAt(ax, az) <= 1.1 * d + 0.02;
  }

  function terrainColor(x, z, y, slope) {
    const n = vnoise(x * 0.15, z * 0.15), pd = pathDist(x, z);
    if (slope > 0.62) return n > 0.5 ? 0x3f3f52 : 0x4a4a60;
    if (y < -0.25) return n > 0.5 ? 0x2a2a1a : 0x333322;
    if (y < 0.25) return 0x39401f;
    if (dist2(x, z, L.pyramid[0], L.pyramid[1]) < 30 && y > PLATEAU_Y - 1) return 0x1a1430;
    if (pd < 2.2) return n > 0.5 ? 0x5a4630 : 0x4d3b28;
    if (pd < 3.2) return 0x4a5a2a;
    if (Math.abs(x) > 96 || z > 94 || z < -114) return 0x253d1e;
    return [0x2f4a22, 0x3b5a28, 0x4a6d2e, 0x345225][Math.floor(n * 3.99)];
  }

  /* ---------- materials ---------- */

  function ps1(mat, { wave = false } = {}) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSnap = SNAP;
      shader.uniforms.uTime = TIME;
      shader.vertexShader = 'uniform vec2 uSnap;\nuniform float uTime;\n' + shader.vertexShader;
      if (wave) {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n transformed.y += sin(position.x * 0.35 + uTime * 1.3) * 0.06 + cos(position.z * 0.3 + uTime) * 0.06;');
      }
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;');
    };
    mat.customProgramCacheKey = () => 'ps1' + (wave ? 'w' : '');
    return mat;
  }
  const lambert = (o) => ps1(new THREE.MeshLambertMaterial(o));
  const basic = (o) => ps1(new THREE.MeshBasicMaterial(o));
  const texRepeat = (t, u, v) => { const c = t.clone(); c.repeat.set(u, v); c.needsUpdate = true; return c; };

  /* ---------- geometry helpers ---------- */

  // Merges primitives into one non-indexed geometry with per-part vertex colours.
  function merge(parts) {
    const geos = parts.map(({ geo, m, color }) => {
      const g = (geo.index ? geo.toNonIndexed() : geo.clone());
      if (m) g.applyMatrix4(m);
      g.userData.color = new THREE.Color(color === undefined ? 0xffffff : color);
      return g;
    });
    const count = geos.reduce((n, g) => n + g.attributes.position.count, 0);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2), col = new Float32Array(count * 3);
    let o = 0;
    for (const g of geos) {
      const n = g.attributes.position.count, c = g.userData.color;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      for (let k = 0; k < n; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
      o += n;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }
  const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  function gnarl(geo, amt, seed) { // jitter vertices so shapes look grown, not made
    const r = rng(seed), p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!seen.has(key)) seen.set(key, [(r() - 0.5) * amt, (r() - 0.5) * amt * 0.5, (r() - 0.5) * amt]);
      const [dx, dy, dz] = seen.get(key);
      p.setXYZ(i, p.getX(i) + dx, p.getY(i) + dy, p.getZ(i) + dz);
    }
    geo.computeVertexNormals();
    return geo;
  }
  const cross = (w, h) => merge([
    { geo: new THREE.PlaneGeometry(w, h), m: M(0, h / 2, 0) },
    { geo: new THREE.PlaneGeometry(w, h), m: M(0, h / 2, 0, 0, Math.PI / 2) },
  ]);

  /* ---------- collision ---------- */

  const CELL = 8;
  const grid = new Map();
  const boxes = [];
  function addCircle(x, z, r) {
    const c = { x, z, r };
    const k0 = Math.floor((x - r) / CELL), k1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = k0; i <= k1; i++) for (let j = j0; j <= j1; j++) { const key = i + ',' + j; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(c); }
    return c;
  }
  function addBox(x0, z0, x1, z1, id) { const b = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), id, active: true }; boxes.push(b); return b; }
  function collide(p, r) {
    const list = grid.get(Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL));
    if (list) for (const c of list) {
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = r + c.r;
      if (d < min && d > 1e-6) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
    }
    for (const b of boxes) {
      if (!b.active) continue;
      const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-6) { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
        else { const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bb = b.z1 - p.z, m = Math.min(l, rr, t, bb); if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.z = b.z0 - r; else p.z = b.z1 + r; }
      }
    }
  }
  function blockedByBox(x, z, r) {
    for (const b of boxes) if (b.active && x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return b;
    return null;
  }

  /* ---------- build ---------- */

  const W = { L, PATHS, heightAt, canStep, collide, pathDist, blockedByBox, SNAP, TIME, PLATEAU_Y };

  function build(scene) {
    const r = rng(2024);

    // Terrain: per-face colours for the faceted low-poly look.
    let geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 130, 130);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    const tp = geo.attributes.position, col = new Float32Array(tp.count * 3), c = new THREE.Color();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i < tp.count; i += 3) {
      a.fromBufferAttribute(tp, i); b.fromBufferAttribute(tp, i + 1); d.fromBufferAttribute(tp, i + 2);
      const cx = (a.x + b.x + d.x) / 3, cy = (a.y + b.y + d.y) / 3, cz = (a.z + b.z + d.z) / 3;
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
      c.setHex(terrainColor(cx, cz, cy, 1 - Math.abs(n.y)));
      for (let k = 0; k < 3; k++) c.toArray(col, (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const terrain = new THREE.Mesh(geo, lambert({ vertexColors: true, map: texRepeat(TEX.ground, 65, 65), flatShading: true }));
    scene.add(terrain);

    // Water: murky swamp green, clearer blue in the pool.
    const wgeo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 64, 64);
    wgeo.rotateX(-Math.PI / 2);
    const wp = wgeo.attributes.position, wc = new Float32Array(wp.count * 3), swampC = new THREE.Color(0x1f3a30), poolC = new THREE.Color(0x1d5a78);
    for (let i = 0; i < wp.count; i++) {
      const t = smoothstep(40, 10, dist2(wp.getX(i), wp.getZ(i), L.pool[0], L.pool[1]));
      c.copy(swampC).lerp(poolC, t).toArray(wc, i * 3);
    }
    wgeo.setAttribute('color', new THREE.BufferAttribute(wc, 3));
    const water = new THREE.Mesh(wgeo, ps1(new THREE.MeshLambertMaterial({ vertexColors: true, map: texRepeat(TEX.water, 40, 40), transparent: true, opacity: 0.84, depthWrite: false }), { wave: true }));
    water.position.y = 0.05;
    water.renderOrder = 2;
    scene.add(water);

    // Sky dome with the striped retro sun, low in the north-west.
    const sunDir = new THREE.Vector3(-0.55, 0.085, -0.83).normalize();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: sunDir }, time: TIME, pulse: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir; uniform float time, pulse;
        void main(){
          vec3 d = normalize(vDir); float y = d.y;
          vec3 top = vec3(0.035, 0.02, 0.11), mid = vec3(0.14, 0.07, 0.3), hor = vec3(0.4, 0.15, 0.42);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, y)); col = mix(col, top, smoothstep(0.22, 0.75, y));
          if (y < 0.0) col = mix(hor, vec3(0.17, 0.1, 0.3), smoothstep(0.0, -0.15, y));
          vec3 sd = floor(d * 170.0); float st = fract(sin(dot(sd, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          col += step(0.9965, st) * smoothstep(0.05, 0.35, y) * (0.55 + 0.45 * sin(time * 2.0 + st * 90.0));
          float ang = acos(clamp(dot(d, sunDir), -1.0, 1.0)), R = 0.17;
          if (ang < R) {
            float v = clamp((d.y - sunDir.y) / R, -1.0, 1.0);
            vec3 sc = mix(vec3(0.77, 0.24, 0.78), vec3(1.0, 0.95, 0.66), smoothstep(-0.9, 0.9, v));
            float band = 0.0;
            if (v < 0.25) { float k = (0.25 - v) * 5.0; band = step(fract(k), min(0.18 + floor(k) * 0.14, 0.75)); }
            col = mix(col, sc, (1.0 - band));
          }
          col += vec3(1.0, 0.4, 0.6) * pow(max(dot(d, sunDir), 0.0), 10.0) * (0.3 + pulse * 0.08);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), skyMat);
    sky.renderOrder = -10;
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(0x8a6ad8, 0x1a3a22, 1.25));
    const sun = new THREE.DirectionalLight(0xff9a7a, 1.1);
    sun.position.copy(sunDir).multiplyScalar(100);
    scene.add(sun);

    /* ----- vegetation ----- */

    const blocked = (x, z, pad = 0) => {
      if (pathDist(x, z) < 3.8 + pad) return true;
      const near = (k, rad) => dist2(x, z, L[k][0], L[k][1]) < rad;
      return near('clearing', 13) || near('tree', 10) || near('spawn', 6) || near('pool', 11) || near('hollow', 7)
        || near('pyramid', 30) || near('stone3', 8) || near('warden', 9) || near('stone2', 6)
        || (Math.abs(x - L.ruins[0]) < 13 && Math.abs(z - L.ruins[1] - 1) < 13)
        || (Math.abs(x - 61) < 5 && z < -58 && z > -84);
    };
    const inst = (geo, mat, list, withCollider = 0) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        im.setMatrixAt(i, M(t.x, t.y, t.z, t.rx || 0, t.ry || 0, t.rz || 0, t.s, t.sy || t.s, t.s));
        if (withCollider) addCircle(t.x, t.z, withCollider * t.s);
      });
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      return im;
    };
    const scatter = (n, test, spacing, seedOff = 0) => {
      const out = [], rr = rng(77 + seedOff);
      for (let tries = 0; tries < n * 30 && out.length < n; tries++) {
        const x = (rr() * 2 - 1) * 112, z = (rr() * 2 - 1) * 118 - 6, y = heightAt(x, z);
        if (!test(x, z, y)) continue;
        if (spacing && out.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < spacing * spacing)) continue;
        out.push({ x, y, z, ry: rr() * Math.PI * 2, s: 0.75 + rr() * 0.6 });
      }
      return out;
    };

    // Jungle giants: buttressed trunks and layered canopies.
    const trunkGeo = merge([
      { geo: gnarl(new THREE.CylinderGeometry(0.45, 0.85, 12, 6, 4), 0.25, 1), m: M(0, 6, 0) },
      ...[0, 1, 2, 3].map((k) => ({ geo: new THREE.BoxGeometry(0.25, 2.2, 1.9), m: M(Math.sin(k * 1.57) * 0.75, 0.9, Math.cos(k * 1.57) * 0.75, 0, k * 1.57, 0) })),
      { geo: new THREE.CylinderGeometry(0.12, 0.25, 4, 5), m: M(1.2, 10, 0, 0, 0, -0.8) },
      { geo: new THREE.CylinderGeometry(0.12, 0.25, 4, 5), m: M(-1.1, 9.4, 0.4, 0.3, 0, 0.9) },
    ]);
    const canopyGeo = merge([
      { geo: gnarl(new THREE.IcosahedronGeometry(3.4, 0), 0.8, 2), m: M(0, 12.4, 0, 0, 0, 0, 1, 0.55, 1), color: 0xbfcfbf },
      { geo: gnarl(new THREE.IcosahedronGeometry(2.6, 0), 0.7, 3), m: M(2.4, 11.2, 0.6, 0, 0.5, 0, 1, 0.6, 1), color: 0xa9bca9 },
      { geo: gnarl(new THREE.IcosahedronGeometry(2.4, 0), 0.7, 4), m: M(-2.2, 10.8, -0.8, 0, 1, 0, 1, 0.6, 1), color: 0x9fb09f },
      { geo: gnarl(new THREE.IcosahedronGeometry(2.0, 0), 0.6, 5), m: M(0.3, 14.3, -0.4, 0, 0.2, 0, 1, 0.6, 1), color: 0xd0e0d0 },
    ]);
    const trees = scatter(210, (x, z, y) => y > 0.2 && !blocked(x, z, 1.2), 6.5, 1);
    const barkMat = lambert({ map: texRepeat(TEX.bark, 2, 3), vertexColors: true, flatShading: true });
    const leafMat = lambert({ map: texRepeat(TEX.leaves, 3, 3), vertexColors: true, flatShading: true });
    inst(trunkGeo, barkMat, trees, 0.8);
    inst(canopyGeo, leafMat, trees);

    // Palms along the water and paths.
    const palmTrunk = merge([0, 1, 2, 3, 4].map((k) => ({ geo: new THREE.CylinderGeometry(0.2, 0.26, 1.6, 5), m: M(k * k * 0.06, 0.8 + k * 1.5, 0, 0, 0, -0.08 * k) })));
    const palmCrown = merge([0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ geo: new THREE.PlaneGeometry(3.4, 1.4), m: M(1.2 + Math.cos(k * 0.785) * 1.5, 7.6, Math.sin(k * 0.785) * 1.5, 0, -k * 0.785, -0.45) })));
    const palms = scatter(70, (x, z, y) => y > 0.1 && y < 3 && !blocked(x, z, -1.4) && pathDist(x, z) < 12, 5, 2);
    inst(palmTrunk, barkMat, palms, 0.4);
    inst(palmCrown, lambert({ map: TEX.frond, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true }), palms);

    // Dead swamp trees dripping with moss.
    const deadTrunk = merge([
      { geo: gnarl(new THREE.CylinderGeometry(0.3, 0.7, 7, 5, 3), 0.3, 9), m: M(0, 3.5, 0) },
      { geo: new THREE.CylinderGeometry(0.08, 0.2, 3.5, 4), m: M(1.2, 6, 0, 0, 0, -1.0) },
      { geo: new THREE.CylinderGeometry(0.08, 0.2, 3, 4), m: M(-1.0, 5.2, 0.3, 0.2, 0, 1.1) },
      { geo: new THREE.CylinderGeometry(0.06, 0.15, 2.4, 4), m: M(0.2, 7.4, -0.9, -0.9, 0, 0) },
    ]);
    const deadMoss = merge([[1.9, 6.4, 0], [-1.7, 5.6, 0.3], [0.2, 7.6, -1.6], [0.9, 5.6, 0.8]].map(([x, y, z], k) => ({ geo: new THREE.PlaneGeometry(1.2, 3.2), m: M(x, y - 1.6, z, 0, k * 1.1, 0) })));
    const swampTrees = scatter(26, (x, z, y) => y < 0.4 && dist2(x, z, L.swamp[0], L.swamp[1]) < 30 && dist2(x, z, L.tree[0], L.tree[1]) > 10 && pathDist(x, z) > 3, 6, 3);
    const deadMat = lambert({ map: texRepeat(TEX.bark, 1, 2), vertexColors: true, flatShading: true, color: 0x8a8070 });
    inst(deadTrunk, deadMat, swampTrees, 0.5);
    const mossMat = lambert({ map: TEX.hangMoss, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    inst(deadMoss, mossMat, swampTrees);

    // Hanging vines from the canopy.
    const vines = trees.filter((_, i) => i % 2 === 0).map((t) => ({ x: t.x + (r() - 0.5) * 3, y: t.y + 5 + r() * 3, z: t.z + (r() - 0.5) * 3, ry: r() * 3, s: 1, sy: 1 + r() }));
    inst(merge([{ geo: new THREE.PlaneGeometry(0.8, 6), m: M(0, 3, 0) }]), mossMat, vines);

    // Undergrowth.
    const ferns = scatter(520, (x, z, y) => y > 0 && pathDist(x, z) > 2.2 && !(dist2(x, z, L.pyramid[0], L.pyramid[1]) < 26), 0, 4);
    ferns.forEach((f) => { f.s *= 1.6; });
    inst(cross(2.2, 1.6), lambert({ map: TEX.fern, alphaTest: 0.5, side: THREE.DoubleSide }), ferns);
    const bigLeaves = scatter(120, (x, z, y) => y > 0 && pathDist(x, z) > 2.6 && !blocked(x, z, -1.5), 3, 5);
    const leafFan = merge([0, 1, 2, 3, 4].map((k) => ({ geo: new THREE.PlaneGeometry(1.4, 1.8), m: M(Math.cos(k * 1.25) * 0.7, 0.9, Math.sin(k * 1.25) * 0.7, -0.5, -k * 1.25 + Math.PI / 2, 0) })));
    inst(leafFan, lambert({ map: TEX.bigleaf, alphaTest: 0.5, side: THREE.DoubleSide }), bigLeaves);
    const reeds = scatter(260, (x, z, y) => y > -0.9 && y < 0.4, 0, 6);
    inst(cross(1.2, 2.2), lambert({ map: TEX.reeds, alphaTest: 0.5, side: THREE.DoubleSide }), reeds);
    const rocks = scatter(70, (x, z, y) => y > 0 && !blocked(x, z, -1), 4, 7);
    inst(gnarl(new THREE.DodecahedronGeometry(0.9, 0), 0.3, 11), lambert({ map: texRepeat(TEX.moss, 1, 1), flatShading: true, color: 0x9a9aa8 }), rocks, 0.8);
    const lilies = scatter(90, (x, z, y) => y < -0.35, 0, 8).map((l) => ({ ...l, y: 0.1, s: 0.6 + l.s * 0.5 }));
    inst(merge([{ geo: new THREE.PlaneGeometry(1.2, 1.2), m: M(0, 0, 0, -Math.PI / 2) }]), lambert({ map: TEX.lily, alphaTest: 0.5, side: THREE.DoubleSide }), lilies);

    // Glowing mushrooms: they bounce to your kicks.
    const shroomSpots = scatter(90, (x, z, y) => y > 0.1 && pathDist(x, z) > 1.8 && pathDist(x, z) < 9, 2.5, 9);
    const stemGeo = merge([{ geo: new THREE.CylinderGeometry(0.1, 0.14, 0.6, 5), m: M(0, 0.3, 0), color: 0xf5e6c8 }]);
    const capGeo = merge([{ geo: new THREE.SphereGeometry(0.42, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), m: M(0, 0.55, 0, 0, 0, 0, 1, 0.8, 1) }]);
    const stems = inst(stemGeo, lambert({ vertexColors: true }), shroomSpots);
    const caps = inst(capGeo, basic({ map: TEX.cap }), shroomSpots);
    const mushrooms = { spots: shroomSpots, stems, caps, bounce: 0 };

    /* ----- landmarks ----- */

    const stoneMat = lambert({ map: texRepeat(TEX.stone, 1, 1), flatShading: true });
    const stoneMatBig = lambert({ map: texRepeat(TEX.stone, 3, 1), flatShading: true });

    // The Summoning Tree: the wizard is torn out of it at the start.
    const tree = new THREE.Group();
    const ty = heightAt(L.tree[0], L.tree[1]) - 0.5;
    tree.position.set(L.tree[0], ty, L.tree[1]);
    const giantBark = lambert({ map: texRepeat(TEX.bark, 4, 5), flatShading: true, color: 0x9a8a78 });
    const tr = gnarl(new THREE.CylinderGeometry(2.3, 4.2, 18, 9, 7), 1.1, 21);
    tr.translate(0, 9, 0);
    tree.add(new THREE.Mesh(tr, giantBark));
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + 0.3, len = 5 + (k % 3) * 1.5;
      const root = new THREE.Mesh(gnarl(new THREE.CylinderGeometry(0.35, 1.3, len, 5, 3), 0.4, 30 + k), giantBark);
      root.position.set(Math.sin(ang) * 3.6, 0.9, Math.cos(ang) * 3.6);
      root.rotation.set(Math.cos(ang) * 1.2, 0, -Math.sin(ang) * 1.2);
      tree.add(root);
    }
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2, br = new THREE.Mesh(gnarl(new THREE.CylinderGeometry(0.35, 0.9, 9, 5, 3), 0.5, 40 + k), giantBark);
      br.position.set(Math.sin(ang) * 3, 19, Math.cos(ang) * 3);
      br.rotation.set(Math.cos(ang) * 0.9, 0, -Math.sin(ang) * 0.9);
      tree.add(br);
      const can = new THREE.Mesh(gnarl(new THREE.IcosahedronGeometry(5, 1), 1.4, 50 + k), lambert({ map: texRepeat(TEX.leaves, 3, 3), flatShading: true, color: 0x9fb0a0 }));
      can.position.set(Math.sin(ang) * 7, 23, Math.cos(ang) * 7);
      can.scale.set(1, 0.55, 1);
      tree.add(can);
      for (let m = 0; m < 3; m++) {
        const moss = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 5), mossMat);
        moss.position.set(Math.sin(ang) * (5 + m), 18.5 - m, Math.cos(ang) * (5 + m) + m * 0.4);
        moss.rotation.y = ang + m;
        tree.add(moss);
      }
    }
    // the wound he comes out of (faces the spawn)
    const faceAng = Math.atan2(L.spawn[0] - L.tree[0], L.spawn[1] - L.tree[1]);
    const woundMat = new THREE.MeshBasicMaterial({ color: 0xb6ff5c, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const wound = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 5.2), woundMat);
    wound.position.set(Math.sin(faceAng) * 3.75, 3.2, Math.cos(faceAng) * 3.75);
    wound.rotation.y = faceAng;
    tree.add(wound);
    const woundGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0x9dff6a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    woundGlow.position.copy(wound.position).multiplyScalar(1.05);
    woundGlow.scale.set(7, 9, 1);
    tree.add(woundGlow);
    scene.add(tree);
    addCircle(L.tree[0], L.tree[1], 4.4);

    // The Panther Ruins.
    const ruins = new THREE.Group();
    const wall = (x0, z0, x1, z1, hgt, seed) => {
      const rr = rng(seed), len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2));
      for (let i = 0; i < n; i++) {
        if (rr() < 0.12) continue;
        const t = (i + 0.5) / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t), h = hgt * (0.45 + rr() * 0.55);
        const blk = new THREE.Mesh(new THREE.BoxGeometry(x1 !== x0 ? len / n : 1.3, h, z1 !== z0 ? len / n : 1.3), stoneMat);
        blk.position.set(x, heightAt(x, z) + h / 2 - 0.2, z);
        blk.rotation.y = (rr() - 0.5) * 0.05;
        ruins.add(blk);
      }
      addBox(x0 - 0.65, z0 - 0.65, x1 + 0.65, z1 + 0.65, 'wall');
    };
    wall(1, 15, 26, 15, 3.4, 1);
    wall(1, 15, 1, 8, 3.2, 2); wall(1, -1, 1, -9.5, 3.2, 3);
    wall(26, 15, 26, -9.5, 3.0, 4);
    for (const [x, z, h] of [[6, 10, 5.5], [20, 10, 3.2], [6, -3, 4.4], [21, -4, 6]]) {
      const col2 = new THREE.Mesh(gnarl(new THREE.CylinderGeometry(0.7, 0.8, h, 8), 0.1, x), stoneMatBig);
      col2.position.set(x, heightAt(x, z) + h / 2 - 0.2, z);
      ruins.add(col2);
      addCircle(x, z, 0.9);
    }
    const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4, 8), stoneMatBig);
    fallen.position.set(9, heightAt(9, 6) + 0.5, 6); fallen.rotation.set(0, 0.6, Math.PI / 2);
    ruins.add(fallen); addCircle(8.2, 5.4, 1); addCircle(9.8, 6.6, 1);
    const altarY = heightAt(L.altar[0], L.altar[1]) - 0.2;
    [[6, 0.6], [4.4, 1.2], [3, 1.8]].forEach(([s, y]) => {
      const st = new THREE.Mesh(new THREE.BoxGeometry(s, 0.6, s), stoneMat);
      st.position.set(L.altar[0], altarY + y - 0.3, L.altar[1]);
      ruins.add(st);
    });
    addCircle(L.altar[0], L.altar[1], 2.4);
    scene.add(ruins);
    const altarTop = altarY + 1.8;

    // The vine wall in the ridge gap (burn it with snare bolts).
    const vineWallMesh = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 1), lambert({ map: texRepeat(TEX.vine, 3, 2), alphaTest: 0.4, side: THREE.DoubleSide }));
    vineWallMesh.position.set(L.gate1[0], heightAt(L.gate1[0], L.gate1[1]) + 2.6, L.gate1[1]);
    scene.add(vineWallMesh);
    const vineWall = { mesh: vineWallMesh, hp: 3, box: addBox(L.gate1[0] - 4, L.gate1[1] - 0.6, L.gate1[0] + 4, L.gate1[1] + 0.6, 'vines'), x: L.gate1[0], z: L.gate1[1], alive: true };

    // The waterfall pouring off the plateau into the pool.
    const fallsTex = texRepeat(TEX.falls, 2, 3);
    const falls = new THREE.Mesh(new THREE.PlaneGeometry(6, 11), basic({ map: fallsTex, transparent: true, opacity: 0.85 }));
    falls.position.set(L.falls[0], 4.2, L.falls[1] + 0.6);
    scene.add(falls);
    const foam = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xbff6ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    foam.position.set(L.falls[0], 0.8, L.falls[1] + 1.8); foam.scale.set(9, 4, 1);
    scene.add(foam);
    // a rock for the Sub Toad
    const toadRock = new THREE.Mesh(gnarl(new THREE.DodecahedronGeometry(1.6, 0), 0.4, 88), lambert({ map: TEX.moss, flatShading: true, color: 0xa0a0b0 }));
    toadRock.position.set(L.toad[0], -0.2, L.toad[1]); toadRock.scale.set(1.4, 0.8, 1.2);
    scene.add(toadRock);
    addCircle(L.toad[0], L.toad[1], 2.2);

    // Cracked stone gate at the foot of the ramp (break it with the bass).
    const gateGroup = new THREE.Group();
    const crackedMat = lambert({ map: TEX.cracked, flatShading: true });
    const gy = heightAt(L.gate2[0], L.gate2[1]);
    const gateBlocks = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const blk = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1.6), crackedMat);
      blk.position.set(L.gate2[0] - 3 + i * 2 + 0.0, gy + 1 + j * 2, L.gate2[1]);
      blk.rotation.y = (r() - 0.5) * 0.1;
      gateGroup.add(blk); gateBlocks.push(blk);
    }
    scene.add(gateGroup);
    const crackedGate = { group: gateGroup, blocks: gateBlocks, box: addBox(L.gate2[0] - 4.2, L.gate2[1] - 0.9, L.gate2[0] + 4.2, L.gate2[1] + 0.9, 'cracked'), x: L.gate2[0], z: L.gate2[1], alive: true };

    // Loop Stones: monoliths with three rings of 32 notches that show your loop.
    const stones = ['stone1', 'stone2', 'stone3'].map((key, idx) => {
      const [x, z] = L[key], y = heightAt(x, z) - 0.1, g = new THREE.Group();
      g.position.set(x, y, z);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 0.5, 8), stoneMat);
      plinth.position.y = 0.2; g.add(plinth);
      const body = new THREE.Mesh(gnarl(new THREE.BoxGeometry(1.5, 3.6, 0.9, 1, 3, 1), 0.12, 60 + idx), stoneMatBig);
      body.position.y = 2.2; g.add(body);
      const capM = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.9, 4), stoneMat);
      capM.position.y = 4.45; capM.rotation.y = Math.PI / 4; g.add(capM);
      const runeMat = new THREE.MeshBasicMaterial({ map: TEX.rune, transparent: true, alphaTest: 0.3, color: 0x2a2d45 });
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), runeMat);
      rune.position.set(0, 2.5, 0.46); g.add(rune);
      const rune2 = rune.clone(); rune2.position.z = -0.46; rune2.rotation.y = Math.PI; g.add(rune2);
      const notches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.14, 0.34), new THREE.MeshBasicMaterial({ color: 0xffffff }), 96);
      const mm = new THREE.Matrix4();
      LANES.forEach((lane, li) => {
        const rad = 2.5 + li * 0.5;
        for (let s = 0; s < LOOP; s++) {
          const ang = (s / LOOP) * Math.PI * 2;
          mm.compose(new THREE.Vector3(Math.sin(ang) * rad, 0.5 + li * 0.02, Math.cos(ang) * rad), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, 0)), new THREE.Vector3(1, 1, 1));
          notches.setMatrixAt(li * LOOP + s, mm);
          notches.setColorAt(li * LOOP + s, new THREE.Color(0x221d38));
        }
      });
      g.add(notches);
      const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0x7ff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glowS.position.y = 2.6; glowS.scale.set(6, 7, 1); g.add(glowS);
      g.rotation.y = [0.6, -0.3, 0.9][idx];
      scene.add(g);
      addCircle(x, z, 1.4);
      return { key, x, z, y, group: g, rune: [runeMat], notches, glow: glowS, carved: false, index: idx };
    });

    // The Lost Pyramid on its neon grid.
    const pyr = new THREE.Group();
    const [px, pz] = L.pyramid, py = heightAt(px, pz);
    pyr.position.set(px, py - 0.3, pz);
    const face = Math.atan2(L.stone3[0] - px, L.stone3[1] - pz);
    pyr.rotation.y = face;
    let yy = 0;
    for (let k = 0; k < 7; k++) {
      const s = 28 - k * 3.7;
      const tier = new THREE.Mesh(new THREE.BoxGeometry(s, 2.6, s), lambert({ map: texRepeat(TEX.stone, Math.round(s / 3), 1), flatShading: true }));
      tier.position.y = yy + 1.3; pyr.add(tier); yy += 2.6;
    }
    const temple = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5), stoneMatBig);
    temple.position.y = yy + 2; pyr.add(temple);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.4, 4), stoneMat);
    roof.position.y = yy + 5.2; roof.rotation.y = Math.PI / 4; pyr.add(roof);
    const eyeC = makeCanvas(32, 16), ex = eyeC.getContext('2d');
    ex.fillStyle = '#e9e3cf'; ex.beginPath(); ex.ellipse(16, 8, 15, 7, 0, 0, Math.PI * 2); ex.fill();
    ex.fillStyle = '#2fb9d0'; ex.beginPath(); ex.arc(16, 8, 6, 0, Math.PI * 2); ex.fill();
    ex.fillStyle = '#07060f'; ex.fillRect(14, 4, 4, 8); ex.fillStyle = '#fff'; ex.fillRect(12, 4, 2, 2);
    const eyeTex = new THREE.CanvasTexture(eyeC); eyeTex.magFilter = eyeTex.minFilter = THREE.NearestFilter; eyeTex.generateMipmaps = false;
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true }));
    eye.position.set(0, yy + 2.2, 2.55); pyr.add(eye);
    const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0x7ff6ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    eyeGlow.position.set(0, yy + 2.2, 3.2); eyeGlow.scale.set(9, 6, 1); pyr.add(eyeGlow);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 120, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = yy + 64; pyr.add(beam);
    // door + three lane runes above it
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.8), stoneMatBig);
    door.position.set(0, 2.5, 14.3); pyr.add(door);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 6.2, 0.6), new THREE.MeshBasicMaterial({ color: 0x07060f }));
    doorFrame.position.set(0, 3.1, 14.05); pyr.add(doorFrame);
    const doorLight = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffe36e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    doorLight.position.set(0, 3, 14.6); doorLight.scale.set(10, 10, 1); pyr.add(doorLight);
    const doorRunes = LANES.map((lane, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TEX.rune, transparent: true, alphaTest: 0.3, color: 0x2a2d45 }));
      m.position.set(-1.6 + i * 1.6, 6.9, 14.36); pyr.add(m);
      return m;
    });
    scene.add(pyr);
    addCircle(px, pz, 14.2);
    for (let k = 0; k < 4; k++) { const a = face + Math.PI / 4 + (k * Math.PI) / 2; addCircle(px + Math.sin(a) * 15, pz + Math.cos(a) * 15, 4.5); }
    const doorWorld = new THREE.Vector3(0, 0, 15.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), face).add(new THREE.Vector3(px, py, pz));

    const gridMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { pulse: { value: 0 }, lit: { value: 0.25 } }]),
      vertexShader: `varying vec2 vPos;
        #include <fog_pars_vertex>
        void main(){
          vPos = position.xy; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec2 vPos; uniform float pulse, lit;
        #include <fog_pars_fragment>
        void main(){
          vec2 q = vPos / 3.0; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float fade = 1.0 - smoothstep(18.0, 30.0, length(vPos));
          gl_FragColor = vec4(mix(vec3(1.0, 0.3, 0.85), vec3(0.5, 0.95, 1.0), pulse * 0.5), line * fade * (lit + pulse * 0.4));
          #include <fog_fragment>
        }`,
    });
    gridMat.extensions = { derivatives: true };
    const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), gridMat);
    gridPlane.rotation.x = -Math.PI / 2;
    gridPlane.position.set(px, py + 0.12, pz);
    scene.add(gridPlane);

    // Mist over the swamp.
    const mist = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0x9ab09a, transparent: true, opacity: 0.12, depthWrite: false }));
      s.position.set(L.swamp[0] + (r() - 0.5) * 44, 0.9 + r() * 0.8, L.swamp[1] + (r() - 0.5) * 34);
      s.scale.set(14 + r() * 10, 3 + r() * 2, 1);
      s.userData.phase = r() * 6;
      scene.add(s); mist.push(s);
    }

    // Collectible fireflies: clusters along the paths.
    const fireflies = [];
    const fr = rng(5);
    for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      for (let t = 0.2; t < 1; t += 0.45) {
        const x = lerp(ax, bx, t) + (fr() - 0.5) * 6, z = lerp(az, bz, t) + (fr() - 0.5) * 6;
        for (let k = 0; k < 3; k++) fireflies.push({ x: x + (fr() - 0.5) * 3, y: Math.max(heightAt(x, z), 0.2) + 1.2 + fr() * 1.4, z: z + (fr() - 0.5) * 3, taken: false, phase: fr() * 6 });
      }
    }

    // Moth spawns, grouped by zone so the challenge grows.
    const mothSpawns = [
      [-8, 6], [0, -2], [22, -22], [26, -30], [34, -36], [30, -40], [38, -30], [24, -44], [44, -50], [52, -56], [66, -84], [80, -90], [74, -100], [86, -88],
    ];

    Object.assign(W, {
      terrain, water, sky, skyMat, sun, tree, wound, woundMat, woundGlow, altarTop, vineWall, crackedGate, stones,
      pyramid: { group: pyr, eye, eyeGlow, beam, door, doorLight, doorRunes, doorWorld, face, open: false, doorY: 2.5 },
      gridMat, falls, fallsTex, foam, mist, mushrooms, fireflies, mothSpawns,
    });
    return W;
  }

  // Per-frame ambience: waterfall, mist, mushrooms, the grid and the eye pulse.
  const tmpM = new THREE.Matrix4();
  function update(t, dt, pulse) {
    TIME.value = t;
    W.fallsTex.offset.y = -t * 1.4;
    W.skyMat.uniforms.pulse.value = pulse;
    W.gridMat.uniforms.pulse.value = pulse;
    W.pyramid.eyeGlow.material.opacity = 0.35 + pulse * 0.45;
    W.foam.material.opacity = 0.4 + Math.sin(t * 9) * 0.08;
    for (const m of W.mist) { m.position.x += Math.sin(t * 0.1 + m.userData.phase) * dt * 0.6; m.material.opacity = 0.09 + Math.sin(t * 0.3 + m.userData.phase) * 0.03; }
    const mu = W.mushrooms;
    if (mu.bounce > 0.001 || mu.dirty) {
      mu.bounce *= Math.pow(0.004, dt);
      const sq = 1 - mu.bounce * 0.35, st = 1 + mu.bounce * 0.3;
      mu.spots.forEach((s, i) => {
        tmpM.compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.ry, 0)), new THREE.Vector3(s.s * st, s.s * sq, s.s * st));
        mu.caps.setMatrixAt(i, tmpM); mu.stems.setMatrixAt(i, tmpM);
      });
      mu.caps.instanceMatrix.needsUpdate = true; mu.stems.instanceMatrix.needsUpdate = true;
      mu.dirty = mu.bounce > 0.001;
    }
  }

  W.build = build;
  W.update = update;
  return W;
})();
