'use strict';
// World smoke tests through tools/viewer.html: it builds, renders every landmark view inside the
// mobile budget (desktop and phone), keeps the World contract, and plays its visual actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, shot } = require('./harness.cjs');

// Camera views of the landmarks: [x, y, z, lookX, lookY, lookZ].
const VIEWS = {
  'swamp-tree': [-58, 5.5, 50, -74, 13, 70],
  'clearing-stone1': [-38, 5, 16, -26, 2, 1],
  'ruins-vine-gap': [13, 6, 12, 14, 4, -11],
  'hollow': [22, 6, -24, 30, 1, -38],
  'pool-falls-toad': [30, 6, -44, 36, 4, -64],
  'gate-ramp': [57.5, 5, -55, 61, 5, -71],
  'plateau-pyramid': [58, 15, -72, 90, 14, -102],
};
const BUDGET = { calls: 100, triangles: 250000 };

async function openViewer(opts = {}) {
  const r = await openGame({ file: 'tools/viewer.html' + (opts.q ? `?q=${opts.q}` : ''), ...opts });
  await r.page.waitForFunction(() => window.buildMs !== undefined, null, { timeout: 30000 });
  return r;
}

// Renders a view and samples the canvas in the same task (the WebGL buffer is not preserved).
function render(page, v, sat = 1) {
  return page.evaluate(([v, sat]) => {
    const stats = view(...v, sat);
    const c = document.createElement('canvas'); c.width = 96; c.height = 54;
    const x = c.getContext('2d'); x.drawImage(document.getElementById('c'), 0, 0, 96, 54);
    const d = x.getImageData(0, 0, 96, 54).data;
    let sum = 0, sq = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; sum += l; sq += l * l; n++; }
    return { ...stats, mean: sum / n, variance: sq / n - (sum / n) ** 2 };
  }, [v, sat]);
}

test('the viewer builds the jungle quickly and without console errors', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openViewer();
  try {
    const ms = await page.evaluate(() => window.buildMs);
    assert.ok(ms < 3000, `build took ${ms.toFixed(0)} ms`);
    const r = await render(page, VIEWS['swamp-tree']);
    assert.ok(r.variance > 50, `the canvas is not blank (variance ${r.variance.toFixed(1)})`);
    assert.equal(r.height, 240, 'a 720px screen renders 240 lines');
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('every landmark view renders inside the mobile budget', { timeout: 120000 }, async () => {
  const { browser, page, errors } = await openViewer();
  try {
    for (const [name, v] of Object.entries(VIEWS)) {
      const r = await render(page, v);
      await shot(page, `world-${name}`);
      assert.ok(r.variance > 50 && r.mean > 12 && r.mean < 200, `${name} shows something (mean ${r.mean.toFixed(1)}, variance ${r.variance.toFixed(1)})`);
      assert.ok(r.calls < BUDGET.calls, `${name}: ${r.calls} draw calls`);
      assert.ok(r.triangles < BUDGET.triangles, `${name}: ${r.triangles} triangles`);
    }
    const grey = await render(page, VIEWS['clearing-stone1'], 0.1);
    await shot(page, 'world-grey-start');
    assert.ok(grey.variance > 40, `the grey start still reads (variance ${grey.variance.toFixed(1)})`);
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('a landscape phone on low quality renders every view at 195 lines', { timeout: 120000 }, async () => {
  const { browser, page, errors } = await openViewer({ width: 844, height: 390, q: 'low' });
  try {
    assert.equal(await page.evaluate(() => World.quality), 'low');
    for (const [name, v] of Object.entries(VIEWS)) {
      const r = await render(page, v);
      await shot(page, `world-phone-${name}`);
      assert.equal(r.height, 195, 'integer upscale of a 390px screen');
      assert.ok(r.variance > 50, `${name} shows something on a phone`);
      assert.ok(r.calls < BUDGET.calls && r.triangles < BUDGET.triangles * 0.6, `${name}: ${r.calls} calls, ${r.triangles} triangles`);
    }
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('World keeps its contract', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openViewer();
  try {
    const c = await page.evaluate(() => {
      const W = World, T = Terrain, s = W.stones;
      return {
        colliders: ['addCircle', 'addBox', 'collide', 'blockedByBox'].every((k) => typeof W.colliders[k] === 'function') && Array.isArray(W.colliders.boxes),
        stones: s.length === 3 && s.every((st, i) => st.key === 'stone' + (i + 1) && st.group.isObject3D && Array.isArray(st.runeMats) && st.notches.isInstancedMesh && st.glow.isObject3D && st.carved === false && Number.isFinite(st.y)),
        vines: W.vineWall.alive && W.vineWall.hp > 0 && W.vineWall.box.active && W.vineWall.mesh.isObject3D && W.vineWall.x === T.L.gate1[0],
        gate: W.crackedGate.alive && W.crackedGate.box.active && W.crackedGate.group.isObject3D && W.crackedGate.blocks.length > 0 && W.crackedGate.z === T.L.gate2[1],
        pyramid: W.pyramid.group.isObject3D && W.pyramid.doorWorld.isVector3 && W.pyramid.open === false,
        doorFree: !W.colliders.blockedByBox(W.pyramid.doorWorld.x, W.pyramid.doorWorld.z, 0.5),
        tree: W.tree.group.isObject3D && W.tree.wound.isObject3D && W.tree.woundMat.isMaterial && W.tree.woundGlow.isObject3D,
        woundFacesSpawn: (() => {
          const v = W.tree.wound.getWorldPosition(new THREE.Vector3()), [tx, tz] = T.L.tree, [sx, sz] = T.L.spawn;
          const r = Math.hypot(v.x - tx, v.z - tz), cos = ((v.x - tx) * (sx - tx) + (v.z - tz) * (sz - tz)) / (r * Math.hypot(sx - tx, sz - tz));
          return r > 2.5 && r < 6 && cos > 0.95 && v.y > T.heightAt(tx, tz);
        })(),
        altarTop: Number.isFinite(W.altarTop) && W.altarTop > T.heightAt(...T.L.altar),
        fireflies: W.fireflies.length > 20 && W.fireflies.every((f) => [f.x, f.y, f.z].every(Number.isFinite) && f.taken === false),
        firefliesReachable: W.fireflies.every((f) => {
          const p = { x: f.x, z: f.z };
          W.colliders.collide(p, 0.5);
          return p.x === f.x && p.z === f.z && T.slopeAt(f.x, f.z) <= T.MAX_SLOPE && T.pathDist(f.x, f.z) <= 4.2 && f.y - Math.max(T.heightAt(f.x, f.z), T.WATER_Y) < 3;
        }),
        moths: W.mothSpawns.length > 5 && W.mothSpawns.every((m) => m.length === 2),
        fns: ['update', 'ps1', 'carveStone', 'updateStones', 'burnVines', 'breakGate', 'openPyramid', 'bounceMushrooms'].every((k) => typeof W[k] === 'function'),
        snap: W.SNAP.value.isVector2 && typeof W.TIME.value === 'number',
      };
    });
    for (const [k, ok] of Object.entries(c)) assert.ok(ok, k);
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('the visual actions play out: carve, loop, burn, break, open, bounce', { timeout: 90000 }, async () => {
  const { browser, page, errors } = await openViewer();
  try {
    await render(page, VIEWS['clearing-stone1']);
    const notch = await page.evaluate(() => {
      const snap = { song: { kick: Array(32).fill(0), snare: Array(32).fill(0), bass: Array(32).fill(0) }, draft: { kick: Array(32).fill(false), snare: Array(32).fill(false), bass: Array(32).fill(false) } };
      snap.song.kick[0] = 1; snap.draft.snare[4] = true;
      World.updateStones(snap, 16, 0);
      const n = World.stones[0].notches, c = new THREE.Color(), get = (i) => (n.getColorAt(i, c), c.clone());
      return { carved: get(0), draft: get(32 + 4), empty: get(2), head: get(16) };
    });
    assert.ok(notch.carved.r > notch.empty.r * 3, 'a carved kick lights its notch');
    assert.ok(notch.draft.r > notch.empty.r && notch.draft.r < notch.carved.r * 1.5, 'a draft snare is lit but dimmer');
    assert.ok(notch.head.b > notch.empty.b * 2, 'the playhead shows');

    await page.evaluate(() => { World.carveStone(0); tick(0.3); });
    assert.ok(await page.evaluate(() => World.stones[0].carved && World.stones[0].glow.visible && World.stones[0].glow.material.opacity > 0.3), 'the carved stone glows');
    await shot(page, 'world-act-carve');

    await render(page, VIEWS['ruins-vine-gap']);
    await page.evaluate(() => { World.burnVines(); tick(0.6); });
    await shot(page, 'world-act-burn');
    assert.ok(await page.evaluate(() => !World.vineWall.alive && !World.vineWall.box.active), 'burnt vines open the gap');
    await page.evaluate(() => tick(1.5));
    assert.equal(await page.evaluate(() => World.vineWall.mesh.visible), false, 'the vines are gone');

    await render(page, VIEWS['gate-ramp']);
    const before = await page.evaluate(() => World.crackedGate.blocks.map((b) => b.p.clone()));
    await page.evaluate(() => { World.breakGate(); tick(0.35); });
    await shot(page, 'world-act-break');
    const moved = await page.evaluate((b0) => World.crackedGate.blocks.filter((b, i) => b.p.distanceTo(new THREE.Vector3(b0[i].x, b0[i].y, b0[i].z)) > 1).length, before);
    assert.ok(moved >= 8, `the blocks fly apart (${moved} moved)`);
    assert.ok(await page.evaluate(() => !World.crackedGate.alive && !World.crackedGate.box.active), 'the ramp opens');

    await render(page, VIEWS['plateau-pyramid']);
    const doorY = await page.evaluate(() => World.pyramid.door.position.y);
    await page.evaluate(() => { World.openPyramid(); tick(3.2); });
    await shot(page, 'world-act-open');
    const p = await page.evaluate(() => ({ open: World.pyramid.open, y: World.pyramid.door.position.y, beam: World.pyramid.beam.visible && World.pyramid.beam.material.opacity > 0.1 }));
    assert.ok(p.open && p.y < doorY - 4 && p.beam, 'the door sinks and the beam rises');

    await page.evaluate(() => World.bounceMushrooms(1));
    assert.ok(await page.evaluate(() => World.mushrooms.bounce > 0.9), 'mushrooms bounce to the kick');
    await page.evaluate(() => tick(1));
    assert.ok(await page.evaluate(() => World.mushrooms.bounce < 0.1), 'and settle');

    // the game may only flip the flags; the world follows
    await page.evaluate(() => { World.stones[1].carved = true; tick(0.2); });
    assert.ok(await page.evaluate(() => World.stones[1].glow.visible), 'setting carved lights the stone');
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});
