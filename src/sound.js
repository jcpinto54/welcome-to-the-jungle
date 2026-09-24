'use strict';
/* sound.js: the lo-fi jungle engine.
   Everything is synthesized in the browser. Drums, sub bass, pads, one-shots and the night
   ambience are rendered once into buffers (then crunched a little, like an old sampler), and a
   170 BPM transport plays the loop. What the loop holds lives in the Sequencer (Sound.seq). */

const Sound = (() => {
  const SWING = 0.1; // odd 16ths land a touch late: lazier, more lo-fi
  const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead of time
  const MASTER = 0.9;
  const PAD_LEVEL = 0.3;
  const AMB_LEVEL = 0.075; // the night bed sits far under everything
  const CRACK_AT = 1.9; // seconds into sfx.emerge when the wizard tears free
  const SR = 44100;
  const SCREAM_URL = 'assets/audio/welcome.mp3';

  // Fmaj9 -> Em7 -> Dm9 -> Cmaj9, one chord per loop: eight bars round.
  const CHORDS = [
    { name: 'FMAJ9', root: 5, pad: [57, 60, 64, 67] },
    { name: 'EM7', root: 4, pad: [55, 59, 62, 64] },
    { name: 'DM9', root: 2, pad: [53, 57, 60, 64] },
    { name: 'CMAJ9', root: 0, pad: [52, 55, 59, 62] },
  ];
  // Guide hats, one value per step: >0 closed hat level, <0 open hat level.
  const HATS = [
    0.6, 0, 0.25, 0.12, 0.45, 0, 0.3, 0, 0.6, 0, 0.25, 0.12, 0.45, 0, -0.35, 0,
    0.6, 0, 0.25, 0.12, 0.45, 0, 0.3, 0.1, 0.6, 0, 0.25, 0.12, 0.45, 0.12, -0.35, 0,
  ];
  const ARP = [0, 2, 1, 3, 2, 0, 3, 1, 0, 2, 1, 3, 3, 2, 1, 0];
  // Night callers over the insect bed: seconds between calls, gain range, calls in a row, spacing, reverb.
  const CRITTERS = [
    { name: 'croak', gap: [2.5, 7], gain: [0.2, 0.4], calls: 3, every: 0.32, send: 0.2 },
    { name: 'peep', gap: [1.2, 4.5], gain: [0.08, 0.18], calls: 2, every: 0.45, send: 0.3 },
    { name: 'bird', gap: [16, 36], gain: [0.12, 0.18], calls: 1, every: 0, send: 0.7 },
  ];

  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);

  const seq = Sequencer.create();
  let ctx = null, G = null, analyser = null, buffers = null, preparing = null, screamBuf = null;
  let startTime = 0, nextStep = 0, running = false, timer = null, bedsOn = false;
  let muted = false, gift = false, progress = 0, hushAmt = 0, latencyMs = 0, lastTalk = 0, spoke = false;
  const events = [], pendingGhost = {}, nextCall = {};

  /* ---------- offline rendering of instruments ---------- */

  function tanhCurve(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return c;
  }
  function noise(c, dur) {
    const len = Math.ceil(dur * c.sampleRate), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b;
    return s;
  }
  function shaper(c, k, out) { const s = c.createWaveShaper(); s.curve = tanhCurve(k); s.connect(out); return s; }
  function filter(c, type, freq, q = 0.7) { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
  function gainNode(c, v) { const g = c.createGain(); g.gain.value = v; return g; }
  function pulseWave(c, duty) {
    const n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return c.createPeriodicWave(re, im);
  }
  function render(dur, build, channels = 1) {
    const c = new OfflineAudioContext(channels, Math.ceil(dur * SR), SR);
    build(c, c.destination);
    return c.startRendering();
  }
  // Sample-and-hold plus bit reduction: the 12-bit sampler grit jungle was built on.
  function crunch(buf, hold, bits) {
    const levels = Math.pow(2, bits - 1);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      let held = 0;
      for (let i = 0; i < d.length; i++) {
        if (i % hold === 0) held = Math.round(d[i] * levels) / levels;
        d[i] = held;
      }
    }
    return buf;
  }
  // Noise makes some recipes peak a little differently every render: keep them all under full scale.
  function trim(buf, ceil = 0.99) {
    let p = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); }
    if (p > ceil) for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= ceil / p; }
    return buf;
  }
  const metalFreqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
  function metal(c, dest, dur, mul = 1, level = 0.16) {
    const bus = gainNode(c, level); bus.connect(dest);
    for (const f of metalFreqs) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * mul; o.connect(bus); o.start(0); o.stop(dur); }
  }
  // A short decaying tone with a pitch fall, for thumps and drips.
  function tone(c, out, t, f0, f1, len, level, type = 'sine') {
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.setValueAtTime(level, t); g.gain.setTargetAtTime(0, t + 0.01, len / 3);
    o.connect(g).connect(out); o.start(t); o.stop(t + len * 3);
  }

  const RECIPES = {
    kick: () => render(0.6, (c, out) => {
      const sh = shaper(c, 2.5, out);
      const o = c.createOscillator();
      o.frequency.setValueAtTime(180, 0);
      o.frequency.exponentialRampToValueAtTime(55, 0.07);
      o.frequency.exponentialRampToValueAtTime(40, 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.002); g.gain.setTargetAtTime(0, 0.06, 0.11);
      o.connect(g).connect(sh); o.start(0); o.stop(0.6);
      const n = noise(c, 0.03), ng = c.createGain();
      ng.gain.setValueAtTime(0.5, 0); ng.gain.exponentialRampToValueAtTime(0.001, 0.015);
      n.connect(filter(c, 'highpass', 2000)).connect(ng).connect(sh); n.start(0);
    }).then((b) => crunch(b, 2, 11)),

    snare: () => render(0.45, (c, out) => {
      const sh = shaper(c, 1.8, out);
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(300, 0); o.frequency.exponentialRampToValueAtTime(190, 0.04);
      const og = c.createGain(); og.gain.setValueAtTime(0.9, 0); og.gain.setTargetAtTime(0, 0.01, 0.035);
      o.connect(og).connect(sh); o.start(0); o.stop(0.3);
      const n = noise(c, 0.45), pk = filter(c, 'peaking', 5000); pk.gain.value = 6;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.9, 0); ng.gain.setTargetAtTime(0, 0.015, 0.06);
      n.connect(filter(c, 'highpass', 1400)).connect(pk).connect(filter(c, 'lowpass', 10000)).connect(ng).connect(sh); n.start(0);
    }).then((b) => crunch(b, 2, 10)),

    hatC: () => render(0.12, (c, out) => {
      const g = c.createGain(); g.gain.setValueAtTime(0.9, 0); g.gain.setTargetAtTime(0, 0.004, 0.017);
      const bp = filter(c, 'bandpass', 10000, 0.8); bp.connect(filter(c, 'highpass', 7000)).connect(g).connect(out);
      metal(c, bp, 0.12);
      const n = noise(c, 0.12); n.connect(gainNode(c, 0.5)).connect(bp); n.start(0);
    }).then((b) => crunch(b, 2, 10)),

    hatO: () => render(0.5, (c, out) => {
      const g = c.createGain(); g.gain.setValueAtTime(0.8, 0); g.gain.setTargetAtTime(0, 0.01, 0.09);
      const bp = filter(c, 'bandpass', 9500, 0.7); bp.connect(filter(c, 'highpass', 6500)).connect(g).connect(out);
      metal(c, bp, 0.5);
      const n = noise(c, 0.5); n.connect(gainNode(c, 0.5)).connect(bp); n.start(0);
    }).then((b) => crunch(b, 2, 10)),

    ride: () => render(1.2, (c, out) => {
      const g = c.createGain(); g.gain.setValueAtTime(0.7, 0); g.gain.setTargetAtTime(0, 0.01, 0.3);
      const bp = filter(c, 'bandpass', 6500, 1.6); bp.connect(filter(c, 'highpass', 3000)).connect(g).connect(out);
      metal(c, bp, 1.2, 1.5, 0.22);
      const bell = c.createOscillator(); bell.frequency.value = 3150;
      const bg = c.createGain(); bg.gain.setValueAtTime(0.12, 0); bg.gain.setTargetAtTime(0, 0.01, 0.15);
      bell.connect(bg).connect(out); bell.start(0); bell.stop(1.2);
    }).then((b) => crunch(b, 2, 10)),

    crash: () => render(2.2, (c, out) => {
      const g = c.createGain(); g.gain.setValueAtTime(0.9, 0); g.gain.setTargetAtTime(0, 0.02, 0.55);
      const hp = filter(c, 'highpass', 3500); hp.connect(g).connect(out);
      metal(c, hp, 2.2, 1.3, 0.2);
      const n = noise(c, 2.2); n.connect(gainNode(c, 0.7)).connect(hp); n.start(0);
    }).then((b) => crunch(b, 2, 10)),

    // Sub bass at C2 with a reese growl on the attack; pitched per chord at playback.
    bass: () => render(1.1, (c, out) => {
      const f = midiHz(36);
      const sh = shaper(c, 2, out);
      const env = c.createGain();
      env.gain.setValueAtTime(0, 0); env.gain.linearRampToValueAtTime(1, 0.005);
      env.gain.setTargetAtTime(0.55, 0.02, 0.15); env.gain.setTargetAtTime(0, 0.45, 0.12);
      env.connect(sh);
      const sub = c.createOscillator();
      sub.frequency.setValueAtTime(f * 2.5, 0); sub.frequency.exponentialRampToValueAtTime(f, 0.05);
      sub.connect(gainNode(c, 0.9)).connect(env); sub.start(0); sub.stop(1.1);
      const lp = filter(c, 'lowpass', 1600, 3);
      lp.frequency.setValueAtTime(1600, 0); lp.frequency.exponentialRampToValueAtTime(220, 0.3);
      lp.connect(gainNode(c, 0.35)).connect(env);
      for (const dt of [-14, 14]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = dt;
        o.frequency.setValueAtTime(f * 2.5, 0); o.frequency.exponentialRampToValueAtTime(f, 0.05);
        o.connect(lp); o.start(0); o.stop(1.1);
      }
    }).then((b) => crunch(b, 1, 12)),

    // Chip blip at C5: a 25% pulse, the 8-bit part of the sound.
    blip: () => render(0.3, (c, out) => {
      const o = c.createOscillator(); o.setPeriodicWave(pulseWave(c, 0.25)); o.frequency.value = midiHz(72);
      const g = c.createGain(); g.gain.setValueAtTime(0.45, 0); g.gain.setTargetAtTime(0, 0.03, 0.06);
      o.connect(g).connect(out); o.start(0); o.stop(0.3);
    }).then((b) => crunch(b, 2, 6)),

    boing: () => render(0.3, (c, out) => {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(170, 0); o.frequency.exponentialRampToValueAtTime(560, 0.13);
      const g = c.createGain(); g.gain.setValueAtTime(0.7, 0); g.gain.setTargetAtTime(0, 0.08, 0.05);
      o.connect(g).connect(out); o.start(0); o.stop(0.3);
    }).then((b) => crunch(b, 2, 7)),

    riser: () => render(1.5, (c, out) => {
      const n = noise(c, 1.5), bp = filter(c, 'bandpass', 300, 4);
      bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(6000, 1.4);
      const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.9, 1.35); g.gain.linearRampToValueAtTime(0, 1.45);
      n.connect(bp).connect(g).connect(out); n.start(0);
    }),

    whoosh: () => render(0.5, (c, out) => {
      const n = noise(c, 0.5), bp = filter(c, 'bandpass', 2400, 1.5);
      bp.frequency.setValueAtTime(2400, 0); bp.frequency.exponentialRampToValueAtTime(500, 0.45);
      const g = c.createGain(); g.gain.setValueAtTime(0.8, 0); g.gain.setTargetAtTime(0, 0.1, 0.1);
      n.connect(bp).connect(g).connect(out); n.start(0);
    }).then((b) => crunch(b, 2, 8)),

    crumble: () => render(0.7, (c, out) => {
      const n = noise(c, 0.7), lp = filter(c, 'lowpass', 1100);
      const g = c.createGain(); g.gain.setValueAtTime(0, 0);
      for (let i = 0; i < 7; i++) { const t = i * 0.07 + Math.random() * 0.03; g.gain.setValueAtTime(0.9 - i * 0.1, t); g.gain.setTargetAtTime(0, t + 0.005, 0.02); }
      n.connect(lp).connect(g).connect(out); n.start(0);
      const o = c.createOscillator(); o.frequency.setValueAtTime(90, 0); o.frequency.exponentialRampToValueAtTime(40, 0.3);
      const og = c.createGain(); og.gain.setValueAtTime(0.8, 0); og.gain.setTargetAtTime(0, 0.05, 0.08);
      o.connect(og).connect(out); o.start(0); o.stop(0.7);
    }).then((b) => crunch(b, 2, 8)),

    hurt: () => render(0.4, (c, out) => {
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(520, 0); o.frequency.exponentialRampToValueAtTime(110, 0.3);
      const g = c.createGain(); g.gain.setValueAtTime(0.35, 0); g.gain.setTargetAtTime(0, 0.2, 0.05);
      o.connect(g).connect(out); o.start(0); o.stop(0.4);
    }).then((b) => crunch(b, 3, 5)),

    scratch: () => render(0.35, (c, out) => {
      const n = noise(c, 0.35), bp = filter(c, 'bandpass', 900, 3);
      const lfo = c.createOscillator(); lfo.frequency.value = 11; const lg = gainNode(c, 1400);
      lfo.connect(lg).connect(bp.frequency); lfo.start(0); lfo.stop(0.35);
      const g = c.createGain(); g.gain.setValueAtTime(0.9, 0); g.gain.setTargetAtTime(0, 0.2, 0.05);
      n.connect(bp).connect(g).connect(out); n.start(0);
    }).then((b) => crunch(b, 2, 8)),

    // Dash: air torn upward past your ears, and the push-off thump.
    dash: () => render(0.35, (c, out) => {
      const n = noise(c, 0.35), bp = filter(c, 'bandpass', 700, 2);
      bp.frequency.setValueAtTime(700, 0); bp.frequency.exponentialRampToValueAtTime(5200, 0.16);
      const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.03); g.gain.setTargetAtTime(0, 0.1, 0.05);
      n.connect(bp).connect(g).connect(out); n.start(0);
      tone(c, out, 0, 140, 50, 0.12, 0.5);
    }).then((b) => crunch(b, 2, 8)),

    // RPG text blip at C5, pitched per letter at playback.
    talk: () => render(0.07, (c, out) => {
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(midiHz(72) * 1.06, 0); o.frequency.exponentialRampToValueAtTime(midiHz(72), 0.02);
      const g = c.createGain(); g.gain.setValueAtTime(0.45, 0); g.gain.setValueAtTime(0.45, 0.035); g.gain.linearRampToValueAtTime(0, 0.06);
      o.connect(filter(c, 'lowpass', 3200)).connect(g).connect(out); o.start(0); o.stop(0.07);
    }).then((b) => crunch(b, 3, 5)),

    // A spell lands on something: a dry crack of noise over a falling body thump.
    thwack: () => render(0.3, (c, out) => {
      const sh = shaper(c, 3, out);
      const n = noise(c, 0.3), ng = c.createGain();
      ng.gain.setValueAtTime(1, 0); ng.gain.setTargetAtTime(0, 0.004, 0.02);
      n.connect(filter(c, 'bandpass', 1800, 1.2)).connect(ng).connect(sh); n.start(0);
      tone(c, sh, 0, 260, 70, 0.1, 0.9, 'triangle');
    }).then((b) => crunch(b, 2, 7)),

    // Something dies: a falling chip squeal and a puff of dust.
    poof: () => render(0.7, (c, out) => {
      const o = c.createOscillator(); o.setPeriodicWave(pulseWave(c, 0.125));
      o.frequency.setValueAtTime(1400, 0); o.frequency.exponentialRampToValueAtTime(90, 0.4);
      const og = c.createGain(); og.gain.setValueAtTime(0.35, 0); og.gain.setTargetAtTime(0, 0.25, 0.06);
      o.connect(og).connect(out); o.start(0); o.stop(0.7);
      const n = noise(c, 0.7), bp = filter(c, 'bandpass', 3000, 1.5);
      bp.frequency.setValueAtTime(3000, 0); bp.frequency.exponentialRampToValueAtTime(300, 0.5);
      const ng = c.createGain(); ng.gain.setValueAtTime(0, 0); ng.gain.linearRampToValueAtTime(1, 0.02); ng.gain.setTargetAtTime(0, 0.05, 0.12);
      n.connect(bp).connect(ng).connect(out); n.start(0);
    }).then((b) => crunch(b, 3, 6)),

    // A stone door: stick-slip grinding over a low rumble, then it drops into place.
    grind: () => render(2.4, (c, out) => {
      const sh = shaper(c, 1.5, out);
      const n = noise(c, 2.4), grit = c.createGain();
      grit.gain.setValueAtTime(0, 0);
      for (let t = 0.04; t < 1.85; t += rand(0.03, 0.07)) grit.gain.linearRampToValueAtTime(rand(0.25, 1), t);
      grit.gain.linearRampToValueAtTime(0, 1.95);
      n.connect(filter(c, 'lowpass', 520, 2)).connect(gainNode(c, 1.1)).connect(grit);
      n.connect(filter(c, 'bandpass', 1300, 1.5)).connect(gainNode(c, 0.5)).connect(grit);
      grit.connect(sh); n.start(0);
      const rum = c.createOscillator(); rum.frequency.setValueAtTime(48, 0); rum.frequency.linearRampToValueAtTime(40, 1.9);
      const rg = c.createGain(); rg.gain.setValueAtTime(0, 0); rg.gain.linearRampToValueAtTime(0.22, 0.3); rg.gain.setValueAtTime(0.22, 1.8); rg.gain.linearRampToValueAtTime(0, 1.95);
      rum.connect(rg).connect(sh); rum.start(0); rum.stop(2.4);
      tone(c, sh, 1.95, 120, 38, 0.15, 1);
    }).then((b) => crunch(b, 2, 8)),

    // Torn out of the Summoning Tree: wood creaks and groans, then a wet crack at CRACK_AT.
    emerge: () => render(CRACK_AT + 0.9, (c, out) => {
      const sh = shaper(c, 2, out), T = CRACK_AT;
      // Creak: a stick-slip buzz whose rate wanders, ringing two woody resonances.
      const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.setValueAtTime(16, 0);
      for (let t = 0.15; t < T; t += 0.15) saw.frequency.linearRampToValueAtTime(rand(12, 46), t);
      const creak = c.createGain(); creak.gain.setValueAtTime(0, 0);
      for (let t = 0.12; t < T - 0.1; t += 0.22) creak.gain.linearRampToValueAtTime(Math.random() < 0.3 ? 0.2 : 1, t);
      creak.gain.linearRampToValueAtTime(0, T);
      saw.connect(filter(c, 'bandpass', 640, 10)).connect(creak);
      saw.connect(filter(c, 'bandpass', 1480, 14)).connect(gainNode(c, 0.7)).connect(creak);
      creak.connect(gainNode(c, 1.6)).connect(sh); saw.start(0); saw.stop(T);
      // Groan: two detuned saws sagging in pitch behind a closed throat.
      const throat = filter(c, 'lowpass', 380, 8), groan = c.createGain();
      groan.gain.setValueAtTime(0, 0); groan.gain.linearRampToValueAtTime(0.22, T * 0.7); groan.gain.linearRampToValueAtTime(0, T + 0.05);
      throat.connect(groan).connect(sh);
      for (const dt of [-12, 12]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = dt;
        o.frequency.setValueAtTime(62, 0); o.frequency.exponentialRampToValueAtTime(44, T);
        o.connect(throat); o.start(0); o.stop(T + 0.1);
      }
      // The crack: a dry snap, a wet squelch sweeping down, a thump and a few drips.
      const snap = noise(c, 0.03), sg = c.createGain();
      sg.gain.setValueAtTime(1, T); sg.gain.exponentialRampToValueAtTime(0.01, T + 0.03);
      snap.connect(filter(c, 'highpass', 1500)).connect(sg).connect(sh); snap.start(T);
      const wet = noise(c, 0.5), bp = filter(c, 'bandpass', 2400, 5), wg = c.createGain();
      bp.frequency.setValueAtTime(2400, T); bp.frequency.exponentialRampToValueAtTime(320, T + 0.22);
      wg.gain.setValueAtTime(0, 0); wg.gain.setValueAtTime(1.6, T + 0.01); wg.gain.setTargetAtTime(0, T + 0.04, 0.07);
      wet.connect(bp).connect(wg).connect(sh); wet.start(T);
      tone(c, sh, T, 110, 38, 0.25, 0.9);
      for (const dt of [0.16, 0.31, 0.44]) tone(c, sh, T + dt, rand(1500, 2100), 650, 0.03, 0.25);
    }).then((b) => crunch(b, 2, 9)),

    // Night callers. A frog: a buzzy pulse train through two throat formants.
    croak: () => render(0.45, (c, out) => {
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(26, 0); o.frequency.linearRampToValueAtTime(38, 0.28);
      const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.03); g.gain.setValueAtTime(1, 0.22); g.gain.linearRampToValueAtTime(0, 0.32);
      o.connect(filter(c, 'bandpass', 380, 6)).connect(g);
      o.connect(filter(c, 'bandpass', 1050, 5)).connect(gainNode(c, 0.6)).connect(g);
      g.connect(gainNode(c, 2.5)).connect(out); o.start(0); o.stop(0.45);
    }).then((b) => crunch(b, 2, 9)),

    // A tree frog: "ko-kee", a low note then a rising whistle.
    peep: () => render(0.35, (c, out) => {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(1150, 0); o.frequency.setValueAtTime(1900, 0.1); o.frequency.exponentialRampToValueAtTime(2350, 0.22);
      const g = c.createGain(); g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.5, 0.01); g.gain.linearRampToValueAtTime(0, 0.07);
      g.gain.linearRampToValueAtTime(0.7, 0.11); g.gain.setValueAtTime(0.7, 0.18); g.gain.linearRampToValueAtTime(0, 0.24);
      o.connect(g).connect(out); o.start(0); o.stop(0.35);
    }).then((b) => crunch(b, 2, 9)),

    // A far-off potoo: a falling, mournful whistle series, muffled by distance.
    bird: () => render(3, (c, out) => {
      const o = c.createOscillator(), g = c.createGain();
      const vib = c.createOscillator(); vib.frequency.value = 5.5;
      vib.connect(gainNode(c, 9)).connect(o.frequency); vib.start(0); vib.stop(3);
      g.gain.setValueAtTime(0, 0);
      [[900, 0, 1], [820, 0.6, 0.8], [760, 1.15, 0.65], [700, 1.68, 0.5], [640, 2.2, 0.38]].forEach(([hz, t, a]) => {
        o.frequency.setValueAtTime(hz, t); o.frequency.exponentialRampToValueAtTime(hz * 0.9, t + 0.42);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7 * a, t + 0.08); g.gain.linearRampToValueAtTime(0, t + 0.45);
      });
      o.connect(g).connect(filter(c, 'lowpass', 1600)).connect(out); o.start(0); o.stop(3);
    }).then((b) => crunch(b, 2, 10)),

    night: () => Promise.resolve(crunch(renderNight(), 1, 10)),
  };

  // Lush detuned pad per chord, with a slow tape wobble baked in.
  function renderPad(chord) {
    return render(4.4, (c, out) => {
      const lp = filter(c, 'lowpass', 1500, 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.5); g.gain.setValueAtTime(1, 2.9); g.gain.linearRampToValueAtTime(0, 4.3);
      lp.connect(g).connect(out);
      const lfo = c.createOscillator(); lfo.frequency.value = 0.45;
      const depth = gainNode(c, 7); lfo.connect(depth); lfo.start(0); lfo.stop(4.4);
      const notes = chord.pad.concat([36 + chord.root + 12]);
      notes.forEach((m, i) => {
        const pan = c.createStereoPanner(); pan.pan.value = i === notes.length - 1 ? 0 : i % 2 ? 0.4 : -0.4; pan.connect(lp);
        const vg = gainNode(c, i === notes.length - 1 ? 0.12 : 0.07); vg.connect(pan);
        [-9, 0, 9].forEach((dt, k) => {
          const o = c.createOscillator(); o.type = k === 1 ? 'triangle' : 'sawtooth';
          o.frequency.value = midiHz(m); o.detune.value = dt; depth.connect(o.detune);
          o.connect(vg); o.start(0); o.stop(4.4);
        });
      });
    }, 2).then((b) => crunch(b, 1, 12));
  }

  // The insect bed, built sample by sample so it loops seamlessly (every rate divides the loop):
  // crickets near and far at their own pace, a tree cricket trilling on and off, a katydid hiss.
  // At half rate: it all sits under 7 kHz, and it halves the work and memory on a phone.
  const CRICKETS = [ // carrier Hz, chirps per loop, pulses per chirp, pan -1..1, level
    [4400, 10, 3, -0.6, 0.3], [4950, 16, 4, 0.55, 0.22], [3850, 6, 5, 0.15, 0.18],
    [5300, 20, 2, -0.2, 0.1], [4150, 12, 3, 0.85, 0.09], [4700, 8, 6, -0.85, 0.08],
  ];
  function renderNight(sec = 8, sr = SR / 2) {
    const len = sec * sr, TAU = Math.PI * 2;
    const b = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    const L = b.getChannelData(0), R = b.getChannelData(1);
    for (const [hz, chirps, pulses, pan, amp] of CRICKETS) {
      const every = len / chirps, spacing = 0.03 * sr, on = Math.round(0.018 * sr);
      const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4), gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
      for (let k = 0; k < chirps; k++) {
        const a = 0.35 + 0.65 * hash2(k, hz); // no two chirps quite alike
        for (let p = 0; p < pulses; p++) {
          const i0 = Math.round(k * every + p * spacing);
          for (let j = 0; j < on; j++) {
            const i = (i0 + j) % len, e = Math.sin((Math.PI * j) / on), v = a * e * e * Math.sin((TAU * hz * i) / sr);
            L[i] += v * gl; R[i] += v * gr;
          }
        }
      }
    }
    // The hiss is band-passed noise (a biquad at 6.8 kHz, Q 3), run in from the loop's end so the seam is clean.
    const w = (TAU * 6800) / sr, al = Math.sin(w) / 6, a0 = 1 + al;
    const b0 = al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0;
    const nz = new Float32Array(len), hiss = new Float32Array(len);
    for (let i = 0; i < len; i++) nz[i] = Math.random() * 2 - 1;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = -2048; i < len; i++) {
      const x = nz[(i + len) % len], y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      if (i >= 0) hiss[i] = y;
    }
    // The steady oscillators are rotating phasors: far cheaper than Math.sin per sample on a phone.
    const osc = (hz) => ({ c: 1, s: 0, cw: Math.cos((TAU * hz) / sr), sw: Math.sin((TAU * hz) / sr) });
    const turn = (o) => { const c = o.c * o.cw - o.s * o.sw; o.s = o.s * o.cw + o.c * o.sw; o.c = c; };
    const buzz = osc(40), swell = osc(2 / sec), trem = osc(48), carrier = osc(2800), fade = osc(1 / sec);
    for (let i = 0; i < len; i++) {
      const bz = 0.5 + 0.5 * buzz.s, tr = 0.5 + 0.5 * trem.s;
      const v = hiss[i] * bz * bz * (0.5 - 0.5 * swell.c) * 0.45;
      const trill = tr * tr * tr * (0.5 - 0.5 * fade.c) * carrier.s * 0.07;
      L[i] += v + trill * 0.8; R[(i + 3967) % len] += v; R[i] += trill * 0.6;
      turn(buzz); turn(swell); turn(trem); turn(carrier); turn(fade);
    }
    return b;
  }

  // The welcome.mp3 is fetched over http(s) only: from disk any probe for a missing file
  // logs a console error, so file:// pages go straight to speech.
  function loadScream() {
    if (!SCREAM_URL || !/^https?:$/.test(location.protocol) || !window.fetch) return;
    fetch(SCREAM_URL)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => ab && new Promise((res, rej) => new OfflineAudioContext(1, 1, SR).decodeAudioData(ab, res, rej)))
      .then((b) => { screamBuf = b || null; })
      .catch(() => {});
  }

  // Each buffer is started from its own task, so a phone never stalls for long while they render.
  function prepare() {
    if (preparing) return preparing;
    loadScream();
    const jobs = Object.entries(RECIPES).concat(CHORDS.map((chord, i) => ['pad' + i, () => renderPad(chord)]));
    const out = {};
    preparing = Promise.all(jobs.map(([name, job], i) => new Promise((res) => setTimeout(res, i))
      .then(job).then((b) => { out[name] = trim(b); })))
      .then(() => { buffers = out; return buffers; });
    return preparing;
  }

  /* ---------- the mix ---------- */

  // Master soft clipper, so stacked sfx never clip: clean up to 0.8, then peaks round off below
  // full scale. The input is halved first, so the curve spans ±2. No lookahead, so no added latency.
  const clipCurve = new Float32Array(4096).map((_, i, a) => {
    const x = ((i / (a.length - 1)) * 2 - 1) * 2, m = Math.abs(x);
    return Math.sign(x) * (m < 0.8 ? m : 0.8 + 0.18 * Math.tanh((m - 0.8) / 0.18));
  });
  const tapeHz = () => 5200 * Math.pow(17000 / 5200, progress);
  const hushHz = () => 20000 * Math.pow(420 / 20000, hushAmt);
  const ambLevel = () => AMB_LEVEL * (1 - 0.85 * hushAmt); // insects fall quiet when the Hush is near

  function makeImpulse(c, seconds) {
    const len = Math.floor(c.sampleRate * seconds), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, 2.6); }
    }
    return b;
  }
  function makeCrackle(c, seconds) {
    const len = Math.floor(c.sampleRate * seconds), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.04; d[i] = lp * 0.12; }
      const clicks = Math.floor(seconds * 16);
      for (let k = 0; k < clicks; k++) {
        const pos = Math.floor(Math.random() * (len - 40)), amp = Math.pow(Math.random(), 3) * 0.8 * (Math.random() < 0.5 ? -1 : 1);
        const n = 2 + Math.floor(Math.random() * 24);
        for (let j = 0; j < n; j++) d[pos + j] += amp * (1 - j / n) * (j % 2 ? -0.6 : 1);
      }
    }
    return b;
  }

  // music -> hush -> tape -> saturation -> compressor -> master, plus the buses and sends that feed
  // it. Built the same way for the live context and for the offline mix check.
  function buildGraph(c) {
    const g = { c };
    g.master = gainNode(c, MASTER);
    const clip = c.createWaveShaper(); clip.curve = clipCurve;
    g.master.connect(gainNode(c, 0.5)).connect(clip).connect(c.destination);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.2;
    const sat = c.createWaveShaper(); sat.curve = tanhCurve(1.3);
    g.tape = filter(c, 'lowpass', tapeHz(), 0.3);
    g.hush = filter(c, 'lowpass', hushHz(), 0.7);
    g.music = gainNode(c, 1);
    g.music.connect(g.hush).connect(g.tape).connect(sat).connect(comp).connect(g.master);

    g.drums = gainNode(c, 0.9); g.drums.connect(g.music);
    g.ghosts = gainNode(c, 1); g.ghosts.connect(filter(c, 'lowpass', 2600)).connect(g.drums);
    g.sub = gainNode(c, 0.85); g.sub.connect(g.music);
    g.pads = gainNode(c, PAD_LEVEL); g.pads.connect(g.music);
    g.chip = gainNode(c, 0.3); g.chip.connect(g.music);
    g.amb = gainNode(c, 0); g.amb.connect(g.hush);

    g.reverb = c.createConvolver(); g.reverb.buffer = makeImpulse(c, 2.6);
    g.reverb.connect(gainNode(c, 0.35)).connect(g.music);
    g.delay = c.createDelay(1); g.delay.delayTime.value = STEP * 3;
    const fb = gainNode(c, 0.38), dlp = filter(c, 'lowpass', 2500);
    g.delay.connect(dlp).connect(fb).connect(g.delay);
    dlp.connect(gainNode(c, 0.5)).connect(g.music);

    g.sfx = gainNode(c, 0.6); g.sfx.connect(g.master);
    g.crackle = gainNode(c, 0); g.crackle.connect(g.master);
    return g;
  }

  // Vinyl crackle and the night jungle: all you hear before the first carve.
  function startCrackle(g, fade) {
    const c = g.c, s = c.createBufferSource();
    s.buffer = makeCrackle(c, 3); s.loop = true;
    s.connect(filter(c, 'highpass', 250)).connect(g.crackle); s.start(c.currentTime);
    g.crackle.gain.setTargetAtTime(0.28, c.currentTime, fade);
  }
  function startNight(g, fade) {
    const c = g.c, s = c.createBufferSource();
    s.buffer = buffers.night; s.loop = true;
    s.connect(g.amb); s.start(c.currentTime, rand(0, buffers.night.duration));
    g.amb.gain.setTargetAtTime(ambLevel(), c.currentTime, fade);
  }

  function call(cr, t, g = G, loudest = false) {
    const n = loudest ? 1 : 1 + Math.floor(Math.random() * cr.calls), pan = rand(-0.8, 0.8), rate = rand(0.88, 1.12);
    for (let i = 0; i < n; i++) {
      play(cr.name, t + i * cr.every * rand(0.9, 1.1), { gain: loudest ? cr.gain[1] : rand(...cr.gain), rate, pan, bus: 'amb', send: cr.send }, g);
    }
  }
  function ambience() {
    const now = ctx.currentTime;
    for (const cr of CRITTERS) {
      if (!(cr.name in nextCall)) nextCall[cr.name] = now + rand(...cr.gap) / 2;
      if (now < nextCall[cr.name]) continue;
      call(cr, now + 0.05);
      nextCall[cr.name] = now + rand(...cr.gap);
    }
  }

  // Call from the first tap or click: iOS only starts audio (and speech) inside a user gesture,
  // so everything up to resume() happens synchronously here.
  function unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older WebKit */ }
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      G = buildGraph(ctx);
      if (muted) G.master.gain.value = 0;
      analyser = ctx.createAnalyser(); analyser.fftSize = 64; analyser.smoothingTimeConstant = 0.7;
      G.master.connect(analyser);
      ctx.onstatechange = wake; // e.g. iOS 'interrupted' by a call
      timer = setInterval(tick, 25);
    }
    const resumed = ctx.state === 'running' ? Promise.resolve() : Promise.resolve(ctx.resume()).catch(() => {});
    const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
    primeSpeech();
    return Promise.all([resumed, prepare()]).then(() => {
      if (!bedsOn) { bedsOn = true; startCrackle(G, 0.6); startNight(G, 0.6); }
      return ctx;
    });
  }

  // Resume after an interruption or a trip to the background, as soon as the browser allows.
  function wake() {
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) Promise.resolve(ctx.resume()).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) Promise.resolve(ctx.suspend()).catch(() => {});
    else wake();
  });
  for (const type of ['focus', 'pageshow']) window.addEventListener(type, wake);
  for (const type of ['touchend', 'pointerup', 'mousedown', 'keydown']) window.addEventListener(type, wake, { capture: true, passive: true });

  /* ---------- playback ---------- */

  function play(name, t, { gain = 1, rate = 1, bus = 'drums', send = 0, echo = 0, pan = 0 } = {}, g = G) {
    if (!g || !buffers || !buffers[name]) return null;
    const c = g.c, s = c.createBufferSource();
    s.buffer = buffers[name];
    s.playbackRate.value = rate;
    let node = s.connect(gainNode(c, gain));
    if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(g[bus]);
    if (send) node.connect(gainNode(c, send)).connect(g.reverb);
    if (echo) node.connect(gainNode(c, echo)).connect(g.delay);
    s.start(Math.max(t, c.currentTime));
    return s;
  }

  function duck(t, g) {
    const p = g.pads.gain;
    p.setTargetAtTime(PAD_LEVEL * 0.45, t, 0.004);
    p.setTargetAtTime(PAD_LEVEL, t + 0.04, 0.09);
  }

  const rootRate = (chord) => Math.pow(2, chord.root / 12);

  function playLane(lane, t, level, chord, ghost = false, g = G) {
    const bus = ghost ? 'ghosts' : lane === 'bass' ? 'sub' : 'drums';
    if (lane === 'kick') { if (!ghost) duck(t, g); return play('kick', t, { gain: level, bus }, g); }
    if (lane === 'snare') return play('snare', t, { gain: 0.72 * level, bus, send: 0.12 }, g);
    return play('bass', t, { gain: 0.95 * level, bus, rate: rootRate(chord) }, g);
  }

  const stepAt = (t0, gs) => t0 + gs * STEP + (gs & 1 ? STEP * SWING : 0);
  const stepTime = (gs) => stepAt(startTime, gs);
  const chordIndexAt = (gs) => mod(Math.floor(gs / LOOP), CHORDS.length);
  const chordAt = (gs) => CHORDS[chordIndexAt(gs)];

  // Everything one 16th step plays: pad, guide hats, the carved song and your ghosts, the gift.
  // The offline mix check passes its own graph and groove, and the parts it wants to hear.
  function scheduleStep(gs, t, { g = G, sq = seq, parts = null } = {}) {
    const s = mod(gs, LOOP), chord = chordAt(gs), on = (part) => !parts || parts.has(part);
    if (s === 0 && on('pad')) play('pad' + chordIndexAt(gs), t, { bus: 'pads', send: 0.5 }, g);
    const h = HATS[s];
    if (h && on('hats')) play(h > 0 ? 'hatC' : 'hatO', t, { gain: Math.abs(h) * (0.5 + progress * 0.3), pan: 0.15 }, g);
    for (const lane of LANES) {
      if (!on(lane)) continue;
      const { carved, ghost } = sq.shouldPlay(lane, gs);
      if (!carved && !ghost) continue;
      const src = playLane(lane, t, carved ? 1 : 0.6, chord, ghost, g);
      if (g !== G) continue;
      const ev = { lane, t, ghost };
      events.push(ev);
      if (ghost && src) pendingGhost[lane] = { gs, t, src, ev };
    }
    if (gift && on('gift')) {
      if (s % 2 === 0) {
        const note = chord.pad[ARP[(s / 2) % ARP.length] % chord.pad.length] + 12;
        play('blip', t, { gain: 0.55, rate: Math.pow(2, (note - 72) / 12), bus: 'chip', echo: 0.5, pan: s % 4 ? 0.3 : -0.3 }, g);
      }
      if (s % 4 === 2) play('ride', t, { gain: 0.25, pan: -0.2 }, g);
    }
  }

  function tick() {
    if (!ctx) return;
    if (bedsOn) ambience();
    if (!running) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (;;) {
      const t = stepTime(nextStep);
      if (t > horizon) break;
      if (t >= ctx.currentTime - 0.03) scheduleStep(nextStep, t);
      nextStep++;
    }
  }

  function start(delaySec = 0.05) {
    if (!ctx) return 0;
    startTime = ctx.currentTime + delaySec;
    nextStep = 0;
    running = true;
    tick();
    return startTime;
  }

  // Context time currently reaching the listener's ears.
  function heardAt(perfMs) {
    if (!ctx) return 0;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) + (perfMs - performance.now()) / 1000;
  }
  const heardPos = (perfMs) => (running ? (heardAt(perfMs) - startTime) / STEP : -1);
  const pos = () => heardPos(performance.now());
  // Input timestamps arrive latencyMs after the touch really happened (calibrated per device).
  const posAt = (perfMs) => heardPos(perfMs - latencyMs);

  // 1 on each quarter note, falling to 0 by the next one.
  function beatPulse() {
    const p = pos();
    if (p < 0) return 0;
    const f = p / 4 - Math.floor(p / 4);
    return (1 - f) * (1 - f);
  }

  /* ---------- your moves ---------- */

  // Plays a move's sound right now and writes it into the draft, quantized to 8ths.
  function hit(lane, perfMs = performance.now()) {
    if (!ctx) return { onBeat: false, errMs: 0, step: 0 };
    const p = posAt(perfMs);
    playLane(lane, ctx.currentTime, 1, chordAt(Math.max(0, Math.floor(p))));
    if (!running || p < 0) return { onBeat: false, errMs: 0, step: 0 };
    const j = seq.judge(p);
    // Played live a hair before its own ghost, which the lookahead already scheduled: silence the ghost.
    const pend = pendingGhost[lane];
    if (pend && pend.gs === j.q && pend.t > ctx.currentTime) {
      pend.src.stop();
      const i = events.indexOf(pend.ev);
      if (i >= 0) events.splice(i, 1);
      pendingGhost[lane] = null;
    }
    seq.record(lane, j.q);
    return { onBeat: j.onBeat, errMs: j.errMs, step: j.step };
  }

  function toggle(lane, s) {
    const on = seq.toggle(lane, s);
    if (on && ctx) playLane(lane, ctx.currentTime, 0.8, currentChord());
    return on;
  }
  function resetSong() { seq.reset(); gift = false; }

  function drain(cb) {
    const now = heardAt(performance.now());
    while (events.length && events[0].t <= now) cb(events.shift());
    if (events.length > 256) events.splice(0, events.length - 256);
  }

  /* ---------- sound effects ---------- */

  function nextStepTime() {
    if (!running) return ctx.currentTime;
    const g = Math.ceil((ctx.currentTime + 0.01 - startTime) / STEP);
    return Math.max(ctx.currentTime, stepTime(g));
  }
  function nextBarTime() {
    if (!running) return ctx.currentTime + 0.1;
    const g = Math.ceil((ctx.currentTime + 0.05 - startTime) / STEP / 16) * 16;
    return stepTime(g);
  }
  function currentChord() { return chordAt(Math.max(0, Math.floor(pos()))); }
  function note(midi, t, gain = 0.6, echo = 0.35) { play('blip', t, { gain, rate: Math.pow(2, (midi - 72) / 12), bus: 'chip', echo }); }

  const sfx = {
    firefly(combo) {
      if (!ctx) return;
      const tones = currentChord().pad;
      note(tones[combo % tones.length] + 12 * (1 + Math.floor(combo / tones.length) % 2), nextStepTime(), 0.5);
    },
    boing() { if (ctx) play('boing', ctx.currentTime, { gain: 0.5, rate: rootRate(currentChord()), bus: 'sfx' }); },
    whoosh() { if (ctx) play('whoosh', ctx.currentTime, { gain: 0.6, bus: 'sfx', send: 0.3 }); },
    crumble() { if (ctx) play('crumble', ctx.currentTime, { gain: 0.7, bus: 'sfx' }); },
    hurt() { if (ctx) { play('hurt', ctx.currentTime, { gain: 0.5, bus: 'sfx' }); play('scratch', ctx.currentTime, { gain: 0.5, bus: 'sfx' }); } },
    ui() { if (ctx) note(84, ctx.currentTime, 0.35, 0); },
    unlock() {
      if (!ctx) return;
      const t0 = nextStepTime(), tones = currentChord().pad;
      [0, 1, 2, 3, 2, 3].forEach((k, i) => note(tones[k] + 12, t0 + i * STEP * 2, 0.55, 0.4));
    },
    carve() {
      if (!ctx) return 0;
      const t = nextBarTime();
      const rate = clamp(1.35 / Math.max(0.2, t - ctx.currentTime), 0.8, 3); // riser peaks on the downbeat
      play('riser', t - 1.35 / rate, { gain: 0.5, bus: 'sfx', rate });
      play('crash', t, { gain: 0.55, send: 0.3 });
      play('kick', t, { gain: 1 });
      return t;
    },
    finale() {
      if (!ctx) return;
      const t = nextBarTime();
      play('crash', t, { gain: 0.7, send: 0.4 }); play('kick', t, { gain: 1 });
      play('bass', t, { gain: 1, bus: 'sub', rate: rootRate(chordAt(Math.round((t - startTime) / STEP))) });
      gift = true;
    },
    // One hit per word of the intro scream.
    slam(i) {
      if (!ctx) return;
      const t = ctx.currentTime;
      play('kick', t, { gain: 1 });
      play('crash', t, { gain: 0.35 + i * 0.15, send: 0.5 });
      if (i === 2) play('snare', t, { gain: 0.8, send: 0.6 });
    },
    riser() { if (ctx) play('riser', ctx.currentTime, { gain: 0.55, bus: 'sfx' }); },
    drop(t) {
      if (!ctx) return;
      play('crash', t, { gain: 0.7, send: 0.5 }); play('kick', t, { gain: 1 });
      play('snare', t, { gain: 0.8, send: 0.5 }); play('bass', t, { gain: 1, bus: 'sub', rate: rootRate(CHORDS[0]) });
    },
    dash() { if (ctx) play('dash', ctx.currentTime, { gain: 0.7, bus: 'sfx', send: 0.1 }); },
    // Two octaves up the current chord on the grid, then a shimmer.
    levelup() {
      if (!ctx) return;
      const t0 = nextStepTime(), tones = currentChord().pad;
      [0, 1, 2, 3, 0, 1, 2, 3].forEach((k, i) => note(tones[k] + (i < 4 ? 0 : 12), t0 + i * STEP, 0.5, 0.3));
      note(tones[0] + 24, t0 + 8 * STEP, 0.6, 0.5);
      play('ride', t0 + 8 * STEP, { gain: 0.35, bus: 'sfx', send: 0.4 });
    },
    // One blip per letter: a random chord tone, shifted by voice (semitones). Fast calls are dropped.
    talk(voice = 0) {
      if (!ctx || ctx.currentTime - lastTalk < 0.045) return;
      lastTalk = ctx.currentTime;
      const tones = currentChord().pad, m = tones[Math.floor(Math.random() * tones.length)] + 12 + voice;
      play('talk', ctx.currentTime, { gain: 0.3, rate: Math.pow(2, (m - 72) / 12), bus: 'sfx' });
    },
    hitEnemy() { if (ctx) play('thwack', ctx.currentTime, { gain: 0.8, bus: 'sfx', rate: rand(0.9, 1.1) }); },
    enemyDie() {
      if (!ctx) return;
      play('poof', ctx.currentTime, { gain: 0.65, bus: 'sfx', send: 0.25 });
      const tones = currentChord().pad;
      note(tones[Math.floor(Math.random() * tones.length)] + 24, nextStepTime(), 0.35, 0.45);
    },
    door() { if (ctx) play('grind', ctx.currentTime, { gain: 0.9, bus: 'sfx', send: 0.35 }); },
    // Returns the seconds until the crack, so the intro can tear the wizard free on it.
    emerge() {
      if (!ctx) return CRACK_AT;
      play('emerge', ctx.currentTime, { gain: 1, bus: 'sfx', send: 0.3 });
      return CRACK_AT;
    },
  };

  /* ---------- the scream ---------- */

  // iOS: one utterance spoken inside a gesture lets later speech through, even after an await.
  function primeSpeech() {
    if (spoke || !('speechSynthesis' in window)) return;
    spoke = true;
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0;
    speechSynthesis.speak(u);
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    spoke = true;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9; u.pitch = 1.3; u.volume = 1;
    const voice = speechSynthesis.getVoices().find((v) => /^en[-_](US|GB)/i.test(v.lang));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
  // Your welcome.mp3 if it loaded, else a text-to-speech stand-in. Synchronous, so it can be
  // called straight from the tap handler (iOS only speaks inside a gesture).
  function scream() {
    if (screamBuf && ctx) {
      const s = ctx.createBufferSource(); s.buffer = screamBuf;
      s.connect(gainNode(ctx, 1.5)).connect(G.sfx); s.start();
    } else speak('Welcome to the jungle!');
  }

  /* ---------- controls ---------- */

  function setHush(amount) {
    hushAmt = clamp(amount, 0, 1);
    if (!G) return;
    G.hush.frequency.setTargetAtTime(hushHz(), ctx.currentTime, 0.12);
    if (bedsOn) G.amb.gain.setTargetAtTime(ambLevel(), ctx.currentTime, 0.3);
  }
  function setProgress(p) {
    progress = clamp(p, 0, 1);
    if (G) G.tape.frequency.setTargetAtTime(tapeHz(), ctx.currentTime, 0.8);
  }
  function setGift(on) { gift = on; }
  function toggleMute() {
    muted = !muted;
    if (G) G.master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.03);
    return muted;
  }
  const spectrum = new Uint8Array(32);
  function readSpectrum() { if (analyser) analyser.getByteFrequencyData(spectrum); return spectrum; }

  /* ---------- dev: mix check ---------- */

  function levels(buf) {
    const win = Math.round(0.05 * buf.sampleRate), chs = [];
    for (let ch = 0; ch < buf.numberOfChannels; ch++) chs.push(buf.getChannelData(ch));
    let peak = 0, sum = 0, acc = 0, hot = 0;
    for (let i = 0; i < buf.length; i++) {
      let e = 0;
      for (const d of chs) { e += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
      e /= chs.length; sum += e; acc += e;
      if ((i + 1) % win === 0) { hot = Math.max(hot, Math.sqrt(acc / win)); acc = 0; }
    }
    return { peak, rms: Math.sqrt(sum / buf.length), hot };
  }
  // Roughly what a phone speaker keeps: little below 200 Hz.
  async function phoneHot(buf) {
    const c = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate), s = c.createBufferSource();
    s.buffer = buf;
    s.connect(filter(c, 'highpass', 200)).connect(filter(c, 'highpass', 200)).connect(c.destination);
    s.start();
    return levels(await c.startRendering()).hot;
  }
  // Renders two bars of a full groove offline through the real mix chain, part by part and all
  // together, and measures what reaches the output: {part: {peak, rms, hot, phone}}. hot is the
  // loudest 50 ms, phone the same through a phone-speaker high-pass. night is the insect bed with
  // every critter at its loudest, vinyl the crackle. Reflects the current progress and hush.
  async function mixReport() {
    await prepare();
    const groove = Sequencer.create();
    const pattern = { kick: [0, 10, 16, 26], snare: [4, 12, 20, 28], bass: [0, 6, 16, 22] };
    for (const lane of LANES) for (const s of pattern[lane]) groove.toggle(lane, s);
    const music = ['kick', 'snare', 'bass', 'hats', 'pad'];
    const report = {};
    for (const part of [...music, 'night', 'vinyl', 'mix']) {
      const c = new OfflineAudioContext(2, Math.ceil((LOOP * STEP + 0.4) * SR), SR), g = buildGraph(c);
      if (part === 'night' || part === 'mix') {
        startNight(g, 0.01);
        CRITTERS.forEach((cr, i) => call(cr, 0.3 + i * 0.7, g, true));
      }
      if (part === 'vinyl' || part === 'mix') startCrackle(g, 0.01);
      const parts = new Set(part === 'mix' ? music : [part]);
      for (let gs = 0; gs < LOOP; gs++) scheduleStep(gs, stepAt(0.05, gs), { g, sq: groove, parts });
      const buf = await c.startRendering();
      report[part] = Object.assign(levels(buf), { phone: await phoneHot(buf) });
    }
    return report;
  }

  return {
    prepare, unlock, start, pos, posAt, hit, carve: () => seq.carve(), toggle, clearLane: (lane) => seq.clearLane(lane), resetSong, drain,
    draftCount: (lane) => seq.draftCount(lane), songCount: (lane) => seq.songCount(lane), beatPulse,
    setHush, setProgress, setGift, toggleMute, readSpectrum, scream, sfx, mixReport,
    seq, song: seq.song, draft: seq.draft, CHORDS,
    get running() { return running; },
    get muted() { return muted; },
    get ready() { return !!buffers; },
    get latencyMs() { return latencyMs; },
    set latencyMs(ms) { latencyMs = clamp(Number(ms) || 0, -500, 500); },
    chordName() { return running ? currentChord().name : CHORDS[0].name; },
    chordIndex() { return running ? chordIndexAt(Math.max(0, pos())) : 0; },
  };
})();
