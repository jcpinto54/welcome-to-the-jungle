'use strict';
/* wizard.js: the Jungle Wizard. A swamp-born tree creature torn out of a trunk: gnarled bark
   body, root feet, moss cloak, Spanish-moss beard, hollow face with sickly glowing eyes, a
   crooked bark hat sprouting glowing mushrooms and a root staff cradling an orb.
   Built as one rigidly skinned mesh (a handful of draw calls) and animated procedurally:
   he nods and steps on the beat. */

const Wizard = (() => {
  const ps1 = (m) => (typeof World !== 'undefined' && World.ps1 ? World.ps1(m) : m);

  /* ---------- geometry helpers ---------- */

  const E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  // Transform matrix; `order` lets roots and prongs pitch first, then yaw.
  const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, order = 'XYZ') =>
    new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, order)), typeof s === 'number' ? S1.set(s, s, s) : S1.set(s[0], s[1], s[2]));

  // Jitter vertices (shared corners move together) so shapes look grown, not made.
  function gnarl(geo, amt, seed) {
    const r = rng(seed), p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!seen.has(k)) seen.set(k, [(r() - 0.5) * amt, (r() - 0.5) * amt * 0.6, (r() - 0.5) * amt]);
      const d = seen.get(k);
      p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
    }
    return geo;
  }
  // Bend along y by (y/len)^2, for crooked branches, roots and the hat tip.
  function bend(geo, len, bx, bz) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = (p.getY(i) / len) ** 2; p.setX(i, p.getX(i) + bx * k); p.setZ(i, p.getZ(i) + bz * k); }
    return geo;
  }
  function twist(geo, amt) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = p.getY(i) * amt, x = p.getX(i), z = p.getZ(i);
      p.setX(i, x * Math.cos(a) - z * Math.sin(a)); p.setZ(i, x * Math.sin(a) + z * Math.cos(a));
    }
    return geo;
  }
  // Tapered open tube from its joint: down along -y (default) or up along +y.
  function limb(r0, r1, len, seg = 5, hs = 1, up = false) {
    const g = new THREE.CylinderGeometry(up ? r1 : r0, up ? r0 : r1, len, seg, hs, true);
    return g.translate(0, up ? len / 2 : -len / 2, 0);
  }
  const blob = (r, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
  // A floor of self-illumination (a share of the lit colour) so he always reads against the dark jungle.
  function selfLit(mat, k) {
    const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey.bind(mat);
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ' + k.toFixed(3) + ';');
    };
    mat.customProgramCacheKey = () => key() + '|wizlit' + k;
    return mat;
  }
  const strand = (w, h) => new THREE.PlaneGeometry(w, h).translate(0, -h / 2, 0); // hangs from its top edge

  /* ---------- texture atlas: one opaque/cut-out material for the whole body ---------- */

  const AW = 96, AH = 64;
  const REG = { bark: [0, 0, 32, 32], moss: [32, 0, 32, 32], strand: [0, 32, 16, 32], leaf: [16, 32, 16, 16], plain: [16, 48, 8, 8], root: [32, 32, 32, 32], hat: [64, 0, 32, 32] };
  let atlasTex = null;
  function atlas() {
    if (atlasTex) return atlasTex;
    const c = makeCanvas(AW, AH), x = c.getContext('2d'), r = rng(77);
    const P = (col, X, Y, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };
    const put = (tex, X, Y, w, h, fallback) => {
      try { x.drawImage(tex.image, X, Y, w, h); } catch (e) { P(fallback, X, Y, w, h); }
    };
    put(TEX.bark, 0, 0, 32, 32, '#3a2a1c');
    put(TEX.moss, 32, 0, 32, 32, '#3d5226');
    put(TEX.hangMoss, 0, 32, 16, 32, '#8a9474');
    put(TEX.bark, 32, 32, 32, 32, '#3a2a1c');
    // pale lichen and wet streaks on the second bark tile (roots, staff, nose)
    for (let i = 0; i < 40; i++) P(['#8f9d7a', '#a8b08e', '#5e6b48'][(r() * 3) | 0], 32 + ((r() * 32) | 0), 32 + ((r() * 32) | 0), 1 + ((r() * 2) | 0), 1);
    // a small leaf with a midrib
    for (let Y = 0; Y < 16; Y++) {
      const half = Math.round(6 * Math.sin((Y / 15) * Math.PI));
      for (let X = 8 - half; X <= 8 + half; X++) P((X + Y) % 5 ? '#3f8f3e' : '#2f6b2a', 16 + X, 32 + Y);
      P('#7fcf5a', 24, 32 + Y);
    }
    P('#ffffff', 16, 48, 8, 8);
    // the hat: weathered grey bark, cracked, with lichen, so it reads pale against the dark jungle
    put(TEX.bark, 64, 0, 32, 32, '#3a2a1c');
    x.globalAlpha = 0.45; P('#b9b2a4', 64, 0, 32, 32); x.globalAlpha = 1;
    for (let k = 0; k < 6; k++) { let X = 64 + ((r() * 32) | 0); for (let Y = 0; Y < 32; Y++) { P('#3b3128', X, Y); if (r() < 0.3) X = 64 + mod(X - 64 + (r() < 0.5 ? -1 : 1), 32); } }
    for (let i = 0; i < 30; i++) P(['#8f9d7a', '#c9c6b0', '#6b7a52'][(r() * 3) | 0], 64 + ((r() * 32) | 0), (r() * 32) | 0, 1 + ((r() * 2) | 0), 1);
    atlasTex = new THREE.CanvasTexture(c);
    atlasTex.magFilter = atlasTex.minFilter = THREE.NearestFilter;
    atlasTex.generateMipmaps = false;
    return atlasTex;
  }

  /* ---------- rig: bones plus rigid parts baked into skinned geometry ---------- */

  function Rig() {
    const bones = [], parts = [];
    function bone(name, parent, x, y, z, order) {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      if (order) b.rotation.order = order;
      if (parent) parent.add(b);
      bones.push(b);
      return b;
    }
    const add = (b, geo, m, color, reg = 'bark', layer = 0) => parts.push({ b, geo, m, color, reg, layer });
    function build(layer) {
      const list = parts.filter((p) => p.layer === layer);
      const gs = list.map((p) => {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
        if (p.m) g.applyMatrix4(p.m);
        return g.applyMatrix4(p.b.matrixWorld);
      });
      const n = gs.reduce((s, g) => s + g.attributes.position.count, 0);
      const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      let o = 0;
      gs.forEach((g, gi) => {
        const p = list[gi], R = REG[p.reg], guv = g.attributes.uv, bi = bones.indexOf(p.b), c = p.color;
        pos.set(g.attributes.position.array, o * 3);
        for (let k = 0; k < g.attributes.position.count; k++, o++) {
          const u = guv ? clamp(guv.getX(k), 0, 1) : 0.5, v = guv ? clamp(guv.getY(k), 0, 1) : 0.5;
          uv[o * 2] = (R[0] + 0.5 + u * (R[2] - 1)) / AW;
          uv[o * 2 + 1] = 1 - (R[1] + 0.5 + (1 - v) * (R[3] - 1)) / AH;
          col[o * 3] = c[0]; col[o * 3 + 1] = c[1]; col[o * 3 + 2] = c[2];
          si[o * 4] = bi; sw[o * 4] = 1;
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      geo.computeVertexNormals();
      return geo;
    }
    return { bones, bone, add, build };
  }

  /* ---------- glow billboards (eyes, orb, mushrooms, spores) in one draw call ---------- */

  function glowPoints(n) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('gcol', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('gsize', new THREE.BufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.glow }, halfH: { value: 135 } },
      vertexShader: `attribute vec3 gcol; attribute float gsize; uniform float halfH; varying vec3 vC;
        void main() {
          vC = gcol;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = gsize * projectionMatrix[1][1] * halfH / max(0.1, -mv.z);
        }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC;
        void main() { float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vC * a, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    pts.onBeforeRender = (renderer) => {
      const rt = renderer.getRenderTarget();
      mat.uniforms.halfH.value = (rt ? rt.height : renderer.domElement.height) / 2;
    };
    return pts;
  }

  /* ---------- poses ---------- */

  // Pose channels. Angles: torso/head positive = lean forward; arms positive = swing forward (s),
  // raise outward (z), elbow bend forward (e). Feet are targets relative to the stance.
  const CH = ['bx', 'by', 'bz', 'hx', 'hy', 'hz', 'sx', 'sy', 'sz', 'cx', 'cy', 'cz', 'nx', 'kx', 'ky', 'kz', 'jaw',
    'lsx', 'lsy', 'lsz', 'le', 'lwx', 'lwz', 'rsx', 'rsy', 'rsz', 're', 'rwx', 'rwz', 'tx', 'ty', 'tz',
    'lfx', 'lfy', 'lfz', 'lfp', 'rfx', 'rfy', 'rfz', 'rfp', 'flare', 'sink', 'eye', 'orb', 'shake'];
  const REST = { hx: 0.14, sx: 0.3, cx: 0.26, nx: 0.2, kx: -0.86, lsx: 0.22, lsz: 0.34, le: 0.55, lwx: 0.35, rsx: 0.42, rsz: 0.16, re: 1.1, rwx: 0.1, tx: 0.02, tz: 0.1, eye: 1, orb: 1 };
  const FOOT = { l: [0.2, 0, 0.1], r: [-0.21, 0, -0.06] };
  const HIP_X = 0.12, HIP_Y = 1.08, THIGH = 0.58, SHIN = 0.56, ANK = 0.1;

  // One-shot actions: additive keyframes [time, deltas, ease], starting and ending at rest.
  const ACTS = {
    stomp: { dur: 0.62, keys: [
      [0.06, { rsx: 0.75, re: -0.45, by: 0.06, cx: -0.14, kx: -0.14, lsz: 0.3, lsx: 0.1, tx: -0.06 }, 'out'],
      [0.13, { rsx: 0.05, re: -0.35, by: -0.2, hx: 0.06, cx: 0.26, sx: 0.08, kx: 0.22, lsz: 0.75, lsx: -0.3, le: -0.3, tx: 0.08, jaw: 0.2, rfz: 0.06 }, 'in'],
      [0.32, { rsx: 0.05, re: -0.3, by: -0.17, hx: 0.05, cx: 0.22, sx: 0.08, kx: 0.14, lsz: 0.65, lsx: -0.25, le: -0.25, tx: 0.08, jaw: 0.1, rfz: 0.06 }],
    ] },
    bolt: { dur: 0.5, keys: [
      [0.06, { rsx: 0.95, re: -0.85, rsz: -0.12, tx: 1.35, cy: 0.35, hy: 0.1, bz: 0.1, sx: 0.08, kx: -0.16, lsx: -0.4, lsz: 0.4, le: -0.2, lfz: 0.16, rfz: -0.1, orb: 0.6 }, 'out'],
      [0.22, { rsx: 0.9, re: -0.8, rsz: -0.1, tx: 1.3, cy: 0.3, hy: 0.08, bz: 0.08, sx: 0.08, kx: -0.12, lsx: -0.35, lsz: 0.35, le: -0.2, lfz: 0.16, rfz: -0.1, orb: 0.3 }],
    ] },
    quake: { dur: 0.9, keys: [
      [0.17, { lsx: 2.7, rsx: 2.45, le: -0.35, re: -1.0, lsz: 0.25, rsz: 0.05, cx: -0.42, sx: -0.18, kx: -0.4, by: 0.1, tx: -1.0, jaw: 0.35, lwx: -0.5, orb: 0.5 }, 'out'],
      [0.28, { lsx: 1.3, rsx: 1.1, le: -0.45, re: -0.95, lsz: 0.05, rsz: -0.1, cx: 0.62, sx: 0.32, hx: 0.12, kx: 0.05, by: -0.36, tx: 2.1, jaw: 0.45, lfz: 0.16, rfz: -0.1, lwx: -0.3, orb: 0.8 }, 'in'],
      [0.52, { lsx: 1.25, rsx: 1.05, le: -0.4, re: -0.9, lsz: 0.05, rsz: -0.1, cx: 0.58, sx: 0.3, hx: 0.12, kx: 0.02, by: -0.34, tx: 2.05, jaw: 0.3, lfz: 0.16, rfz: -0.1, lwx: -0.3, orb: 0.4 }],
    ] },
    dash: { dur: 0.4, keys: [
      [0.06, { cx: 0.3, sx: 0.25, hx: 0.1, bz: 0.16, by: -0.12, lsx: -1.0, rsx: -0.6, le: -0.3, re: -0.4, kx: -0.3, tx: -0.7, lfz: 0.34, rfz: -0.42, rfy: 0.12, rfp: -0.4, flare: 0.8 }, 'out'],
      [0.28, { cx: 0.25, sx: 0.2, hx: 0.08, bz: 0.12, by: -0.08, lsx: -0.8, rsx: -0.5, le: -0.3, re: -0.3, kx: -0.25, tx: -0.55, lfz: 0.3, rfz: -0.3, flare: 0.6 }],
    ] },
    hurt: { dur: 0.46, keys: [
      [0.06, { cx: -0.42, sx: -0.18, kx: -0.4, kz: 0.28, bz: -0.14, hy: 0.18, lsx: 1.0, le: 1.3, lsz: 0.35, lwx: -0.4, jaw: 0.35, eye: -0.55, tz: 0.2, shake: 1 }, 'out'],
      [0.16, { cx: -0.3, sx: -0.12, kx: -0.25, kz: 0.2, bz: -0.1, hy: 0.12, lsx: 0.8, le: 1.1, lsz: 0.3, jaw: 0.25, eye: -0.3, tz: 0.15, shake: 0.5 }],
    ] },
    die: { dur: 1.9, hold: true, keys: [
      [0.25, { by: -0.3, cx: 0.4, sx: 0.2, kx: 0.4, lsx: -0.1, rsx: -0.2, le: -0.4, jaw: 0.35, tz: 0.3, eye: -0.3, shake: 1 }],
      [0.75, { by: -0.62, cx: 0.45, sx: 0.25, kx: 0.45, lsz: 0.7, rsz: 0.6, lsx: -0.2, rsx: -0.3, le: -0.3, re: -0.6, tz: 1.0, tx: 0.2, sink: 0.2, eye: -0.6, jaw: 0.4 }, 'in'],
      [1.9, { by: -0.75, hx: -0.05, cx: 0.1, sx: 0.05, kx: 0.5, lsz: 0.55, rsz: 0.5, lsx: -0.1, le: 0.2, re: 0.2, tz: 1.2, tx: 0.2, sink: 0.95, eye: -1, orb: -0.9, jaw: 0.4 }],
    ] },
    talk: { dur: 1.5, keys: [
      [0.28, { lsx: 1.0, le: 1.15, lsz: 0.25, lsy: -0.3, lwx: -0.3, kx: -0.12, kz: 0.12, cx: -0.06 }],
      [0.65, { lsx: 1.15, le: 0.8, lsz: 0.55, lsy: -0.1, lwx: 0.2, kx: 0.06, kz: -0.1, cx: -0.04 }],
      [1.0, { lsx: 0.95, le: 1.2, lsz: 0.3, lsy: -0.3, lwx: -0.2, kx: -0.08, kz: 0.08 }],
    ] },
  };
  // Being torn out of the Summoning Tree, driven by k = 0..1.
  const EMERGE = [
    [0, { bz: -0.55, hx: -0.14, sx: -0.3, cx: -0.42, nx: 0.05, kx: 0.3, kz: 0.25, jaw: 0.05, lsx: -0.5, lsz: 1.25, le: 0.55, lwx: -0.4, rsx: -0.7, rsz: 1.1, re: 0.1, tz: 0.8, tx: -0.2, lfz: -0.2, rfz: -0.15, eye: -1, orb: -1 }],
    [0.3, { bz: -0.5, hx: -0.06, sx: -0.12, cx: -0.12, kx: 0.42, kz: -0.15, jaw: 0.4, lsx: -0.62, lsz: 1.35, le: 0.45, lwx: -0.5, rsx: -0.8, rsz: 1.25, re: 0.1, tz: 0.8, tx: -0.2, lfz: -0.2, rfz: -0.15, eye: -0.35, orb: -0.9, shake: 1 }],
    [0.6, { bz: -0.38, by: -0.08, hx: 0.1, sx: 0.3, cx: 0.42, kx: 0.12, jaw: 0.5, lsx: -0.72, lsz: 1.4, le: 0.3, lwx: -0.6, rsx: -0.85, rsz: 1.3, re: 0.1, tz: 0.7, tx: -0.2, lfz: -0.1, rfz: -0.15, orb: -0.5, shake: 1 }],
    [0.78, { bz: 0.3, by: -0.24, hx: 0.12, sx: 0.35, cx: 0.5, kx: -0.12, jaw: 0.2, lsx: 0.85, lsz: 0.3, le: 0.3, rsx: 0.55, rsz: 0.25, lfz: 0.5, rfz: -0.08, orb: 0.4 }, 'in'],
    [1, {}],
  ];

  const EASE = { in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u), lin: (u) => u, smooth: (u) => u * u * (3 - 2 * u) };
  const ZERO = {};
  function addKeys(p, keys, u, end, hold) {
    let t0 = 0, a = ZERO, w = 1, b = ZERO, ease = 'smooth';
    let i = 0;
    while (i < keys.length && keys[i][0] <= u) { t0 = keys[i][0]; a = keys[i][1]; i++; }
    if (i < keys.length) { b = keys[i][1]; ease = keys[i][2] || 'smooth'; w = (u - t0) / Math.max(1e-6, keys[i][0] - t0); }
    else if (hold) { b = a; w = 1; }
    else { b = ZERO; w = (u - t0) / Math.max(1e-6, end - t0); }
    w = EASE[ease](clamp(w, 0, 1));
    for (const k in a) p[k] += a[k] * (1 - w);
    for (const k in b) p[k] += b[k] * w;
  }

  const spring = (k, c) => ({ x: 0, v: 0, k, c, init: false });
  function stepSpring(s, target, dt) {
    if (!s.init) { s.x = target; s.init = true; }
    const a = s.k * (target - s.x) - s.c * s.v;
    s.v += a * dt;
    s.x += s.v * dt;
    return s.x - target; // lag behind the target
  }

  /* ---------- the wizard ---------- */

  function create() {
    const R = Rig(), { bone, add } = R;
    const C = {
      bark: [2.0, 1.75, 1.45], barkDk: [1.5, 1.3, 1.1], pale: [2.5, 2.3, 1.95], hat: [1.5, 1.42, 1.32],
      moss: [1.3, 1.6, 0.8], mossDk: [0.78, 0.98, 0.5], beard: [0.58, 0.66, 0.5], strand: [1.35, 1.5, 1.15], leaf: [1.1, 1.4, 0.9],
      hollow: [0.02, 0.035, 0.012], eye: [0.75, 1.0, 0.3], cap: [1.0, 0.5, 0.12], capTop: [1.0, 0.72, 0.25], stem: [0.95, 0.88, 0.75], crack: [0.45, 0.8, 0.22],
    };
    let seed = 1;
    const G = (geo, amt) => gnarl(geo, amt, seed++);

    /* bones (rest pose: everything upright, limbs hanging straight down) */
    const root = bone('root', null, 0, 0, 0);
    const hips = bone('hips', root, 0, 1.16, 0);
    const spine = bone('spine', hips, 0, 0.1, 0);
    const chest = bone('chest', spine, 0, 0.42, 0);
    const neck = bone('neck', chest, 0, 0.42, 0.05);
    const head = bone('head', neck, 0, 0.2, 0.02);
    const jaw = bone('jaw', head, 0, 0.03, 0.09);
    const beard = bone('beard', jaw, 0, -0.03, 0.02);
    const hat = bone('hat', head, 0, 0.37, -0.03);
    const hat2 = bone('hat2', hat, 0, 0.4, 0);
    const hat3 = bone('hat3', hat2, 0, 0.38, 0);
    const skirt = bone('skirt', hips, 0, 0.0, -0.02);
    const arm = (s) => {
      const sh = bone('shoulder' + s, chest, 0.25 * s, 0.37, -0.02);
      const el = bone('elbow' + s, sh, 0, -0.52, 0);
      const wr = bone('wrist' + s, el, 0, -0.5, 0);
      return { sh, el, wr, s };
    };
    const AL = arm(1), AR = arm(-1);
    const staff = bone('staff', AR.wr, 0, -0.1, 0.02);
    const staffTop = bone('staffTop', staff, 0, 1.96, 0);
    const leg = (s) => {
      const up = bone('leg' + s, root, HIP_X * s, HIP_Y, 0, 'ZXY');
      const kn = bone('knee' + s, up, 0, -THIGH, 0);
      const an = bone('ankle' + s, kn, 0, -SHIN, 0, 'ZXY');
      return { up, kn, an, s };
    };
    const LL = leg(1), LR = leg(-1);
    root.updateMatrixWorld(true);

    /* torso */
    add(hips, G(new THREE.CylinderGeometry(0.17, 0.14, 0.26, 6, 1), 0.035), M(0, 0.0, 0, 0, 0.3, 0, [1, 1, 0.82]), C.bark);
    add(spine, twist(G(limb(0.12, 0.14, 0.46, 6, 2, true), 0.03), 1.2), M(0, 0, 0, 0, 0, 0, [1, 1, 0.85]), C.bark);
    add(spine, G(new THREE.CylinderGeometry(0.27, 0.25, 0.62, 8, 2, true, 1.6, Math.PI * 2 - 3.2), 0.05), M(0, 0.17, -0.03), C.mossDk, 'moss');
    add(chest, G(limb(0.15, 0.27, 0.46, 7, 2, true), 0.04), M(0, 0, 0, 0, 0.2, 0, [1, 1, 0.72]), C.bark);
    // hunched moss mantle over shoulders and back
    add(chest, G(blob(0.3, 1), 0.09), M(0, 0.36, -0.16, 0.3, 0, 0, [1.35, 0.78, 1.05]), C.moss, 'moss');
    add(chest, G(blob(0.16, 1), 0.05), M(0.25, 0.42, -0.02, 0, 0, 0.3, [1.15, 0.7, 1.2]), C.moss, 'moss');
    add(chest, G(blob(0.16, 1), 0.05), M(-0.25, 0.42, -0.02, 0, 0, -0.3, [1.15, 0.7, 1.2]), C.moss, 'moss');
    add(chest, G(new THREE.CylinderGeometry(0.34, 0.28, 0.46, 8, 1, true, 1.7, Math.PI * 2 - 3.4), 0.05), M(0, 0.18, -0.05), C.moss, 'moss');
    // broken branches growing out of his back
    const twig = (b, x, y, z, rx, rz, len, r0, color = C.pale) => {
      add(b, G(limb(r0, 0.004, len, 4, 1, true), 0.015), M(x, y, z, rx, 0, rz), color);
      const m = M(x, y, z, rx, 0, rz).multiply(M(0, len * 0.5, 0, 0.3, 0, rz > 0 ? -0.9 : 0.9));
      add(b, limb(r0 * 0.55, 0.003, len * 0.45, 4, 1, true), m, color);
    };
    twig(chest, 0.18, 0.36, -0.26, -0.7, -1.05, 0.75, 0.06);
    twig(chest, -0.18, 0.32, -0.27, -0.85, 1.15, 0.62, 0.055);
    twig(chest, 0.04, 0.2, -0.32, -1.35, -0.2, 0.42, 0.045);
    // faint glowing cracks in the chest bark
    const crack = (pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0);
        add(chest, new THREE.PlaneGeometry(0.018, len), M((x0 + x1) / 2, (y0 + y1) / 2, 0.168, -0.12, 0, Math.atan2(x0 - x1, y1 - y0)), C.crack, 'plain', 1);
      }
    };
    crack([[-0.03, 0.08], [-0.05, 0.15], [-0.02, 0.22], [-0.06, 0.3]]);
    crack([[0.05, 0.12], [0.03, 0.19], [0.07, 0.26]]);
    // moss skirt hanging from the waist, ragged
    add(skirt, G(new THREE.CylinderGeometry(0.27, 0.34, 0.3, 9, 1, true, 0.8, Math.PI * 2 - 1.6), 0.04).translate(0, -0.08, 0), null, C.moss, 'moss');
    const skr = rng(6);
    for (let i = 0; i < 8; i++) {
      const a = 1.0 + (i * (Math.PI * 2 - 2.0)) / 7, len = 0.38 + skr() * 0.3, w = 0.2 + skr() * 0.07;
      const g = new THREE.PlaneGeometry(w, len, 1, 2).translate(0, -len / 2, 0), gp = g.attributes.position;
      for (let k = 0; k < gp.count; k++) if (gp.getY(k) < -len + 0.01) gp.setX(k, gp.getX(k) * 0.2 + (skr() - 0.5) * 0.06);
      add(skirt, G(g, 0.03), M(Math.sin(a) * 0.32, -0.2, Math.cos(a) * 0.32, -0.12, a, 0, 1, 'YXZ'), C.mossDk, 'moss');
    }
    for (let i = 0; i < 5; i++) {
      const a = 1.45 + i * 0.85;
      add(skirt, strand(0.15, 0.5 + (i % 2) * 0.25), M(Math.sin(a) * 0.3, -0.16, Math.cos(a) * 0.3, 0, a, 0), C.strand, 'strand');
    }
    for (let i = 0; i < 4; i++) {
      const a = 1.7 + i * 0.95;
      add(chest, strand(0.2, 0.42), M(Math.sin(a) * 0.36, 0.36, Math.cos(a) * 0.3 - 0.06, 0, a, 0), C.strand, 'strand');
    }

    /* neck and head */
    add(neck, twist(G(limb(0.08, 0.062, 0.24, 5, 2, true), 0.025), 2), null, C.bark);
    add(head, G(new THREE.CylinderGeometry(0.155, 0.12, 0.44, 6, 2), 0.03), M(0, 0.17, -0.01, 0, 0.26, 0, [1, 1, 0.92]), C.bark);
    // angry V brow overhanging a dark hollow
    add(head, G(new THREE.BoxGeometry(0.19, 0.065, 0.12), 0.02), M(0.08, 0.25, 0.125, 0.3, 0, 0.36), C.pale, 'root');
    add(head, G(new THREE.BoxGeometry(0.19, 0.065, 0.12), 0.02), M(-0.08, 0.25, 0.125, 0.3, 0, -0.36), C.pale, 'root');
    add(head, G(blob(0.058), 0.015), M(0.11, 0.045, 0.1, 0, 0, 0, [1, 0.8, 1]), C.pale, 'root');
    add(head, G(blob(0.058), 0.015), M(-0.11, 0.045, 0.1, 0, 0, 0, [1, 0.8, 1]), C.pale, 'root');
    add(head, new THREE.CircleGeometry(0.12, 7), M(0, 0.14, 0.13, 0, 0, 0, [1, 1.15, 1]), C.hollow, 'plain', 1);
    add(head, new THREE.OctahedronGeometry(0.04), M(0.052, 0.175, 0.14, 0, 0, 0.38, [1.6, 0.7, 0.6]), C.eye, 'plain', 1);
    add(head, new THREE.OctahedronGeometry(0.04), M(-0.052, 0.175, 0.14, 0, 0, -0.38, [1.6, 0.7, 0.6]), C.eye, 'plain', 1);
    // knotted branch nose
    const nose1 = M(0, 0.13, 0.13, -Math.PI / 2 + 0.3, 0, 0);
    add(head, G(limb(0.038, 0.027, 0.14, 5, 1), 0.01), nose1, C.pale, 'root');
    const knot = nose1.clone().multiply(M(0, -0.14, 0));
    add(head, G(blob(0.037), 0.012), knot, C.pale, 'root');
    add(head, bend(limb(0.027, 0.004, 0.16, 5, 1), 0.16, 0.025, 0), knot.clone().multiply(M(0, 0, 0, 0.6, 0, 0.3)), C.pale, 'root');
    add(head, limb(0.01, 0.002, 0.06, 3, 1), knot.clone().multiply(M(0, 0, 0, 0, 0, -1.2)), C.pale, 'root');
    // mustache strands and little side twigs under the brim
    add(head, strand(0.1, 0.34), M(0.1, 0.05, 0.12, 0.1, 0.6, 0.15), C.strand, 'strand');
    add(head, strand(0.1, 0.34), M(-0.1, 0.05, 0.12, 0.1, -0.6, -0.15), C.strand, 'strand');
    add(head, limb(0.022, 0.003, 0.22, 4, 1, true), M(0.14, 0.24, -0.03, -0.3, 0, -1.15), C.barkDk);
    add(head, limb(0.022, 0.003, 0.18, 4, 1, true), M(-0.14, 0.22, -0.02, -0.2, 0, 1.25), C.barkDk);
    add(jaw, G(new THREE.BoxGeometry(0.2, 0.06, 0.08), 0.02), M(0, -0.02, 0), C.barkDk);

    /* Spanish-moss beard */
    add(beard, G(new THREE.CylinderGeometry(0.11, 0.03, 0.64, 6, 3, true), 0.04).translate(0, -0.32, 0), M(0, 0, 0, 0, 0, 0, [1, 1, 0.55]), C.beard, 'plain');
    [[-1.0, 0.8], [-0.55, 1.0], [0, 1.12], [0.5, 0.95], [0.95, 0.8], [-1.5, 0.6], [1.5, 0.6], [0.25, 1.05]].forEach(([a, h], i) => {
      add(beard, strand(0.15, h), M(Math.sin(a) * 0.07, 0.02, Math.cos(a) * 0.05 + 0.01, 0.04, a * 0.6 + (i % 3 - 1) * 0.5, (i % 2 ? 0.07 : -0.07)), C.strand, 'strand');
    });

    /* crooked bark hat */
    const brim = new THREE.CylinderGeometry(0.57, 0.6, 0.04, 9, 1);
    const bp = brim.attributes.position, br = rng(9);
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), z = bp.getZ(i);
      if (Math.hypot(x, z) > 0.45) bp.setY(i, bp.getY(i) + Math.sin(Math.atan2(x, z) * 3 + 1) * 0.08 - (z < 0 ? 0.08 : 0) + (br() - 0.5) * 0.04);
    }
    add(hat, G(brim, 0.03), null, C.hat, 'hat');
    add(hat, G(new THREE.CylinderGeometry(0.21, 0.29, 0.42, 7, 1, true), 0.025), M(0, 0.21, 0), C.hat, 'hat');
    add(hat, G(new THREE.CylinderGeometry(0.3, 0.31, 0.11, 8, 1, true), 0.03), M(0, 0.06, 0), C.moss, 'moss');
    add(hat, G(blob(0.11), 0.03), M(0.27, 0.06, -0.08, 0, 0, 0, [1, 0.6, 1]), C.moss, 'moss');
    for (const [a, h] of [[2.4, 0.3], [3.3, 0.36], [4.2, 0.26], [1.3, 0.22]]) add(hat, strand(0.13, h), M(Math.sin(a) * 0.53, 0.0, Math.cos(a) * 0.53, 0, a, 0), C.strand, 'strand');
    for (const [a, y, rx, rz] of [[0.9, 0.07, 0.3, -1.1], [1.6, 0.05, -0.2, -1.3], [5.2, 0.08, 0.2, 1.2]]) {
      add(hat, new THREE.PlaneGeometry(0.16, 0.09).translate(0.08, 0, 0), M(Math.sin(a) * 0.3, y, Math.cos(a) * 0.3, rx, a - Math.PI / 2, rz * 0.2), C.leaf, 'leaf');
    }
    const shrooms = [];
    const shroom = (b, x, y, z, s, tilt) => {
      const m = M(x, y, z, tilt[0], 0, tilt[1]);
      add(b, limb(0.012 * s, 0.016 * s, 0.05 * s, 4, 1, true), m, C.stem, 'plain', 1);
      add(b, new THREE.ConeGeometry(0.05 * s, 0.035 * s, 6, 1), m.clone().multiply(M(0, 0.06 * s, 0)), C.cap, 'plain', 1);
      add(b, new THREE.CircleGeometry(0.02 * s, 5), m.clone().multiply(M(0, 0.079 * s, 0, -Math.PI / 2)), C.capTop, 'plain', 1);
      shrooms.push({ b, off: new THREE.Vector3(0, 0.07 * s, 0).applyMatrix4(m) });
    };
    shroom(hat, 0.33, 0.08, 0.05, 1.3, [0.2, -0.6]);
    shroom(hat, 0.29, 0.1, -0.17, 1.0, [-0.4, -0.5]);
    shroom(hat, -0.22, 0.06, -0.25, 1.1, [-0.6, 0.4]);
    shroom(hat, 0.5, -0.01, 0.22, 0.9, [0.3, -0.3]);
    add(hat2, G(new THREE.CylinderGeometry(0.12, 0.21, 0.4, 6, 1, true), 0.02), M(0, 0.19, 0), C.hat, 'hat');
    add(hat2, G(blob(0.08), 0.03), M(-0.13, 0.12, -0.08, 0, 0, 0, [1, 0.7, 1]), C.moss, 'moss');
    add(hat2, strand(0.1, 0.3), M(-0.12, 0.12, -0.1, 0, -2.3, 0), C.strand, 'strand');
    shroom(hat2, 0.15, 0.14, 0.05, 0.8, [0.1, -0.9]);
    add(hat3, bend(G(new THREE.CylinderGeometry(0.004, 0.125, 0.48, 6, 3, true), 0.012).translate(0, 0.24, 0), 0.48, 0.09, -0.14), null, C.hat, 'hat');

    /* branch arms with twig fingers */
    for (const A of [AL, AR]) {
      const s = A.s;
      add(A.sh, G(blob(0.095), 0.02), null, C.bark);
      add(A.sh, bend(G(limb(0.076, 0.056, 0.52, 5, 2), 0.022), 0.52, 0.03 * s, 0.02), null, C.bark);
      add(A.sh, limb(0.024, 0.003, 0.26, 4, 1, true), M(0.05 * s, -0.26, -0.02, -0.4, 0, -1.0 * s), C.barkDk);
      add(A.el, G(blob(0.072), 0.015), null, C.bark);
      add(A.el, bend(G(limb(0.062, 0.042, 0.5, 5, 2), 0.02), 0.5, -0.02 * s, 0.03), null, C.bark);
      add(A.el, G(blob(0.085), 0.03), M(0, -0.13, -0.01, 0, 0, 0, [1, 1.35, 1]), C.moss, 'moss');
      add(A.el, strand(0.13, 0.34), M(0.05 * s, -0.1, -0.03, 0, 1.2 * s, 0), C.strand, 'strand');
      add(A.el, strand(0.12, 0.28), M(0, -0.1, -0.06, 0, Math.PI, 0), C.strand, 'strand');
      add(A.wr, G(new THREE.OctahedronGeometry(0.06), 0.015), M(0, -0.05, 0, 0, 0, 0, [0.9, 1.3, 0.55]), C.bark);
      const grip = s < 0 ? -0.8 : -0.3;
      for (let i = 0; i < 4; i++) {
        const m1 = M(s * (-0.033 + i * 0.022), -0.09, 0, grip - (i === 3 ? 0.1 : 0), 0, s * (-0.4 + i * 0.26));
        add(A.wr, limb(0.016, 0.011, 0.14, 4, 1), m1, C.pale, 'root');
        add(A.wr, limb(0.011, 0.002, 0.14 - i * 0.012, 4, 1), m1.clone().multiply(M(0, -0.14, 0, grip * 0.8)), C.pale, 'root');
      }
      add(A.wr, limb(0.014, 0.002, 0.12, 4, 1), M(-s * 0.035, -0.04, 0.03, -1.0, 0, -s * 0.7), C.pale, 'root');
    }

    /* long legs ending in splayed roots */
    for (const Lg of [LL, LR]) {
      const s = Lg.s;
      add(Lg.up, G(blob(0.095), 0.02), null, C.bark);
      add(Lg.up, bend(G(limb(0.1, 0.075, THIGH, 5, 2), 0.022), THIGH, 0, 0.04), null, C.bark);
      add(Lg.kn, G(blob(0.088), 0.02), M(0, 0, 0.02, 0, 0, 0, [1, 1, 1.2]), C.bark);
      add(Lg.kn, G(limb(0.08, 0.055, SHIN, 5, 2), 0.02), null, C.bark);
      add(Lg.kn, strand(0.14, 0.26), M(0.03 * s, -0.02, 0.06, 0.2, 0.4 * s, 0), C.strand, 'strand');
      add(Lg.an, G(blob(0.075), 0.015), null, C.bark);
      for (const [a, len, r0] of [[-0.6, 0.42, 0.06], [0.05, 0.5, 0.068], [0.65, 0.4, 0.06], [Math.PI, 0.28, 0.055], [1.5, 0.32, 0.05]]) {
        const root3 = bend(G(limb(r0, 0.006, len, 4, 2), 0.02), len, 0, -0.05);
        add(Lg.an, root3, M(0, 0, 0, -Math.PI / 2 + 0.27, a * s, 0, 1, 'YXZ'), C.bark, 'root');
      }
    }

    /* gnarled root staff, taller than him, prongs cradling the orb */
    const shaft = new THREE.CylinderGeometry(0.045, 0.056, 3.0, 5, 8, true).translate(0, 0.25, 0);
    const shp = shaft.attributes.position;
    for (let i = 0; i < shp.count; i++) shp.setX(i, shp.getX(i) + Math.sin(shp.getY(i) * 1.9) * 0.035);
    add(staff, twist(G(shaft, 0.03), 1.3), null, C.pale, 'root');
    for (const [y, x] of [[0.4, 0.02], [0.95, -0.02], [1.45, 0.01]]) add(staff, G(blob(0.065), 0.02), M(x, y, 0, 0, y, 0, [1, 1.3, 1]), C.pale, 'root');
    add(staff, limb(0.028, 0.004, 0.24, 4, 1, true), M(0.03, 1.1, 0, 0.2, 0, -0.9), C.pale, 'root');
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.3;
      add(staff, limb(0.038, 0.004, 0.22, 4, 1), M(0, -1.18, 0, 0, a, 0).multiply(M(0, 0, 0, 0.55, 0, 0)), C.bark, 'root');
    }
    for (let i = 0; i < 4; i++) {
      const m1 = M(0, 1.74, 0, 0, i * (Math.PI / 2) + 0.4, 0).multiply(M(0, 0, 0, 0.55, 0, 0));
      add(staff, limb(0.032, 0.02, 0.2, 4, 1, true), m1, C.pale, 'root');
      add(staff, limb(0.02, 0.003, 0.21, 4, 1, true), m1.clone().multiply(M(0, 0.2, 0, -1.05, 0, 0)), C.pale, 'root');
    }
    add(staff, G(blob(0.08), 0.03), M(0, 1.62, 0, 0, 0, 0, [1, 1.4, 1]), C.moss, 'moss');
    add(staff, strand(0.12, 0.45), M(0.02, 1.66, 0.05, 0, 0.5, 0), C.strand, 'strand');

    /* assemble: two skinned meshes share one skeleton */
    const tex = atlas();
    const matBody = selfLit(ps1(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, flatShading: true, alphaTest: 0.5, side: THREE.DoubleSide })), 0.24);
    const matGlow = ps1(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const group = new THREE.Group();
    group.name = 'wizard';
    const body = new THREE.SkinnedMesh(R.build(0), matBody);
    body.add(root);
    body.bind(new THREE.Skeleton(R.bones));
    const glowMesh = new THREE.SkinnedMesh(R.build(1), matGlow);
    glowMesh.bind(body.skeleton, body.bindMatrix);
    body.frustumCulled = glowMesh.frustumCulled = false;
    group.add(body, glowMesh);

    const ORB = new THREE.Color(0x7ff6ff);
    const orbMat = ps1(new THREE.MeshBasicMaterial({ color: ORB }));
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), orbMat);
    staffTop.add(orb);
    const light = new THREE.PointLight(0x7ff6ff, 4, 10, 1.3);
    light.position.set(0, 0.1, 0);
    staffTop.add(light);

    // death: he collapses into a mound of moss
    const moundGeo = gnarl(new THREE.IcosahedronGeometry(0.62, 1), 0.2, 99);
    moundGeo.scale(1.25, 0.5, 1.1);
    const mUV = moundGeo.attributes.uv, mc = new Float32Array(moundGeo.attributes.position.count * 3);
    for (let i = 0; i < mUV.count; i++) {
      mUV.setXY(i, (REG.moss[0] + 0.5 + mUV.getX(i) * 31) / AW, 1 - (REG.moss[1] + 0.5 + (1 - mUV.getY(i)) * 31) / AH);
      mc.set(C.moss, i * 3);
    }
    moundGeo.setAttribute('color', new THREE.BufferAttribute(mc, 3));
    const mound = new THREE.Mesh(moundGeo, matBody);
    mound.visible = false;
    mound.position.set(0, 0, 0.3);
    group.add(mound);

    // glow billboards: eyes, orb (halo + core), mushrooms, drifting spores
    const SPORES = 8;
    const glowList = [
      { b: head, off: new THREE.Vector3(0.052, 0.175, 0.15), size: 0.28, col: C.eye, kind: 'eye' },
      { b: head, off: new THREE.Vector3(-0.052, 0.175, 0.15), size: 0.28, col: C.eye, kind: 'eye' },
      { b: staffTop, off: new THREE.Vector3(), size: 1.25, col: [0.5, 0.96, 1], kind: 'orb' },
      { b: staffTop, off: new THREE.Vector3(), size: 0.45, col: [1, 1, 1], kind: 'core' },
      ...shrooms.map((m) => ({ b: m.b, off: m.off, size: 0.22, col: [1, 0.5, 0.12], kind: 'shroom' })),
    ];
    const pts = glowPoints(glowList.length + SPORES);
    group.add(pts);
    const spores = [];
    const sr = rng(31);
    for (let i = 0; i < SPORES; i++) spores.push({ x: (sr() - 0.5) * 0.7, z: -0.1 - sr() * 0.3, y: 1.3 + sr() * 0.8, ph: sr(), sp: 0.22 + sr() * 0.15 });

    /* animation state */
    const st = {
      t: 0, walk: 0, act: null, actT: 0, fade: null, fadeT: 0, dead: false,
      emerge: 1, emergeAuto: false, flash: 0, flashCol: new THREE.Color(0xffffff), eye: 1,
      sHat: spring(90, 8), sHatZ: spring(80, 7), sBeard: spring(60, 6), sBeardZ: spring(55, 6), sSkirt: spring(50, 6),
    };
    const p = {}, last = {};
    const tq = new THREE.Quaternion(), hq = new THREE.Quaternion(), gq = new THREE.Quaternion(), tv = new THREE.Vector3(), ts = new THREE.Vector3();
    const invG = new THREE.Matrix4(), col = new THREE.Color();

    function legIK(Lg, fx, fy, fz, pitch) {
      const hx = HIP_X * Lg.s + p.bx, hy = HIP_Y + p.by - p.sink, hz = p.bz;
      const dx = fx - hx, dy = fy + ANK - hy, dz = fz - hz;
      const lat = Math.hypot(dx, dy), d = clamp(Math.hypot(lat, dz), 0.3, THIGH + SHIN - 1e-3);
      const th = Math.atan2(dz, lat);
      const a = Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
      const k = Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
      const roll = Math.atan2(dx, -dy);
      Lg.up.rotation.set(-(th + a), 0, roll);
      Lg.kn.rotation.set(Math.PI - k, 0, 0);
      Lg.an.rotation.set(-pitch + (th + a) - (Math.PI - k), 0, -roll);
    }

    function pose(dt, o) {
      for (const c of CH) p[c] = REST[c] || 0;
      const pos = typeof o.songPos === 'number' && o.songPos >= 0 ? o.songPos : (o.t != null ? o.t : st.t) / STEP;
      const bf = mod(pos / 4, 1);
      // idle: breathing over two bars, a head nod on every beat, a slow sway
      const nod = Math.pow(0.5 + 0.5 * Math.cos(bf * Math.PI * 2), 3), breath = Math.sin((pos / 32) * Math.PI * 2);
      p.kx += 0.1 * nod; p.nx += 0.04 * nod; p.by -= 0.02 * nod;
      p.cx += 0.035 * breath; p.by += 0.012 * breath; p.lsz += 0.03 * breath; p.rsz += 0.012 * breath;
      p.hz += 0.03 * Math.sin((pos / 64) * Math.PI * 2);
      p.kz += 0.05 * Math.sin((pos / 48) * Math.PI * 2 + 1);
      p.lwx += 0.15 * Math.sin((pos / 24) * Math.PI * 2);
      // walk: one stride per two beats, so every footfall lands on a beat
      const w = st.walk;
      if (w > 0.001) {
        const Gp = pos / 8, ph = Gp * Math.PI * 2, S = 0.85 * w, H = 0.24 * Math.min(1, w * 1.5), D = 0.55;
        for (const [sd, off] of [['l', 0], ['r', 0.5]]) {
          const f = mod(Gp + off, 1);
          if (f < D) p[sd + 'fz'] += S / 2 - S * (f / D);
          else {
            const u = (f - D) / (1 - D);
            p[sd + 'fz'] += -S / 2 + S * EASE.smooth(u);
            p[sd + 'fy'] += H * Math.sin(Math.PI * u);
            p[sd + 'fp'] += 0.6 * Math.sin(Math.PI * u) * w;
          }
        }
        const dip = Math.pow(0.5 + 0.5 * Math.cos(ph * 2), 2);
        p.by += -0.11 * w * dip + 0.035 * w;
        p.hz += 0.1 * w * Math.cos(ph); p.hy -= 0.16 * w * Math.cos(ph); p.cy += 0.22 * w * Math.cos(ph); p.cz -= 0.05 * w * Math.cos(ph);
        p.sx += 0.12 * w; p.kx -= 0.08 * w; p.kx += 0.05 * w * dip;
        p.lsx -= 0.45 * w * Math.cos(ph); p.le += 0.15 * w; p.rsx += 0.22 * w * Math.cos(ph);
        p.tx += 0.22 * w * Math.cos(ph) + 0.08 * w;
        p.flare += 0.4 * w;
      }
      if (o.grounded === false) { p.lfy += 0.25; p.rfy += 0.35; p.rfz -= 0.15; p.lsz += 0.4; p.flare += 0.4; }
      // one-shot action, cross-faded from the previous one
      for (const c of CH) last[c] = 0;
      if (st.act) {
        const A = ACTS[st.act];
        st.actT += dt;
        addKeys(last, A.keys, st.actT, A.dur, A.hold);
        if (st.act === 'talk') last.jaw += 0.2 * Math.max(0, Math.sin(st.actT * 21)) * (1 - smoothstep(A.dur - 0.3, A.dur, st.actT));
        if (st.actT >= A.dur && !A.hold) st.act = null;
      }
      if (st.fade) {
        st.fadeT -= dt;
        const k = clamp(st.fadeT / 0.12, 0, 1);
        for (const c in st.fade) last[c] += st.fade[c] * k;
        if (st.fadeT <= 0) st.fade = null;
      }
      for (const c of CH) p[c] += last[c];
      // emerging from the tree
      if (st.emergeAuto) { st.emerge = Math.min(1, st.emerge + dt / 3.2); if (st.emerge >= 1) st.emergeAuto = false; }
      if (st.emerge < 1) addKeys(p, EMERGE, st.emerge, 1, false);
      if (p.shake > 0) {
        const n = p.shake * 0.05;
        p.cx += Math.sin(st.t * 61) * n; p.kz += Math.sin(st.t * 47) * n * 1.5; p.lsz += Math.sin(st.t * 53) * n; p.rsz += Math.sin(st.t * 59) * n; p.by += Math.sin(st.t * 43) * n * 0.3;
      }
    }

    function applyPose(dt) {
      root.position.set(p.bx, p.by - p.sink, p.bz);
      hips.rotation.set(p.hx, p.hy, p.hz);
      spine.rotation.set(p.sx, p.sy, p.sz);
      chest.rotation.set(p.cx, p.cy, p.cz);
      neck.rotation.set(p.nx, 0, 0);
      head.rotation.set(p.kx, p.ky, p.kz);
      jaw.rotation.set(p.jaw, 0, 0);
      const torso = p.hx + p.sx + p.cx, hp = torso + p.nx + p.kx, hr = p.hz + p.sz + p.cz + p.kz;
      AL.sh.rotation.set(-p.lsx - torso, p.lsy, p.lsz);
      AL.el.rotation.set(-p.le, 0, 0);
      AL.wr.rotation.set(-p.lwx, 0, p.lwz);
      AR.sh.rotation.set(-p.rsx - torso, -p.rsy, -p.rsz);
      AR.el.rotation.set(-p.re, 0, 0);
      AR.wr.rotation.set(-p.rwx, 0, -p.rwz);
      // secondary motion: the hat and beard lag behind the head, the skirt trails
      const lag = stepSpring(st.sHat, hp - p.by * 2, dt), lagZ = stepSpring(st.sHatZ, hr, dt);
      hat.rotation.set(-0.2 + lag * 0.9, 0, 0.1 + lagZ * 0.8);
      hat2.rotation.set(-0.38 + lag * 0.7, 0, 0.2 + lagZ * 0.6);
      hat3.rotation.set(-0.7 + lag * 1.1, 0, 0.42 + lagZ);
      const bl = stepSpring(st.sBeard, hp + p.jaw, dt), blz = stepSpring(st.sBeardZ, hr, dt);
      beard.rotation.set(-(hp + p.jaw) + bl * 0.9 + p.flare * 0.25, 0, -hr + blz * 0.9);
      const sl = stepSpring(st.sSkirt, p.hx - p.by, dt);
      skirt.rotation.set(-p.hx * 0.6 + sl * 0.8 + p.flare * 0.35, 0, -p.hz * 0.5);
      legIK(LL, FOOT.l[0] + p.lfx, FOOT.l[1] + p.lfy, FOOT.l[2] + p.lfz, p.lfp);
      legIK(LR, FOOT.r[0] - p.rfx, FOOT.r[1] + p.rfy, FOOT.r[2] + p.rfz, p.rfp);
      // the staff keeps its own orientation (in body space) while its grip follows the hand
      group.updateMatrixWorld(true);
      group.matrixWorld.decompose(tv, gq, ts);
      AR.wr.matrixWorld.decompose(tv, hq, ts);
      hq.premultiply(gq.invert());
      tq.setFromEuler(E.set(p.tx, p.ty, p.tz));
      staff.quaternion.copy(hq.invert().multiply(tq));
      staff.updateMatrixWorld(true);
    }

    function updateGlow(pos) {
      const bf = mod(pos / 4, 1), beat = Math.exp(-bf * 6);
      st.flash *= Math.exp(-st.dt * 2.6);
      const eye = clamp(p.eye, 0, 1.5), orbK = clamp(p.orb, 0, 2);
      col.copy(ORB).lerp(st.flashCol, clamp(st.flash, 0, 1));
      orbMat.color.copy(col).multiplyScalar(0.25 + 0.75 * Math.min(1, orbK));
      light.color.copy(col);
      light.intensity = orbK * (3.2 + 1.4 * beat + 4 * st.flash);
      matGlow.color.setScalar(0.12 + 0.88 * Math.min(1, eye));
      invG.copy(group.matrixWorld).invert();
      const P = pts.geometry.attributes.position, Cc = pts.geometry.attributes.gcol, Sz = pts.geometry.attributes.gsize;
      glowList.forEach((g, i) => {
        tv.copy(g.off).applyMatrix4(g.b.matrixWorld).applyMatrix4(invG);
        P.setXYZ(i, tv.x, tv.y, tv.z);
        let k = 1, size = g.size;
        if (g.kind === 'eye') k = eye * (0.9 + 0.2 * beat);
        else if (g.kind === 'orb') { k = orbK * (0.55 + 0.25 * beat + 0.6 * st.flash); size *= 0.85 + 0.25 * beat + 0.5 * st.flash; }
        else if (g.kind === 'core') k = orbK;
        else if (g.kind === 'shroom') k = Math.min(1, eye) * (0.7 + 0.3 * beat);
        const c = g.kind === 'orb' ? [col.r, col.g, col.b] : g.col;
        Cc.setXYZ(i, c[0] * k, c[1] * k, c[2] * k);
        Sz.setX(i, size);
      });
      const n0 = glowList.length, alive = st.dead ? 0 : Math.min(1, eye);
      spores.forEach((s, i) => {
        const u = mod(st.t * s.sp + s.ph, 1);
        P.setXYZ(n0 + i, s.x + Math.sin(u * 9 + i) * 0.12, s.y + u * 1.3, s.z - u * st.walk * 1.2 + Math.cos(u * 7 + i) * 0.1);
        const f = Math.sin(u * Math.PI) * alive * 0.55;
        Cc.setXYZ(n0 + i, 0.75 * f, 1.0 * f, 0.4 * f);
        Sz.setX(n0 + i, 0.09);
      });
      P.needsUpdate = Cc.needsUpdate = Sz.needsUpdate = true;
      // the moss mound grows as he sinks
      const m = clamp((p.sink - 0.05) / 0.6, 0, 1);
      mound.visible = m > 0;
      mound.scale.setScalar(Math.max(0.001, m));
    }

    function update(dt, o = {}) {
      dt = clamp(dt || 0, 0, 0.1);
      st.t += dt; st.dt = dt;
      const target = o.moving ? clamp(o.speed01 == null ? 1 : o.speed01, 0, 1) : 0;
      st.walk += (target - st.walk) * (1 - Math.exp(-dt * 9));
      pose(dt, o);
      // springs are stepped in small slices so a long frame cannot blow them up
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < n; i++) applyPose(dt / n);
      const pos = typeof o.songPos === 'number' && o.songPos >= 0 ? o.songPos : (o.t != null ? o.t : st.t) / STEP;
      updateGlow(pos);
    }

    function act(name) {
      if (name === 'emerge') { st.dead = false; st.act = null; st.emerge = 0; st.emergeAuto = true; return; }
      if (!ACTS[name] || (st.dead && name !== 'die')) return;
      if (name === 'die' && st.act === 'die') return;
      if (st.act) { st.fade = Object.assign({}, last); st.fadeT = 0.12; }
      st.act = name; st.actT = 0;
      if (name === 'die') st.dead = true;
    }

    const wiz = {
      group, light, bones: R.bones, parts: { body, glow: glowMesh, orb, points: pts, mound },
      update, act,
      orbWorld(v3) { return orb.getWorldPosition(v3); },
      setOrbColor(hex) { st.flashCol.set(hex); st.flash = 1; },
      setEmerge(k) { st.emergeAuto = false; st.emerge = clamp(k, 0, 1); if (k < 1) { st.dead = false; } },
      reset() { st.dead = false; st.act = null; st.fade = null; st.emerge = 1; st.emergeAuto = false; },
      get acting() { return st.act; },
      get dead() { return st.dead; },
      get triangles() {
        let n = 0;
        group.traverse((m) => { if (m.isMesh && m.geometry) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
        return n;
      },
    };
    update(0, { t: 0 });
    return wiz;
  }

  return { create };
})();
