'use strict';
/* game.js: the glue. Boots every module, runs the states
     boot -> intro -> play <-> (dialogue | book | paused) -> finale -> end (+ jam mode)
   and plays the game between them: the third-person camera, walking and wading, the four
   spells (Sound.hit writes each drum into the draft), the Hush, fireflies and levels, the Loop
   Stones, the spirits, the gates and the Lost Pyramid. Numbers and rules live in rules.js.
   window.JW is the test hook described in docs/ARCHITECTURE.md. */

const Game = (() => {
  const L = Terrain.L;
  const H = (x, z) => Terrain.heightAt(x, z);
  const SPELL_NAMES = ['stomp', 'bolt', 'quake', 'dash'];
  const ROMAN = ['I', 'II', 'III'];
  const RUN = 7.2; // walking speed, units per second
  const RADIUS = 0.6; // the wizard's collision radius
  const BOOK_DELAY = 1500; // ms of colour flood before the spellbook opens after a carve
  const RIPPLE_T = 1.7; // seconds the rainbow ripple takes to cross the screen
  const INTRO_WORDS = [[0.2, 'WELCOME'], [0.8, 'TO THE'], [1.4, 'JUNGLE']];
  const INTRO_EMERGE = 2.2; // seconds into the intro when the tree starts to tear
  const INTRO_DROP = 0.9; // seconds from the crack to the drop
  const INTRO_HOLD = 2.3; // seconds of title card after the drop
  const FINALE_LINE = 2.2; // seconds per auto-advance of the Eye's lines
  const HANDOVER_YAW = 0.12; // the first gameplay view looks down the causeway, away from the tree
  const noop = () => {};
  const NO_LOOK = { dx: 0, dy: 0 };
  const NO_MOVE = { x: 0, y: 0 };
  // The move input integrated over real time: (x, y) times milliseconds since `t`. Input events
  // add the stretch before them (their listener runs before Input's), frames add the rest, so a
  // key held through a long frame still walks the wizard exactly as far as it was held.
  const moveIn = { x: 0, y: 0, t: 0 };
  function integrateMove(t) {
    if (!(t > moveIn.t)) return;
    const m = Input.move;
    moveIn.x += m.x * (t - moveIn.t);
    moveIn.y += m.y * (t - moveIn.t);
    moveIn.t = t;
  }
  const noteInput = (e) => integrateMove(e.timeStamp > 0 && e.timeStamp <= performance.now() + 1 ? e.timeStamp : performance.now());
  const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const store = {
    get(k) { try { return localStorage.getItem('jw.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('jw.' + k, v); } catch (e) { /* private mode */ } },
  };

  /* ---------- everything the game holds ---------- */

  let canvas = null, uiRoot = null, scene = null, camera = null, W = null, wiz = null, quest = null;
  let phone = false, booted = false;
  let state = 'boot', frames = 0, started = false, startPromise = Promise.resolve();
  let lastFrame = 0, realT = 0, simT = 0, songPos = -1, pulse = 0, loggedError = false;
  let intro = null, finale = null, carving = null, bookTimer = 0, pausedFrom = 'play', talkFocus = null, jam = false;
  let satTarget = 0, satBase = 0, hushLevel = 0, hushSent = -1, forcedAim = null, hints = {}, lastLoopFlash = 0;
  // While he is not in the world yet (boot, the start of the intro) the wizard waits deep underground
  // instead of being hidden: his orb light then counts from the first frame, so no material ever has
  // to be recompiled for a changed number of lights.
  let wizHidden = true;

  // JW.player and JW.abilities hand out these very objects, so they stay live.
  const player = { x: 0, y: 0, z: 0, vibe: 3, maxVibe: 3, fireflies: 0, level: 1 };
  const abilities = { stomp: { unlocked: true, cd01: 0 }, bolt: { unlocked: false, cd01: 0 }, quake: { unlocked: false, cd01: 0 }, dash: { unlocked: true, cd01: 0 } };
  const me = {
    heading: 0, moveHeading: 0, aimHeading: 0, faceAimUntil: 0, xp: 0, speed: 0, moving: false,
    dash: null, dead: false, deadT: 0, iframes: 0, lastHurt: -99, regen: 0, checkpoint: -1, fadeIn: 0, combo: 0, lastFly: -99,
  };
  const cd = { stomp: 0, bolt: 0, quake: 0, dash: 0 }, cdMax = { stomp: 1, bolt: 1, quake: 1, dash: 1 };
  const stats = { casts: 0, pocket: 0, kills: 0, playT: 0 };
  // Desktop: over the right shoulder, so the crosshair stays clear of him. Touch: centred (auto-aim).
  const cam = { yaw: 0, pitch: 0.27, dist: 6.4, height: 2.8, shoulder: 1.15, target: null, lastLook: -99, bootA: 0 };
  const fx = { glitch: 0, flash: 0, shake: 0, ripple: null, satPulse: 0 };
  let moths = [], warden = null, panther = null, toad = null, enemies = [];
  let toadAt = null, blockers = [];
  const rings = [], bolts = [], roots = [];
  let rootMesh = null, shadow = null;

  // scratch objects (no per-frame garbage for vectors)
  let V1, V2, V3, V4, M4, Q4, E4, S4;
  const tmpP = { x: 0, z: 0 };

  /* ---------- boot ---------- */

  function boot() {
    canvas = document.getElementById('screen');
    uiRoot = document.getElementById('ui');
    phone = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    V1 = new THREE.Vector3(); V2 = new THREE.Vector3(); V3 = new THREE.Vector3(); V4 = new THREE.Vector3();
    M4 = new THREE.Matrix4(); Q4 = new THREE.Quaternion(); E4 = new THREE.Euler(); S4 = new THREE.Vector3();
    cam.target = new THREE.Vector3();
    if (phone) { cam.dist = 6.2; cam.shoulder = 0; cam.height = 2.1; cam.pitch = 0.3; }

    safe(() => Promise.resolve(Sound.prepare()).catch(noop)); // instruments render while the boot screen waits
    Render.init(canvas);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(phone ? 64 : 62, Math.max(1, innerWidth) / Math.max(1, innerHeight), 0.1, 400);
    W = World.build(scene, { quality: phone ? 'low' : 'high' });

    wiz = Wizard.create();
    scene.add(wiz.group);
    scene.updateMatrixWorld(true);
    buildCreatures();
    buildEffects();
    blockers = [[L.tree[0], L.tree[1], 4.6], [L.pyramid[0], L.pyramid[1], 15.5]];
    quest = Quest.create(L);

    Input.init(canvas, uiRoot);
    UI.init(uiRoot);
    Input.setMode('menu');
    satTarget = satBase = Rules.saturation(0);
    Render.U.sat.value = satTarget;
    placeAtSpawn();
    scene.updateMatrixWorld(true);
    UI.showBoot(onStart);
    document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'blur']) {
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    }
    // Presses are played the moment Input queues them (these listeners run after its own), not on
    // the next frame: the drum sounds with the touch, even while a slow frame is still being drawn.
    for (const type of ['keydown', 'mousedown', 'pointerdown']) window.addEventListener(type, drainPresses);
    booted = true;
    requestAnimationFrame(frame);
    setTimeout(warmUp, 30);
  }

  // Compiles every material once while the boot screen waits (effects that are hidden until
  // first used included), so play never stalls on a shader.
  function warmUp() {
    const hidden = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    safe(() => Render.renderer.compile(scene, camera));
    for (const o of hidden) o.visible = false;
    if (state !== 'boot') return;
    const r = Render.renderer, keep = camera.position.clone(), q = camera.quaternion.clone();
    snapCamera();
    playCamPose(cam.target.x, cam.target.y, cam.target.z, cam.yaw, cam.pitch, camera.position, V1);
    camera.lookAt(V1);
    safe(() => { r.setRenderTarget(Render.target); r.render(scene, camera); r.setRenderTarget(null); });
    camera.position.copy(keep);
    camera.quaternion.copy(q);
  }

  function buildCreatures() {
    safe(() => Creatures.clear());
    moths = W.mothSpawns.map(([x, z]) => Creatures.moth(scene, x, H(x, z) + 2, z));
    warden = Creatures.warden(scene, L.warden[0], H(L.warden[0], L.warden[1]), L.warden[1]);
    enemies = moths.map((c) => ({ kind: 'moth', c })).concat([{ kind: 'warden', c: warden }]);
    // the Panther Spirit sits on the altar, looking out over the courtyard
    panther = Creatures.panther(scene, L.altar[0], W.altarTop, L.altar[1]);
    panther.group.rotation.y = Math.atan2(13 - L.altar[0], 8 - L.altar[1]);
    // the Sub Toad squats on top of its rock in the pool
    toadAt = new THREE.Vector3(L.toad[0], rockTop(L.toad[0], L.toad[1]), L.toad[1]);
    toad = Creatures.toad(scene, toadAt.x, toadAt.y, toadAt.z);
    toad.group.rotation.y = Math.atan2(28 - L.toad[0], -50 - L.toad[1]);
  }

  // The highest surface straight below (x, z), found once with a ray (the rock is World's mesh).
  function rockTop(x, z) {
    const ground = H(x, z) + 0.45;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0), 0, 40);
    ray.camera = camera; // sprites need one to be tested at all
    const hit = safe(() => ray.intersectObjects(scene.children, true).find((h) => h.object.isInstancedMesh || h.object.isMesh));
    return hit && hit.point.y > ground - 0.6 && hit.point.y < ground + 3 ? hit.point.y - 0.04 : ground;
  }

  function buildEffects() {
    // stomp shockwaves: flat additive rings
    const ringGeo = new THREE.RingGeometry(0.7, 1, 48, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 3;
      scene.add(mesh);
      rings.push({ mesh, live: false, t: 0, life: 0.4, r: 1 });
    }
    // snare bolts: a magenta halo round a white-hot core
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: LANE_HEX.snare, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.set(1.5, 1.5, 1);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xfff0fb, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.scale.set(0.55, 0.55, 1);
      g.add(halo, core);
      g.visible = false;
      scene.add(g);
      bolts.push({ obj: g, halo, live: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 40, travel: 0, range: 38, dmg: 1 });
    }
    // quake roots: gnarled spikes that burst out of the ground, one instanced mesh
    const geo = new THREE.ConeGeometry(0.46, 2.9, 5, 3);
    geo.translate(0, 1.45, 0);
    const p = geo.attributes.position, r = rng(404), seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!seen.has(k)) seen.set(k, [(r() - 0.5) * 0.22, (r() - 0.5) * 0.1, (r() - 0.5) * 0.22]);
      const d = seen.get(k);
      p.setXYZ(i, p.getX(i) + d[0] + Math.sin(p.getY(i) * 1.7) * 0.12, p.getY(i) + d[1], p.getZ(i) + d[2]);
    }
    geo.computeVertexNormals();
    const mat = World.ps1(new THREE.MeshLambertMaterial({ map: TEX.bark, color: 0xc0a898, emissive: 0x3a1a6a, flatShading: true }));
    rootMesh = new THREE.InstancedMesh(geo, mat, 40);
    rootMesh.frustumCulled = false;
    M4.makeScale(0, 0, 0);
    for (let i = 0; i < 40; i++) { rootMesh.setMatrixAt(i, M4); roots.push({ live: false }); }
    rootMesh.instanceMatrix.needsUpdate = true;
    scene.add(rootMesh);
    // a soft blob shadow keeps him on the ground
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: TEX.glow, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    shadow.visible = false;
    scene.add(shadow);
  }

  /* ---------- the boot screen and the start ---------- */

  // The click or tap on the boot screen: iOS only starts audio and speech inside the gesture,
  // so unlock() and scream() run synchronously, before anything is awaited.
  function onStart() {
    if (started) return startPromise;
    started = true;
    let unlocked = null;
    try { unlocked = Sound.unlock(); } catch (e) { unlocked = null; }
    safe(() => Sound.scream());
    startPromise = Promise.resolve(unlocked).then(noop, noop);
    beginIntro();
    return startPromise;
  }

  function startGame() {
    if (!started) {
      const bootEl = uiRoot && uiRoot.querySelector('.jw-boot');
      if (bootEl && !bootEl.hidden) bootEl.click(); // exactly what a click on the boot screen does
      if (!started) onStart();
    }
    return startPromise;
  }

  // Starts the 170 BPM loop; returns the audio time of its first downbeat (0 without audio).
  function startTransport() {
    return Number(safe(() => Sound.start(0.06))) || 0;
  }

  function updateBootCamera(dt) {
    cam.bootA += dt * 0.07;
    const [tx, tz] = L.tree, face = W.tree.face, a = face + Math.sin(cam.bootA) * 0.85, r = 27;
    const x = tx + Math.sin(a) * r, z = tz + Math.cos(a) * r;
    camera.position.set(x, Math.max(H(x, z) + 3, 5.5) + Math.sin(cam.bootA * 0.7) * 1.2, z);
    camera.lookAt(tx, 11, tz);
  }

  /* ---------- the intro: WELCOME TO THE JUNGLE ---------- */

  function beginIntro() {
    state = 'intro';
    Input.setMode('menu');
    const tr = W.tree, face = tr.face;
    const fx0 = Math.sin(face), fz0 = Math.cos(face);
    const wound = tr.wound.getWorldPosition(new THREE.Vector3());
    intro = {
      t0: realT, ms: performance.now(), word: 0, emerging: false, cracked: false, dropped: false, crackAt: Infinity, dropAt: Infinity, endAt: Infinity,
      glow: 0, skippable: store.get('intro') === 'seen', face, fx: fx0, fz: fz0, wound,
      tree: new THREE.Vector3(L.tree[0], tr.group.position.y, L.tree[1]),
    };
    wiz.setEmerge(0);
    wizHidden = true;
    me.heading = face;
    if (intro.skippable) later(0.6, () => { if (state === 'intro') UI.toast(Input.isTouch ? 'TAP TO SKIP' : 'CLICK OR PRESS E TO SKIP', 'info'); });
  }

  function updateIntro(dt) {
    const it = intro, t = realT - it.t0;
    // the words slam in, one drum hit each
    while (it.word < INTRO_WORDS.length && t >= INTRO_WORDS[it.word][0]) {
      const i = it.word++;
      UI.introWord(INTRO_WORDS[i][1], i);
      safe(() => Sound.sfx.slam(i));
      it.glow = 1;
      fx.glitch = Math.max(fx.glitch, 0.22 + i * 0.1);
      fx.satPulse = Math.max(fx.satPulse, 0.3 + i * 0.15); // each word flashes the lost colour back
      shake(0.3 + i * 0.18);
    }
    // the tree tears open and he is ripped out of it
    if (!it.emerging && t >= INTRO_EMERGE) {
      it.emerging = true;
      const crackIn = Number(safe(() => Sound.sfx.emerge())) || 1.9;
      it.crackAt = t + crackIn;
      it.dropAt = it.crackAt + INTRO_DROP;
      it.endAt = it.dropAt + INTRO_HOLD;
      wizHidden = false;
    }
    if (it.emerging) {
      const pre = clamp((t - INTRO_EMERGE) / (it.crackAt - INTRO_EMERGE), 0, 1);
      const out = smoothstep(it.crackAt, it.crackAt + 0.95, t);
      const k = t < it.crackAt ? 0.5 * Math.pow(pre, 1.6) : 0.5 + 0.5 * smoothstep(it.crackAt, it.crackAt + 1.15, t);
      wiz.setEmerge(k);
      const d = lerp(2.7 + 0.5 * pre, 7.4, out) + (it.dropped ? 4 * smoothstep(it.dropAt, it.dropAt + 0.6, t) : 0);
      const x = it.tree.x + it.fx * d, z = it.tree.z + it.fz * d;
      const held = it.tree.y + 1.05, ground = H(x, z);
      const hop = Math.sin(Math.PI * clamp((t - it.crackAt) / 0.8, 0, 1)) * 0.5;
      player.x = x; player.z = z;
      player.y = lerp(held, ground, smoothstep(it.crackAt + 0.15, it.crackAt + 0.8, t)) + hop;
      me.heading = it.face;
      if (t < it.crackAt) shake(0.08 + 0.3 * pre * pre, true);
    }
    if (!it.cracked && t >= it.crackAt) {
      it.cracked = true;
      const w = it.wound;
      World.burst(w.x, w.y, w.z, 70, 0x7dff5a, { speed: 9, up: 4, life: 1.4, size: 0.4, spread: 1.2, grav: -4 });
      World.burst(w.x, w.y - 1, w.z, 45, 0x5a4030, { speed: 7, up: 5, life: 1.6, size: 0.7, spread: 1.4, grav: -12 });
      World.burst(w.x, w.y + 1, w.z, 30, 0xeaffd0, { speed: 5, up: 3, life: 0.9, size: 0.3, spread: 0.8, grav: -1 });
      flash(0.85);
      fx.glitch = 0.6;
      fx.satPulse = 0.9;
      UI.introWord('');
      shake(1.1);
      it.glow = 1.6;
    }
    if (!it.dropped && t >= it.dropAt) {
      it.dropped = true;
      const t0 = startTransport();
      safe(() => Sound.sfx.drop(t0));
      flash(1);
      fx.glitch = 0.45;
      fx.satPulse = 0.6;
      shake(0.9);
      wiz.act('stomp');
      cam.yaw = it.face - HANDOVER_YAW;
      cam.pitch = 0.3;
      spawnRing(player.x, player.y, player.z, 9, LANE_HEX.kick, 0.6);
      World.bounceMushrooms(1);
      UI.title(true);
    }
    // the title card clears and the HUD slides in just before he is yours to move
    if (it.dropped && !it.hudOn && t >= it.endAt - 0.8) {
      it.hudOn = true;
      UI.title(false);
      const z = Rules.zoneAt(player.x, player.z, L);
      zone.id = z.id;
      if (z.name) UI.toast(z.name, 'zone');
    }
    if (t >= it.endAt) endIntro(false);
  }

  function introOverrides() {
    const it = intro;
    if (!it) return;
    const tr = W.tree, t = realT - it.t0;
    it.glow = Math.max(0, it.glow - (realT - (it.lastT || realT)) * 1.6);
    it.lastT = realT;
    const build = it.emerging && !it.cracked ? clamp((t - INTRO_EMERGE) / (it.crackAt - INTRO_EMERGE), 0, 1) : 0;
    const flicker = build ? 0.12 * Math.sin(t * 43) * build : 0;
    tr.woundGlow.material.opacity = clamp(0.45 + 0.2 * it.word + it.glow * 0.5 + build * 0.5 + flicker, 0, 1);
    const s = 1 + it.word * 0.12 + it.glow * 0.35 + build * 0.4;
    tr.woundGlow.scale.set(9 * s, 13 * s, 1);
    tr.pool.material.opacity = clamp(0.35 + it.glow * 0.3 + build * 0.3, 0, 1);
  }

  function introCamera(dt) {
    const it = intro, t = realT - it.t0, w = it.wound;
    const rx = -it.fz, rz = it.fx; // right of someone looking out of the tree
    let d, side, y, lx, ly, lz;
    if (t < INTRO_EMERGE) { // the words: push in slowly on the glowing wound, from low down
      d = lerp(15, 12.5, smoothstep(0, INTRO_EMERGE, t)); side = 1.6; y = 1.9; lx = w.x; ly = w.y + 0.6; lz = w.z;
    } else if (!it.dropped) { // the struggle and the crack: close, the camera kicks back on the crack
      const pre = clamp((t - INTRO_EMERGE) / (it.crackAt - INTRO_EMERGE), 0, 1);
      d = lerp(12.5, 10.5, pre) + 2 * smoothstep(it.crackAt, it.crackAt + 0.3, t); side = 1.2; y = 1.7;
      lx = lerp(w.x, player.x, 0.5); ly = lerp(w.y, player.y + 2, 0.6); lz = lerp(w.z, player.z, 0.5);
    } else { // the drop: a low hero shot, the giant tree towering behind him
      const k = smoothstep(it.dropAt, it.endAt, t);
      d = lerp(16.5, 18.5, k); side = lerp(3, 5, k); y = lerp(1.3, 2.4, k);
      lx = player.x; ly = player.y + 3.4; lz = player.z;
    }
    const x = it.tree.x + it.fx * d + rx * side, z = it.tree.z + it.fz * d + rz * side;
    camera.position.set(x, H(x, z) + y, z);
    V1.set(lx, ly, lz);
    // the last stretch of the title card swings round behind him, into the gameplay camera
    const blend = it.dropped ? smoothstep(it.endAt - 1.3, it.endAt, t) : 0;
    if (blend > 0) {
      snapCamera();
      playCamPose(cam.target.x, cam.target.y, cam.target.z, cam.yaw, cam.pitch, V2, V3);
      camera.position.lerp(V2, blend);
      V1.lerp(V3, blend);
    }
    camera.lookAt(V1);
    applyShake(dt);
  }

  function endIntro(atSpawn) {
    if (state !== 'intro') return;
    const it = intro;
    intro = null;
    UI.introWord('');
    UI.title(false);
    fx.satPulse = 0;
    if (!Sound.running) startTransport();
    wiz.reset();
    wizHidden = false;
    W.tree.woundGlow.scale.set(9, 13, 1);
    if (atSpawn || !it || !it.dropped) placeAtSpawn();
    else {
      me.heading = it.face;
      cam.yaw = it.face - HANDOVER_YAW;
      cam.pitch = 0.3;
      player.y = H(player.x, player.z);
    }
    store.set('intro', 'seen');
    enterPlay(!(it && it.hudOn));
  }

  function skipIntro() {
    if (state === 'boot') startGame();
    if (state === 'intro') endIntro(true);
  }

  function placeAtSpawn() {
    const [sx, sz] = L.spawn, next = Terrain.PATHS[0][1];
    player.x = sx; player.z = sz; player.y = H(sx, sz);
    me.heading = Math.atan2(next[0] - sx, next[1] - sz);
    cam.yaw = me.heading;
    cam.pitch = 0.3;
  }

  function enterPlay(announceZone = true) {
    state = 'play';
    Input.setMode('play');
    snapCamera();
    if (announceZone) zone.id = null;
    zone.pending = null;
    later(1.3, () => { if (state === 'play' && !stats.casts) UI.toast(Input.isTouch ? 'TAP STOMP ON THE BEAT' : 'STOMP ON THE BEAT · SPACE', 'kick'); });
    if (!Sound.running) later(2.5, () => UI.toast('NO SOUND IN THIS BROWSER · THE JUNGLE STAYS SILENT', 'warn'));
  }

  /* ---------- the frame ---------- */

  const timers = [];
  function later(sec, fn) { timers.push({ at: realT + sec, fn }); }

  function frame(ms) {
    requestAnimationFrame(frame);
    const rdt = lastFrame ? clamp((ms - lastFrame) / 1000, 0, 3) : 1 / 60;
    const from = lastFrame || ms;
    lastFrame = ms;
    realT += rdt;
    try {
      step(rdt, from, ms);
    } catch (e) {
      if (!loggedError) { loggedError = true; console.error(e); }
    }
  }

  // One rendered frame. The simulation runs in steps of at most 1/20 s and keeps real time through
  // hitches of up to 3 s (slow devices, software rendering); animation takes one clamped step.
  function step(rdt, fromMs, toMs) {
    const dt = Math.min(rdt, 0.1);
    songPos = Sound.running ? Sound.pos() : -1;
    pulse = Sound.running ? Sound.beatPulse() : 0;
    for (let i = timers.length - 1; i >= 0; i--) if (realT >= timers[i].at) { const t = timers.splice(i, 1)[0]; t.fn(); }

    let look = Input.consumeLook();
    drainPresses();

    // the average move input over this frame's real time (see moveIn)
    integrateMove(toMs);
    const span = Math.max(1, toMs - fromMs), k = span / 1000 / rdt;
    const mv = { x: (moveIn.x / span) * k, y: (moveIn.y / span) * k };
    moveIn.x = 0; moveIn.y = 0;

    const n = Math.max(1, Math.ceil(rdt / 0.05)), h = rdt / n;
    for (let i = 0; i < n; i++) {
      const live = state === 'play' || state === 'finale' || state === 'end';
      if (live) simT += h;
      if (state === 'play') { stats.playT += h; updatePlay(h, look, mv); look = NO_LOOK; }
      else if (state === 'dialogue') updateTalkFacing(h);
      if (live) updateEnemies(h);
      if (state !== 'paused') updateEffects(h);
    }
    if (state === 'play') { updatePrompt(); updateZone(rdt); updateHush(dt); }
    if (state === 'intro') updateIntro(dt);
    if (state === 'finale' || state === 'end') updateFinale(dt);
    if (carving) updateCarving();

    // the music drives the world
    safe(() => Sound.drain(onLoopHit));
    World.update(realT, dt, pulse);
    const snap = Sound.seq.snapshot();
    World.updateStones(snap, songPos >= 0 ? songPos : 0, pulse);
    if (state === 'intro') introOverrides();
    panther.update(dt, realT, pulse);
    toad.update(dt, realT, pulse);
    updateWizard(dt);

    // camera
    if (state === 'boot') updateBootCamera(rdt);
    else if (state === 'intro') introCamera(dt);
    else if (state === 'finale' || (state === 'end' && !jam)) finaleCamera(dt);
    else updatePlayCamera(dt);

    updatePost(Math.min(rdt, 0.1));
    if (state !== 'boot' && (state !== 'intro' || (intro && intro.hudOn))) updateHud(snap);
    Render.draw(scene, camera);
    frames++;
  }

  /* ---------- input ---------- */

  function drainPresses() {
    if (!booted) return;
    for (const p of Input.consume()) press(p.action, p.t);
  }

  function press(action, t) {
    if (action === 'mute') { safe(() => Sound.toggleMute()); return; }
    switch (state) {
      case 'intro':
        // (the key or click that started the game must not skip it at once)
        if (intro && intro.skippable && t > intro.ms + 400 && (action === 'advance' || action === 'pause' || action === 'interact')) endIntro(true);
        break;
      case 'play':
        if (abilities[action]) castSpell(action, t);
        else if (action === 'interact') interact();
        else if (action === 'book') openBook();
        else if (action === 'pause') pause();
        break;
      case 'dialogue':
        if (action === 'advance') UI.advance();
        else if (action === 'pause') pause();
        break;
      case 'book':
        if (action === 'book' || action === 'pause') closeBook();
        break;
      case 'paused':
        if (action === 'advance' || action === 'pause') resume();
        break;
      case 'finale':
        if (action === 'advance' && finale && finale.stage === 2) { finale.next = realT - finale.t0 + FINALE_LINE; UI.advance(); }
        break;
      default:
    }
  }

  /* ---------- play ---------- */

  function updatePlay(dt, look, mv) {
    for (const n of SPELL_NAMES) cd[n] = Math.max(0, cd[n] - dt);
    me.iframes = Math.max(0, me.iframes - dt);
    // mouse or thumb looks around
    if (look.dx || look.dy) {
      cam.yaw -= look.dx * Input.RAD_PER_PX;
      cam.pitch = Rules.clampPitch(cam.pitch + look.dy * Input.RAD_PER_PX);
      cam.lastLook = realT;
      forcedAim = null;
    }
    if (me.dead) updateDeath(dt);
    else {
      updateMovement(dt, mv);
      pickFireflies();
      regen(dt);
    }
  }

  function updateMovement(dt, input) {
    const mv = me.dash || !input ? NO_MOVE : input;
    const mag = Math.hypot(mv.x, mv.y); // above 1 only while catching up after a long frame
    const fx0 = Math.sin(cam.yaw), fz0 = Math.cos(cam.yaw), rx = -fz0, rz = fx0;
    let wx = fx0 * mv.y + rx * mv.x, wz = fz0 * mv.y + rz * mv.x;
    const wl = Math.hypot(wx, wz);
    const wading = H(player.x, player.z) < Rules.WADE.depth;
    me.moving = mag > 0.06 && wl > 1e-6;
    let speed = 0;
    if (me.moving) {
      wx /= wl; wz /= wl;
      me.moveHeading = Math.atan2(wx, wz);
      speed = RUN * mag * (wading ? Rules.WADE.speed : 1);
      const x0 = player.x, z0 = player.z;
      move(wx * speed * dt, wz * speed * dt);
      speed = Math.hypot(player.x - x0, player.z - z0) / Math.max(dt, 1e-6);
      // on touch the camera eases round behind the walk (never while the thumb is looking)
      if (Input.isTouch && realT - cam.lastLook > 0.8) {
        const rel = Rules.wrapAngle(me.moveHeading - cam.yaw);
        if (Math.abs(rel) < 2.3) cam.yaw += rel * Math.min(1, dt * 0.9 * Math.min(1, mag));
      }
    }
    if (me.dash) {
      const d = me.dash, k = Math.min(dt, d.dur - d.t);
      move(Math.sin(d.dir) * d.speed * k, Math.cos(d.dir) * d.speed * k);
      d.t += dt;
      if (Math.random() < 0.9) World.burst(player.x, player.y + 1, player.z, 3, 0x9dffd0, { speed: 1.2, up: 0.6, life: 0.4, size: 0.3, spread: 0.4, grav: 0 });
      if (d.t >= d.dur) me.dash = null;
      speed = d.speed;
    }
    me.speed = speed;
    const want = realT < me.faceAimUntil ? me.aimHeading : me.dash ? me.dash.dir : me.moving ? me.moveHeading : me.heading;
    me.heading = Rules.wrapAngle(me.heading + Rules.wrapAngle(want - me.heading) * Math.min(1, dt * 14));
    const gy = H(player.x, player.z);
    player.y += (gy - player.y) * Math.min(1, dt * 20);
  }

  // Moves in small steps: cliffs block (sliding along them), colliders push out.
  function move(dx, dz) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.4));
    for (let i = 0; i < n; i++) stepTo(player.x + dx / n, player.z + dz / n);
  }
  function stepTo(nx, nz) {
    const x = player.x, z = player.z;
    if (Terrain.canStep(x, z, nx, nz)) { tmpP.x = nx; tmpP.z = nz; }
    else if (Terrain.canStep(x, z, nx, z)) { tmpP.x = nx; tmpP.z = z; }
    else if (Terrain.canStep(x, z, x, nz)) { tmpP.x = x; tmpP.z = nz; }
    else return;
    W.colliders.collide(tmpP, RADIUS);
    if (Terrain.canStep(x, z, tmpP.x, tmpP.z)) { player.x = tmpP.x; player.z = tmpP.z; }
  }

  function teleport(x, z) {
    tmpP.x = x; tmpP.z = z;
    W.colliders.collide(tmpP, RADIUS);
    W.colliders.collide(tmpP, RADIUS);
    player.x = tmpP.x; player.z = tmpP.z; player.y = H(player.x, player.z);
    me.dash = null;
    forcedAim = null;
    snapCamera();
  }

  /* ---------- spells ---------- */

  function castSpell(name, t = performance.now(), force = false) {
    if (state !== 'play' || me.dead) return null;
    const a = abilities[name];
    if (!a) return null;
    if (!a.unlocked) {
      const who = name === 'bolt' ? 'THE PANTHER SPIRIT HOLDS THE SNARE' : 'THE SUB TOAD HOLDS THE BASS';
      hint('locked-' + name, who, name === 'bolt' ? 'snare' : 'bass', 3);
      return null;
    }
    if (!force && cd[name] > 0) return null;
    const lane = Rules.SPELLS[name].lane;
    let res = null;
    if (lane) res = safe(() => Sound.hit(lane, t)) || { onBeat: false, errMs: 0, step: 0 };
    const s = Rules.spell(name, !!(res && res.onBeat));
    cd[name] = cdMax[name] = s.cd;
    if (lane) {
      stats.casts++;
      if (s.onBeat) { stats.pocket++; UI.pocket(lane); }
      wiz.setOrbColor(LANE_HEX[lane]);
      fx.satPulse = Math.max(fx.satPulse, s.onBeat ? 0.24 : 0.1); // every drum lets a flash of colour back
      if (Input.isTouch) Input.vibrate(s.onBeat ? 18 : 8);
      if (!hints.drafted && Sound.seq.draftCount(lane) > 0) {
        hints.drafted = true;
        later(0.9, () => UI.toast('THE LOOP REMEMBERS · CARVE IT AT A LOOP STONE', 'quest'));
      }
    }
    if (name === 'stomp') doStomp(s);
    else if (name === 'bolt') doBolt(s);
    else if (name === 'quake') doQuake(s);
    else doDash(s);
    return lane ? res : null;
  }

  function doStomp(s) {
    wiz.act('stomp');
    const { x, y, z } = player;
    spawnRing(x, y, z, s.radius, LANE_HEX.kick, s.onBeat ? 0.42 : 0.34);
    World.burst(x, y + 0.3, z, s.onBeat ? 34 : 20, LANE_HEX.kick, { speed: 7, up: 1.3, life: 0.55, size: 0.32, spread: 0.6, grav: -5 });
    World.burst(x, y + 0.2, z, 12, 0x8a7a6a, { speed: 3, up: 1.5, life: 0.8, size: 0.6, spread: 0.8, grav: -2 });
    World.bounceMushrooms(1);
    shake(s.onBeat ? 0.42 : 0.26);
    for (const e of enemies) {
      const c = e.c;
      if (!c.alive) continue;
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d <= s.radius + (e.kind === 'warden' ? 1.1 : 0.5) && Math.abs(c.pos.y - y) < 4.5) damageEnemy(e, s.damage, player);
    }
  }

  function doBolt(s) {
    const aim = aimPoint(V3, 'bolt');
    faceAim(Math.atan2(aim.x - player.x, aim.z - player.z), 0.6);
    syncWizard();
    wiz.act('bolt');
    const o = wiz.orbWorld(V2);
    if (!Number.isFinite(o.x)) o.set(player.x, player.y + 2.4, player.z);
    const b = bolts.find((q) => !q.live) || bolts[0];
    b.live = true;
    b.pos.copy(o);
    b.dir.copy(aim).sub(o);
    if (b.dir.lengthSq() < 1e-6) b.dir.set(Math.sin(me.heading), 0, Math.cos(me.heading));
    b.dir.normalize();
    b.speed = s.speed; b.range = s.range; b.dmg = s.damage; b.travel = 0; b.onBeat = s.onBeat;
    b.obj.visible = true;
    b.obj.position.copy(o);
    b.halo.scale.setScalar(s.onBeat ? 1.9 : 1.5);
    World.burst(o.x, o.y, o.z, 10, LANE_HEX.snare, { speed: 3, up: 0.5, life: 0.35, size: 0.28, spread: 0.1, grav: 0 });
    shake(0.08);
  }

  function doQuake(s) {
    const aim = aimPoint(V3, 'quake');
    const dir = Math.atan2(aim.x - player.x, aim.z - player.z);
    faceAim(dir, 0.95);
    wiz.act('quake');
    const q = { hit: new Set(), dmg: s.damage };
    const n = Math.ceil(s.length / 1.25), fx0 = Math.sin(dir), fz0 = Math.cos(dir), base = H(player.x, player.z);
    for (let i = 0; i < n; i++) {
      const d = 1.5 + i * 1.25, wob = Math.sin(i * 2.3 + simT) * 0.35;
      const x = player.x + fx0 * d - fz0 * wob, z = player.z + fz0 * d + fx0 * wob, y = H(x, z);
      if (Math.abs(y - base) > 3.2 + i * 0.4) break; // roots do not climb cliffs
      spawnRoot(x, y, z, 0.24 + i * 0.035, (0.75 + 0.35 * Math.sin(i * 1.7 + 1)) * (s.onBeat ? 1.2 : 1), q);
    }
    shake(s.onBeat ? 0.55 : 0.4);
  }

  function doDash(s) {
    const mv = Input.move;
    let dir = me.heading;
    if (Math.hypot(mv.x, mv.y) > 0.2) {
      const fx0 = Math.sin(cam.yaw), fz0 = Math.cos(cam.yaw);
      dir = Math.atan2(fx0 * mv.y - fz0 * mv.x, fz0 * mv.y + fx0 * mv.x);
    }
    me.dash = { dir, t: 0, dur: s.time, speed: s.distance / s.time };
    me.faceAimUntil = 0;
    me.iframes = Math.max(me.iframes, s.time + 0.2);
    wiz.act('dash');
    safe(() => Sound.sfx.dash());
    World.burst(player.x, player.y + 0.4, player.z, 16, 0x9dffd0, { speed: 4, up: 1, life: 0.5, size: 0.35, spread: 0.5, grav: -2 });
  }

  function faceAim(heading, hold) {
    me.aimHeading = heading;
    me.heading = heading;
    me.faceAimUntil = realT + hold;
  }

  // Where a bolt or quake goes: JW.aimAt's point, else the nearest target in front (touch),
  // else what the crosshair is on (desktop).
  function aimPoint(out, kind) {
    if (forcedAim && realT < forcedAim.until) return out.copy(forcedAim.p);
    if (Input.isTouch || !camera) {
      const cands = [];
      for (const e of enemies) if (e.c.alive) cands.push({ x: e.c.pos.x, z: e.c.pos.z, y: e.c.pos.y + (e.kind === 'warden' ? 1.9 : 0) });
      const vw = W.vineWall, g = W.crackedGate;
      if (kind === 'bolt' && vw.alive) cands.push({ x: vw.x, z: vw.z, y: vw.mesh.position.y });
      if (kind === 'quake' && g.alive) cands.push({ x: g.x, z: g.z, y: H(g.x, g.z) + 2 });
      const facing = me.moving ? me.moveHeading : me.heading;
      const c = Rules.autoAim(player.x, player.z, facing, cands, { range: kind === 'quake' ? 16 : 24 });
      if (c) return out.set(c.x, c.y, c.z);
      return out.set(player.x + Math.sin(facing) * 20, player.y + 2.3, player.z + Math.cos(facing) * 20);
    }
    return crosshair(out);
  }

  // The first thing on the ray through the middle of the screen: a Hush creature, the vine
  // wall, the cracked gate or the ground. The part of the ray behind the wizard is skipped.
  function crosshair(out) {
    const o = camera.position, dir = camera.getWorldDirection(V4);
    const start = Math.max(0, o.distanceTo(V1.set(player.x, player.y + 1.5, player.z)) - 1);
    let best = 60;
    for (const e of enemies) {
      const c = e.c;
      if (!c.alive) continue;
      const cy = c.pos.y + (e.kind === 'warden' ? 1.9 : 0), r = (e.kind === 'warden' ? 1.4 : 0.9) + 0.45;
      const tx = c.pos.x - o.x, ty = cy - o.y, tz = c.pos.z - o.z, along = tx * dir.x + ty * dir.y + tz * dir.z;
      if (along < start || along > best) continue;
      const px = tx - dir.x * along, py = ty - dir.y * along, pz = tz - dir.z * along;
      if (px * px + py * py + pz * pz < r * r) best = along;
    }
    const vw = W.vineWall, g = W.crackedGate;
    for (let s = start; s < best; s += 0.5) {
      const x = o.x + dir.x * s, y = o.y + dir.y * s, z = o.z + dir.z * s;
      if (y < H(x, z) || (vw.alive && inBox(x, z, vw.box, 0.2) && y < vw.mesh.position.y + 4.4) || (g.alive && inBox(x, z, g.box, 0.2) && y < H(g.x, g.z) + 7)) { best = s; break; }
    }
    return out.set(o.x + dir.x * best, o.y + dir.y * best, o.z + dir.z * best);
  }

  const inBox = (x, z, b, pad = 0) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad;

  function damageEnemy(e, dmg, from) {
    const c = e.c;
    if (!c.alive) return false;
    const died = c.hit(dmg, from);
    const y = c.pos.y + (e.kind === 'warden' ? 1.9 : 0.2);
    World.burst(c.pos.x, y, c.pos.z, died ? 30 : 10, died ? 0xeae6ff : LANE_HEX.snare, { speed: died ? 5 : 3, up: 2, life: died ? 1.1 : 0.5, size: 0.35, spread: 0.3, grav: -3 });
    if (died) {
      stats.kills++;
      safe(() => Sound.sfx.enemyDie());
      addXP(Rules.XP[e.kind] || 1);
      if (e.kind === 'warden') UI.toast('THE HUSH WARDEN FADES INTO THE SONG', 'good');
    } else safe(() => Sound.sfx.hitEnemy());
    return died;
  }

  /* ---------- effects: rings, bolts, roots ---------- */

  function spawnRing(x, y, z, r, color, life = 0.35) {
    const ring = rings.find((q) => !q.live) || rings[0];
    Object.assign(ring, { live: true, t: 0, life, r });
    ring.mesh.material.color.setHex(color);
    ring.mesh.position.set(x, y + 0.45, z); // above the bumps of the ground it rolls over
    ring.mesh.visible = true;
  }

  function spawnRoot(x, y, z, delay, scale, q) {
    const i = roots.findIndex((r) => !r.live);
    if (i < 0) return;
    roots[i] = { live: true, x, y, z, delay, age: 0, scale, erupted: false, q, rx: (Math.random() - 0.5) * 0.6, rz: (Math.random() - 0.5) * 0.6, ry: Math.random() * 6 };
  }

  function updateEffects(dt) {
    for (const ring of rings) {
      if (!ring.live) continue;
      ring.t += dt;
      const k = clamp(ring.t / ring.life, 0, 1), r = 0.4 + (ring.r - 0.4) * (1 - (1 - k) * (1 - k));
      ring.mesh.scale.set(r, 1, r);
      ring.mesh.material.opacity = (1 - k) * 0.95;
      if (k >= 1) { ring.live = false; ring.mesh.visible = false; }
    }
    for (const b of bolts) if (b.live) moveBolt(b, dt);
    let dirty = false;
    roots.forEach((r, i) => {
      if (!r.live) return;
      dirty = true;
      r.age += dt;
      const t = r.age - r.delay;
      if (t >= 0 && !r.erupted) { r.erupted = true; erupt(r); }
      const h = t < 0 ? 0 : t < 0.07 ? t / 0.07 : t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.35);
      if (t > 0.95) r.live = false;
      const s = r.live ? Math.max(1e-3, h) * r.scale : 0;
      M4.compose(V1.set(r.x, r.y - 0.25, r.z), Q4.setFromEuler(E4.set(r.rx, r.ry, r.rz)), S4.set(r.live ? r.scale : 0, s, r.live ? r.scale : 0));
      rootMesh.setMatrixAt(i, M4);
    });
    if (dirty) rootMesh.instanceMatrix.needsUpdate = true;
  }

  function erupt(r) {
    World.burst(r.x, r.y + 0.3, r.z, 7, LANE_HEX.bass, { speed: 3, up: 3, life: 0.6, size: 0.35, spread: 0.4, grav: -6 });
    World.burst(r.x, r.y + 0.1, r.z, 4, 0x6a5040, { speed: 2, up: 2, life: 0.7, size: 0.55, spread: 0.5, grav: -8 });
    for (const e of enemies) {
      const c = e.c;
      if (!c.alive || r.q.hit.has(e)) continue;
      if (Math.hypot(c.pos.x - r.x, c.pos.z - r.z) < (e.kind === 'warden' ? 2.4 : 1.8)) { r.q.hit.add(e); damageEnemy(e, r.q.dmg, player); }
    }
    const g = W.crackedGate;
    if (g.alive && inBox(r.x, r.z, g.box, 1.1)) breakGate();
  }

  function moveBolt(b, dt) {
    const len = b.speed * dt, n = Math.max(1, Math.ceil(len / 0.4));
    for (let i = 0; i < n && b.live; i++) {
      b.pos.addScaledVector(b.dir, len / n);
      b.travel += len / n;
      boltHits(b);
    }
    if (b.live && b.travel > b.range) endBolt(b, LANE_HEX.snare);
    if (!b.live) return;
    b.obj.position.copy(b.pos);
    const f = 1 + Math.sin(realT * 60) * 0.12;
    b.obj.scale.setScalar(f);
    World.burst(b.pos.x, b.pos.y, b.pos.z, 1, LANE_HEX.snare, { speed: 0.3, up: 0.2, life: 0.3, size: 0.26, spread: 0.05, grav: 0 });
  }

  function boltHits(b) {
    const p = b.pos;
    for (const e of enemies) {
      const c = e.c;
      if (!c.alive) continue;
      const cy = c.pos.y + (e.kind === 'warden' ? 1.9 : 0), r = e.kind === 'warden' ? 1.4 : 0.95;
      if ((p.x - c.pos.x) ** 2 + (p.y - cy) ** 2 + (p.z - c.pos.z) ** 2 < r * r) { damageEnemy(e, b.dmg, p); endBolt(b, LANE_HEX.snare); return; }
    }
    const vw = W.vineWall, g = W.crackedGate;
    if (vw.alive && inBox(p.x, p.z, vw.box, 0.3) && p.y < vw.mesh.position.y + 4.6) { hitVines(p); endBolt(b, 0xffa040); return; }
    if (g.alive && inBox(p.x, p.z, g.box, 0.3) && p.y < H(g.x, g.z) + 7) {
      endBolt(b, LANE_HEX.bass);
      hint('gate-bolt', 'ONLY THE BASS CAN BREAK THE CRACKED STONE', 'bass', 5);
      return;
    }
    if (p.y < H(p.x, p.z) + 0.05) endBolt(b, LANE_HEX.snare);
  }

  function endBolt(b, color) {
    b.live = false;
    b.obj.visible = false;
    World.burst(b.pos.x, b.pos.y, b.pos.z, 14, color, { speed: 4, up: 1.5, life: 0.45, size: 0.3, spread: 0.1, grav: -4 });
  }

  function hitVines(p) {
    const vw = W.vineWall;
    vw.hp = Math.max(0, vw.hp - 1);
    World.burst(p.x, p.y, vw.z + 0.6, 20, 0xff8a2a, { speed: 4, up: 3, life: 0.8, size: 0.35, spread: 0.5, grav: -2 });
    shake(0.15);
    safe(() => Sound.sfx.hitEnemy());
    if (vw.hp > 0) return;
    World.burnVines();
    safe(() => Sound.sfx.crumble());
    for (const m of quest.event('vines')) UI.toast(m, 'good');
    addXP(3);
  }

  function breakGate() {
    if (!W.crackedGate.alive) return;
    World.breakGate();
    safe(() => Sound.sfx.crumble());
    shake(0.9);
    flash(0.2);
    for (const m of quest.event('gate')) UI.toast(m, 'good');
    addXP(3);
  }

  /* ---------- the Hush ---------- */

  function updateEnemies(dt) {
    const env = { player, heightAt: H, t: simT, pulse, songPos: songPos >= 0 ? songPos : undefined };
    const hurtable = state === 'play' && !me.dead;
    for (const m of moths) {
      if (m.gone) continue;
      const out = m.update(dt, env);
      if (out && out.bite && hurtable) hurt(Rules.DAMAGE.bite, m.pos);
    }
    if (!warden.gone) {
      const out = warden.update(dt, env);
      if (out && out.hit && hurtable) hurt(Rules.DAMAGE.ring, warden.pos);
    }
  }

  function updateHush(dt) {
    const near = enemies.map((e) => ({ kind: e.kind, alive: e.c.alive, d: Math.hypot(e.c.pos.x - player.x, e.c.pos.z - player.z) }));
    const target = Rules.hush(near);
    hushLevel += (target - hushLevel) * Math.min(1, dt * 2.5);
    sendHush(hushLevel);
  }
  function sendHush(v) {
    if (Math.abs(v - hushSent) < 0.01) return;
    hushSent = v;
    safe(() => Sound.setHush(v));
  }

  function hurt(dmg, from) {
    if (me.dead || me.iframes > 0 || me.dash) return;
    player.vibe = Math.max(0, player.vibe - dmg);
    me.iframes = Rules.IFRAMES;
    me.lastHurt = simT;
    me.regen = 0;
    wiz.act('hurt');
    safe(() => Sound.sfx.hurt());
    shake(0.35);
    fx.glitch = Math.max(fx.glitch, 0.45);
    if (Input.isTouch) Input.vibrate(40);
    if (from) {
      const dx = player.x - from.x, dz = player.z - from.z, d = Math.hypot(dx, dz) || 1;
      move((dx / d) * 1.2, (dz / d) * 1.2);
    }
    if (player.vibe <= 0) die();
  }

  function die() {
    me.dead = true;
    me.deadT = 0;
    me.dash = null;
    wiz.act('die');
    safe(() => Sound.sfx.crumble());
    UI.toast('YOU CRUMBLE INTO MOSS', 'bad');
  }

  function updateDeath(dt) {
    me.deadT += dt;
    if (me.deadT > 3) respawn();
  }

  function respawn() {
    const i = me.checkpoint;
    if (i >= 0) {
      const st = W.stones[i], f = st.group.rotation.y;
      teleport(st.x + Math.sin(f) * 3.2, st.z + Math.cos(f) * 3.2);
      me.heading = f;
    } else {
      teleport(L.spawn[0], L.spawn[1]);
    }
    cam.yaw = me.heading;
    snapCamera();
    player.vibe = player.maxVibe;
    me.dead = false;
    me.iframes = 2.5;
    me.fadeIn = 0.9;
    wiz.reset();
    wiz.act('emerge');
    UI.toast(i >= 0 ? 'YOU WAKE AT LOOP STONE ' + ROMAN[i] : 'YOU WAKE BY THE SUMMONING TREE', 'quest');
  }

  function regen(dt) {
    if (player.vibe >= player.maxVibe || simT - me.lastHurt < Rules.REGEN.after) { me.regen = 0; return; }
    me.regen += dt;
    if (me.regen >= Rules.REGEN.every) { me.regen = 0; player.vibe = Math.min(player.maxVibe, player.vibe + Rules.REGEN.amount); }
  }

  /* ---------- fireflies, XP, levels ---------- */

  function pickFireflies() {
    const R = Rules.PICKUP, px = player.x, pz = player.z, py = player.y + 1.3;
    for (const f of W.fireflies) {
      if (f.taken || Math.abs(f.x - px) > R || Math.abs(f.z - pz) > R) continue;
      if (Math.hypot(f.x - px, f.z - pz) > R || Math.abs(f.y - py) > 2.4) continue;
      f.taken = true;
      player.fireflies++;
      me.combo = simT - me.lastFly < 1.6 ? me.combo + 1 : 0;
      me.lastFly = simT;
      safe(() => Sound.sfx.firefly(me.combo));
      World.burst(f.x, f.y, f.z, 8, 0xe9ff6b, { speed: 1.5, up: 1, life: 0.5, size: 0.25, spread: 0.1, grav: 0 });
      addXP(Rules.XP.firefly);
    }
  }

  function addXP(n) {
    me.xp += n;
    const lv = Rules.level(me.xp).level;
    if (lv <= player.level) return;
    player.level = lv;
    player.maxVibe = Rules.maxVibe(lv);
    player.vibe = player.maxVibe;
    safe(() => Sound.sfx.levelup());
    UI.toast('LEVEL UP · LV ' + lv, 'level');
    World.burst(player.x, player.y + 1.5, player.z, 30, 0xffd166, { speed: 3, up: 4, life: 1, size: 0.3, spread: 0.6, grav: -2 });
  }

  /* ---------- talking, carving, doors ---------- */

  function nearestInteract() {
    let best = null;
    const d = (x, z) => Math.hypot(x - player.x, z - player.z);
    const take = (dist, reach, it) => { if (dist < reach && (!best || dist < best.d)) { it.d = dist; best = it; } };
    const drafted = LANES.some((l) => Sound.seq.draftCount(l) > 0);
    W.stones.forEach((st, i) => {
      if (!st.carved) take(d(st.x, st.z), Rules.REACH.stone, { kind: 'stone', i, label: 'CARVE', text: drafted ? '[E] Carve your loop into the stone' : '[E] Carve the Loop Stone' });
      else take(d(st.x, st.z), Rules.REACH.stone, drafted ? { kind: 'stone', i, label: 'CARVE', text: '[E] Carve more of your loop into the song' } : { kind: 'info', text: `Loop Stone ${ROMAN[i]} sings your groove` });
    });
    if (!quest.state.panther) take(d(L.altar[0], L.altar[1]), Rules.REACH.spirit, { kind: 'spirit', who: 'panther', label: 'TALK', text: '[E] Wake the Panther Spirit' });
    if (!quest.state.toad) take(d(toadAt.x, toadAt.z), Rules.REACH.spirit, { kind: 'spirit', who: 'toad', label: 'TALK', text: '[E] Wake the Sub Toad' });
    take(d(L.tree[0], L.tree[1]), Rules.REACH.tree, { kind: 'tree', label: 'TALK', text: '[E] Listen to the Summoning Tree' });
    const door = W.pyramid.doorWorld;
    if (!W.pyramid.open) take(d(door.x, door.z), Rules.REACH.door, { kind: 'door', label: 'OPEN', text: '[E] Open the Lost Pyramid' });
    return best;
  }

  function obstacleHint() {
    const vw = W.vineWall, g = W.crackedGate, d = (x, z) => Math.hypot(x - player.x, z - player.z);
    if (vw.alive && d(vw.x, vw.z) < 9) return abilities.bolt.unlocked ? (Input.isTouch ? 'Bolt the vines to burn them' : 'Bolt the vines to burn them · LMB') : 'The vines need the snare · wake the Panther Spirit';
    if (g.alive && d(g.x, g.z) < 9) return abilities.quake.unlocked ? (Input.isTouch ? 'Quake the cracked stone' : 'Quake the cracked stone · RMB') : 'The cracked stone needs the bass · find the Sub Toad';
    return null;
  }

  function updatePrompt() {
    const it = me.dead ? null : nearestInteract();
    Input.setInteract(it && it.kind !== 'info' ? it.label : null);
    UI.prompt(it ? it.text : me.dead ? null : obstacleHint());
  }

  function interact() {
    if (state !== 'play' || me.dead) return;
    const it = nearestInteract();
    if (!it) return;
    if (it.kind === 'stone') carve(it.i);
    else if (it.kind === 'spirit') talkSpirit(it.who);
    else if (it.kind === 'tree') startTalk('tree', Quest.LINES.tree, W.tree.wound.getWorldPosition(V1), null);
    else if (it.kind === 'door') openDoor();
  }

  function carve(i) {
    if (carving) return;
    const drafted = LANES.reduce((n, l) => n + Sound.seq.draftCount(l), 0);
    if (!drafted) {
      UI.toast('YOUR LOOP IS EMPTY · CAST ON THE BEAT FIRST', 'warn');
      safe(() => Sound.sfx.ui());
      return;
    }
    const first = !W.stones[i].carved;
    const added = Sound.carve();
    // the riser peaks on the next bar; the colour floods back on that crash
    const at = safe(() => Sound.sfx.carve());
    const pos = Sound.running ? Sound.pos() : -1;
    const bar = pos >= 0 ? Math.ceil((pos + 0.3) / 16) * 16 : -1;
    carving = { i, first, added, bar, deadline: realT + (pos >= 0 && at ? 1.8 : 0.6) };
    wiz.act('stomp');
    wiz.setOrbColor(0x7ff6ff);
    if (Input.isTouch) Input.vibrate(25);
  }

  function updateCarving() {
    const c = carving;
    if (!(songPos >= 0 && c.bar >= 0 && songPos >= c.bar - 0.2) && realT < c.deadline) return;
    carving = null;
    flood(c);
  }

  // The carve lands: the stone lights up, a rainbow ripple floods colour back into the world,
  // the Hush nearby are blown away, and the spellbook opens on the new song.
  function flood(c) {
    const st = W.stones[c.i];
    World.carveStone(c.i);
    startRipple(st.x, st.y + 3, st.z);
    flash(0.35);
    shake(0.5);
    for (const e of enemies) if (e.c.alive && Math.hypot(e.c.pos.x - st.x, e.c.pos.z - st.z) < 15) damageEnemy(e, 3, st);
    player.vibe = player.maxVibe;
    const carved = W.stones.filter((s) => s.carved).length;
    satTarget = Rules.saturation(carved, quest.state.done);
    safe(() => Sound.setProgress(carved / 3));
    if (!c.first) {
      UI.toast(c.added.length ? `${c.added.length} MORE ${c.added.length === 1 ? 'HIT' : 'HITS'} CARVED INTO THE SONG` : 'THE SONG ALREADY HOLDS THOSE HITS', 'carve');
      return;
    }
    me.checkpoint = c.i;
    for (const m of quest.event('carve', c.i)) UI.toast(m, 'carve');
    addXP(Rules.XP.carve);
    if (state === 'play') openBook(BOOK_DELAY);
  }

  function talkSpirit(who) {
    if (who === 'panther') {
      panther.awaken();
      startTalk('panther', Quest.LINES.panther, V1.set(L.altar[0], W.altarTop + 1.3, L.altar[1]), () => gift('panther'));
    } else {
      toad.croak();
      safe(() => Sound.sfx.boing());
      startTalk('toad', Quest.LINES.toad, V1.set(toadAt.x, toadAt.y + 0.8, toadAt.z), () => gift('toad'));
    }
  }

  // A spirit's gift: the snare (Panther) or the bass (Sub Toad).
  function gift(who) {
    const spell = who === 'panther' ? 'bolt' : 'quake', lane = who === 'panther' ? 'snare' : 'bass';
    const was = abilities[spell].unlocked;
    abilities[spell].unlocked = true;
    const msgs = quest.event('spirit', who);
    if (was && !msgs.length) return;
    for (const m of msgs) UI.toast(m, 'unlock');
    safe(() => Sound.sfx.unlock());
    flash(0.3);
    wiz.setOrbColor(LANE_HEX[lane]);
    addXP(Rules.XP.spirit);
    const from = who === 'panther' ? V2.set(L.altar[0], W.altarTop + 1, L.altar[1]) : V2.copy(toadAt);
    World.burst(from.x, from.y + 0.5, from.z, 40, LANE_HEX[lane], { speed: 5, up: 3, life: 1.2, size: 0.4, spread: 0.6, grav: -2 });
    const how = spell === 'bolt' ? (Input.isTouch ? 'TAP BOLT' : 'LEFT MOUSE OR J') : (Input.isTouch ? 'TAP QUAKE' : 'RIGHT MOUSE OR K');
    later(1.2, () => UI.toast(`${how} · ${LANE_NAME[lane]}`, lane));
  }

  function startTalk(who, lines, focus, onDone) {
    state = 'dialogue';
    Input.setMode('dialogue');
    Input.setInteract(null);
    UI.prompt(null);
    talkFocus = focus.clone();
    faceAim(Math.atan2(focus.x - player.x, focus.z - player.z), 0);
    wiz.act('talk');
    UI.dialogue(Quest.SPEAKERS[who], lines, () => {
      talkFocus = null;
      if (state === 'dialogue') { state = 'play'; Input.setMode('play'); }
      if (onDone) onDone();
    });
  }

  function updateTalkFacing(dt) {
    if (!talkFocus) return;
    const want = Math.atan2(talkFocus.x - player.x, talkFocus.z - player.z);
    me.heading = Rules.wrapAngle(me.heading + Rules.wrapAngle(want - me.heading) * Math.min(1, dt * 6));
    cam.yaw += Rules.wrapAngle(want + 0.55 - cam.yaw) * Math.min(1, dt * 2.5);
    cam.pitch += (0.2 - cam.pitch) * Math.min(1, dt * 2.5);
  }

  function openDoor() {
    const r = quest.pyramidReady((lane) => Sound.seq.songCount(lane) > 0);
    if (!r.ok) {
      UI.toast(r.text, 'warn');
      safe(() => Sound.sfx.ui());
      shake(0.2);
      return;
    }
    startFinale();
  }

  /* ---------- the spellbook, pause ---------- */

  function openBook(delayMs = 0) {
    if (state !== 'play') return;
    state = 'book';
    Input.setMode('book');
    Input.setInteract(null);
    UI.prompt(null);
    clearTimeout(bookTimer);
    bookTimer = 0;
    if (delayMs > 0) bookTimer = setTimeout(showBook, delayMs);
    else showBook();
  }
  function showBook() {
    bookTimer = 0;
    if (state !== 'book') return;
    UI.openBook(Sound.seq, { toggle: (lane, s) => Sound.toggle(lane, s), clearLane: (lane) => Sound.clearLane(lane), close: closeBook, quest });
  }
  function closeBook() {
    if (state !== 'book') return;
    clearTimeout(bookTimer);
    bookTimer = 0;
    UI.closeBook();
    state = 'play';
    Input.setMode('play');
  }

  function pause() {
    if (state !== 'play' && state !== 'dialogue') return;
    pausedFrom = state;
    state = 'paused';
    UI.pause(true);
    Input.setMode('menu');
    sendHush(Math.max(hushLevel, 0.7)); // the song goes muffled, as if underwater
  }
  function resume() {
    if (state !== 'paused') return;
    UI.pause(false);
    state = pausedFrom;
    Input.setMode(state === 'dialogue' ? 'dialogue' : 'play');
    sendHush(hushLevel);
  }

  /* ---------- the finale and the end ---------- */

  function startFinale() {
    state = 'finale';
    Input.setMode('dialogue');
    Input.setInteract(null);
    UI.prompt(null);
    uiRoot.classList.add('jw-cine');
    const door = W.pyramid.doorWorld;
    finale = { t0: realT, stage: 0, next: 0, t3: 0, door: door.clone() };
    faceAim(Math.atan2(L.pyramid[0] - player.x, L.pyramid[1] - player.z), 0);
    World.openPyramid();
    safe(() => Sound.sfx.door());
    shake(0.8);
    flash(0.35);
    for (const m of quest.event('pyramid')) UI.toast(m, 'good');
    banishHush(); // the Hush cannot bear the whole song
    satTarget = Rules.saturation(3, true);
  }

  function banishHush() {
    for (const e of enemies) {
      const c = e.c;
      if (!c.alive) continue;
      c.hit(99, player);
      World.burst(c.pos.x, c.pos.y + (e.kind === 'warden' ? 1.9 : 0.2), c.pos.z, 20, 0xeae6ff, { speed: 4, up: 2, life: 1.2, size: 0.35, spread: 0.3, grav: -1 });
    }
    safe(() => Sound.sfx.enemyDie());
  }

  function updateFinale() {
    const f = finale;
    if (!f || state !== 'finale') return;
    const t = realT - f.t0;
    if (f.stage === 0 && t > 0.9) {
      f.stage = 1;
      safe(() => Sound.sfx.finale());
      flash(0.5);
      const d = f.door;
      World.burst(d.x, d.y + 4, d.z, 60, 0x7ff6ff, { speed: 6, up: 6, life: 1.8, size: 0.45, spread: 2, grav: -2 });
    }
    if (f.stage === 1 && t > 2.4) {
      f.stage = 2;
      f.next = t + FINALE_LINE;
      UI.dialogue(Quest.SPEAKERS.pyramid, Quest.LINES.pyramid, () => { f.stage = 3; f.t3 = realT - f.t0; flash(0.7); });
    }
    if (f.stage === 2 && t >= f.next) { f.next = t + FINALE_LINE; UI.advance(); }
    if (f.stage === 3 && t > f.t3 + 1.4) { f.stage = 4; showEnd(); }
  }

  function finaleCamera(dt) {
    const f = finale;
    if (!f) return updatePlayCamera(dt);
    const t = realT - f.t0, k = smoothstep(0, 9, t), d = f.door;
    const ox = d.x - L.pyramid[0], oz = d.z - L.pyramid[1], ol = Math.hypot(ox, oz) || 1, ux = ox / ol, uz = oz / ol;
    const a = 0.35 * Math.sin(t * 0.12);
    const bx = ux * Math.cos(a) - uz * Math.sin(a), bz = uz * Math.cos(a) + ux * Math.sin(a);
    const x = d.x + bx * lerp(9, 24, k), z = d.z + bz * lerp(9, 24, k);
    camera.position.set(x, Math.max(H(x, z) + 1.5, d.y + lerp(3, 10, k)), z);
    camera.lookAt(V1.set(L.pyramid[0], d.y + lerp(5, 14, k), L.pyramid[1]));
    applyShake(dt);
  }

  function showEnd() {
    state = 'end';
    Input.setMode('menu');
    uiRoot.classList.remove('jw-cine');
    const hits = LANES.reduce((n, l) => n + Sound.seq.songCount(l), 0);
    UI.end({ time: stats.playT, fireflies: player.fireflies, level: player.level, pocket: stats.casts ? stats.pocket / stats.casts : 0, moths: stats.kills, carved: hits }, {
      jam: keepJamming,
      replay: () => location.reload(),
    });
  }

  function keepJamming() {
    jam = true;
    finale = null;
    state = 'play';
    Input.setMode('play');
    me.heading = Rules.wrapAngle(me.heading + Math.PI); // turn from the door to the singing jungle
    cam.yaw = me.heading;
    cam.pitch = 0.3;
    snapCamera();
    later(0.6, () => UI.toast('JAM MODE · CARVE AT ANY STONE, EDIT IN THE BOOK', 'quest'));
  }

  /* ---------- music reactions ---------- */

  function onLoopHit(ev) {
    if (ev.lane === 'kick') World.bounceMushrooms(ev.ghost ? 0.45 : 1);
    if (!ev.ghost && realT - lastLoopFlash > 0.1 && cd.stomp <= 0 && cd.bolt <= 0 && cd.quake <= 0) {
      lastLoopFlash = realT;
      wiz.setOrbColor(LANE_HEX[ev.lane]);
    }
  }

  /* ---------- wizard, camera, post ---------- */

  function syncWizard() {
    wiz.group.position.set(player.x, wizHidden ? -60 : player.y, player.z);
    wiz.group.rotation.y = me.heading;
    wiz.group.updateMatrixWorld(true);
  }

  function updateWizard(dt) {
    syncWizard();
    wiz.update(dt, { t: realT, speed01: clamp(me.speed / RUN, 0, 1), moving: state === 'play' && me.speed > 0.3, songPos: songPos >= 0 ? songPos : undefined, grounded: !me.dash });
    const g = H(player.x, player.z);
    shadow.visible = !wizHidden && g > Terrain.WATER_Y - 0.25 && !me.dead;
    shadow.position.set(player.x, g + 0.06, player.z);
    const lift = clamp(1 - (player.y - g) / 3, 0, 1);
    shadow.material.opacity = 0.5 * lift;
  }

  function snapCamera() {
    cam.target.set(player.x, player.y + cam.height, player.z);
  }

  function updatePlayCamera(dt) {
    const k = 1 - Math.exp(-dt * 12), ky = 1 - Math.exp(-dt * 7);
    cam.target.x += (player.x - cam.target.x) * k;
    cam.target.z += (player.z - cam.target.z) * k;
    cam.target.y += (player.y + cam.height - cam.target.y) * ky;
    playCamPose(cam.target.x, cam.target.y, cam.target.z, cam.yaw, cam.pitch, camera.position, V1);
    camera.lookAt(V1);
    applyShake(dt);
  }

  // The third-person camera for a target point: behind it along yaw, raised by pitch, pulled in
  // before hills and giant trunks. Writes the camera position and the point it looks at.
  function playCamPose(tx, ty, tz, yaw, pitch, outPos, outLook) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx0 = Math.sin(yaw), fz0 = Math.cos(yaw), rx = -fz0, rz = fx0;
    // the pivot sits over his right shoulder, so the crosshair is never behind him
    const px = tx + rx * cam.shoulder, py = ty, pz = tz + rz * cam.shoulder;
    const bx = -fx0 * cp, by = sp, bz = -fz0 * cp;
    let d = Rules.cameraDistance(H, px, py, pz, bx, by, bz, cam.dist);
    d = blockedDistance(px, pz, bx, bz, d);
    const cx = px + bx * d, cz = pz + bz * d;
    const cy = Math.max(py + by * d, Math.max(H(cx, cz), Terrain.WATER_Y) + 0.45);
    outPos.set(cx, cy, cz);
    outLook.set(px, py, pz);
  }

  // The Summoning Tree and the pyramid are too big to see through: the camera pulls in front of them.
  function blockedDistance(px, pz, bx, bz, d) {
    const hl = Math.hypot(bx, bz);
    if (hl < 1e-4) return d;
    const ux = bx / hl, uz = bz / hl;
    for (const [cx, cz, r] of blockers) {
      const ox = px - cx, oz = pz - cz, c = ox * ox + oz * oz - r * r;
      if (c <= 0) continue;
      const b = ox * ux + oz * uz, disc = b * b - c;
      if (disc < 0) continue;
      const s = -b - Math.sqrt(disc);
      if (s > 0 && s < d * hl) d = Math.max(Rules.CAMERA.minDist, (s - 0.5) / hl);
    }
    return d;
  }

  function shake(a, hold = false) { fx.shake = hold ? Math.max(fx.shake, a) : Math.min(1.4, Math.max(fx.shake, a)); }
  function flash(a) { fx.flash = Math.max(fx.flash, a); }

  function applyShake(dt) {
    if (fx.shake < 0.002) return;
    const s = fx.shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
    camera.rotation.z += (Math.random() - 0.5) * fx.shake * 0.03;
    fx.shake *= Math.exp(-dt * 7);
  }

  function startRipple(x, y, z) {
    V4.set(x, y, z).project(camera);
    let u = V4.x * 0.5 + 0.5, v = V4.y * 0.5 + 0.5;
    if (!(V4.z < 1) || !Number.isFinite(u) || !Number.isFinite(v)) { u = 0.5; v = 0.5; }
    fx.ripple = { t: 0, u: clamp(u, -0.3, 1.3), v: clamp(v, -0.3, 1.3) };
  }

  function updatePost(rdt) {
    const U = Render.U;
    U.time.value = realT;
    satBase += (satTarget - satBase) * (1 - Math.exp(-rdt * 1.4));
    U.sat.value = Math.min(1.2, satBase + fx.satPulse);
    fx.satPulse *= Math.exp(-rdt * 2.6);
    if (fx.satPulse < 0.004) fx.satPulse = 0;
    U.hush.value = state === 'play' || state === 'dialogue' || state === 'book' ? hushLevel : state === 'paused' ? Math.max(hushLevel, 0.35) : 0;
    U.flash.value = fx.flash;
    fx.flash *= Math.exp(-rdt * 4.5);
    U.glitch.value = fx.glitch;
    fx.glitch *= Math.exp(-rdt * 3.5);
    if (fx.ripple) {
      const r = fx.ripple;
      r.t += rdt;
      const k = clamp(r.t / RIPPLE_T, 0, 1);
      U.ripple.value.set(r.u, r.v, 2.6 * (1 - (1 - k) * (1 - k)));
      U.rippleAmt.value = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) { fx.ripple = null; U.rippleAmt.value = 0; }
    }
    // dying fades to black; waking fades back in
    let fade = 0;
    if (me.dead) fade = clamp((me.deadT - 2.1) / 0.8, 0, 1);
    if (me.fadeIn > 0) { me.fadeIn = Math.max(0, me.fadeIn - rdt); fade = Math.max(fade, me.fadeIn / 0.9); }
    U.fade.value = fade;
  }

  /* ---------- HUD, zones ---------- */

  const zone = { id: null, pending: null, since: 0 };
  function updateZone(dt) {
    const z = Rules.zoneAt(player.x, player.z, L);
    if (z.id === zone.id) { zone.pending = null; return; }
    if (!zone.pending || zone.pending.id !== z.id) { zone.pending = z; zone.since = 0; }
    zone.since += dt;
    if (zone.since > (zone.id === null ? 0.3 : 0.9)) {
      zone.id = z.id;
      zone.pending = null;
      if (z.name) UI.toast(z.name, 'zone');
    }
  }

  function objectiveHud() {
    const o = quest.objective();
    if (!o.target) return { text: o.text, angle: 0, dist: NaN };
    let [tx, tz] = o.target;
    if (o.id === 'pyramid') { tx = W.pyramid.doorWorld.x; tz = W.pyramid.doorWorld.z; }
    if (o.id === 'toad') { tx = toadAt.x; tz = toadAt.z; }
    return { text: o.text, angle: Rules.bearing(cam.yaw, player.x, player.z, tx, tz), dist: Math.hypot(tx - player.x, tz - player.z) };
  }

  function updateHud(snap) {
    for (const n of SPELL_NAMES) abilities[n].cd01 = cdMax[n] > 0 ? clamp(cd[n] / cdMax[n], 0, 1) : 0;
    UI.update({
      vibe: player.vibe, maxVibe: player.maxVibe, fireflies: player.fireflies, level: player.level, xp01: Rules.level(me.xp).xp01,
      objective: state === 'finale' || state === 'end' ? null : objectiveHud(),
      snap, step: songPos, chord: safe(() => Sound.chordName()) || '-', abilities, beat01: pulse, locked: Input.locked,
    });
    Input.setAbilities(abilities);
  }

  // A toast that is not repeated for `every` seconds.
  function hint(key, text, kind, every = 4) {
    if (realT - (hints[key] || -99) < every) return;
    hints[key] = realT;
    UI.toast(text, kind);
  }

  /* ---------- window.JW: the test hook ---------- */

  const JW = {
    get state() { return state; },
    get frames() { return frames; },
    start: startGame,
    skipIntro,
    get player() { return player; },
    get abilities() { return abilities; },
    teleport(x, z) { teleport(x, z); },
    unlockAll() {
      for (const who of ['panther', 'toad']) {
        abilities[who === 'panther' ? 'bolt' : 'quake'].unlocked = true;
        quest.event('spirit', who);
      }
      panther.awaken();
    },
    cast(name, onBeat = false) {
      if (!abilities[name]) return null;
      const lane = Rules.SPELLS[name].lane;
      let t = performance.now();
      if (onBeat && lane && Sound.running) t = Rules.beatPress(Sound.pos(), t, Sound.latencyMs);
      return castSpell(name, t, true);
    },
    aimAt(x, y, z) {
      forcedAim = { p: new THREE.Vector3(x, y, z), until: realT + 5 };
      const h = Math.atan2(x - player.x, z - player.z);
      faceAim(h, 0.8);
      cam.yaw = h;
    },
    interact,
    advance() {
      if (state === 'dialogue') UI.advance();
      else press('advance', performance.now());
    },
    openBook() { openBook(0); },
    closeBook,
    sat() { return Render.U.sat.value; },
    enemies() { return enemies.map((e) => ({ kind: e.kind, x: e.c.pos.x, z: e.c.pos.z, hp: e.c.hp, alive: e.c.alive })); },
    get seq() { return Sound.seq; },
    get quest() { return quest; },
    get world() { return W; },
    get L() { return L; },
  };

  try {
    boot();
    window.JW = JW;
  } catch (e) {
    console.error(e);
  }

  return { get state() { return state; }, get booted() { return booted; }, JW };
})();
