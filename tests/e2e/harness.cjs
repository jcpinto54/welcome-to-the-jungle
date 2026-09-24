'use strict';
// Shared Playwright helpers for the end-to-end tests. Serves three.js from vendor/
// (no network needed) and records every console error so tests can fail on them.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(__dirname, 'shots');

async function openGame({ width = 1280, height = 720, file = 'index.html' } = {}) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/three.min.js', (r) => r.fulfill({ path: path.join(ROOT, 'vendor', 'three.min.js'), contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto('file://' + path.join(ROOT, file));
  return { browser, page, errors };
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: p });
  return p;
}

module.exports = { openGame, shot, ROOT, SHOTS };
