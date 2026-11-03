import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as A from './astro.js';
import { buildTimeline } from './timeline.js';
import * as SH from './shaders.js';

const Q = new URLSearchParams(location.search);
const host = window.chrome && window.chrome.webview;
const STILL = Q.has('still');
const SPEED = parseFloat(Q.get('speed') || '1');
const DBG_MISSION = Q.has('m') ? parseInt(Q.get('m')) : 0;
const DBG_TOUR = Q.has('s') ? parseFloat(Q.get('s')) : 0;
const SKY = Q.get('sky') ? Q.get('sky').split(',').map(Number) : null;
const LOOK = Q.get('look'), LOOK_DIST = parseFloat(Q.get('dist') || '100000'), LOOK_PH = parseFloat(Q.get('ph') || '35') * Math.PI / 180;
const SUN_R = 695700;

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
const nativeDPR = window.devicePixelRatio || 1;
let resScale = Q.has('res') ? parseFloat(Q.get('res')) : 1;
const maxPR = Math.min(nativeDPR, 2.5);
renderer.toneMapping = Q.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 50, 1e13);
camera.matrixAutoUpdate = false; camera.matrixWorldAutoUpdate = false;

const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.8, 6.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const lens = new ShaderPass(SH.LENS_SHADER);
composer.addPass(lens);

function resize() {
  const pr = Math.max(0.5, maxPR * resScale);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pxScale = pr;
  lens.uniforms.uAspect.value = camera.aspect;
}
let pxScale = 1;

// ------------------------------------------------------------------ loading
const loader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function tex(url, { srgb = true, mips = true, wrapS = true } = {}) {
  return new Promise((res, rej) => loader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    if (wrapS) t.wrapS = THREE.RepeatWrapping;
    res(t);
  }, undefined, rej));
}
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
async function makeRamp(url, rows = 256) {
  const img = await loadImage(url), c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(rows * 4);
  const avgRow = (y) => { let r = 0, gg = 0, b = 0; y = Math.min(c.height - 1, Math.max(0, y)); for (let x = 0; x < c.width; x++) { const k = (y * c.width + x) * 4; r += d[k]; gg += d[k + 1]; b += d[k + 2]; } return [r / c.width, gg / c.width, b / c.width]; };
  for (let i = 0; i < rows; i++) {
    const y = Math.round((1 - i / (rows - 1)) * (c.height - 1)); let r = 0, gg = 0, b = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const a = avgRow(y + k); r += a[0]; gg += a[1]; b += a[2]; n++; }
    out[i * 4] = r / n; out[i * 4 + 1] = gg / n; out[i * 4 + 2] = b / n; out[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(out, 1, rows, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
function bvToRGB(bv) {
  bv = Math.min(2, Math.max(-0.4, bv));
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)), t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; } else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = [r, g, b].map((x) => Math.min(255, Math.max(0, x)) / 255);
  return c.map((x) => Math.pow(0.55 * x + 0.45, 2.2));
}

// ------------------------------------------------------------------ helpers
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const rnd = (s) => { let x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
const SPHERE = new THREE.SphereGeometry(1, 96, 48);
const QUAD = new THREE.PlaneGeometry(2, 2);

function bodyUniforms() {
  return {
    uAx: { value: new THREE.Vector3(1, 0, 0) }, uAy: { value: new THREE.Vector3(0, 1, 0) }, uAz: { value: new THREE.Vector3(0, 0, 1) },
    uCamRel: { value: new THREE.Vector3() }, uRadii: { value: new THREE.Vector3(1, 1, 1) }, uIrr: { value: 1 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunAng: { value: 0.003 },
    uOcc: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) }, uOccN: { value: 0 }, uSelf: { value: -1 },
    uRingType: { value: 0 }, uRingR: { value: 1 },
  };
}
function addMesh(geo, mat, order = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; m.frustumCulled = false; m.renderOrder = order;
  scene.add(m); return m;
}
function setMatrix(mesh, ax, ay, az, sx, sy, sz, p) {
  const e = mesh.matrix.elements;   // matrixWorld is derived from .matrix by the scene's forced update
  e[0] = ax[0] * sx; e[1] = ax[1] * sx; e[2] = ax[2] * sx; e[3] = 0;
  e[4] = ay[0] * sy; e[5] = ay[1] * sy; e[6] = ay[2] * sy; e[7] = 0;
  e[8] = az[0] * sz; e[9] = az[1] * sz; e[10] = az[2] * sz; e[11] = 0;
  e[12] = p[0]; e[13] = p[1]; e[14] = p[2]; e[15] = 1;
}

// ------------------------------------------------------------------ bodies
const bodies = [];     // every body with a state
const byId = {};
const systems = {};    // planet name -> {planet, moons[], ring, shell}
let sunBody, sprites;
const T = {};          // textures

const MOON_TYPE = { io: 1, europa: 2, ganymede: 3, callisto: 4, titan: 5, triton: 6, iapetus: 7, enceladus: 8, miranda: 9, mimas: 10, dione: 11, ariel: 12, umbriel: 12, amalthea: 13, hyperion: 13, icy: 0 };
const MOON_COL = {
  ariel: [[0.52, 0.5, 0.48], [0.68, 0.66, 0.64]], umbriel: [[0.3, 0.29, 0.28], [0.42, 0.41, 0.4]], amalthea: [[0.36, 0.15, 0.1], [0.5, 0.26, 0.15]],
  hyperion: [[0.38, 0.33, 0.29], [0.55, 0.48, 0.42]], proteus: [[0.2, 0.19, 0.18], [0.31, 0.3, 0.29]], icy: [[0.5, 0.5, 0.5], [0.76, 0.76, 0.75]],
  nereid: [[0.3, 0.3, 0.3], [0.45, 0.45, 0.45]],
};
const MOON_SHAPE = { amalthea: [1.5, 0.88, 0.77], hyperion: [1.33, 0.98, 0.76], proteus: [1.04, 1, 0.96] };
const ATMO = {
  jupiter: { H: 70, kappa: 1.0e-4, col: [0.7, 0.82, 1.0], mie: 0.5, g: 0.5 },
  saturn: { H: 60, kappa: 1.3e-4, col: [0.95, 0.85, 0.65], mie: 0.5, g: 0.5 },
  uranus: { H: 28, kappa: 3.2e-4, col: [0.4, 0.85, 0.95], mie: 0.3, g: 0.4 },
  neptune: { H: 22, kappa: 3.4e-4, col: [0.25, 0.45, 1.0], mie: 0.3, g: 0.4 },
  earth: { H: 9, kappa: 1.6e-3, col: [0.3, 0.55, 1.0], mie: 0.3, g: 0.6 },
  titan: { H: 45, kappa: 1.0e-3, col: [1.0, 0.55, 0.16], mie: 1.2, g: 0.7 },
};

function makeShell(parent, atmoKey, Req, flat) {
  const a = ATMO[atmoKey], shellR = Req + 8 * a.H;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SH.ATMO_VS, fragmentShader: SH.ATMO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uCamRel: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uColor: { value: new THREE.Vector3(...a.col) },
      uPlanetR: { value: Req }, uShellR: { value: shellR }, uScaleH: { value: a.H }, uKappa: { value: a.kappa }, uIrr: { value: 1 }, uMie: { value: a.mie }, uG: { value: a.g }, uSunAng: { value: 0.003 },
    },
  });
  const mesh = addMesh(SPHERE, mat, 4);
  parent.shell = { mesh, mat, R: shellR, k: 1 - flat };
}

function makeGiant(name, mode, extra) {
  const P = A.PLANETS[name];
  const mat = new THREE.ShaderMaterial({
    vertexShader: SH.BODY_VS, fragmentShader: SH.PLANET_FS, alphaToCoverage: true,
    uniforms: { ...bodyUniforms(), uMode: { value: mode }, uMap: { value: extra.map || null }, uRamp: { value: extra.ramp || null }, uMap2: { value: extra.map2 || null }, uMap3: { value: extra.map3 || null }, uMap4: { value: extra.map4 || null }, uTime: { value: 0 } },
  });
  const flat = P.f || 0;
  const b = {
    id: name, kind: 'planet', planet: name, R: P.r, radii: [P.r, P.r, P.r * (1 - flat)], albedo: P.albedo, color: P.color, boost: P.ringBoost || 1, mat, mesh: addMesh(SPHERE, mat, 0),
    frame: P.pole ? A.bodyFrame(P.pole) : A.bodyFrame([0, 90]), rotPeriod: P.rot ? P.rot * 3600 : 86164.1, mu: P.mu, moons: [], hasMesh: true,
  };
  if (name === 'earth') { b.frame = A.bodyFrame([0, 90]); }
  mat.uniforms.uRadii.value.set(...b.radii);
  if (ATMO[name]) makeShell(b, name, P.r, flat);
  bodies.push(b); byId[name] = b;
  return b;
}
function addRings(b, type, inner, outer) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SH.RING_VS, fragmentShader: SH.RING_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: { ...bodyUniforms(), uRingOuter: { value: outer }, uRingInner: { value: inner } },
  });
  mat.uniforms.uRingType.value = type; mat.uniforms.uRingR.value = b.R;
  b.mat.uniforms.uRingType.value = type; b.mat.uniforms.uRingR.value = b.R;
  b.ring = { mesh: addMesh(QUAD, mat, 3), mat, outer };
}
function makeMoon(planetBody, m) {
  const t = MOON_TYPE[m.type] ?? 0, cols = MOON_COL[m.id] || MOON_COL[m.type] || MOON_COL.icy;
  const shape = MOON_SHAPE[m.id] || [1, 1, 1];
  const mat = new THREE.ShaderMaterial({
    vertexShader: SH.BODY_VS, fragmentShader: SH.MOON_FS, alphaToCoverage: true,
    uniforms: { ...bodyUniforms(), uType: { value: t }, uSeed: { value: rnd(m.a) * 50 }, uColA: { value: new THREE.Vector3(...cols[0]) }, uColB: { value: new THREE.Vector3(...cols[1]) }, uDens: { value: 0.8 }, uBump: { value: 1.0 }, uParentDir: { value: new THREE.Vector3() }, uShine: { value: 0 } },
  });
  const radii = [m.r * shape[0], m.r * shape[1], m.r * shape[2]];
  mat.uniforms.uRadii.value.set(...radii);
  const b = { id: m.id, kind: 'moon', planet: planetBody.id, def: m, R: m.r, radii, albedo: m.albedo, color: [0.8, 0.78, 0.75], mat, mesh: addMesh(SPHERE, mat, 1), boost: 1, hasMesh: true, phase: rnd(m.a * 1.3) * Math.PI * 2 };
  if (m.id === 'titan') makeShell(b, 'titan', m.r, 0);
  planetBody.moons.push(b); bodies.push(b); byId[m.id] = b; return b;
}
function makePoint(name) {
  const P = A.PLANETS[name];
  const b = { id: name, kind: 'point', R: P.r, albedo: P.albedo, color: P.color, boost: 1, hasMesh: false };
  bodies.push(b); byId[name] = b;
}

async function setup() {
  const [mw, jup, earthDay, earthSpec, earthLights, earthClouds, moonMap, rSat, rUra, rNep, starsBuf, mwInfo] = await Promise.all([
    tex('tex/milkyway.jpg', { mips: false }), tex('tex/jupiter_cassini.jpg'),
    tex('tex/earth_atmos_2048.jpg'), tex('tex/earth_specular_2048.jpg', { srgb: false }), tex('tex/earth_lights_2048.png'), tex('tex/earth_clouds_1024.png', { srgb: false }), tex('tex/moon_1024.jpg'),
    makeRamp('tex/saturnmap.jpg'), makeRamp('tex/uranusmap.jpg'), makeRamp('tex/neptunemap.jpg'),
    fetch('data/stars.bin').then((r) => r.arrayBuffer()), fetch('data/milkyway.json').then((r) => r.json()),
  ]);
  T.mw = mw;

  // --- star field (real HYG catalogue) ---
  const raw = new Float32Array(starsBuf), n0 = raw.length / 5;
  let n = 0; for (let i = 0; i < n0; i++) if (raw[i * 5 + 3] <= 10.2) n++;
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
  for (let i = 0, k = 0; i < n0; i++) {
    if (raw[i * 5 + 3] > 10.2) continue;
    pos[k * 3] = raw[i * 5]; pos[k * 3 + 1] = raw[i * 5 + 1]; pos[k * 3 + 2] = raw[i * 5 + 2]; mag[k] = raw[i * 5 + 3];
    const c = bvToRGB(raw[i * 5 + 4]); col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2]; k++;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1)); sg.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  sky.starMat = new THREE.ShaderMaterial({
    vertexShader: SH.STAR_VS, fragmentShader: SH.STAR_FS, transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uGain: { value: 1.0 }, uPx: { value: 1 }, uExp: { value: 1 }, uViewRot: { value: new THREE.Matrix3() }, uProj: { value: new THREE.Matrix4() } },
  });
  const stars = new THREE.Points(sg, sky.starMat); stars.frustumCulled = false; stars.renderOrder = -10; scene.add(stars);
  // Milky Way
  sky.mwMat = new THREE.ShaderMaterial({
    vertexShader: SH.MW_VS, fragmentShader: SH.MW_FS, depthTest: false, depthWrite: false, side: THREE.BackSide,
    uniforms: { uTex: { value: mw }, uGain: { value: 0.3 }, uRef: { value: mwInfo.ref }, uViewRot: { value: new THREE.Matrix3() }, uProj: { value: new THREE.Matrix4() } },
  });
  const mwMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), sky.mwMat); mwMesh.frustumCulled = false; mwMesh.renderOrder = -20; scene.add(mwMesh);

  // --- sun ---
  const sunMat = new THREE.ShaderMaterial({ vertexShader: SH.SUN_VS, fragmentShader: SH.SUN_FS, uniforms: { uBright: { value: 7 } } });
  sunBody = { id: 'sun', kind: 'sun', R: SUN_R, mesh: addMesh(SPHERE, sunMat, 2), color: [1, 0.93, 0.8], hasMesh: true, albedo: 1, boost: 1 };
  bodies.push(sunBody); byId.sun = sunBody;

  // --- planets ---
  makePoint('mercury'); makePoint('venus'); makePoint('mars');
  const earth = makeGiant('earth', 4, { map: earthDay, map2: earthClouds, map3: earthSpec, map4: earthLights });
  earth.R = 6371;
  const moon = {
    id: 'moon', kind: 'moon', planet: 'earth', def: { id: 'moon', r: 1737.4, a: 384400, P: 27.32166 }, R: 1737.4, radii: [1737.4, 1737.4, 1737.4], albedo: 0.12, color: [0.8, 0.78, 0.75], boost: 1, hasMesh: true,
  };
  moon.mat = new THREE.ShaderMaterial({ vertexShader: SH.BODY_VS, fragmentShader: SH.PLANET_FS, alphaToCoverage: true, uniforms: { ...bodyUniforms(), uMode: { value: 5 }, uMap: { value: moonMap }, uRamp: { value: null }, uMap2: { value: null }, uMap3: { value: null }, uMap4: { value: null }, uTime: { value: 0 } } });
  moon.mat.uniforms.uRadii.value.set(1737.4, 1737.4, 1737.4); moon.mesh = addMesh(SPHERE, moon.mat, 1);
  earth.moons.push(moon); bodies.push(moon); byId.moon = moon;
  const jupiter = makeGiant('jupiter', 0, { map: jup });
  const saturn = makeGiant('saturn', 1, { ramp: rSat });
  const uranus = makeGiant('uranus', 2, { ramp: rUra });
  const neptune = makeGiant('neptune', 3, { ramp: rNep });
  addRings(saturn, 1, 66900, 140600); addRings(uranus, 2, 38000, 51500); addRings(neptune, 3, 41000, 63500);
  for (const k of ['jupiter', 'saturn', 'uranus', 'neptune']) for (const m of A.MOONS[k]) makeMoon(byId[k], m);

  if (Q.has('flat')) for (const b of bodies) if (b.mesh && b.kind !== 'sun') b.mesh.material = new THREE.MeshBasicMaterial({ color: 0xff40ff, depthTest: Q.get('flat') !== 'nodepth' });
  // unresolved-body sprites
  const spriteList = bodies.filter((b) => b.kind !== 'moon' || true);
  const N = spriteList.length;
  const sgeo = new THREE.BufferGeometry();
  sprites = { list: spriteList, pos: new Float32Array(N * 3), data: new Float32Array(N * 4), col: new Float32Array(N * 3) };
  sgeo.setAttribute('position', new THREE.BufferAttribute(sprites.pos, 3).setUsage(THREE.DynamicDrawUsage));
  sgeo.setAttribute('aData', new THREE.BufferAttribute(sprites.data, 4).setUsage(THREE.DynamicDrawUsage));
  sgeo.setAttribute('aCol', new THREE.BufferAttribute(sprites.col, 3).setUsage(THREE.DynamicDrawUsage));
  sprites.geo = sgeo;
  sprites.mat = new THREE.ShaderMaterial({ vertexShader: SH.SPRITE_VS, fragmentShader: SH.SPRITE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } } });
  const pts = new THREE.Points(sgeo, sprites.mat); pts.frustumCulled = false; pts.renderOrder = 6; scene.add(pts);
}
const sky = {};

// ------------------------------------------------------------------ mission state
const missions = [];
function buildMission(def) {
  const traj = A.buildTrajectory(def), tl = buildTimeline(traj);
  // satellite phases: featured moons are phased so they pass near the spacecraft at the documented time
  const phases = {};
  def.encounters.forEach((enc, i) => {
    const frame = A.bodyFrame(A.PLANETS[enc.planet].pole);
    for (const m of A.MOONS[enc.planet]) phases[m.id] = rnd(m.a * 1.3 + (def.id === 'V2' ? 7 : 0)) * Math.PI * 2;
    for (const [id, tm, range] of enc.moons) {
      const m = A.MOONS[enc.planet].find((x) => x.id === id), n = 2 * Math.PI / (m.P * 86400);
      const samples = [];
      for (let dt = -8 * 3600; dt <= 8 * 3600; dt += 600) { const t = tm + dt; samples.push({ t, rel: A.sub(traj.craftState(t).r, A.planetPos(enc.planet, t)) }); }
      let best = 1e30, bestPh = 0;
      for (let k = 0; k < 1440; k++) {
        const ph = k / 1440 * 2 * Math.PI;
        for (const s of samples) {
          const d = A.len(A.sub(moonOffset(frame, m, ph + n * s.t), s.rel)) + 4000 * Math.abs(s.t - tm) / 3600;
          if (d < best) { best = d; bestPh = ph; }
        }
      }
      phases[id] = bestPh;
    }
  });  return { def, traj, tl, phases };
}
function moonOffset(frame, m, ang) {
  let x = m.a * Math.cos(ang), y = m.a * Math.sin(ang), z = 0;
  if (m.tilt) { const tl = m.tilt * A.DEG; const y2 = y * Math.cos(tl), z2 = y * Math.sin(tl); y = y2; z = z2; }
  return [frame.x[0] * x + frame.y[0] * y + frame.z[0] * z, frame.x[1] * x + frame.y[1] * y + frame.z[1] * z, frame.x[2] * x + frame.y[2] * y + frame.z[2] * z];
}

// ------------------------------------------------------------------ per-frame body states
let curMission = null;
function updateStates(t) {
  const sunP = [0, 0, 0];
  for (const b of bodies) {
    if (b.kind === 'sun') { b.pos = sunP; b.axes = null; continue; }
    if (b.kind === 'point' || b.kind === 'planet') {
      if (b.id === 'earth') {
        const mv = moonEarthVec(t); b.moonVec = mv;
        b.pos = A.sub(A.planetPos('earth', t), A.mul(mv, 0.01215));
      } else b.pos = A.planetPos(b.id, t);
    }
  }
  for (const b of bodies) {
    if (b.kind === 'planet') {
      const W = (2 * Math.PI * t / b.rotPeriod) + (b.id === 'earth' ? earthW0(t) : 0), c = Math.cos(W), s = Math.sin(W), f = b.frame;
      b.axes = { x: A.add(A.mul(f.x, c), A.mul(f.y, s)), y: A.add(A.mul(f.x, -s), A.mul(f.y, c)), z: f.z };
    }
  }
  for (const b of bodies) {
    if (b.kind !== 'moon') continue;
    const P = byId[b.planet];
    if (b.id === 'moon') { b.pos = A.add(P.pos, P.moonVec); }
    else {
      const ph = curMission.phases[b.id] ?? b.phase, m = b.def, n = 2 * Math.PI / (m.P * 86400);
      b.pos = A.add(P.pos, moonOffset(P.frame, m, ph + n * t));
    }
    // synchronous rotation: x towards parent
    const x = A.norm(A.sub(P.pos, b.pos)), pole = P.frame.z;
    const z = A.norm(A.sub(pole, A.mul(x, A.dot(pole, x)))), y = A.cross(z, x);
    b.axes = { x, y, z };
  }
}
function earthW0(t) { return (280.46061837 * A.DEG) + (360.98564736629 * A.DEG) * (t / 86400) - 2 * Math.PI * t / 86164.1; }
function moonEarthVec(t) {
  const d = t / 86400, lam = (218.316 + 13.176396 * d) * A.DEG, u = (93.272 + 13.22935 * d) * A.DEG, beta = 5.145 * A.DEG * Math.sin(u);
  const x = Math.cos(beta) * Math.cos(lam), y = Math.cos(beta) * Math.sin(lam), z = Math.sin(beta);
  const ce = Math.cos(23.43928 * A.DEG), se = Math.sin(23.43928 * A.DEG);
  return A.mul([x, y * ce - z * se, y * se + z * ce], 384400);
}

// ------------------------------------------------------------------ camera director
const dir = { q: new THREE.Quaternion(), fov: 34, init: false, tgt: null, moon: null };
const ECL_N = A.ECLIPTIC_NORTH;
function basisQuat(fwd, upPref) {
  let right = A.cross(fwd, upPref);
  if (A.len(right) < 1e-3) right = A.cross(fwd, [0, 1, 0]);
  right = A.norm(right);
  const up = A.cross(right, fwd), back = A.mul(fwd, -1);
  const m = new THREE.Matrix4().makeBasis(V3(right), V3(up), V3(back));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function chooseTarget(tour, t, craft) {
  if (LOOK) return { id: LOOK, up: ECL_N, minFov: parseFloat(Q.get('fov') || '8') };
  const mi = curMission, seg = mi.tl.bounds.find((b) => tour >= b.a && tour < b.b) || mi.tl.bounds[mi.tl.bounds.length - 1];
  const n = mi.traj.flybys.length;
  let id, up = ECL_N, minFov = 3.5;
  if (seg.kind === 'enc') {
    const f = mi.traj.flybys[seg.idx]; id = f.planet; up = A.PLANETS[id].pole ? A.poleVec(A.PLANETS[id].pole) : ECL_N;
    // look at a moon when one passes close
    let best = null, bestScore = 1e9;
    for (const [mid] of f.enc.moons) {
      const b = byId[mid]; if (!b) continue;
      const sc = A.len(A.sub(b.pos, craft.r)) / b.R;
      if (sc < bestScore) { bestScore = sc; best = b; }
    }
    const lim = dir.moon && dir.moon === best ? 75 : 45;
    if (best && bestScore < lim && (tour - seg.a) > 8 && (seg.b - tour) > 4) { id = best.id; minFov = 6; dir.moon = best; } else dir.moon = null;
  } else {
    const u = (tour - seg.a) / (seg.b - seg.a), j = seg.idx;
    const prev = j === 0 ? 'earth' : mi.traj.flybys[j - 1].planet, next = j < n ? mi.traj.flybys[j].planet : null;
    if (j === n) { id = u < 0.3 ? prev : 'sun'; minFov = u < 0.3 ? 4 : 28; }
    else if (u < 0.28) { id = prev; minFov = 4; up = A.PLANETS[prev].pole ? A.poleVec(A.PLANETS[prev].pole) : ECL_N; }
    else { id = next; minFov = 8; }
  }
  return { id, up, minFov };
}
function updateCamera(dt, tour, t, craft) {
  if (SKY) { // dev aid: fixed sky direction (ra,dec,fov)
    const ra = SKY[0] * A.DEG, de = SKY[1] * A.DEG;
    dir.q.copy(basisQuat([Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)], [0, 0, 1])); dir.fov = SKY[2] || 40; dir.init = true;
    camera.quaternion.copy(dir.q); camera.fov = dir.fov; camera.updateProjectionMatrix();
    camera.matrix.compose(new THREE.Vector3(), camera.quaternion, new THREE.Vector3(1, 1, 1)); camera.matrixWorld.copy(camera.matrix); camera.matrixWorldInverse.copy(camera.matrix).invert();
    return { id: 'sun', up: ECL_N, minFov: 8 };
  }
  const tg = chooseTarget(tour, t, craft), b = byId[tg.id];
  const rel = A.sub(b.pos, craft.r), d = A.len(rel), fwd = A.mul(rel, 1 / d);
  const qT = basisQuat(fwd, tg.up);
  const R = tg.id === 'sun' ? SUN_R * 6 : b.R * (b.id === 'saturn' ? 1.4 : 1);
  const ang = 2 * Math.asin(Math.min(1, R / d)) * 180 / Math.PI;
  const fovT = Math.min(34, Math.max(tg.minFov, ang / 0.55));
  if (!dir.init) { dir.q.copy(qT); dir.fov = fovT; dir.init = true; }
  else {
    const k = 1 - Math.exp(-dt / 0.8);
    const angle = dir.q.angleTo(qT), maxStep = (50 * Math.PI / 180) * dt;
    const step = Math.min(1, Math.max(k, 0)) ;
    let s = step; if (angle * s > maxStep) s = maxStep / angle;
    dir.q.slerp(qT, s);
    const kf = 1 - Math.exp(-dt / 0.9);
    dir.fov = Math.exp(Math.log(dir.fov) + (Math.log(fovT) - Math.log(dir.fov)) * kf);
  }
  camera.quaternion.copy(dir.q);
  camera.fov = dir.fov; camera.updateProjectionMatrix();
  camera.matrix.compose(new THREE.Vector3(), camera.quaternion, new THREE.Vector3(1, 1, 1));
  camera.matrixWorld.copy(camera.matrix); camera.matrixWorldInverse.copy(camera.matrix).invert();
  return tg;
}

// ------------------------------------------------------------------ rendering state per frame
const tmpV = new THREE.Vector3();
function updateScene(t, craft, dt) {
  const cp = craft.r, sunD = A.len(cp);
  const viewRot = new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse);
  sky.starMat.uniforms.uViewRot.value.copy(viewRot); sky.starMat.uniforms.uProj.value.copy(camera.projectionMatrix); sky.starMat.uniforms.uPx.value = pxScale;
  sky.mwMat.uniforms.uViewRot.value.copy(viewRot); sky.mwMat.uniforms.uProj.value.copy(camera.projectionMatrix);

  const pixAng = 2 * Math.tan(camera.fov * Math.PI / 360) / (innerHeight * pxScale);
  let si = 0;
  for (const b of bodies) {
    const rel = A.sub(b.pos, cp), dc = A.len(rel);
    b.rel = rel; b.dist = dc;
    const toSun = A.sub([0, 0, 0], b.pos), dsb = A.len(toSun) || 1;
    const sunDir = b.kind === 'sun' ? [1, 0, 0] : A.mul(toSun, 1 / dsb);
    // ---- mesh ----
    if (b.hasMesh && b.mesh) {
      const rpx = (b.R / dc) / pixAng; b.rpx = rpx;
      if (b.kind === 'sun') {
        setMatrix(b.mesh, [1, 0, 0], [0, 1, 0], [0, 0, 1], b.R, b.R, b.R, rel);
        b.mesh.visible = rpx > 0.3;
      } else {
        const ax = b.axes, r = b.radii;
        setMatrix(b.mesh, ax.x, ax.y, ax.z, r[0] * 1.02, r[1] * 1.02, r[2] * 1.02, rel);
        b.mesh.visible = rpx > 0.12;
        const u = b.mat.uniforms;
        u.uAx.value.set(...ax.x); u.uAy.value.set(...ax.y); u.uAz.value.set(...ax.z);
        u.uCamRel.value.set(-rel[0], -rel[1], -rel[2]);
        u.uSunDir.value.set(...sunDir); u.uSunAng.value = SUN_R / dsb; u.uIrr.value = (sunD / dsb) ** 2;
        // occluders
        const sys = b.kind === 'planet' ? b : byId[b.planet], list = [];
        let selfIdx = -1;
        if (b.kind === 'moon') list.push(sys);
        for (const m of sys.moons) { if (m === b) selfIdx = list.length; list.push(m); }
        const occ = u.uOcc.value; let n = 0;
        for (const o of list) { if (n >= 10) break; const rr = A.sub(o.pos, b.pos); occ[n].set(rr[0], rr[1], rr[2], Math.max(...o.radii) * (o.kind === 'planet' ? 0.985 : 1)); n++; }
        u.uOccN.value = n; u.uSelf.value = selfIdx;
        if (b.kind === 'moon' && u.uParentDir) {
          const P = sys, pr = A.sub(P.pos, b.pos), pd = A.len(pr);
          u.uParentDir.value.set(pr[0] / pd, pr[1] / pd, pr[2] / pd);
          // reflected parent-planet light on the moon: albedo * (R/d)^2
          u.uShine.value = P.albedo * 0.5 * (P.R / pd) ** 2 * u.uIrr.value * 1.75 * 0.6;
        }
        if (b.mat.uniforms.uTime) b.mat.uniforms.uTime.value = t / 86400 * 30;
        if (b.ring) {
          const ru = b.ring.mat.uniforms, o = b.ring.outer;
          setMatrix(b.ring.mesh, ax.x, ax.y, ax.z, o, o, o, rel);
          ru.uAx.value.copy(u.uAx.value); ru.uAy.value.copy(u.uAy.value); ru.uAz.value.set(...b.frame.z);
          ru.uCamRel.value.copy(u.uCamRel.value); ru.uSunDir.value.copy(u.uSunDir.value); ru.uSunAng.value = u.uSunAng.value; ru.uIrr.value = u.uIrr.value;
          ru.uOcc.value[0].set(0, 0, 0, b.radii[0] * 0.985); ru.uOccN.value = 1; ru.uSelf.value = -1;
          // ring frame must use the unspun planet frame (rings are axisymmetric); axes equal the spun frame, z identical
          b.ring.mesh.visible = rpx > 0.05;
        }
        if (b.shell) {
          const sh = b.shell, su = sh.mat.uniforms, k = sh.k;
          const cx = A.dot(ax.x, [-rel[0], -rel[1], -rel[2]]), cy = A.dot(ax.y, [-rel[0], -rel[1], -rel[2]]), cz = A.dot(ax.z, [-rel[0], -rel[1], -rel[2]]);
          su.uCamRel.value.set(cx, cy, cz / k);
          const sx = A.dot(ax.x, sunDir), sy = A.dot(ax.y, sunDir), sz = A.dot(ax.z, sunDir);
          const sn = Math.hypot(sx, sy, sz / k); su.uSunDir.value.set(sx / sn, sy / sn, sz / k / sn);
          su.uIrr.value = u.uIrr.value; su.uSunAng.value = u.uSunAng.value;
          setMatrix(sh.mesh, ax.x, ax.y, ax.z, sh.R, sh.R, sh.R * k, rel);
          sh.mesh.visible = rpx > 0.15;
        }
      }
    }
    // ---- unresolved sprite ----
    const sp = sprites; const i = si++;
    if (b.kind === 'sun') {
      const m = -26.74 + 5 * Math.log10(dc / A.AU);
      sp.data[i * 4] = Math.min(25, Math.pow(10, -0.4 * (m - 6.4)) * 0.05); sp.data[i * 4 + 1] = 1;
    } else {
      const cosA = Math.max(-1, Math.min(1, A.dot(sunDir, A.mul(rel, -1 / dc)))), alpha = Math.acos(cosA);
      const phi = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
      const flux = b.albedo * b.boost * phi * (b.R / dc) ** 2 * (A.AU / dsb) ** 2;
      const m = -26.74 - 2.5 * Math.log10(Math.max(flux, 1e-30));
      const resolved = b.hasMesh ? 1 - smooth(0.7, 2.2, b.rpx || 0) : 1;
      sp.data[i * 4] = Math.min(8, Math.pow(10, -0.4 * (m - 6.4))) * resolved; sp.data[i * 4 + 1] = 1;
    }
    const sk = b.kind === 'sun' ? 1 - 1.02 * b.R / dc : 1 - Math.min(0.5, 1.05 * b.R / dc);   // pull the sprite in front of its own sphere
    sp.pos[i * 3] = rel[0] * sk; sp.pos[i * 3 + 1] = rel[1] * sk; sp.pos[i * 3 + 2] = rel[2] * sk;
    sp.col[i * 3] = b.color[0]; sp.col[i * 3 + 1] = b.color[1]; sp.col[i * 3 + 2] = b.color[2];
  }
  sprites.geo.attributes.position.needsUpdate = true; sprites.geo.attributes.aData.needsUpdate = true; sprites.geo.attributes.aCol.needsUpdate = true;
  sprites.mat.uniforms.uPx.value = pxScale;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ HUD
const hudEl = document.getElementById('hud'), titleEl = document.getElementById('title');
const dbgEl = document.getElementById('dbg');
const fmt = (x) => Math.round(x).toLocaleString('en-US');
let hudAcc = 0;
function updateHUD(dt, tour, t, craft, tg) {
  hudAcc += dt; if (hudAcc < 0.2) return; hudAcc = 0;
  const mi = curMission, seg = mi.tl.bounds.find((b) => tour >= b.a && tour < b.b) || mi.tl.bounds[mi.tl.bounds.length - 1];
  const n = mi.traj.flybys.length;
  let phase;
  if (seg.kind === 'enc') phase = mi.traj.flybys[seg.idx].planet.toUpperCase() + ' ENCOUNTER';
  else if (seg.idx === 0) phase = 'EARTH TO JUPITER';
  else if (seg.idx === n) phase = 'INTERSTELLAR SPACE';
  else phase = mi.traj.flybys[seg.idx - 1].planet.toUpperCase() + ' TO ' + mi.traj.flybys[seg.idx].planet.toUpperCase();
  const d = A.dateFromT(t), iso = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const tb = byId[tg.id], range = A.len(A.sub(tb.pos, craft.r)), sp = A.len(craft.v);
  const unit = range > 3e7 ? `${(range / A.AU).toFixed(2)} AU` : `${fmt(range)} km`;
  if (Q.has('dbg')) {
    const lines = [`tour ${tour.toFixed(2)} target ${tg.id} fov ${camera.fov.toFixed(2)} exposure-sunD ${(A.len(craft.r) / A.AU).toFixed(3)}AU`];
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    for (const b of bodies) {
      if (!b.rel) continue;
      const v = new THREE.Vector3(...b.rel).normalize(), off = Math.acos(Math.max(-1, Math.min(1, v.dot(f)))) * 180 / Math.PI;
      lines.push(`${b.id.padEnd(9)} dist ${b.dist.toExponential(2)} off-axis ${off.toFixed(2)}deg rpx ${(b.rpx || 0).toFixed(1)} vis ${b.mesh ? b.mesh.visible : '-'}`);
    }
    dbgEl.textContent = lines.join('\n');
  }
  hudEl.innerHTML = `<b>${mi.def.name}</b> &nbsp;${phase}<br>${iso} &nbsp;·&nbsp; ${tb.id.toUpperCase()} ${unit} &nbsp;·&nbsp; ${sp.toFixed(1)} km/s (heliocentric)`;
}

// ------------------------------------------------------------------ main loop
let perfAcc = 0;
let tour = 0, missionIdx = 0, fade = 0, fadeDir = 1, lastT = 0, frames = 0, slowAcc = 0, fpsAvg = 1 / 60, titleT = 0;
function startMission(i) {
  missionIdx = i % missions.length; curMission = missions[missionIdx]; tour = 0; dir.init = false; dir.moon = null; fade = 0; fadeDir = 1; titleT = 0;
  titleEl.innerHTML = `<div class="big">${curMission.def.name}</div><div class="sub">${curMission.def.launchText}</div>`;
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016); lastT = now;
  fpsAvg += (dt - fpsAvg) * 0.05;
  if (!STILL) tour += dt * SPEED;
  const total = curMission.tl.total;
  if (tour > total - 1.5 && fadeDir > 0) fadeDir = -1;
  if (tour >= total) { startMission(missionIdx + 1); }
  fade = STILL ? 1 : Math.min(1, Math.max(0, fade + fadeDir * dt / 1.5));
  const t = curMission.tl.tAt(tour), craft = curMission.traj.craftState(t);
  updateStates(t);
  if (LOOK) { const lb = byId[LOOK], sd = A.norm(A.sub([0, 0, 0], lb.pos)), side = A.norm(A.cross(sd, [0, 0, 1])); craft.r = A.add(lb.pos, A.add(A.mul(sd, LOOK_DIST * Math.cos(LOOK_PH)), A.mul(side, LOOK_DIST * Math.sin(LOOK_PH)))); craft.v = [0, 0, 0]; }
  const tg = updateCamera(STILL ? (frames < 70 ? 0.05 : 0.0001) : dt, tour, t, craft);
  updateScene(t, craft, dt);
  lens.uniforms.uTime.value = (frames % 997) * 0.37; lens.uniforms.uFade.value = fade * fade * (3 - 2 * fade);
  composer.render();
  if (Q.has('snap') && frames === parseInt(Q.get('snap'))) {   // dev aid: freeze the canvas into an <img> so a headless screenshot is deterministic
    const img = document.createElement('img'); img.src = canvas.toDataURL('image/png');
    img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:5'; document.body.appendChild(img);
  }
  updateHUD(dt, tour, t, craft, tg);
  titleT += dt; titleEl.style.opacity = Math.max(0, Math.min(1, (titleT - 1.2) / 1.0, (7.0 - titleT) / 1.5));
  hudEl.style.opacity = Math.min(1, Math.max(0, (titleT - 3) / 2)) * 0.8;
  frames++;
  // adaptive resolution
  slowAcc += dt; perfAcc += dt;
  if (host && perfAcc > 10) { perfAcc = 0; host.postMessage(`log:fps=${(1 / fpsAvg).toFixed(1)} res=${resScale.toFixed(2)} px=${Math.round(innerWidth * pxScale)}x${Math.round(innerHeight * pxScale)} tour=${tour.toFixed(0)} mission=${curMission.def.id}`); }
  if (slowAcc > 3 && !Q.has('res')) {
    slowAcc = 0;
    if (fpsAvg > 1 / 28 && resScale > 0.5) { resScale *= 0.85; resize(); }
    else if (fpsAvg < 1 / 55 && resScale < 1) { resScale = Math.min(1, resScale * 1.08); resize(); }
  }
  if (frames === 6) window.__ready = true;
}

// ------------------------------------------------------------------ input: exit like a screensaver
function installExit() {
  const arm = performance.now() + 1500; let mx = null, my = null;
  const quit = () => { if (host) host.postMessage('exit'); else if (Q.has('exit')) window.close(); };
  addEventListener('keydown', () => performance.now() > arm && quit());
  addEventListener('mousedown', () => performance.now() > arm && quit());
  addEventListener('touchstart', () => performance.now() > arm && quit());
  addEventListener('mousemove', (e) => {
    if (performance.now() < arm) return;
    if (mx === null) { mx = e.screenX; my = e.screenY; return; }
    if (Math.abs(e.screenX - mx) + Math.abs(e.screenY - my) > 25) quit();
  });
}

(async () => {
  try {
    resize(); addEventListener('resize', resize);
    await setup();
    for (const m of A.MISSIONS) missions.push(buildMission(m));
    startMission(DBG_MISSION); if (DBG_TOUR) tour = DBG_TOUR;
    if (Q.has('at')) { // dev aid: jump to a moon's closest approach (at=io) or a planet's (at=ca2)
      const key = Q.get('at'), off = parseFloat(Q.get('off') || '0'), mi = curMission;
      let tm = null;
      if (/^ca\d$/.test(key)) tm = mi.def.encounters[parseInt(key[2])].tca;
      else for (const e of mi.def.encounters) for (const [id, t] of e.moons) if (id === key) tm = t;
      if (tm !== null) tour = mi.tl.tauAt(tm) + off;
    }
    if (Q.has('sweep')) { // dev aid: walk both full tours without rendering and report any exception / non-finite state
      const out = []; let bad = 0;
      for (let mi = 0; mi < missions.length; mi++) {
        curMission = missions[mi]; dir.init = false; dir.moon = null;
        for (let s = 0; s < curMission.tl.total; s += 0.5) {
          try {
            const t = curMission.tl.tAt(s), craft = curMission.traj.craftState(t);
            updateStates(t); const tg = updateCamera(0.5, s, t, craft); updateScene(t, craft, 0.5);
            const q = camera.quaternion;
            if (![q.x, q.y, q.z, q.w, camera.fov, craft.r[0], craft.r[1], craft.r[2]].every(Number.isFinite)) { bad++; out.push(`NaN at M${mi} s=${s} target=${tg.id}`); }
          } catch (e) { bad++; out.push(`EXC at M${mi} s=${s}: ${e.message}`); if (bad > 10) break; }
        }
      }
      document.getElementById('boot').textContent = `SWEEP DONE bad=${bad}\n` + out.slice(0, 10).join('\n'); return;
    }
    installExit();
    document.getElementById('boot').remove();
    requestAnimationFrame(frame);
  } catch (e) {
    document.getElementById('boot').textContent = 'ERROR: ' + e.stack; window.__error = String(e.stack);
    console.error(e);
  }
})();
