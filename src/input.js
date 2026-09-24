'use strict';
/* input.js: one input state for keyboard, mouse and touch.
   Desktop: WASD, keys and mouse with pointer lock. Touch: a floating joystick on the
   left half, a camera drag zone on the right half and spell buttons. The game reads it
   once a frame through Input.move, Input.consumeLook() and Input.consume(). Press
   times come from the event's timeStamp, because the rhythm judge counts milliseconds. */

const Input = (() => {
  const STICK_R = 56; // px from the joystick base to its rim
  const DEAD = 0.14; // fraction of the rim that does nothing
  const TOUCH_GAIN = 2.2; // a thumb covers less ground than a mouse for the same turn
  const RAD_PER_PX = 0.0024; // suggested camera turn per look pixel at sensitivity 1
  const STORE = 'jw.input';

  const MOVE_KEYS = {
    KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const KEYMAP = {
    play: { Space: 'stomp', KeyJ: 'bolt', KeyK: 'quake', ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'interact', Tab: 'book', KeyB: 'book', KeyP: 'pause', Escape: 'pause', KeyM: 'mute' },
    dialogue: { Space: 'advance', KeyE: 'advance', Enter: 'advance', NumpadEnter: 'advance', KeyP: 'pause', Escape: 'pause', KeyM: 'mute' },
    book: { Tab: 'book', KeyB: 'book', Escape: 'book', KeyM: 'mute' },
    menu: { Space: 'advance', Enter: 'advance', NumpadEnter: 'advance', KeyE: 'advance', KeyP: 'pause', KeyM: 'mute' },
  };
  const SPELLS = [
    ['stomp', 'kick', 'STOMP'], ['bolt', 'snare', 'BOLT'], ['quake', 'bass', 'QUAKE'], ['dash', 'dash', 'DASH'],
  ];

  /* ---------- pure helpers (Node-testable) ---------- */

  // Thumb offset in screen px -> move vector, y = forward. Ramps from the deadzone edge, clamps at the rim.
  function stick(dx, dy, radius = STICK_R, dead = DEAD) {
    const d = Math.hypot(dx, dy), m = d / radius;
    if (!(m > dead)) return { x: 0, y: 0 };
    const k = Math.min(1, (m - dead) / (1 - dead)) / d;
    return { x: dx * k, y: -dy * k };
  }

  // The floating base trails the thumb once it slides past the rim.
  function follow(ox, oy, px, py, radius = STICK_R) {
    const dx = px - ox, dy = py - oy, d = Math.hypot(dx, dy);
    if (d <= radius) return { x: ox, y: oy };
    const k = (d - radius) / d;
    return { x: ox + dx * k, y: oy + dy * k };
  }

  const unit = (x, y) => { const l = Math.hypot(x, y); return l > 1 ? { x: x / l, y: y / l } : { x, y }; };

  function keyAxes(codes) {
    let x = 0, y = 0;
    for (const c of new Set(codes)) { const v = MOVE_KEYS[c]; if (v) { x += v[0]; y += v[1]; } }
    return unit(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  const combine = (a, b) => unit(a.x + b.x, a.y + b.y);
  const keyAction = (code, m) => (KEYMAP[m] && KEYMAP[m][code]) || null;

  function mouseAction(button, m) {
    if (m === 'play') return button === 0 ? 'bolt' : button === 2 ? 'quake' : null;
    return (m === 'dialogue' || m === 'menu') && button === 0 ? 'advance' : null;
  }

  // event.timeStamp is on the performance clock in modern browsers; fall back to now when it is not.
  const stamp = (ts, now) => (ts > 0 && ts <= now + 1 && now - ts < 2000 ? ts : now);

  function lookDelta(dx, dy, s, isTouchDrag) {
    const k = ((s && s.sensitivity) || 1) * (isTouchDrag ? TOUCH_GAIN : 1);
    return { dx: dx * k, dy: dy * k * (s && s.invertY ? -1 : 1) };
  }

  function cleanSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    const sens = Number(s.sensitivity);
    return {
      sensitivity: Number.isFinite(sens) && s.sensitivity !== null ? clamp(Math.round(sens * 20) / 20, 0.25, 3) : 1,
      invertY: !!s.invertY && s.invertY !== 'false',
    };
  }

  /* ---------- live state ---------- */

  let root = null, canvas = null, layer = null, els = {};
  let mode = 'play', touch = false, lastTouch = -1e9, listening = false;
  let locked = false, lockFails = 0, wantUnlock = false, lastPause = -1e9;
  let settings = cleanSettings(null);
  let interactLabel = null;
  const keys = new Set();
  const queue = [];
  const look = { dx: 0, dy: 0 };
  const pad = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const drag = { id: null, x: 0, y: 0 };
  const shown = {}; // what the spell buttons currently show

  const now = () => performance.now();
  const coarse = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const icon = (n) => (typeof UI !== 'undefined' && UI.icon ? UI.icon(n) : '');

  function push(action, t) {
    if (action === 'pause') { if (t - lastPause < 250) return; lastPause = t; }
    queue.push({ action, t });
  }

  function readSettings() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } }
  function setSettings(s) {
    settings = cleanSettings(Object.assign({}, settings, s));
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* private mode */ }
    return Object.assign({}, settings);
  }

  /* ---------- DOM: the touch layer ---------- */

  function el(tag, cls, attrs, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (html) e.innerHTML = html;
    return e;
  }

  function build() {
    if (layer) layer.remove();
    layer = el('div', 'jw-touch');
    els.move = layer.appendChild(el('div', 'jw-zone jw-zone-move', { 'data-touch': 'joystick' }));
    els.look = layer.appendChild(el('div', 'jw-zone jw-zone-look', { 'data-touch': 'look' }));
    els.stick = layer.appendChild(el('div', 'jw-stick', { 'aria-hidden': 'true' }, '<i class="jw-stick-base"></i><i class="jw-stick-knob"></i>'));
    els.knob = els.stick.lastChild;
    const spells = layer.appendChild(el('div', 'jw-spells'));
    els.spell = {};
    for (const [name, tint, label] of SPELLS) {
      els.spell[name] = spells.appendChild(el('button', 'jw-tb jw-spell jw-spell-' + name, { type: 'button', 'data-action': name, 'data-tint': tint, 'aria-label': label },
        `<span class="jw-tb-ico">${icon(name)}</span><span class="jw-tb-name">${label}</span><span class="jw-tb-cd"></span><span class="jw-tb-lock">${icon('lock')}</span>`));
    }
    els.act = layer.appendChild(el('button', 'jw-tb jw-act', { type: 'button', 'data-action': 'interact', hidden: '' }, '<span class="jw-act-label"></span>'));
    els.actLabel = els.act.firstChild;
    const sys = layer.appendChild(el('div', 'jw-sys'));
    els.sys = {};
    for (const [name, label] of [['book', 'Spellbook'], ['pause', 'Pause'], ['mute', 'Mute']]) {
      els.sys[name] = sys.appendChild(el('button', 'jw-tb jw-sysb', { type: 'button', 'data-action': name, 'aria-label': label }, icon(name === 'mute' ? 'sound' : name)));
    }
    for (const z of [els.move, els.look]) z.addEventListener('pointerdown', onZoneDown);
    for (const b of layer.querySelectorAll('button')) {
      b.addEventListener('pointerdown', onButtonDown);
      b.addEventListener('click', onButtonClick);
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, () => b.classList.remove('is-down'));
    }
    root.appendChild(layer);
    for (const k in shown) delete shown[k];
    interactLabel = null;
  }

  function setTouch(on) {
    if (on === touch && root && root.classList.contains('jw-touch-on') === on) return;
    touch = on;
    if (root) root.classList.toggle('jw-touch-on', on);
    if (on && locked) unlock();
  }

  function noteTouch() { lastTouch = now(); if (!touch) setTouch(true); }

  function drawPad() {
    if (!els.stick) return;
    if (pad.id === null) {
      els.stick.classList.remove('is-live');
      els.stick.style.transform = '';
      els.knob.style.transform = '';
      return;
    }
    const k = stick(pad.x - pad.ox, pad.y - pad.oy, STICK_R, 0);
    els.stick.classList.add('is-live');
    els.stick.style.transform = `translate(${Math.round(pad.ox)}px, ${Math.round(pad.oy)}px)`;
    els.knob.style.transform = `translate(${Math.round(k.x * STICK_R)}px, ${Math.round(-k.y * STICK_R)}px)`;
  }

  function releasePad() { if (pad.id !== null) { pad.id = null; drawPad(); } }

  function onZoneDown(e) {
    if (e.pointerType === 'mouse') return; // the mouse is handled at the window
    e.preventDefault();
    noteTouch();
    if (mode !== 'play') { if (mode === 'dialogue' || mode === 'menu') push('advance', stamp(e.timeStamp, now())); return; }
    const zone = e.currentTarget.getAttribute('data-touch');
    if (zone === 'joystick' && pad.id === null) {
      pad.id = e.pointerId; pad.ox = pad.x = e.clientX; pad.oy = pad.y = e.clientY;
      drawPad();
    } else if (zone === 'look' && drag.id === null) {
      drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY;
    } else return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
  }

  function onPointerMove(e) {
    if (e.pointerType === 'mouse') { if (touch && now() - lastTouch > 1000) setTouch(false); return; }
    if (e.pointerId === pad.id) {
      pad.x = e.clientX; pad.y = e.clientY;
      const o = follow(pad.ox, pad.oy, pad.x, pad.y, STICK_R);
      pad.ox = o.x; pad.oy = o.y;
      drawPad();
    } else if (e.pointerId === drag.id) {
      const d = lookDelta(e.clientX - drag.x, e.clientY - drag.y, settings, true);
      look.dx += d.dx; look.dy += d.dy;
      drag.x = e.clientX; drag.y = e.clientY;
    }
  }

  function onPointerEnd(e) {
    if (e.pointerId === pad.id) releasePad();
    if (e.pointerId === drag.id) drag.id = null;
  }

  function onButtonDown(e) {
    e.preventDefault(); // no focus ring, no emulated mouse events, no double-tap zoom
    if (e.pointerType !== 'mouse') noteTouch();
    const b = e.currentTarget;
    b.classList.add('is-down');
    b._downAt = now();
    press(b.getAttribute('data-action'), stamp(e.timeStamp, now()));
  }

  // Keyboard activation of a focused button (Enter / Space) arrives as a lone click. A tap also
  // ends in a click, right after its pointerdown, and must not count twice.
  function onButtonClick(e) {
    const b = e.currentTarget;
    if (e.detail === 0 && now() - (b._downAt || -1e9) > 800) press(b.getAttribute('data-action'), now());
  }

  function press(action, t) {
    push(action, t);
    if (action === 'mute') { setTimeout(syncMute, 50); setTimeout(syncMute, 400); }
  }

  function syncMute() {
    const muted = typeof Sound !== 'undefined' && !!Sound.muted;
    if (!els.sys || shown.muted === muted) return;
    shown.muted = muted;
    els.sys.mute.innerHTML = icon(muted ? 'muted' : 'sound');
    els.sys.mute.classList.toggle('is-off', muted);
  }

  /* ---------- keyboard and mouse ---------- */

  const editable = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  function onKeyDown(e) {
    if (editable(e.target)) return;
    const moving = !!MOVE_KEYS[e.code];
    if (moving) keys.add(e.code);
    const action = keyAction(e.code, mode);
    if (action && !e.repeat) push(action, stamp(e.timeStamp, now()));
    if (action || (moving && mode === 'play')) e.preventDefault();
  }

  function onKeyUp(e) { keys.delete(e.code); }

  function clearHeld() { keys.clear(); releasePad(); drag.id = null; }

  // Mouse presses only count on the game view itself: menus, the book and the boot screen handle their own clicks.
  const onView = (e) => locked || e.target === canvas || (e.target.closest && !!e.target.closest('.jw-zone'));
  const fromTouch = (e) => now() - lastTouch < 800 || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);

  function onMouseDown(e) {
    if (fromTouch(e) || !onView(e)) return;
    if (touch) setTouch(false);
    const action = mouseAction(e.button, mode);
    const t = stamp(e.timeStamp, now());
    if (mode === 'play') {
      if (!locked && lockFails < 2 && canvas && canvas.requestPointerLock) { lock(); return; } // the first click only captures the mouse
      if (action) push(action, t);
    } else if (action) {
      push(action, t);
      if (!locked && e.button === 0) lock();
    }
  }

  function onMouseMove(e) {
    if (mode !== 'play' || fromTouch(e)) return;
    if (!locked && !(e.buttons && onView(e))) return; // without pointer lock, drag to look
    const mx = clamp(e.movementX || 0, -250, 250), my = clamp(e.movementY || 0, -250, 250);
    const d = lookDelta(mx, my, settings, false);
    look.dx += d.dx; look.dy += d.dy;
  }

  function onContextMenu(e) { if (e.target.closest && e.target.closest('#game')) e.preventDefault(); }

  /* ---------- pointer lock ---------- */

  function lock() {
    if (!canvas || touch || locked || !canvas.requestPointerLock) return;
    let failed = false;
    const fail = () => { if (!failed) { failed = true; lockFails++; } };
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(fail);
    } catch (err) { fail(); }
  }

  function unlock() {
    if (!locked || !document.exitPointerLock) return;
    wantUnlock = true;
    document.exitPointerLock();
  }

  function onLockChange() {
    const on = !!canvas && document.pointerLockElement === canvas;
    if (on === locked) return;
    locked = on;
    if (on) { lockFails = 0; wantUnlock = false; return; }
    clearHeld();
    if (wantUnlock) { wantUnlock = false; return; }
    if (mode === 'play') push('pause', now()); // a real Esc (or alt-tab) pauses the game
  }

  function listen() {
    if (listening) return;
    listening = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('touchstart', noteTouch, { passive: true, capture: true });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', () => { lockFails++; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearHeld(); });
    // iOS Safari pinch-zooms even with touch-action: none unless its gesture events are cancelled.
    for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault());
  }

  /* ---------- API ---------- */

  function init(cv, r) {
    canvas = cv || document.getElementById('screen');
    root = r || document.getElementById('ui');
    settings = cleanSettings(readSettings());
    if (root) { build(); root.setAttribute('data-input', mode); }
    setTouch(coarse());
    listen();
    syncMute();
  }

  function consume() { return queue.splice(0, queue.length); }

  function consumeLook() {
    const d = { dx: look.dx, dy: look.dy };
    look.dx = 0; look.dy = 0;
    return d;
  }

  function setMode(m) {
    if (!KEYMAP[m] || m === mode) return;
    mode = m;
    if (m !== 'play') { releasePad(); drag.id = null; }
    if (root) root.setAttribute('data-input', m);
    if (m === 'book') unlock();
    const active = navigator.userActivation ? navigator.userActivation.isActive : false;
    if (m === 'play' && active) lock(); // back from the book with a click or key: recapture at once
  }

  function setInteract(label) {
    label = label ? String(label) : null;
    if (label === interactLabel) return;
    interactLabel = label;
    if (!els.act) return;
    if (label) els.actLabel.textContent = label;
    els.act.hidden = !label;
  }

  function setAbilities(ab) {
    if (!ab || !els.spell) return;
    for (const [name] of SPELLS) {
      const a = ab[name], b = els.spell[name];
      if (!a || !b) continue;
      const lockedNow = a.unlocked === false, cd = Math.ceil(clamp(a.cd01 || 0, 0, 1) * 40) / 40;
      const s = shown[name] || (shown[name] = { locked: null, cd: -1 });
      if (s.locked !== lockedNow) { s.locked = lockedNow; b.classList.toggle('is-locked', lockedNow); b.setAttribute('aria-disabled', lockedNow ? 'true' : 'false'); }
      if (s.cd !== cd) {
        if (s.cd > 0 && cd === 0) { b.classList.remove('is-ready'); void b.offsetWidth; b.classList.add('is-ready'); }
        s.cd = cd;
        b.style.setProperty('--cd', cd);
        b.classList.toggle('is-cooling', cd > 0);
      }
    }
    syncMute();
  }

  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not allowed here */ } }

  return {
    init, consume, consumeLook, setMode, setInteract, setAbilities, vibrate, lock, unlock, setSettings,
    get move() { return combine(pad.id === null ? { x: 0, y: 0 } : stick(pad.x - pad.ox, pad.y - pad.oy), keyAxes(keys)); },
    get isTouch() { return touch; },
    get locked() { return locked; },
    get mode() { return mode; },
    get settings() { return Object.assign({}, settings); },
    RAD_PER_PX, STICK_R,
    // pure helpers, exposed for tests
    stick, follow, keyAxes, combine, keyAction, mouseAction, stamp, lookDelta, cleanSettings,
  };
})();
