'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const { STEP, LOOP, LANES, clamp, mod, smoothstep, rng, fbm } = load(['src/core.js'], ['STEP', 'LOOP', 'LANES', 'clamp', 'mod', 'smoothstep', 'rng', 'fbm']);

test('music constants describe 170 BPM 16ths over two bars', () => {
  assert.ok(Math.abs(STEP - 60 / 170 / 4) < 1e-12);
  assert.equal(LOOP, 32);
  assert.deepEqual([...LANES], ['kick', 'snare', 'bass']);
});

test('helpers behave', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(mod(-1, 32), 31);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  const a = rng(7), b = rng(7);
  assert.equal(a(), b());
  const n = fbm(3.3, 4.4);
  assert.ok(n >= 0 && n <= 1);
});
