'use strict';
/* world.js: builds the 3D jungle from Terrain and plays its visual actions. The ground and the water,
   the night sky, instanced vegetation, the Summoning Tree, the Panther Ruins, the vine wall and the
   cracked gate, the Loop Stones, the falls and the Lost Pyramid on its neon grid.
   World.build(scene, {quality: 'low'|'high'}) fills in and returns World itself.
   Draw calls are kept low for phones: all static stone is one mesh, vegetation is instanced, the
   water is opaque, the neon lines are one line mesh and every particle is a point in one of three sets. */

const World = (() => {
  const { L, PATHS, PLATEAU_Y, WATER_Y, GRID, MAX_SLOPE, heightAt, slopeAt, pathDist, keepClear } = Terrain;
  const SNAP = { value: new THREE.Vector2(213, 120) }; // PS1 vertex snapping grid, half the render target
  const TIME = { value: 0 };
  const TAU = Math.PI * 2;
  const SUN = new THREE.Vector3(0.64, 0.2, -0.74).normalize(); // the striped sun sets behind the pyramid
  const FOG = 0x2a1f44;
  const W = { L, PATHS, PLATEAU_Y, WATER_Y, heightAt, pathDist, canStep: Terrain.canStep, SNAP, TIME };

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
  const lambert = (o, opt) => ps1(new THREE.MeshLambertMaterial(o), opt);
  const basic = (o, opt) => ps1(new THREE.MeshBasicMaterial(o), opt);
  const tex = (t, u = 1, v = u) => { const c = t.clone(); c.repeat.set(u, v); c.needsUpdate = true; return c; };
  const glowSprite = (color, opacity, sx, sy) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(sx, sy, 1);
    return s;
  };

  // Points drawn at a world size, measured in render-target pixels (the built-in points scale by the canvas).
  function pointsMat() {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: TEX.glow } }]);
    uniforms.uSnap = SNAP;
    return new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 tint; uniform vec2 uSnap;
        varying vec3 vTint; varying float vAlpha, vDepth;
        void main() {
          vTint = tint; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = alpha > 0.004 ? max(1.0, size * uSnap.y * projectionMatrix[1][1] / -mv.z) : 0.0;
          vDepth = -mv.z;
        }`,
      fragmentShader: `uniform sampler2D map; uniform float fogNear, fogFar; varying vec3 vTint; varying float vAlpha, vDepth;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha * (1.0 - smoothstep(fogNear, fogFar * 1.4, vDepth));
          if (a < 0.02) discard;
          gl_FragColor = vec4(vTint * a, 1.0);
        }`,
    });
  }
  // Additive neon lines that fade to black with distance (normal fog would add the fog colour).
  function neonMat() {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { gain: { value: 1 } }]);
    uniforms.uSnap = SNAP;
    return new THREE.ShaderMaterial({
      uniforms, fog: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform vec2 uSnap; varying vec3 vCol; varying float vDepth;
        void main() {
          vCol = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vDepth = -mv.z;
          gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;
        }`,
      fragmentShader: `uniform float gain, fogNear, fogFar; varying vec3 vCol; varying float vDepth;
        void main() { gl_FragColor = vec4(vCol * gain * (1.0 - smoothstep(fogNear, fogFar, vDepth)), 1.0); }`,
    });
  }
  function pointSet(n) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n).fill(0.3), 1));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const p = new THREE.Points(g, pointsMat());
    p.frustumCulled = false;
    return p;
  }

  /* ---------- geometry helpers ---------- */

  const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

  // Merges parts into one non-indexed geometry with vertex colours. A part: {geo, m, color, moss, uv}.
  // moss tints the upward faces, uv scales the texture coordinates.
  function merge(parts) {
    let count = 0;
    const geos = parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (p.m) g.applyMatrix4(p.m);
      count += g.attributes.position.count;
      return g;
    });
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2), col = new Float32Array(count * 3);
    const c = new THREE.Color(), top = new THREE.Color();
    let o = 0;
    geos.forEach((g, gi) => {
      const p = parts[gi], n = g.attributes.position.count, na = g.attributes.normal.array;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(na, o * 3);
      if (g.attributes.uv) {
        const a = g.attributes.uv.array, [su, sv] = p.uv || [1, 1];
        for (let k = 0; k < n; k++) { uv[(o + k) * 2] = a[k * 2] * su; uv[(o + k) * 2 + 1] = a[k * 2 + 1] * sv; }
      }
      c.set(p.color === undefined ? 0xffffff : p.color);
      if (p.moss !== undefined) top.set(p.moss);
      for (let k = 0; k < n; k++) (p.moss !== undefined && na[k * 3 + 1] > 0.55 ? top : c).toArray(col, (o + k) * 3);
      o += n;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }
  // A box whose texture keeps its scale on every face (unit world units per repeat).
  function box(w, h, d, unit = 2) {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) { const [fu, fv] = dims[Math.floor(i / 4)]; uv.setXY(i, (uv.getX(i) * fu) / unit, (uv.getY(i) * fv) / unit); }
    return g;
  }
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
  // A tapered tube through points (roots and limbs).
  function tube(pts, r0, r1, radial = 5, unit = 3) {
    const n = pts.length, rings = [], lens = [0], t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), ref = new THREE.Vector3();
    for (let i = 1; i < n; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const len = lens[n - 1];
    for (let i = 0; i < n; i++) {
      t.subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize();
      ref.set(0, 1, 0); if (Math.abs(t.y) > 0.9) ref.set(1, 0, 0);
      a.crossVectors(t, ref).normalize(); b.crossVectors(t, a);
      const r = lerp(r0, r1, lens[i] / len), ring = [];
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * TAU;
        ring.push(pts[i].clone().addScaledVector(a, Math.cos(ang) * r).addScaledVector(b, Math.sin(ang) * r));
      }
      rings.push(ring);
    }
    const pos = [], uv = [], circ = (TAU * (r0 + r1)) / 2;
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
      const A = rings[i][k], B = rings[i][k + 1], C = rings[i + 1][k], D = rings[i + 1][k + 1];
      const u0 = ((k / radial) * circ) / unit, u1 = (((k + 1) / radial) * circ) / unit, v0 = lens[i] / unit, v1 = lens[i + 1] / unit;
      for (const [P, u, v] of [[A, u0, v0], [B, u1, v0], [C, u0, v1], [B, u1, v0], [D, u1, v1], [C, u0, v1]]) { pos.push(P.x, P.y, P.z); uv.push(u, v); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  const curve = (pts, n) => new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))).getPoints(n);
  const cross = (w, h) => merge([
    { geo: new THREE.PlaneGeometry(w, h), m: M(0, h / 2, 0) },
    { geo: new THREE.PlaneGeometry(w, h), m: M(0, h / 2, 0, 0, Math.PI / 2) },
  ]);

  /* ---------- ground colours ---------- */

  const C = (hex) => new THREE.Color(hex);
  const RGB = (r, g, b) => new THREE.Color(r, g, b);
  const RUIN = RGB(1.32, 1.2, 1.02), RUIN2 = RGB(1.2, 1.12, 1.0), MOSSY = RGB(0.8, 1.12, 0.6), MONO = RGB(1.5, 1.42, 1.3);
  const PYR = RGB(1.62, 1.34, 1.12), PYR2 = RGB(1.5, 1.24, 1.08), PAD = RGB(1.1, 1.05, 1.0);
  const TEAL = C(0x1f4a44), OLIVE = C(0x4a5222), DIRT = C(0x9a7048), DIRT2 = C(0x6e5236), MUD = C(0x363826), ASH = C(0x524a60);
  const PLAT = C(0x2c5048), GRIDC = C(0x1c1636), PAVE = C(0x4e5244), ROCK = C(0x5a5870), ROCK2 = C(0x474660), MOSS = C(0x4a6a34);
  function groundColor(x, y, z, out) {
    const n = vnoise(x * 0.13, z * 0.13), m = vnoise(x * 0.035 + 5, z * 0.035 - 3);
    out.setRGB(0.19 + 0.08 * n, 0.33 + 0.11 * n, 0.14 + 0.04 * n);
    out.lerp(m > 0.5 ? TEAL : OLIVE, Math.abs(m - 0.5) * 0.9);
    if (z < -64 && y > PLATEAU_Y - 2.5) out.lerp(PLAT, 0.55);
    out.lerp(GRIDC, smoothstep(34, 22, dist2(x, z, L.pyramid[0], L.pyramid[1])) * (y > PLATEAU_Y - 2 ? 1 : 0));
    out.lerp(ASH, smoothstep(15, 8, dist2(x, z, L.hollow[0], L.hollow[1])) * 0.75);
    out.lerp(PAVE, smoothstep(12.8, 11.2, Math.max(Math.abs(x - 13.5), Math.abs(z - 3))) * 0.4);
    if (y < 0.6) out.lerp(MUD, smoothstep(0.6, -0.2, y));
    const pd = pathDist(x, z);
    out.lerp(DIRT2, smoothstep(3.6, 2.3, pd));
    out.lerp(DIRT, smoothstep(2.0, 0.5, pd) * 0.75);
    return out;
  }
  function rockColor(x, y, z, out) {
    const n = vnoise(x * 0.21 + y * 0.35, z * 0.21 - y * 0.2);
    out.copy(ROCK2).lerp(ROCK, n);
    return out.lerp(MOSS, smoothstep(0.6, 0.85, vnoise(x * 0.09, z * 0.09 + y * 0.12)) * 0.6);
  }

  /* ---------- build ---------- */

  function build(scene, { quality = 'high' } = {}) {
    const hi = quality !== 'low';
    const N = (n) => Math.round(n * (hi ? 1 : 0.5));
    const colliders = Terrain.createColliders();
    const r = rng(2024);
    Object.assign(W, { quality, colliders, collide: colliders.collide, blockedByBox: colliders.blockedByBox });

    scene.fog = new THREE.Fog(FOG, 18, hi ? 118 : 100);
    scene.background = new THREE.Color(FOG);

    /* ----- ground: grass and dirt on one mesh, cliff rock on another ----- */
    {
      const { size, n, half } = GRID, row = n + 1;
      const P = new Float32Array(row * row * 3);
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = -half + i * size, z = -half + j * size, k = (j * row + i) * 3;
        P[k] = x; P[k + 1] = heightAt(x, z); P[k + 2] = z;
      }
      const sets = [{ pos: [], col: [], uv: [] }, { pos: [], col: [], uv: [] }];
      const c = new THREE.Color(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
      const tri = (ka, kb, kc, seed) => {
        const ax = P[ka * 3], ay = P[ka * 3 + 1], az = P[ka * 3 + 2];
        e1.set(P[kb * 3] - ax, P[kb * 3 + 1] - ay, P[kb * 3 + 2] - az);
        e2.set(P[kc * 3] - ax, P[kc * 3 + 1] - ay, P[kc * 3 + 2] - az);
        nn.crossVectors(e1, e2).normalize();
        const steep = Math.sqrt(1 - nn.y * nn.y) / Math.max(nn.y, 1e-3) > MAX_SLOPE;
        const s = sets[steep ? 1 : 0], jit = 0.93 + hash2(seed, 7) * 0.14, side = Math.abs(nn.x) > Math.abs(nn.z);
        for (const k of [ka, kb, kc]) {
          const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
          s.pos.push(x, y, z);
          (steep ? rockColor(x, y, z, c) : groundColor(x, y, z, c)).multiplyScalar(jit);
          s.col.push(c.r, c.g, c.b);
          if (steep) s.uv.push((side ? z : x) / 5, y / 5); else s.uv.push(x / 4, z / 4);
        }
      };
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * row + i, b = a + row;
        tri(a, b, a + 1, a * 2); tri(b, b + 1, a + 1, a * 2 + 1);
      }
      const mesh = (s, map) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, lambert({ vertexColors: true, map, flatShading: true }));
        scene.add(m);
        return m;
      };
      W.terrain = mesh(sets[0], TEX.ground);
      W.cliffs = mesh(sets[1], TEX.rock);
    }

    /* ----- water: opaque, tinted by depth (no overdraw); the pool is clearer ----- */
    const waterTex = tex(TEX.water, 1);
    const waterMat = lambert({ vertexColors: true, map: waterTex, emissive: 0x0c1c2a }, { wave: true });
    {
      const g = new THREE.PlaneGeometry(260, 260, 65, 65);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(p.count * 3), c = new THREE.Color(), deep = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), d = WATER_Y - heightAt(x, z), k = smoothstep(18, 9, dist2(x, z, L.pool[0], L.pool[1]));
        c.set(0x42664e).lerp(C(0x3aa0b8), k);
        deep.set(0x0e2c2a).lerp(C(0x0f4468), k);
        c.lerp(deep, smoothstep(0, 1.3, d)).toArray(col, i * 3);
        uv.setXY(i, x / 6, z / 6);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const water = new THREE.Mesh(g, waterMat);
      water.position.y = WATER_Y;
      water.renderOrder = 1; // after the ground, so hidden water is rejected early
      scene.add(water);
      W.water = water;
    }

    /* ----- sky: a dome drawn behind everything, wherever the camera goes ----- */
    const skyMat = new THREE.ShaderMaterial({
      depthWrite: false, depthTest: false, fog: false, side: THREE.BackSide,
      uniforms: { sunDir: { value: SUN }, time: TIME, pulse: { value: 0 } },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 sunDir; uniform float time, pulse;
        void main(){
          vec3 d = normalize(vDir); float y = d.y;
          float toSun = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
          vec3 hor = mix(vec3(0.2, 0.11, 0.3), vec3(0.62, 0.2, 0.46), pow(toSun, 4.0));
          vec3 col = mix(hor, vec3(0.1, 0.055, 0.22), smoothstep(0.0, 0.3, y));
          col = mix(col, vec3(0.025, 0.018, 0.075), smoothstep(0.3, 0.85, y));
          if (y < 0.0) col = mix(hor, vec3(0.16, 0.1, 0.26), smoothstep(0.0, -0.2, y));
          vec3 sd = floor(d * 160.0); float st = fract(sin(dot(sd, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          col += step(0.9962, st) * smoothstep(0.1, 0.45, y) * (0.55 + 0.45 * sin(time * 2.0 + st * 90.0)) * vec3(0.95, 0.88, 1.0);
          float ang = acos(clamp(dot(d, sunDir), -1.0, 1.0)), R = 0.17;
          if (ang < R) {
            float v = clamp((d.y - sunDir.y) / R, -1.0, 1.0);
            vec3 sc = mix(vec3(1.0, 0.22, 0.58), vec3(1.0, 0.88, 0.45), smoothstep(-0.9, 0.8, v));
            float band = 0.0;
            if (v < 0.25) { float k = (0.25 - v) * 5.0; band = step(fract(k), min(0.16 + floor(k) * 0.14, 0.78)); }
            col = mix(col, sc, 1.0 - band);
          }
          col += vec3(1.0, 0.35, 0.6) * pow(max(dot(d, sunDir), 0.0), 9.0) * (0.35 + pulse * 0.1);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    // Light: a cool sky and a moon from the south-west; the sun only rims things from the north-east.
    scene.add(new THREE.HemisphereLight(0x9a94e8, 0x2a3a26, 2.5));
    const moon = new THREE.DirectionalLight(0xc4c8ff, 2.2);
    moon.position.set(-45, 70, 60);
    scene.add(moon);
    const sun = new THREE.DirectionalLight(0xff7aa8, 1.6);
    sun.position.copy(SUN).multiplyScalar(100);
    scene.add(sun);

    /* ----- vegetation ----- */

    const scatter = (n, test, spacing, seed, area = [-106, 106, -124, 104]) => {
      const out = [], rr = rng(77 + seed), grid = new Map(), cs = Math.max(spacing, 1), sp2 = spacing * spacing;
      const crowded = (x, z) => {
        const i = Math.floor(x / cs), j = Math.floor(z / cs);
        for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
          const l = grid.get(a + ',' + b);
          if (l) for (const o of l) if ((o.x - x) ** 2 + (o.z - z) ** 2 < sp2) return true;
        }
        return false;
      };
      for (let tries = 0; tries < n * 40 && out.length < n; tries++) {
        const x = lerp(area[0], area[1], rr()), z = lerp(area[2], area[3], rr()), y = heightAt(x, z);
        if (!test(x, z, y) || (spacing && crowded(x, z))) continue;
        const o = { x, y, z, ry: rr() * TAU, s: 0.75 + rr() * 0.6, k: rr() };
        out.push(o);
        if (spacing) { const key = Math.floor(x / cs) + ',' + Math.floor(z / cs); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(o); }
      }
      return out;
    };
    const inst = (geo, mat, list, { collider = 0, tint = null } = {}) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      im.count = list.length;
      list.forEach((t, i) => {
        im.setMatrixAt(i, M(t.x, t.y, t.z, t.rx || 0, t.ry || 0, t.rz || 0, t.s, t.sy || t.s, t.sz || t.s));
        if (tint) im.setColorAt(i, tint(t, i));
        if (collider) colliders.addCircle(t.x, t.z, collider * t.s);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
      return im;
    };
    const outside = (x, z) => Math.abs(x) > 99 || z > 95 || z < -117;
    const barkMat = lambert({ map: tex(TEX.bark, 1), vertexColors: true, flatShading: true });
    const leafMat = lambert({ map: tex(TEX.leaves, 1), vertexColors: true, flatShading: true });
    const mossMat = lambert({ map: TEX.hangMoss, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, color: 0xb8c4a8 });

    // Jungle giants: buttressed trunks under layered canopies, tinted tree by tree.
    const trunkGeo = merge([
      { geo: gnarl(new THREE.CylinderGeometry(0.45, 0.85, 12, 6, 4), 0.25, 1), m: M(0, 6, 0), color: 0xb0a090, uv: [2, 3] },
      ...[0, 1, 2, 3].map((k) => ({ geo: new THREE.BoxGeometry(0.25, 2.4, 1.9), m: M(Math.sin(k * 1.57) * 0.75, 0.9, Math.cos(k * 1.57) * 0.75, 0, k * 1.57, 0), color: 0x9a8a7a })),
      { geo: new THREE.CylinderGeometry(0.12, 0.25, 4, 5), m: M(1.2, 10, 0, 0, 0, -0.8), color: 0xb0a090 },
      { geo: new THREE.CylinderGeometry(0.12, 0.25, 4, 5), m: M(-1.1, 9.4, 0.4, 0.3, 0, 0.9), color: 0xb0a090 },
    ]);
    const canopyGeo = merge([
      { geo: gnarl(new THREE.IcosahedronGeometry(3.4, 0), 0.8, 2), m: M(0, 12.4, 0, 0, 0, 0, 1, 0.55, 1), color: 0xc8d8c0, uv: [2, 2] },
      { geo: gnarl(new THREE.IcosahedronGeometry(2.6, 0), 0.7, 3), m: M(2.4, 11.2, 0.6, 0, 0.5, 0, 1, 0.6, 1), color: 0xa8bca8, uv: [2, 2] },
      { geo: gnarl(new THREE.IcosahedronGeometry(2.4, 0), 0.7, 4), m: M(-2.2, 10.8, -0.8, 0, 1, 0, 1, 0.6, 1), color: 0x98ac98, uv: [2, 2] },
      { geo: gnarl(new THREE.IcosahedronGeometry(2.0, 0), 0.6, 5), m: M(0.3, 14.3, -0.4, 0, 0.2, 0, 1, 0.6, 1), color: 0xe0f0d8, uv: [2, 2] },
    ]);
    const trees = scatter(N(240), (x, z, y) => y > 0.3 && !keepClear(x, z, 1.4) && slopeAt(x, z) < (outside(x, z) ? 2.6 : 1.4), 6.2, 1);
    trees.forEach((t) => { t.y -= 0.3 + slopeAt(t.x, t.z) * 0.9; t.sy = t.s * (0.9 + t.k * 0.35); });
    const treeTint = (t) => new THREE.Color().setHSL(0.28 + t.k * 0.16, 0.25 + t.k * 0.2, 0.42 + t.k * 0.12).multiplyScalar(2);
    inst(trunkGeo, barkMat, trees, { collider: 0.8 });
    inst(canopyGeo, leafMat, trees, { tint: treeTint });

    // Palms along the water and the paths.
    const palmTrunk = merge([0, 1, 2, 3, 4].map((k) => ({ geo: new THREE.CylinderGeometry(0.2, 0.26, 1.6, 5), m: M(k * k * 0.06, 0.8 + k * 1.5, 0, 0, 0, -0.08 * k), color: 0xb8a890 })));
    const palmCrown = merge([0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ geo: new THREE.PlaneGeometry(3.4, 1.4), m: M(1.2 + Math.cos(k * 0.785) * 1.5, 7.6, Math.sin(k * 0.785) * 1.5, 0, -k * 0.785, -0.45), color: k % 2 ? 0xd0e0c0 : 0xa8c0a0 })));
    const palms = scatter(N(80), (x, z, y) => y > 0.15 && y < 3 && !keepClear(x, z, 0.3) && (pathDist(x, z) < 13 || y < 0.6), 5, 2);
    palms.forEach((t) => { t.y -= 0.2; });
    inst(palmTrunk, barkMat, palms, { collider: 0.4 });
    inst(palmCrown, lambert({ map: TEX.frond, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true }), palms);

    // Dead swamp trees dripping with moss.
    const deadTrunk = merge([
      { geo: gnarl(new THREE.CylinderGeometry(0.3, 0.7, 7, 5, 3), 0.3, 9), m: M(0, 3.5, 0), color: 0x8a8480 },
      { geo: new THREE.CylinderGeometry(0.08, 0.2, 3.5, 4), m: M(1.2, 6, 0, 0, 0, -1.0), color: 0x8a8480 },
      { geo: new THREE.CylinderGeometry(0.08, 0.2, 3, 4), m: M(-1.0, 5.2, 0.3, 0.2, 0, 1.1), color: 0x8a8480 },
      { geo: new THREE.CylinderGeometry(0.06, 0.15, 2.4, 4), m: M(0.2, 7.4, -0.9, -0.9, 0, 0), color: 0x8a8480 },
    ]);
    const deadMoss = merge([[1.9, 6.4, 0], [-1.7, 5.6, 0.3], [0.2, 7.6, -1.6], [0.9, 5.6, 0.8]].map(([x, y, z], k) => ({ geo: new THREE.PlaneGeometry(1.2, 3.2), m: M(x, y - 1.6, z, 0, k * 1.1, 0) })));
    const swampTrees = scatter(N(28), (x, z, y) => y < 0.4 && dist2(x, z, L.swamp[0], L.swamp[1]) < 32 && dist2(x, z, L.tree[0], L.tree[1]) > 13 && pathDist(x, z) > 3.5 && dist2(x, z, L.spawn[0], L.spawn[1]) > 7, 6, 3);
    inst(deadTrunk, barkMat, swampTrees, { collider: 0.5 });
    inst(deadMoss, mossMat, swampTrees);

    // Hanging vines from the canopy.
    if (hi) {
      const vines = trees.filter((_, i) => i % 2 === 0).map((t) => {
        const sy = 0.8 + r() * 0.8;
        return { x: t.x + (r() - 0.5) * 3, y: t.y + t.sy * 10 - 6 * sy, z: t.z + (r() - 0.5) * 3, ry: r() * 3, s: 1, sy };
      });
      inst(merge([{ geo: new THREE.PlaneGeometry(0.8, 6), m: M(0, 3, 0), color: 0x9ab87a }]), mossMat, vines);
    }

    // Undergrowth.
    const ferns = scatter(N(560), (x, z, y) => y > 0.1 && pathDist(x, z) > 2.6 && slopeAt(x, z) < 1 && !keepClear(x, z, -3.2), 0, 4);
    ferns.forEach((f) => { f.s *= 1.6; });
    inst(cross(2.2, 1.6), lambert({ map: TEX.fern, alphaTest: 0.5, side: THREE.DoubleSide }), ferns, { tint: (t) => new THREE.Color().setHSL(0.3 + t.k * 0.08, 0.5, 0.5).multiplyScalar(1.8) });
    const bigLeaves = scatter(N(150), (x, z, y) => y > 0.1 && slopeAt(x, z) < 1 && !keepClear(x, z, -1.6), 3, 5);
    const leafFan = merge([0, 1, 2, 3, 4].map((k) => ({ geo: new THREE.PlaneGeometry(1.4, 1.8), m: M(Math.cos(k * 1.25) * 0.7, 0.9, Math.sin(k * 1.25) * 0.7, -0.5, -k * 1.25 + Math.PI / 2, 0) })));
    inst(leafFan, lambert({ map: TEX.bigleaf, alphaTest: 0.5, side: THREE.DoubleSide }), bigLeaves);
    const reeds = scatter(N(280), (x, z, y) => y > -0.8 && y < 0.35 && !keepClear(x, z, -3), 0, 6);
    inst(cross(1.2, 2.2), lambert({ map: TEX.reeds, alphaTest: 0.5, side: THREE.DoubleSide }), reeds);
    const rocks = scatter(N(70), (x, z, y) => y > 0 && slopeAt(x, z) < 1.2 && !keepClear(x, z, -1), 4, 7);
    rocks.forEach((t) => { t.y -= 0.25; t.sy = t.s * 0.8; });
    rocks.push({ x: L.toad[0], y: heightAt(L.toad[0], L.toad[1]) - 0.55, z: L.toad[1], ry: 0.4, s: 2.3, sy: 1.2, sz: 1.9 }); // the Sub Toad's rock
    inst(gnarl(new THREE.DodecahedronGeometry(0.9, 0), 0.3, 11), lambert({ map: TEX.moss, flatShading: true, color: 0xb0b0c0 }), rocks, { collider: 0.8 });
    if (hi) {
      const lilies = scatter(90, (x, z, y) => y < -0.35 && y > -2, 0, 8).map((l) => ({ ...l, y: WATER_Y + 0.08, s: 0.6 + l.s * 0.5 }));
      inst(merge([{ geo: new THREE.PlaneGeometry(1.2, 1.2), m: M(0, 0, 0, -Math.PI / 2) }]), lambert({ map: TEX.lily, alphaTest: 0.5, side: THREE.DoubleSide }), lilies);
    }

    // Glowing mushrooms: they bounce to your kicks. A ring of them grows at the Summoning Tree's feet.
    const shroomSpots = scatter(N(90), (x, z, y) => y > 0.1 && pathDist(x, z) > 1.8 && pathDist(x, z) < 9 && slopeAt(x, z) < 1, 2.5, 9);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + 0.3, rad = 6.8 + (k % 3) * 0.4, x = L.tree[0] + Math.sin(a) * rad, z = L.tree[1] + Math.cos(a) * rad;
      if (heightAt(x, z) > 0.05) shroomSpots.push({ x, y: heightAt(x, z), z, ry: a, s: 0.9 + (k % 4) * 0.25 });
    }
    const stemGeo = merge([{ geo: new THREE.CylinderGeometry(0.1, 0.14, 0.6, 5), m: M(0, 0.3, 0), color: 0xf5e6c8 }]);
    const capGeo = merge([{ geo: new THREE.SphereGeometry(0.42, 6, 3, 0, TAU, 0, Math.PI / 2), m: M(0, 0.55, 0, 0, 0, 0, 1, 0.8, 1) }]);
    const stems = inst(stemGeo, lambert({ vertexColors: true }), shroomSpots);
    const caps = inst(capGeo, basic({ map: TEX.cap }), shroomSpots);
    W.mushrooms = { spots: shroomSpots, stems, caps, bounce: 0, dirty: false };

    /* ----- landmarks ----- */

    const stoneParts = []; // every static stone thing becomes one mesh
    const addStone = (geo, m, color = RUIN, moss = MOSSY, uv) => stoneParts.push({ geo, m, color, moss, uv });

    buildTree(scene, hi, mossMat, colliders);

    // The Panther Ruins: broken walls around a courtyard, columns and the stepped altar.
    const wall = (x0, z0, x1, z1, hgt, seed) => {
      const rr = rng(seed), len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2)), along = x1 !== x0;
      let run = null;
      const flush = () => { if (run) colliders.addBox(run[0] - 0.7, run[1] - 0.7, run[2] + 0.7, run[3] + 0.7, 'wall'); run = null; };
      for (let i = 0; i < n; i++) {
        const ta = i / n, tb = (i + 1) / n, x = lerp(x0, x1, (ta + tb) / 2), z = lerp(z0, z1, (ta + tb) / 2);
        if (rr() < 0.12) { flush(); continue; }
        const h = hgt * (0.45 + rr() * 0.55), gy = heightAt(x, z), shade = rr() < 0.5 ? RUIN : RUIN2;
        addStone(box(along ? len / n : 1.4, h + 0.8, along ? 1.4 : len / n), M(x, gy + h / 2 - 0.4, z, 0, (rr() - 0.5) * 0.06, 0), shade);
        const xa = lerp(x0, x1, ta), za = lerp(z0, z1, ta), xb = lerp(x0, x1, tb), zb = lerp(z0, z1, tb);
        const seg = [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
        run = run ? [Math.min(run[0], seg[0]), Math.min(run[1], seg[1]), Math.max(run[2], seg[2]), Math.max(run[3], seg[3])] : seg;
      }
      flush();
    };
    wall(1, 15, 26, 15, 3.4, 1);
    wall(1, 15, 1, 8, 3.2, 2); wall(1, -1, 1, -9.5, 3.2, 3);
    wall(26, 15, 26, -9.5, 3.0, 4);
    for (const [x, z, h] of [[6, 10, 5.5], [20, 10, 3.2], [6, -3, 4.4], [21, -4, 6]]) {
      const g = heightAt(x, z);
      addStone(gnarl(new THREE.CylinderGeometry(0.7, 0.8, h, 8), 0.1, x), M(x, g + h / 2 - 0.3, z), MONO, MOSSY, [2.5, h / 2]);
      addStone(box(2, 0.6, 2), M(x, g + 0.1, z), RUIN2);
      colliders.addCircle(x, z, 0.95);
    }
    addStone(new THREE.CylinderGeometry(0.7, 0.7, 4, 8), M(9, heightAt(9, 6) + 0.5, 6, 0, 0.6, Math.PI / 2), MONO, MOSSY, [2.5, 2]);
    colliders.addCircle(8.2, 5.4, 1); colliders.addCircle(9.8, 6.6, 1);
    const altarY = heightAt(L.altar[0], L.altar[1]) - 0.2;
    [[6, 0.6], [4.4, 1.2], [3, 1.8]].forEach(([s, y]) => addStone(box(s, 0.6, s), M(L.altar[0], altarY + y - 0.3, L.altar[1]), MONO));
    addStone(box(1.2, 0.5, 1.2), M(L.altar[0], altarY + 2.05, L.altar[1], 0, Math.PI / 4, 0), PYR);
    colliders.addCircle(L.altar[0], L.altar[1], 2.4);
    W.altarTop = altarY + 1.8;

    // Carved jambs and a lintel frame the ridge gap; the vine wall seals it (burn it with snare bolts).
    const [gx, gz] = L.gate1, gapY = heightAt(gx, gz);
    for (const side of [-1, 1]) {
      addStone(box(2.2, 11, 2.4), M(gx + side * 4.8, gapY + 4.2, gz + 0.4), MONO);
      addStone(box(2.8, 1, 3), M(gx + side * 4.8, gapY + 9.9, gz + 0.4), PYR);
    }
    addStone(box(12.6, 1.6, 2.8), M(gx, gapY + 9, gz + 0.4), MONO);
    addStone(box(3, 1.4, 0.4), M(gx, gapY + 9, gz + 1.9), RGB(1.4, 0.7, 1.5)); // a panther glyph slab
    const vineTex = tex(TEX.vine, 3, 3), vineMat = lambert({ map: vineTex, emissiveMap: tex(TEX.vineGlow, 3, 3), emissive: 0xffffff, alphaTest: 0.4, side: THREE.DoubleSide });
    const vineMesh = new THREE.Group();
    vineMesh.position.set(gx, gapY + 4, gz);
    const curtain = new THREE.Group();
    curtain.position.y = 4.2; // hangs from the lintel, so it can shrivel upwards
    curtain.add(new THREE.Mesh(merge([
      { geo: new THREE.PlaneGeometry(8.4, 8.6), m: M(0, -4.3, 0.25) },
      { geo: new THREE.PlaneGeometry(8.4, 8.6), m: M(0.4, -4.3, -0.25) },
      ...[-3, -1.6, -0.2, 1.1, 2.6].map((x, k) => ({ geo: new THREE.PlaneGeometry(0.9, 8.6 - (k % 2) * 1.5), m: M(x, -4.3 + (k % 2) * 0.75, 0.75 + (k % 3) * 0.12, 0, 0.3 * (k - 2), 0) })),
    ]), vineMat));
    vineMesh.add(curtain);
    scene.add(vineMesh);
    W.vineWall = { mesh: vineMesh, curtain, mat: vineMat, hp: 3, box: colliders.addBox(...Terrain.BOXES.vines, 'vines'), x: gx, z: gz, alive: true };

    // The waterfall pours off the plateau lip into the pool; a stream feeds it across the plateau.
    const fallsTex = tex(TEX.falls, 2, 3);
    {
      const [fx] = L.falls, rows = [];
      for (let z = -70.4; z <= -64.6; z += 0.5) rows.push(z);
      const pos = [], uv = [], idx = [];
      rows.forEach((z, k) => {
        const w = 3 + (k / rows.length) * 1.4, lip = smoothstep(-69.4, -70.4, z);
        const y = Math.max(heightAt(fx, z), heightAt(fx - w, z), heightAt(fx + w, z)) + 0.45 + lip * 0.2;
        pos.push(fx - w, y, z + 0.35, fx + w, y, z + 0.35);
        uv.push(0, k * 0.35, 1, k * 0.35);
        if (k) idx.push(2 * k - 2, 2 * k, 2 * k - 1, 2 * k - 1, 2 * k, 2 * k + 1);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, basic({ map: fallsTex, side: THREE.DoubleSide, color: 0xd8f4ff })));
      // the stream: a strip of water draped along its channel
      const sp = [], su = [], sc = [], si = [], a = new THREE.Vector2(36, -69.6), b = new THREE.Vector2(30, -104), steps = 24;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = lerp(a.x, b.x, t), z = lerp(a.y, b.y, t), y = heightAt(x, z) + 0.3;
        sp.push(x - 1.5, y, z, x + 1.5, y, z);
        su.push(x / 6 - 0.25, z / 6, x / 6 + 0.25, z / 6);
        sc.push(0.23, 0.63, 0.72, 0.23, 0.63, 0.72);
        if (k) si.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
      sg.setIndex(si);
      sg.computeVertexNormals();
      scene.add(new THREE.Mesh(sg, waterMat));
    }
    const foamTex = tex(TEX.foam, 2, 2);
    const foam = new THREE.Mesh(new THREE.RingGeometry(1.2, 5.2, 18, 1), basic({ map: foamTex, alphaTest: 0.5, color: 0xd8f6ff }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(L.falls[0], WATER_Y + 0.1, -64.2);
    scene.add(foam);
    const spray = glowSprite(0xbfe8ff, 0.3, 10, 5);
    spray.position.set(L.falls[0], 1.4, -64.6);
    scene.add(spray);

    // The cracked stone gate across the ramp (break it with the bass quake), set between two stone posts.
    const [cx, cz] = L.gate2, cy = heightAt(cx, cz);
    for (const side of [-1, 1]) addStone(box(1.8, 8.5, 2.4), M(cx + side * 5.1, cy + 3.2, cz), MONO);
    addStone(box(12, 1.2, 2.6), M(cx, cy + 7.6, cz), MONO);
    const gateGroup = new THREE.Group();
    const blockGeo = box(2, 2, 1.6, 2);
    const gateMesh = new THREE.InstancedMesh(blockGeo, lambert({ map: TEX.cracked, color: RGB(1.5, 1.4, 1.6), emissiveMap: TEX.crackedGlow, emissive: 0xffffff, flatShading: true }), 12);
    const blocks = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const b = { p: new THREE.Vector3(cx - 3 + i * 2, cy + 1 + j * 2, cz), v: new THREE.Vector3(), rot: new THREE.Euler(0, (r() - 0.5) * 0.1, 0), w: new THREE.Vector3(), rest: false };
      gateMesh.setMatrixAt(blocks.length, M(b.p.x, b.p.y, b.p.z, 0, b.rot.y, 0));
      blocks.push(b);
    }
    gateMesh.frustumCulled = false;
    gateGroup.add(gateMesh);
    scene.add(gateGroup);
    const gateGlow = glowSprite(0xa57bff, 0.35, 11, 8);
    gateGlow.position.set(cx, cy + 3, cz + 1.2);
    gateGroup.add(gateGlow);
    W.crackedGate = { group: gateGroup, mesh: gateMesh, glow: gateGlow, blocks, box: colliders.addBox(...Terrain.BOXES.cracked, 'cracked'), x: cx, z: cz, alive: true };

    // Loop Stones: monoliths on round pads, ringed by three lanes of 32 notches that show your loop.
    const FACE = { stone1: [-34, 14], stone2: [30, -44], stone3: [64, -80] };
    W.stones = ['stone1', 'stone2', 'stone3'].map((key, idx) => {
      const [x, z] = L[key], y = heightAt(x, z), face = Math.atan2(FACE[key][0] - x, FACE[key][1] - z);
      const at = (lx, ly, lz, rx = 0, ry = 0) => M(x, y, z, 0, face, 0).multiply(M(lx, ly, lz, rx, ry, 0));
      addStone(gnarl(new THREE.CylinderGeometry(4.1, 4.3, 0.6, 12), 0.05, 70 + idx), at(0, -0.22, 0), PAD, PAD, [4, 0.5]);
      addStone(gnarl(box(1.9, 5, 1.1, 1.5), 0.1, 60 + idx), at(0, 2.5, 0), MONO);
      addStone(new THREE.ConeGeometry(1.35, 1.1, 4), at(0, 5.55, 0, 0, Math.PI / 4), PYR);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = face;
      const runeMat = new THREE.MeshBasicMaterial({ map: TEX.rune, transparent: true, alphaTest: 0.3, color: RUNE_IDLE, fog: true });
      g.add(new THREE.Mesh(merge([{ geo: new THREE.PlaneGeometry(1.4, 1.4), m: M(0, 2.9, 0.57) }, { geo: new THREE.PlaneGeometry(1.4, 1.4), m: M(0, 2.9, -0.57, 0, Math.PI) }]), runeMat));
      const notches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.12, 0.42), new THREE.MeshBasicMaterial({ color: 0xffffff }), LANES.length * LOOP);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      LANES.forEach((lane, li) => {
        const rad = 2.0 + li * 0.62;
        for (let s = 0; s < LOOP; s++) {
          const ang = -(s / LOOP) * TAU, big = s % 8 === 0 ? 1.35 : 1;
          mm.compose(v.set(Math.sin(ang) * rad, 0.1, Math.cos(ang) * rad), q.setFromEuler(e.set(0, ang, 0)), sc.set(big, 1, big));
          notches.setMatrixAt(li * LOOP + s, mm);
          notches.setColorAt(li * LOOP + s, C(0x221d38));
        }
      });
      g.add(notches);
      const glow = glowSprite(0x7ff6ff, 0, 7, 8);
      glow.position.y = 3;
      glow.visible = false;
      g.add(glow);
      scene.add(g);
      colliders.addCircle(x, z, 1.4);
      return { key, x, y, z, index: idx, group: g, runeMats: [runeMat], notches, glow, carved: false, carveT: -1 };
    });

    buildPyramid(scene, addStone, colliders);

    const statics = new THREE.Mesh(merge(stoneParts), lambert({ map: TEX.stone, vertexColors: true, flatShading: true }));
    scene.add(statics);
    W.statics = statics;

    /* ----- ambience: mist, fireflies, sparks ----- */

    W.mist = [];
    if (hi) {
      const spots = [[L.swamp, 5, 30, 18], [L.hollow, 2, 14, 10]];
      for (const [[mx, mz], n, sx, sp] of spots) for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0x9aa8b8, transparent: true, opacity: 0.1, depthWrite: false }));
        s.position.set(mx + (r() - 0.5) * sp * 2, Math.max(heightAt(mx, mz), 0) + 1 + r(), mz + (r() - 0.5) * sp);
        s.scale.set(sx * (0.7 + r() * 0.6), 3 + r() * 2, 1);
        s.userData.phase = r() * 6;
        scene.add(s); W.mist.push(s);
      }
    }

    // Collectible fireflies, in clusters along the paths (the game marks them taken).
    const fireflies = [], fr = rng(5);
    for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      for (let t = 0.2; t < 1; t += 0.45) {
        const x = lerp(ax, bx, t) + (fr() - 0.5) * 6, z = lerp(az, bz, t) + (fr() - 0.5) * 6;
        for (let k = 0; k < 3; k++) {
          const fx = x + (fr() - 0.5) * 3, fz = z + (fr() - 0.5) * 3;
          fireflies.push({ x: fx, y: Math.max(heightAt(fx, fz), WATER_Y + 0.2) + 1.2 + fr() * 1.4, z: fz, taken: false, phase: fr() * 6 });
        }
      }
    }
    W.fireflies = fireflies;
    const ffPts = pointSet(fireflies.length);
    ffPts.geometry.attributes.size.array.fill(0.55);
    for (let i = 0; i < fireflies.length; i++) ffPts.geometry.attributes.tint.array.set([1.0, 0.95, 0.45], i * 3);
    scene.add(ffPts);
    W.ffPts = ffPts;

    // Sparks, embers and dust for the visual actions.
    const fx = pointSet(200);
    fx.userData = { v: new Float32Array(200 * 3), life: new Float32Array(200), max: new Float32Array(200).fill(1), grav: new Float32Array(200), next: 0 };
    scene.add(fx);
    W.fx = fx;

    W.mothSpawns = [
      [-8, 6], [0, -2], [22, -22], [26, -30], [34, -36], [30, -40], [38, -30], [24, -44], [44, -50], [52, -56], [66, -84], [80, -90], [74, -100], [86, -88],
    ];
    Object.assign(W, { sky, skyMat, sun, moon, fallsTex, foamTex, waterTex, foam, spray, vineTex });
    W.built = true;
    return W;
  }

  /* ---------- the Summoning Tree ---------- */

  // Radius of the trunk surface at height y and angle th (th = 0 faces the spawn).
  function trunkR(th, y) {
    let r = lerp(4.2, 2.2, clamp(y / 30, 0, 1));
    r *= 1 + 0.16 * Math.sin(5 * th + y * 0.22) + 0.07 * Math.sin(11 * th - y * 0.5);
    r *= 1 + 0.32 * smoothstep(5, 0, y);
    const wound = Math.exp(-(th * th) / 0.03) * smoothstep(0.2, 1.4, y) * smoothstep(8.8, 6.2, y);
    return r * (1 - 0.3 * wound);
  }

  function buildTree(scene, hi, mossMat, colliders) {
    const [tx, tz] = L.tree, ty = heightAt(tx, tz) - 0.3;
    const face = Math.atan2(L.spawn[0] - tx, L.spawn[1] - tz);
    const group = new THREE.Group();
    group.position.set(tx, ty, tz);
    group.rotation.y = face;
    const rr = rng(31), bark = [], canopy = [], moss = [];

    const trunk = new THREE.CylinderGeometry(1, 1, 31, 14, 14, true);
    trunk.translate(0, 15.5, 0);
    const p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let th = Math.atan2(x, z);
      const r = trunkR(th, y);
      th += Math.max(0, y - 9) * 0.03;
      p.setXYZ(i, Math.sin(th) * r + Math.sin(y * 0.09) * 0.8 * smoothstep(6, 16, y), y, Math.cos(th) * r);
    }
    trunk.computeVertexNormals();
    bark.push({ geo: trunk, color: 0x9c8c88, uv: [9, 12] });

    // buttress roots arch out into the swamp, leaving the spawn side open
    for (const [k, a] of [0.8, 1.5, 2.2, 2.85, -2.85, -2.2, -1.5, -0.8].entries()) {
      const ang = a + (rr() - 0.5) * 0.25, len = 12 + rr() * 4, wig = (rr() - 0.5) * 0.4;
      const pts = curve([[3.4, 4.6], [6.2, 2.6], [9, 1.0], [len * 0.85, -0.1], [len, -1.4]].map(([rad, y], j) => {
        const aa = ang + wig * j * 0.3;
        return [Math.sin(aa) * rad, y + (j === 2 ? 0.8 : 0), Math.cos(aa) * rad];
      }), 9);
      bark.push({ geo: tube(pts, 1.5 - (k % 2) * 0.3, 0.2, 6), color: 0x76686a });
    }
    // limbs reach out and droop; smaller branches climb from them; dark clumps and long moss hang off
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * TAU + 0.5 + (rr() - 0.5) * 0.4, y0 = 21 + rr() * 7, reach = 12 + rr() * 5;
      const at = (rad, y) => [Math.sin(ang) * rad, y, Math.cos(ang) * rad];
      const pts = curve([at(1, y0 - 2), at(reach * 0.35, y0 + 3), at(reach * 0.7, y0 + 5), at(reach, y0 + 3.5), at(reach + 2, y0 + 1)], 10);
      bark.push({ geo: tube(pts, 1.25, 0.25, 5), color: 0x8c7c7a });
      for (const j of [4, 7]) {
        const o = pts[j], side = (j === 4 ? 1 : -1) * 0.6, up = [[o.x, o.y, o.z], [o.x + Math.sin(ang + side) * 2.5, o.y + 3.5, o.z + Math.cos(ang + side) * 2.5], [o.x + Math.sin(ang + side) * 3.5, o.y + 7, o.z + Math.cos(ang + side) * 3.5]];
        bark.push({ geo: tube(curve(up, 4), 0.5, 0.12, 4), color: 0x8c7c7a });
        canopy.push({ geo: gnarl(new THREE.IcosahedronGeometry(2.6 + rr(), 1), 0.9, 50 + k * 3 + j), m: M(up[2][0], up[2][1] + 0.6, up[2][2], 0, rr() * 3, 0, 1, 0.5, 1), color: 0x7a9a8a, uv: [2, 2] });
      }
      const end = pts[pts.length - 1];
      canopy.push({ geo: gnarl(new THREE.IcosahedronGeometry(3.4 + rr(), 1), 1.1, 40 + k), m: M(end.x, end.y + 1.2, end.z, 0, rr() * 3, 0, 1, 0.5, 1), color: 0x6a8a7c, uv: [2, 2] });
      for (let m = 2; m < pts.length; m += 2) {
        const o = pts[m], len = 5 + rr() * 5;
        moss.push({ geo: new THREE.PlaneGeometry(1.5, len), m: M(o.x, o.y - len / 2 - 0.5, o.z, 0, rr() * 3, 0) });
        moss.push({ geo: new THREE.PlaneGeometry(1.5, len * 0.8), m: M(o.x + 0.3, o.y - len * 0.4 - 0.5, o.z, 0, rr() * 3 + 1.5, 0) });
      }
    }
    canopy.push({ geo: gnarl(new THREE.IcosahedronGeometry(4.4, 1), 1.2, 49), m: M(0.8, 31.5, 0, 0, 0, 0, 1, 0.5, 1), color: 0x6a8a7c, uv: [2, 2] });
    // two hollow knots above the wound: something in there is watching
    for (const side of [-1, 1]) bark.push({ geo: new THREE.SphereGeometry(0.75, 6, 4), m: M(side * 1.3, 12.6, trunkR(side * 0.3, 12.6) - 0.35, 0, 0, side * 0.3, 1, 0.55, 0.6), color: 0x1a1210 });

    const giantBark = lambert({ map: TEX.bark, vertexColors: true, flatShading: true });
    group.add(new THREE.Mesh(merge(bark), giantBark));
    group.add(new THREE.Mesh(merge(canopy), lambert({ map: TEX.leaves, vertexColors: true, flatShading: true })));
    group.add(new THREE.Mesh(merge(moss), mossMat));

    // The wound he is torn out of: a glowing split in the trunk, facing the spawn.
    const wy0 = 0.9, wy1 = 8.3, rows = 12, wpos = [], wcol = [], widx = [];
    for (let k = 0; k <= rows; k++) {
      const y = lerp(wy0, wy1, k / rows), w = 0.85 * Math.sin((Math.PI * k) / rows) ** 0.8, zc = trunkR(0, y) + 0.3;
      wpos.push(-w, y - 4, zc - 0.25, 0, y - 4, zc + 0.05, w, y - 4, zc - 0.25);
      wcol.push(0.45, 0.9, 0.25, 1, 1, 0.75, 0.45, 0.9, 0.25);
      if (k) { const a = (k - 1) * 3, b = k * 3; widx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1); }
    }
    // the knots glow faintly too
    for (const side of [-1, 1]) {
      const b = wpos.length / 3, y = 12.6 - 4, zc = trunkR(side * 0.3, 12.6) - 0.05;
      wpos.push(side * 1.3 - 0.45, y, zc, side * 1.3 + 0.45, y, zc, side * 1.3, y + 0.16, zc + 0.05);
      wcol.push(0.25, 0.6, 0.15, 0.25, 0.6, 0.15, 0.5, 0.9, 0.3);
      widx.push(b, b + 1, b + 2);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    wg.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3));
    wg.setIndex(widx);
    const woundMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const wound = new THREE.Mesh(wg, woundMat);
    wound.position.set(0, 4, 0);
    group.add(wound);
    const woundGlow = glowSprite(0x9dff6a, 0.45, 7, 10);
    woundGlow.position.set(0, 4.2, trunkR(0, 4.2) + 1.6);
    group.add(woundGlow);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: TEX.glow, color: 0x6fd84a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, heightAt(tx + Math.sin(face) * 7.5, tz + Math.cos(face) * 7.5) - ty + 0.12, 7.5);
    group.add(pool);
    scene.add(group);
    colliders.addCircle(tx, tz, 5.6);

    // spores drift up around the trunk
    let spores = null;
    if (hi) {
      spores = pointSet(70);
      const a = spores.geometry.attributes, sr = rng(8);
      spores.userData.seeds = [];
      for (let i = 0; i < 70; i++) {
        spores.userData.seeds.push({ ang: sr() * TAU, rad: 5 + sr() * 11, y: sr() * 30, sp: 0.4 + sr() * 0.8 });
        a.size.array[i] = 0.18 + sr() * 0.22;
        a.tint.array.set([0.55, 1, 0.6], i * 3);
      }
      spores.position.set(tx, ty, tz);
      scene.add(spores);
    }
    const out = new THREE.Vector3(Math.sin(face), 0, Math.cos(face)).multiplyScalar(7.2).add(new THREE.Vector3(tx, 0, tz));
    out.y = heightAt(out.x, out.z);
    W.tree = { group, wound, woundMat, woundGlow, pool, spores, face, woundWorld: out };
  }

  /* ---------- the Lost Pyramid ---------- */

  function buildPyramid(scene, addStone, colliders) {
    const [px, pz] = L.pyramid, py = heightAt(px, pz) - 0.4;
    const face = Math.atan2(L.stone3[0] - px, L.stone3[1] - pz);
    const base = M(px, py, pz, 0, face, 0), at = (x, y, z, ry = 0) => base.clone().multiply(M(x, y, z, 0, ry, 0));
    const group = new THREE.Group();
    group.position.set(px, py, pz);
    group.rotation.y = face;
    let yy = 0;
    const tiers = [];
    for (let k = 0; k < 7; k++) {
      const s = 28 - k * 3.6;
      addStone(box(s, 2.6, s, 3), at(0, yy + 1.3, 0), k % 2 ? PYR2 : PYR, MOSSY);
      tiers.push([s / 2, yy + 2.6]);
      yy += 2.6;
    }
    addStone(box(7.4, 5.4, 7.4, 3), at(0, yy + 2.7, 0), PYR);
    addStone(new THREE.ConeGeometry(5.8, 4.4, 4), at(0, yy + 7.6, 0, Math.PI / 4), PYR2);
    // the portal at the foot of the stairs, with its dark doorway
    addStone(box(8.4, 7.6, 2.6), at(0, 3.8, 15.1), PYR2);
    addStone(box(4.8, 6, 0.2), at(0, 3, 16.42), 0x050308);

    const doorMat = lambert({ map: TEX.stone, color: PYR, flatShading: true });
    const door = new THREE.Mesh(box(4.2, 5.6, 0.5), doorMat);
    door.position.set(0, 2.8, 16.55);
    group.add(door);
    const doorLight = glowSprite(0xffd27a, 0, 11, 11);
    doorLight.position.set(0, 3, 17.4);
    doorLight.visible = false;
    group.add(doorLight);
    const doorRunes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: TEX.rune, transparent: true, alphaTest: 0.3 }), 3);
    LANES.forEach((lane, i) => { doorRunes.setMatrixAt(i, M(-2.2 + i * 2.2, 6.75, 16.46)); doorRunes.setColorAt(i, C(0x2a2d45)); });
    group.add(doorRunes);

    // the eye on the temple
    const eyeMat = new THREE.MeshBasicMaterial({ map: TEX.eye, transparent: true, alphaTest: 0.3 });
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.7), eyeMat);
    eye.position.set(0, yy + 2.9, 3.75);
    group.add(eye);
    const eyeGlow = glowSprite(0x7ff6ff, 0.5, 11, 7);
    eyeGlow.position.set(0, yy + 2.9, 4.6);
    group.add(eyeGlow);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 2.4, 160, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.y = yy + 9 + 80;
    beam.visible = false;
    group.add(beam);
    scene.add(group);

    // Neon: the grid around the pyramid and the outline of its tiers, one additive line mesh.
    const lp = [], lc = [], cos = Math.cos(face), sin = Math.sin(face);
    const world = (x, z) => [px + x * cos + z * sin, pz - x * sin + z * cos];
    const R = 33, S = 3.3, fade = (x, z) => smoothstep(R, R * 0.45, Math.max(Math.abs(x), Math.abs(z)));
    const seg = (x0, z0, x1, z1) => { // draped over the ground in 1-unit pieces, fading out at the edge
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
      for (let i = 0; i < n; i++) {
        const xa = lerp(x0, x1, i / n), za = lerp(z0, z1, i / n), xb = lerp(x0, x1, (i + 1) / n), zb = lerp(z0, z1, (i + 1) / n);
        const [ax, az] = world(xa, za), [bx, bz] = world(xb, zb), ka = fade(xa, za), kb = fade(xb, zb);
        const ha = heightAt(ax, az), hb = heightAt(bx, bz);
        if (ka + kb < 0.02 || Math.abs(ha - PLATEAU_Y) > 1.4 || Math.abs(hb - PLATEAU_Y) > 1.4 || slopeAt(ax, az) > 0.45) continue;
        lp.push(ax, ha + 0.12, az, bx, hb + 0.12, bz);
        lc.push(ka, 0.3 * ka, 0.85 * ka, kb, 0.3 * kb, 0.85 * kb);
      }
    };
    for (let g = -R; g <= R + 0.01; g += S) {
      if (Math.abs(g) > 15) { seg(g, -R, g, R); seg(-R, g, R, g); continue; }
      seg(g, -R, g, -15); seg(g, 15, g, R); seg(-R, g, -15, g); seg(15, g, R, g);
    }
    // tier outlines (in pyramid space, so no draping)
    const outline = (h, y, c) => {
      const pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = world(pts[i][0], pts[i][1]), [bx, bz] = world(pts[i + 1][0], pts[i + 1][1]);
        lp.push(ax, py + y + 0.03, az, bx, py + y + 0.03, bz);
        lc.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      }
    };
    tiers.forEach(([h, y], k) => outline(h + 0.03, y, k % 2 ? [0.3, 0.9, 1] : [1, 0.3, 0.85]));
    outline(3.73, yy + 5.4, [0.3, 0.9, 1]);
    // a triangle around the eye
    const tri = [[-4.2, yy + 1.0], [4.2, yy + 1.0], [0, yy + 5.3], [-4.2, yy + 1.0]];
    for (let i = 0; i < 3; i++) {
      const [ax, az] = world(tri[i][0], 3.8), [bx, bz] = world(tri[i + 1][0], 3.8);
      lp.push(ax, py + tri[i][1], az, bx, py + tri[i + 1][1], bz);
      lc.push(0.4, 1, 1, 0.4, 1, 1);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    const gridMat = neonMat();
    const lines = new THREE.LineSegments(lg, gridMat);
    lines.frustumCulled = false;
    scene.add(lines);

    colliders.addCircle(px, pz, 14.3);
    for (let k = 0; k < 4; k++) { const a = face + Math.PI / 4 + (k * Math.PI) / 2; colliders.addCircle(px + Math.sin(a) * 15, pz + Math.cos(a) * 15, 4.5); }
    for (const [x, z, rad] of [[0, 15, 3.2], [-3, 15.2, 1.6], [3, 15.2, 1.6]]) { const [wx, wz] = world(x, z); colliders.addCircle(wx, wz, rad); }
    const [dx, dz] = world(0, 19);
    const doorWorld = new THREE.Vector3(dx, heightAt(dx, dz), dz);
    W.gridMat = gridMat;
    W.pyramid = { group, eye, eyeGlow, beam, door, doorLight, doorRunes, doorWorld, face, open: false, doorY: 2.8, openT: -1, lines };
  }

  /* ---------- visual actions ---------- */

  const RUNE_IDLE = 0x2a5a86;
  const WHITE = C(0xffffff), SCORCH = C(0xa04a2a), CHAR = C(0x1a0c08), EMBER = C(0xff6a00), DARK_RUNE = C(0x2a2d45);
  const tmpC = new THREE.Color(), tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();

  // Throws n points from (x, y, z): sparks, embers, dust.
  function burst(x, y, z, n, color, { speed = 3, up = 2, life = 1.2, size = 0.35, grav = -3, spread = 0.4 } = {}) {
    if (!W.fx) return;
    const a = W.fx.geometry.attributes, u = W.fx.userData;
    tmpC.set(color);
    for (let i = 0; i < n; i++) {
      const k = u.next; u.next = (u.next + 1) % u.life.length;
      a.position.array.set([x + (Math.random() - 0.5) * spread * 2, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread * 2], k * 3);
      const ang = Math.random() * TAU, sp = speed * (0.4 + Math.random() * 0.6);
      u.v.set([Math.cos(ang) * sp, up * (0.5 + Math.random()), Math.sin(ang) * sp], k * 3);
      u.life[k] = u.max[k] = life * (0.6 + Math.random() * 0.6);
      u.grav[k] = grav;
      a.size.array[k] = size * (0.6 + Math.random() * 0.8);
      a.tint.array.set([tmpC.r, tmpC.g, tmpC.b], k * 3);
    }
    a.size.needsUpdate = true; a.tint.needsUpdate = true;
  }

  function carveStone(i) {
    const st = W.stones && W.stones[i];
    if (!st) return;
    st.carved = true;
    st.carveT = TIME.value;
    st.glow.visible = true;
    burst(st.x, st.y + 3, st.z, 40, 0x7ff6ff, { speed: 4, up: 5, life: 1.6, size: 0.4, grav: -2 });
    burst(st.x, st.y + 1, st.z, 24, 0xffe36e, { speed: 6, up: 2, life: 1, size: 0.3 });
  }

  // Notches: carved hits in the lane colour, draft hits dim and paler, the playhead sweeps around.
  function updateStones(snap, playStep, pulse = 0) {
    if (!W.stones || !snap) return;
    const head = Math.floor(mod(playStep, LOOP)), blink = 0.75 + 0.25 * Math.sin(TIME.value * 9);
    for (const st of W.stones) {
      const flash = st.carveT >= 0 ? Math.exp(-(TIME.value - st.carveT) * 2.5) : 0;
      LANES.forEach((lane, li) => {
        const song = snap.song[lane] || [], draft = snap.draft[lane] || [];
        for (let s = 0; s < LOOP; s++) {
          const on = s === head;
          if (song[s]) tmpC.setHex(LANE_HEX[lane]).multiplyScalar(on ? 1.7 : 0.8 + pulse * 0.3);
          else if (draft[s]) tmpC.setHex(LANE_HEX[lane]).lerp(WHITE, 0.35).multiplyScalar(on ? 1.2 : 0.42 * blink);
          else tmpC.setHex(on ? 0x9a94d0 : s % 4 === 0 ? 0x3a3460 : 0x221d3c);
          if (flash > 0.01) tmpC.lerp(WHITE, flash * 0.8);
          st.notches.setColorAt(li * LOOP + s, tmpC);
        }
      });
      st.notches.instanceColor.needsUpdate = true;
    }
    const pr = W.pyramid && W.pyramid.doorRunes;
    if (pr) {
      LANES.forEach((lane, i) => pr.setColorAt(i, tmpC.setHex((snap.song[lane] || []).some(Boolean) ? LANE_HEX[lane] : 0x2a2d45).multiplyScalar(1 + pulse * 0.3)));
      pr.instanceColor.needsUpdate = true;
    }
  }

  function burnVines() {
    const vw = W.vineWall;
    if (!vw || vw.burnT !== undefined) return;
    vw.alive = false;
    vw.box.active = false;
    vw.burnT = TIME.value;
  }

  function breakGate() {
    const g = W.crackedGate;
    if (!g || g.breakT !== undefined) return;
    g.alive = false;
    g.box.active = false;
    g.breakT = TIME.value;
    for (const b of g.blocks) {
      const out = Math.sign(b.p.x - g.x) || (Math.random() - 0.5);
      b.v.set(out * (3 + Math.random() * 5), 7 + Math.random() * 7, (Math.random() - 0.35) * 9);
      b.w.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }
    burst(g.x, heightAt(g.x, g.z) + 3, g.z, 60, 0xa57bff, { speed: 7, up: 5, life: 1.4, size: 0.45, spread: 3 });
    burst(g.x, heightAt(g.x, g.z) + 1, g.z, 40, 0x8a8298, { speed: 4, up: 2, life: 2, size: 0.8, spread: 3, grav: -0.5 });
  }

  function openPyramid() {
    const p = W.pyramid;
    if (!p || p.openT >= 0) return;
    p.open = true;
    p.openT = TIME.value;
    p.doorLight.visible = true;
    p.beam.visible = true;
    burst(p.doorWorld.x, p.doorWorld.y + 3, p.doorWorld.z, 50, 0xffe36e, { speed: 5, up: 4, life: 2, size: 0.5, spread: 2 });
  }

  function bounceMushrooms(amount = 1) {
    const mu = W.mushrooms;
    if (!mu) return;
    mu.bounce = Math.max(mu.bounce, amount);
    mu.dirty = true;
  }

  /* ---------- per frame ---------- */

  function update(t, dt, pulse = 0) {
    if (!W.built) return;
    TIME.value = t;
    dt = Math.min(dt, 0.1);
    W.fallsTex.offset.y = -t * 1.4;
    W.foamTex.offset.set(Math.sin(t * 0.7) * 0.1, -t * 0.3);
    W.waterTex.offset.set(t * 0.012, t * 0.02);
    W.skyMat.uniforms.pulse.value = pulse;
    W.spray.material.opacity = 0.26 + Math.sin(t * 9) * 0.05;
    for (const m of W.mist) { m.position.x += Math.sin(t * 0.1 + m.userData.phase) * dt * 0.6; m.material.opacity = 0.08 + Math.sin(t * 0.3 + m.userData.phase) * 0.03; }

    // the tree breathes
    const tr = W.tree;
    tr.woundGlow.material.opacity = 0.38 + Math.sin(t * 1.7) * 0.08 + pulse * 0.12;
    tr.pool.material.opacity = 0.28 + Math.sin(t * 1.7) * 0.06;
    if (tr.spores) {
      const a = tr.spores.geometry.attributes;
      tr.spores.userData.seeds.forEach((s, i) => {
        const y = (s.y + t * s.sp) % 30, ang = s.ang + t * 0.05;
        a.position.array.set([Math.sin(ang) * s.rad, y, Math.cos(ang) * s.rad], i * 3);
        a.alpha.array[i] = smoothstep(0, 3, y) * smoothstep(30, 24, y) * (0.6 + 0.4 * Math.sin(t * 3 + i));
      });
      a.position.needsUpdate = true; a.alpha.needsUpdate = true;
    }

    // fireflies bob; taken ones go dark
    const fa = W.ffPts.geometry.attributes;
    W.fireflies.forEach((f, i) => {
      fa.position.array.set([f.x + Math.sin(t * 0.7 + f.phase) * 0.3, f.y + Math.sin(t * 2 + f.phase) * 0.25, f.z + Math.cos(t * 0.6 + f.phase) * 0.3], i * 3);
      fa.alpha.array[i] = f.taken ? 0 : 0.75 + 0.25 * Math.sin(t * 5 + f.phase * 3);
    });
    fa.position.needsUpdate = true; fa.alpha.needsUpdate = true;

    // mushrooms squash and stretch to the kick
    const mu = W.mushrooms;
    if (mu.bounce > 0.001 || mu.dirty) {
      mu.bounce *= Math.pow(0.004, dt);
      const sq = 1 - mu.bounce * 0.35, st = 1 + mu.bounce * 0.3;
      mu.spots.forEach((s, i) => {
        tmpM.compose(tmpV.set(s.x, s.y, s.z), tmpQ.setFromEuler(tmpE.set(0, s.ry, 0)), tmpS.set(s.s * st, s.s * sq, s.s * st));
        mu.caps.setMatrixAt(i, tmpM); mu.stems.setMatrixAt(i, tmpM);
      });
      mu.caps.instanceMatrix.needsUpdate = true; mu.stems.instanceMatrix.needsUpdate = true;
      mu.dirty = mu.bounce > 0.001;
    }

    // Loop Stones glow once carved (also if the game only set the flag)
    W.stones.forEach((st, i) => {
      if (st.carved && st.carveT < 0) carveStone(i);
      if (!st.carved) return;
      const flash = Math.exp(-(t - st.carveT) * 2);
      st.glow.material.opacity = 0.3 + pulse * 0.2 + flash * 0.7;
      st.glow.scale.set(7 + flash * 6, 8 + flash * 6, 1);
      st.runeMats[0].color.setHex(0x7ff6ff).lerp(WHITE, flash).multiplyScalar(1 + pulse * 0.4);
    });

    // the vine wall scorches as it is hit, then burns away upwards
    const vw = W.vineWall;
    if (!vw.alive && vw.burnT === undefined) burnVines();
    if (vw.burnT === undefined) {
      const dmg = 1 - clamp(vw.hp / 3, 0, 1);
      vw.mat.color.setHex(0xffffff).lerp(SCORCH, dmg * 0.7);
    } else if (vw.mesh.visible) {
      const k = clamp((t - vw.burnT) / 1.6, 0, 1);
      vw.curtain.scale.y = Math.max(0.001, 1 - k * k);
      vw.mat.color.setHex(0xff8a3a).lerp(CHAR, k);
      vw.mat.emissive.setHex(0xffffff).lerp(EMBER, k);
      if (Math.random() < 0.8) burst(vw.x + (Math.random() - 0.5) * 7, vw.mesh.position.y + 4.2 - 8.6 * (1 - k * k) * Math.random(), vw.z, 3, Math.random() < 0.5 ? 0xff8a2a : 0xffd04a, { speed: 1.2, up: 3, life: 1.2, size: 0.3, grav: 1 });
      if (k >= 1) vw.mesh.visible = false;
    }

    // gate blocks fly apart and tumble to rest
    const g = W.crackedGate;
    if (!g.alive && g.breakT === undefined) breakGate();
    if (g.breakT !== undefined && !g.settled) {
      let moving = 0;
      g.blocks.forEach((b, i) => {
        if (!b.rest) {
          b.v.y -= 22 * dt;
          b.p.addScaledVector(b.v, dt);
          b.rot.x += b.w.x * dt; b.rot.y += b.w.y * dt; b.rot.z += b.w.z * dt;
          const floor = heightAt(b.p.x, b.p.z) + 0.8;
          if (b.p.y < floor) {
            b.p.y = floor;
            b.v.y = Math.abs(b.v.y) * 0.3; b.v.x *= 0.5; b.v.z *= 0.5; b.w.multiplyScalar(0.5);
            if (b.v.lengthSq() < 0.8) b.rest = true;
          }
          moving++;
        }
        g.mesh.setMatrixAt(i, tmpM.compose(b.p, tmpQ.setFromEuler(b.rot), tmpS.set(1, 1, 1)));
      });
      g.mesh.instanceMatrix.needsUpdate = true;
      if (!moving || t - g.breakT > 6) g.settled = true;
    }

    // the pyramid: the eye pulses, the grid breathes; once opened the door sinks and the beam rises
    const py = W.pyramid;
    if (py.open && py.openT < 0) openPyramid();
    const lit = py.openT >= 0 ? clamp((t - py.openT) / 3, 0, 1) : 0;
    py.eyeGlow.material.opacity = 0.35 + pulse * 0.45 + lit * 0.3;
    W.gridMat.uniforms.gain.value = 0.6 + pulse * 0.5 + lit * 0.3;
    if (py.openT >= 0) {
      py.door.position.y = py.doorY - 6 * smoothstep(0, 1, lit);
      py.door.position.x = lit < 1 ? Math.sin(t * 60) * 0.04 : 0;
      py.doorLight.material.opacity = 0.9 * lit;
      py.beam.material.opacity = (0.3 + pulse * 0.15) * lit;
      py.beam.scale.set(1 + pulse * 0.15, lit, 1 + pulse * 0.15);
    }

    // sparks
    const fx = W.fx, a = fx.geometry.attributes, u = fx.userData;
    let live = false;
    for (let i = 0; i < u.life.length; i++) {
      if (u.life[i] <= 0) { if (a.alpha.array[i] !== 0) { a.alpha.array[i] = 0; live = true; } continue; }
      live = true;
      u.life[i] -= dt;
      u.v[i * 3 + 1] += u.grav[i] * dt;
      a.position.array[i * 3] += u.v[i * 3] * dt;
      a.position.array[i * 3 + 1] += u.v[i * 3 + 1] * dt;
      a.position.array[i * 3 + 2] += u.v[i * 3 + 2] * dt;
      a.alpha.array[i] = clamp(u.life[i] / u.max[i], 0, 1);
    }
    if (live) { a.position.needsUpdate = true; a.alpha.needsUpdate = true; }
  }

  return Object.assign(W, { build, update, ps1, carveStone, updateStones, burnVines, breakGate, openPyramid, bounceMushrooms, burst });
})();
