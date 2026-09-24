'use strict';
// Acceptance tests for the whole game, driven through the window.JW test hook
// (see docs/ARCHITECTURE.md). They play the critical path from boot to the end screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, shot } = require('./harness.cjs');

const until = async (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const state = (page) => page.evaluate(() => JW.state);

async function pixelVariance(page) {
  return page.evaluate(() => {
    const src = document.getElementById('screen');
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data;
    let sum = 0, sq = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; sum += l; sq += l * l; n++; }
    return sq / n - (sum / n) ** 2;
  });
}

// Moves to a spot next to (x, z) so interact() can reach whatever is there.
async function goNear(page, x, z, off = 3) {
  await page.evaluate(([x, z, off]) => JW.teleport(x + off, z + off), [x, z, off]);
  await page.waitForTimeout(150);
}

test('boot screen, intro and the jungle render without errors', { timeout: 120000 }, async () => {
  const { browser, page, errors } = await openGame();
  try {
    await until(page, () => window.JW && JW.state === 'boot');
    const bootText = await page.locator('#ui').innerText();
    assert.match(bootText, /enter the jungle/i, 'boot screen invites you in');
    await shot(page, 'game-01-boot');

    await page.mouse.click(640, 360);
    await until(page, () => JW.state === 'intro', null, 10000);
    await page.waitForTimeout(1800);
    await shot(page, 'game-02-intro');
    await until(page, () => JW.state === 'play', null, 30000);

    const f0 = await page.evaluate(() => JW.frames);
    await page.waitForTimeout(800);
    assert.ok((await page.evaluate(() => JW.frames)) > f0, 'render loop is running');
    assert.ok((await pixelVariance(page)) > 20, 'the jungle is not a blank screen');
    await shot(page, 'game-03-spawn');
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('walking moves the wizard, stomping writes kicks into the draft', { timeout: 90000 }, async () => {
  const { browser, page, errors } = await openGame();
  try {
    await until(page, () => window.JW && JW.state === 'boot');
    await page.evaluate(() => JW.start());
    await page.evaluate(() => JW.skipIntro());
    await until(page, () => JW.state === 'play');

    const p0 = await page.evaluate(() => ({ x: JW.player.x, z: JW.player.z }));
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    const p1 = await page.evaluate(() => ({ x: JW.player.x, z: JW.player.z }));
    assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, 'W walks forward');

    const before = await page.evaluate(() => JW.seq.draftCount('kick'));
    const res = await page.evaluate(() => JW.cast('stomp', true));
    assert.equal(res.onBeat, true, 'an on-beat stomp is in the pocket');
    await page.waitForTimeout(400);
    await page.evaluate(() => JW.cast('stomp', true));
    assert.ok((await page.evaluate(() => JW.seq.draftCount('kick'))) > before, 'kicks land in the draft');

    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('the critical path: carve, spirits, gates, pyramid, end screen', { timeout: 240000 }, async () => {
  const { browser, page, errors } = await openGame();
  try {
    await until(page, () => window.JW && JW.state === 'boot');
    await page.evaluate(() => JW.start());
    await page.evaluate(() => JW.skipIntro());
    await until(page, () => JW.state === 'play');
    const L = await page.evaluate(() => JW.L);

    // Loop Stone I: record kicks, carve, colour comes back.
    const sat0 = await page.evaluate(() => JW.sat());
    await goNear(page, L.stone1[0], L.stone1[1]);
    for (let i = 0; i < 3; i++) { await page.evaluate(() => JW.cast('stomp', true)); await page.waitForTimeout(360); }
    await page.evaluate(() => JW.interact());
    await until(page, () => JW.world.stones[0].carved === true, null, 8000);
    if ((await state(page)) === 'book') await page.evaluate(() => JW.closeBook());
    assert.ok((await page.evaluate(() => JW.seq.songCount('kick'))) >= 1, 'kicks carved into the song');
    await page.waitForTimeout(2500);
    assert.ok((await page.evaluate(() => JW.sat())) > sat0 + 0.1, 'carving brings colour back');
    await shot(page, 'game-04-stone1-carved');

    // Panther Spirit: talk until the snare is yours.
    await goNear(page, L.altar[0], L.altar[1], 3.5);
    await page.evaluate(() => JW.interact());
    await until(page, () => JW.state === 'dialogue', null, 5000);
    await shot(page, 'game-05-panther-dialogue');
    for (let i = 0; i < 12 && (await state(page)) === 'dialogue'; i++) { await page.evaluate(() => JW.advance()); await page.waitForTimeout(250); }
    await until(page, () => JW.state === 'play' && JW.abilities.bolt.unlocked, null, 8000);

    // Vine wall: three bolts burn it.
    await goNear(page, L.gate1[0], L.gate1[1] + 7, 0);
    for (let i = 0; i < 4 && (await page.evaluate(() => JW.world.vineWall.alive)); i++) {
      await page.evaluate(([x, z]) => { JW.aimAt(x, JW.world.vineWall.mesh.position.y, z); return JW.cast('bolt', true); }, L.gate1);
      await page.waitForTimeout(900);
    }
    assert.equal(await page.evaluate(() => JW.world.vineWall.alive), false, 'bolts burn the vine wall');
    assert.equal(await page.evaluate(() => JW.world.vineWall.box.active), false, 'the passage opens');

    // The rest of the path, with both spirits' gifts.
    await page.evaluate(() => JW.unlockAll());
    await goNear(page, L.gate2[0], L.gate2[1] + 5, 0);
    await page.evaluate(([x, z]) => { JW.aimAt(x, 5, z); return JW.cast('quake', true); }, L.gate2);
    await until(page, () => JW.world.crackedGate.alive === false, null, 6000);
    assert.equal(await page.evaluate(() => JW.world.crackedGate.box.active), false, 'the ramp opens');

    for (const [i, key] of [[1, 'stone2'], [2, 'stone3']]) {
      await goNear(page, L[key][0], L[key][1]);
      for (const spell of ['stomp', 'bolt', 'quake']) { await page.evaluate((s) => JW.cast(s, true), spell); await page.waitForTimeout(380); }
      await page.evaluate(() => JW.interact());
      await until(page, (n) => JW.world.stones[n].carved === true, i, 8000);
      if ((await state(page)) === 'book') await page.evaluate(() => JW.closeBook());
    }
    const full = await page.evaluate(() => JW.seq.hasFullGroove());
    assert.equal(full, true, 'kick, snare and bass are all carved');
    await shot(page, 'game-06-plateau');

    // The Lost Pyramid opens for a full groove and ends the song.
    const door = await page.evaluate(() => { const d = JW.world.pyramid.doorWorld; return [d.x, d.z]; });
    await page.evaluate(([x, z]) => JW.teleport(x, z), door);
    await page.waitForTimeout(300);
    await page.evaluate(() => JW.interact());
    await until(page, () => JW.state === 'finale' || JW.state === 'end', null, 8000);
    await until(page, () => JW.state === 'end', null, 30000);
    await shot(page, 'game-07-end');
    assert.match(await page.locator('#ui').innerText(), /keep jamming/i, 'end screen offers to keep jamming');
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});

test('the spellbook edits the carved song', { timeout: 90000 }, async () => {
  const { browser, page, errors } = await openGame();
  try {
    await until(page, () => window.JW && JW.state === 'boot');
    await page.evaluate(() => JW.start());
    await page.evaluate(() => JW.skipIntro());
    await until(page, () => JW.state === 'play');
    await page.evaluate(() => JW.openBook());
    await until(page, () => JW.state === 'book', null, 4000);
    const n0 = await page.evaluate(() => JW.seq.songCount('kick'));
    const cell = page.locator('[data-lane="kick"][data-step="0"]').first();
    await cell.click();
    assert.equal(await page.evaluate(() => JW.seq.songCount('kick')), n0 + 1, 'clicking a cell adds a hit');
    await shot(page, 'game-08-spellbook');
    await page.evaluate(() => JW.closeBook());
    await until(page, () => JW.state === 'play', null, 4000);
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});
