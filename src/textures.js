'use strict';
/* textures.js: small procedural pixel textures. PS1 rules: low resolution,
   no filtering, a handful of colours each. Nothing is loaded from disk. */

const TEX = (() => {
  const r = rng(1234);
  const ri = (n) => (r() * n) | 0;
  const P = (x, c, X, Y, w = 1, h = 1) => { x.fillStyle = c; x.fillRect(X, Y, w, h); };

  function make(w, h, draw, repeat = true) {
    const c = makeCanvas(w, h), x = c.getContext('2d');
    draw(x, w, h);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function speckle(x, w, h, cols, n) { for (let i = 0; i < n; i++) P(x, cols[ri(cols.length)], ri(w), ri(h)); }

  // Wet bark with deep vertical ridges and moss creeping up it.
  const bark = make(32, 32, (x, w, h) => {
    P(x, '#3a2a1c', 0, 0, w, h);
    for (let k = 0; k < 7; k++) {
      let X = ri(w);
      for (let Y = 0; Y < h; Y++) {
        P(x, '#211710', X, Y); P(x, '#4d3826', (X + 1) % w, Y);
        if (r() < 0.3) X = mod(X + (r() < 0.5 ? -1 : 1), w);
      }
    }
    for (let k = 0; k < 5; k++) { const X = ri(w), Y = ri(h); P(x, '#4f6b2a', X, Y, 2 + ri(3), 1 + ri(3)); P(x, '#6b8a3a', X, Y, 1, 1); }
    speckle(x, w, h, ['#8f9d7a', '#2b1f15'], 18);
  });

  const moss = make(32, 32, (x, w, h) => {
    P(x, '#3d5226', 0, 0, w, h);
    speckle(x, w, h, ['#4f6b2a', '#6b8a3a', '#2c3c1b', '#8f9d7a'], 260);
  });

  const stone = make(32, 32, (x, w, h) => {
    P(x, '#555a7a', 0, 0, w, h);
    speckle(x, w, h, ['#4a4e6c', '#62688e', '#6f76a0'], 120);
    for (let row = 0; row < 4; row++) {
      const y0 = row * 8;
      P(x, '#383c58', 0, y0 + 7, w, 1);
      P(x, '#6f76a0', 0, y0, w, 1);
      for (let bx = row % 2 ? 8 : 0; bx < w; bx += 16) P(x, '#383c58', bx, y0, 1, 7);
    }
    for (let i = 0; i < 6; i++) P(x, '#3f6b2a', ri(w), ri(h), 1 + ri(3), 1);
    P(x, '#383c58', 10, 10, 12, 1); P(x, '#383c58', 10, 10, 1, 5); P(x, '#383c58', 21, 10, 1, 5); P(x, '#262a40', 14, 11, 4, 3);
  });

  // Cracked stone: violet glowing cracks say "bass breaks this".
  const cracked = make(32, 32, (x, w, h) => {
    P(x, '#4d4966', 0, 0, w, h);
    speckle(x, w, h, ['#403c58', '#5b5780', '#36324f'], 140);
    for (let k = 0; k < 3; k++) {
      let X = 4 + ri(24);
      for (let Y = 0; Y < h; Y++) {
        P(x, '#120f22', X, Y);
        P(x, r() < 0.45 ? '#a57bff' : '#6e4fc0', X + 1, Y);
        if (r() < 0.45) X = clamp(X + (r() < 0.5 ? -1 : 1), 1, w - 3);
      }
    }
    for (let i = 0; i < 5; i++) P(x, '#d2b8ff', ri(w), ri(h));
  });

  // Vine curtain: magenta flowers say "the snare burns this".
  const vine = make(32, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let X = 0; X < w; X += 3) {
      for (let Y = 0; Y < h; Y++) {
        const xx = X + ((Y + X) % 8 < 4 ? 1 : 0);
        P(x, Y % 6 === 0 ? '#1d5a2a' : '#2f8a3e', xx, Y);
        if (r() < 0.25) P(x, '#5fcf5a', xx + 1, Y);
      }
    }
    for (let i = 0; i < 7; i++) { const X = ri(w - 2), Y = ri(h - 2); P(x, '#ff4fd8', X, Y, 2, 2); P(x, '#ffe0f7', X, Y); }
  });

  const leaves = make(32, 32, (x, w, h) => {
    P(x, '#1c3d1f', 0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const X = ri(w), Y = ri(h), c = ['#2a5a2a', '#3b7a33', '#244a24', '#4f8f3a'][ri(4)];
      P(x, c, X, Y, 3, 2); P(x, c, X + 1, Y + 2, 1, 1);
    }
    speckle(x, w, h, ['#0f2412'], 40);
  });

  // Cut-out foliage (alpha-tested).
  const fern = make(32, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    const fronds = 7;
    for (let f = 0; f < fronds; f++) {
      const a = Math.PI * (0.15 + (0.7 * f) / (fronds - 1));
      const len = 13 + ri(4);
      for (let s = 0; s < len; s++) {
        const X = Math.round(16 + Math.cos(a) * s * 1.1), Y = Math.round(31 - Math.sin(a) * s + (s * s) / 28);
        P(x, s < 5 ? '#2c6b32' : '#3f8f3e', X, Y);
        if (s % 2 === 0 && s > 2) { P(x, '#5fbf4a', X - 1, Y - 1); P(x, '#5fbf4a', X + 1, Y - 1); }
      }
    }
  }, false);

  const reeds = make(16, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let X = 1; X < w; X += 2) {
      const top = 4 + ri(14);
      for (let Y = top; Y < h; Y++) P(x, Y < top + 3 ? '#8f9d5a' : X % 4 ? '#3f6b2a' : '#57843a', X + (Y < 12 && X % 3 === 0 ? 1 : 0), Y);
      if (r() < 0.3) P(x, '#6b4428', X, top - 3, 1, 3); // cattail
    }
  }, false);

  const frond = make(32, 16, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let X = 0; X < w; X++) {
      const mid = 8 + Math.round(X / 10);
      P(x, '#3b6b2a', X, mid);
      const span = Math.round(7 * Math.sin((X / w) * Math.PI));
      for (let k = 1; k <= span; k++) { if ((X + k) % 3 === 0) { P(x, '#4f8f3a', X, mid - k); P(x, '#2f5a26', X, mid + k); } }
    }
  }, false);

  // Big jungle leaf (elephant ear).
  const bigleaf = make(32, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let Y = 0; Y < h; Y++) {
      const half = Math.round(14 * Math.sin((Y / h) * Math.PI) * (1 - Y / (h * 1.6)));
      for (let X = 16 - half; X <= 16 + half; X++) P(x, (X + Y) % 7 === 0 ? '#2f7a33' : '#2a6a2c', X, Y);
      P(x, '#6fbf5a', 16, Y);
      if (Y % 4 === 0) for (let k = 1; k < half; k++) { P(x, '#3f8f3e', 16 - k, Y + (k >> 2)); P(x, '#3f8f3e', 16 + k, Y + (k >> 2)); }
    }
  }, false);

  // Spanish moss: hanging grey-green strands (beard, cloak fringes, swamp trees).
  const hangMoss = make(16, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let X = 0; X < w; X++) {
      const len = 10 + ri(22);
      let xx = X;
      for (let Y = 0; Y < len; Y++) {
        P(x, Y > len - 4 ? '#5f6f4a' : ['#8a9474', '#7a866a', '#9aa384'][ri(3)], xx, Y);
        if (r() < 0.2) xx = clamp(xx + (r() < 0.5 ? -1 : 1), 0, w - 1);
      }
    }
  }, false);

  const lily = make(16, 16, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
      const dx = X - 7.5, dy = Y - 7.5, d = Math.hypot(dx, dy);
      if (d < 7.5 && !(dx > 0 && Math.abs(dy) < 1.2)) P(x, d > 6 ? '#2a5a26' : (X + Y) % 5 === 0 ? '#57a03f' : '#3f7f33', X, Y);
    }
    P(x, '#ff9ad8', 5, 6, 2, 2);
  }, false);

  const cap = make(16, 16, (x, w, h) => {
    P(x, '#d8452a', 0, 0, w, h);
    P(x, '#ff8a2a', 0, 0, w, 5);
    P(x, '#ffb13b', 0, 0, w, 1);
    for (let i = 0; i < 6; i++) P(x, '#f5e6c8', ri(15), 1 + ri(12), 2, 2);
  });

  const rune = make(32, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    const rows = [
      '....######....', '..##......##..', '.#....##....#.', '#...##..##...#', '#..#......#..#', '#.#..####..#.#',
      '#.#.#....#.#.#', '#.#.#.##.#.#.#', '#.#..#..#..#.#', '#..#......#..#', '.#..######..#.', '..##......##..',
      '....######....', '......##......', '.....#..#.....', '....#....#....', '..##########..',
    ];
    rows.forEach((row, Y) => { for (let X = 0; X < row.length; X++) if (row[X] === '#') P(x, '#ffffff', 2 + X * 2, Y * 2 - 2, 2, 2); });
  }, false);

  const glow = (() => {
    const c = makeCanvas(32, 32), x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  })();

  const mothWing = make(16, 16, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
      const d = Math.hypot((X - 2) / 14, (Y - 8) / 8);
      if (d < 1) P(x, d > 0.85 ? '#6f6b88' : (X + Y) % 4 === 0 ? '#c9c6d8' : '#b3b0c6', X, Y);
    }
    P(x, '#1d1b30', 8, 6, 4, 4); P(x, '#ff4f6d', 9, 7, 2, 2);
  }, false);

  const ground = make(32, 32, (x, w, h) => {
    P(x, '#e6e6e6', 0, 0, w, h);
    speckle(x, w, h, ['#cfcfcf', '#f4f4f4', '#bdbdbd'], 300);
    for (let i = 0; i < 6; i++) { const X = ri(w), Y = ri(h); P(x, '#a8a8a8', X, Y, 2, 1); P(x, '#ffffff', X, Y - 1, 1, 1); }
  });

  const water = make(32, 32, (x, w, h) => {
    P(x, '#9fb8c0', 0, 0, w, h);
    for (let i = 0; i < 26; i++) P(x, r() < 0.5 ? '#c8e6ee' : '#7f98a0', ri(w), ri(h), 3 + ri(5), 1);
  });

  const falls = make(16, 32, (x, w, h) => {
    P(x, '#3fa9c9', 0, 0, w, h);
    for (let X = 0; X < w; X++) for (let Y = 0; Y < h; Y++) if ((Y + X * 7) % 11 < 3) P(x, X % 3 ? '#bff6ff' : '#7ff6ff', X, Y);
  });

  // Cliff rock (grey, tinted by vertex colour): strata, cracks and a few mossy ledges.
  const rock = make(32, 32, (x, w, h) => {
    P(x, '#b4b4bc', 0, 0, w, h);
    speckle(x, w, h, ['#a2a2ac', '#c4c4cc', '#9494a0'], 160);
    for (let Y = 3; Y < h; Y += 5 + ri(3)) {
      for (let X = 0; X < w; X++) { P(x, '#7a7a88', X, Y); if (r() < 0.4) P(x, '#d4d4dc', X, Y - 1); }
    }
    for (let k = 0; k < 4; k++) { let X = ri(w); for (let Y = ri(h), n = 4 + ri(6); n > 0; n--, Y++) { P(x, '#6a6a78', X, Y % h); if (r() < 0.4) X = mod(X + 1, w); } }
    for (let i = 0; i < 6; i++) P(x, '#7d9a5a', ri(w), ri(h), 2 + ri(3), 1);
  });

  // Emissive companions: only the glowing parts are lit (cracks, flowers).
  const crackedGlow = make(32, 32, (x, w, h) => {
    const src = cracked.image.getContext('2d').getImageData(0, 0, w, h).data;
    P(x, '#000', 0, 0, w, h);
    for (let i = 0; i < w * h; i++) {
      const R = src[i * 4], G = src[i * 4 + 1], B = src[i * 4 + 2];
      if (B > 150 && R > 90 && G < 190) { P(x, '#5a3a9a', (i % w) - 1, (i / w) | 0, 3, 1); P(x, `rgb(${R},${G},${B})`, i % w, (i / w) | 0); }
    }
  });
  const vineGlow = make(32, 32, (x, w, h) => {
    const src = vine.image.getContext('2d').getImageData(0, 0, w, h).data;
    P(x, '#000', 0, 0, w, h);
    for (let i = 0; i < w * h; i++) if (src[i * 4] > 200 && src[i * 4 + 3] > 0) P(x, '#ff4fd8', i % w, (i / w) | 0);
  });

  // Foam ring texture (alpha-tested).
  const foam = make(32, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) P(x, r() < 0.5 ? '#e8fbff' : '#a8dcea', ri(w), ri(h), 1 + ri(3), 1);
  });

  // The pyramid's eye.
  const eye = make(32, 16, (x) => {
    x.clearRect(0, 0, 32, 16);
    x.fillStyle = '#e9e3cf'; x.beginPath(); x.ellipse(16, 8, 15, 7, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2fe0ff'; x.beginPath(); x.arc(16, 8, 6, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#0b8aa8'; x.beginPath(); x.arc(16, 8, 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#07060f'; x.fillRect(14, 4, 4, 8); x.fillStyle = '#fff'; x.fillRect(11, 4, 2, 2);
  }, false);

  return { bark, moss, stone, cracked, vine, leaves, fern, reeds, frond, bigleaf, hangMoss, lily, cap, rune, glow, mothWing, ground, water, falls,
    rock, crackedGlow, vineGlow, foam, eye };
})();
