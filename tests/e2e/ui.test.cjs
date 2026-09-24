'use strict';
// Browser tests for the DOM UI (ui.js, style.css) and the touch layer (input.js), driven
// through the gallery page tools/ui.html, which renders every UI state from mock data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, shot } = require('./harness.cjs');

const GALLERY = 'tools/ui.html';
const STATES = ['hud', 'hud-start', 'hud-late', 'zone', 'dialogue', 'book', 'boot', 'intro', 'title', 'pause', 'end'];

// Switches the gallery to a state (the page rebuilds the UI on hashchange).
async function visit(page, state, wait = 350) {
  await page.evaluate((s) => { location.hash = s; }, state);
  await page.waitForFunction((s) => window.galleryState === s, state);
  await page.waitForTimeout(wait);
}

const visible = (page, sel) => page.locator(sel).first().isVisible();
const box = (page, sel) => page.locator(sel).first().boundingBox();
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Raw touches through the DevTools protocol, so drags and multi-touch are real touch events.
async function touches(page) {
  const cdp = await page.context().newCDPSession(page);
  return (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

test('desktop: every gallery state renders without console errors', { timeout: 90000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY });
  try {
    for (const s of STATES) {
      await visit(page, s, s.startsWith('intro') || s === 'title' ? 1300 : 400);
      await shot(page, `ui-desktop-${s}`);
      assert.deepEqual(errors, [], `no console errors in ${s}`);
    }
    await visit(page, 'boot');
    assert.match(await page.locator('#ui').innerText(), /click to enter the jungle/i);
    await visit(page, 'end');
    assert.match(await page.locator('#ui').innerText(), /keep jamming/i);
    assert.match(await page.locator('#ui').innerText(), /play again/i);
    await visit(page, 'pause');
    assert.match(await page.locator('#ui').innerText(), /click to resume/i);
    await visit(page, 'dialogue');
    assert.match(await page.locator('.jw-dialog').innerText(), /PANTHER SPIRIT/);
  } finally {
    await browser.close();
  }
});

test('desktop: key hints and crosshair, no touch layer', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY });
  try {
    await visit(page, 'hud');
    assert.equal(await page.evaluate(() => Input.isTouch), false);
    assert.ok(await visible(page, '.jw-cross'), 'crosshair');
    for (const key of ['SPACE', 'LMB', 'RMB', 'SHIFT']) assert.ok(await visible(page, `.jw-ab-key:text("${key}")`), `${key} hint`);
    assert.ok(await visible(page, '.jw-prompt .jw-key'), 'E keycap on the prompt');
    for (const a of ['stomp', 'bolt', 'quake', 'dash', 'book']) assert.equal(await visible(page, `[data-action="${a}"]`), false, `no ${a} touch button`);
    assert.equal(await visible(page, '[data-touch="joystick"]'), false);
    assert.equal(await visible(page, '[data-overlay="rotate"]'), false, 'no rotate screen on desktop');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('desktop: 1920x1080 scales the whole HUD up in whole pixel steps', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY, width: 1920, height: 1080 });
  try {
    await visit(page, 'hud');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '24px');
    const deck = await box(page, '.jw-deck');
    assert.ok(deck.width > 1200 * 0.7 * 1.2 && deck.y + deck.height <= 1080, 'the deck grew and still fits');
    await shot(page, 'ui-1080-hud');
    await visit(page, 'book');
    await shot(page, 'ui-1080-book');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('spellbook: clicking a cell calls toggle with its lane and step', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY });
  try {
    await visit(page, 'book');
    assert.equal(await page.evaluate(() => UI.bookOpen), true);
    const cell = page.locator('[data-lane="snare"][data-step="6"]').first();
    assert.equal(await cell.getAttribute('data-s'), '0');
    await cell.click();
    assert.deepEqual(await page.evaluate(() => calls), [['toggle', 'snare', 6]]);
    assert.equal(await cell.getAttribute('data-s'), '2', 'the cell repaints as carved');
    assert.equal(await cell.getAttribute('aria-pressed'), 'true');

    await page.locator('[data-lane="kick"][data-step="31"]').first().click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), ['toggle', 'kick', 31]);

    // Bass is still locked in this state (no Sub Toad yet): its runes do nothing.
    await page.locator('[data-lane="bass"][data-step="0"]').first().click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), ['toggle', 'kick', 31], 'locked lane ignores clicks');

    await page.locator('[data-clear="kick"]').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), ['clearLane', 'kick']);
    assert.equal(await page.locator('.jw-bg-row[data-l="kick"] [data-s="2"]').count(), 0, 'kick lane cleared');

    await page.locator('.jw-close').click();
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), ['close']);
    assert.equal(await page.evaluate(() => UI.bookOpen), false);
    assert.equal(await visible(page, '.jw-book'), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('UI.update with an unchanged hud writes nothing to the DOM', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY });
  try {
    for (const s of ['hud', 'hud-late', 'book']) {
      await visit(page, s);
      const counts = await page.evaluate((state) => {
        const src = state === 'hud-late' ? HUD.late : HUD.mid;
        const clone = () => JSON.parse(JSON.stringify(src)); // a new object each frame, like the game makes
        const ui = document.getElementById('ui');
        UI.update(clone());
        const mo = new MutationObserver(() => {});
        mo.observe(ui, { subtree: true, childList: true, attributes: true, characterData: true });
        UI.update(clone());
        const same = mo.takeRecords().length;
        const next = clone();
        next.fireflies += 1; next.step = (next.step + 1) % 32; next.beat01 = 0; next.abilities.dash.cd01 = 0.2;
        UI.update(next);
        const changed = mo.takeRecords().length;
        mo.disconnect();
        return { same, changed };
      }, s);
      assert.equal(counts.same, 0, `${s}: second identical update touches nothing`);
      assert.ok(counts.changed > 0, `${s}: a real change is written`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('reduced motion: no shaking words, dialogue lines appear at once', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(page, 'intro');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.jw-slam')).animationName), 'none');
    await visit(page, 'hud');
    const text = await page.evaluate(() => {
      UI.dialogue('THE EYE 眼', ['Enter, Jungle Wizard. Bring the drop.'], () => {});
      return document.querySelector('.jw-dlg-on').textContent;
    });
    assert.equal(text, 'Enter, Jungle Wizard. Bring the drop.');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

for (const device of ['iPhone 13 landscape', 'Pixel 7 landscape']) {
  const tag = device.split(' ')[0].toLowerCase();

  test(`${device}: the touch layout fits and stays tappable`, { timeout: 90000 }, async () => {
    const { browser, page, errors } = await openGame({ file: GALLERY, device });
    try {
      const vp = page.viewportSize();
      await visit(page, 'boot');
      assert.match(await page.locator('#ui').innerText(), /tap to enter the jungle/i);
      await shot(page, `ui-${tag}-boot`);

      await visit(page, 'hud');
      assert.equal(await page.evaluate(() => Input.isTouch), true);
      for (const a of ['stomp', 'bolt', 'quake', 'dash', 'interact', 'book', 'pause', 'mute']) {
        const b = await box(page, `[data-action="${a}"]`);
        assert.ok(b, `${a} button on screen`);
        assert.ok(b.width >= 44 && b.height >= 44, `${a} is at least 44px (${b.width}x${b.height})`);
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, `${a} inside the viewport`);
      }
      const stomp = await box(page, '[data-action="stomp"]'), bolt = await box(page, '[data-action="bolt"]');
      assert.ok(stomp.width > bolt.width, 'STOMP is the biggest button');
      assert.equal(await visible(page, '.jw-cross'), false, 'no crosshair on touch');
      assert.equal(await visible(page, '.jw-abil'), false, 'no key-hint ability bar on touch');
      const strip = await box(page, '.jw-strip');
      assert.ok(strip.x >= 0 && strip.x + strip.width <= vp.width && strip.y + strip.height <= vp.height, 'loop strip fits');
      for (const a of ['stomp', 'bolt', 'quake', 'dash', 'interact']) assert.ok(!overlap(strip, await box(page, `[data-action="${a}"]`)), `strip clear of ${a}`);
      const quest = await box(page, '.jw-quest'), status = await box(page, '.jw-status'), sys = await box(page, '.jw-sys');
      assert.ok(!overlap(quest, sys) && !overlap(quest, status), 'top bar pieces do not collide');
      await shot(page, `ui-${tag}-hud`);

      for (const s of ['dialogue', 'book', 'end', 'pause', 'hud-late']) {
        await visit(page, s);
        await shot(page, `ui-${tag}-${s}`);
      }
      await visit(page, 'end');
      for (const sel of ['[data-ui="jam"]', '[data-ui="replay"]']) {
        const b = await box(page, sel);
        assert.ok(b.height >= 44 && b.y + b.height <= vp.height, `${sel} tappable and on screen`);
      }
      await visit(page, 'book');
      const cell = await box(page, '[data-lane="kick"][data-step="0"]');
      assert.ok(cell.height >= 44, 'spellbook runes are thumb-sized');
      await page.locator('[data-lane="snare"][data-step="2"]').first().tap();
      assert.deepEqual(await page.evaluate(() => calls.at(-1)), ['toggle', 'snare', 2]);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}

test('touch input: joystick, look drag, multi-touch spells and taps that advance', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY, device: 'iPhone 13 landscape' });
  try {
    await visit(page, 'hud');
    const send = await touches(page);
    await page.evaluate(() => { Input.consume(); Input.consumeLook(); });

    // Thumb down on the left half, push up: full speed forward.
    const jz = await box(page, '[data-touch="joystick"]');
    const start = [jz.x + jz.width * 0.35, jz.y + jz.height * 0.6];
    await send('touchStart', [{ x: start[0], y: start[1], id: 1 }]);
    await send('touchMove', [{ x: start[0], y: start[1] - 70, id: 1 }]);
    let move = await page.evaluate(() => Input.move);
    assert.ok(move.y > 0.95 && Math.abs(move.x) < 0.05, `stick forward ${JSON.stringify(move)}`);
    assert.ok(await visible(page, '.jw-stick.is-live'), 'the stick floats under the thumb');

    // Second finger on STOMP while walking: a stomp with a real timestamp, and no camera turn.
    const [sx, sy] = await page.evaluate(() => { const r = document.querySelector('[data-action="stomp"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    const before = await page.evaluate(() => performance.now());
    await send('touchMove', [{ x: start[0], y: start[1] - 70, id: 1 }, { x: sx, y: sy, id: 2 }]);
    await send('touchMove', [{ x: start[0], y: start[1] - 70, id: 1 }]);
    const presses = await page.evaluate(() => Input.consume());
    assert.deepEqual(presses.map((p) => p.action), ['stomp']);
    assert.ok(presses[0].t >= before - 50 && presses[0].t <= (await page.evaluate(() => performance.now())), 'press time is on the performance clock');
    assert.deepEqual(await page.evaluate(() => Input.consumeLook()), { dx: 0, dy: 0 }, 'a button press never turns the camera');
    move = await page.evaluate(() => Input.move);
    assert.ok(move.y > 0.95, 'still walking after the stomp');
    await send('touchEnd', []);
    assert.deepEqual(await page.evaluate(() => Input.move), { x: 0, y: 0 }, 'letting go stops');

    // Drag on the right half turns the camera.
    const lz = await box(page, '[data-touch="look"]');
    const lx = lz.x + lz.width * 0.4, ly = lz.y + lz.height * 0.3;
    await send('touchStart', [{ x: lx, y: ly, id: 3 }]);
    await send('touchMove', [{ x: lx + 40, y: ly + 10, id: 3 }]);
    await send('touchEnd', []);
    const look = await page.evaluate(() => Input.consumeLook());
    assert.ok(look.dx > 40 && look.dy > 0, `look drag ${JSON.stringify(look)}`);

    // The contextual action button comes and goes.
    await page.evaluate(() => Input.setInteract(null));
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="interact"]').offsetParent), null);
    await page.evaluate(() => Input.setInteract('TALK'));
    assert.equal(await page.locator('[data-action="interact"]').innerText(), 'TALK');
    await page.locator('[data-action="interact"]').tap();
    await page.locator('[data-action="book"]').tap();
    assert.deepEqual((await page.evaluate(() => Input.consume())).map((p) => p.action), ['interact', 'book']);

    // In a dialogue the spells hide and a tap anywhere advances.
    await page.evaluate(() => Input.setMode('dialogue'));
    assert.equal(await visible(page, '[data-action="stomp"]'), false);
    await page.touchscreen.tap(200, 150);
    assert.deepEqual((await page.evaluate(() => Input.consume())).map((p) => p.action), ['advance']);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('portrait phones get the rotate screen, landscape does not', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openGame({ file: GALLERY, device: 'iPhone 13' });
  try {
    await visit(page, 'boot');
    const overlay = page.locator('[data-overlay="rotate"]').first();
    assert.ok(await overlay.isVisible());
    assert.match(await overlay.innerText(), /rotate your phone/i);
    await shot(page, 'ui-portrait-rotate');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    assert.equal(await overlay.isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
