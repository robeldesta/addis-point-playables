import * as THREE from "three";
import * as P from "../../src/platform/platform";
import { Sfx } from "./sfx";

// Mega Stomp: an endless runner where your dino grows with every zombie it
// stomps. Grow big enough and cars, buses, tanks and even zombie dinosaurs
// become snacks (green ring). Anything bigger than you (red ring) knocks a
// chunk of size off. Stop eating and you shrink, then starve.

const GAME_ID = "mega-stomp";
const ROAD_HALF = 9;
const MAXZ = 480; // zombie pool
const MAXP = 700; // particle pool
const STAGES = [
  { name: "HATCHLING", at: 0 },
  { name: "CHOMPER", at: 25 },
  { name: "REX", at: 60 },
  { name: "MEGA REX", at: 140 },
  { name: "KAIJU", at: 300 },
];
const START_MASS = 10;
const DEAD_MASS = 4;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------
// Renderer, scene, light
// ------------------------------------------------------------------
P.initPlatform();
const host = document.getElementById("game")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0xf29a7a;
{
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#4a2f7a");
  gr.addColorStop(0.45, "#c45d8f");
  gr.addColorStop(0.75, "#f29a7a");
  gr.addColorStop(1, "#ffd27a");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog(FOG, 60, 150);

const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 400);
scene.add(new THREE.HemisphereLight(0xffe2f0, 0x5a4a6a, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.7 ? 66 : camera.aspect < 1.2 ? 58 : 48;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// Cartoon (toon) shading with a 3-step ramp.
const ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
const matCache = new Map<number, THREE.MeshToonMaterial>();
const mat = (color: number) => {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); matCache.set(color, m); }
  return m;
};
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  parent?.add(o);
  return o;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sph = (r: number, ws = 12, hs = 9) => new THREE.SphereGeometry(r, ws, hs);

// ------------------------------------------------------------------
// The street: scrolling road, sidewalks, buildings, trees, lamps
// ------------------------------------------------------------------
const ROAD_LEN = 700;
const ROAD_Z = -ROAD_LEN / 2 + 40;
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rx: number, ry: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}
const roadTex = canvasTex(256, 256, (g) => {
  g.fillStyle = "#4a4458"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) { g.fillStyle = Math.random() < 0.5 ? "#433d50" : "#544e62"; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
  g.fillStyle = "#fff4c2";
  for (const x of [256 / 3, (256 * 2) / 3]) g.fillRect(x - 3, 30, 6, 110);
  g.fillStyle = "#ffffff"; g.fillRect(4, 0, 6, 256); g.fillRect(246, 0, 6, 256);
}, 1, ROAD_LEN / 20);
const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, ROAD_LEN), new THREE.MeshLambertMaterial({ map: roadTex }));
road.rotation.x = -Math.PI / 2;
road.position.z = ROAD_Z;
road.receiveShadow = true;
scene.add(road);
const walkTex = canvasTex(64, 64, (g) => {
  g.fillStyle = "#c9b8c8"; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#a897a9"; g.lineWidth = 3; g.strokeRect(0, 0, 64, 64);
}, 2, ROAD_LEN / 5);
for (const s of [-1, 1]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(10, ROAD_LEN), new THREE.MeshLambertMaterial({ map: walkTex }));
  w.rotation.x = -Math.PI / 2;
  w.position.set(s * (ROAD_HALF + 5), 0.15, ROAD_Z);
  w.receiveShadow = true;
  scene.add(w);
  const curb = new THREE.Mesh(box(0.5, 0.3, ROAD_LEN), mat(0xe8dce8));
  curb.position.set(s * (ROAD_HALF + 0.25), 0.15, ROAD_Z);
  scene.add(curb);
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, ROAD_LEN), new THREE.MeshLambertMaterial({ color: 0x6b4f7a }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.05, ROAD_Z);
scene.add(ground);

// Buildings (instanced, recycled)
const winTex = canvasTex(128, 256, (g) => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = Math.random() < 0.3 ? "#ffe9a0" : "#3d3550";
    g.fillRect(10 + x * 30, 12 + y * 30, 18, 20);
  }
}, 1, 1);
const bGeo = box(1, 1, 1); bGeo.translate(0, 0.5, 0);
const BUILD_N = 44;
const buildings = new THREE.InstancedMesh(bGeo, new THREE.MeshToonMaterial({ map: winTex, gradientMap: ramp }), BUILD_N);
buildings.castShadow = true;
buildings.receiveShadow = true;
scene.add(buildings);
const BCOL = [0xff8fab, 0x9bf6ff, 0xffd166, 0xcdb4db, 0xa0e8af, 0xf4a261, 0xbde0fe, 0xffadad];
interface Bld { side: number; x: number; z: number; w: number; d: number; h: number; hp: number; }
const blds: Bld[] = [];
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler();
function placeBld(b: Bld, z: number) {
  b.w = rand(7, 12); b.d = rand(7, 12); b.h = rand(8, 34);
  b.z = z - b.d / 2;
  b.x = b.side * (ROAD_HALF + 10.5 + b.w / 2 + rand(0, 2));
}
for (let s = 0; s < 2; s++) {
  let z = 30;
  for (let i = 0; i < BUILD_N / 2; i++) {
    const b: Bld = { side: s ? 1 : -1, x: 0, z: 0, w: 0, d: 0, h: 0, hp: 0 };
    placeBld(b, z);
    z = b.z - b.d / 2 - rand(1, 4);
    blds.push(b);
  }
}
blds.forEach((_, i) => buildings.setColorAt(i, new THREE.Color(pick(BCOL))));
function farZ(side: number) {
  let m = 0;
  for (const b of blds) if (b.side === side) m = Math.min(m, b.z - b.d / 2);
  return m;
}

// Trees and lamps on the sidewalk
const PROP_N = 40;
const trunkGeo = box(0.4, 2, 0.4); trunkGeo.translate(0, 1, 0);
const leafGeo = new THREE.IcosahedronGeometry(1.4, 0); leafGeo.translate(0, 3, 0);
const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x7a4b2a), PROP_N);
const leaves = new THREE.InstancedMesh(leafGeo, mat(0xffffff), PROP_N);
trunks.castShadow = leaves.castShadow = true;
scene.add(trunks, leaves);
const props: { x: number; z: number; s: number }[] = [];
for (let i = 0; i < PROP_N; i++) {
  props.push({ x: (i % 2 ? 1 : -1) * (ROAD_HALF + 2.5), z: 20 - Math.floor(i / 2) * 18, s: rand(0.8, 1.2) });
  leaves.setColorAt(i, new THREE.Color(pick([0x7bd389, 0x5fbf6a, 0xb5e48c, 0xff9eb5])));
}

function scrollStreet(dz: number) {
  roadTex.offset.y += dz / 20;
  walkTex.offset.y += dz / 5;
  for (let i = 0; i < blds.length; i++) {
    const b = blds[i];
    b.z += dz;
    if (b.z - b.d / 2 > 40) placeBld(b, farZ(b.side) - rand(1, 4));
    const h = b.hp > 0 ? b.h : b.h * 0.15; // crushed buildings stay as rubble
    tmpM.compose(tmpV.set(b.x, 0, b.z), tmpQ.identity(), tmpS.set(b.w, h, b.d));
    buildings.setMatrixAt(i, tmpM);
  }
  buildings.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    p.z += dz;
    if (p.z > 30) p.z -= (PROP_N / 2) * 18;
    tmpM.compose(tmpV.set(p.x, 0.15, p.z), tmpQ.identity(), tmpS.set(p.s, p.s, p.s));
    trunks.setMatrixAt(i, tmpM);
    leaves.setMatrixAt(i, tmpM);
  }
  trunks.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------
// The hero: a cartoon T-rex (faces -z, feet at y=0)
// ------------------------------------------------------------------
const DINO = 0x6fd23c, BELLY = 0xfff07a, SPIKE = 0xff7b1c;
const dino = new THREE.Group();
scene.add(dino);
const dRoot = new THREE.Group(); // bob / squash
dino.add(dRoot);
mesh(sph(0.6), mat(DINO), 0, 1.05, 0.05, dRoot).scale.set(0.9, 0.85, 1.25);
mesh(sph(0.5), mat(BELLY), 0, 0.95, -0.25, dRoot).scale.set(0.75, 0.72, 0.8);
const head = new THREE.Group(); head.position.set(0, 1.45, -0.55); dRoot.add(head);
mesh(box(0.7, 0.55, 0.9), mat(DINO), 0, 0.18, -0.32, head);
const eyeW = sph(0.15), eyeP = sph(0.08);
for (const s of [-1, 1]) {
  mesh(eyeW, glow(0xffffff), s * 0.27, 0.42, -0.3, head);
  mesh(eyeP, glow(0x111111), s * 0.31, 0.44, -0.4, head);
  mesh(sph(0.05), mat(0x2f6a16), s * 0.15, 0.32, -0.78, head); // nostril
}
const jaw = new THREE.Group(); jaw.position.set(0, -0.06, 0); head.add(jaw);
mesh(box(0.62, 0.18, 0.82), mat(BELLY), 0, -0.06, -0.33, jaw);
const toothGeo = new THREE.ConeGeometry(0.05, 0.12, 4);
for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
  const t = mesh(toothGeo, glow(0xffffff), s * 0.26, 0.07, -0.08 - i * 0.2, jaw);
  t.castShadow = false;
}
const legs: THREE.Group[] = [];
for (const s of [-1, 1]) {
  const l = new THREE.Group(); l.position.set(s * 0.36, 0.95, 0.15); dRoot.add(l);
  mesh(sph(0.3), mat(DINO), 0, -0.18, 0, l).scale.set(0.9, 1.4, 1.1);
  mesh(box(0.2, 0.5, 0.22), mat(DINO), 0, -0.6, 0.05, l);
  mesh(box(0.32, 0.14, 0.46), mat(DINO), 0, -0.88, -0.1, l);
  legs.push(l);
  const a = mesh(box(0.1, 0.32, 0.1), mat(DINO), s * 0.42, 1.12, -0.6, dRoot);
  a.rotation.x = -0.8;
}
const tail: THREE.Group[] = [];
{
  let parent: THREE.Object3D = dRoot;
  const segs = [[0.38, 0.8], [0.26, 0.7], [0.15, 0.6]];
  let y = 1.05, z = 0.7;
  for (const [r, len] of segs) {
    const g = new THREE.Group(); g.position.set(0, y, z); parent.add(g);
    const c = mesh(new THREE.ConeGeometry(r, len, 8), mat(DINO), 0, 0, len / 2, g);
    c.rotation.x = Math.PI / 2;
    tail.push(g);
    parent = g; y = 0; z = len * 0.85;
  }
  const spikeGeo = new THREE.ConeGeometry(0.12, 0.3, 4);
  for (let i = 0; i < 4; i++) mesh(spikeGeo, mat(SPIKE), 0, 1.6 - i * 0.1, -0.25 + i * 0.28, dRoot);
  for (let i = 0; i < 3; i++) mesh(spikeGeo, mat(SPIKE), 0, 1.9, -0.6 + i * 0.25, dRoot).scale.setScalar(0.8);
}
const dinoMeshes: THREE.Mesh[] = [];
dino.traverse((o) => { if ((o as THREE.Mesh).isMesh) dinoMeshes.push(o as THREE.Mesh); });

// ------------------------------------------------------------------
// Zombies (instanced: 6 parts each)
// ------------------------------------------------------------------
const legG = box(0.2, 0.72, 0.22); legG.translate(0, -0.36, 0);
const bodyG = box(0.52, 0.66, 0.32); bodyG.translate(0, 0.33, 0);
const headG = box(0.4, 0.4, 0.4); headG.translate(0, 0.2, 0);
const armG = box(0.14, 0.6, 0.14); armG.translate(0, -0.3, 0);
function zInst(geo: THREE.BufferGeometry, n: number) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshToonMaterial({ gradientMap: ramp }), n);
  m.castShadow = true;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);
  return m;
}
const zLeg = zInst(legG, MAXZ * 2), zBody = zInst(bodyG, MAXZ), zHead = zInst(headG, MAXZ), zArm = zInst(armG, MAXZ * 2);
// Zombie eyes: one tiny glowing instanced mesh, 2 per zombie
const eyeG = box(0.08, 0.06, 0.04);
const zEye = new THREE.InstancedMesh(eyeG, glow(0xff3030), MAXZ * 2);
zEye.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(zEye);
const SKIN = [0x9ccc65, 0x8bc34a, 0xaed581, 0x7cb342, 0xb2c96a];
const SHIRT = [0xef5350, 0x42a5f5, 0xffca28, 0xab47bc, 0x26a69a, 0xff7043, 0xeceff1, 0x8d6e63];
const PANTS = [0x3949ab, 0x5d4037, 0x37474f, 0x6d4c41];
interface Zombie {
  on: boolean; st: number; // 0 walk, 1 flying, 2 down
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number; sx: number; sy: number; sz: number;
  ph: number; spd: number; t: number;
}
const zs: Zombie[] = [];
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAXZ; i++) {
  zs.push({ on: false, st: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, ph: 0, spd: 1, t: 0 });
  const skin = new THREE.Color(pick(SKIN)), pants = new THREE.Color(pick(PANTS));
  zBody.setColorAt(i, new THREE.Color(pick(SHIRT)));
  zHead.setColorAt(i, skin);
  for (const k of [0, 1]) { zArm.setColorAt(i * 2 + k, skin); zLeg.setColorAt(i * 2 + k, pants); }
  zBody.setMatrixAt(i, ZERO); zHead.setMatrixAt(i, ZERO);
  for (const k of [0, 1]) { zArm.setMatrixAt(i * 2 + k, ZERO); zLeg.setMatrixAt(i * 2 + k, ZERO); zEye.setMatrixAt(i * 2 + k, ZERO); }
}
let zFree = 0;
function spawnZombie(x: number, z: number): Zombie | null {
  for (let k = 0; k < MAXZ; k++) {
    const i = (zFree + k) % MAXZ;
    const zb = zs[i];
    if (!zb.on) {
      zFree = (i + 1) % MAXZ;
      Object.assign(zb, { on: true, st: 0, x, y: 0, z, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, ph: rand(0, 6.28), spd: rand(0.8, 2.2), t: 0 });
      return zb;
    }
  }
  return null;
}
const base = new THREE.Matrix4(), part = new THREE.Matrix4(), rot = new THREE.Matrix4();
function setPart(im: THREE.InstancedMesh, idx: number, ox: number, oy: number, oz: number, rx: number, ry = 0, rz = 0) {
  part.makeTranslation(ox, oy, oz);
  rot.makeRotationFromEuler(tmpE.set(rx, ry, rz));
  part.multiply(rot);
  part.premultiply(base);
  im.setMatrixAt(idx, part);
}
function drawZombies(time: number) {
  for (let i = 0; i < MAXZ; i++) {
    const z = zs[i];
    if (!z.on) continue;
    base.compose(tmpV.set(z.x, z.y, z.z), tmpQ.setFromEuler(tmpE.set(z.rx, z.ry, z.rz)), tmpS.set(1, 1, 1));
    const sw = z.st === 0 ? Math.sin(time * 7 * z.spd * 0.6 + z.ph) : z.st === 1 ? Math.sin(time * 25 + z.ph) * 1.2 : 0;
    setPart(zLeg, i * 2, -0.13, 0.72, 0, sw * 0.6);
    setPart(zLeg, i * 2 + 1, 0.13, 0.72, 0, -sw * 0.6);
    setPart(zBody, i, 0, 0.7, 0, 0.12, 0, sw * 0.08);
    setPart(zHead, i, 0, 1.36, 0.04, 0.15, 0, 0.25 * Math.sin(z.ph) + sw * 0.1);
    const ar = z.st === 1 ? -2.8 : -1.45;
    setPart(zArm, i * 2, -0.34, 1.28, 0, ar + sw * 0.25, 0, 0.05);
    setPart(zArm, i * 2 + 1, 0.34, 1.28, 0, ar - sw * 0.25, 0, -0.05);
    setPart(zEye, i * 2, -0.1, 1.6, 0.25, 0);
    setPart(zEye, i * 2 + 1, 0.1, 1.6, 0.25, 0);
  }
  zLeg.instanceMatrix.needsUpdate = zBody.instanceMatrix.needsUpdate = zHead.instanceMatrix.needsUpdate = true;
  zArm.instanceMatrix.needsUpdate = zEye.instanceMatrix.needsUpdate = true;
}
function hideZombie(i: number) {
  zs[i].on = false;
  zBody.setMatrixAt(i, ZERO); zHead.setMatrixAt(i, ZERO);
  for (const k of [0, 1]) { zArm.setMatrixAt(i * 2 + k, ZERO); zLeg.setMatrixAt(i * 2 + k, ZERO); zEye.setMatrixAt(i * 2 + k, ZERO); }
}

// ------------------------------------------------------------------
// Particles (goo, debris)
// ------------------------------------------------------------------
const pMesh = new THREE.InstancedMesh(box(1, 1, 1), new THREE.MeshLambertMaterial(), MAXP);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(pMesh);
interface Part { on: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; s: number; r: number; }
const ps: Part[] = [];
const pc = new THREE.Color();
for (let i = 0; i < MAXP; i++) { ps.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, s: 0, r: 0 }); pMesh.setMatrixAt(i, ZERO); pMesh.setColorAt(i, pc.set(0xffffff)); }
let pFree = 0;
function burst(x: number, y: number, z: number, n: number, color: number | number[], size: number, power: number) {
  for (let k = 0; k < n; k++) {
    const i = pFree; pFree = (pFree + 1) % MAXP;
    const p = ps[i];
    Object.assign(p, { on: true, x, y, z, vx: rand(-1, 1) * power, vy: rand(0.4, 1.4) * power, vz: rand(-1, 1) * power, life: rand(0.6, 1.2), s: size * rand(0.6, 1.3), r: rand(0, 6) });
    pMesh.setColorAt(i, pc.set(Array.isArray(color) ? pick(color) : color));
  }
  if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
}
function updateParticles(dt: number, dz: number) {
  for (let i = 0; i < MAXP; i++) {
    const p = ps[i];
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = false; pMesh.setMatrixAt(i, ZERO); continue; }
    p.vy -= 28 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt + dz;
    if (p.y < p.s / 2) { p.y = p.s / 2; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
    p.r += dt * 8;
    const sc = p.s * Math.min(1, p.life * 2);
    tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.setFromEuler(tmpE.set(p.r, p.r * 0.7, 0)), tmpS.set(sc, sc, sc));
    pMesh.setMatrixAt(i, tmpM);
  }
  pMesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------
// Obstacles: things that are either snacks or walls, depending on your size
// ------------------------------------------------------------------
type OType = "barrier" | "car" | "van" | "bus" | "tank" | "tanker" | "raptor" | "zrex";
interface Obs {
  type: OType; w: number; hw: number; hd: number; g: THREE.Group; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial;
  x: number; z: number; vx: number; vz: number; on: boolean; st: number; // 0 live, 1 flying
  vy: number; y: number; spin: THREE.Vector3; t: number; legs?: THREE.Group[]; jaw?: THREE.Group; sc: number;
}
const WHEEL = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12); WHEEL.rotateZ(Math.PI / 2);
const GLASS = 0x9fd8ff;
function wheels(g: THREE.Group, hw: number, zs2: number[], y = 0.42) {
  for (const z of zs2) for (const s of [-1, 1]) mesh(WHEEL, mat(0x222222), s * hw, y, z, g);
}
function buildCar(): THREE.Group {
  const g = new THREE.Group();
  const c = pick([0xff5d73, 0x4cc9f0, 0xffd166, 0x06d6a0, 0xf8f9fa, 0x9b5de5]);
  mesh(box(2, 0.75, 3.8), mat(c), 0, 0.75, 0, g);
  mesh(box(1.7, 0.62, 1.9), mat(c), 0, 1.42, 0.2, g);
  mesh(box(1.72, 0.45, 1.6), mat(GLASS), 0, 1.42, 0.2, g).scale.set(1.01, 1, 1.12);
  for (const s of [-1, 1]) mesh(box(0.35, 0.2, 0.05), glow(0xfff6c0), s * 0.65, 0.8, 1.91, g);
  wheels(g, 0.95, [-1.2, 1.2]);
  return g;
}
function buildVan(): THREE.Group {
  const g = new THREE.Group();
  mesh(box(2.3, 2.1, 4.8), mat(0xffffff), 0, 1.45, 0, g);
  mesh(box(2.32, 0.35, 4.82), mat(0xe63946), 0, 1.3, 0, g);
  mesh(box(2.1, 0.7, 0.1), mat(GLASS), 0, 2.0, 2.41, g);
  mesh(box(0.5, 0.25, 0.5), glow(0x4ea8ff), -0.4, 2.62, 1.6, g);
  mesh(box(0.5, 0.25, 0.5), glow(0xff3b3b), 0.4, 2.62, 1.6, g);
  wheels(g, 1.1, [-1.6, 1.6]);
  return g;
}
function buildBus(): THREE.Group {
  const g = new THREE.Group();
  mesh(box(2.7, 2.8, 9.5), mat(0xffb703), 0, 1.9, 0, g);
  for (const s of [-1, 1]) mesh(box(0.05, 0.8, 8.4), mat(GLASS), s * 1.36, 2.5, 0, g);
  mesh(box(2.4, 1.0, 0.06), mat(GLASS), 0, 2.4, 4.76, g);
  mesh(box(2.72, 0.25, 9.52), mat(0x222222), 0, 1.4, 0, g);
  wheels(g, 1.3, [-3.2, 3.2], 0.5);
  return g;
}
function buildTank(): THREE.Group {
  const g = new THREE.Group();
  mesh(box(3.2, 1.0, 5.4), mat(0x6b8e23), 0, 0.9, 0, g);
  for (const s of [-1, 1]) mesh(box(0.7, 0.9, 5.8), mat(0x333333), s * 1.6, 0.45, 0, g);
  mesh(box(1.9, 0.8, 2.2), mat(0x556b2f), 0, 1.8, -0.2, g);
  const b = mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 8), mat(0x445522), 0, 1.85, 2.2, g);
  b.rotation.x = Math.PI / 2;
  return g;
}
function buildTanker(): THREE.Group {
  const g = new THREE.Group();
  mesh(box(2.6, 2.4, 2.6), mat(0xe63946), 0, 1.6, 4.4, g);
  mesh(box(2.3, 0.8, 0.06), mat(GLASS), 0, 2.2, 5.72, g);
  const t = mesh(new THREE.CylinderGeometry(1.4, 1.4, 8, 16), mat(0xd8dde6), 0, 2.1, -1.2, g);
  t.rotation.x = Math.PI / 2;
  mesh(box(2.84, 0.5, 8.1), mat(0xff9f1c), 0, 2.1, -1.2, g).scale.set(1, 1, 1);
  wheels(g, 1.2, [-4, -2.6, 4.2], 0.5);
  return g;
}
function buildBarrier(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) mesh(box(0.6, 1.0, 0.45), mat(i % 2 ? 0xffffff : 0xff6b1a), -0.9 + i * 0.6, 0.6, 0, g);
  for (const s of [-1, 1]) mesh(box(0.15, 0.3, 0.8), mat(0x444444), s * 1.0, 0.15, 0, g);
  return g;
}
// Zombie dinosaur: rotting grey-green, ribs showing, glowing red eyes. Faces +z.
function buildZDino(sc: number): { g: THREE.Group; legs: THREE.Group[]; jaw: THREE.Group } {
  const g = new THREE.Group();
  const r = new THREE.Group(); r.scale.setScalar(sc); g.add(r);
  const SK = 0x7f9a6a, BONE = 0xf1ead2;
  mesh(sph(0.6), mat(SK), 0, 1.1, 0, r).scale.set(0.85, 0.8, 1.3);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const rb = mesh(box(0.06, 0.55, 0.08), mat(BONE), s * 0.48, 1.05, -0.25 + i * 0.18, r);
    rb.rotation.z = s * 0.35;
  }
  const h = new THREE.Group(); h.position.set(0, 1.5, 0.6); r.add(h);
  mesh(box(0.6, 0.45, 0.85), mat(SK), 0, 0.15, 0.35, h);
  for (const s of [-1, 1]) mesh(sph(0.09), glow(0xff2222), s * 0.24, 0.32, 0.45, h);
  const jw = new THREE.Group(); jw.position.set(0, -0.05, 0.05); h.add(jw);
  mesh(box(0.55, 0.14, 0.78), mat(BONE), 0, -0.07, 0.35, jw);
  const tg = new THREE.ConeGeometry(0.045, 0.12, 4);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) mesh(tg, glow(0xffffff), s * 0.22, 0.06, 0.15 + i * 0.22, jw);
  const lg: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group(); l.position.set(s * 0.34, 0.95, -0.1); r.add(l);
    mesh(box(0.26, 0.55, 0.32), mat(SK), 0, -0.25, 0, l);
    mesh(box(0.14, 0.5, 0.14), mat(BONE), 0, -0.65, 0, l);
    mesh(box(0.3, 0.12, 0.4), mat(SK), 0, -0.9, 0.1, l);
    lg.push(l);
  }
  const tl = mesh(new THREE.ConeGeometry(0.3, 1.6, 6), mat(SK), 0, 1.05, -1.3, r);
  tl.rotation.x = -Math.PI / 2 - 0.1;
  for (let i = 0; i < 5; i++) mesh(box(0.05, 0.25, 0.05), mat(BONE), 0, 1.55 - i * 0.04, -0.4 - i * 0.25, r);
  return { g, legs: lg, jaw: jw };
}
const SPEC: Record<OType, { w: number; hw: number; hd: number }> = {
  barrier: { w: 5, hw: 1.25, hd: 0.4 },
  car: { w: 18, hw: 1.0, hd: 1.9 },
  raptor: { w: 32, hw: 0.7, hd: 1.4 },
  van: { w: 45, hw: 1.15, hd: 2.4 },
  bus: { w: 90, hw: 1.35, hd: 4.75 },
  tank: { w: 160, hw: 1.9, hd: 2.9 },
  tanker: { w: 260, hw: 1.4, hd: 5.6 },
  zrex: { w: 200, hw: 1.6, hd: 3.6 },
};
const ringGeo = new THREE.RingGeometry(0.86, 1, 40); ringGeo.rotateX(-Math.PI / 2);
const obs: Obs[] = [];
function spawnObs(type: OType, x: number, z: number, w?: number) {
  let o = obs.find((q) => !q.on && q.type === type && (type !== "zrex"));
  if (!o) {
    let g: THREE.Group, legsArr: THREE.Group[] | undefined, jw: THREE.Group | undefined;
    if (type === "raptor" || type === "zrex") {
      const d = buildZDino(type === "raptor" ? 1.1 : 2.6); g = d.g; legsArr = d.legs; jw = d.jaw;
    } else g = ({ barrier: buildBarrier, car: buildCar, van: buildVan, bus: buildBus, tank: buildTank, tanker: buildTanker } as Record<string, () => THREE.Group>)[type]();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 1;
    scene.add(g, ring);
    o = { type, ...SPEC[type], g, ring, ringMat, x: 0, z: 0, vx: 0, vz: 0, on: false, st: 0, vy: 0, y: 0, spin: new THREE.Vector3(), t: 0, legs: legsArr, jaw: jw, sc: 1 };
    obs.push(o);
  }
  Object.assign(o, { on: true, st: 0, x, z, y: 0, vx: 0, vz: 0, vy: 0, t: rand(0, 6) });
  o.w = w ?? SPEC[type].w;
  o.sc = 1;
  if (type === "zrex") { o.sc = clamp(1 + (o.w - 200) / 600, 1, 2.2); }
  o.g.scale.setScalar(o.sc);
  o.g.rotation.set(0, type === "raptor" || type === "zrex" ? 0 : (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.08, 0.08), 0);
  o.g.visible = o.ring.visible = true;
  o.ring.scale.set(o.hw * o.sc * 1.3 + 0.4, 1, o.hd * o.sc * 1.2 + 0.4);
  return o;
}

// ------------------------------------------------------------------
// Game state
// ------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const sfx = new Sfx();
let state: "start" | "play" | "over" = "start";
let paused = false;
let mass = START_MASS, scale = 1, stage = 0, px = 0, pxTarget = 0, speed = 12;
let dist = 0, nextBeat = 30, runT = 0, points = 0, kills = 0, peak = START_MASS, peakStage = 0;
let combo = 0, comboT = 0, roarCharge = 0, invuln = 0, stun = 0, chomp = 0, shake = 0, stepPh = 0, roarT = 0, warnT = 0;
let best = 0, bossT = 40, finalScore = 0;
const ROAR_MAX = 30;

function stageOf(m: number, cur: number) {
  let s = cur;
  while (s < STAGES.length - 1 && m >= STAGES[s + 1].at) s++;
  while (s > 0 && m < STAGES[s].at * 0.82) s--;
  return s;
}
const scaleFor = (m: number) => clamp(0.45 + 0.9 * Math.log2(1 + m / 15), 0.7, 5.6);

function banner(text: string, bad = false) {
  const b = $("big");
  b.textContent = text;
  b.className = bad ? "bad" : "";
  void b.offsetWidth;
  b.className = (bad ? "bad " : "") + "show";
}

function reset() {
  for (let i = 0; i < MAXZ; i++) if (zs[i].on) hideZombie(i);
  for (const o of obs) { o.on = false; o.g.visible = o.ring.visible = false; }
  for (const b of blds) b.hp = 1;
  mass = START_MASS; stage = 0; scale = scaleFor(mass); px = pxTarget = 0;
  dist = 0; nextBeat = 25; runT = 0; points = 0; kills = 0; peak = mass; peakStage = 0;
  combo = 0; comboT = 0; roarCharge = 0; invuln = 0; stun = 0; bossT = 45;
}

function startRun() {
  reset();
  state = "play";
  $("start").classList.remove("show");
  $("over").classList.remove("show");
  sfx.unlock();
  sfx.click();
  for (let i = 0; i < 4; i++) spawnHorde(rand(-5, 5), -30 - i * 18, 6);
}

function endRun(why: string) {
  if (state !== "play") return;
  state = "over";
  sfx.over();
  const score = Math.floor(points + dist / 2);
  finalScore = score;
  const isBest = score > best;
  if (isBest) { best = score; void P.save(GAME_ID, JSON.stringify({ best })); P.sendScore(best); }
  $("why").textContent = why;
  $("final").textContent = String(score);
  $("stats").innerHTML = `${kills} zombies stomped<br>Peak size ${Math.round(peak)} tons (${STAGES[peakStage].name.toLowerCase()})<br>${Math.floor(dist)} m run`;
  $("newbest").textContent = isBest ? "New best!" : `Best ${best}`;
  setTimeout(() => $("over").classList.add("show"), 900);
}

// --- Spawning -------------------------------------------------------
function spawnHorde(cx: number, cz: number, n: number) {
  const r = Math.sqrt(n) * 0.75;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * r;
    spawnZombie(clamp(cx + Math.cos(a) * d, -ROAD_HALF + 0.6, ROAD_HALF - 0.6), cz + Math.sin(a) * d * 1.4);
  }
}
const SNACKS: OType[] = ["barrier", "car", "van", "bus", "tank", "tanker"];
function beat() {
  const z = -(120 + scale * 25);
  const lanes = [-6.5, -2.2, 2.2, 6.5];
  const early = runT < 7;
  const r = Math.random();
  const hordeN = Math.round(clamp(5 + Math.random() * 6 + mass * 0.11, 5, 46));
  if (early || r < 0.42) {
    spawnHorde(rand(-ROAD_HALF + 3, ROAD_HALF - 3), z, hordeN);
    if (!early && Math.random() < 0.4) spawnHorde(rand(-ROAD_HALF + 3, ROAD_HALF - 3), z - 10, Math.round(hordeN * 0.6));
    return;
  }
  // Blockers: bigger than you. Snacks: smaller.
  const snacks = SNACKS.filter((t) => SPEC[t].w <= mass * 0.95);
  const blockers = SNACKS.filter((t) => SPEC[t].w > mass * 1.05 && SPEC[t].w < mass * 4 + 20);
  const free = [...lanes].sort(() => Math.random() - 0.5);
  const nBlock = runT < 15 ? 1 : Math.min(2, 1 + (Math.random() < 0.35 ? 1 : 0));
  // Raptors chase you; a zombie T-rex boss always outweighs you.
  bossT -= 1;
  if (stage >= 1 && bossT <= 0) {
    bossT = Math.max(3, Math.round(10 - runT / 20)) + Math.floor(Math.random() * 4);
    spawnObs("zrex", free.pop()!, z, Math.round(mass * 1.35 + 40));
    banner("ZOMBIE REX!", true);
    spawnHorde(free.pop()!, z + 8, hordeN);
    return;
  }
  if (blockers.length) for (let i = 0; i < nBlock; i++) spawnObs(pick(blockers), free.pop()!, z + rand(-3, 3));
  // Once you outgrow every vehicle, undead T-rexes become the walls.
  if (!blockers.length || (runT > 60 && Math.random() < 0.3)) spawnObs("zrex", free.pop()!, z, Math.round(mass * rand(1.15, 1.6) + 30));
  if (runT > 12 && Math.random() < 0.3) spawnObs("raptor", free.pop()!, z - 6);
  if (snacks.length) {
    const t = snacks.length > 2 && Math.random() < 0.7 ? snacks[snacks.length - 1 - Math.floor(Math.random() * 2)] : pick(snacks);
    spawnObs(t, free.pop()!, z + rand(-4, 4));
  }
  if (free.length) spawnHorde(free.pop()!, z - 4, Math.round(hordeN * 0.7));
}

// --- Effects --------------------------------------------------------
function flingZombie(z: Zombie, power: number) {
  z.st = 1;
  z.vx = (z.x - px) * 2 + rand(-4, 4);
  z.vy = rand(7, 13) + power * 2;
  z.vz = -speed * rand(0.4, 1.0) - rand(0, 6) * power;
  z.sx = rand(-8, 8); z.sy = rand(-6, 6); z.sz = rand(-8, 8);
  burst(z.x, 1, z.z, 5, [0x9cff57, 0x6bd12a, 0xd0ff8a], 0.25, 6);
}
function smashObs(o: Obs) {
  o.st = 1;
  o.vy = rand(10, 16);
  o.vx = (o.x - px) * 1.5 + rand(-3, 3);
  o.vz = -speed * 0.6 - rand(4, 10);
  o.spin.set(rand(-4, 4), rand(-3, 3), rand(-4, 4));
  o.ring.visible = false;
  const big = clamp(o.w / Math.max(20, mass), 0.2, 1);
  burst(o.x, 1.5, o.z, 18, o.type === "raptor" || o.type === "zrex" ? [0x7f9a6a, 0xf1ead2, 0x9cff57] : [0xffd166, 0x888888, 0xff7b1c, 0x333333], 0.5 * o.sc, 9);
  sfx.crunch(big);
  shake = Math.max(shake, 0.4 + big * 0.6);
}
function chompFx() { chomp = 1; }

function doRoar() {
  if (state !== "play" || roarCharge < ROAR_MAX) return;
  roarCharge = 0;
  roarT = 1;
  sfx.roar();
  shake = 1.2;
  banner("ROAAAR!");
  const reach = 45 + scale * 10;
  for (const z of zs) if (z.on && z.st === 0 && z.z < 3 && z.z > -reach) { flingZombie(z, 1.5); kills++; mass += 0.5; points += 10; }
  for (const o of obs) if (o.on && o.st === 0 && o.z < 3 && o.z > -reach && o.w <= mass * 2) { smashObs(o); mass += o.w * 0.25; points += Math.round(o.w * 4); }
  shock.visible = true;
}
const shockMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthWrite: false });
const shock = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), shockMat);
shock.visible = false;
scene.add(shock);

// --- Input ----------------------------------------------------------
let dragging = false, lastX = 0;
const keys = new Set<string>();
window.addEventListener("pointerdown", (e) => {
  if ((e.target as HTMLElement).closest("button")) return;
  sfx.unlock();
  if (state === "start") { startRun(); return; }
  dragging = true; lastX = e.clientX;
});
window.addEventListener("pointermove", (e) => {
  if (!dragging || state !== "play") return;
  const dx = e.clientX - lastX; lastX = e.clientX;
  pxTarget = clamp(pxTarget + (dx / Math.min(window.innerWidth, 700)) * ROAD_HALF * 2.6, -ROAD_HALF, ROAD_HALF);
});
const endDrag = () => { dragging = false; };
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
window.addEventListener("keydown", (e) => {
  keys.add(e.key);
  if (e.key === " " || e.key === "ArrowUp") { if (state === "start") startRun(); else doRoar(); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => keys.delete(e.key));
$("roar").addEventListener("pointerdown", (e) => { e.stopPropagation(); doRoar(); });
$("again").addEventListener("click", () => startRun());

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
function update(dt: number) {
  const playing = state === "play";
  if (playing) runT += dt;
  // --- size, stage
  if (playing) {
    const hunger = runT < 3 ? 0 : (0.45 + 0.025 * mass + 6 * (mass / 300) ** 2) * (1 + runT / 90);
    mass -= hunger * dt;
    peak = Math.max(peak, mass);
    const ns = stageOf(mass, stage);
    if (ns > stage) { banner(STAGES[ns].name + "!"); sfx.levelUp(); shake = Math.max(shake, 0.5); }
    else if (ns < stage) { banner("SHRUNK!", true); sfx.levelDown(); }
    stage = ns; peakStage = Math.max(peakStage, stage);
    if (mass < DEAD_MASS) { endRun("Your dino starved. Keep eating!"); }
  }
  const sT = scaleFor(Math.max(mass, DEAD_MASS));
  scale += (sT - scale) * Math.min(1, dt * 3);

  // --- speed & scroll
  stun = Math.max(0, stun - dt);
  invuln = Math.max(0, invuln - dt);
  const baseSpd = state === "start" ? 7 : state === "over" ? 0 : (13 + Math.min(14, runT * 0.1)) * (0.78 + 0.22 * scale);
  const want = baseSpd * (stun > 0 ? 0.35 : 1);
  speed += (want - speed) * Math.min(1, dt * (state === "over" ? 3 : 2));
  const dz = speed * dt;
  if (playing) dist += dz;
  scrollStreet(dz);

  // --- steering
  if (playing) {
    const k = (keys.has("ArrowLeft") || keys.has("a") ? -1 : 0) + (keys.has("ArrowRight") || keys.has("d") ? 1 : 0);
    if (k) pxTarget = clamp(pxTarget + k * 16 * dt, -ROAD_HALF, ROAD_HALF);
  }
  const lim = ROAD_HALF - 0.45 * scale;
  pxTarget = clamp(pxTarget, -lim, lim);
  const prevX = px;
  px += (pxTarget - px) * Math.min(1, dt * 10);

  // --- beats
  if (playing && dist >= nextBeat) { beat(); nextBeat = dist + 15 + 5 * scale + Math.max(0, 8 - runT * 0.3); }

  // --- zombies
  const reachX = 0.55 * scale + 0.3, front = -(0.95 * scale + 0.35), back = 0.6 * scale;
  for (let i = 0; i < MAXZ; i++) {
    const z = zs[i];
    if (!z.on) continue;
    z.t += dt;
    if (z.st === 0) {
      z.z += dz + z.spd * dt;
      if (z.z > -35) z.x += clamp(px - z.x, -1, 1) * 0.9 * dt;
      z.ry = clamp((px - z.x) * 0.05, -0.6, 0.6);
      z.rz = Math.sin(z.t * 3 + z.ph) * 0.08;
      if (playing && Math.abs(z.x - px) < reachX && z.z > front && z.z < back) {
        flingZombie(z, scale * 0.3);
        mass += 1; kills++; combo++; comboT = 1.2; roarCharge = Math.min(ROAR_MAX, roarCharge + 1);
        points += 10 * (1 + Math.min(4, Math.floor(combo / 15)));
        sfx.splat(combo); chompFx();
      }
      if (z.z > 30) hideZombie(i);
    } else if (z.st === 1) {
      z.vy -= 30 * dt;
      z.x += z.vx * dt; z.y += z.vy * dt; z.z += z.vz * dt + dz;
      z.rx += z.sx * dt; z.ry += z.sy * dt; z.rz += z.sz * dt;
      if (z.y <= 0 && z.vy < 0) {
        z.st = 2; z.y = 0.1; z.rx = -Math.PI / 2; z.rz = 0;
        burst(z.x, 0.2, z.z, 3, 0x6bd12a, 0.3, 3);
        if (Math.abs(z.x) > ROAD_HALF + 1) z.y = 0.25;
      }
      if (z.z > 30 || z.t > 6) hideZombie(i);
    } else {
      z.z += dz;
      if (z.z > 30) hideZombie(i);
    }
  }

  // --- obstacles
  for (const o of obs) {
    if (!o.on) continue;
    o.t += dt;
    if (o.st === 0) {
      let vz = 0;
      if (o.type === "raptor") { vz = 7; if (o.z > -45) o.x += clamp(px - o.x, -1, 1) * 3 * dt; }
      if (o.type === "zrex") { vz = 3; if (o.z > -60 && o.z < -12) o.x += clamp(px - o.x, -1, 1) * (1.4 + Math.min(2, runT / 90)) * dt; }
      o.x = clamp(o.x, -ROAD_HALF + o.hw, ROAD_HALF - o.hw);
      o.z += dz + vz * dt;
      if (o.legs) {
        const sw = Math.sin(o.t * (o.type === "raptor" ? 14 : 6));
        o.legs[0].rotation.x = sw * 0.7; o.legs[1].rotation.x = -sw * 0.7;
        o.jaw!.rotation.x = 0.25 + Math.sin(o.t * 5) * 0.2;
        o.g.position.y = Math.abs(sw) * 0.1 * o.sc;
      }
      const edible = mass >= o.w;
      o.ringMat.color.set(edible ? 0x39ff6a : 0xff3b3b);
      o.ringMat.opacity = edible ? 0.85 : 0.6 + 0.35 * Math.abs(Math.sin(o.t * 6));
      o.g.position.set(o.x, o.g.position.y, o.z);
      o.ring.position.set(o.x, 0.08, o.z);
      if (playing && Math.abs(o.x - px) < o.hw * o.sc + 0.45 * scale && o.z + o.hd * o.sc > front && o.z - o.hd * o.sc < back) {
        if (edible) {
          smashObs(o);
          mass += o.w * 0.3; points += Math.round(o.w * 5); chompFx();
          roarCharge = Math.min(ROAR_MAX, roarCharge + 3);
        } else if (invuln <= 0) {
          smashObs(o);
          const lost = mass * 0.5 + 2;
          mass -= lost;
          stun = 0.9; invuln = 1.6; shake = 1.4;
          sfx.crash();
          burst(px, 1.5 * scale, -0.5, 14, [DINO, BELLY], 0.3 * scale, 7);
          if (mass < DEAD_MASS) endRun(`Flattened by a ${o.type === "zrex" ? "zombie T-rex" : o.type}!`);
          else banner(`OUCH! -${Math.round(lost)}`, true);
        }
      }
      if (o.z - o.hd * o.sc > 30) { o.on = false; o.g.visible = o.ring.visible = false; }
    } else {
      o.vy -= 30 * dt;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt + dz;
      o.g.rotation.x += o.spin.x * dt; o.g.rotation.y += o.spin.y * dt; o.g.rotation.z += o.spin.z * dt;
      o.g.position.set(o.x, o.y, o.z);
      if (o.y < -6 || o.z > 40) { o.on = false; o.g.visible = false; }
    }
  }

  // --- kaiju can crush the buildings too
  if (playing && stage >= 4) {
    for (const b of blds) {
      if (b.hp <= 0) continue;
      if (Math.abs(b.z) < b.d / 2 + scale * 0.6 && Math.abs(b.x - px) < b.w / 2 + 0.5 * scale + 1.2) {
        b.hp = 0; mass += 10; points += 500; sfx.crunch(1); shake = 1.2;
        burst(b.x - Math.sign(b.x) * b.w * 0.3, b.h * 0.4, b.z, 30, [...BCOL, 0x555555], 1.2, 12);
      }
    }
  }

  // --- combo / roar / hud timers
  comboT -= dt;
  if (comboT <= 0) combo = 0;
  roarT = Math.max(0, roarT - dt * 1.4);
  if (shock.visible) {
    const r = (1 - roarT) * (50 + scale * 10);
    shock.scale.setScalar(Math.max(0.1, r));
    shock.position.set(px, 0.15, -2);
    shockMat.opacity = roarT * 0.9;
    if (roarT <= 0) shock.visible = false;
  }
  chomp = Math.max(0, chomp - dt * 6);
  shake = Math.max(0, shake - dt * 2.2);

  // --- animate the dino
  stepPh += dt * (6 + speed * 0.35) / Math.sqrt(scale);
  const sw = Math.sin(stepPh);
  if (Math.sign(Math.sin(stepPh - dt * 8)) !== Math.sign(sw) && scale > 2.5 && playing) {
    sfx.stomp(); shake = Math.max(shake, 0.08 * scale);
  }
  dino.position.set(px, 0, 0);
  dino.scale.setScalar(scale);
  dino.rotation.y = clamp((prevX - px) / Math.max(dt, 0.001) * 0.015, -0.25, 0.25);
  dRoot.position.y = Math.abs(sw) * 0.09;
  dRoot.rotation.z = sw * 0.05;
  legs[0].rotation.x = sw * 0.9; legs[1].rotation.x = -sw * 0.9;
  tail.forEach((t, i) => { t.rotation.y = Math.sin(stepPh * 0.5 - i * 0.8) * 0.25; t.rotation.x = 0.1; });
  head.rotation.x = roarT > 0 ? -0.5 * roarT : Math.sin(stepPh * 2) * 0.04;
  jaw.rotation.x = -Math.max(chomp * 0.7, roarT * 0.9, 0.08);
  const blink = invuln > 0 && Math.floor(invuln * 12) % 2 === 0;
  for (const m of dinoMeshes) m.visible = !blink;
  if (state === "over") { dRoot.rotation.z = 1.4; dRoot.position.y = 0.2; }

  // --- camera
  const camY = 3.6 + 4 * scale, camZ = 7 + 4.6 * scale;
  const shx = (Math.random() - 0.5) * shake, shy = (Math.random() - 0.5) * shake;
  camera.position.set(px * 0.65 + shx, camY + shy, camZ);
  camera.lookAt(px * 0.8, 0.6 + 0.8 * scale, -14 - 4 * scale);
  const f = scene.fog as THREE.Fog;
  f.near = 55 + 12 * scale; f.far = 140 + 28 * scale;
  sun.position.set(px + 10, 30 + 4 * scale, 14);
  sun.target.position.set(px, 0, -8 - 2 * scale);
  const sc = sun.shadow.camera;
  const ext = 16 + 4 * scale;
  if (sc.right !== ext) { Object.assign(sc, { left: -ext, right: ext, top: ext * 1.4, bottom: -ext * 1.4, near: 1, far: 90 + 10 * scale }); sc.updateProjectionMatrix(); }

  updateParticles(dt, dz);
}

let hudMass = -1, hudScore = -1, hudRoar = -1;
function hud() {
  const score = state === "over" ? finalScore : Math.floor(points + dist / 2);
  if (score !== hudScore) { hudScore = score; $("score").firstChild!.textContent = String(score); }
  $("bestsm").textContent = `Best ${best}`;
  const m = Math.max(0, Math.round(mass));
  if (m !== hudMass) { hudMass = m; $("mass").firstChild!.textContent = m + " "; }
  $("stage").textContent = STAGES[stage].name;
  const lo = stage === 0 ? DEAD_MASS : STAGES[stage].at * 0.82;
  const hi = stage < STAGES.length - 1 ? STAGES[stage + 1].at : STAGES[stage].at * 2.5;
  const frac = clamp((mass - lo) / (hi - lo), 0, 1);
  ($("barfill") as HTMLElement).style.width = (frac * 100).toFixed(1) + "%";
  const low = frac < 0.22 && state === "play";
  $("bar").classList.toggle("low", low);
  $("hungry").classList.toggle("show", low && runT > 3);
  if (low && runT > 3) { warnT -= 1 / 60; if (warnT <= 0) { warnT = 0.6; sfx.warn(); } }
  const rc = Math.round(roarCharge);
  if (rc !== hudRoar) {
    hudRoar = rc;
    ($("roarfill") as HTMLElement).style.height = (roarCharge / ROAR_MAX) * 100 + "%";
    $("roar").classList.toggle("ready", roarCharge >= ROAR_MAX);
  }
  ($("roar") as HTMLElement).style.visibility = state === "play" ? "visible" : "hidden";
  const c = $("combo");
  if (combo >= 5 && state === "play") { c.textContent = `x${combo} COMBO`; c.style.opacity = "1"; } else c.style.opacity = "0";
}

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) return;
  update(dt);
  drawZombies(now / 1000);
  hud();
  renderer.render(scene, camera);
}

P.onPause(() => { paused = true; sfx.suspend(); });
P.onResume(() => { paused = false; last = performance.now(); sfx.resume(); });
P.onAudioChange((on) => { sfx.enabled = on; });
sfx.enabled = P.isAudioEnabled();

// Ambient zombies for the title screen
for (let i = 0; i < 5; i++) spawnHorde(rand(-6, 6), -20 - i * 25, 7);
scrollStreet(0);
requestAnimationFrame(frame);
P.firstFrameReady();
void P.loadSave(GAME_ID).then((raw) => {
  try { best = (JSON.parse(raw || "{}").best as number) || 0; } catch { best = 0; }
  P.gameReady();
});

if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { ms: unknown }).ms = {
    start: startRun,
    roar: () => { roarCharge = ROAR_MAX; doRoar(); },
    setMass: (m: number) => { mass = m; },
    step: (n: number) => { for (let i = 0; i < n; i++) update(1 / 60); },
    steer: (x: number) => { pxTarget = x; },
    auto: (skill = 1) => {
      const danger = obs.filter((o) => o.on && o.st === 0 && o.w > mass && o.z > -30 && o.z < 5);
      const safe = (x: number) => Math.random() > skill || danger.every((o) => Math.abs(o.x - x) > o.hw * o.sc + 0.6 * scale + 0.5);
      let bestX = px, bestD = 1e9;
      for (const z of zs) if (z.on && z.st === 0 && z.z < -1 && z.z > -40 && safe(z.x)) { const d = -z.z + Math.abs(z.x - px) * 0.5; if (d < bestD) { bestD = d; bestX = z.x; } }
      for (const o of obs) if (o.on && o.st === 0 && o.w <= mass && o.z < -1 && o.z > -40 && safe(o.x)) { const d = -o.z * 0.7; if (d < bestD) { bestD = d; bestX = o.x; } }
      if (!safe(bestX)) for (let x = -8; x <= 8; x += 1) if (safe(x)) { bestX = x; break; }
      pxTarget = bestX;
    },
    get state() { return { state, mass, stage, scale, speed, dist, kills, points, runT, zombies: zs.filter((z) => z.on).length, obs: obs.filter((o) => o.on).length }; },
  };
}
