'use strict';
// The shareable single-file build boots and plays like index.html does.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { openGame, shot, ROOT } = require('./harness.cjs');

test('the single-file build boots into play without errors', { timeout: 120000 }, async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-artifact.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const { browser, page, errors } = await openGame({ file: 'dist/jungle-wizard.standalone.html' });
  try {
    await page.waitForFunction(() => window.JW && JW.state === 'boot', null, { timeout: 30000 });
    assert.match(await page.locator('#ui').innerText(), /enter the jungle/i);
    await page.evaluate(() => JW.start());
    await page.evaluate(() => JW.skipIntro());
    await page.waitForFunction(() => JW.state === 'play', null, { timeout: 20000 });
    const f0 = await page.evaluate(() => JW.frames);
    await page.waitForTimeout(1000);
    assert.ok((await page.evaluate(() => JW.frames)) > f0, 'render loop runs');
    const res = await page.evaluate(() => JW.cast('stomp', true));
    assert.equal(res.onBeat, true, 'the drums work');
    await shot(page, 'artifact-play');
    assert.deepEqual(errors, [], 'no console errors');
  } finally {
    await browser.close();
  }
});
