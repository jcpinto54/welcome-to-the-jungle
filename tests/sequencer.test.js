'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const { Sequencer, STEP, LOOP, LANES } = load(['src/core.js', 'src/sequencer.js'], ['Sequencer', 'STEP', 'LOOP', 'LANES']);

const steps = (ms) => ms / 1000 / STEP; // a time offset in ms, as a step offset
const plain = (x) => JSON.parse(JSON.stringify(x)); // vm-realm objects -> plain Node objects
const kind = (x) => Object.prototype.toString.call(x).slice(8, -1);

test('create() gives LOOP-step song and draft lanes, empty', () => {
  const seq = Sequencer.create();
  for (const lane of LANES) {
    assert.equal(kind(seq.song[lane]), 'Uint8Array');
    assert.equal(kind(seq.draft[lane]), 'Int32Array');
    assert.equal(seq.song[lane].length, LOOP);
    assert.equal(seq.draft[lane].length, LOOP);
    assert.ok(seq.song[lane].every((v) => v === 0));
    assert.ok(seq.draft[lane].every((v) => v === -1));
    assert.equal(seq.songCount(lane), 0);
    assert.equal(seq.draftCount(lane), 0);
  }
  assert.equal(seq.hasFullGroove(), false);
});

test('instances do not share state', () => {
  const a = Sequencer.create(), b = Sequencer.create();
  a.toggle('kick', 0);
  a.record('snare', 4);
  assert.equal(b.songCount('kick'), 0);
  assert.equal(b.draftCount('snare'), 0);
});

test('judge: on the beat within ±75 ms of a quarter note', () => {
  const seq = Sequencer.create();
  for (const beat of [0, 4, 8, 16, 28, 32, 100, 1000]) {
    assert.equal(seq.judge(beat + steps(74)).onBeat, true, `${beat} +74ms`);
    assert.equal(seq.judge(beat - steps(74)).onBeat, true, `${beat} -74ms`);
    assert.equal(seq.judge(beat + steps(76)).onBeat, false, `${beat} +76ms`);
    assert.equal(seq.judge(beat - steps(76)).onBeat, false, `${beat} -76ms`);
    assert.equal(seq.judge(beat).onBeat, true);
  }
});

test('judge: 8th notes between quarters are not on the beat', () => {
  const seq = Sequencer.create();
  for (const p of [2, 6, 10, 30]) assert.equal(seq.judge(p).onBeat, false, `step ${p}`);
});

test('judge: errMs is signed (late > 0, early < 0) and measured to the nearest quarter', () => {
  const seq = Sequencer.create();
  assert.ok(Math.abs(seq.judge(8 + steps(50)).errMs - 50) < 1e-6);
  assert.ok(Math.abs(seq.judge(8 - steps(30)).errMs + 30) < 1e-6);
  assert.ok(Math.abs(seq.judge(12).errMs) < 1e-9);
  // One 16th before a quarter is closer to that quarter than to the last one.
  assert.ok(Math.abs(seq.judge(11).errMs + STEP * 1000) < 1e-6);
});

test('judge: beatWindow is configurable', () => {
  const seq = Sequencer.create({ beatWindow: 0.05 });
  assert.equal(seq.judge(4 + steps(49)).onBeat, true);
  assert.equal(seq.judge(4 + steps(51)).onBeat, false);
});

test('judge: quantizes to the nearest even global step (8th notes)', () => {
  const seq = Sequencer.create();
  const q = (p) => seq.judge(p).q;
  assert.equal(q(0), 0);
  assert.equal(q(0.99), 0);
  assert.equal(q(1), 2, 'exactly halfway (an odd 16th) rounds forward');
  assert.equal(q(1.01), 2);
  assert.equal(q(2.99), 2);
  assert.equal(q(3), 4);
  assert.equal(q(5.5), 6);
  assert.equal(q(4 + steps(74)), 4);
  assert.equal(q(4 - steps(74)), 4);
  assert.equal(q(64.9), 64);
  for (let p = 0; p < 70; p += 0.37) {
    const r = seq.judge(p);
    assert.equal(r.q % 2, 0, `q(${p}) is even`);
    assert.ok(Math.abs(r.q - p) <= 1, `q(${p}) is the nearest 8th`);
    assert.equal(r.step, r.q % LOOP);
  }
});

test('judge: quantizing wraps into the next pass, and never returns -0', () => {
  const seq = Sequencer.create();
  const late = seq.judge(31.2);
  assert.equal(late.q, 32);
  assert.equal(late.step, 0);
  assert.equal(seq.judge(33).step, 2);
  assert.equal(seq.judge(95.4).step, 0);
  const early = seq.judge(-0.4);
  assert.ok(Object.is(early.q, 0), 'q is +0');
  assert.ok(Object.is(early.step, 0), 'step is +0');
  assert.equal(early.onBeat, true, 'just before the first downbeat is still in the pocket');
});

test('record: stores the global step it was played at', () => {
  const seq = Sequencer.create();
  seq.record('kick', 36);
  assert.equal(seq.draft.kick[4], 36);
  assert.equal(seq.draftCount('kick'), 1);
  assert.equal(seq.draftCount('snare'), 0);
  assert.ok(seq.draft.snare.every((v) => v === -1), 'other lanes untouched');
});

test('record: FIFO per lane up to draftCap', () => {
  const seq = Sequencer.create({ draftCap: { kick: 3, snare: 2, bass: 1 } });
  for (const g of [0, 4, 8]) seq.record('kick', g);
  assert.equal(seq.draftCount('kick'), 3);
  seq.record('kick', 12);
  assert.equal(seq.draftCount('kick'), 3);
  assert.equal(seq.draft.kick[0], -1, 'the oldest hit falls out');
  assert.deepEqual([4, 8, 12].map((s) => seq.draft.kick[s]), [4, 8, 12]);
  seq.record('bass', 2);
  seq.record('bass', 6);
  assert.equal(seq.draftCount('bass'), 1);
  assert.equal(seq.draft.bass[2], -1);
  assert.equal(seq.draft.bass[6], 6);
});

test('record: default caps are kick 6, snare 6, bass 4', () => {
  const seq = Sequencer.create();
  for (let s = 0; s < 20; s += 2) for (const lane of LANES) seq.record(lane, s);
  assert.equal(seq.draftCount('kick'), 6);
  assert.equal(seq.draftCount('snare'), 6);
  assert.equal(seq.draftCount('bass'), 4);
});

test('record: a partial draftCap keeps the other defaults', () => {
  const seq = Sequencer.create({ draftCap: { kick: 2 } });
  for (let s = 0; s < 20; s += 2) for (const lane of LANES) seq.record(lane, s);
  assert.equal(seq.draftCount('kick'), 2);
  assert.equal(seq.draftCount('snare'), 6);
  assert.equal(seq.draftCount('bass'), 4);
});

test('record: hitting a step again refreshes it instead of adding a duplicate', () => {
  const seq = Sequencer.create({ draftCap: { kick: 3, snare: 3, bass: 3 } });
  for (const g of [0, 4, 8]) seq.record('kick', g);
  seq.record('kick', 32); // step 0 again, one pass later
  assert.equal(seq.draftCount('kick'), 3);
  assert.equal(seq.draft.kick[0], 32, 'born step is refreshed');
  seq.record('kick', 44); // step 12 pushes out the oldest, which is now step 4
  assert.equal(seq.draft.kick[4], -1);
  assert.equal(seq.draft.kick[0], 32);
  assert.equal(seq.draft.kick[8], 8);
  assert.equal(seq.draft.kick[12], 44);
});

test('shouldPlay: never replays a hit in the pass it was recorded, ghosts it from the next', () => {
  const seq = Sequencer.create();
  seq.record('snare', 36); // step 4 of the second pass
  assert.deepEqual(plain(seq.shouldPlay('snare', 36)), { carved: false, ghost: false });
  assert.equal(seq.shouldPlay('snare', 4).ghost, false, 'not before it was played');
  assert.deepEqual(plain(seq.shouldPlay('snare', 68)), { carved: false, ghost: true });
  assert.equal(seq.shouldPlay('snare', 100).ghost, true, 'and every pass after');
  assert.equal(seq.shouldPlay('snare', 69).ghost, false, 'other steps stay silent');
  assert.equal(seq.shouldPlay('kick', 68).ghost, false, 'other lanes stay silent');
});

test('shouldPlay: a hit quantized across the loop end is born in the next pass', () => {
  const seq = Sequencer.create();
  const j = seq.judge(31.3);
  seq.record('kick', j.q);
  assert.equal(seq.shouldPlay('kick', 32).ghost, false, 'the step right after the live hit');
  assert.equal(seq.shouldPlay('kick', 64).ghost, true);
});

test('shouldPlay: a refreshed hit waits a full pass again', () => {
  const seq = Sequencer.create();
  seq.record('bass', 6);
  assert.equal(seq.shouldPlay('bass', 38).ghost, true);
  seq.record('bass', 70); // played live again at step 6
  assert.equal(seq.shouldPlay('bass', 70).ghost, false);
  assert.equal(seq.shouldPlay('bass', 102).ghost, true);
});

test('shouldPlay: carved beats take priority over ghosts', () => {
  const seq = Sequencer.create();
  seq.toggle('kick', 8);
  seq.record('kick', 8);
  assert.deepEqual(plain(seq.shouldPlay('kick', 8)), { carved: true, ghost: false });
  assert.deepEqual(plain(seq.shouldPlay('kick', 40)), { carved: true, ghost: false });
  assert.deepEqual(plain(seq.shouldPlay('kick', 72)), { carved: true, ghost: false });
  assert.deepEqual(plain(seq.shouldPlay('kick', 9)), { carved: false, ghost: false });
});

test('carve: merges the draft into the song, clears the draft, returns what was added', () => {
  const seq = Sequencer.create();
  seq.record('kick', 8);
  seq.record('kick', 0);
  seq.record('snare', 4);
  seq.record('bass', 38);
  const added = plain(seq.carve());
  assert.deepEqual(added, [
    { lane: 'kick', s: 8 }, { lane: 'kick', s: 0 }, { lane: 'snare', s: 4 }, { lane: 'bass', s: 6 },
  ]);
  assert.equal(seq.song.kick[0], 1);
  assert.equal(seq.song.kick[8], 1);
  assert.equal(seq.song.snare[4], 1);
  assert.equal(seq.song.bass[6], 1);
  for (const lane of LANES) {
    assert.equal(seq.draftCount(lane), 0);
    assert.ok(seq.draft[lane].every((v) => v === -1));
  }
});

test('carve: already carved steps are not added twice', () => {
  const seq = Sequencer.create();
  seq.record('kick', 0);
  seq.carve();
  seq.record('kick', 32);
  seq.record('kick', 34);
  assert.deepEqual(plain(seq.carve()), [{ lane: 'kick', s: 2 }]);
  assert.equal(seq.songCount('kick'), 2);
  assert.equal(seq.draftCount('kick'), 0);
  assert.deepEqual(plain(seq.carve()), [], 'an empty draft carves nothing');
});

test('carve: respects songCap per lane', () => {
  const seq = Sequencer.create({ songCap: 3 });
  for (const g of [0, 2, 4, 6, 8]) seq.record('kick', g);
  seq.record('snare', 4);
  const added = plain(seq.carve());
  assert.deepEqual(added, [{ lane: 'kick', s: 0 }, { lane: 'kick', s: 2 }, { lane: 'kick', s: 4 }, { lane: 'snare', s: 4 }]);
  assert.equal(seq.songCount('kick'), 3);
  seq.record('kick', 10);
  assert.deepEqual(plain(seq.carve()), [], 'a full lane takes nothing more');
  assert.equal(seq.songCount('kick'), 3);
  assert.equal(seq.draftCount('kick'), 0, 'but the draft is still cleared');
});

test('toggle flips a carved step and returns its new value', () => {
  const seq = Sequencer.create();
  assert.equal(seq.toggle('snare', 12), 1);
  assert.equal(seq.song.snare[12], 1);
  assert.equal(seq.songCount('snare'), 1);
  assert.equal(seq.toggle('snare', 12), 0);
  assert.equal(seq.song.snare[12], 0);
  assert.equal(seq.songCount('snare'), 0);
});

test('clearLane empties one carved lane and leaves the rest', () => {
  const seq = Sequencer.create();
  seq.toggle('kick', 0); seq.toggle('kick', 8); seq.toggle('snare', 4);
  seq.record('kick', 2);
  seq.clearLane('kick');
  assert.equal(seq.songCount('kick'), 0);
  assert.equal(seq.songCount('snare'), 1);
  assert.equal(seq.draftCount('kick'), 1, 'the draft is not the song');
});

test('reset empties song and draft but keeps the same arrays (views stay live)', () => {
  const seq = Sequencer.create();
  const song = seq.song.kick, draft = seq.draft.bass;
  seq.toggle('kick', 0); seq.record('bass', 6); seq.record('snare', 4);
  seq.reset();
  for (const lane of LANES) {
    assert.equal(seq.songCount(lane), 0);
    assert.equal(seq.draftCount(lane), 0);
    assert.ok(seq.draft[lane].every((v) => v === -1));
  }
  assert.equal(seq.song.kick, song);
  assert.equal(seq.draft.bass, draft);
  seq.record('bass', 2);
  assert.equal(draft[2], 2);
});

test('hasFullGroove needs a carved hit in every lane (draft hits do not count)', () => {
  const seq = Sequencer.create();
  for (const lane of LANES) seq.record(lane, 0);
  assert.equal(seq.hasFullGroove(), false);
  seq.toggle('kick', 0); seq.toggle('snare', 4);
  assert.equal(seq.hasFullGroove(), false);
  seq.toggle('bass', 6);
  assert.equal(seq.hasFullGroove(), true);
  seq.clearLane('bass');
  assert.equal(seq.hasFullGroove(), false);
});

test('snapshot: song as 0/1 numbers, draft as booleans, per lane', () => {
  const seq = Sequencer.create();
  seq.toggle('kick', 0);
  seq.record('snare', 36);
  const snap = seq.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), ['draft', 'song']);
  assert.deepEqual(Object.keys(snap.song), [...LANES]);
  assert.deepEqual(Object.keys(snap.draft), [...LANES]);
  for (const lane of LANES) {
    assert.ok(Array.isArray(snap.song[lane]) && snap.song[lane].length === LOOP);
    assert.ok(Array.isArray(snap.draft[lane]) && snap.draft[lane].length === LOOP);
    assert.ok(snap.song[lane].every((v) => v === 0 || v === 1));
    assert.ok(snap.draft[lane].every((v) => typeof v === 'boolean'));
  }
  assert.equal(snap.song.kick[0], 1);
  assert.equal(snap.draft.snare[4], true);
  assert.equal(snap.draft.snare[0], false);
});

test('snapshot is a copy', () => {
  const seq = Sequencer.create();
  seq.toggle('kick', 0);
  seq.record('snare', 36);
  const snap = seq.snapshot();
  snap.song.kick[0] = 0;
  snap.draft.snare[4] = false;
  snap.song.snare.length = 0;
  assert.equal(seq.song.kick[0], 1);
  assert.equal(seq.draft.snare[4], 36);
  assert.equal(seq.song.snare.length, LOOP);
  seq.toggle('bass', 2);
  seq.record('kick', 6);
  assert.equal(snap.song.bass[2], 0, 'later edits do not leak into an old snapshot');
  assert.equal(snap.draft.kick[6], false);
});
