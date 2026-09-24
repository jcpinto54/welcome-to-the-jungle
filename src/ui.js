'use strict';
/* ui.js: the DOM layer over the game view. The HUD (vibe hearts, fireflies and level,
   the quest compass, the loop strip, the ability bar, crosshair, toasts), the dialogue
   box, the spellbook and the full-screen cards (boot, intro words, title, pause, end,
   rotate). UI.update(hud) runs every frame, so it only writes to the DOM when a value
   it shows has changed. Touch controls live in input.js. */

const UI = (() => {
  // Pixel art, one string per row. Each letter becomes an SVG path with class p-<letter>.
  const ART = {
    heart: ['..ooo.ooo..', '.olllorrro.', 'olhhllrrrro', 'olhlllrrrro', 'olllllrrrro', '.ollllrrro.', '..olllrro..', '...ollro...', '....olo....', '.....o.....'],
    fly: ['...y...', '...y...', '..yhy..', 'yyhhhyy', '..yhy..', '...y...', '...y...'],
    stomp: ['....xxxx....', '....xxxx....', '....xxxx....', '..xxxxxxxx..', '...xxxxxx...', '....xxxx....', '.....xx.....', 'x..........x', '.x..x..x..x.', 'xxxxxxxxxxxx'],
    bolt: ['......xxxxx.', '.....xxxxx..', '....xxxxx...', '...xxxxx....', '..xxxxxxxxx.', '......xxxx..', '.....xxxx...', '....xxx.....', '...xxx......', '..xx........', '.xx.........', 'x...........'],
    quake: ['x....x....x.', 'x...xx...xx.', 'xx..x....x..', '.x..xx..xx..', '.xx..x..x...', '..x..xxxx...', '..xx..xx....', 'xxxxxxxxxxxx', '.x..x..x..x.', '...x.....x..'],
    dash: ['xx...xx.....', '.xx...xx....', '..xx...xx...', '...xx...xx..', '..xx...xx...', '.xx...xx....', 'xx...xx.....'],
    lock: ['..xxx..', '.x...x.', '.x...x.', 'xxxxxxx', 'xxx.xxx', 'xxx.xxx', 'xxxxxxx'],
    arrow: ['....h....', '...hhx...', '...hhx...', '..hhhxx..', '..hhhxx..', '.hhhhxxx.', '.hhhhxxx.', 'hhhhhxxxx', 'hhh...xxx', 'hh.....xx'],
    book: ['.xxxx.xxxx.', 'x....x....x', 'x.xx.x.xx.x', 'x....x....x', 'x.xx.x.xx.x', 'x....x....x', 'xxxxxxxxxxx'],
    pause: ['xx..xx', 'xx..xx', 'xx..xx', 'xx..xx', 'xx..xx', 'xx..xx', 'xx..xx'],
    sound: ['...x.....', '..xx..x..', 'xxxx...x.', 'xxxx.x.x.', 'xxxx...x.', '..xx..x..', '...x.....'],
    muted: ['...x.....', '..xx.....', 'xxxx.x.x.', 'xxxx..x..', 'xxxx.x.x.', '..xx.....', '...x.....'],
    mouseL: ['.ooooo.', 'oxxo..o', 'oxxo..o', 'oxxo..o', 'ooooooo', 'o.....o', 'o.....o', '.ooooo.'],
    mouseR: ['.ooooo.', 'o..oxxo', 'o..oxxo', 'o..oxxo', 'ooooooo', 'o.....o', 'o.....o', '.ooooo.'],
    eye: [
      '............x............', '...........xxx...........', '..........xx.xx..........', '.........xx...xx.........',
      '........xx.....xx........', '.......xx..eee..xx.......', '......xx.ee.p.ee.xx......', '.....xx.e..ppp..e.xx.....',
      '....xx...ee.p.ee...xx....', '...xx......eee......xx...', '..xx.................xx..', '.xx...................xx.',
      'xxxxxxxxxxxxxxxxxxxxxxxxx',
    ],
    phone: ['.xxxxxxx.', 'x.......x', 'x.xxxxx.x', 'x.x...x.x', 'x.x...x.x', 'x.x...x.x', 'x.x...x.x', 'x.x...x.x', 'x.xxxxx.x', 'x.......x', 'x...x...x', '.xxxxxxx.'],
    check: ['......x', '.....xx', 'x...xx.', 'xx.xx..', '.xxx...', '..x....'],
  };
  const ABIL = [['stomp', 'kick', 'SPACE', 'STOMP'], ['bolt', 'snare', 'LMB', 'BOLT'], ['quake', 'bass', 'RMB', 'QUAKE'], ['dash', 'dash', 'SHIFT', 'DASH']];
  const ROWKEY = { kick: 'STOMP', snare: 'BOLT', bass: 'QUAKE' };
  const CONTROLS_DESK = [['WASD', 'move'], ['MOUSE', 'look'], ['SPACE', 'stomp · kick'], ['LMB / J', 'bolt · snare'], ['RMB / K', 'quake · bass'], ['SHIFT', 'dash'], ['E', 'carve · talk · open'], ['TAB', 'spellbook'], ['ESC', 'pause'], ['M', 'mute']];
  const CONTROLS_TOUCH = [['LEFT THUMB', 'move'], ['RIGHT THUMB', 'look'], ['STOMP', 'kick'], ['BOLT', 'snare'], ['QUAKE', 'bass'], ['DASH', 'dash'], ['ACTION', 'carve · talk · open'], ['TAP', 'next line']];
  const STAT_LABEL = {
    time: 'TIME', seconds: 'TIME', playTime: 'TIME', fireflies: 'FIREFLIES', level: 'LEVEL', pocket: 'IN THE POCKET',
    onBeat: 'IN THE POCKET', hits: 'SPELLS CAST', moths: 'HUSH BANISHED', kills: 'HUSH BANISHED', enemies: 'HUSH BANISHED',
    carved: 'HITS CARVED', stones: 'LOOP STONES', deaths: 'TIMES FELLED', combo: 'BEST COMBO',
  };
  const TOAST_MS = { zone: 3600, unlock: 3600, carve: 3400, quest: 3400 };

  const CJK = /[　-ヿ㐀-鿿＀-￯]+/g;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rich = (s) => esc(s).replace(CJK, (m) => `<span class="jw-jp">${m}</span>`);

  const iconCache = {};
  function icon(name, cls = '') {
    const key = name + '|' + cls;
    if (iconCache[key]) return iconCache[key];
    const rows = ART[name];
    if (!rows) return '';
    const w = rows[0].length, h = rows.length, paths = {};
    rows.forEach((row, y) => {
      for (let x = 0; x < w;) {
        const c = row[x];
        if (c === '.') { x++; continue; }
        let n = 1;
        while (row[x + n] === c) n++;
        paths[c] = (paths[c] || '') + `M${x} ${y}h${n}v1h-${n}z`;
        x += n;
      }
    });
    const body = Object.keys(paths).map((c) => `<path class="p-${c}" d="${paths[c]}"/>`).join('');
    return (iconCache[key] = `<svg class="jw-px jw-i-${name} ${cls}" viewBox="0 0 ${w} ${h}" style="--w:${w};--h:${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body}</svg>`);
  }

  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  let root = null, built = false;
  let E = {}, memo = {};
  let cells = [], cellState = new Int8Array(3 * LOOP).fill(-1), ph = -1;
  let bookCells = [], bookState = new Int8Array(3 * LOOP).fill(-1), bookPh = -1;
  let dlg = null, book = null, bootCb = null, endH = null, lastHud = null, promptText;
  let introTimer = 0, levelTimer = 0, keysBound = false;

  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const touchy = () => (typeof Input !== 'undefined' && Input.isTouch) || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const input = () => (typeof Input !== 'undefined' ? Input : null);

  // Write only when the value differs from what we wrote last time.
  function put(key, v, fn) {
    if (memo[key] === v) return;
    const prev = memo[key];
    memo[key] = v;
    fn(v, prev);
  }

  /* ---------- building ---------- */

  function init(r) {
    root = r || document.getElementById('ui');
    if (!root) return;
    for (const n of root.querySelectorAll(':scope > .jw-ui')) n.remove();
    E = {}; memo = {}; cellState.fill(-1); bookState.fill(-1); ph = -1; bookPh = -1;
    dlg = null; book = null; bootCb = null; endH = null; promptText = undefined;
    buildHud(); buildFx(); buildDialog(); buildCards(); buildBook(); buildEnd(); buildBoot(); buildRotate();
    built = true;
    if (!keysBound) {
      keysBound = true;
      // Enter or Space also opens the jungle, without a focus ring sitting on the button.
      window.addEventListener('keydown', (e) => {
        if (E.boot && !E.boot.hidden && /^(Enter|NumpadEnter|Space)$/.test(e.code)) { e.preventDefault(); startFromBoot(); }
      });
    }
  }
  const ready = () => { if (!built) init(); return !!root; };

  function buildHud() {
    const hud = E.hud = el('div', 'jw-ui jw-hud', root);
    const st = el('div', 'jw-status jw-panel', hud);
    E.hearts = el('div', 'jw-hearts', st);
    E.heart = [];
    const stats = el('div', 'jw-stats', st);
    E.ff = el('span', 'jw-ff', stats, `${icon('fly')}<b>0</b>`);
    E.ffN = E.ff.lastChild;
    E.lv = el('span', 'jw-lv', stats, '<i>LV</i><b>1</b>');
    E.lvN = E.lv.lastChild;
    E.xp = el('span', 'jw-xp', stats, '<i></i>');
    E.xpFill = E.xp.firstChild;

    E.quest = el('div', 'jw-quest jw-panel is-off', hud);
    E.compass = el('div', 'jw-compass', E.quest, `<i class="jw-ticks"></i><span class="jw-arrow">${icon('arrow')}</span>`);
    E.arrow = E.compass.lastChild;
    const qb = el('div', 'jw-quest-body', E.quest);
    const qh = el('div', 'jw-quest-head', qb, `<span>QUEST <span class="jw-jp">目的</span></span><b class="jw-dist"></b>`);
    E.dist = qh.lastChild;
    E.qText = el('div', 'jw-quest-text', qb);

    E.cross = el('div', 'jw-cross', hud, '<i></i><i></i><i></i><i></i><b></b>');
    E.prompt = el('div', 'jw-prompt jw-panel', hud);
    E.prompt.hidden = true;

    const deck = el('div', 'jw-deck', hud);
    const s = E.strip = el('div', 'jw-strip jw-panel', deck);
    el('div', 'jw-strip-head', s, `<span class="jw-strip-title">LOOP <span class="jw-jp">ループ</span></span>` +
      `<span class="jw-strip-info"><b class="jw-chord">-</b><span class="jw-bpm"><i class="jw-dot"></i>${BPM} BPM</span>` +
      `<span class="jw-hint"><span class="jw-key">TAB</span> BOOK</span></span>`);
    E.chord = s.querySelector('.jw-chord');
    const grid = el('div', 'jw-strip-grid', s);
    cells = [];
    E.row = {};
    for (const lane of LANES) {
      const row = E.row[lane] = el('div', 'jw-row', grid);
      row.setAttribute('data-l', lane);
      el('span', 'jw-row-name', row, `<span class="jw-row-long">${LANE_NAME[lane]}</span><span class="jw-row-short">${LANE_NAME[lane][0]}</span>${icon('lock', 'jw-row-lock')}`);
      const track = el('span', 'jw-track', row);
      const list = [];
      for (let i = 0; i < LOOP; i++) list.push(el('i', i % 4 === 0 ? 'jw-c b' : 'jw-c', track));
      cells.push(list);
    }

    const bar = E.abil = el('div', 'jw-abil', deck);
    E.ab = {};
    for (const [name, tint, key, label] of ABIL) {
      const keyHtml = key === 'LMB' ? icon('mouseL') + 'LMB' : key === 'RMB' ? icon('mouseR') + 'RMB' : key;
      const slot = E.ab[name] = el('div', 'jw-ab jw-panel', bar,
        `<span class="jw-ab-key jw-key">${keyHtml}</span><span class="jw-ab-ico">${icon(name)}</span>` +
        `<span class="jw-ab-name">${label}</span><i class="jw-ab-cd"></i><span class="jw-ab-lock">${icon('lock')}</span>`);
      slot.setAttribute('data-tint', tint);
    }
  }

  // Things that can appear before the HUD does (toasts during the intro, zone names).
  function buildFx() {
    const fx = E.fx = el('div', 'jw-ui jw-fx', root);
    E.toasts = el('div', 'jw-toasts', fx);
    E.toasts.setAttribute('role', 'status');
    E.toasts.setAttribute('aria-live', 'polite');
    E.zone = el('div', 'jw-zonecard', fx);
    E.pockets = el('div', 'jw-pockets', fx);
  }

  function buildDialog() {
    const d = E.dlg = el('div', 'jw-ui jw-dialog jw-panel', root,
      `<div class="jw-dlg-name"></div><p class="jw-dlg-text" aria-hidden="true"><span class="jw-dlg-on"></span><span class="jw-dlg-off"></span></p>` +
      `<span class="jw-sr" aria-live="polite"></span>` +
      `<div class="jw-dlg-foot"><span class="jw-dlg-page"></span><span class="jw-dlg-hint"><span class="jw-key">E</span><span class="jw-dlg-verb">NEXT</span></span><i class="jw-dlg-caret"></i></div>`);
    d.hidden = true;
    E.dlgName = d.querySelector('.jw-dlg-name');
    E.dlgOn = d.querySelector('.jw-dlg-on');
    E.dlgOff = d.querySelector('.jw-dlg-off');
    E.dlgSr = d.querySelector('.jw-sr');
    E.dlgPage = d.querySelector('.jw-dlg-page');
    E.dlgVerb = d.querySelector('.jw-dlg-verb');
  }

  function buildCards() {
    E.intro = el('div', 'jw-ui jw-intro', root);
    E.intro.setAttribute('aria-live', 'assertive');
    E.title = el('div', 'jw-ui jw-titlecard', root,
      `<div class="jw-emblem">${icon('eye')}</div><h1 class="jw-logo" data-text="JUNGLE WIZARD">JUNGLE WIZARD</h1>` +
      `<p class="jw-logo-jp">ジャングル・ウィザード</p><p class="jw-tagline">your spells are the drums</p>`);
    E.title.hidden = true;
    E.pause = el('div', 'jw-ui jw-pause', root,
      `<div class="jw-pause-inner"><h2 class="jw-pause-t">PAUSED <span class="jw-jp">一時停止</span></h2>` +
      `<p class="jw-pause-go"></p><div class="jw-settings jw-panel"></div>` +
      `<p class="jw-pause-keys"><span class="jw-key">ESC</span> frees the mouse <span class="jw-key">TAB</span> spellbook <span class="jw-key">M</span> mute</p></div>`);
    E.pause.hidden = true;
    E.pauseGo = E.pause.querySelector('.jw-pause-go');
    E.pauseSet = E.pause.querySelector('.jw-settings');
    E.pauseSet.addEventListener('click', onSettingsClick);
  }

  function beatNums() {
    let h = '';
    for (let i = 0; i < LOOP; i++) h += `<span class="jw-bn${i % 4 === 0 ? ' b' : ''}">${i % 4 === 0 ? i / 4 + 1 : ''}</span>`;
    return h;
  }

  function buildBook() {
    const m = E.book = el('div', 'jw-ui jw-modal jw-book', root);
    m.hidden = true;
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Spellbook');
    const p = E.bookPanel = el('div', 'jw-book-panel jw-panel', m);
    p.setAttribute('tabindex', '-1');
    p.innerHTML =
      `<header class="jw-book-head"><h2>SPELLBOOK <span class="jw-jp">魔導書</span></h2>` +
      `<p class="jw-book-sub"></p>` +
      `<button type="button" class="jw-btn jw-close"><span class="jw-key">TAB</span>CLOSE</button></header>` +
      `<div class="jw-book-scroll"><div class="jw-book-grid"></div></div>` +
      `<div class="jw-book-foot"><section class="jw-legend"><h3>RUNES</h3>` +
      `<p><i class="jw-c" data-s="2"></i>carved: plays at full volume</p><p><i class="jw-c" data-s="1"></i>draft: a ghost until you carve it</p>` +
      `<p><i class="jw-c ph"></i>the playhead</p><p class="jw-legend-tip">Carve drafts at a Loop Stone <span class="jw-key">E</span></p></section>` +
      `<section class="jw-controls"><h3>CONTROLS <span class="jw-jp">操作</span></h3><dl></dl></section>` +
      `<section class="jw-log"><h3>QUEST <span class="jw-jp">クエスト</span></h3><ol></ol></section></div>` +
      `<div class="jw-settings"></div>`;
    const grid = p.querySelector('.jw-book-grid');
    let html = `<div class="jw-bg-row jw-bg-nums" aria-hidden="true"><span class="jw-bg-name"></span><span class="jw-bg-cells">${beatNums()}</span><span class="jw-bg-end"></span></div>`;
    for (const lane of LANES) {
      html += `<div class="jw-bg-row" data-l="${lane}"><span class="jw-bg-name">${LANE_NAME[lane]}<small>${ROWKEY[lane]}</small>${icon('lock', 'jw-row-lock')}</span><span class="jw-bg-cells">`;
      for (let i = 0; i < LOOP; i++) {
        html += `<button type="button" class="jw-bc${i % 4 === 0 ? ' b' : ''}" data-lane="${lane}" data-step="${i}" aria-pressed="false" aria-label="${LANE_NAME[lane]} step ${i + 1}"></button>`;
      }
      html += `</span><span class="jw-bg-end"><button type="button" class="jw-btn jw-clear" data-clear="${lane}" aria-label="Clear the ${LANE_NAME[lane]} lane">CLEAR</button></span></div>`;
    }
    grid.innerHTML = html;
    bookCells = LANES.map((lane) => [...grid.querySelectorAll(`.jw-bc[data-lane="${lane}"]`)]);
    E.bookRows = {};
    for (const lane of LANES) E.bookRows[lane] = grid.querySelector(`.jw-bg-row[data-l="${lane}"]`);
    grid.addEventListener('click', onBookClick);
    E.bookSub = p.querySelector('.jw-book-sub');
    E.bookClose = p.querySelector('.jw-close');
    E.bookClose.addEventListener('click', () => {
      const h = book && book.h;
      if (h && h.close) h.close();
      if (book) closeBook();
    });
    E.bookControls = p.querySelector('.jw-controls dl');
    E.bookLog = p.querySelector('.jw-log');
    E.bookSet = p.querySelector('.jw-settings');
    E.bookSet.addEventListener('click', onSettingsClick);
    // Clicks inside the book never reach the game (no stray bolts, no pointer capture).
    m.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  function buildEnd() {
    const m = E.end = el('div', 'jw-ui jw-modal jw-end', root,
      `<div class="jw-end-panel jw-panel"><p class="jw-end-kicker">THE SONG IS WHOLE</p><h2 class="jw-end-t">THE JUNGLE SINGS AGAIN</h2>` +
      `<p class="jw-end-jp">森が歌う</p><dl class="jw-end-stats"></dl><div class="jw-end-btns">` +
      `<button type="button" class="jw-btn jw-btn-main" data-ui="jam">KEEP JAMMING</button>` +
      `<button type="button" class="jw-btn" data-ui="replay">PLAY AGAIN</button></div></div>`);
    m.hidden = true;
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'The end');
    E.endStats = m.querySelector('.jw-end-stats');
    E.endPanel = m.querySelector('.jw-end-panel');
    E.endPanel.setAttribute('tabindex', '-1');
    m.addEventListener('mousedown', (e) => e.stopPropagation());
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ui]');
      if (!b || !endH) return;
      const fn = endH[b.getAttribute('data-ui')];
      if (fn) fn();
      if (!E.end.hidden) hideEnd();
    });
  }

  function buildBoot() {
    const b = E.boot = el('div', 'jw-ui jw-boot', root,
      `<div class="jw-boot-inner"><div class="jw-emblem">${icon('eye')}</div>` +
      `<h1 class="jw-logo" data-text="JUNGLE WIZARD">JUNGLE WIZARD</h1><p class="jw-logo-jp">ジャングル・ウィザード</p>` +
      `<button type="button" class="jw-go"></button><p class="jw-boot-note"></p><dl class="jw-boot-keys"></dl></div>`);
    b.hidden = true;
    E.bootGo = b.querySelector('.jw-go');
    E.bootNote = b.querySelector('.jw-boot-note');
    E.bootKeys = b.querySelector('.jw-boot-keys');
    b.addEventListener('click', startFromBoot);
  }

  function buildRotate() {
    const r = el('div', 'jw-ui jw-rotate', root,
      `<div class="jw-rotate-phone">${icon('phone')}</div><p class="jw-rotate-t">ROTATE YOUR PHONE</p>` +
      `<p class="jw-rotate-jp">横向きにしてください</p><p class="jw-rotate-s">The jungle plays in landscape.</p>`);
    r.setAttribute('data-overlay', 'rotate');
  }

  /* ---------- the per-frame HUD ---------- */

  function update(h) {
    if (!ready() || !h) return;
    lastHud = h;
    put('on', true, () => root.classList.add('jw-hud-on'));
    hearts(h.vibe, h.maxVibe);
    put('ff', Math.max(0, Math.floor(h.fireflies || 0)), (v) => { E.ffN.textContent = v; });
    put('lv', Math.max(1, Math.floor(h.level || 1)), (v, prev) => {
      E.lvN.textContent = v;
      if (prev !== undefined && v > prev) {
        E.lv.classList.remove('is-up'); void E.lv.offsetWidth; E.lv.classList.add('is-up');
        clearTimeout(levelTimer);
        levelTimer = setTimeout(() => E.lv.classList.remove('is-up'), 1400);
      }
    });
    put('xp', Math.round(clamp(h.xp01 || 0, 0, 1) * 200) / 2, (v) => { E.xpFill.style.width = v + '%'; });
    objective(h.objective);
    strip(h.snap, h.step, h.abilities);
    put('chord', h.chord ? String(h.chord) : '-', (v) => { E.chord.textContent = v; });
    put('beat', (h.beat01 || 0) > 0.5, (v) => root.classList.toggle('jw-beat', v));
    abilities(h.abilities);
    put('free', h.locked === false, (v) => E.cross.classList.toggle('is-free', v));
    if (book) paintBook(h.snap, h.step);
  }

  function hearts(vibe, max) {
    max = clamp(Math.round(max || 0), 0, 12);
    put('hmax', max, (n) => {
      E.hearts.textContent = '';
      E.heart = [];
      for (let i = 0; i < 12; i++) delete memo['h' + i];
      for (let i = 0; i < n; i++) E.heart.push(el('span', 'jw-heart', E.hearts, icon('heart')));
    });
    const v = Math.round(clamp(vibe || 0, 0, max) * 2) / 2;
    for (let i = 0; i < max; i++) {
      const s = v >= i + 1 ? 'full' : v >= i + 0.5 ? 'half' : 'empty';
      put('h' + i, s, (x) => { E.heart[i].className = 'jw-heart is-' + x; });
    }
    put('hlow', max > 0 && v <= 1, (low) => E.hearts.classList.toggle('is-low', low));
  }

  function objective(o) {
    put('qon', !!o, (on) => E.quest.classList.toggle('is-off', !on));
    if (!o) return;
    put('qtext', String(o.text || ''), (t) => { E.qText.innerHTML = rich(t); });
    const d = Number.isFinite(o.dist) ? Math.max(0, Math.round(o.dist)) : -1;
    put('qdist', d, (x) => { E.dist.textContent = x < 0 ? '' : x + 'M'; });
    put('qnear', d >= 0 && d < 4, (n) => E.quest.classList.toggle('is-near', n));
    const deg = mod(Math.round(((o.angle || 0) * 180) / Math.PI / 3) * 3, 360);
    put('qang', deg, (a) => { E.arrow.style.transform = `rotate(${a}deg)`; });
  }

  const cellCode = (snap, lane, i) => (snap.song[lane][i] ? 2 : 0) | (snap.draft[lane][i] ? 1 : 0);
  const stepOf = (step) => (Number.isFinite(step) && step >= 0 ? Math.floor(step) % LOOP : -1);

  function strip(snap, step, ab) {
    if (snap && snap.song && snap.draft) {
      LANES.forEach((lane, l) => {
        if (!snap.song[lane] || !snap.draft[lane]) return;
        for (let i = 0; i < LOOP; i++) {
          const s = cellCode(snap, lane, i), k = l * LOOP + i;
          if (cellState[k] !== s) { cellState[k] = s; cells[l][i].setAttribute('data-s', s); }
        }
      });
    }
    const p = stepOf(step);
    if (p !== ph) {
      if (ph >= 0) for (const row of cells) row[ph].classList.remove('ph');
      if (p >= 0) for (const row of cells) row[p].classList.add('ph');
      ph = p;
    }
    if (ab) {
      put('lk-snare', !!(ab.bolt && ab.bolt.unlocked === false), (v) => E.row.snare.classList.toggle('is-locked', v));
      put('lk-bass', !!(ab.quake && ab.quake.unlocked === false), (v) => E.row.bass.classList.toggle('is-locked', v));
    }
  }

  function abilities(ab) {
    if (!ab) return;
    for (const [name] of ABIL) {
      const a = ab[name], slot = E.ab[name];
      if (!a) continue;
      put('al-' + name, a.unlocked === false, (v) => slot.classList.toggle('is-locked', v));
      const cd = Math.ceil(clamp(a.cd01 || 0, 0, 1) * 40) / 40;
      put('cd-' + name, cd, (v, prev) => {
        slot.style.setProperty('--cd', v);
        slot.classList.toggle('is-cooling', v > 0);
        if (prev > 0 && v === 0) { slot.classList.remove('is-ready'); void slot.offsetWidth; slot.classList.add('is-ready'); }
      });
    }
  }

  /* ---------- toasts, popups, prompt ---------- */

  function toast(text, kind = 'info') {
    if (!ready() || !text) return;
    if (kind === 'zone') return zone(text);
    const t = el('div', 'jw-toast jw-panel k-' + String(kind).replace(/[^a-z]/gi, ''), E.toasts, rich(text));
    while (E.toasts.children.length > 4) E.toasts.firstChild.remove();
    const ms = TOAST_MS[kind] || 2600;
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 450); }, ms);
  }

  // Zone names get a big banner, e.g. "the summoning swamp 召喚".
  function zone(text) {
    E.zone.innerHTML = `<span class="jw-zone-in">${rich(text)}</span>`;
    E.zone.classList.remove('is-on'); void E.zone.offsetWidth; E.zone.classList.add('is-on');
    clearTimeout(E.zone._t);
    E.zone._t = setTimeout(() => E.zone.classList.remove('is-on'), TOAST_MS.zone);
  }

  function pocket(lane) {
    if (!ready() || !LANE_NAME[lane]) return;
    const p = el('div', 'jw-pocket', E.pockets, `<b>IN THE POCKET</b><i>${LANE_NAME[lane]}</i>`);
    p.setAttribute('data-l', lane);
    while (E.pockets.children.length > 6) E.pockets.firstChild.remove();
    setTimeout(() => p.remove(), 950);
  }

  // prompt('[E] Carve the Loop Stone') draws E as a keycap.
  function prompt(text) {
    if (!ready()) return;
    text = text ? String(text) : null;
    if (text === promptText) return;
    promptText = text;
    E.prompt.hidden = !text;
    if (!text) return;
    const m = /^\s*\[([^\]]{1,8})\]\s*(.*)$/.exec(text);
    E.prompt.innerHTML = m ? `<span class="jw-key">${esc(m[1])}</span><span>${rich(m[2])}</span>` : `<span>${rich(text)}</span>`;
  }

  /* ---------- dialogue ---------- */

  function dialogue(speaker, lines, onDone) {
    if (!ready()) return;
    if (dlg) clearTimeout(dlg.timer);
    dlg = { lines: [].concat(lines == null ? [] : lines).map(String), i: 0, n: 0, typing: false, timer: 0, onDone };
    if (!dlg.lines.length) dlg.lines = [''];
    E.dlgName.innerHTML = rich(speaker || '');
    E.dlgName.hidden = !speaker;
    E.dlgVerb.textContent = 'NEXT';
    E.dlg.hidden = false;
    root.classList.add('jw-talking');
    page(0);
  }

  function page(i) {
    dlg.i = i; dlg.n = 0; dlg.typing = true;
    const line = dlg.lines[i];
    E.dlgOn.textContent = '';
    E.dlgOff.textContent = line;
    E.dlgSr.textContent = line;
    E.dlgPage.textContent = dlg.lines.length > 1 ? `${i + 1}/${dlg.lines.length}` : '';
    E.dlgVerb.textContent = i + 1 < dlg.lines.length ? 'NEXT' : 'DONE';
    E.dlg.classList.remove('is-done');
    if (typeof Sound !== 'undefined' && Sound.sfx && typeof Sound.sfx.talk === 'function') Sound.sfx.talk();
    if (reduced()) { dlg.n = line.length; paintLine(); return; }
    typeNext();
  }

  function paintLine() {
    const line = dlg.lines[dlg.i];
    E.dlgOn.textContent = line.slice(0, dlg.n);
    E.dlgOff.textContent = line.slice(dlg.n);
    if (dlg.n >= line.length) { dlg.typing = false; E.dlg.classList.add('is-done'); }
  }

  function typeNext() {
    const line = dlg.lines[dlg.i];
    dlg.n = Math.min(line.length, dlg.n + 1);
    paintLine();
    if (!dlg.typing) return;
    const c = line[dlg.n - 1];
    const wait = /[.!?]/.test(c) && line[dlg.n] === ' ' ? 200 : c === ',' ? 100 : 24;
    const d = dlg;
    dlg.timer = setTimeout(() => { if (dlg === d) typeNext(); }, wait);
  }

  // Finishes the line being typed, or turns the page, or closes the box (then calls onDone).
  function advance() {
    if (!dlg) return false;
    if (dlg.typing) { clearTimeout(dlg.timer); dlg.n = dlg.lines[dlg.i].length; paintLine(); return true; }
    if (dlg.i + 1 < dlg.lines.length) { page(dlg.i + 1); return true; }
    const done = dlg.onDone;
    clearTimeout(dlg.timer);
    dlg = null;
    E.dlg.hidden = true;
    root.classList.remove('jw-talking');
    if (typeof done === 'function') done();
    return false;
  }

  /* ---------- spellbook ---------- */

  function snapshotOf(seq) {
    if (!seq) return null;
    if (typeof seq.snapshot === 'function') return seq.snapshot();
    if (!seq.song || !seq.draft) return null;
    const song = {}, draft = {};
    for (const lane of LANES) { song[lane] = Array.from(seq.song[lane]); draft[lane] = Array.from(seq.draft[lane], (v) => v >= 0); }
    return { song, draft };
  }

  function laneLocked(lane) {
    const ab = lastHud && lastHud.abilities;
    if (!ab) return false;
    return (lane === 'snare' && ab.bolt && ab.bolt.unlocked === false) || (lane === 'bass' && ab.quake && ab.quake.unlocked === false);
  }

  function paintBook(snap, step) {
    if (!book) return;
    snap = snap || snapshotOf(book.seq);
    if (snap && snap.song && snap.draft) {
      LANES.forEach((lane, l) => {
        if (!snap.song[lane] || !snap.draft[lane]) return;
        for (let i = 0; i < LOOP; i++) {
          const s = cellCode(snap, lane, i), k = l * LOOP + i;
          if (bookState[k] !== s) {
            bookState[k] = s;
            const b = bookCells[l][i];
            b.setAttribute('data-s', s);
            b.setAttribute('aria-pressed', s & 2 ? 'true' : 'false');
          }
        }
      });
    }
    if (step !== undefined) {
      const p = stepOf(step);
      if (p !== bookPh) {
        if (bookPh >= 0) for (const row of bookCells) row[bookPh].classList.remove('ph');
        if (p >= 0) for (const row of bookCells) row[p].classList.add('ph');
        bookPh = p;
      }
    }
    for (const lane of LANES) {
      const lk = laneLocked(lane);
      put('bk-' + lane, lk, (v) => E.bookRows[lane].classList.toggle('is-locked', v));
    }
  }

  function onBookClick(e) {
    if (!book) return;
    const cell = e.target.closest('.jw-bc');
    if (cell) {
      const lane = cell.getAttribute('data-lane'), s = Number(cell.getAttribute('data-step'));
      if (laneLocked(lane)) { nudge(cell.closest('.jw-bg-row')); return; }
      if (book.h.toggle) book.h.toggle(lane, s);
      paintBook();
      return;
    }
    const clear = e.target.closest('.jw-clear');
    if (clear) {
      const lane = clear.getAttribute('data-clear');
      if (laneLocked(lane)) { nudge(clear.closest('.jw-bg-row')); return; }
      if (book.h.clearLane) book.h.clearLane(lane);
      paintBook();
    }
  }

  // Keyboard users land inside the modal; Space held down for stomps cannot press a button by accident.
  function focusQuietly(node) { try { node.focus({ preventScroll: true }); } catch (e) { /* old browser */ } }

  function nudge(node) {
    if (!node) return;
    node.classList.remove('is-nudge'); void node.offsetWidth; node.classList.add('is-nudge');
  }

  function paintLog(q) {
    const log = q && typeof q.log === 'function' ? q.log() : null;
    E.bookLog.hidden = !log;
    if (!log) return;
    const next = log.findIndex((s) => !s.done);
    E.bookLog.querySelector('ol').innerHTML = log.map((s, i) =>
      `<li class="${s.done ? 'is-done' : i === next ? 'is-now' : ''}">${s.done ? icon('check') : '<i></i>'}${rich(s.text)}</li>`).join('');
  }

  function paintControls(dl, list) {
    dl.innerHTML = list.map(([k, v]) => `<dt><span class="jw-key">${esc(k)}</span></dt><dd>${esc(v)}</dd>`).join('');
  }

  function openBook(seq, handlers) {
    if (!ready()) return;
    book = { seq, h: handlers || {} };
    bookState.fill(-1);
    if (bookPh >= 0) for (const row of bookCells) row[bookPh].classList.remove('ph');
    bookPh = -1;
    paintBook(null, lastHud ? lastHud.step : undefined);
    paintLog(book.h.quest || (window.JW && window.JW.quest));
    paintControls(E.bookControls, touchy() ? CONTROLS_TOUCH : CONTROLS_DESK);
    E.bookSub.textContent = `Your song, two bars round. ${touchy() ? 'Tap' : 'Click'} a rune to carve or erase a hit.`;
    paintSettings();
    E.book.hidden = false;
    root.classList.add('jw-reading');
    const inp = input();
    if (inp && inp.unlock) inp.unlock();
    focusQuietly(E.bookPanel);
  }

  function closeBook() {
    if (!book) return;
    book = null;
    E.book.hidden = true;
    root.classList.remove('jw-reading');
  }

  /* ---------- look settings (book and pause) ---------- */

  function paintSettings() {
    const inp = input();
    const s = inp ? inp.settings : { sensitivity: 1, invertY: false };
    const html = `<span class="jw-set-t">LOOK</span>` +
      `<span class="jw-set"><span class="jw-set-l">SPEED</span><button type="button" class="jw-btn jw-btn-sq" data-set="slower" aria-label="Slower look">-</button>` +
      `<b class="jw-set-v">${s.sensitivity.toFixed(2)}</b><button type="button" class="jw-btn jw-btn-sq" data-set="faster" aria-label="Faster look">+</button></span>` +
      `<span class="jw-set"><span class="jw-set-l">INVERT Y</span><button type="button" class="jw-btn jw-toggle" data-set="invert" aria-pressed="${s.invertY}">${s.invertY ? 'ON' : 'OFF'}</button></span>`;
    for (const box of [E.bookSet, E.pauseSet]) { box.innerHTML = html; box.hidden = !inp; }
  }

  function onSettingsClick(e) {
    const b = e.target.closest('[data-set]'), inp = input();
    if (!b || !inp || !inp.setSettings) return;
    e.stopPropagation();
    const s = inp.settings, what = b.getAttribute('data-set');
    if (what === 'slower') inp.setSettings({ sensitivity: s.sensitivity - 0.1 });
    if (what === 'faster') inp.setSettings({ sensitivity: s.sensitivity + 0.1 });
    if (what === 'invert') inp.setSettings({ invertY: !s.invertY });
    paintSettings();
    const again = (b.closest('.jw-settings') || document).querySelector(`[data-set="${what}"]`);
    if (again) again.focus({ preventScroll: true });
  }

  /* ---------- full-screen cards ---------- */

  function showBoot(onStart) {
    if (!ready()) return;
    const t = touchy();
    bootCb = onStart || null;
    E.bootGo.textContent = (t ? 'TAP' : 'CLICK') + ' TO ENTER THE JUNGLE';
    E.bootNote.innerHTML = t
      ? 'Headphones on <span class="jw-jp">ヘッドホン推奨</span>. Hold your phone sideways.'
      : 'Headphones on <span class="jw-jp">ヘッドホン推奨</span>. Made for a desktop browser with keyboard and mouse.';
    paintControls(E.bootKeys, t ? CONTROLS_TOUCH.slice(0, 7) : CONTROLS_DESK.slice(0, 8));
    E.boot.hidden = false;
    root.classList.add('jw-booting');
  }

  function startFromBoot() {
    if (E.boot.hidden) return;
    const cb = bootCb;
    bootCb = null;
    E.boot.hidden = true;
    root.classList.remove('jw-booting');
    const inp = input();
    if (inp && inp.lock && !inp.isTouch) inp.lock(); // one click enters the jungle and captures the mouse
    if (typeof cb === 'function') cb();
  }

  function introWord(text, i = 0) {
    if (!ready()) return;
    clearTimeout(introTimer);
    E.intro.textContent = '';
    if (!text) return;
    const w = el('div', 'jw-slam', E.intro);
    w.textContent = text;
    w.setAttribute('data-text', text);
    w.setAttribute('data-l', LANES[mod(i | 0, 3)]);
    introTimer = setTimeout(() => { E.intro.textContent = ''; }, 2600);
  }

  function title(show) {
    if (!ready()) return;
    if (show) { clearTimeout(introTimer); E.intro.textContent = ''; }
    E.title.hidden = !show;
    root.classList.toggle('jw-cine', !!show);
  }

  function pause(show) {
    if (!ready()) return;
    E.pauseGo.textContent = (touchy() ? 'TAP' : 'CLICK') + ' TO RESUME';
    if (show) paintSettings();
    E.pause.hidden = !show;
    root.classList.toggle('jw-paused', !!show);
  }

  function fmtStat(k, v) {
    if (typeof v !== 'number') return esc(v);
    if (/^(time|seconds|playTime)$/.test(k)) { const s = Math.max(0, Math.round(v)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    if (/^(pocket|onBeat)$/.test(k) && v <= 1) return Math.round(v * 100) + '%';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function end(stats, handlers) {
    if (!ready()) return;
    endH = handlers || {};
    const rows = Array.isArray(stats) ? stats : Object.entries(stats || {}).map(([k, v]) => [STAT_LABEL[k] || k.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(), fmtStat(k, v)]);
    E.endStats.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${typeof v === 'string' ? v : esc(v)}</dd></div>`).join('');
    E.end.hidden = false;
    root.classList.add('jw-ending');
    const inp = input();
    if (inp && inp.unlock) inp.unlock();
    focusQuietly(E.endPanel);
  }

  function hideEnd() {
    if (!ready()) return;
    E.end.hidden = true;
    root.classList.remove('jw-ending');
  }

  return {
    init, update, toast, pocket, prompt, dialogue, advance, openBook, closeBook, showBoot, introWord, title, pause, end, hideEnd, icon,
    get inDialogue() { return !!dlg; },
    get bookOpen() { return !!book; },
  };
})();
