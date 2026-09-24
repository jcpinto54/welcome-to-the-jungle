'use strict';
/* quest.js: the quest as a small state machine, plus what the spirits say.
   Pure: no THREE, no DOM. Events may arrive in any order; the objective is
   always the first step that is not done yet. */

const Quest = (() => {
  const STEPS = [
    { id: 'stone1', at: 'stone1', text: 'Stomp, then carve at the Loop Stone', done: (s) => s.carved[0] },
    { id: 'panther', at: 'altar', text: 'Wake the Panther Spirit', done: (s) => s.panther },
    { id: 'vines', at: 'gate1', text: 'Burn the vine wall with bolts', done: (s) => s.vines },
    { id: 'stone2', at: 'stone2', text: 'Carve at the second Loop Stone', done: (s) => s.carved[1] },
    { id: 'toad', at: 'toad', text: 'Find the Sub Toad in the pool', done: (s) => s.toad },
    { id: 'gate', at: 'gate2', text: 'Quake the cracked gate open', done: (s) => s.gate },
    { id: 'stone3', at: 'stone3', text: 'Carve at the last Loop Stone', done: (s) => s.carved[2] },
    { id: 'pyramid', at: 'pyramid', text: 'Open the Lost Pyramid', done: (s) => s.pyramid },
  ];
  const DONE_TEXT = 'Keep jamming. The jungle sings';
  const ROMAN = ['I', 'II', 'III'];
  const GIFTS = { panther: 'STAFF BLAST UNLOCKED · SNARE', toad: 'ROOT QUAKE UNLOCKED · BASS' };
  const ONCE = { vines: 'VINE WALL BURNED · THE RIDGE IS OPEN', gate: 'CRACKED GATE BROKEN · THE RAMP IS OPEN', pyramid: 'THE LOST PYRAMID OPENS' };

  // Each speech is one page per line, four lines at most.
  const LINES = {
    tree: [
      'Wake, root-child. The jungle forgot its rhythm.',
      'Your staff is a drum. Every spell is a hit.',
      'Carve the groove into the Loop Stones. Go.',
    ],
    panther: [
      'Mm. A stump that walks in time. Rare.',
      'But a kick alone is a heart with no voice.',
      'Take the crack of thunder. Strike on two and four.',
      'Now burn the vines. The break is waiting.',
    ],
    toad: [
      'Blooorp. Heavy steps, little stump.',
      'Your groove has no belly. No weight.',
      'Take the low end. Warn your ribs.',
      'Quake the cracked gate. The sub goes first.',
    ],
    pyramid: [
      'Kick. Snare. Bass. The old song walks again.',
      'Ten thousand loops I waited in the dark.',
      'Enter, Jungle Wizard. Bring the drop.',
    ],
  };
  const SPEAKERS = { tree: 'SUMMONING TREE 召喚', panther: 'PANTHER SPIRIT 黒豹', toad: 'SUB TOAD 低音', pyramid: 'THE EYE 眼' };

  function create(L = {}) {
    const state = { carved: [false, false, false], panther: false, toad: false, vines: false, gate: false, pyramid: false, done: false };
    const target = (key) => (L[key] ? [L[key][0], L[key][1]] : null);

    function objective() {
      const step = STEPS.find((st) => !st.done(state));
      return step ? { id: step.id, text: step.text, target: target(step.at) } : { id: 'done', text: DONE_TEXT, target: null };
    }

    const log = () => STEPS.map((st) => ({ id: st.id, text: st.text, done: !!st.done(state) }));

    function event(name, arg) {
      const out = [];
      if (name === 'carve') {
        const i = typeof arg === 'string' ? ['stone1', 'stone2', 'stone3'].indexOf(arg) : arg;
        if (!Number.isInteger(i) || i < 0 || i > 2 || state.carved[i]) return out;
        state.carved[i] = true;
        out.push(`LOOP STONE ${ROMAN[i]} CARVED`);
        if (state.carved.every(Boolean) && !state.pyramid) out.push('ALL THREE STONES SING · FIND THE PYRAMID');
      } else if (name === 'spirit') {
        if (!GIFTS[arg] || state[arg]) return out;
        state[arg] = true;
        out.push(GIFTS[arg]);
      } else if (ONCE[name]) {
        if (state[name]) return out;
        state[name] = true;
        out.push(ONCE[name]);
      } else {
        return out;
      }
      if (!state.done && STEPS.every((st) => st.done(state))) {
        state.done = true;
        out.push('THE JUNGLE SINGS AGAIN');
      }
      return out;
    }

    // groove: a boolean (seq.hasFullGroove()), or per lane: a function lane -> truthy, or {lane: count}.
    // A bare false can only name the lanes whose spirit is still asleep.
    function pyramidReady(groove) {
      const perLane = typeof groove === 'function' || (groove !== null && typeof groove === 'object');
      let lanes, vague = false;
      if (perLane) lanes = LANES.filter((l) => !(typeof groove === 'function' ? groove(l) : groove[l]));
      else if (groove) lanes = [];
      else {
        lanes = LANES.filter((l) => (l === 'snare' && !state.panther) || (l === 'bass' && !state.toad));
        vague = lanes.length === 0;
      }
      const stones = [0, 1, 2].filter((i) => !state.carved[i]);
      const missing = lanes.map((l) => LANE_NAME[l]).concat(vague ? ['FULL GROOVE'] : [], stones.map((i) => 'LOOP STONE ' + ROMAN[i]));
      const ok = missing.length === 0;
      return { ok, missing, lanes, stones, text: ok ? 'THE EYE OPENS' : 'THE EYE WANTS ' + missing.join(' · ') };
    }

    return { state, objective, event, pyramidReady, log };
  }

  return { create, LINES, SPEAKERS };
})();
