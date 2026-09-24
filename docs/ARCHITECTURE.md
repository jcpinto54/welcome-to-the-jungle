# Jungle Wizard: architecture contract

This is the contract every module is built against. Keep it true: if you change an interface, update this file.

## The game in one paragraph

A PS1-style, low-poly 3D action-RPG for **computer and phone browsers**. On a computer you play with keyboard and mouse (the owner's main way to play). On iPhone and Android you play with touch controls. You are the Jungle Wizard: a swamp-born tree creature torn out of a giant tree at the start. He has a bark body, root feet, a moss cloak, a long Spanish-moss beard, a crooked bark wizard hat with little glowing mushrooms, glowing eyes in a hollow face and a gnarled root staff with a glowing orb. He is not a cute or cartoon wizard. The jungle has gone grey and silent. Your spells are drums, locked to a 170 BPM lo-fi jungle groove:

- **Stomp = KICK** (Space): staff slam with a ground shockwave around you.
- **Bolt = SNARE** (left mouse or J): a magenta bolt that flies where you aim.
- **Quake = BASS** (right mouse or K): roots burst out in front of you and heavy sub bass shakes the ground.
- **Dash** (Shift): a quick burst of movement that is not recorded.

Every spell plays its drum and is written into a two-bar **draft loop**, quantized to 8th notes. Casting **on the beat** (within ±75 ms of a quarter note) is "in the pocket" and makes the spell stronger. The loop plays your draft back as quieter "ghost" hits. At a **Loop Stone** you press E to **carve** the draft into the song. Carving is permanent, turns the draft to full volume and floods colour back into the grey world. Three stones, two spirit unlocks (the Panther Spirit gives you the snare, the Sub Toad gives you the bass), a vine wall (burn it with bolts), a cracked-stone gate (break it with a quake) and the Lost Pyramid. The pyramid opens only when the song has kick, snare and bass carved. The game opens with a "WELCOME TO THE JUNGLE" scream and the wizard being summoned out of the Summoning Tree.

Aesthetic source: the "jungle wizard" YouTube channel (@junglewizards): ambient and atmospheric DnB, a grizzled old wizard with a glowing staff, dithered 90s-CG jungle, waterfalls, orange mushrooms, neon grids, a pyramid with an eye, VHS glitch, and Japanese subtitles in titles (e.g. "magic user 穏やか"). The channel has "PS1 style" and "low poly" mixes. All art here is original and built in code, with no image files.

## Tech rules

- Three.js **r159 UMD** (`THREE` global), loaded from `https://cdnjs.cloudflare.com/ajax/libs/three.js/0.159.0/three.min.js` with a fallback to `vendor/three.min.js`. There are no ES modules and no build step. Every file in `src/` is a classic script that defines **one global** (`const Foo = (() => { ... })();`). Opening `index.html` from disk must work.
- `THREE.ColorManagement.enabled = false` and `renderer.outputColorSpace = LinearSRGBColorSpace`, so hex colours are used as written.
- PS1 look: the scene renders into a ~240-line render target with an integer upscale (195 / 240 / 270 lines by screen height), upscaled with nearest filtering (`render.js`; `Render.stats` has per-frame draw calls and triangles). Materials get vertex snapping through `World.ps1(material)`. Textures are tiny canvases with `NearestFilter` (`textures.js`). Geometry is low-poly with flat shading.
- **Targets: desktop and mobile, both first-class.** Desktop browsers (Chrome, Firefox, Safari, Edge) use keyboard and mouse with pointer lock. This is the owner's main way to play, so desktop gets its own polished layout (key hints, crosshair, hover states at 1280x720 through 2560x1440), not a stretched phone UI. Phones (iPhone Safari iOS 16+, Android Chrome) use touch in landscape. The touch layer only appears on touch devices. A portrait phone shows a "rotate your phone" screen. Respect the notch with `env(safe-area-inset-*)`. The game is also a PWA (manifest plus service worker) so it installs to the home screen and runs full-screen. App Store and Play Store builds come later by wrapping the same files with Capacitor.
- **Mobile performance budget:** a typical view stays under 100 draw calls and 250k triangles, at most 3 dynamic point lights, no shadows, little alpha overdraw. The render target is about 240 lines with an integer upscale factor (e.g. 195 lines on a 390px-tall phone). `World.build(scene, {quality: 'low'|'high'})` thins vegetation on weak devices.
- **iOS audio:** resume the AudioContext inside the first touch handler. Set `navigator.audioSession.type = 'playback'` where it exists, so the silent switch doesn't mute the game. Resume after interruptions and on `visibilitychange`.
- Artifact constraints (the game is also published as a single HTML page). Scripts may only come from cdnjs, jsdelivr or unpkg, fonts only from Google Fonts. Nothing else external. No `alert`, `confirm` or `prompt`, and no downloads.
- **Pure logic must be Node-testable.** The modules marked *pure* must not touch `THREE`, `document` or `AudioContext` at load time. Tests load `src/*.js` into a `vm` context through `tests/helpers/load.js`.

## Script order (index.html)

```
three.min.js
src/core.js        pure  constants and helpers (BPM, STEP, BEAT, LOOP, LANES, LANE_COLOR, LANE_HEX, LANE_NAME,
                         clamp, lerp, mod, smoothstep, dist2, rng, hash2, vnoise, fbm, makeCanvas)
src/sequencer.js   pure  Sequencer: song, draft, quantize, judge, carve
src/sound.js             Sound: Web Audio engine (uses Sequencer)
src/terrain.js     pure  Terrain: landmarks, heightAt, canStep, colliders
src/textures.js          TEX: procedural pixel textures
src/world.js             World: builds the 3D jungle from Terrain
src/render.js            Render: renderer, low-res target, post shader
src/wizard.js            Wizard: the tree wizard model and procedural animation
src/creatures.js         Creatures: moths, warden, Panther Spirit, Sub Toad (models and AI)
src/quest.js       pure  Quest: objectives and progression state machine
src/input.js             Input: keyboard, mouse and touch (joystick, camera drag, spell buttons) as one input state
src/ui.js                UI: DOM HUD, dialogue, spellbook, overlays
src/game.js              Game: input, camera, player, spells, combat, states, glue
src/pwa.js               PWA: registers sw.js (skips iframes, file:// and localhost without #sw)
```

## Interfaces

### Sequencer (pure, `src/sequencer.js`)

```
Sequencer.create({ draftCap = {kick:6, snare:6, bass:4}, songCap = 12, beatWindow = 0.075 }) -> seq
seq.song[lane]   Uint8Array(32), 1 = carved hit
seq.draft[lane]  Int32Array(32), global step it was recorded at, or -1
seq.judge(pos)            pos = float global 16th-step position the player heard
                          -> { onBeat, errMs, q, step }   q = nearest even (8th) global step, step = q mod 32
seq.record(lane, q)       write into the draft (FIFO per lane up to draftCap; re-hitting a step refreshes it)
seq.shouldPlay(lane, g)   -> { carved, ghost }  ghost only if not carved and g - born >= 32
                          (a hit is never replayed in the same pass it was played live)
seq.carve()               merge the draft into the song (songCap per lane), clear the draft, return [{lane, s}] added
seq.toggle(lane, s) -> 0|1, seq.clearLane(lane), seq.reset()
seq.draftCount(lane), seq.songCount(lane), seq.hasFullGroove()   (every lane has at least 1 carved hit)
seq.snapshot() -> { song: {lane: number[32]}, draft: {lane: boolean[32]} }
```

### Sound (`src/sound.js`)

```
Sound.prepare()          render instrument buffers offline (no gesture needed)
Sound.unlock()           create/resume the AudioContext (call from a user gesture), returns a promise
Sound.start(delaySec)    start the 170 BPM transport, returns the start time
Sound.pos()              float global step heard right now (-1 before start)
Sound.posAt(perfMs)      same for an input event timestamp
Sound.hit(lane, perfMs)  play the lane sound now and record it, -> { onBeat, errMs, step }
Sound.seq                the Sequencer instance
Sound.carve(), Sound.toggle(lane, s), Sound.clearLane(lane), Sound.resetSong()
Sound.drain(cb)          cb({lane, t, ghost}) for each loop hit as it reaches the listener
Sound.beatPulse()        1 at each quarter note, decaying to 0
Sound.setHush(0..1)      low-pass the mix (Hush creatures are near)
Sound.setProgress(0..1)  opens the tape filter as stones get carved
Sound.setGift(bool)      finale layer (8-bit arp and ride)
Sound.toggleMute(), Sound.readSpectrum() -> Uint8Array(32), Sound.scream()
Sound.chordName(), Sound.running, Sound.muted, Sound.ready
Sound.sfx.{ firefly(combo), boing, whoosh, crumble, hurt, ui, unlock, carve, finale, slam(i), riser, drop(t),
            dash, levelup, talk, hitEnemy, enemyDie, door, emerge }
```

### Terrain (pure, `src/terrain.js`)

```
Terrain.L            landmarks {name: [x, z]}: tree, spawn, swamp, clearing, stone1, ruins, altar, gate1,
                     hollow, pool, falls, stone2, toad, gate2, stone3, pyramid, warden
Terrain.PATHS        polylines [[x, z], ...] from spawn to pyramid
Terrain.PLATEAU_Y, Terrain.WATER_Y (0)
Terrain.pathDist(x, z), Terrain.heightAt(x, z)
Terrain.canStep(ax, az, bx, bz)   false for cliffs (rise > 1.1 per unit) and the world edge
Terrain.createColliders() -> { addCircle(x,z,r), addBox(x0,z0,x1,z1,id) -> box {active},
                              collide(p, r) (pushes p.x / p.z out), blockedByBox(x, z, r) -> box|null, boxes }
Terrain.GRID, Terrain.BOXES, Terrain.MAX_SLOPE, Terrain.slopeAt(x, z), Terrain.keepClear(x, z)
```

World axes: x = east, z = south, y = up. North is -z. The ridge at z = -11 has one gap at x = 14 (the vine wall). The plateau (y about 9) north of z = -68 is reached only by the ramp at x = 61, where the cracked gate is (61, -70).

### World (`src/world.js`)

`World.build(scene, { quality: 'low'|'high' })` builds everything (it also sets `scene.fog`, so don't override it) and returns `W` with: `colliders`, `stones[3]` (`{key, x, y, z, group, runeMats, notches, glow, carved}`), `vineWall {x, z, hp, box, alive, mesh}`, `crackedGate {x, z, box, alive, group, blocks}`, `pyramid {group, doorWorld (Vector3), open, ...}`, `tree {group, wound, woundMat, woundGlow}` (the Summoning Tree), `altarTop` (y), `mushrooms`, `fireflies [{x, y, z, taken}]`, `mothSpawns [[x, z]]`. World renders the fireflies itself (the game only sets `taken`). The visual actions set `alive` / `box.active` / `open` / `carved` themselves. Extras: `tree.woundWorld` (Vector3 of the glowing wound), `World.burst(...)` (particle burst). It also has `World.update(t, dt, pulse)`, `World.ps1(mat)`, `World.SNAP`, `World.TIME`, and visual actions: `World.carveStone(i)`, `World.updateStones(snapshot, playStep, pulse)`, `World.burnVines()`, `World.breakGate()`, `World.openPyramid()`, `World.bounceMushrooms(amount)`.

### Wizard (`src/wizard.js`)

```
Wizard.create() -> wiz
wiz.group                 THREE.Group, origin at the feet, faces local +Z, about 2.4 tall to the brim (~3.3 with hat)
wiz.update(dt, { t, speed01, moving, songPos, grounded })   procedural animation, idles and walks to the beat
wiz.act(name)             'stomp' | 'bolt' | 'quake' | 'dash' | 'hurt' | 'die' | 'talk' | 'emerge'
wiz.orbWorld(v3)          writes the staff orb's world position into v3
wiz.setOrbColor(hex)      the orb flashes the lane colour of the last spell
wiz.setEmerge(k)          0..1, pose for being pulled out of the tree (intro)
wiz.light                 the orb PointLight (the only dynamic light that moves)
```

### Creatures (`src/creatures.js`)

```
Creatures.moth(scene, x, y, z) -> { group, hp, alive, pos (Vector3), update(dt, env), hit(dmg, fromV3) -> died }
Creatures.warden(scene, x, y, z) -> same shape; update() returns { rings: [...] } (silence rings it emits)
Creatures.panther(scene, x, y, z) -> { group, update(dt, t, pulse), awaken() }
Creatures.toad(scene, x, y, z)    -> { group, update(dt, t, pulse), croak() }
Creatures.steer(...)      pure AI helpers (Node-testable), e.g. mothSteer(state, player, dt)
env = { player: {x, y, z}, heightAt, t, pulse }
```

### Quest (pure, `src/quest.js`)

```
Quest.create(L) -> q            L = landmark map (Terrain.L), used for objective targets
q.state   { carved: [b, b, b], panther, toad, vines, gate, pyramid, done }
q.objective() -> { id, text, target: [x, z] | null }   first unfinished step, in order:
  stone1 -> panther -> vines -> stone2 -> toad -> gate -> stone3 -> pyramid -> done
q.event(name, arg) -> [messages]   names: 'carve'(i), 'spirit'('panther'|'toad'), 'vines', 'gate', 'pyramid'
q.pyramidReady(hasFullGroove) -> { ok, missing: [...] }
```

### Input (`src/input.js`)

One input state for touch, keyboard and mouse. The touch controls are DOM elements inside `#ui`, styled in style.css:
- a floating joystick on the left half of the screen
- camera drag on the right half
- a spell cluster at the bottom right: STOMP (kick, the biggest button), BOLT (snare), QUAKE (bass) and DASH, each with a cooldown sweep and a locked look
- a contextual action button (CARVE / TALK / OPEN)
- BOOK, PAUSE and MUTE at the top right
Touching a button never also drags the camera. Press times use the event's `timeStamp` (the rhythm judge needs it).

```
Input.init(canvas, root)
Input.move -> {x, y}            -1..1 from the joystick or WASD (y = forward)
Input.consumeLook() -> {dx, dy} camera deltas since the last call (touch drag or mouse), in pixels
Input.consume() -> [{action, t}] presses since the last call; actions: stomp, bolt, quake, dash, interact, book, pause, mute, advance
Input.isTouch                   true once a touch has been seen (show the touch layout)
Input.setMode('play'|'dialogue'|'book'|'menu')   which controls are visible and active
Input.setInteract(label|null)   show or hide the contextual action button
Input.setAbilities({stomp, bolt, quake, dash: {unlocked, cd01}})
Input.vibrate(ms)               haptic tick where supported (Android; iOS ignores it)
```

On touch, bolts auto-aim at the nearest enemy or target in front of the wizard (game.js). Desktop uses the crosshair.

Stable hooks for tests: every touch button has `data-action="stomp|bolt|quake|dash|interact|book|pause|mute"`, the joystick area has `data-touch="joystick"`, the camera drag area has `data-touch="look"`, and the portrait overlay has `data-overlay="rotate"`.

### UI (`src/ui.js`, `src/style.css`)

DOM overlay built inside `#ui`. `UI.init(root)`, `UI.update(hud)` every frame (cheap: only touch DOM on change). Methods: `UI.toast(text, kind)`, `UI.pocket(lane)`, `UI.prompt(text|null)`, `UI.dialogue(speaker, lines, onDone)`, `UI.advance()`, `UI.inDialogue`, `UI.openBook(seq, {toggle, clearLane, close})`, `UI.closeBook()`, `UI.bookOpen`, `UI.showBoot(onStart)`, `UI.introWord(text, i)`, `UI.title(show)`, `UI.pause(show)`, `UI.end(stats, {jam, replay})`, `UI.hideEnd()`.

`hud = { vibe, maxVibe, fireflies, level, xp01, objective: {text, angle, dist} | null, snap (seq.snapshot()), step, chord, abilities: {stomp, bolt, quake, dash: {unlocked, cd01}}, beat01, locked }`

### Game (`src/game.js`)

Owns the states `boot -> intro -> play <-> (dialogue | book | paused) -> finale -> end` plus jam mode. Pausing (pointer unlock) only happens on a real Esc/unlock, never because pointer lock was refused (tests and some embeds can't lock the mouse; the game must stay playable).

`window.JW` is the test hook (the acceptance tests in `tests/e2e/game.test.cjs` use exactly this):

```
JW.state                  getter: 'boot' | 'intro' | 'play' | 'dialogue' | 'book' | 'paused' | 'finale' | 'end'
JW.frames                 rendered frame count
JW.start()                same as clicking the boot screen; returns a promise
JW.skipIntro()            jump straight to 'play' at the spawn with the transport running
JW.player                 live { x, y, z, vibe, maxVibe, fireflies, level }
JW.abilities              live { stomp, bolt, quake, dash: { unlocked } }
JW.teleport(x, z)         move the wizard (y follows the ground)
JW.unlockAll()            snare + bass unlocked (as if both spirits were met)
JW.cast(name, onBeat)     'stomp' | 'bolt' | 'quake' | 'dash' as if the key was pressed; onBeat=true times it on
                          the nearest beat. Ignores cooldowns. Returns the Sound.hit() result (or null for dash)
JW.aimAt(x, y, z)         turn the camera/wizard so bolts fly at that point
JW.interact()             same as pressing E (talk, carve, open)
JW.advance()              same as pressing E/Space in a dialogue
JW.openBook(), JW.closeBook()
JW.sat()                  current saturation uniform
JW.enemies()              [{ kind, x, z, hp, alive }]
JW.seq, JW.quest, JW.world, JW.L (landmarks)
```

## Tests

- `npm test` runs `node --test "tests/*.test.js"` (unit tests of the pure modules, no dependencies).
- `npm run test:e2e` runs the Playwright smoke tests in `tests/e2e/`. They load `index.html`, block the CDN and serve `vendor/three.min.js`, fail on any console error, and write screenshots to `tests/e2e/shots/` (gitignored).
- Write the test first, watch it fail, then implement.
