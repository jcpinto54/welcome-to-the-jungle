'use strict';
// Browser tests for the sound engine on a bare page (core, sequencer and sound only).
// The tests share one page and run in order: prepare, unlock, transport, hits, mix.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openGame } = require('./harness.cjs');

describe('sound engine', { timeout: 120000 }, () => {
  let browser, page, errors;
  const wait = (ms) => page.waitForTimeout(ms);

  before(async () => {
    ({ browser, page, errors } = await openGame({ file: 'tests/e2e/pages/audio.html' }));
    await page.waitForFunction(() => typeof Sound === 'object' && typeof Sequencer === 'object'); // consts, not window props
  });
  after(async () => { if (browser) await browser.close(); });

  it('is idle before unlock: no transport, no pulse, no latency offset', async () => {
    const r = await page.evaluate(() => ({ pos: Sound.pos(), pulse: Sound.beatPulse(), latency: Sound.latencyMs, running: Sound.running }));
    assert.deepEqual(r, { pos: -1, pulse: 0, latency: 0, running: false });
  });

  it('prepare() resolves and every rendered buffer has a peak in (0.02, 1.0]', async () => {
    const peaks = await page.evaluate(async () => {
      const bufs = await Sound.prepare();
      const out = {};
      for (const [name, b] of Object.entries(bufs)) {
        let p = 0;
        for (let ch = 0; ch < b.numberOfChannels; ch++) {
          const d = b.getChannelData(ch);
          for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
        }
        out[name] = p;
      }
      return out;
    });
    for (const name of ['kick', 'snare', 'bass', 'hatC', 'hatO', 'pad0', 'pad3', 'night']) assert.ok(name in peaks, `${name} is rendered`);
    const bad = Object.entries(peaks).filter(([, p]) => !(p > 0.02 && p <= 1));
    assert.deepEqual(bad, [], 'buffers that are silent or clip');
    assert.equal(await page.evaluate(() => Sound.ready), true);
  });

  it('after unlock() and start(), pos() advances at 1/STEP steps per second (±15%)', async () => {
    const r = await page.evaluate(async () => {
      await Sound.unlock();
      Sound.start(0.05);
      await new Promise((res) => setTimeout(res, 300));
      const p0 = Sound.pos(), t0 = performance.now();
      await new Promise((res) => setTimeout(res, 1500));
      const p1 = Sound.pos(), t1 = performance.now();
      return { p0, rate: (p1 - p0) / ((t1 - t0) / 1000), expected: 1 / STEP, running: Sound.running };
    });
    assert.equal(r.running, true);
    assert.ok(r.p0 > 0, 'the transport has started');
    assert.ok(Math.abs(r.rate - r.expected) / r.expected < 0.15, `rate ${r.rate.toFixed(2)} vs ${r.expected.toFixed(2)} steps/s`);
  });

  it("hit('kick') plays now and lands in seq.draft at the nearest 8th", async () => {
    const r = await page.evaluate(() => {
      const before = Sound.seq.draftCount('kick');
      const p = Sound.pos();
      const res = Sound.hit('kick');
      return { before, after: Sound.seq.draftCount('kick'), res, born: Sound.seq.draft.kick[res.step], p };
    });
    assert.equal(r.after, r.before + 1);
    assert.ok(r.born >= 0 && r.born % 2 === 0, 'recorded at an even global step');
    assert.ok(Math.abs(r.born - r.p) <= 1.5, `born ${r.born} near pos ${r.p.toFixed(2)}`);
    assert.equal(r.res.step, r.born % 32);
    assert.equal(typeof r.res.onBeat, 'boolean');
    assert.ok(Number.isFinite(r.res.errMs));
  });

  it('a hit timed on a quarter note is in the pocket', async () => {
    const r = await page.evaluate(() => {
      const p = Sound.pos(), beat = Math.ceil(p / 4) * 4 + 4;
      return Sound.hit('snare', performance.now() + (beat - p) * STEP * 1000);
    });
    assert.equal(r.onBeat, true);
    assert.ok(Math.abs(r.errMs) < 20, `errMs ${r.errMs}`);
    assert.equal(r.step % 4, 0);
  });

  it('latencyMs is subtracted from input timestamps (posAt), not from pos()', async () => {
    const r = await page.evaluate(() => {
      const now = performance.now();
      const a = Sound.posAt(now), heard0 = Sound.pos();
      Sound.latencyMs = 100;
      const b = Sound.posAt(now), heard1 = Sound.pos();
      // A tap that reaches us 120 ms after the beat counts once 120 ms is calibrated out.
      const p = Sound.pos(), beat = Math.ceil(p / 4) * 4 + 4;
      const tap = performance.now() + (beat - p) * STEP * 1000 + 120;
      Sound.latencyMs = 0;
      const raw = Sound.hit('bass', tap);
      Sound.latencyMs = 120;
      const calibrated = Sound.hit('bass', tap);
      Sound.latencyMs = 0;
      return { shift: a - b, expected: 0.1 / STEP, heardShift: heard1 - heard0, raw, calibrated };
    });
    assert.ok(Math.abs(r.shift - r.expected) < 0.05, `posAt shift ${r.shift} steps`);
    assert.ok(Math.abs(r.heardShift) < 0.25, 'pos() ignores input latency');
    assert.equal(r.raw.onBeat, false);
    assert.equal(r.calibrated.onBeat, true);
    assert.ok(Math.abs(r.calibrated.errMs) < 20);
  });

  it('beatPulse() stays in [0, 1] and pulses on the quarter notes', async () => {
    const r = await page.evaluate(async () => {
      const vals = [];
      const end = performance.now() + 1500;
      while (performance.now() < end) {
        vals.push(Sound.beatPulse());
        await new Promise((res) => setTimeout(res, 4));
      }
      return { n: vals.length, min: Math.min(...vals), max: Math.max(...vals), bad: vals.filter((v) => !(v >= 0 && v <= 1)) };
    });
    assert.deepEqual(r.bad, []);
    assert.ok(r.n > 50, `sampled ${r.n} times`);
    assert.ok(r.max > 0.8 && r.min < 0.2, `range ${r.min.toFixed(2)}..${r.max.toFixed(2)}`);
  });

  it('every sfx plays without throwing', async () => {
    const names = await page.evaluate(async () => {
      const args = { firefly: 3, slam: 1, drop: 0, talk: 2 };
      for (const n of Object.keys(Sound.sfx)) {
        Sound.sfx[n](args[n]);
        await new Promise((res) => setTimeout(res, 20));
      }
      for (let i = 0; i < 6; i++) Sound.sfx.talk(); // fast text blips are rate limited, not stacked
      return Object.keys(Sound.sfx);
    });
    const want = ['firefly', 'boing', 'whoosh', 'crumble', 'hurt', 'ui', 'unlock', 'carve', 'finale', 'slam', 'riser', 'drop',
      'dash', 'levelup', 'talk', 'hitEnemy', 'enemyDie', 'door', 'emerge'];
    for (const n of want) assert.ok(names.includes(n), `sfx.${n}`);
    await wait(500);
  });

  it('the song API still works through Sound (carve, toggle, clearLane, resetSong)', async () => {
    const r = await page.evaluate(() => {
      Sound.resetSong();
      Sound.seq.record('kick', 8);
      const added = Sound.carve();
      const t = Sound.toggle('snare', 4);
      const counts = { kick: Sound.songCount('kick'), snare: Sound.songCount('snare'), draft: Sound.draftCount('kick') };
      Sound.clearLane('snare');
      const cleared = Sound.seq.songCount('snare');
      Sound.resetSong();
      return { added, t, counts, cleared, after: Sound.seq.songCount('kick'), same: Sound.song === Sound.seq.song && Sound.draft === Sound.seq.draft };
    });
    assert.deepEqual(r.added, [{ lane: 'kick', s: 8 }]);
    assert.equal(r.t, 1);
    assert.deepEqual(r.counts, { kick: 1, snare: 1, draft: 0 });
    assert.equal(r.cleared, 0);
    assert.equal(r.after, 0);
    assert.equal(r.same, true, 'Sound.song and Sound.draft are the sequencer arrays');
  });

  it('drain() reports carved and ghost loop hits as they are heard', async () => {
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      Sound.resetSong();
      for (const s of [0, 8, 16, 24]) Sound.toggle('kick', s);
      await sleep(300); // let hits that were already scheduled reach the listener
      Sound.drain(() => {});
      const got = [];
      await sleep(3000); // a bit more than one pass: 4 kicks
      Sound.drain((e) => got.push(e));
      Sound.resetSong();
      return { n: got.length, lanes: [...new Set(got.map((e) => e.lane))], ghosts: got.filter((e) => e.ghost).length };
    });
    assert.ok(r.n >= 3 && r.n <= 6, `${r.n} kicks drained in 3 s`);
    assert.deepEqual(r.lanes, ['kick']);
    assert.equal(r.ghosts, 0);
  });

  it('a live hit just before its own ghost replaces it, so it never sounds twice in one pass', async () => {
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const waitPos = async (p) => { while (Sound.pos() < p) await sleep(1); };
      const ghostKicks = () => { let n = 0; Sound.drain((e) => { if (e.lane === 'kick' && e.ghost) n++; }); return n; };
      Sound.resetSong();
      const q0 = Math.ceil(Sound.pos() / 2) * 2 + 4;
      await waitPos(q0 - 0.3);
      Sound.hit('kick'); // recorded at q0
      const born = Sound.seq.draft.kick[q0 % 32];
      ghostKicks();
      await waitPos(q0 + 32 - 0.9); // next pass: its ghost is already scheduled
      const again = Sound.hit('kick');
      await waitPos(q0 + 34);
      const cancelled = ghostKicks();
      await waitPos(q0 + 66);
      const next = ghostKicks();
      Sound.resetSong();
      return { q0, born, step: again.step, cancelled, next };
    });
    assert.equal(r.born, r.q0);
    assert.equal(r.step, r.q0 % 32);
    assert.equal(r.cancelled, 0, 'the ghost under the live hit was silenced');
    assert.equal(r.next, 1, 'and it ghosts again one pass later');
  });

  it('mix: kick, snare and sub on top, pads and hats underneath, a quiet night bed, no clipping', async () => {
    const m = await page.evaluate(async () => { Sound.setProgress(1); return Sound.mixReport(); });
    const db = (v) => (20 * Math.log10(v)).toFixed(1).padStart(6);
    console.log('mix at full progress, dBFS: peak / rms / loudest 50 ms / same on a phone speaker\n' +
      Object.entries(m).map(([k, v]) => `  ${k.padEnd(6)} ${db(v.peak)} ${db(v.rms)} ${db(v.hot)} ${db(v.phone)}`).join('\n'));
    for (const lane of ['kick', 'snare', 'bass']) {
      assert.ok(m[lane].peak > 0.3, `${lane} is clearly audible`);
      for (const under of ['pad', 'hats']) {
        assert.ok(m[lane].hot > m[under].hot * 2, `${lane} sits at least 6 dB above ${under}`);
        assert.ok(m[lane].phone > m[under].phone, `${lane} stays above ${under} on a phone speaker`);
      }
    }
    assert.ok(m.pad.rms > 0.01 && m.hats.rms > 0.005, 'pads and hats are still there');
    assert.ok(m.night.hot < m.mix.hot * 0.1 && m.night.rms > 0.001, 'the night bed is quiet (20 dB under the music) but present');
    assert.ok(m.mix.peak < 0.95, `the music alone barely touches the master clipper (peak ${m.mix.peak.toFixed(3)})`);
  });

  it('logs no console errors', () => {
    assert.deepEqual(errors, []);
  });
});
