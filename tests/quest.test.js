'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const { Quest } = load(['src/core.js', 'src/quest.js'], ['Quest']);

const plain = (x) => JSON.parse(JSON.stringify(x)); // vm-realm objects -> plain Node objects
const L = {
  tree: [-44, 20], spawn: [-40, 16], stone1: [-26, 1], altar: [14, -2], gate1: [14, -11],
  stone2: [21, -51], toad: [39, -57], gate2: [61, -70], stone3: [70, -86], pyramid: [90, -102],
};
const ORDER = ['stone1', 'panther', 'vines', 'stone2', 'toad', 'gate', 'stone3', 'pyramid', 'done'];
const TARGET = { stone1: 'stone1', panther: 'altar', vines: 'gate1', stone2: 'stone2', toad: 'toad', gate: 'gate2', stone3: 'stone3', pyramid: 'pyramid' };

// Plays one step of the critical path.
function finish(q, id) {
  const ev = {
    stone1: ['carve', 0], panther: ['spirit', 'panther'], vines: ['vines'], stone2: ['carve', 1],
    toad: ['spirit', 'toad'], gate: ['gate'], stone3: ['carve', 2], pyramid: ['pyramid'],
  }[id];
  return q.event(...ev);
}

test('a new quest starts at the first Loop Stone with nothing done', () => {
  const q = Quest.create(L);
  assert.deepEqual(plain(q.state), { carved: [false, false, false], panther: false, toad: false, vines: false, gate: false, pyramid: false, done: false });
  assert.deepEqual(plain(q.objective()).target, L.stone1);
  assert.equal(q.objective().id, 'stone1');
});

test('objectives run in order with short imperative text and landmark targets', () => {
  const q = Quest.create(L);
  for (const id of ORDER) {
    const o = q.objective();
    assert.equal(o.id, id);
    assert.ok(typeof o.text === 'string' && o.text.length > 0 && o.text.length <= 36, `short text for ${id}: "${o.text}"`);
    assert.match(o.text, /^[A-Z]/, 'starts like a command');
    if (id === 'done') { assert.equal(o.target, null); break; }
    assert.deepEqual(plain(o.target), L[TARGET[id]], `${id} points at ${TARGET[id]}`);
    finish(q, id);
  }
  assert.equal(q.state.done, true);
});

test('events that arrive out of order still count', () => {
  const q = Quest.create(L);
  finish(q, 'stone1'); finish(q, 'panther'); finish(q, 'vines');
  assert.deepEqual(plain(finish(q, 'toad')).length > 0, true, 'meeting the toad early still gives its gift');
  assert.equal(q.state.toad, true);
  assert.equal(q.objective().id, 'stone2', 'the second stone is still next');
  finish(q, 'stone2');
  assert.equal(q.objective().id, 'gate', 'the toad step is skipped once stone2 is carved');
  q.event('carve', 2);
  finish(q, 'gate');
  assert.equal(q.objective().id, 'pyramid');
});

test('the target is a copy, and missing landmarks give a null target', () => {
  const q = Quest.create(L);
  q.objective().target[0] = 999;
  assert.equal(L.stone1[0], -26);
  const bare = Quest.create({});
  assert.equal(bare.objective().target, null);
  assert.equal(bare.objective().id, 'stone1');
});

test('event() returns toast messages for new progress only', () => {
  const q = Quest.create(L);
  assert.ok(plain(q.event('carve', 0)).includes('LOOP STONE I CARVED'));
  assert.deepEqual(plain(q.event('carve', 0)), [], 'carving the same stone again is not news');
  assert.ok(plain(q.event('carve', 2)).includes('LOOP STONE III CARVED'));
  assert.ok(plain(q.event('spirit', 'panther')).includes('STAFF BLAST UNLOCKED · SNARE'));
  assert.deepEqual(plain(q.event('spirit', 'panther')), []);
  assert.ok(plain(q.event('spirit', 'toad')).some((m) => /BASS/.test(m)));
  assert.ok(plain(q.event('vines')).some((m) => /VINE/.test(m)));
  assert.ok(plain(q.event('gate')).some((m) => /GATE/.test(m)));
  assert.deepEqual(plain(q.event('nonsense')), []);
  assert.deepEqual(plain(q.event('carve', 7)), [], 'there are only three stones');
  assert.deepEqual(plain(q.event('spirit', 'sloth')), []);
  const msgs = plain(q.event('carve', 1));
  assert.ok(msgs.includes('LOOP STONE II CARVED'));
  assert.ok(msgs.length >= 2, 'the last stone also says the song is whole');
  for (const m of plain(q.event('pyramid'))) assert.equal(m, m.toUpperCase(), 'toasts are upper case');
  assert.equal(q.state.done, true);
});

test('pyramidReady names the missing lanes and stones', () => {
  const q = Quest.create(L);
  let r = plain(q.pyramidReady(false));
  assert.equal(r.ok, false);
  assert.deepEqual(r.lanes, ['snare', 'bass'], 'lanes without their spirit are surely missing');
  assert.deepEqual(r.stones, [0, 1, 2]);
  for (const label of ['SNARE', 'BASS', 'LOOP STONE I', 'LOOP STONE II', 'LOOP STONE III']) assert.ok(r.missing.includes(label), label);
  assert.match(r.text, /SNARE/);

  q.event('carve', 0); q.event('carve', 1); q.event('spirit', 'panther'); q.event('spirit', 'toad');
  r = plain(q.pyramidReady((lane) => lane !== 'bass'));
  assert.deepEqual(r.lanes, ['bass'], 'a per-lane function names exactly what is missing');
  assert.deepEqual(r.missing, ['BASS', 'LOOP STONE III']);
  r = plain(q.pyramidReady({ kick: 3, snare: 0, bass: 1 }));
  assert.deepEqual(r.lanes, ['snare'], 'per-lane counts work too');
  r = plain(q.pyramidReady(false));
  assert.deepEqual(r.missing, ['FULL GROOVE', 'LOOP STONE III'], 'a bare false with both spirits cannot say which lane');

  q.event('carve', 2);
  assert.equal(q.pyramidReady(false).ok, false);
  r = plain(q.pyramidReady(true));
  assert.deepEqual(r, { ok: true, missing: [], lanes: [], stones: [], text: r.text });
});

test('log() lists every step with its done flag, for the quest log', () => {
  const q = Quest.create(L);
  q.event('spirit', 'toad');
  const log = plain(q.log());
  assert.deepEqual(log.map((s) => s.id), ORDER.slice(0, -1));
  assert.deepEqual(log.map((s) => s.done), [false, false, false, false, true, false, false, false]);
  assert.ok(log.every((s) => s.text === s.text.trim() && s.text.length > 0));
});

test('spirit lines are terse and hand over the right gifts', () => {
  const lines = plain(Quest.LINES);
  for (const key of ['tree', 'panther', 'toad', 'pyramid']) {
    const speech = lines[key];
    assert.ok(Array.isArray(speech) && speech.length >= 1 && speech.length <= 4, `${key}: 1 to 4 lines`);
    for (const line of speech) assert.ok(line.length > 0 && line.length <= 60, `${key}: short line "${line}"`);
    assert.ok(typeof Quest.SPEAKERS[key] === 'string' && Quest.SPEAKERS[key].length > 0, `${key} has a speaker name`);
  }
  assert.match(lines.panther.join(' '), /crack of thunder/i);
  assert.match(lines.toad.join(' '), /low end/i);
});
