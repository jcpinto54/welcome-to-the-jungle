'use strict';
// The single-file artifact build: every game script inlined, nothing local left behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('./helpers/load');

test('artifact build inlines every game script and drops install-only bits', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-artifact.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'jungle-wizard.html'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const local = [...index.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map((m) => m[1]);
  assert.ok(local.length >= 10, 'index.html loads the game scripts');
  for (const file of local) {
    if (file === 'src/pwa.js') continue;
    const firstCode = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').find((l) => /^(const|function) /.test(l));
    assert.ok(firstCode && html.includes(firstCode), `${file} is inlined`);
  }

  assert.doesNotMatch(html, /<script src="src\//, 'no local script tags left');
  assert.match(html, /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/0\.159\.0\/three\.min\.js"><\/script>/);
  assert.doesNotMatch(html, /rel="manifest"|apple-touch-icon|const PWA =|vendor\/three/, 'no install-only or vendor bits');
  assert.doesNotMatch(html, /<!doctype|<html|<head>|<body>/i, 'the host adds the page skeleton');
  assert.ok(html.indexOf('<title>Jungle Wizard</title>') >= 0 && html.indexOf('<title>') < 8000, 'title in the first 8KB');
  assert.match(html, /const SCREAM_URL = null;/, 'no probe for an unpublished scream file');
  assert.ok(html.length > 200 * 1024 && html.length < 16 * 1024 * 1024, 'size is sane');
});
