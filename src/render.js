'use strict';
/* render.js: the PS1 look. The scene renders into a small target (270 lines tall)
   that is scaled up with nearest-neighbour, then one post shader adds 15-bit colour
   with ordered dithering, scanlines, the grey-to-colour saturation, the rainbow
   carve ripple and the VHS glitch. */

const Render = (() => {
  const RT_H = 270;
  let renderer, rt, postScene, postCam, post;

  const U = {
    tDiffuse: { value: null },
    res: { value: new THREE.Vector2(480, RT_H) },
    sat: { value: 1 },
    hush: { value: 0 },
    glitch: { value: 0 },
    flash: { value: 0 },
    fade: { value: 0 },
    time: { value: 0 },
    ripple: { value: new THREE.Vector3(0.5, 0.5, 0) }, // screen x, y and radius
    rippleAmt: { value: 0 },
  };

  const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const frag = `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform vec3 ripple;
    uniform float sat, hush, glitch, flash, fade, time, rippleAmt;
    varying vec2 vUv;
    float b2(vec2 p) { return mod(2.0 * p.x + 3.0 * p.y, 4.0); }
    float bayer4(vec2 p) { return (4.0 * b2(mod(p, 2.0)) + b2(mod(floor(p * 0.5), 2.0))) / 16.0; }
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
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 grey = vec3(l) * vec3(0.9, 0.96, 1.12);
      vec2 d = (vUv - ripple.xy) * vec2(res.x / res.y, 1.0);
      float dist = length(d);
      float s = sat + rippleAmt * step(dist, ripple.z) * 0.6;
      s *= 1.0 - hush * 0.6;
      c = mix(grey, c, s);
      float band = rippleAmt * (1.0 - smoothstep(0.0, 0.05, abs(dist - ripple.z)));
      c += band * 0.6 * (0.5 + 0.5 * cos(6.2831 * (dist * 2.0 - time * 0.7 + vec3(0.0, 0.33, 0.67))));
      c += flash;
      vec2 v = vUv - 0.5;
      c *= 1.0 - dot(v, v) * 0.9;
      c = floor(c * 31.0 + bayer4(px)) / 31.0;
      c *= 0.93 + 0.07 * step(0.5, fract(vUv.y * res.y));
      c *= 1.0 - fade;
      gl_FragColor = vec4(c, 1.0);
    }`;

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    rt = new THREE.WebGLRenderTarget(480, RT_H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    U.tDiffuse.value = rt.texture;
    post = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false });
    postScene = new THREE.Scene();
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
    postCam = new THREE.Camera();
    resize();
    return renderer;
  }

  function resize(camera) {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    const rw = Math.max(160, Math.round((RT_H * w) / h));
    rt.setSize(rw, RT_H);
    U.res.value.set(rw, RT_H);
    World.SNAP.value.set(rw / 2, RT_H / 2);
    if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  function draw(scene, camera) {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  return { init, resize, draw, U, get renderer() { return renderer; } };
})();
