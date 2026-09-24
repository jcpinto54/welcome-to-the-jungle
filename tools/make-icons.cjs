'use strict';
// Renders the app icons into assets/icons/ with Playwright: pixel art painted cell by cell
// on a canvas, exported as PNG. The Jungle Wizard's crooked bark hat and glowing eyes in
// front of a striped retro sun, a dithered purple-to-teal night and a jungle skyline.
//
//   NODE_PATH=/opt/node22/lib/node_modules node tools/make-icons.cjs [--preview=sheet.png]
//
// The art is a 32x32 grid centred on the icon (one cell = `cell` px, always a whole number
// so the pixels stay crisp); the sky and jungle are procedural and fill whatever is around it.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'assets', 'icons');
const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, cell: 5 },
  { file: 'icon-192.png', size: 192, cell: 6 },
  { file: 'icon-512.png', size: 512, cell: 16 },
  // Maskable: everything that matters sits inside the central circle of radius 40%.
  { file: 'icon-maskable-512.png', size: 512, cell: 11, maskable: true },
];

// Runs in the page. Returns { png: dataURL, reach } where reach is how far (in px) the
// hat, face, beard and sun extend from the centre of the icon.
function paint({ size, cell }) {
  const N = 32;
  const off = (size - N * cell) / 2;

  // ---- palette ----
  const SKY = ['#07060f', '#0d0820', '#160c31', '#211044', '#2a1454', '#2b1d5e', '#243163', '#1a4664', '#135a63', '#116b60'];
  const SUN = ['#fff47e', '#ffe052', '#ffc23f', '#ffa03c', '#ff7e4a', '#ff6363', '#ff5690', '#ff4fc0', '#ff4fd8'];
  const C = {
    out: '#0b0503', barkD: '#2a170b', bark: '#452a15', barkL: '#6a4222', barkH: '#8f5d2e', rim: '#c9793e',
    moss: '#2d5524', mossL: '#548a31', mossH: '#86b843',
    cap: '#ff7417', capH: '#ffa53a', spot: '#ffe9bf', stem: '#eadcb4',
    hollow: '#07060f', face: '#1d110a', eyeC: '#f6ffc0', eye: '#b8ff33', eyeD: '#6ccc1c', halo: '#2f6a12',
    beardH: '#a3b37a', beard: '#728253', beardD: '#465234',
    jungle: '#030d0a', jungleM: '#07211a', jungleL: '#11473a', firefly: '#dcff6e', star: '#a28ff5', starH: '#ffffff',
  };

  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const bayer = (x, y) => (BAYER[((y % 4) + 4) % 4][((x % 4) + 4) % 4] + 0.5) / 16;
  const hash = (x, y) => { let h = Math.imul(x * 374761393 + y * 668265263, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const ramp = (list, t, x, y) => {
    const f = Math.max(0, Math.min(list.length - 1, t * (list.length - 1)));
    const i = Math.floor(f);
    return list[Math.min(list.length - 1, i + (f - i > bayer(x, y) ? 1 : 0))];
  };

  // ---- foreground sprite (core cells) ----
  const sprite = new Map();
  const key = (x, y) => x + ',' + y;
  const put = (x, y, col) => { if (x >= 0 && y >= 0 && x < N && y < N) sprite.set(key(x, y), col); };
  const get = (x, y) => sprite.get(key(x, y));

  // Hat cone: a Catmull-Rom spine [x, y, width] that leans, then flops over into a hook.
  const SPINE = [[16, 19.8, 11.2], [15.2, 14.5, 8.2], [14.9, 10.5, 6], [15.4, 7.2, 4.4], [17.2, 4.6, 3.2], [20.2, 3.5, 2.4], [23, 4.4, 1.8], [24.8, 6.7, 1.35], [25.4, 9.3, 1.0]];
  const samples = [];
  for (let i = 0; i < SPINE.length - 1; i++) {
    const p0 = SPINE[Math.max(0, i - 1)], p1 = SPINE[i], p2 = SPINE[i + 1], p3 = SPINE[Math.min(SPINE.length - 1, i + 2)];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      samples.push({ x: cr(p0[0], p1[0], p2[0], p3[0]), y: cr(p0[1], p1[1], p2[1], p3[1]), w: p1[2] + (p2[2] - p1[2]) * t, along: (i + t) / (SPINE.length - 1) });
    }
  }
  const cone = new Map();
  for (let y = 0; y < 21; y++) for (let x = 0; x < N; x++) {
    let best = null;
    for (let j = 0; j < samples.length; j++) {
      const s = samples[j];
      const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) - s.w / 2;
      if (!best || d < best.d) best = { d, j };
    }
    if (best.d > 0) continue;
    const s = samples[best.j], n = samples[Math.min(samples.length - 1, best.j + 1)], pr = samples[Math.max(0, best.j - 1)];
    const tx = n.x - pr.x, ty = n.y - pr.y, tl = Math.hypot(tx, ty) || 1;
    const side = ((x + 0.5 - s.x) * -ty + (y + 0.5 - s.y) * tx) / tl / (s.w / 2); // -1 left .. 1 right
    cone.set(key(x, y), { side, along: s.along });
  }
  const isCone = (x, y) => cone.has(key(x, y));
  for (const [k, c] of cone) {
    const [x, y] = k.split(',').map(Number);
    const edge = !isCone(x - 1, y) || !isCone(x + 1, y) || !isCone(x, y - 1) || !isCone(x, y + 1);
    let col;
    if (edge) col = C.out;
    else if (c.side > 0.55) col = C.rim;           // the sun catches the right-hand edge
    else if (c.side > 0.2) col = C.barkL;
    else if (c.side < -0.5) col = C.barkD;
    else col = (x + Math.round(c.along * 24)) % 4 === 0 ? C.barkD : (hash(x, y) > 0.8 ? C.barkL : C.bark);
    put(x, y, col);
  }
  // Moss band where the cone meets the brim.
  for (let y = 16; y <= 17; y++) for (let x = 0; x < N; x++) {
    if (!isCone(x, y) || !isCone(x - 1, y) || !isCone(x + 1, y)) continue;
    put(x, y, y === 16 ? ((x + 1) % 3 === 0 ? C.mossH : C.mossL) : ((x % 4) === 1 ? C.mossL : C.moss));
  }

  // Brim: a wide, slightly tilted ellipse.
  const brimV = (x, y) => {
    const a = -0.06, dx = x - 16, dy = y - 19.9;
    const rx = dx * Math.cos(a) + dy * Math.sin(a), ry = -dx * Math.sin(a) + dy * Math.cos(a);
    return (rx / 13.8) ** 2 + (ry / 2.45) ** 2;
  };
  const isBrim = (x, y) => brimV(x + 0.5, y + 0.5) <= 1;
  for (let y = 15; y < 25; y++) for (let x = 0; x < N; x++) {
    if (!isBrim(x, y)) continue;
    let col;
    if (!isBrim(x, y - 1) || !isBrim(x, y + 1) || !isBrim(x - 1, y) || !isBrim(x + 1, y)) col = C.out;
    else if (!isBrim(x, y - 2)) col = x > 18 ? C.rim : x < 9 ? C.barkH : C.barkL;
    else if (!isBrim(x, y + 2)) col = C.barkD;
    else col = (x * 2 + y) % 7 === 0 ? C.barkD : C.bark;
    put(x, y, col);
  }

  // Under the brim: a hood of dark bark around a hollow face.
  for (let y = 21; y < 30; y++) for (let x = 8; x < 24; x++) {
    if (get(x, y)) continue;
    const hood = ((x + 0.5 - 16) / 5.8) ** 2 + ((y + 0.5 - 22.6) / 5.2) ** 2 <= 1;
    if (!hood) continue;
    const hollow = ((x + 0.5 - 16) / 4.7) ** 2 + ((y + 0.5 - 23) / 4) ** 2 <= 1;
    put(x, y, hollow ? C.hollow : C.face);
  }
  // Two sickly-green eyes, 2x2 with a hot core and a faint glow.
  const EYES = [[12, 23], [18, 23]];
  for (const [ex, ey] of EYES) for (let y = ey - 1; y <= ey + 2; y++) for (let x = ex - 1; x <= ex + 2; x++) {
    if (get(x, y) === C.hollow && (x + y) % 2 === 0) put(x, y, C.halo);
  }
  for (const [ex, ey] of EYES) {
    put(ex, ey, C.eye); put(ex + 1, ey, C.eye); put(ex, ey + 1, C.eyeD); put(ex + 1, ey + 1, C.eyeD);
    put(ex < 16 ? ex + 1 : ex, ey, C.eyeC);
  }

  // Spanish-moss beard, strand by strand.
  const BEARD = [2, 3, 5, 6, 7, 6, 7, 6, 6, 5, 3, 2];
  for (let i = 0; i < BEARD.length; i++) {
    const x = 10 + i;
    const tone = [C.beard, C.beardH, C.beardD][(i * 2) % 3];
    for (let j = 0; j < BEARD[i]; j++) {
      const y = 26 + j;
      if (get(x, y) && get(x, y) !== C.face && get(x, y) !== C.hollow && get(x, y) !== C.halo) continue;
      if (j >= BEARD[i] - 2 && (x + y) % 2) continue;
      put(x, y, j === 0 ? C.beardD : hash(x, y) > 0.8 ? C.beardD : tone);
    }
  }

  // Little glowing mushrooms: two on the brim, one sprouting from the cone.
  const shroom = (x, y) => {
    const cells = [[x, y - 1, C.cap], [x + 1, y - 1, C.spot], [x - 1, y, C.cap], [x, y, C.capH], [x + 1, y, C.cap], [x, y + 1, C.stem]];
    for (const [cx, cy] of cells) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!get(cx + ox, cy + oy)) put(cx + ox, cy + oy, C.out); // outline where it meets the sky
    }
    for (const [cx, cy, col] of cells) put(cx, cy, col);
  };
  shroom(7, 17);
  shroom(11, 9);
  shroom(26, 18);

  // ---- background: sky, stars, striped sun, jungle ----
  const SUNX = 16, SUNY = 11.8, SUNR = 10.4;
  const stripeGap = (y) => y >= 12 && [0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1][y - 12] === 1;
  // Jungle canopy: a leafy, jagged skyline with fireflies in the dark below it.
  const tri = (v) => Math.abs(((v % 1) + 1) % 1 - 0.5) * 2; // 1 at leaf tips, 0 between
  const canopy = (x) => 24.2 + 1.1 * Math.sin(x * 0.55 + 0.8) + 0.8 * Math.sin(x * 1.3) - 1.7 * tri(x / 2.7 + 0.25) ** 2;
  const jungle = (x, y) => y > canopy(x);
  const FIREFLIES = [[3, 27], [6, 30], [26, 26], [29, 29], [23, 31], [-5, 28], [37, 27], [-3, 34], [35, 33]];

  function background(x, y) {
    const cx = x + 0.5, cy = y + 0.5;
    if (jungle(cx, cy)) {
      if (FIREFLIES.some(([fx, fy]) => fx === x && fy === y)) return C.firefly;
      if (!jungle(cx, cy - 1)) return C.jungleL;
      if (!jungle(cx, cy - 2)) return C.jungleM;
      return C.jungle;
    }
    const ds = Math.hypot(cx - SUNX, cy - SUNY);
    if (ds < SUNR && !stripeGap(y)) return ramp(SUN, (cy - (SUNY - SUNR)) / (2 * SUNR), x, y);
    if (ds > SUNR + 1.5 && y < 13 && hash(x, y) > 0.962) return hash(y, x) > 0.75 ? C.starH : C.star;
    return ramp(SKY, (cy + 3) / 28, x, y);
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const from = Math.floor(-off / cell) - 1, to = Math.ceil((size - off) / cell) + 1;
  for (let y = from; y < to; y++) for (let x = from; x < to; x++) {
    g.fillStyle = get(x, y) || background(x, y);
    g.fillRect(off + x * cell, off + y * cell, cell, cell);
  }

  // How far the important art reaches from the centre, for the maskable safe zone.
  let reach = 0;
  const far = (x, y) => {
    for (const [a, b] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) reach = Math.max(reach, Math.hypot((a - 16) * cell, (b - 16) * cell));
  };
  for (const k of sprite.keys()) { const [x, y] = k.split(',').map(Number); far(x, y); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x + 0.5 - SUNX, y + 0.5 - SUNY) < SUNR) far(x, y);
  return { png: canvas.toDataURL('image/png'), reach };
}

// Lays the icons out on one sheet, plus how they look masked and small on a home screen.
function sheet(pngs) {
  const load = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
  return Promise.all(pngs.map(load)).then((imgs) => {
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 560;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2b33'; g.fillRect(0, 0, c.width, c.height);
    const [apple, i192, i512, mask] = imgs;
    let x = 16;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const rounded = (img, px, py, s, r) => { g.save(); g.beginPath(); g.roundRect(px, py, s, s, r); g.clip(); g.drawImage(img, px, py, s, s); g.restore(); };
    rounded(apple, x, 16, 180, 40); x += 196;           // iPhone home screen, 1:1 at 3x
    rounded(apple, x, 16, 120, 27); x += 136;           // 2x screens
    rounded(apple, x, 16, 60, 13); x += 76;             // tiny (settings, spotlight)
    g.drawImage(i192, x, 16); x += 208;
    g.drawImage(i512, x, 16, 512, 512); x += 528;
    // Maskable: cropped to the 80% safe circle (the least a launcher shows), then in full.
    g.save(); g.beginPath(); g.arc(x + 90, 16 + 90, 72, 0, Math.PI * 2); g.clip(); g.drawImage(mask, x, 16, 180, 180); g.restore();
    g.drawImage(mask, x, 216, 180, 180);
    return c.toDataURL('image/png');
  });
}

async function main() {
  const preview = (process.argv.find((a) => a.startsWith('--preview=')) || '').slice('--preview='.length);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pngs = [];
    for (const icon of ICONS) {
      const { png, reach } = await page.evaluate(paint, { size: icon.size, cell: icon.cell });
      if (icon.maskable && reach > icon.size * 0.4) throw new Error(`${icon.file}: art reaches ${reach.toFixed(0)}px, outside the ${icon.size * 0.4}px safe zone`);
      fs.writeFileSync(path.join(OUT, icon.file), Buffer.from(png.split(',')[1], 'base64'));
      pngs.push(png);
      console.log(`wrote assets/icons/${icon.file} (${icon.size}px${icon.maskable ? `, art within ${reach.toFixed(0)}px of centre` : ''})`);
    }
    if (preview) {
      const png = await page.evaluate(sheet, pngs);
      fs.writeFileSync(preview, Buffer.from(png.split(',')[1], 'base64'));
      console.log(`wrote ${preview}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
