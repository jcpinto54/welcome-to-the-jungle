'use strict';
/* sound.js: the lo-fi jungle engine.
   Everything is synthesized in the browser. Drums, sub bass, pads and one-shots are
   rendered once into buffers (then crunched a little, like an old sampler), and a
   170 BPM transport plays the loop. Your moves write into that loop. */

const Sound = (() => {
  const SWING = 0.1; // odd 16ths land a touch late: lazier, more lo-fi
  const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead of time
  const BEAT_WINDOW = 0.075; // +- seconds that count as "on the beat"
  const DRAFT_CAP = { kick: 6, snare: 6, bass: 4 };
  const SONG_CAP = 12;
  const PAD_LEVEL = 0.3;
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

  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  let ctx = null, buffers = null, preparing = null;
  let master, analyser, tape, hush, drums, ghostBus, bassBus, padBus, chip, reverb, delay, sfxBus, crackleGain;
  let startTime = 0, nextStep = 0, running = false, timer = null;
  let muted = false, gift = false, progress = 0;
  const song = {}, draft = {}, order = {};
  const events = [];
  for (const lane of LANES) { song[lane] = new Uint8Array(LOOP); draft[lane] = new Int32Array(LOOP).fill(-1); order[lane] = []; }

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
    const c = new OfflineAudioContext(channels, Math.ceil(dur * 44100), 44100);
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
  const metalFreqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
  function metal(c, dest, dur, mul = 1, level = 0.16) {
    const bus = gainNode(c, level); bus.connect(dest);
    for (const f of metalFreqs) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * mul; o.connect(bus); o.start(0); o.stop(dur); }
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

  function prepare() {
    if (preparing) return preparing;
    const names = Object.keys(RECIPES);
    preparing = Promise.all([...names.map((n) => RECIPES[n]()), ...CHORDS.map(renderPad)]).then((list) => {
      buffers = {};
      names.forEach((n, i) => { buffers[n] = list[i]; });
      CHORDS.forEach((_, i) => { buffers['pad' + i] = list[names.length + i]; });
      return buffers;
    });
    return preparing;
  }

  /* ---------- live graph ---------- */

  function makeImpulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, 2.6); }
    }
    return b;
  }
  function makeCrackle(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
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

  function buildGraph() {
    master = gainNode(ctx, 0.9);
    analyser = ctx.createAnalyser(); analyser.fftSize = 64; analyser.smoothingTimeConstant = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.2;
    const sat = ctx.createWaveShaper(); sat.curve = tanhCurve(1.3);
    tape = filter(ctx, 'lowpass', 5200, 0.3);
    hush = filter(ctx, 'lowpass', 20000, 0.7);
    const music = gainNode(ctx, 1);
    music.connect(hush).connect(tape).connect(sat).connect(comp).connect(master);
    master.connect(analyser);
    master.connect(ctx.destination);

    drums = gainNode(ctx, 0.9); drums.connect(music);
    ghostBus = gainNode(ctx, 1); ghostBus.connect(filter(ctx, 'lowpass', 2600)).connect(drums);
    bassBus = gainNode(ctx, 0.85); bassBus.connect(music);
    padBus = gainNode(ctx, PAD_LEVEL); padBus.connect(music);
    chip = gainNode(ctx, 0.3); chip.connect(music);

    reverb = ctx.createConvolver(); reverb.buffer = makeImpulse(2.6);
    reverb.connect(gainNode(ctx, 0.35)).connect(music);
    delay = ctx.createDelay(1); delay.delayTime.value = STEP * 3;
    const fb = gainNode(ctx, 0.38), dlp = filter(ctx, 'lowpass', 2500);
    delay.connect(dlp).connect(fb).connect(delay);
    dlp.connect(gainNode(ctx, 0.5)).connect(music);

    crackleGain = gainNode(ctx, 0);
    const crackle = ctx.createBufferSource(); crackle.buffer = makeCrackle(3); crackle.loop = true;
    crackle.connect(filter(ctx, 'highpass', 250)).connect(crackleGain).connect(master);
    crackle.start();
    crackleGain.gain.setTargetAtTime(0.28, ctx.currentTime, 0.6);

    sfxBus = gainNode(ctx, 0.6); sfxBus.connect(master);
  }

  // Must be called from a user gesture (browsers only allow sound after one).
  async function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      buildGraph();
    }
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    await prepare();
    return ctx;
  }

  /* ---------- playback ---------- */

  function play(name, t, { gain = 1, rate = 1, bus = drums, send = 0, echo = 0, pan = 0 } = {}) {
    if (!ctx || !buffers || !buffers[name]) return null;
    const s = ctx.createBufferSource();
    s.buffer = buffers[name];
    s.playbackRate.value = rate;
    let node = s.connect(gainNode(ctx, gain));
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(bus);
    if (send) node.connect(gainNode(ctx, send)).connect(reverb);
    if (echo) node.connect(gainNode(ctx, echo)).connect(delay);
    s.start(Math.max(t, ctx.currentTime));
    return s;
  }

  function duck(t) {
    const g = padBus.gain;
    g.setTargetAtTime(PAD_LEVEL * 0.45, t, 0.004);
    g.setTargetAtTime(PAD_LEVEL, t + 0.04, 0.09);
  }

  const rootRate = (chord) => Math.pow(2, chord.root / 12);

  function playLane(lane, t, level, chord, ghost = false) {
    const bus = ghost ? ghostBus : lane === 'bass' ? bassBus : drums;
    if (lane === 'kick') { play('kick', t, { gain: level, bus }); if (!ghost) duck(t); }
    else if (lane === 'snare') play('snare', t, { gain: 0.72 * level, bus, send: 0.12 });
    else play('bass', t, { gain: 0.95 * level, bus, rate: rootRate(chord) });
  }

  const stepTime = (g) => startTime + g * STEP + (g & 1 ? STEP * SWING : 0);
  const chordAt = (g) => CHORDS[mod(Math.floor(g / LOOP), CHORDS.length)];

  function scheduleStep(g, t) {
    const s = mod(g, LOOP), chord = chordAt(g);
    if (s === 0) play('pad' + mod(Math.floor(g / LOOP), CHORDS.length), t, { bus: padBus, send: 0.5 });
    const h = HATS[s];
    if (h) play(h > 0 ? 'hatC' : 'hatO', t, { gain: Math.abs(h) * (0.5 + progress * 0.3), pan: 0.15 });
    for (const lane of LANES) {
      const born = draft[lane][s];
      const carved = song[lane][s] === 1;
      const ghost = !carved && born >= 0 && g - born >= LOOP;
      if (carved || ghost) {
        playLane(lane, t, carved ? 1 : 0.6, chord, ghost);
        events.push({ lane, t, ghost });
      }
    }
    if (gift) {
      if (s % 2 === 0) {
        const note = chord.pad[ARP[(s / 2) % ARP.length] % chord.pad.length] + 12;
        play('blip', t, { gain: 0.55, rate: Math.pow(2, (note - 72) / 12), bus: chip, echo: 0.5, pan: s % 4 ? 0.3 : -0.3 });
      }
      if (s % 4 === 2) play('ride', t, { gain: 0.25, pan: -0.2 });
    }
  }

  function tick() {
    if (!running || !ctx) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    for (;;) {
      const t = stepTime(nextStep);
      if (t > horizon) break;
      if (t >= ctx.currentTime - 0.03) scheduleStep(nextStep, t);
      nextStep++;
    }
  }

  function start(delaySec = 0.05) {
    startTime = ctx.currentTime + delaySec;
    nextStep = 0;
    running = true;
    if (!timer) timer = setInterval(tick, 25);
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
  const posAt = (perfMs) => (running ? (heardAt(perfMs) - startTime) / STEP : -1);
  const pos = () => posAt(performance.now());

  /* ---------- your moves ---------- */

  function record(lane, g) {
    const s = mod(g, LOOP), list = order[lane];
    if (draft[lane][s] >= 0) list.splice(list.indexOf(s), 1);
    draft[lane][s] = g;
    list.push(s);
    while (list.length > DRAFT_CAP[lane]) draft[lane][list.shift()] = -1;
  }

  // Plays a move's sound right now and writes it into the draft, quantized to 8ths.
  function hit(lane, perfMs = performance.now()) {
    if (!ctx) return { onBeat: false, step: 0 };
    const p = posAt(perfMs);
    playLane(lane, ctx.currentTime, 1, chordAt(Math.max(0, Math.floor(p))));
    if (!running || p < 0) return { onBeat: false, step: 0 };
    const beatErr = (p / 4 - Math.round(p / 4)) * 4 * STEP;
    const q = Math.round(p / 2) * 2;
    record(lane, q);
    return { onBeat: Math.abs(beatErr) <= BEAT_WINDOW, errMs: beatErr * 1000, step: mod(q, LOOP) };
  }

  function draftCount(lane) { return order[lane].length; }
  function songCount(lane) { let n = 0; for (let i = 0; i < LOOP; i++) n += song[lane][i]; return n; }

  // Loop Stones call this: whatever you just played becomes part of the song.
  function carve() {
    const added = [];
    for (const lane of LANES) {
      for (const s of order[lane]) {
        if (!song[lane][s] && songCount(lane) < SONG_CAP) { song[lane][s] = 1; added.push({ lane, s }); }
      }
      order[lane].length = 0;
      draft[lane].fill(-1);
    }
    return added;
  }

  function toggle(lane, s) { song[lane][s] = song[lane][s] ? 0 : 1; if (song[lane][s] && ctx) playLane(lane, ctx.currentTime, 0.8, chordAt(Math.max(0, Math.floor(pos())))); return song[lane][s]; }
  function clearLane(lane) { song[lane].fill(0); }
  function resetSong() { for (const lane of LANES) { song[lane].fill(0); draft[lane].fill(-1); order[lane].length = 0; } gift = false; }

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
  function note(midi, t, gain = 0.6, echo = 0.35) { play('blip', t, { gain, rate: Math.pow(2, (midi - 72) / 12), bus: chip, echo }); }

  const sfx = {
    firefly(combo) {
      if (!ctx) return;
      const tones = currentChord().pad;
      note(tones[combo % tones.length] + 12 * (1 + Math.floor(combo / tones.length) % 2), nextStepTime(), 0.5);
    },
    boing() { if (ctx) play('boing', ctx.currentTime, { gain: 0.5, rate: rootRate(currentChord()), bus: sfxBus }); },
    whoosh() { if (ctx) play('whoosh', ctx.currentTime, { gain: 0.6, bus: sfxBus, send: 0.3 }); },
    crumble() { if (ctx) play('crumble', ctx.currentTime, { gain: 0.7, bus: sfxBus }); },
    hurt() { if (ctx) { play('hurt', ctx.currentTime, { gain: 0.5, bus: sfxBus }); play('scratch', ctx.currentTime, { gain: 0.5, bus: sfxBus }); } },
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
      play('riser', t - 1.35 / rate, { gain: 0.5, bus: sfxBus, rate });
      play('crash', t, { gain: 0.55, send: 0.3 });
      play('kick', t, { gain: 1 });
      return t;
    },
    finale() {
      if (!ctx) return;
      const t = nextBarTime();
      play('crash', t, { gain: 0.7, send: 0.4 }); play('kick', t, { gain: 1 }); play('bass', t, { gain: 1, bus: bassBus, rate: rootRate(chordAt(Math.round((t - startTime) / STEP))) });
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
    riser() { if (ctx) play('riser', ctx.currentTime, { gain: 0.55, bus: sfxBus }); },
    drop(t) {
      play('crash', t, { gain: 0.7, send: 0.5 }); play('kick', t, { gain: 1 });
      play('snare', t, { gain: 0.8, send: 0.5 }); play('bass', t, { gain: 1, bus: bassBus, rate: rootRate(CHORDS[0]) });
    },
  };

  /* ---------- the scream ---------- */

  // Plays assets/audio/welcome.mp3 if you add one; otherwise a text-to-speech stand-in.
  function scream() {
    let settled = false;
    const speak = () => {
      if (settled) return;
      settled = true;
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance('Welcome to the jungle!');
      u.rate = 0.9; u.pitch = 1.3; u.volume = 1;
      const voice = speechSynthesis.getVoices().find((v) => /^en[-_](US|GB)/i.test(v.lang));
      if (voice) u.voice = voice;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    };
    try {
      const a = new window.Audio(SCREAM_URL);
      a.addEventListener('error', speak, { once: true });
      a.addEventListener('playing', () => { settled = true; }, { once: true });
      const p = a.play();
      if (p && p.catch) p.catch(speak);
      setTimeout(speak, 900); // missing file and no error yet: don't leave the intro silent
    } catch (e) {
      speak();
    }
  }

  /* ---------- controls ---------- */

  function setHush(amount) {
    if (!ctx) return;
    hush.frequency.setTargetAtTime(20000 * Math.pow(420 / 20000, clamp(amount, 0, 1)), ctx.currentTime, 0.12);
  }
  function setProgress(p) {
    progress = clamp(p, 0, 1);
    if (ctx) tape.frequency.setTargetAtTime(5200 * Math.pow(17000 / 5200, progress), ctx.currentTime, 0.8);
  }
  function setGift(on) { gift = on; }
  function toggleMute() {
    muted = !muted;
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.03);
    return muted;
  }
  const spectrum = new Uint8Array(32);
  function readSpectrum() { if (analyser) analyser.getByteFrequencyData(spectrum); return spectrum; }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  return {
    prepare, unlock, start, pos, posAt, hit, carve, toggle, clearLane, resetSong, drain,
    draftCount, songCount, setHush, setProgress, setGift, toggleMute, readSpectrum, scream, sfx,
    song, draft, CHORDS,
    get running() { return running; },
    get muted() { return muted; },
    get ready() { return !!buffers; },
    chordName() { return running ? currentChord().name : CHORDS[0].name; },
    chordIndex() { return running ? mod(Math.floor(Math.max(0, pos()) / LOOP), CHORDS.length) : 0; },
  };
})();
