'use strict';
/* terrain.js: the shape of the jungle as pure data and maths (no THREE, no DOM).
   Layout (x = east, z = south, y = up; north is -z):
     Zone A (south):   the Summoning Swamp, the first clearing, the Panther Ruins.
     Ridge at z=-11:   one gap at x=14, sealed by a vine wall (burn it with the snare bolt).
     Zone B (middle):  Moth Hollow, the waterfall pool and the Sub Toad.
     Cliff at z=-67:   one ramp at x=61, sealed by cracked stone (break it with the bass quake).
     Zone C (north):   the plateau, the Warden and the Lost Pyramid on its neon grid.
   heightAt() is the ground exactly as rendered: the procedural shape is sampled on a 2-unit grid
   and interpolated over the same triangles World builds, so whatever stands on it touches the mesh. */

const Terrain = (() => {
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
  const PLATEAU_Y = 9, WATER_Y = 0, MAX_SLOPE = 1.1;
  const GRID = { size: 2, n: 130, half: 130 };
  // Collision boxes of the two gates: each spans its whole passage.
  const BOXES = { vines: [10, -11.6, 18, -10.4], cracked: [56.6, -70.9, 65.4, -69.1] };

  const SEGS = [];
  for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) SEGS.push([...path[i], ...path[i + 1]]);

  function segDist(x, z, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
  }
  function pathDist(x, z) {
    let best = 1e9;
    for (const s of SEGS) best = Math.min(best, segDist(x, z, s[0], s[1], s[2], s[3]));
    return best;
  }
  const d2 = (x, z, k) => dist2(x, z, L[k][0], L[k][1]);

  /* ---------- the procedural shape ---------- */

  function raw(x, z) {
    // rolling jungle floor
    let h = 0.9 + (fbm(x * 0.025 + 11, z * 0.025 - 7, 4) - 0.5) * 3.2 + (vnoise(x * 0.18, z * 0.18) - 0.5) * 0.5;
    // the Summoning Swamp; the tree stands on an island tied to the spawn by a causeway of roots
    h = lerp(h, -1.1 + (vnoise(x * 0.3, z * 0.3) - 0.5) * 0.8, smoothstep(29, 15, d2(x, z, 'swamp')));
    h = lerp(h, 1.3 + (vnoise(x * 0.5, z * 0.5) - 0.5) * 0.3, smoothstep(12, 8, d2(x, z, 'tree')));
    h = lerp(h, 0.7, smoothstep(3.4, 1.4, segDist(x, z, ...L.tree, ...L.spawn)));
    h = lerp(h, 1.0, smoothstep(7, 4, d2(x, z, 'spawn')));
    // clearing and paths
    h = lerp(h, 1.0, smoothstep(15, 9, d2(x, z, 'clearing')));
    h = lerp(h, Math.max(h * 0.4 + 0.55, 0.55), 0.85 * smoothstep(4.2, 1.2, pathDist(x, z)));
    // ruins courtyard
    h = lerp(h, 1.2, smoothstep(14, 10, Math.max(Math.abs(x - 13), Math.abs(z - 4))));
    // Moth Hollow: a dry sunken bowl inside a rim
    const dh = d2(x, z, 'hollow');
    h += 1.7 * smoothstep(11, 17, dh) * smoothstep(25, 18, dh);
    h = lerp(h, 0.4 + (vnoise(x * 0.3, z * 0.3) - 0.5) * 0.3, smoothstep(13, 6, dh));
    // the pool under the falls
    h = lerp(h, -1.6 + (vnoise(x * 0.5, z * 0.5) - 0.5) * 0.4, smoothstep(11.5, 6, d2(x, z, 'pool')));
    // the ridge at z=-11: a ragged wall with a single gap at x=14
    const gx = Math.abs(x - 14);
    const wob = (vnoise(x * 0.06 + 3, 1.7) - 0.5) * 3.5 * smoothstep(6, 16, gx);
    const ridge = smoothstep(4.8, 2.6, Math.abs(z + 11 + wob)) * (1 - smoothstep(4.2, 2.9, gx));
    h += ridge * (6.5 + fbm(x * 0.05 + 40, 2.3, 3) * 5 + (vnoise(x * 0.4, z * 0.4) - 0.5) * 1.6);
    // the plateau to the north; its cliff edge wanders, except at the falls and the ramp
    const edge = -67.3 + (vnoise(x * 0.05, 9.1) - 0.5) * 5 * smoothstep(6, 14, Math.abs(x - 61)) * smoothstep(5, 12, Math.abs(x - 36));
    const plat = PLATEAU_Y + (fbm(x * 0.04, z * 0.04, 3) - 0.5) * 1.6 * smoothstep(12, 32, d2(x, z, 'pyramid'));
    h = lerp(h, plat, smoothstep(edge + 1.8, edge - 1.8, z));
    // a stream across the plateau feeds the falls
    const sd = segDist(x, z, 36, -69, 30, -104);
    h -= 0.9 * smoothstep(3, 1.2, sd) * smoothstep(-66, -69.5, z);
    // the one ramp up, cut into the cliff at x=61
    const rampMask = smoothstep(4.2, 2.8, Math.abs(x - 61)) * smoothstep(-59, -62, z);
    const rampY = lerp(1.1, PLATEAU_Y, clamp((-z - 62) / 17, 0, 1));
    h = lerp(h, rampY, rampMask * smoothstep(-86, -80, z));
    // steep hills wall the world in
    const e = Math.max(Math.abs(x) - 98, z - 96, -z - 116);
    if (e > 0) h += e * 2.2 + (vnoise(x * 0.2, z * 0.2) - 0.5) * Math.min(e, 4);
    return h;
  }

  // Flat pads where things stand: the Loop Stones and the Warden's arena.
  const PADS = [['stone1', 4.4, 6.5], ['stone2', 4.4, 6.5], ['stone3', 4.4, 6.5], ['warden', 5, 8]];
  let padY = null;
  function shape(x, z) {
    let h = raw(x, z);
    for (const [k, r0, r1] of PADS) {
      const w = smoothstep(r1, r0, d2(x, z, k));
      if (w > 0) h = lerp(h, padY[k], w);
    }
    return h;
  }

  /* ---------- the ground mesh ---------- */

  const N = GRID.n, S = GRID.size, HALF = GRID.half, ROW = N + 1;
  let H = null;
  function init() {
    padY = {};
    for (const [k] of PADS) padY[k] = Math.max(raw(L[k][0], L[k][1]), 0.8);
    H = new Float32Array(ROW * ROW);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * ROW + i] = shape(-HALF + i * S, -HALF + j * S);
  }
  // Finds the grid cell and the triangle: (x0,z0)-(x0,z1)-(x1,z0) when u + v <= 1, else (x1,z1)-(x0,z1)-(x1,z0).
  function cell(x, z) {
    if (!H) init();
    const fx = clamp((x + HALF) / S, 0, N - 1e-9), fz = clamp((z + HALF) / S, 0, N - 1e-9);
    const i = Math.floor(fx), j = Math.floor(fz), k = j * ROW + i;
    return { u: fx - i, v: fz - j, a: H[k], b: H[k + ROW], c: H[k + ROW + 1], d: H[k + 1] };
  }
  function heightAt(x, z) {
    const { u, v, a, b, c, d } = cell(x, z);
    return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }
  // Steepest rise per unit of the ground triangle under (x, z).
  function slopeAt(x, z) {
    const { u, v, a, b, c, d } = cell(x, z);
    return (u + v <= 1 ? Math.hypot(d - a, b - a) : Math.hypot(c - b, c - d)) / S;
  }

  // Can you walk from a to b? Downhill always; uphill only if the move and the ground are not too steep
  // (so a cliff can't be climbed at a slant either). The world's edge is a wall.
  function canStep(ax, az, bx, bz) {
    if (Math.abs(bx) > 106 || bz > 104 || bz < -124) return false;
    const rise = heightAt(bx, bz) - heightAt(ax, az);
    if (rise <= 0) return true;
    const d = Math.hypot(bx - ax, bz - az) || 1e-6;
    return rise <= MAX_SLOPE * d + 0.02 && slopeAt(bx, bz) <= MAX_SLOPE;
  }

  // Where vegetation must not grow: paths, clearings, landmarks and their approaches.
  const CLEAR = [['clearing', 12], ['tree', 9], ['spawn', 6], ['pool', 9], ['hollow', 7], ['pyramid', 32], ['stone1', 6],
    ['stone2', 6], ['stone3', 7], ['warden', 9], ['altar', 5], ['falls', 5], ['gate1', 6], ['gate2', 6]];
  function keepClear(x, z, pad = 0) {
    if (pathDist(x, z) < 3.4 + pad) return true;
    for (const [k, r] of CLEAR) if (d2(x, z, k) < r + pad) return true;
    if (Math.abs(x - 13.5) < 13 + pad && Math.abs(z - 3) < 13 + pad) return true; // ruins
    return Math.abs(x - 61) < 5 + pad && z < -58 && z > -86; // ramp
  }

  /* ---------- collision ---------- */

  // Circles live in a spatial hash (padded by the largest mover radius); boxes are few and checked directly.
  function createColliders() {
    const CELL = 8, PAD = 1.5, grid = new Map(), boxes = [];
    function addCircle(x, z, r) {
      const c = { x, z, r };
      const i0 = Math.floor((x - r - PAD) / CELL), i1 = Math.floor((x + r + PAD) / CELL);
      const j0 = Math.floor((z - r - PAD) / CELL), j1 = Math.floor((z + r + PAD) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = i + ',' + j;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(c);
      }
      return c;
    }
    function addBox(x0, z0, x1, z1, id) {
      const b = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), id, active: true };
      boxes.push(b);
      return b;
    }
    function collide(p, r) {
      const list = grid.get(Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL));
      if (list) for (const c of list) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = r + c.r;
        if (d < min && d > 1e-6) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
      }
      for (const b of boxes) {
        if (!b.active) continue;
        const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-6) { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; continue; }
        const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bb = b.z1 - p.z, m = Math.min(l, rr, t, bb);
        if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.z = b.z0 - r; else p.z = b.z1 + r;
      }
    }
    function blockedByBox(x, z, r) {
      for (const b of boxes) if (b.active && x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return b;
      return null;
    }
    return { addCircle, addBox, collide, blockedByBox, boxes };
  }

  return { L, PATHS, PLATEAU_Y, WATER_Y, MAX_SLOPE, GRID, BOXES, pathDist, heightAt, slopeAt, canStep, keepClear, createColliders };
})();
