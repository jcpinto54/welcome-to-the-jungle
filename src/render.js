'use strict';
/* render.js: the PS1 look. The scene renders into a small target (about 240 lines, an integer
   fraction of the screen height) that is scaled up with nearest-neighbour. One post shader then adds
   a little glow around bright pixels, a night grade, 15-bit colour with ordered dithering, scanlines,
   the grey-to-colour saturation, the rainbow carve ripple and the VHS glitch. */

const Render = (() => {
  const LINES = 240;
  let renderer, canvas, rt, postScene, postCam, cam = null, cssW = 0, cssH = 0, scale = 1;
  const stats = { calls: 0, triangles: 0, lines: 0, points: 0, width: 0, height: 0, scale: 1 };

  const U = {
    tDiffuse: { value: null },
    res: { value: new THREE.Vector2(426, LINES) },
    sat: { value: 1 },
    hush: { value: 0 },
    glitch: { value: 0 },
    flash: { value: 0 },
    fade: { value: 0 },
    time: { value: 0 },
    ripple: { value: new THREE.Vector3(0.5, 0.5, 0) }, // screen x, y and radius
    rippleAmt: { value: 0 },
    bloom: { value: 1 },
    scan: { value: 0.07 },
  };

  const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const frag = `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform vec3 ripple;
    uniform float sat, hush, glitch, flash, fade, time, rippleAmt, bloom, scan;
    varying vec2 vUv;
    float b2(vec2 p) { return mod(2.0 * p.x + 3.0 * p.y, 4.0); }
    float bayer4(vec2 p) { return (4.0 * b2(mod(p, 2.0)) + b2(mod(floor(p * 0.5), 2.0))) / 16.0; }
    vec3 hot(vec2 p) { return max(texture2D(tDiffuse, p).rgb - 0.52, 0.0); }
    void main() {
      vec2 uv = vUv;
      vec2 px = floor(vUv * res);
      if (glitch > 0.001) {
        float row = floor(px.y / 3.0);
        float n = fract(sin(row * 91.17 + floor(time * 24.0) * 7.3) * 43758.5453);
        if (n < glitch * 0.4) uv.x += (fract(n * 13.7) - 0.5) * 0.12 * glitch;
      }
      float ca = 0.0012 + glitch * 0.008;
      vec3 c = vec3(texture2D(tDiffuse, uv + vec2(ca, 0.0)).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - vec2(ca, 0.0)).b);
      // glow: bright pixels bleed a few texels into their neighbours
      vec2 t = 1.0 / res;
      vec3 g = hot(uv + vec2(2.0, 0.0) * t) + hot(uv - vec2(2.0, 0.0) * t) + hot(uv + vec2(0.0, 2.0) * t) + hot(uv - vec2(0.0, 2.0) * t);
      g += 0.7 * (hot(uv + vec2(3.0, 3.0) * t) + hot(uv + vec2(-3.0, 3.0) * t) + hot(uv + vec2(3.0, -3.0) * t) + hot(uv - vec2(3.0, 3.0) * t));
      g += 0.45 * (hot(uv + vec2(5.0, 0.0) * t) + hot(uv - vec2(5.0, 0.0) * t) + hot(uv + vec2(0.0, 5.0) * t) + hot(uv - vec2(0.0, 5.0) * t));
      c += g * 0.16 * bloom;
      // grey world: saturation comes back as the song does
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 grey = vec3(l) * vec3(0.9, 0.96, 1.12);
      vec2 d = (vUv - ripple.xy) * vec2(res.x / res.y, 1.0);
      float dist = length(d);
      float s = sat + rippleAmt * step(dist, ripple.z) * 0.6;
      s *= 1.0 - hush * 0.6;
      c = mix(grey, c, s);
      float band = rippleAmt * (1.0 - smoothstep(0.0, 0.05, abs(dist - ripple.z)));
      c += band * 0.6 * (0.5 + 0.5 * cos(6.2831 * (dist * 2.0 - time * 0.7 + vec3(0.0, 0.33, 0.67))));
      // night grade: blacks lift toward indigo, a touch of contrast in the mids
      c = c * 1.08 - 0.012;
      c += vec3(0.016, 0.01, 0.036) * (1.0 - smoothstep(0.0, 0.25, l));
      c += flash;
      vec2 v = vUv - 0.5;
      c *= 1.0 - dot(v, v) * 0.7;
      c = floor(max(c, 0.0) * 31.0 + bayer4(px)) / 31.0;
      c *= 1.0 - scan + scan * step(0.5, fract(vUv.y * res.y));
      c *= 1.0 - fade;
      gl_FragColor = vec4(c, 1.0);
    }`;

  // k screen pixels per target pixel, about 240 lines: 195 on a 390px phone, 240 at 720p, 270 at 1080p.
  function scaleFor(h) { return Math.max(1, Math.ceil(h / LINES - 0.5)); }

  function cssSize() {
    const w = (canvas && canvas.clientWidth) || window.innerWidth, h = (canvas && canvas.clientHeight) || window.innerHeight;
    return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
  }

  function init(el) {
    canvas = el;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.info.autoReset = false;
    rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    U.tDiffuse.value = rt.texture;
    const post = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false });
    postScene = new THREE.Scene();
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
    postCam = new THREE.Camera();
    // Resize and rotation: iOS reports the new size a moment after orientationchange.
    const later = () => { resize(); setTimeout(() => resize(), 300); };
    window.addEventListener('resize', () => resize());
    window.addEventListener('orientationchange', later);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => resize());
    if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas);
    resize();
    return renderer;
  }

  function resize(camera) {
    if (camera) cam = camera;
    if (!renderer) return;
    const [w, h] = cssSize();
    if (w !== cssW || h !== cssH) {
      cssW = w; cssH = h; scale = scaleFor(h);
      renderer.setSize(w, h, false);
      const rw = Math.max(1, Math.round(w / scale)), rh = Math.max(1, Math.round(h / scale));
      rt.setSize(rw, rh);
      U.res.value.set(rw, rh);
      U.scan.value = scale > 1 ? 0.07 : 0;
      if (typeof World !== 'undefined') World.SNAP.value.set(rw / 2, rh / 2);
      Object.assign(stats, { width: rw, height: rh, scale });
    }
    if (cam && cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
  }

  function draw(scene, camera) {
    if (camera !== cam) resize(camera);
    renderer.info.reset();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const r = renderer.info.render;
    stats.calls = r.calls; stats.triangles = r.triangles; stats.lines = r.lines; stats.points = r.points;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  return { init, resize, draw, U, stats, get renderer() { return renderer; }, get target() { return rt; } };
})();
