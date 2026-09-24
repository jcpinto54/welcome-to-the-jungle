'use strict';
// Model showcase (tools/models.html): every model builds without console errors, stays inside its
// triangle budget, the wizard and creature APIs behave, and review screenshots are written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, shot } = require('./harness.cjs');

const PAGE = 'tools/models.html?frozen&ui=0';
const BUDGET = { wizard: 3000, moth: 200, warden: 800, panther: 1200, toad: 1600 };

// [screenshot name, MV.pose options]
const VIEWS = [
  ['wizard-front', { yaw: 0, dist: 5.5 }],
  ['wizard-34', { yaw: 0.7, dist: 5.5 }],
  ['wizard-side', { yaw: Math.PI / 2, dist: 5.5 }],
  ['wizard-back', { yaw: Math.PI, dist: 5.5 }],
  ['wizard-face', { yaw: 0.3, pitch: 0.02, dist: 1.7, target: [0, 2.1, 0.6] }],
  ['wizard-walk', { walk: true, secs: 2.3, yaw: 1.3, dist: 6 }],
  ['wizard-quake', { act: 'quake', actAt: 0.5, secs: 0.67, yaw: 1.1, dist: 7, target: [0, 2.2, 0] }],
  ['wizard-quake-slam', { act: 'quake', actAt: 0.5, secs: 0.8, yaw: 1.1, dist: 7 }],
  ['wizard-bolt', { act: 'bolt', actAt: 0.5, secs: 0.6, yaw: 1.2, dist: 6 }],
  ['wizard-emerge', { emerge: 0.45, secs: 0.5, yaw: 0.4, dist: 5 }],
  ['wizard-die', { act: 'die', actAt: 0.5, secs: 2.8, yaw: 0.8, pitch: 0.3, dist: 5, target: [0, 0.6, 0] }],
  ['lineup', { model: 'all', secs: 1, yaw: 0.2, pitch: 0.15, dist: 15, target: [0.7, 1.7, 0] }],
  ['moth', { model: 'moth', secs: 1.03, yaw: 0.5, pitch: 0.35, dist: 3 }],
  ['warden', { model: 'warden', secs: 6.1, yaw: 0.4, pitch: 0.2, dist: 8, target: [0, 1.8, 0] }],
  ['panther-roar', { model: 'panther', act: 'awaken', actOn: 'panther', actAt: 0.2, secs: 2, yaw: 1.2, dist: 6.5, target: [0, 2.8, 0] }],
  ['toad-croak', { model: 'toad', act: 'croak', actOn: 'toad', actAt: 0.2, secs: 0.6, yaw: 0.6, pitch: 0.2, dist: 5.5 }],
];

async function openModels(size) {
  const g = await openGame({ ...size, file: PAGE });
  await g.page.waitForFunction(() => window.MV && MV.ready, null, { timeout: 30000 });
  return g;
}

test('models page builds every model inside its budget, with no console errors', { timeout: 180000 }, async () => {
  const { browser, page, errors } = await openModels({ width: 1280, height: 720 });
  try {
    const stats = await page.evaluate(() => MV.stats());
    for (const [name, max] of Object.entries(BUDGET)) {
      assert.ok(stats[name], name + ' was built');
      assert.ok(stats[name].tris > 0 && stats[name].tris <= max, `${name}: ${stats[name].tris} triangles, budget ${max}`);
    }
    assert.ok(stats.wizard.meshes <= 6, 'the wizard stays a handful of draw calls, got ' + stats.wizard.meshes);
    assert.equal(stats.moth.meshes, 1, 'a moth is one draw call');
    for (const [name, opts] of VIEWS) {
      await page.evaluate((o) => MV.pose(o), opts);
      await shot(page, 'models-' + name);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('wizard: contract size, orb, light and every action', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openModels({ width: 640, height: 360 });
  try {
    const r = await page.evaluate(() => {
      MV.pose({ model: 'wizard', secs: 1 });
      const W = MV.models.wizard.obj, v = new THREE.Vector3();
      W.group.updateMatrixWorld(true);
      const body = W.parts.body;
      body.computeBoundingBox();
      const top = body.boundingBox.max.y, bottom = body.boundingBox.min.y;
      W.orbWorld(v);
      const orb = v.toArray();
      const acted = {};
      let t = 1;
      for (const a of ['stomp', 'bolt', 'quake', 'dash', 'hurt', 'talk']) {
        W.act(a);
        acted[a] = W.acting === a;
        for (let i = 0; i < 110; i++) W.update(1 / 60, { t: (t += 1 / 60), moving: i % 2 === 0, speed01: 1, songPos: t / 0.0882 });
        acted[a] = acted[a] && W.acting === null;
      }
      W.setOrbColor(0xff4fd8);
      W.update(1 / 60, { t: (t += 1 / 60) });
      const flash = W.parts.orb.material.color.getHex();
      const lightOn = W.light.isPointLight && W.light.intensity > 0;
      W.act('die');
      for (let i = 0; i < 150; i++) W.update(1 / 60, { t: (t += 1 / 60) });
      const dead = W.dead && W.parts.mound.visible;
      W.act('stomp');
      const ignoredWhileDead = W.acting === 'die';
      W.act('emerge');
      W.update(1 / 60, { t: (t += 1 / 60) });
      const emergeStart = W.dead === false && W.light.intensity < 1;
      for (let i = 0; i < 240; i++) W.update(1 / 60, { t: (t += 1 / 60) });
      W.setEmerge(0.3);
      W.update(1 / 60, { t: (t += 1 / 60) });
      W.group.updateMatrixWorld(true);
      const hips = W.bones.find((b) => b.name === 'root').getWorldPosition(new THREE.Vector3());
      W.setEmerge(1);
      W.update(1 / 60, { t: (t += 1 / 60) });
      const nan = W.bones.some((b) => !Number.isFinite(b.quaternion.x) || !Number.isFinite(b.position.y));
      return { top, bottom, orb, acted, flash, lightOn, dead, ignoredWhileDead, emergeStart, emergeZ: hips.z, nan };
    });
    assert.ok(r.top > 3.0 && r.top < 3.7, 'about 3.3 tall with the hat, got ' + r.top.toFixed(2));
    assert.ok(r.bottom > -0.2 && r.bottom < 0.1, 'feet on the ground, got ' + r.bottom.toFixed(2));
    assert.ok(r.orb[1] > 2.6 && r.orb[1] < 3.8, 'staff orb up near the hat, y = ' + r.orb[1].toFixed(2));
    for (const [a, ok] of Object.entries(r.acted)) assert.ok(ok, a + ' starts and finishes');
    assert.notEqual(r.flash, 0x7ff6ff, 'orb flashes the lane colour');
    assert.ok(r.lightOn, 'orb light is on');
    assert.ok(r.dead, 'die collapses into a moss mound');
    assert.ok(r.ignoredWhileDead, 'no spells while dead');
    assert.ok(r.emergeStart, 'emerge revives him, eyes and orb dark at first');
    assert.ok(r.emergeZ < -0.2, 'setEmerge(0.3) pulls him back into the trunk');
    assert.equal(r.nan, false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('creatures: moth dies in two hits, warden rings, spirits wake', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openModels({ width: 640, height: 360 });
  try {
    const r = await page.evaluate(() => {
      MV.reset('all');
      const scene = MV.models.wizard.group.parent;
      const moth = Creatures.moth(scene, 0, 2, -30);
      const env = { player: { x: 0, y: 0, z: -24 }, heightAt: () => 0, t: 0, pulse: 0, songPos: 0 };
      for (let i = 0; i < 60; i++) { env.t += 1 / 60; moth.update(1 / 60, env); }
      const hover = moth.pos.y;
      const first = moth.hit(1, new THREE.Vector3(0, 0, -24));
      const second = moth.hit(1, new THREE.Vector3(0, 0, -24));
      for (let i = 0; i < 120; i++) { env.t += 1 / 60; moth.update(1 / 60, env); }
      const warden = Creatures.warden(scene, 20, 0, -30);
      const wenv = { player: { x: 20, y: 0, z: -24 }, heightAt: () => 0, t: 0, pulse: 0, songPos: 0 };
      let rings = 0;
      for (let i = 0; i < 400; i++) { wenv.t += 1 / 60; wenv.songPos += 0.25; rings = Math.max(rings, warden.update(1 / 60, wenv).rings.length); }
      const visibleRings = scene.children.filter((o) => o.name === 'ring' && o.visible).length;
      const P = MV.models.panther.obj, T = MV.models.toad.obj;
      P.awaken(); T.croak();
      for (let i = 0; i < 60; i++) { P.update(1 / 60, i / 60, 0.5); T.update(1 / 60, i / 60, 0.5); }
      return { hover, first, second, gone: moth.gone, hidden: !moth.group.visible, alive: moth.alive, rings, visibleRings, awake: P.awake, croaking: T.croaking, wardenHp: warden.hp };
    });
    assert.ok(r.hover >= 1.5 && r.hover <= 2.5, 'moth hovers 1.5..2.5, got ' + r.hover);
    assert.equal(r.first, false);
    assert.equal(r.second, true, 'HP 2: the second hit kills');
    assert.equal(r.alive, false);
    assert.ok(r.gone && r.hidden, 'dead moth finishes its fall and hides');
    assert.equal(r.wardenHp, 12);
    assert.ok(r.rings >= 1, 'warden emits silence rings');
    assert.ok(r.visibleRings >= 1, 'rings are drawn');
    assert.ok(r.awake, 'panther awakens');
    assert.ok(r.croaking, 'toad croaks');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('models compile with the real World.ps1 (world.js loaded)', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openGame({ width: 640, height: 360, file: PAGE + '&world' });
  try {
    await page.waitForFunction(() => window.MV && MV.ready, null, { timeout: 30000 });
    const real = await page.evaluate(() => {
      MV.pose({ model: 'all', secs: 1 });
      MV.pose({ model: 'warden', secs: 6 }); // rings on screen
      MV.pose({ model: 'moth', act: 'stomp', actAt: 0.2, secs: 0.5 });
      return !World.stub && typeof World.build === 'function';
    });
    assert.ok(real, 'the page used the real World');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('phone view: the wizard from the game camera at 844x390', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openModels({ width: 844, height: 390 });
  try {
    const r = await page.evaluate(() => MV.pose({ model: 'wizard', secs: 1.2, yaw: Math.PI, pitch: 0.36, dist: 7, target: [0, 1.8, 0] }));
    assert.equal(r.rh, 195, 'renders 195 lines on a 390px-tall phone');
    await shot(page, 'models-phone-back');
    await page.evaluate(() => MV.pose({ model: 'wizard', walk: true, secs: 2.1, yaw: 2.5, pitch: 0.36, dist: 7, target: [0, 1.8, 0] }));
    await shot(page, 'models-phone-walk');
    await page.evaluate(() => MV.pose({ model: 'wizard', secs: 1, yaw: 0.35, pitch: 0.12, dist: 5, target: [0, 1.9, 0] }));
    await shot(page, 'models-phone-front');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
