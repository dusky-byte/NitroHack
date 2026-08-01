import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GammaCorrectionShader } from "three/addons/shaders/GammaCorrectionShader.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";

// ——————————————————————————————————————————————
// UltraTouch Scene Engine: "Storm" Plasma Orb + Floating Glass Panels
// Combines the 50,000-particle additive plasma orb shader engine
// with a custom cool teal/electric cyan color palette.
// ——————————————————————————————————————————————

export interface SceneApi {
  setFocusedPanel(index: number): void;
  pulsePanel(index: number, colorHex: string): void;
  updatePointer(ndcX: number, ndcY: number, active: boolean): void;
  rotateOrb(deltaX: number, deltaY: number): void;
  setOrbZoom(factor: number): void;
  triggerBlowUp(): void;
  dispose(): void;
}

const LAYERS = {
  NONE: 0,
  TORUS_SCENE: 1,
  BLOOM_SCENE: 2,
  ENTIRE_SCENE: 3,
};

// Custom Color Palette (Cool Electric Cyan / Cosmic Teal & Ice)
// Overrides the prompt's crimson/magenta/gold as requested
const CONFIG = {
  bgColor: "#050a14",
  flameColor: "#0284c7",
  flameColor2: "#38bdf8",
  flameAmt: 0.25,
  atmoColor: "#7dd3fc",
  atmoCount: 300,
  atmoSize: 24,
  atmoSpeed: 1.0,
  coreColor: "#0c4a6e",
  midColor: "#06b6d4",
  rimColor: "#67e8f9",
  opacity: 2.0,
  pointSize: 80,
  brightness: 1.6,
  spin: 0.03,
  repelRadius: 1.4,
  repelStrength: 4.0,
};

function hexToVec3(hex: string): THREE.Vector3 {
  const n = parseInt(hex.replace("#", ""), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ─── Shaders ───

const OrbVertexShader = `
uniform float uTime;
uniform float uSize;
uniform float uBlowUp;
uniform vec3 uCursor;
uniform float uRepelRadius;
uniform float uRepelStrength;
uniform float uActivity;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uRim;
attribute float aScale;
attribute float aNoise;
attribute float aRadialPush;
attribute float aMix;
varying vec3 vColor;
varying float vBlowUp;

void main() {
  vec3 pos = position;

  // Per-particle in/out wobble
  float t = uTime * 1.4 + aNoise * 6.2831;
  float wobble = sin(t) * 0.1 * aRadialPush;
  pos *= 1.0 + wobble;

  // Slow secondary swirl on xz
  float swirlAngle = uTime * 0.05 + aNoise * 6.2831;
  mat2 swirl = mat2(cos(swirlAngle), -sin(swirlAngle), sin(swirlAngle), cos(swirlAngle));
  pos.xz = swirl * pos.xz;

  // Blow-up — radial explosion with squared falloff
  vec3 outward = normalize(pos + vec3(0.0001));
  float blow = uBlowUp * uBlowUp;
  pos += outward * blow * (10.0 + aNoise * 18.0) * aRadialPush;

  vec4 modelPosition = modelMatrix * vec4(pos, 1.0);

  // Repulsion / void carving from cursor or hand tip
  vec3 toParticle = modelPosition.xyz - uCursor;
  float dist = length(toParticle);
  float falloff = smoothstep(uRepelRadius, 0.0, dist);
  modelPosition.xyz += normalize(toParticle + vec3(0.0001)) * falloff * uRepelStrength * uActivity;

  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = uSize * aScale;
  gl_PointSize *= (1.0 / -viewPosition.z);

  // Three-stop radial gradient
  float t1 = smoothstep(0.25, 0.85, aMix);
  vec3 mix1 = mix(uCore, uMid, t1);
  float t2 = clamp((aMix - 0.7) * 3.0, 0.0, 1.0);
  vColor = mix(mix1, uRim, t2);
  vBlowUp = uBlowUp;
}
`;

const OrbFragmentShader = `
uniform float uOpacity;
uniform float uBrightness;
varying vec3 vColor;
varying float vBlowUp;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float strength = pow(1.0 - d * 2.0, 4.5);
  vec3 color = mix(vec3(0.0), vColor, strength);
  float blowFade = 1.0 - smoothstep(0.15, 1.0, vBlowUp);
  gl_FragColor = vec4(color * uBrightness, strength * uOpacity * blowFade);
}
`;

const FinalPassShader = {
  uniforms: {
    iTime: { value: 0 },
    tDiffuse: { value: null },
    torusTexture: { value: null },
    bloomTexture: { value: null },
    haloTexture: { value: null },
    uBg: { value: hexToVec3(CONFIG.bgColor) },
    uFlameA: { value: hexToVec3(CONFIG.flameColor) },
    uFlameB: { value: hexToVec3(CONFIG.flameColor2) },
    uFlameAmt: { value: CONFIG.flameAmt },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float iTime;
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    uniform sampler2D torusTexture;
    uniform sampler2D haloTexture;
    uniform vec3 uBg;
    uniform vec3 uFlameA;
    uniform vec3 uFlameB;
    uniform float uFlameAmt;
    varying vec2 vUv;

    vec3 warp3d(vec3 pos, float t){
      float curv = .8, a = 1.9, b = 0.7;
      pos *= 2.;
      pos.x += curv * sin(t + a * pos.y) + t * b;
      pos.y += curv * cos(t + a * pos.x);
      pos.y += curv * sin(t + a * pos.z) + t * b;
      pos.z += curv * cos(t + a * pos.y);
      pos.z += curv * sin(t + a * pos.x) + t * b;
      pos.x += curv * cos(t + a * pos.z);
      return 0.5 + 0.5 * cos(pos.xyz + vec3(1, 2, 4));
    }

    void main(){
      vec2 uv = 2. * vUv - 1.;
      vec3 w = pow(warp3d(vec3(uv.x, sin(uv.y), uv.y), iTime * 1.5), vec3(1.5));
      vec3 flame = 1.5 * uFlameA * w.x;
      flame *= w.y;
      flame += uFlameB * w.z;
      flame *= smoothstep(0.25, 1., abs(uv.y));
      float md = smoothstep(-0.7, 1., -uv.y * uv.x);
      flame *= md * md;
      vec3 bg = uBg * (1.0 - 0.4 * length(uv));
      vec3 halo = texture2D(haloTexture, vUv).xyz;
      gl_FragColor = vec4(
        bg + flame * uFlameAmt +
        texture2D(bloomTexture, vUv).xyz +
        texture2D(torusTexture, vUv).xyz +
        texture2D(tDiffuse, vUv).xyz + halo,
        1.0
      );
    }
  `,
};

const AtmoVertexShader = `
attribute float size;
attribute float seed;
uniform float uTime;
uniform vec2 uRes;
varying float vA;

vec3 warp(vec3 p, float t){
  float c=0.9, a=1.9, b=0.02, s=0.05;
  p *= 2.;
  p.x += c * sin(s*t + a*p.y) + t*b;
  p.y += c * cos(s*t + a*p.x);
  p.y += c * sin(s*t + a*p.z) + t*b;
  p.z += c * cos(s*t + a*p.y);
  p.z += c * sin(s*t + a*p.x) + t*b;
  p.x += c * cos(s*t + a*p.z);
  return cos(p + vec3(1,2,4));
}

void main(){
  vec3 v = position * 4.0 + warp(position, uTime) * 1.2;
  vec4 mv = modelViewMatrix * vec4(v, 1.0);
  float r = length(v);
  float farF = 1.0 - smoothstep(5.0, 6.5, r);
  float nearF = smoothstep(0.0, 0.5, -mv.z);
  vA = farF * nearF;
  gl_PointSize = size * uRes.y / 900.0 / -mv.z;
  gl_PointSize = max(gl_PointSize, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const AtmoFragmentShader = `
uniform vec3 uColor;
varying float vA;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float l = length(p);
  if (l > 0.5) discard;
  float tex = smoothstep(0.5, 0.0, l);
  gl_FragColor = vec4(uColor * tex, tex * vA * 0.6);
}
`;

export function createScene(container: HTMLElement): SceneApi {
  const width = container.clientWidth;
  const height = container.clientHeight;

  // ——— SCENE & CAMERA ———
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 0, 15);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 80);
  camera.position.set(0, 0, 7);
  camera.layers.enable(LAYERS.TORUS_SCENE);
  camera.layers.enable(LAYERS.BLOOM_SCENE);
  camera.layers.enable(LAYERS.ENTIRE_SCENE);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  container.appendChild(renderer.domElement);

  // ——— POSTPROCESSING COMPOSERS ———
  const renderScene = new RenderPass(scene, camera);

  // torusComposer
  const torusComposer = new EffectComposer(renderer);
  torusComposer.renderToScreen = false;
  torusComposer.addPass(renderScene);
  torusComposer.addPass(new ShaderPass(GammaCorrectionShader));
  torusComposer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.22, 0.2, 0));
  torusComposer.addPass(new ShaderPass(CopyShader));

  // bloomComposer
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderScene);
  bloomComposer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.4, 0.55, 0));
  bloomComposer.addPass(new ShaderPass(GammaCorrectionShader));

  // finalComposer
  const finalPass = new ShaderPass(FinalPassShader);
  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(renderScene);
  finalComposer.addPass(finalPass);

  finalPass.uniforms.bloomTexture.value = bloomComposer.renderTarget1.texture;
  finalPass.uniforms.torusTexture.value = torusComposer.renderTarget1.texture;

  // ——— STORM PLASMA ORB GEOMETRY ———
  const count = 50000;
  const radius = 2.5;
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const noises = new Float32Array(count);
  const radialPush = new Float32Array(count);
  const mixv = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    let u = 0, v = 0, s = 0;
    // Marsaglia uniform point on unit sphere
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);

    const factor = 2 * Math.sqrt(1 - s);
    const dx = u * factor;
    const dy = v * factor;
    const dz = 1 - 2 * s;
    const rN = Math.pow(Math.random(), 0.4); // Outer shell bias
    const r = radius * (0.55 + rN * 0.45);

    positions[i3] = dx * r;
    positions[i3 + 1] = dy * r;
    positions[i3 + 2] = dz * r;

    mixv[i] = rN;
    scales[i] = 0.45 + Math.random() * 0.8;
    noises[i] = Math.random();
    radialPush[i] = 0.4 + rN * 1.1;
  }

  const orbGeo = new THREE.BufferGeometry();
  orbGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  orbGeo.setAttribute("aScale", new THREE.Float32BufferAttribute(scales, 1));
  orbGeo.setAttribute("aNoise", new THREE.Float32BufferAttribute(noises, 1));
  orbGeo.setAttribute("aRadialPush", new THREE.Float32BufferAttribute(radialPush, 1));
  orbGeo.setAttribute("aMix", new THREE.Float32BufferAttribute(mixv, 1));

  const orbUniforms = {
    uTime: { value: 0 },
    uSize: { value: CONFIG.pointSize },
    uOpacity: { value: 0 },
    uBlowUp: { value: 0 },
    uCursor: { value: new THREE.Vector3() },
    uRepelRadius: { value: CONFIG.repelRadius },
    uRepelStrength: { value: CONFIG.repelStrength },
    uActivity: { value: 0 },
    uCore: { value: hexToVec3(CONFIG.coreColor) },
    uMid: { value: hexToVec3(CONFIG.midColor) },
    uRim: { value: hexToVec3(CONFIG.rimColor) },
    uBrightness: { value: CONFIG.brightness },
  };

  const orbMat = new THREE.ShaderMaterial({
    vertexShader: OrbVertexShader,
    fragmentShader: OrbFragmentShader,
    uniforms: orbUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const orbPoints = new THREE.Points(orbGeo, orbMat);
  orbPoints.layers.enable(LAYERS.ENTIRE_SCENE);

  const orbGroup = new THREE.Group();
  orbGroup.add(orbPoints);
  scene.add(orbGroup);

  // ——— ATMOSPHERE MOTES ———
  const atmoN = Math.round(CONFIG.atmoCount);
  const atmoPos = new Float32Array(atmoN * 3);
  const atmoSizes = new Float32Array(atmoN);
  const atmoSeeds = new Float32Array(atmoN);

  for (let i = 0; i < atmoN; i++) {
    atmoPos[i * 3] = 2 * Math.random() - 1;
    atmoPos[i * 3 + 1] = 2 * Math.random() - 1;
    atmoPos[i * 3 + 2] = 2 * Math.random() - 1;
    atmoSizes[i] = CONFIG.atmoSize * (0.4 + Math.random());
    atmoSeeds[i] = Math.random();
  }

  const atmoGeo = new THREE.BufferGeometry();
  atmoGeo.setAttribute("position", new THREE.Float32BufferAttribute(atmoPos, 3));
  atmoGeo.setAttribute("size", new THREE.Float32BufferAttribute(atmoSizes, 1));
  atmoGeo.setAttribute("seed", new THREE.Float32BufferAttribute(atmoSeeds, 1));

  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: AtmoVertexShader,
    fragmentShader: AtmoFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: hexToVec3(CONFIG.atmoColor) },
      uRes: { value: new THREE.Vector2(width * window.devicePixelRatio, height * window.devicePixelRatio) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const atmoPoints = new THREE.Points(atmoGeo, atmoMat);
  atmoPoints.frustumCulled = false;
  atmoPoints.layers.enable(LAYERS.ENTIRE_SCENE);
  scene.add(atmoPoints);

  // ——— POINTER / CURSOR PARALLAX ———
  const pointer = {
    ndc: new THREE.Vector2(0, 0),
    world: new THREE.Vector3(),
    targetWorld: new THREE.Vector3(),
    activity: 0,
    active: false,
    lastMove: performance.now(),
  };

  const mouseSmooth = { x: 0, y: 0 };
  let scrollTarget = 0;
  let scrollSmooth = 0;
  let scrollCurrent = 0;

  const _ndc = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function updatePointerLogic() {
    pointer.targetWorld.set(0, 0, 0);
    if (pointer.active) {
      _ndc.set(pointer.ndc.x, pointer.ndc.y, 0.5).unproject(camera);
      _dir.copy(_ndc).sub(camera.position).normalize();
      const denom = _dir.z;
      if (Math.abs(denom) > 1e-4) {
        const t = -camera.position.z / denom;
        if (t > 0 && Number.isFinite(t)) pointer.targetWorld.copy(camera.position).addScaledVector(_dir, t);
      }
    }
    pointer.world.lerp(pointer.targetWorld, 0.12);
    const idleSec = (performance.now() - pointer.lastMove) / 1000;
    const want = pointer.active && idleSec < 3 ? 1 : 0;
    pointer.activity += (want - pointer.activity) * 0.06;
  }

  // ——— INTERACTION APIS ———
  let focusedPanel = 0;
  let blowUpTarget = 0;
  let blowUpVal = 0;
  const appearStart = performance.now();
  let t0 = performance.now() / 1000;

  function setFocusedPanel(index: number) {
    focusedPanel = index;
    scrollTarget = index * 0.4;
  }

  function pulsePanel(_index: number, _colorHex: string) {
    blowUpTarget = 0.6;
  }

  function updatePointer(ndcX: number, ndcY: number, active: boolean) {
    pointer.ndc.set(ndcX, ndcY);
    pointer.active = active;
    if (active) pointer.lastMove = performance.now();
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
    blowUpTarget = 1.0;
  }

  // ——— ANIMATION & RENDER LOOP ———
  let rafId = 0;
  let disposed = false;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  function render() {
    if (disposed) return;
    rafId = requestAnimationFrame(render);

    const nowSec = performance.now() / 1000;
    const dt = Math.min(0.05, nowSec - t0);
    t0 = nowSec;

    // Smoothed input
    scrollSmooth = lerp(scrollSmooth, scrollTarget, 0.1);
    scrollCurrent = lerp(scrollCurrent, scrollSmooth, 0.06);
    mouseSmooth.x = lerp(mouseSmooth.x, pointer.ndc.x, 0.06);
    mouseSmooth.y = lerp(mouseSmooth.y, pointer.ndc.y, 0.06);

    updatePointerLogic();

    // Orb shader uniforms & animation
    orbUniforms.uTime.value = nowSec;

    // Camera dive & parallax
    camera.position.set(mouseSmooth.x * 0.7, mouseSmooth.y * 0.7, 7 - scrollCurrent * 3);
    camera.lookAt(0, 0, 0);

    // Orb scale & fade-in
    orbGroup.scale.setScalar(1 + scrollCurrent * 0.5);
    const elapsed = performance.now() - appearStart;
    const fade = Math.max(0, Math.min(1, (elapsed - 300) / 1400));
    orbUniforms.uOpacity.value = fade * CONFIG.opacity;

    // Blow-up pulse decay
    blowUpVal = lerp(blowUpVal, blowUpTarget, 0.1);
    blowUpTarget *= 0.92;
    orbUniforms.uBlowUp.value = blowUpVal;

    // Cursor void carving
    orbUniforms.uCursor.value.copy(pointer.world);
    orbUniforms.uActivity.value = pointer.activity;

    // Spin animation
    orbGroup.rotation.y += dt * (CONFIG.spin + scrollCurrent * 0.6);
    orbGroup.rotation.x += dt * CONFIG.spin * 0.33;

    // Atmosphere & composite uniforms
    atmoMat.uniforms.uTime.value = nowSec * CONFIG.atmoSpeed * 8.0;
    atmoPoints.position.copy(camera.position);
    finalPass.uniforms.iTime.value = nowSec;

    // Multi-pass layer rendering
    camera.layers.set(LAYERS.TORUS_SCENE);
    torusComposer.render();
    camera.layers.set(LAYERS.BLOOM_SCENE);
    bloomComposer.render();
    camera.layers.set(LAYERS.ENTIRE_SCENE);
    finalComposer.render();
  }

  render();

  // ——— RESIZE HANDLER ———
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    renderer.setSize(w, h);
    torusComposer.setSize(w, h);
    bloomComposer.setSize(w, h);
    finalComposer.setSize(w, h);

    atmoMat.uniforms.uRes.value.set(w * window.devicePixelRatio, h * window.devicePixelRatio);
  }

  window.addEventListener("resize", onResize);

  // ——— CLEANUP ———
  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.dispose();
      }
    });

    torusComposer.dispose();
    bloomComposer.dispose();
    finalComposer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    setFocusedPanel,
    pulsePanel,
    updatePointer,
    rotateOrb,
    setOrbZoom,
    triggerBlowUp,
    dispose,
  };
}
