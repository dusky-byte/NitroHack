import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ═══════════════════════════════════════════════════════════════════
// UltraTouch Scene Engine — "Storm" Plasma Orb
// 50,000-particle additive cloud with wobble, swirl, void carving.
// Custom Electric Cyan / Cosmic Teal palette.
// Single-composer pipeline (WebGLRenderer r0.160+ compatible).
// ═══════════════════════════════════════════════════════════════════

export interface SceneApi {
  setFocusedPanel(index: number): void;
  pulsePanel(index: number, colorHex: string): void;
  updatePointer(ndcX: number, ndcY: number, active: boolean): void;
  rotateOrb(deltaX: number, deltaY: number): void;
  setOrbZoom(factor: number): void;
  triggerBlowUp(): void;
  dispose(): void;
}

// ─── Color palette ─────────────────────────────────────────────────
// Electric Cyan / Cosmic Teal / Ice White — NOT the prompt's crimson palette
const CONFIG = {
  bgColor:      "#020b14",   // deep space
  flameColorA:  "#0ea5e9",   // sky blue flame
  flameColorB:  "#67e8f9",   // ice cyan flame
  flameAmt:     0.18,
  atmoColor:    "#bae6fd",   // bright sky blue motes
  atmoCount:    300,
  atmoSize:     20,
  atmoSpeed:    1.0,
  coreColor:    "#0369a1",   // mid-ocean blue core
  midColor:     "#22d3ee",   // vivid cyan mid
  rimColor:     "#e0f2fe",   // near-white ice rim
  opacity:      2.0,
  pointSize:    15,          // Reduced to see individual dots
  brightness:   1.8,         // slightly reduced to prevent blow-out
  spin:         0.025,
  repelRadius:  1.6,
  repelStrength: 4.5,
};

function hexToVec3(hex: string): THREE.Vector3 {
  const n = parseInt(hex.replace("#", ""), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ─── Orb vertex shader ─────────────────────────────────────────────
const OrbVert = `
uniform float uTime;
uniform float uSize;
uniform float uBlowUp;
uniform vec3  uCursor;
uniform float uRepelRadius;
uniform float uRepelStrength;
uniform float uActivity;
uniform vec3  uCore;
uniform vec3  uMid;
uniform vec3  uRim;
attribute float aScale;
attribute float aNoise;
attribute float aRadialPush;
attribute float aMix;
varying vec3  vColor;
varying float vBlowUp;

void main() {
  vec3 pos = position;

  // Per-particle breathing wobble
  float t = uTime * 1.4 + aNoise * 6.2831;
  float wobble = sin(t) * 0.12 * aRadialPush;
  pos *= 1.0 + wobble;

  // Slow secondary swirl (xz plane)
  float swirlAngle = uTime * 0.05 + aNoise * 6.2831;
  mat2 swirl = mat2(cos(swirlAngle), -sin(swirlAngle), sin(swirlAngle), cos(swirlAngle));
  pos.xz = swirl * pos.xz;

  // Radial blow-up (gesture trigger)
  vec3 outward = normalize(pos + vec3(0.0001));
  float blow = uBlowUp * uBlowUp;
  pos += outward * blow * (10.0 + aNoise * 18.0) * aRadialPush;

  vec4 modelPos = modelMatrix * vec4(pos, 1.0);

  // Cursor / fingertip void carving
  vec3 toParticle = modelPos.xyz - uCursor;
  float dist = length(toParticle);
  float falloff = smoothstep(uRepelRadius, 0.0, dist);
  modelPos.xyz += normalize(toParticle + vec3(0.0001)) * falloff * uRepelStrength * uActivity;

  vec4 viewPos = viewMatrix * modelPos;
  gl_Position = projectionMatrix * viewPos;

  // Size — scaled by perspective depth + per-particle scale
  gl_PointSize = uSize * aScale * (1.0 / -viewPos.z);
  // Clamp so we always have at least a 1-px dot
  gl_PointSize = max(gl_PointSize, 1.0);

  // Three-stop radial gradient: core → mid → rim
  float t1 = smoothstep(0.2, 0.8, aMix);
  vec3 c1   = mix(uCore, uMid, t1);
  float t2  = clamp((aMix - 0.65) * 3.0, 0.0, 1.0);
  vColor    = mix(c1, uRim, t2);
  vBlowUp   = uBlowUp;
}
`;

// ─── Orb fragment shader ───────────────────────────────────────────
const OrbFrag = `
uniform float uOpacity;
uniform float uBrightness;
varying vec3  vColor;
varying float vBlowUp;

void main() {
  vec2  uv  = gl_PointCoord - 0.5;
  float d   = length(uv);
  if (d > 0.5) discard;
  // Harder edge for distinct particles rather than soft blurry dots
  float strength  = smoothstep(0.5, 0.35, d); 
  vec3  color     = vColor * uBrightness;
  float blowFade  = 1.0 - smoothstep(0.1, 1.0, vBlowUp);
  gl_FragColor    = vec4(color, strength * uOpacity * blowFade);
}
`;

// ─── Atmosphere motes vertex shader ────────────────────────────────
const AtmoVert = `
attribute float size;
attribute float seed;
uniform   float uTime;
uniform   vec2  uRes;
varying   float vA;

vec3 warp(vec3 p, float t) {
  float c=0.9, a=1.9, b=0.02, s=0.05;
  p *= 2.0;
  p.x += c*sin(s*t + a*p.y) + t*b;
  p.y += c*cos(s*t + a*p.x);
  p.y += c*sin(s*t + a*p.z) + t*b;
  p.z += c*cos(s*t + a*p.y);
  p.z += c*sin(s*t + a*p.x) + t*b;
  p.x += c*cos(s*t + a*p.z);
  return cos(p + vec3(1.0, 2.0, 4.0));
}

void main() {
  vec3 v  = position * 4.0 + warp(position, uTime) * 1.2;
  vec4 mv = modelViewMatrix * vec4(v, 1.0);
  float r    = length(v);
  float farF = 1.0 - smoothstep(5.0, 6.5, r);
  float nearF = smoothstep(0.0, 0.5, -mv.z);
  vA = farF * nearF;
  gl_PointSize = max(size * uRes.y / 900.0 / -mv.z, 1.0);
  gl_Position  = projectionMatrix * mv;
}
`;

const AtmoFrag = `
uniform vec3  uColor;
varying float vA;

void main() {
  vec2  p = gl_PointCoord - 0.5;
  float l = length(p);
  if (l > 0.5) discard;
  float tex = smoothstep(0.5, 0.0, l);
  gl_FragColor = vec4(uColor * tex, tex * vA * 0.7);
}
`;

// ─── Background / flame composite shader ───────────────────────────
const CompositeFrag = `
uniform float     iTime;
uniform sampler2D tDiffuse;
uniform vec3      uBg;
uniform vec3      uFlameA;
uniform vec3      uFlameB;
uniform float     uFlameAmt;
varying vec2      vUv;

vec3 warp3d(vec3 pos, float t) {
  float curv = 0.8, a = 1.9, b = 0.7;
  pos *= 2.0;
  pos.x += curv*sin(t + a*pos.y) + t*b;
  pos.y += curv*cos(t + a*pos.x);
  pos.y += curv*sin(t + a*pos.z) + t*b;
  pos.z += curv*cos(t + a*pos.y);
  pos.z += curv*sin(t + a*pos.x) + t*b;
  pos.x += curv*cos(t + a*pos.z);
  return 0.5 + 0.5*cos(pos.xyz + vec3(1.0, 2.0, 4.0));
}

void main() {
  vec2 uv  = 2.0*vUv - 1.0;

  // Animated corner flames
  vec3 w     = pow(warp3d(vec3(uv.x, sin(uv.y), uv.y), iTime*1.5), vec3(1.5));
  vec3 flame = 1.5*uFlameA*w.x; flame *= w.y; flame += uFlameB*w.z;
  flame *= smoothstep(0.25, 1.0, abs(uv.y));
  float md   = smoothstep(-0.7, 1.0, -uv.y*uv.x);
  flame     *= md*md;

  // Background vignette
  vec3 bg = uBg * (1.0 - 0.35*length(uv));

  // Scene render on top (additive-blended orb already in there)
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  gl_FragColor = vec4(bg + flame*uFlameAmt + scene, 1.0);
}
`;

const CompositeVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`;

// ═══════════════════════════════════════════════════════════════════
// createScene — entry point
// ═══════════════════════════════════════════════════════════════════
export function createScene(container: HTMLElement): SceneApi {
  const W = container.clientWidth  || window.innerWidth;
  const H = container.clientHeight || window.innerHeight;

  // ─── Core Three.js objects ──────────────────────────────────────
  const scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 80);
  camera.position.set(0, 0, 7);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Explicit canvas sizing so it fills the container
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  container.style.position = "relative";
  container.appendChild(renderer.domElement);

  // ─── Composer: bloom → composite → output ──────────────────────
  // Single composer avoids the cross-composer texture-reference bugs.
  // Pass order:
  //   1. RenderPass      — scene → rt
  //   2. UnrealBloomPass — selective glow
  //   3. ShaderPass      — composite: bg + flames + scene
  //   4. OutputPass      — linear→sRGB conversion (replaces GammaCorrectionShader)

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(W, H),
    0.0,   // strength — 0 to remove glow and see distinct particles
    0.4,   // radius
    0.1,   // threshold
  );
  composer.addPass(bloom);

  const compositeUniforms = {
    iTime:     { value: 0.0 },
    tDiffuse:  { value: null },          // auto-fed by ShaderPass
    uBg:       { value: hexToVec3(CONFIG.bgColor) },
    uFlameA:   { value: hexToVec3(CONFIG.flameColorA) },
    uFlameB:   { value: hexToVec3(CONFIG.flameColorB) },
    uFlameAmt: { value: CONFIG.flameAmt },
  };

  const compositePass = new ShaderPass({
    uniforms:       compositeUniforms,
    vertexShader:   CompositeVert,
    fragmentShader: CompositeFrag,
  });
  composer.addPass(compositePass);

  // OutputPass converts from linear color-space to sRGB correctly in r0.160+
  composer.addPass(new OutputPass());

  // ─── Orb geometry ──────────────────────────────────────────────
  const COUNT  = 50000;
  const RADIUS = 2.5;
  const pos    = new Float32Array(COUNT * 3);
  const scales = new Float32Array(COUNT);
  const noises = new Float32Array(COUNT);
  const push   = new Float32Array(COUNT);
  const mix    = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    let u = 0, v = 0, s = 0;
    // Marsaglia: uniform point on unit sphere
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const fac = 2 * Math.sqrt(1 - s);
    const dx = u * fac, dy = v * fac, dz = 1 - 2 * s;
    const rN = Math.pow(Math.random(), 0.4); // outer shell bias
    const r  = RADIUS * (0.55 + rN * 0.45);
    pos[i3]     = dx * r;
    pos[i3 + 1] = dy * r;
    pos[i3 + 2] = dz * r;
    mix[i]    = rN;
    scales[i] = 0.5 + Math.random() * 0.8;
    noises[i] = Math.random();
    push[i]   = 0.4 + rN * 1.1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position",    new THREE.Float32BufferAttribute(pos,    3));
  geo.setAttribute("aScale",      new THREE.Float32BufferAttribute(scales, 1));
  geo.setAttribute("aNoise",      new THREE.Float32BufferAttribute(noises, 1));
  geo.setAttribute("aRadialPush", new THREE.Float32BufferAttribute(push,   1));
  geo.setAttribute("aMix",        new THREE.Float32BufferAttribute(mix,    1));

  const orbUniforms = {
    uTime:          { value: 0.0 },
    uSize:          { value: CONFIG.pointSize },
    uOpacity:       { value: 0.0 },   // fades up on appear
    uBlowUp:        { value: 0.0 },
    uCursor:        { value: new THREE.Vector3() },
    uRepelRadius:   { value: CONFIG.repelRadius },
    uRepelStrength: { value: CONFIG.repelStrength },
    uActivity:      { value: 0.0 },
    uCore:          { value: hexToVec3(CONFIG.coreColor) },
    uMid:           { value: hexToVec3(CONFIG.midColor) },
    uRim:           { value: hexToVec3(CONFIG.rimColor) },
    uBrightness:    { value: CONFIG.brightness },
  };

  const orbMat = new THREE.ShaderMaterial({
    vertexShader:   OrbVert,
    fragmentShader: OrbFrag,
    uniforms:       orbUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const orbGroup = new THREE.Group();
  orbGroup.add(new THREE.Points(geo, orbMat));
  scene.add(orbGroup);

  // ─── Atmosphere motes ──────────────────────────────────────────
  const N = CONFIG.atmoCount;
  const aPos   = new Float32Array(N * 3);
  const aSizes = new Float32Array(N);
  const aSeeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    aPos[i * 3]     = 2 * Math.random() - 1;
    aPos[i * 3 + 1] = 2 * Math.random() - 1;
    aPos[i * 3 + 2] = 2 * Math.random() - 1;
    aSizes[i]        = CONFIG.atmoSize * (0.4 + Math.random());
    aSeeds[i]        = Math.random();
  }
  const atmoGeo = new THREE.BufferGeometry();
  atmoGeo.setAttribute("position", new THREE.Float32BufferAttribute(aPos,   3));
  atmoGeo.setAttribute("size",     new THREE.Float32BufferAttribute(aSizes, 1));
  atmoGeo.setAttribute("seed",     new THREE.Float32BufferAttribute(aSeeds, 1));

  const atmoMat = new THREE.ShaderMaterial({
    vertexShader:   AtmoVert,
    fragmentShader: AtmoFrag,
    uniforms: {
      uTime:  { value: 0.0 },
      uColor: { value: hexToVec3(CONFIG.atmoColor) },
      uRes:   { value: new THREE.Vector2(W * renderer.getPixelRatio(), H * renderer.getPixelRatio()) },
    },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    depthTest:   false,
  });
  const atmoPoints = new THREE.Points(atmoGeo, atmoMat);
  atmoPoints.frustumCulled = false;
  scene.add(atmoPoints);

  // ─── Pointer state ─────────────────────────────────────────────
  const ptr = {
    ndc:      new THREE.Vector2(),
    world:    new THREE.Vector3(),
    target:   new THREE.Vector3(),
    active:   false,
    lastMove: performance.now(),
    activity: 0,
  };
  const _ndcV = new THREE.Vector3();
  const _dir  = new THREE.Vector3();

  function updatePointerWorld() {
    ptr.target.set(0, 0, 0);
    if (ptr.active) {
      _ndcV.set(ptr.ndc.x, ptr.ndc.y, 0.5).unproject(camera);
      _dir.copy(_ndcV).sub(camera.position).normalize();
      const denom = _dir.z;
      if (Math.abs(denom) > 1e-4) {
        const t = -camera.position.z / denom;
        if (t > 0 && isFinite(t)) ptr.target.copy(camera.position).addScaledVector(_dir, t);
      }
    }
    ptr.world.lerp(ptr.target, 0.12);
    const idle = (performance.now() - ptr.lastMove) / 1000;
    const want = ptr.active && idle < 3 ? 1 : 0;
    ptr.activity += (want - ptr.activity) * 0.06;
  }

  // ─── Interaction API state ──────────────────────────────────────
  let blowTarget = 0;
  let blowVal    = 0;
  let scrollTarget  = 0;
  let scrollSmooth  = 0;
  let scrollCurrent = 0;
  const mouseSmooth = { x: 0, y: 0 };

  const appearStart = performance.now();
  let t0 = performance.now() / 1000;

  // ─── RAF render loop ───────────────────────────────────────────
  let rafId    = 0;
  let disposed = false;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  function tick() {
    if (disposed) return;
    rafId = requestAnimationFrame(tick);

    const nowSec = performance.now() / 1000;
    const dt     = Math.min(0.05, nowSec - t0);
    t0 = nowSec;

    // Smooth scroll & mouse
    scrollSmooth  = lerp(scrollSmooth,  scrollTarget, 0.10);
    scrollCurrent = lerp(scrollCurrent, scrollSmooth, 0.06);
    mouseSmooth.x = lerp(mouseSmooth.x, ptr.ndc.x,   0.06);
    mouseSmooth.y = lerp(mouseSmooth.y, ptr.ndc.y,    0.06);

    updatePointerWorld();

    // Camera — parallax + scroll dive
    camera.position.set(
      mouseSmooth.x * 0.7,
      mouseSmooth.y * 0.7,
      7 - scrollCurrent * 2.5,
    );
    camera.lookAt(0, 0, 0);

    // Orb uniforms
    orbUniforms.uTime.value = nowSec;

    // Orb scale (grows with scroll)
    orbGroup.scale.setScalar(1 + scrollCurrent * 0.5);

    // Opacity fade-in after 300 ms delay over 1.4 s
    const elapsed = performance.now() - appearStart;
    const fade    = Math.max(0, Math.min(1, (elapsed - 300) / 1400));
    orbUniforms.uOpacity.value = fade * CONFIG.opacity;

    // Blow-up pulse from gestures
    blowVal    = lerp(blowVal, blowTarget, 0.12);
    blowTarget *= 0.90;
    orbUniforms.uBlowUp.value = blowVal;

    // Pointer void carving
    orbUniforms.uCursor.value.copy(ptr.world);
    orbUniforms.uActivity.value = ptr.activity;

    // Spin
    orbGroup.rotation.y += dt * (CONFIG.spin + scrollCurrent * 0.5);
    orbGroup.rotation.x += dt * CONFIG.spin * 0.33;

    // Atmosphere
    atmoMat.uniforms.uTime.value = nowSec * CONFIG.atmoSpeed * 8.0;
    atmoPoints.position.copy(camera.position);

    // Composite time
    compositeUniforms.iTime.value = nowSec;

    // Render
    composer.render();
  }

  tick();

  // ─── Public API ────────────────────────────────────────────────
  function setFocusedPanel(index: number) {
    scrollTarget = Math.min(index, 2) * 0.35;
  }

  function pulsePanel(_index: number, _color: string) {
    blowTarget = 0.7;
  }

  function updatePointer(ndcX: number, ndcY: number, active: boolean) {
    ptr.ndc.set(ndcX, ndcY);
    ptr.active = active;
    if (active) ptr.lastMove = performance.now();
  }

  function rotateOrb(deltaX: number, deltaY: number) {
    orbGroup.rotation.y += deltaX * 0.5;
    orbGroup.rotation.x += deltaY * 0.5;
  }

  function setOrbZoom(factor: number) {
    const s = Math.max(0.6, Math.min(2.5, orbGroup.scale.x * factor));
    orbGroup.scale.setScalar(s);
  }

  function triggerBlowUp() {
    blowTarget = 1.0;
  }

  // ─── Resize ───────────────────────────────────────────────────
  function onResize() {
    const w = container.clientWidth  || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    atmoMat.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }
  window.addEventListener("resize", onResize);

  // ─── Dispose ──────────────────────────────────────────────────
  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => mat?.dispose());
    });
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setFocusedPanel, pulsePanel, updatePointer, rotateOrb, setOrbZoom, triggerBlowUp, dispose };
}
