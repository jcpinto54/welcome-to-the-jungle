'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const { Terrain } = load(['src/core.js', 'src/terrain.js'], ['Terrain']);
const { L, PATHS, BOXES, GRID, WATER_Y, PLATEAU_Y, heightAt, canStep, pathDist, keepClear, createColliders } = Terrain;
const R = 0.45; // a slim player radius, so the gates are tested generously

// Walks a straight line in small steps. Returns the first point that refuses the step, or null.
function walk(ax, az, bx, bz, step = 0.25) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
  let px = ax, pz = az;
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
    if (!canStep(px, pz, x, z)) return [x, z];
    px = x; pz = z;
  }
  return null;
}

// Flood-fills the walkable ground (0.5 grid, 8 neighbours, breadth first) across the whole width of
// the world, starting from every cell on row zFrom. Returns a cell reached on row zTo, or null.
// A player who can only take canStep moves and never enters a box can't do better than this.
function crossing(colliders, zFrom, zTo, r = R) {
  const S = 0.5, x0 = -106, nx = Math.round(212 / S) + 1, nz = Math.round(Math.abs(zTo - zFrom) / S) + 1;
  const dir = Math.sign(zTo - zFrom), X = (i) => x0 + i * S, Z = (j) => zFrom + dir * j * S;
  const seen = new Uint8Array(nx * nz), queue = [];
  for (let i = 0; i < nx; i++) if (!colliders.blockedByBox(X(i), Z(0), r)) { seen[i] = 1; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head], i = k % nx, j = (k - i) / nx;
    if (j === nz - 1) return [X(i), Z(j)];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ni = i + di, nj = j + dj, nk = nj * nx + ni;
      if ((!di && !dj) || ni < 0 || nj < 0 || ni >= nx || nj >= nz || seen[nk]) continue;
      if (!canStep(X(i), Z(j), X(ni), Z(nj)) || colliders.blockedByBox(X(ni), Z(nj), r)) continue;
      seen[nk] = 1; queue.push(nk);
    }
  }
  return null;
}

test('every landmark in the contract exists', () => {
  for (const k of ['tree', 'spawn', 'swamp', 'clearing', 'stone1', 'ruins', 'altar', 'gate1', 'hollow', 'pool', 'falls',
    'stone2', 'toad', 'gate2', 'stone3', 'pyramid', 'warden']) {
    assert.ok(Array.isArray(L[k]) && L[k].length === 2 && L[k].every(Number.isFinite), k);
  }
  assert.deepEqual([...L.gate1], [14, -11]);
  assert.deepEqual([...L.gate2], [61, -70]);
  assert.equal(WATER_Y, 0);
});

test('the paths chain from the spawn to the pyramid', () => {
  assert.deepEqual([...PATHS[0][0]], [...L.spawn]);
  assert.deepEqual([...PATHS[PATHS.length - 1].at(-1)], [...L.pyramid]);
  for (let i = 1; i < PATHS.length; i++) assert.deepEqual([...PATHS[i][0]], [...PATHS[i - 1].at(-1)], `path ${i} starts where ${i - 1} ends`);
  for (const path of PATHS) for (const [x, z] of path) assert.ok(pathDist(x, z) < 1e-9);
  assert.ok(Math.abs(pathDist(L.spawn[0] + 50, L.spawn[1] + 30) - 0) > 5);
});

test('every path is walkable both ways in quarter-unit steps', () => {
  PATHS.forEach((path, p) => {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      assert.equal(walk(ax, az, bx, bz), null, `path ${p} segment ${i} forwards`);
      assert.equal(walk(bx, bz, ax, az), null, `path ${p} segment ${i} backwards`);
    }
  });
});

test('the paths stay dry: you never wade to follow them', () => {
  for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      assert.ok(heightAt(x, z) > WATER_Y + 0.25, `path under water at ${x.toFixed(1)},${z.toFixed(1)} (${heightAt(x, z).toFixed(2)})`);
    }
  }
});

test('the ridge at z=-11 blocks the way north except at the gap at x=14', () => {
  for (const x of [-30, 40]) {
    assert.ok(walk(x, 0, x, -22), `ridge blocks going north at x=${x}`);
    assert.ok(walk(x, -22, x, 0), `ridge blocks going south at x=${x}`);
  }
  assert.equal(walk(14, 0, 14, -22), null, 'the gap lets you north');
  assert.equal(walk(14, -22, 14, 0), null, 'the gap lets you south');
});

test('the plateau cliff blocks walking north at x=20, even at a slant', () => {
  assert.ok(walk(20, -60, 20, -76), 'straight up the cliff');
  assert.ok(walk(0, -62, 40, -76), 'slanting up the cliff');
  assert.ok(walk(100, -62, 70, -78), 'slanting up near the east edge');
});

test('the ramp at x=61 climbs from z=-60 to z=-86 onto the plateau', () => {
  assert.equal(walk(61, -60, 61, -86), null);
  assert.equal(walk(61, -86, 61, -60), null);
  assert.ok(heightAt(61, -60) < 3, 'ramp foot is low');
  assert.ok(Math.abs(heightAt(61, -86) - PLATEAU_Y) < 1.5, 'ramp top is on the plateau');
  assert.ok(Math.abs(heightAt(L.stone3[0], L.stone3[1]) - PLATEAU_Y) < 1.5, 'stone3 is on the plateau');
});

test('landmarks sit above the water, the swamp and pool are below it', () => {
  for (const k of ['tree', 'spawn', 'altar', 'stone1', 'stone2', 'stone3', 'clearing', 'ruins', 'pyramid']) {
    assert.ok(heightAt(...L[k]) > WATER_Y + 0.3, `${k} is dry (${heightAt(...L[k]).toFixed(2)})`);
  }
  for (const k of ['swamp', 'pool']) assert.ok(heightAt(...L[k]) < WATER_Y - 0.4, `${k} is under water`);
});

test('no stray water beside the paths, except the swamp and the pool', () => {
  const wet = [];
  for (let z = -116; z <= 94; z += 2) for (let x = -98; x <= 98; x += 2) {
    if (pathDist(x, z) > 12 || Math.hypot(x - L.pool[0], z - L.pool[1]) < 13 || Math.hypot(x - L.swamp[0], z - L.swamp[1]) < 30) continue;
    if (heightAt(x, z) < WATER_Y + 0.05) wet.push(`${x},${z}`);
  }
  assert.deepEqual(wet, []);
});

test('the Sub Toad sits on a rock islet in the pool', () => {
  const [x, z] = L.toad;
  assert.ok(heightAt(x, z) > WATER_Y + 0.4, 'the rock top is dry');
  assert.ok(heightAt(x, z) < WATER_Y + 1.5, 'but low, just above the water');
  assert.ok(heightAt(x - 5, z) < WATER_Y, 'the pool is around it');
});

test('the wizard can walk from the tree wound to the spawn without swimming deep', () => {
  const [tx, tz] = L.tree, [sx, sz] = L.spawn, d = Math.hypot(sx - tx, sz - tz);
  const wx = tx + ((sx - tx) / d) * 6.5, wz = tz + ((sz - tz) / d) * 6.5;
  assert.equal(walk(wx, wz, sx, sz), null);
  for (let k = 0; k <= 20; k++) assert.ok(heightAt(lerp(wx, sx, k / 20), lerp(wz, sz, k / 20)) > WATER_Y - 0.5, 'shallow enough');
  function lerp(a, b, t) { return a + (b - a) * t; }
});

test('heightAt is flat inside each ground triangle, so things placed on it sit on the mesh', () => {
  const { size, half } = GRID;
  for (const [i, j] of [[40, 70], [77, 30], [100, 12], [65, 64]]) {
    const x0 = -half + i * size, z0 = -half + j * size, x1 = x0 + size, z1 = z0 + size;
    const a = heightAt(x0, z0), b = heightAt(x0, z1), c = heightAt(x1, z1), d = heightAt(x1, z0);
    for (const [u, v] of [[0.2, 0.3], [0.5, 0.1], [0.7, 0.6], [0.9, 0.8]]) {
      const want = u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
      assert.ok(Math.abs(heightAt(x0 + u * size, z0 + v * size) - want) < 1e-9, `cell ${i},${j} at ${u},${v}`);
    }
  }
});

test('the world edge is a wall', () => {
  assert.ok(walk(90, 0, 105.5, 0), 'east cliff');
  assert.ok(walk(-90, 20, -105.5, 20), 'west cliff');
  assert.ok(walk(-60, 85, -60, 103.5), 'south cliff');
  assert.ok(walk(80, -105, 80, -123.5), 'north cliff behind the pyramid');
  assert.equal(canStep(104, 0, 108, 0), false);
  assert.equal(canStep(-104, 0, -108, 0), false);
  assert.equal(canStep(0, 102, 0, 110), false);
  assert.equal(canStep(0, -120, 0, -128), false);
});

test('colliders push circles and boxes out, and inactive boxes are ignored', () => {
  const c = createColliders();
  c.addCircle(0, 0, 1);
  const p = { x: 0.5, z: 0 };
  c.collide(p, 0.5);
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - 1.5) < 1e-9, 'pushed to the circle edge');
  assert.ok(p.x > 0 && Math.abs(p.z) < 1e-9, 'pushed straight away from the centre');

  // a circle near a spatial-hash cell border still catches a player in the next cell
  c.addCircle(7.4, 3, 0.5);
  const q = { x: 8.3, z: 3 };
  c.collide(q, 0.6);
  assert.ok(Math.abs(q.x - 8.5) < 1e-9, 'pushed out across the cell border');

  const box = c.addBox(20, 10, 24, 12, 'wall');
  assert.ok(c.boxes.includes(box) && box.active === true && box.id === 'wall');
  const b = { x: 22, z: 9.8 };
  c.collide(b, 0.5);
  assert.ok(Math.abs(b.z - 9.5) < 1e-9 && b.x === 22, 'pushed out of the box side');
  const inside = { x: 23.8, z: 11 };
  c.collide(inside, 0.5);
  assert.ok(Math.abs(inside.x - 24.5) < 1e-9, 'a centre inside the box leaves by the nearest side');

  assert.equal(c.blockedByBox(22, 11, 0.5), box);
  assert.equal(c.blockedByBox(22, 12.4, 0.5), box, 'the radius counts');
  assert.equal(c.blockedByBox(22, 12.6, 0.5), null);
  box.active = false;
  assert.equal(c.blockedByBox(22, 11, 0.5), null, 'inactive boxes do not block');
  const free = { x: 22, z: 11 };
  c.collide(free, 0.5);
  assert.deepEqual(free, { x: 22, z: 11 }, 'inactive boxes do not push');
});

test('the vine wall seals the ridge gap; burnt, the gap is open', () => {
  const c = createColliders();
  const box = c.addBox(...BOXES.vines, 'vines');
  const [x0, z0, x1, z1] = BOXES.vines;
  assert.ok(x0 < L.gate1[0] && x1 > L.gate1[0] && z0 < L.gate1[1] && z1 > L.gate1[1], 'the box is at the gap');
  assert.equal(crossing(c, 2, -24), null, 'no way around the vine wall');
  box.active = false;
  assert.ok(crossing(c, 2, -24), 'the burnt gap lets you north');
});

test('the cracked gate seals the ramp; broken, the plateau is reachable', () => {
  const c = createColliders();
  const box = c.addBox(...BOXES.cracked, 'cracked');
  const [x0, z0, x1, z1] = BOXES.cracked;
  assert.ok(x0 < L.gate2[0] && x1 > L.gate2[0] && z0 < L.gate2[1] && z1 > L.gate2[1], 'the box is on the ramp');
  assert.equal(crossing(c, -56, -82), null, 'no way around the cracked gate');
  box.active = false;
  assert.ok(crossing(c, -56, -82), 'the ramp leads up');
});

test('vegetation keeps off the paths and landmarks', () => {
  for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      assert.ok(keepClear(x, z), `path point ${x.toFixed(1)},${z.toFixed(1)}`);
      assert.ok(keepClear(x + 1.5, z) && keepClear(x, z - 1.5), 'path edges');
    }
  }
  for (const k of ['spawn', 'clearing', 'stone1', 'altar', 'gate1', 'stone2', 'gate2', 'stone3', 'pyramid']) assert.ok(keepClear(...L[k]), k);
  assert.equal(keepClear(-90, 20), false, 'the deep jungle can grow');
});
