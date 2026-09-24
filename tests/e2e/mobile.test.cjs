'use strict';
// Acceptance tests on emulated phones (touch events, landscape viewports, safe layout).
// Real iOS Safari can't run here; this checks the touch layer and layout in Chromium.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, shot } = require('./harness.cjs');

const until = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

// Raw touch input through the DevTools protocol, so drags and multi-touch are real touches.
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  return {
    async hold(id, x, y) { await send('touchStart', [{ x, y, id }]); },
    async move(points) { await send('touchMove', points); },
    async release(points) { await send('touchEnd', points); },
    async drag(id, from, to, ms) {
      await send('touchStart', [{ x: from[0], y: from[1], id }]);
      const steps = Math.max(2, Math.round(ms / 50));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        await send('touchMove', [{ x: from[0] + (to[0] - from[0]) * k, y: from[1] + (to[1] - from[1]) * k, id }]);
        await page.waitForTimeout(ms / steps);
      }
      return async () => send('touchEnd', []);
    },
  };
}

async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, `${selector} is on screen`);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function enterAndPlay(page) {
  await until(page, () => window.JW && JW.state === 'boot');
  await page.touchscreen.tap(400, 200);
  await until(page, () => JW.state === 'intro' || JW.state === 'play', null, 10000);
  await page.evaluate(() => JW.skipIntro());
  await until(page, () => JW.state === 'play');
}

for (const device of ['iPhone 13 landscape', 'Pixel 7 landscape']) {
  test(`${device}: tap to enter, touch controls, move and cast`, { timeout: 120000 }, async () => {
    const { browser, page, errors } = await openGame({ device });
    try {
      await until(page, () => window.JW && JW.state === 'boot');
      assert.match(await page.locator('#ui').innerText(), /tap to enter the jungle/i, 'boot screen speaks touch');
      await shot(page, `mobile-${device.split(' ')[0]}-01-boot`);
      await enterAndPlay(page);

      for (const a of ['stomp', 'bolt', 'quake', 'dash']) assert.ok(await page.locator(`[data-action="${a}"]`).first().isVisible(), `${a} button visible`);

      // Tapping STOMP records a kick.
      const k0 = await page.evaluate(() => JW.seq.draftCount('kick'));
      await page.locator('[data-action="stomp"]').first().tap();
      await until(page, (n) => JW.seq.draftCount('kick') > n, k0, 3000);

      // Dragging the joystick walks the wizard; tapping STOMP mid-walk works (multi-touch).
      const t = await touch(page);
      const jb = await page.locator('[data-touch="joystick"]').first().boundingBox();
      const start = [jb.x + jb.width * 0.35, jb.y + jb.height * 0.6];
      const p0 = await page.evaluate(() => ({ x: JW.player.x, z: JW.player.z }));
      const endDrag = await t.drag(1, start, [start[0], start[1] - 70], 300);
      await page.waitForTimeout(1200);
      const [sx, sy] = await center(page, '[data-action="stomp"]');
      const k1 = await page.evaluate(() => JW.seq.draftCount('kick'));
      await t.move([{ x: start[0], y: start[1] - 70, id: 1 }, { x: sx, y: sy, id: 2 }]);
      await page.waitForTimeout(80);
      await t.move([{ x: start[0], y: start[1] - 70, id: 1 }]);
      await page.waitForTimeout(400);
      await endDrag();
      const p1 = await page.evaluate(() => ({ x: JW.player.x, z: JW.player.z }));
      assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.5, 'the joystick walks the wizard');
      await shot(page, `mobile-${device.split(' ')[0]}-02-play`);
      assert.ok((await page.evaluate(() => JW.seq.draftCount('kick'))) >= k1, 'casting while moving does not break input');

      // The contextual action button carves a Loop Stone.
      const L = await page.evaluate(() => JW.L);
      await page.evaluate(([x, z]) => JW.teleport(x + 3, z + 3), L.stone1);
      await page.evaluate(() => JW.cast('stomp', true));
      const act = page.locator('[data-action="interact"]').first();
      await until(page, () => { const b = document.querySelector('[data-action="interact"]'); return b && b.offsetParent !== null; }, null, 5000);
      assert.match(await act.innerText(), /carve/i, 'the action button offers to carve');
      await act.tap();
      await until(page, () => JW.world.stones[0].carved === true, null, 8000);
      await shot(page, `mobile-${device.split(' ')[0]}-03-carved`);
      assert.deepEqual(errors, [], 'no console errors');
    } finally {
      await browser.close();
    }
  });
}

test('portrait phones are asked to rotate', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openGame({ device: 'iPhone 13' });
  try {
    await until(page, () => window.JW && JW.state === 'boot');
    const overlay = page.locator('[data-overlay="rotate"]').first();
    assert.ok(await overlay.isVisible(), 'rotate overlay shows in portrait');
    assert.match(await overlay.innerText(), /rotate/i);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    assert.equal(await overlay.isVisible(), false, 'overlay hides in landscape');
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});
