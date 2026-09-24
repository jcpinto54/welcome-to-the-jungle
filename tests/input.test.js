'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const { Input } = load(['src/core.js', 'src/input.js'], ['Input']);

const plain = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} ~ ${b}`);
const len = (v) => Math.hypot(v.x, v.y);

test('loads in Node without touching the DOM', () => {
  assert.equal(typeof Input.init, 'function');
  assert.equal(Input.isTouch, false);
  assert.deepEqual(plain(Input.move), { x: 0, y: 0 });
  assert.deepEqual(plain(Input.consume()), []);
});

test('stick: the deadzone swallows small thumb wobble', () => {
  assert.deepEqual(plain(Input.stick(0, 0, 60, 0.15)), { x: 0, y: 0 });
  assert.deepEqual(plain(Input.stick(5, -5, 60, 0.15)), { x: 0, y: 0 });
});

test('stick: y is forward (screen up), x is right, ramping from the deadzone edge', () => {
  const up = Input.stick(0, -60, 60, 0.15);
  near(up.x, 0); near(up.y, 1, 'full push up is full forward');
  const right = Input.stick(30, 0, 60, 0);
  near(right.x, 0.5); near(right.y, 0);
  const half = Input.stick(0, 60 * 0.575, 60, 0.15);
  near(half.y, -0.5, 'halfway between the deadzone and the rim is half speed');
  const edge = Input.stick(0, -(60 * 0.15 + 0.6), 60, 0.15);
  assert.ok(edge.y > 0 && edge.y < 0.02, 'no jump at the deadzone edge');
});

test('stick: pushing past the rim clamps to length 1', () => {
  const far = Input.stick(0, -500, 60, 0.15);
  near(far.y, 1);
  const diag = Input.stick(300, 300, 60, 0.15);
  near(len(diag), 1, 'diagonal is still unit length');
  near(diag.x, Math.SQRT1_2); near(diag.y, -Math.SQRT1_2);
});

test('follow: the floating base trails the thumb once it leaves the rim', () => {
  assert.deepEqual(plain(Input.follow(0, 0, 30, 40, 60)), { x: 0, y: 0 }, 'inside the rim the base stays');
  const f = Input.follow(0, 0, 100, 0, 60);
  near(f.x, 40); near(f.y, 0);
  const g = Input.follow(10, 10, 10, 210, 60);
  near(g.x, 10); near(g.y, 150);
});

test('keyAxes: WASD and arrows, opposite keys cancel, diagonals are unit length', () => {
  assert.deepEqual(plain(Input.keyAxes(['KeyW'])), { x: 0, y: 1 });
  assert.deepEqual(plain(Input.keyAxes(['ArrowDown'])), { x: 0, y: -1 });
  assert.deepEqual(plain(Input.keyAxes(['KeyA', 'ArrowLeft'])), { x: -1, y: 0 });
  assert.deepEqual(plain(Input.keyAxes(['KeyW', 'KeyS'])), { x: 0, y: 0 });
  const d = Input.keyAxes(new Set(['KeyW', 'KeyD']));
  near(d.x, Math.SQRT1_2); near(d.y, Math.SQRT1_2);
  assert.deepEqual(plain(Input.keyAxes(['KeyQ', 'Space'])), { x: 0, y: 0 });
});

test('combine: stick plus keys never exceeds length 1', () => {
  const c = Input.combine({ x: 1, y: 0 }, { x: 0, y: 1 });
  near(len(c), 1);
  assert.deepEqual(plain(Input.combine({ x: 0.2, y: 0.1 }, { x: 0, y: 0 })), { x: 0.2, y: 0.1 });
});

test('keyAction maps keys per mode', () => {
  const play = (c) => Input.keyAction(c, 'play');
  assert.equal(play('Space'), 'stomp');
  assert.equal(play('KeyJ'), 'bolt');
  assert.equal(play('KeyK'), 'quake');
  assert.equal(play('ShiftLeft'), 'dash');
  assert.equal(play('ShiftRight'), 'dash');
  assert.equal(play('KeyE'), 'interact');
  assert.equal(play('Tab'), 'book');
  assert.equal(play('KeyM'), 'mute');
  assert.equal(play('Escape'), 'pause');
  assert.equal(play('KeyW'), null, 'movement keys are held, not pressed');
  for (const c of ['Space', 'KeyE', 'Enter']) assert.equal(Input.keyAction(c, 'dialogue'), 'advance', c);
  assert.equal(Input.keyAction('KeyJ', 'dialogue'), null, 'no bolts mid-sentence');
  assert.equal(Input.keyAction('Tab', 'book'), 'book');
  assert.equal(Input.keyAction('Escape', 'book'), 'book');
  assert.equal(Input.keyAction('Space', 'book'), null, 'space presses the focused button in the book');
  assert.equal(Input.keyAction('Enter', 'menu'), 'advance');
  assert.equal(Input.keyAction('KeyM', 'menu'), 'mute');
});

test('mouseAction: left bolts, right quakes, clicks advance dialogue and menus', () => {
  assert.equal(Input.mouseAction(0, 'play'), 'bolt');
  assert.equal(Input.mouseAction(2, 'play'), 'quake');
  assert.equal(Input.mouseAction(1, 'play'), null);
  assert.equal(Input.mouseAction(0, 'dialogue'), 'advance');
  assert.equal(Input.mouseAction(0, 'menu'), 'advance');
  assert.equal(Input.mouseAction(0, 'book'), null);
});

test('stamp: trust the event timeStamp only when it is on the performance clock', () => {
  assert.equal(Input.stamp(1000, 1010), 1000);
  assert.equal(Input.stamp(0, 1010), 1010, 'missing stamp');
  assert.equal(Input.stamp(1.7e12, 1010), 1010, 'epoch-based stamp from an old browser');
  assert.equal(Input.stamp(5000, 1010), 1010, 'a stamp from the future');
  assert.equal(Input.stamp(undefined, 7), 7);
});

test('lookDelta: sensitivity scales, invert flips y, touch drags get more gain', () => {
  assert.deepEqual(plain(Input.lookDelta(10, -4, { sensitivity: 1, invertY: false }, false)), { dx: 10, dy: -4 });
  assert.deepEqual(plain(Input.lookDelta(10, -4, { sensitivity: 2, invertY: true }, false)), { dx: 20, dy: 8 });
  const t = Input.lookDelta(10, 0, { sensitivity: 1, invertY: false }, true);
  assert.ok(t.dx > 10, 'a thumb covers less ground than a mouse');
});

test('settings are clamped to sane values', () => {
  const s = Input.cleanSettings({ sensitivity: 99, invertY: 'yes' });
  assert.ok(s.sensitivity <= 3 && s.sensitivity >= 0.25);
  assert.equal(s.invertY, true);
  assert.deepEqual(plain(Input.cleanSettings(null)), { sensitivity: 1, invertY: false });
});
