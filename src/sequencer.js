'use strict';
/* sequencer.js: the song and the draft loop as plain data, no audio.
   Positions are global 16th steps; a loop pass is LOOP steps. The song holds carved hits.
   The draft remembers the global step each live hit was played at, so it is never
   replayed in the same pass and comes back as a ghost from the next one. */

const Sequencer = (() => {
  const DRAFT_CAP = { kick: 6, snare: 6, bass: 4 };

  function create({ draftCap = DRAFT_CAP, songCap = 12, beatWindow = 0.075 } = {}) {
    const caps = Object.assign({}, DRAFT_CAP, draftCap);
    const song = {}, draft = {}, order = {}; // order: draft steps per lane, oldest first
    for (const lane of LANES) {
      song[lane] = new Uint8Array(LOOP);
      draft[lane] = new Int32Array(LOOP).fill(-1);
      order[lane] = [];
    }

    // Distance to the nearest quarter note, and the 8th the hit snaps to.
    function judge(pos) {
      const err = (pos / 4 - Math.round(pos / 4)) * 4 * STEP;
      const q = Math.round(pos / 2) * 2 + 0; // + 0 turns -0 into 0
      return { onBeat: Math.abs(err) <= beatWindow, errMs: err * 1000, q, step: mod(q, LOOP) };
    }

    function record(lane, q) {
      const s = mod(q, LOOP), list = order[lane];
      if (draft[lane][s] >= 0) list.splice(list.indexOf(s), 1);
      draft[lane][s] = q;
      list.push(s);
      while (list.length > caps[lane]) draft[lane][list.shift()] = -1;
    }

    function shouldPlay(lane, g) {
      const s = mod(g, LOOP), carved = song[lane][s] === 1, born = draft[lane][s];
      return { carved, ghost: !carved && born >= 0 && g - born >= LOOP };
    }

    function clearDraft(lane) { draft[lane].fill(-1); order[lane].length = 0; }
    const draftCount = (lane) => order[lane].length;
    function songCount(lane) { let n = 0; for (let i = 0; i < LOOP; i++) n += song[lane][i]; return n; }

    function carve() {
      const added = [];
      for (const lane of LANES) {
        let n = songCount(lane);
        for (const s of order[lane]) {
          if (!song[lane][s] && n < songCap) { song[lane][s] = 1; n++; added.push({ lane, s }); }
        }
        clearDraft(lane);
      }
      return added;
    }

    function toggle(lane, s) { s = mod(s, LOOP); song[lane][s] ^= 1; return song[lane][s]; }
    function clearLane(lane) { song[lane].fill(0); }
    function reset() { for (const lane of LANES) { song[lane].fill(0); clearDraft(lane); } }
    const hasFullGroove = () => LANES.every((lane) => songCount(lane) > 0);

    function snapshot() {
      const out = { song: {}, draft: {} };
      for (const lane of LANES) {
        out.song[lane] = Array.from(song[lane]);
        out.draft[lane] = Array.from(draft[lane], (born) => born >= 0);
      }
      return out;
    }

    return { song, draft, judge, record, shouldPlay, carve, toggle, clearLane, reset, draftCount, songCount, hasFullGroove, snapshot };
  }

  return { create };
})();
