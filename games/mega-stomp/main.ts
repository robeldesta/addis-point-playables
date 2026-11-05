import * as THREE from "three";
import * as P from "../../src/platform/platform";
import { Sfx } from "./sfx";

// Mega Stomp: an endless runner where your dino grows with every zombie it
// stomps. Grow big enough and cars, buses, tanks and zombie dinosaurs become
// snacks (green ring). Anything bigger than you (red ring) knocks a chunk of
// size off. Stop eating and you shrink. Tap to jump and ground-pound. Streets
// dead-end at T junctions: steer left or right to pick the next street.
// Tanks fire shells, sometimes from behind (a warning flashes).

const GAME_ID = "mega-stomp";
const ROAD_HALF = 9;
const WALK = 10; // sidewalk width
const MAXZ = 480;
const MAXP = 700;
const MAXEGG = 60;
const G = 40;
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
// Renderer, sky, light
// ------------------------------------------------------------------
P.initPlatform();
const host = document.getElementById("game")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0xc8e8ff;
{
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#2a8cff");
  gr.addColorStop(0.5, "#7cc4ff");
  gr.addColorStop(0.8, "#c8e8ff");
  gr.addColorStop(1, "#eaf6ff");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog(FOG, 60, 150);

const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 600);
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6a8a5a, 1.7));
const sun = new THREE.DirectionalLight(0xfff6e0, 2.3);
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
const ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
const matCache = new Map<number, THREE.MeshToonMaterial>();
const mat = (color: number) => {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); matCache.set(color, m); }
  return m;
};
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x15233a, side: THREE.BackSide });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  parent?.add(o);
  return o;
}
/** Cartoon ink outline (inverted hull). */
function ink(o: THREE.Mesh, w = 1.08) {
  const h = new THREE.Mesh(o.geometry, OUTLINE);
  h.scale.setScalar(w);
  o.add(h);
  return o;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sph = (r: number, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);

// Puffy clouds (not part of the world, so they never rotate at turns)
{
  const cm = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, fog: false });
  const cg = sph(1, 12, 8);
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const a = rand(-1.2, 1.2);
    g.position.set(Math.sin(a) * 320, rand(45, 100), -Math.cos(a) * 320 - 40);
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(cg, cm);
      m.position.set((k - 2) * rand(6, 9), Math.sin((k / 4) * Math.PI) * rand(4, 7), rand(-3, 3));
      m.scale.setScalar(rand(7, 12) * (1 - Math.abs(k - 2) * 0.18));
      g.add(m);
    }
    scene.add(g);
  }
}

// Everything that scrolls and turns lives in `world`.
const world = new THREE.Group();
scene.add(world);

// ------------------------------------------------------------------
// Streets. The main street scrolls. At a junction, a cross street ("arm")
// appears at the end; when you reach it the world swings 90 degrees and the
// arm's layout becomes the new main street.
// ------------------------------------------------------------------
const ROAD_LEN = 760;
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
function drawRoad(g: CanvasRenderingContext2D) {
  g.fillStyle = "#5d6178"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) { g.fillStyle = Math.random() < 0.5 ? "#565a70" : "#666a82"; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
  g.fillStyle = "#7fe3ff";
  for (const x of [256 / 3, (256 * 2) / 3]) g.fillRect(x - 3, 30, 6, 110);
  g.fillStyle = "#ffffff"; g.fillRect(4, 0, 6, 256); g.fillRect(246, 0, 6, 256);
}
function drawWalk(g: CanvasRenderingContext2D) {
  g.fillStyle = "#dfe7f2"; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#b9c6d8"; g.lineWidth = 3; g.strokeRect(0, 0, 64, 64);
}
const winTex = canvasTex(128, 256, (g) => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = Math.random() < 0.25 ? "#fff3b0" : "#7fb8e6";
    g.fillRect(10 + x * 30, 12 + y * 30, 18, 20);
  }
}, 1, 1);
const BCOL = [0x8ecae6, 0x90e0ef, 0xffd6a5, 0xcdb4db, 0xb8f2e6, 0xffc8dd, 0xa2d2ff, 0xfdffb6, 0xbde0fe];
const BUILD_N = 96; // 48 per side
const PROP_N = 48;
interface Bld { side: number; x: number; z: number; w: number; d: number; h: number; col: number; hide: boolean; crushed: boolean; }
interface Prop { side: number; x: number; z: number; s: number; hide: boolean; }
interface Street {
  g: THREE.Group; roadTex: THREE.Texture; walkTex: THREE.Texture;
  bld: THREE.InstancedMesh; trunks: THREE.InstancedMesh; leaves: THREE.InstancedMesh;
  blds: Bld[]; props: Prop[];
  roadMat: THREE.Material; walkMat: THREE.Material; nearWalkMat: THREE.Material; groundMat: THREE.Material;
}
const bGeo = box(1, 1, 1); bGeo.translate(0, 0.5, 0);
const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 2, 8); trunkGeo.translate(0, 1, 0);
const leafGeo = sph(1.5, 12, 10); leafGeo.translate(0, 3.2, 0);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function makeStreet(isArm: boolean): Street {
  const g = new THREE.Group();
  world.add(g);
  const lift = isArm ? 0.02 : 0;
  const roadTex = canvasTex(256, 256, drawRoad, 1, ROAD_LEN / 20);
  const walkTex = canvasTex(64, 64, drawWalk, 2, ROAD_LEN / 5);
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, ROAD_LEN), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, lift, 0);
  road.receiveShadow = true;
  g.add(road);
  const walkMat = new THREE.MeshLambertMaterial({ map: walkTex });
  const nearWalkMat = new THREE.MeshLambertMaterial({ map: walkTex, clipIntersection: true });
  const curbMat = new THREE.MeshToonMaterial({ color: 0xf4f7fb, gradientMap: ramp });
  const nearCurbMat = new THREE.MeshToonMaterial({ color: 0xf4f7fb, gradientMap: ramp, clipIntersection: true });
  for (const s of [-1, 1]) {
    const near = isArm && s === 1;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(WALK, ROAD_LEN), near ? nearWalkMat : walkMat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(s * (ROAD_HALF + WALK / 2), 0.15 + lift, 0);
    w.receiveShadow = true;
    g.add(w);
    const curb = new THREE.Mesh(box(0.5, 0.3, ROAD_LEN), near ? nearCurbMat : curbMat);
    curb.position.set(s * (ROAD_HALF + 0.25), 0.15 + lift, 0);
    g.add(curb);
  }
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x8fd16a });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, ROAD_LEN), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05 - lift * 2, 0);
  g.add(ground);
  const bld = new THREE.InstancedMesh(bGeo, new THREE.MeshToonMaterial({ map: winTex, gradientMap: ramp }), BUILD_N);
  bld.castShadow = true; bld.receiveShadow = true;
  bld.frustumCulled = false;
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x8a5a33), PROP_N);
  const leaves = new THREE.InstancedMesh(leafGeo, mat(0xffffff), PROP_N);
  trunks.castShadow = leaves.castShadow = true;
  trunks.frustumCulled = leaves.frustumCulled = false;
  g.add(bld, trunks, leaves);
  const blds: Bld[] = [], props: Prop[] = [];
  for (let i = 0; i < BUILD_N; i++) blds.push({ side: i < BUILD_N / 2 ? -1 : 1, x: 0, z: 0, w: 0, d: 0, h: 0, col: 0, hide: false, crushed: false });
  for (let i = 0; i < PROP_N; i++) props.push({ side: i % 2 ? 1 : -1, x: 0, z: 0, s: 1, hide: false });
  for (let i = 0; i < PROP_N; i++) leaves.setColorAt(i, new THREE.Color(pick([0x5ccf5c, 0x7be07b, 0x4cbf6a, 0x9be564])));
  return { g, roadTex, walkTex, bld, trunks, leaves, blds, props, roadMat, walkMat: walkMat, nearWalkMat, groundMat };
}
function placeBld(b: Bld, zEdge: number) {
  b.w = rand(7, 12); b.d = rand(7, 12); b.h = rand(10, 42);
  b.z = zEdge - b.d / 2;
  b.x = b.side * (ROAD_HALF + WALK + 0.5 + b.w / 2 + rand(0, 2));
  b.col = pick(BCOL);
  b.hide = false; b.crushed = false;
}
function layout(st: Street, zStart: number) {
  for (const side of [-1, 1]) {
    let z = zStart;
    for (const b of st.blds) if (b.side === side) { placeBld(b, z); z = b.z - b.d / 2 - rand(1, 4); }
  }
  let k = 0;
  for (const p of st.props) { p.x = p.side * (ROAD_HALF + 2.5); p.z = zStart - Math.floor(k++ / 2) * 18 - 4; p.s = rand(0.8, 1.2); p.hide = false; }
  colorBlds(st);
}
function colorBlds(st: Street) {
  const c = new THREE.Color();
  st.blds.forEach((b, i) => st.bld.setColorAt(i, c.set(b.col)));
  if (st.bld.instanceColor) st.bld.instanceColor.needsUpdate = true;
}
function farEdge(st: Street, side: number) {
  let m = 1e9;
  for (const b of st.blds) if (b.side === side) m = Math.min(m, b.z - b.d / 2);
  return m;
}
function drawStreet(st: Street) {
  for (let i = 0; i < st.blds.length; i++) {
    const b = st.blds[i];
    if (b.hide) { st.bld.setMatrixAt(i, ZERO); continue; }
    tmpM.compose(tmpV.set(b.x, 0, b.z), tmpQ.identity(), tmpS.set(b.w, b.crushed ? 1.5 : b.h, b.d));
    st.bld.setMatrixAt(i, tmpM);
  }
  st.bld.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < st.props.length; i++) {
    const p = st.props[i];
    if (p.hide) { st.trunks.setMatrixAt(i, ZERO); st.leaves.setMatrixAt(i, ZERO); continue; }
    tmpM.compose(tmpV.set(p.x, 0.15, p.z), tmpQ.identity(), tmpS.set(p.s, p.s, p.s));
    st.trunks.setMatrixAt(i, tmpM);
    st.leaves.setMatrixAt(i, tmpM);
  }
  st.trunks.instanceMatrix.needsUpdate = st.leaves.instanceMatrix.needsUpdate = true;
}

const main = makeStreet(false);
const arm = makeStreet(true);
arm.g.visible = false;
layout(main, 40);

// Junction state: world z of the cross street's centre, or null.
let junctionZ: number | null = null;
let turning = 0, turnDir = 0;
const JN_END = ROAD_HALF + WALK; // half-width of the cross street incl. sidewalks
// Clipping planes in world-group space, applied in world space each frame.
const clipRoadL = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6);
const clipWalkL = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6);
const clipRoad = new THREE.Plane(), clipWalk = new THREE.Plane();
const gapA = new THREE.Plane(), gapB = new THREE.Plane();
const gapAL = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(ROAD_HALF + WALK));
const gapBL = new THREE.Plane(new THREE.Vector3(0, 0, -1), -(ROAD_HALF + WALK));
main.roadMat.clippingPlanes = [clipRoad];
main.groundMat.clippingPlanes = [clipRoad];
main.walkMat.clippingPlanes = [clipWalk];
main.g.traverse((o) => {
  const m = (o as THREE.Mesh).material as THREE.Material | undefined;
  if (m && (o as THREE.Mesh).geometry?.type === "BoxGeometry" && o !== main.bld) m.clippingPlanes = [clipWalk];
});
arm.nearWalkMat.clippingPlanes = [gapA, gapB];
arm.g.traverse((o) => {
  const m = (o as THREE.Mesh).material as THREE.Material & { clipIntersection?: boolean };
  if (m && m.clipIntersection) m.clippingPlanes = [gapA, gapB];
});
function updateClips() {
  world.updateMatrixWorld();
  if (junctionZ === null) { clipRoadL.constant = 1e6; clipWalkL.constant = 1e6; }
  else { clipRoadL.constant = -(junctionZ - ROAD_HALF); clipWalkL.constant = -(junctionZ + ROAD_HALF); }
  clipRoad.copy(clipRoadL).applyMatrix4(world.matrixWorld);
  clipWalk.copy(clipWalkL).applyMatrix4(world.matrixWorld);
  gapA.copy(gapAL).applyMatrix4(arm.g.matrixWorld);
  gapB.copy(gapBL).applyMatrix4(arm.g.matrixWorld);
}

// Junction decorations: signs and road arrows
const deco = new THREE.Group();
world.add(deco);
deco.visible = false;
function signTex(text: string, bg: string, arrow: "l" | "r") {
  return canvasTex(512, 192, (g) => {
    g.fillStyle = bg; g.beginPath(); g.roundRect(6, 6, 500, 180, 36); g.fill();
    g.lineWidth = 10; g.strokeStyle = "#ffffff"; g.stroke();
    g.fillStyle = "#fff"; g.font = "900 64px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(arrow === "l" ? "◀ " + text : text + " ▶", 256, 96);
  }, 1, 1);
}
const signL = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: signTex("FEAST", "#2e9e4f", "l") }));
const signR = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: signTex("TANKS x2", "#d64545", "r") }));
signL.position.set(-4.2, 7.5, -(JN_END + 1));
signR.position.set(4.2, 7.5, -(JN_END + 1));
deco.add(signL, signR);
for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.2, 0.2, 7, 8), mat(0x546e7a), s * 4.2, 3.5, -(JN_END + 1.2), deco);
const arrowTex = canvasTex(128, 128, (g) => {
  g.fillStyle = "#ffffff"; g.beginPath();
  g.moveTo(64, 8); g.lineTo(120, 64); g.lineTo(84, 64); g.lineTo(84, 120); g.lineTo(44, 120); g.lineTo(44, 64); g.lineTo(8, 64); g.closePath(); g.fill();
}, 1, 1);
for (const s of [-1, 1]) {
  const a = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, opacity: 0.85 }));
  a.rotation.set(-Math.PI / 2, 0, -s * Math.PI / 2);
  a.position.set(s * 4.5, 0.05, JN_END + 18);
  deco.add(a);
}

function scrollStreet(dz: number) {
  main.roadTex.offset.y += dz / 20;
  main.walkTex.offset.y += dz / 5;
  const cut = junctionZ === null ? -1e9 : junctionZ + JN_END + 14;
  for (const side of [-1, 1]) {
    let fe = farEdge(main, side);
    for (const b of main.blds) {
      if (b.side !== side) continue;
      b.z += dz;
      if (b.z - b.d / 2 > 50) { placeBld(b, fe - rand(1, 4)); fe = b.z - b.d / 2; }
      if (b.z - b.d / 2 < cut) b.hide = true;
    }
  }
  colorBlds(main);
  for (const p of main.props) {
    p.z += dz;
    if (p.z > 40) { p.z -= (PROP_N / 2) * 18; p.hide = false; }
    if (p.z < cut) p.hide = true;
  }
  drawStreet(main);
  if (junctionZ !== null) { junctionZ += dz; arm.g.position.z = junctionZ; deco.position.z = junctionZ; }
}

// ------------------------------------------------------------------
// The hero: a chunky cartoon T-rex. Blue, orange belly and stripes, bandana.
// Faces -z, feet at y=0.
// ------------------------------------------------------------------
const BODY = 0x2fa8e6, BELLY = 0xffb35c, STRIPE = 0xff8a2b, SCARF = 0x9a5a2a;
const dino = new THREE.Group();
scene.add(dino);
const dRoot = new THREE.Group();
dino.add(dRoot);
const dSquash = new THREE.Group();
dRoot.add(dSquash);
// body + belly
ink(mesh(sph(0.6), mat(BODY), 0, 1.05, 0.12, dSquash)).scale.set(0.95, 0.95, 1.15);
mesh(sph(0.5), mat(BELLY), 0, 0.98, -0.2, dSquash).scale.set(0.82, 0.88, 0.62);
// stripes on the back
for (let i = 0; i < 4; i++) {
  const s = mesh(sph(0.5, 14, 6), mat(STRIPE), 0, 1.42 - i * 0.1, -0.05 + i * 0.27, dSquash);
  s.scale.set(0.95 - i * 0.12, 0.16, 0.22);
  s.rotation.x = -0.3 + i * 0.35;
}
// bandana
const scarf = mesh(new THREE.TorusGeometry(0.36, 0.09, 8, 20), mat(SCARF), 0, 1.45, -0.32, dSquash);
scarf.rotation.x = Math.PI / 2 - 0.35;
const knot = mesh(new THREE.ConeGeometry(0.22, 0.4, 3), mat(SCARF), 0, 1.25, -0.6, dSquash);
knot.rotation.x = Math.PI; knot.scale.z = 0.4;
// head
const head = new THREE.Group(); head.position.set(0, 1.62, -0.38); dSquash.add(head);
ink(mesh(sph(0.48), mat(BODY), 0, 0.22, -0.05, head)).scale.set(1, 0.9, 1.05);
ink(mesh(sph(0.36), mat(BODY), 0, 0.14, -0.52, head)).scale.set(1.05, 0.72, 1.15);
mesh(sph(0.04), glow(0x15233a), -0.12, 0.28, -0.9, head);
mesh(sph(0.04), glow(0x15233a), 0.12, 0.28, -0.9, head);
// brow ridge stripes
for (const s of [-1, 1]) {
  const st = mesh(box(0.08, 0.05, 0.3), mat(STRIPE), s * 0.22, 0.6, -0.2, head);
  st.rotation.y = s * 0.3;
}
// eyes: big, round, brown iris, sparkle
for (const s of [-1, 1]) {
  ink(mesh(sph(0.17), glow(0xffffff), s * 0.24, 0.42, -0.36, head), 1.12).scale.set(0.9, 1.05, 0.7);
  mesh(sph(0.1), glow(0x7a3d12), s * 0.25, 0.42, -0.47, head).scale.set(0.9, 1.1, 0.5);
  mesh(sph(0.055), glow(0x1a0f08), s * 0.25, 0.42, -0.52, head).scale.set(0.9, 1.1, 0.5);
  mesh(sph(0.03), glow(0xffffff), s * 0.22, 0.47, -0.55, head);
  mesh(sph(0.07), glow(0xff9aa2), s * 0.36, 0.14, -0.58, head).scale.set(1, 0.55, 0.4); // cheeks
}
// jaw with a toothy grin
const jaw = new THREE.Group(); jaw.position.set(0, 0.02, -0.15); head.add(jaw);
ink(mesh(sph(0.32), mat(BELLY), 0, -0.08, -0.38, jaw)).scale.set(1.0, 0.42, 1.05);
const toothGeo = new THREE.ConeGeometry(0.045, 0.11, 6);
for (const x of [-0.24, -0.12, 0.12, 0.24]) {
  const t = mesh(toothGeo, glow(0xffffff), x, -0.01, -0.62 + Math.abs(x) * 0.6, head);
  t.rotation.x = Math.PI; t.castShadow = false;
}
// legs with chunky feet and claws
const legs: THREE.Group[] = [];
for (const s of [-1, 1]) {
  const l = new THREE.Group(); l.position.set(s * 0.36, 0.82, 0.15); dSquash.add(l);
  ink(mesh(sph(0.32), mat(BODY), 0, -0.2, 0, l)).scale.set(0.9, 1.15, 1.05);
  ink(mesh(sph(0.22), mat(BELLY), 0, -0.68, -0.12, l)).scale.set(1, 0.55, 1.45);
  for (const c of [-0.1, 0, 0.1]) {
    const cl = mesh(new THREE.ConeGeometry(0.04, 0.12, 5), glow(0x2b2b33), c, -0.7, -0.44, l);
    cl.rotation.x = -Math.PI / 2;
  }
  legs.push(l);
  const arm2 = new THREE.Group(); arm2.position.set(s * 0.42, 1.22, -0.45); dSquash.add(arm2);
  const a = ink(mesh(new THREE.CapsuleGeometry(0.07, 0.18, 4, 8), mat(BODY), 0, -0.1, -0.05, arm2));
  a.rotation.x = -0.9;
  mesh(sph(0.08), mat(BELLY), 0, -0.2, -0.16, arm2);
}
// tail: chunky spheres with orange stripes
const tail: THREE.Group[] = [];
{
  let parent: THREE.Object3D = dSquash;
  const segs = [0.36, 0.28, 0.2, 0.13];
  let pos = new THREE.Vector3(0, 1.0, 0.72);
  for (const r of segs) {
    const g = new THREE.Group(); g.position.copy(pos); parent.add(g);
    ink(mesh(sph(r), mat(BODY), 0, 0, r * 0.6, g)).scale.set(1, 0.95, 1.3);
    const st = mesh(sph(r, 12, 6), mat(STRIPE), 0, r * 0.55, r * 0.6, g);
    st.scale.set(0.9, 0.5, 0.45);
    tail.push(g);
    parent = g; pos = new THREE.Vector3(0, 0.03, r * 1.35);
  }
}
const bang = new THREE.Sprite(new THREE.SpriteMaterial({
  map: canvasTex(128, 128, (g) => {
    g.fillStyle = "#ff3030"; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 8; g.stroke();
    g.fillStyle = "#fff"; g.font = "900 96px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("!", 64, 70);
  }, 1, 1), depthTest: false,
}));
bang.position.set(0, 2.7, -0.2);
bang.scale.setScalar(0.9);
bang.visible = false;
dino.add(bang);
const dinoMeshes: THREE.Mesh[] = [];
dino.traverse((o) => { if ((o as THREE.Mesh).isMesh) dinoMeshes.push(o as THREE.Mesh); });

// ------------------------------------------------------------------
// Zombies (instanced, rounded)
// ------------------------------------------------------------------
const legG = new THREE.CapsuleGeometry(0.1, 0.5, 4, 8); legG.translate(0, -0.35, 0);
const bodyG = new THREE.CapsuleGeometry(0.26, 0.28, 4, 10); bodyG.translate(0, 0.38, 0);
const headG = sph(0.27, 12, 10); headG.translate(0, 0.24, 0);
const armG = new THREE.CapsuleGeometry(0.075, 0.45, 4, 8); armG.translate(0, -0.3, 0);
const zeyeG = sph(0.07, 8, 6);
function zInst(geo: THREE.BufferGeometry, n: number, m?: THREE.Material) {
  const im = new THREE.InstancedMesh(geo, m ?? new THREE.MeshToonMaterial({ gradientMap: ramp }), n);
  im.castShadow = true;
  im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  world.add(im);
  return im;
}
const zLeg = zInst(legG, MAXZ * 2), zBody = zInst(bodyG, MAXZ), zHead = zInst(headG, MAXZ), zArm = zInst(armG, MAXZ * 2);
const zEye = zInst(zeyeG, MAXZ * 2, glow(0xfffbe0));
zEye.castShadow = false;
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
function hideZombie(i: number) {
  zs[i].on = false;
  zBody.setMatrixAt(i, ZERO); zHead.setMatrixAt(i, ZERO);
  for (const k of [0, 1]) { zArm.setMatrixAt(i * 2 + k, ZERO); zLeg.setMatrixAt(i * 2 + k, ZERO); zEye.setMatrixAt(i * 2 + k, ZERO); }
}
for (let i = 0; i < MAXZ; i++) {
  zs.push({ on: false, st: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, ph: 0, spd: 1, t: 0 });
  const skin = new THREE.Color(pick(SKIN)), pants = new THREE.Color(pick(PANTS));
  zBody.setColorAt(i, new THREE.Color(pick(SHIRT)));
  zHead.setColorAt(i, skin);
  for (const k of [0, 1]) { zArm.setColorAt(i * 2 + k, skin); zLeg.setColorAt(i * 2 + k, pants); }
  hideZombie(i);
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
    setPart(zBody, i, 0, 0.62, 0, 0.12, 0, sw * 0.08);
    const hx = 0.15, hz = 0.25 * Math.sin(z.ph) + sw * 0.1;
    setPart(zHead, i, 0, 1.36, 0.04, hx, 0, hz);
    const ar = z.st === 1 ? -2.8 : -1.45;
    setPart(zArm, i * 2, -0.33, 1.25, 0, ar + sw * 0.25, 0, 0.05);
    setPart(zArm, i * 2 + 1, 0.33, 1.25, 0, ar - sw * 0.25, 0, -0.05);
    // eyes ride on the head
    part.makeTranslation(0, 1.36, 0.04);
    rot.makeRotationFromEuler(tmpE.set(hx, 0, hz));
    part.multiply(rot).premultiply(base);
    for (const k of [0, 1]) {
      tmpM.makeTranslation(k ? 0.1 : -0.1, 0.3, 0.23).premultiply(part);
      zEye.setMatrixAt(i * 2 + k, tmpM);
    }
  }
  zLeg.instanceMatrix.needsUpdate = zBody.instanceMatrix.needsUpdate = zHead.instanceMatrix.needsUpdate = true;
  zArm.instanceMatrix.needsUpdate = zEye.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------
// Golden eggs (collectibles)
// ------------------------------------------------------------------
const eggGeo = sph(0.6, 16, 12); eggGeo.scale(0.8, 1.05, 0.8);
const eggMesh = new THREE.InstancedMesh(eggGeo, new THREE.MeshToonMaterial({ color: 0xffc21a, emissive: 0x8a5200, gradientMap: ramp }), MAXEGG);
eggMesh.castShadow = true;
eggMesh.frustumCulled = false;
world.add(eggMesh);
interface Egg { on: boolean; x: number; z: number; t: number; }
const eggs: Egg[] = [];
for (let i = 0; i < MAXEGG; i++) { eggs.push({ on: false, x: 0, z: 0, t: 0 }); eggMesh.setMatrixAt(i, ZERO); }
function spawnEggLine(x0: number, z0: number, x1: number, n: number) {
  for (let k = 0; k < n; k++) {
    const e = eggs.find((q) => !q.on);
    if (!e) return;
    Object.assign(e, { on: true, x: x0 + ((x1 - x0) * k) / Math.max(1, n - 1), z: z0 - k * 3.2, t: k * 0.4 });
  }
}

// ------------------------------------------------------------------
// Particles (goo, debris, sparkles)
// ------------------------------------------------------------------
const pMesh = new THREE.InstancedMesh(box(1, 1, 1), new THREE.MeshLambertMaterial(), MAXP);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pMesh.frustumCulled = false;
world.add(pMesh);
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
function clearParticles() { for (let i = 0; i < MAXP; i++) { ps[i].on = false; pMesh.setMatrixAt(i, ZERO); } }

// ------------------------------------------------------------------
// Obstacles: snacks or walls, depending on your size
// ------------------------------------------------------------------
type OType = "barrier" | "car" | "van" | "bus" | "tank" | "tanker" | "raptor" | "zrex";
interface Obs {
  type: OType; w: number; hw: number; hd: number; h: number; g: THREE.Group; ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial;
  x: number; z: number; on: boolean; st: number; chaser: boolean; fireT: number;
  vx: number; vz: number; vy: number; y: number; spin: THREE.Vector3; t: number; legs?: THREE.Group[]; jaw?: THREE.Group; turret?: THREE.Group; sc: number;
}
const WHEEL = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12); WHEEL.rotateZ(Math.PI / 2);
const GLASS = 0x9fd8ff;
function wheels(g: THREE.Group, hw: number, zz: number[], y = 0.42) {
  for (const z of zz) for (const s of [-1, 1]) mesh(WHEEL, mat(0x222222), s * hw, y, z, g);
}
function buildCar(): THREE.Group {
  const g = new THREE.Group();
  const c = pick([0xff5d73, 0x4cc9f0, 0xffd166, 0x06d6a0, 0xf8f9fa, 0x9b5de5]);
  mesh(new THREE.CapsuleGeometry(0.42, 3.0, 4, 10).rotateX(Math.PI / 2).scale(2.3, 0.95, 1), mat(c), 0, 0.75, 0, g);
  mesh(sph(0.9, 12, 8).scale(0.95, 0.6, 1.1), mat(c), 0, 1.25, 0.2, g);
  mesh(sph(0.9, 12, 8).scale(0.97, 0.5, 1.0), mat(GLASS), 0, 1.3, 0.2, g);
  for (const s of [-1, 1]) mesh(sph(0.15), glow(0xfff6c0), s * 0.65, 0.8, 1.85, g);
  wheels(g, 0.95, [-1.2, 1.2]);
  return g;
}
function buildVan(): THREE.Group {
  const g = new THREE.Group();
  mesh(box(2.3, 2.1, 4.8), mat(0xffffff), 0, 1.45, 0, g);
  mesh(box(2.32, 0.35, 4.82), mat(0xe63946), 0, 1.3, 0, g);
  mesh(box(2.1, 0.7, 0.1), mat(GLASS), 0, 2.0, 2.41, g);
  mesh(sph(0.25), glow(0x4ea8ff), -0.4, 2.55, 1.6, g);
  mesh(sph(0.25), glow(0xff3b3b), 0.4, 2.55, 1.6, g);
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
function buildTank(): { g: THREE.Group; turret: THREE.Group } {
  const g = new THREE.Group();
  mesh(box(3.2, 1.0, 5.4), mat(0x6b8e23), 0, 0.9, 0, g);
  for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.45, 4.9, 4, 8).rotateX(Math.PI / 2), mat(0x333333), s * 1.6, 0.48, 0, g);
  const turret = new THREE.Group(); turret.position.set(0, 1.5, -0.2); g.add(turret);
  mesh(sph(1.05, 14, 8).scale(1, 0.55, 1.1), mat(0x556b2f), 0, 0.2, 0, turret);
  const b = mesh(new THREE.CylinderGeometry(0.17, 0.17, 3.2, 8), mat(0x445522), 0, 0.3, 1.9, turret);
  b.rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 8).rotateX(Math.PI / 2), mat(0x333d18), 0, 0.3, 3.45, turret);
  return { g, turret };
}
function buildTanker(): THREE.Group {
  const g = new THREE.Group();
  mesh(box(2.6, 2.4, 2.6), mat(0xe63946), 0, 1.6, 4.4, g);
  mesh(box(2.3, 0.8, 0.06), mat(GLASS), 0, 2.2, 5.72, g);
  const t = mesh(new THREE.CapsuleGeometry(1.4, 5.4, 4, 16), mat(0xd8dde6), 0, 2.1, -1.2, g);
  t.rotation.x = Math.PI / 2;
  mesh(box(2.84, 0.5, 6.0), mat(0xff9f1c), 0, 2.1, -1.2, g);
  wheels(g, 1.2, [-4, -2.6, 4.2], 0.5);
  return g;
}
function buildBarrier(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) mesh(new THREE.CapsuleGeometry(0.25, 0.5, 4, 8), mat(i % 2 ? 0xffffff : 0xff6b1a), -0.9 + i * 0.6, 0.6, 0, g);
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
  mesh(sph(0.42).scale(0.8, 0.6, 1.1), mat(SK), 0, 0.15, 0.35, h);
  for (const s of [-1, 1]) mesh(sph(0.09), glow(0xff2222), s * 0.24, 0.32, 0.45, h);
  const jw = new THREE.Group(); jw.position.set(0, -0.05, 0.05); h.add(jw);
  mesh(sph(0.38).scale(0.75, 0.25, 1.1), mat(BONE), 0, -0.07, 0.35, jw);
  const tg = new THREE.ConeGeometry(0.045, 0.12, 4);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) mesh(tg, glow(0xffffff), s * 0.22, 0.06, 0.15 + i * 0.22, jw);
  const lg: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Group(); l.position.set(s * 0.34, 0.95, -0.1); r.add(l);
    mesh(sph(0.2).scale(0.8, 1.5, 1), mat(SK), 0, -0.25, 0, l);
    mesh(box(0.14, 0.5, 0.14), mat(BONE), 0, -0.65, 0, l);
    mesh(sph(0.2).scale(0.9, 0.4, 1.2), mat(SK), 0, -0.9, 0.1, l);
    lg.push(l);
  }
  const tl = mesh(new THREE.ConeGeometry(0.3, 1.6, 8), mat(SK), 0, 1.05, -1.3, r);
  tl.rotation.x = -Math.PI / 2 - 0.1;
  for (let i = 0; i < 5; i++) mesh(box(0.05, 0.25, 0.05), mat(BONE), 0, 1.55 - i * 0.04, -0.4 - i * 0.25, r);
  return { g, legs: lg, jaw: jw };
}
const SPEC: Record<OType, { w: number; hw: number; hd: number; h: number }> = {
  barrier: { w: 5, hw: 1.25, hd: 0.4, h: 1.1 },
  car: { w: 18, hw: 1.0, hd: 1.9, h: 1.8 },
  raptor: { w: 32, hw: 0.7, hd: 1.4, h: 2.1 },
  van: { w: 45, hw: 1.15, hd: 2.4, h: 2.7 },
  bus: { w: 90, hw: 1.35, hd: 4.75, h: 3.3 },
  tank: { w: 160, hw: 1.9, hd: 2.9, h: 2.3 },
  tanker: { w: 260, hw: 1.4, hd: 5.6, h: 3.5 },
  zrex: { w: 200, hw: 1.6, hd: 3.6, h: 5.7 },
};
const ringGeo = new THREE.RingGeometry(0.86, 1, 40); ringGeo.rotateX(-Math.PI / 2);
const obs: Obs[] = [];
function spawnObs(type: OType, x: number, z: number, w?: number, chaser = false) {
  let o = obs.find((q) => !q.on && q.type === type && type !== "zrex");
  if (!o) {
    let g: THREE.Group, legsArr: THREE.Group[] | undefined, jw: THREE.Group | undefined, turret: THREE.Group | undefined;
    if (type === "raptor" || type === "zrex") {
      const d = buildZDino(type === "raptor" ? 1.1 : 2.6); g = d.g; legsArr = d.legs; jw = d.jaw;
    } else if (type === "tank") { const t = buildTank(); g = t.g; turret = t.turret; }
    else g = ({ barrier: buildBarrier, car: buildCar, van: buildVan, bus: buildBus, tanker: buildTanker } as Record<string, () => THREE.Group>)[type]();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 1;
    world.add(g, ring);
    o = { type, ...SPEC[type], g, ring, ringMat, x: 0, z: 0, on: false, st: 0, chaser: false, fireT: 0, vx: 0, vz: 0, vy: 0, y: 0, spin: new THREE.Vector3(), t: 0, legs: legsArr, jaw: jw, turret, sc: 1 };
    obs.push(o);
  }
  Object.assign(o, { on: true, st: 0, x, z, y: 0, vx: 0, vz: 0, vy: 0, t: rand(0, 6), chaser, fireT: rand(0.8, 2) });
  o.w = w ?? SPEC[type].w;
  o.sc = type === "zrex" ? clamp(1 + (o.w - 200) / 600, 1, 2.2) : 1;
  o.g.scale.setScalar(o.sc);
  const facesPlayer = type === "raptor" || type === "zrex" || type === "tank";
  o.g.rotation.set(0, chaser ? Math.PI : facesPlayer ? 0 : (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.08, 0.08), 0);
  o.g.visible = true;
  o.ring.visible = !chaser;
  o.ring.scale.set(o.hw * o.sc * 1.3 + 0.4, 1, o.hd * o.sc * 1.2 + 0.4);
  return o;
}
function killObs(o: Obs) { o.on = false; o.g.visible = o.ring.visible = false; }

// ------------------------------------------------------------------
// Tank shells: a red target ring shows where each one will land.
// ------------------------------------------------------------------
interface Shell { on: boolean; sx: number; sy: number; sz: number; tx: number; tz: number; t: number; T: number; behind: boolean; m: THREE.Mesh; ring: THREE.Mesh; dot: THREE.Mesh; }
const shells: Shell[] = [];
const shellGeo = sph(0.35, 10, 8);
const tgtRing = new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2);
const tgtDot = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
function fireShell(sx: number, sy: number, sz: number, behind: boolean) {
  let s = shells.find((q) => !q.on);
  if (!s) {
    const m = mesh(shellGeo, glow(0x222222), 0, 0, 0, world);
    m.add(new THREE.Mesh(sph(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2b, transparent: true, opacity: 0.4, depthWrite: false })));
    const ring = new THREE.Mesh(tgtRing, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, depthWrite: false }));
    const dot = new THREE.Mesh(tgtDot, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.renderOrder = dot.renderOrder = 2;
    world.add(ring, dot);
    s = { on: false, sx: 0, sy: 0, sz: 0, tx: 0, tz: 0, t: 0, T: 1, behind, m, ring, dot };
    shells.push(s);
  }
  const T = behind ? 1.7 : 1.45;
  Object.assign(s, { on: true, sx, sy, sz, tx: clamp(px + rand(-0.5, 0.5), -ROAD_HALF + 1, ROAD_HALF - 1), tz: -speed * T, t: 0, T, behind });
  s.m.visible = s.ring.visible = s.dot.visible = true;
  sfx.whistle();
  burst(sx, sy, sz, 6, [0xffffff, 0xcccccc, 0xff8a2b], 0.4, 3);
}
function clearShells() { for (const s of shells) { s.on = false; s.m.visible = s.ring.visible = s.dot.visible = false; } }

// ------------------------------------------------------------------
// Game state
// ------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const sfx = new Sfx();
let state: "start" | "play" | "over" = "start";
let paused = false;
let mass = START_MASS, scale = 1, stage = 0, px = 0, pxTarget = 0, speed = 12;
let dist = 0, nextBeat = 30, runT = 0, points = 0, kills = 0, peak = START_MASS, peakStage = 0, eggCount = 0, eggChain = 0, eggChainT = 0;
let combo = 0, comboT = 0, roarCharge = 0, invuln = 0, stun = 0, chomp = 0, shake = 0, stepPh = 0, roarT = 0, warnT = 0;
let dinoY = 0, dinoVY = 0, squash = 0;
let best = 0, bossT = 40, finalScore = 0, nextJunction = 500;
let streetKind: "normal" | "feast" | "tanks" = "normal";
const ROAR_MAX = 30;
const mult = () => (streetKind === "tanks" ? 2 : 1);

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

function clearWorld() {
  for (let i = 0; i < MAXZ; i++) if (zs[i].on) hideZombie(i);
  for (const o of obs) killObs(o);
  for (const e of eggs) e.on = false;
  clearShells();
  clearParticles();
}

function reset() {
  clearWorld();
  junctionZ = null; turning = 0; arm.g.visible = false; deco.visible = false; world.rotation.y = 0;
  layout(main, 40);
  mass = START_MASS; stage = 0; scale = scaleFor(mass); px = pxTarget = 0;
  dist = 0; nextBeat = 25; runT = 0; points = 0; kills = 0; peak = mass; peakStage = 0; eggCount = 0;
  combo = 0; comboT = 0; roarCharge = 0; invuln = 0; stun = 0; bossT = 45; dinoY = 0; dinoVY = 0;
  streetKind = "normal"; nextJunction = 520;
}

function startRun() {
  reset();
  state = "play";
  $("start").classList.remove("show");
  $("over").classList.remove("show");
  sfx.unlock();
  sfx.click();
  for (let i = 0; i < 4; i++) spawnHorde(rand(-5, 5), -30 - i * 18, 6);
  spawnEggLine(-3, -20, 3, 6);
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
  $("stats").innerHTML = `${kills} zombies stomped · ${eggCount} golden eggs<br>Peak size ${Math.round(peak)} tons (${STAGES[peakStage].name.toLowerCase()})<br>${Math.floor(dist)} m run`;
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
const spawnZ = () => -(120 + scale * 25);
function beat() {
  const z = spawnZ();
  const lanes = [-6.5, -2.2, 2.2, 6.5];
  const early = runT < 7;
  const hordeN = Math.round(clamp(5 + Math.random() * 6 + mass * 0.11, 5, 46) * (streetKind === "feast" ? 1.4 : 1));
  const hordeP = streetKind === "feast" ? 0.7 : streetKind === "tanks" ? 0.3 : 0.42;
  if (Math.random() < 0.35) { const x = rand(-6, 6); spawnEggLine(x, z + 12, clamp(x + rand(-5, 5), -7, 7), 5); }
  if (early || Math.random() < hordeP) {
    spawnHorde(rand(-ROAD_HALF + 3, ROAD_HALF - 3), z, hordeN);
    if (!early && Math.random() < 0.4) spawnHorde(rand(-ROAD_HALF + 3, ROAD_HALF - 3), z - 10, Math.round(hordeN * 0.6));
    return;
  }
  const free = [...lanes].sort(() => Math.random() - 0.5);
  if (streetKind === "tanks" && Math.random() < 0.65) {
    spawnObs("tank", free.pop()!, z + rand(-3, 3));
    if (free.length) spawnHorde(free.pop()!, z - 4, Math.round(hordeN * 0.7));
    return;
  }
  const snacks = SNACKS.filter((t) => SPEC[t].w <= mass * 0.95);
  const blockers = SNACKS.filter((t) => SPEC[t].w > mass * 1.05 && SPEC[t].w < mass * 4 + 20);
  const nBlock = runT < 15 || streetKind === "feast" ? 1 : Math.min(2, 1 + (Math.random() < 0.35 ? 1 : 0));
  bossT -= 1;
  if (stage >= 1 && bossT <= 0) {
    bossT = Math.max(3, Math.round(10 - runT / 20)) + Math.floor(Math.random() * 4);
    spawnObs("zrex", free.pop()!, z, Math.round(mass * 1.35 + 40));
    banner("ZOMBIE REX!", true);
    spawnHorde(free.pop()!, z + 8, hordeN);
    return;
  }
  if (blockers.length) for (let i = 0; i < nBlock; i++) spawnObs(pick(blockers), free.pop()!, z + rand(-3, 3));
  if (!blockers.length || (runT > 60 && Math.random() < 0.3)) spawnObs("zrex", free.pop()!, z, Math.round(mass * rand(1.15, 1.6) + 30));
  if (runT > 12 && free.length && Math.random() < 0.3) spawnObs("raptor", free.pop()!, z - 6);
  if (snacks.length && free.length) {
    const t = snacks.length > 2 && Math.random() < 0.7 ? snacks[snacks.length - 1 - Math.floor(Math.random() * 2)] : pick(snacks);
    spawnObs(t, free.pop()!, z + rand(-4, 4));
  }
  if (free.length) spawnHorde(free.pop()!, z - 4, Math.round(hordeN * 0.7));
}

// --- Junctions ------------------------------------------------------
function startJunction() {
  const f = scene.fog as THREE.Fog;
  junctionZ = -(f.far + 40);
  layout(arm, 290);
  // keep the opening where our street enters the cross street clear
  for (const b of arm.blds) if (b.side === 1 && Math.abs(b.z) < ROAD_HALF + WALK + b.d / 2 + 0.5) b.hide = true;
  for (const p of arm.props) if (p.side === 1 && Math.abs(p.z) < ROAD_HALF + WALK + 1) p.hide = true;
  drawStreet(arm);
  arm.g.position.set(0, 0, junctionZ);
  arm.g.rotation.y = -Math.PI / 2;
  arm.g.visible = true;
  deco.position.set(0, 0, junctionZ);
  deco.visible = true;
}
function beginTurn() {
  turnDir = px < 0 ? -1 : 1;
  turning = 0.0001;
  sfx.turn();
}
function finishTurn() {
  // Bake the cross street into the main street.
  const flip = turnDir < 0;
  for (let i = 0; i < BUILD_N; i++) {
    const a = arm.blds[i], b = main.blds[i];
    Object.assign(b, a);
    if (flip) { b.x = -a.x; b.z = -a.z; b.side = -a.side; }
  }
  // keep the side arrays consistent: sort main by side for farEdge (side is a field, so order doesn't matter)
  for (let i = 0; i < PROP_N; i++) {
    const a = arm.props[i], p = main.props[i];
    Object.assign(p, a);
    if (flip) { p.x = -a.x; p.z = -a.z; p.side = -a.side; }
  }
  colorBlds(main);
  main.roadTex.offset.y = 0; main.walkTex.offset.y = 0;
  world.rotation.y = 0;
  junctionZ = null;
  arm.g.visible = false;
  deco.visible = false;
  turning = 0;
  clearWorld();
  streetKind = turnDir < 0 ? "feast" : "tanks";
  banner(streetKind === "feast" ? "ZOMBIE FEAST!" : "TANK ALLEY x2!", streetKind === "tanks");
  nextBeat = dist + 6;
  nextJunction = dist + speed * rand(26, 34);
  if (streetKind === "tanks") spawnObs("tank", 0, 20, 99999, true);
  spawnEggLine(0, -14, 0, 6);
}

// --- Effects --------------------------------------------------------
function flingZombie(z: Zombie, power: number, fromX = px, fromZ = 0) {
  z.st = 1;
  z.vx = (z.x - fromX) * 2 + rand(-4, 4);
  z.vy = rand(7, 13) + power * 2;
  z.vz = fromZ === 0 ? -speed * rand(0.4, 1.0) - rand(0, 6) * power : (z.z - fromZ) * 2 + rand(-3, 3);
  z.sx = rand(-8, 8); z.sy = rand(-6, 6); z.sz = rand(-8, 8);
  burst(z.x, 1, z.z, 5, [0x9cff57, 0x6bd12a, 0xd0ff8a], 0.25, 6);
}
function eatZombie(z: Zombie, power: number) {
  flingZombie(z, power);
  mass += 1; kills++; combo++; comboT = 1.2; roarCharge = Math.min(ROAR_MAX, roarCharge + 1);
  points += 10 * (1 + Math.min(4, Math.floor(combo / 15))) * mult();
  sfx.splat(combo); chomp = 1;
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
function hurt(frac: number, why: string, label: string) {
  if (invuln > 0) return;
  const lost = mass * frac + 2;
  mass -= lost;
  stun = 0.8; invuln = 1.6; shake = 1.4;
  sfx.crash();
  burst(px, 1.5 * scale + dinoY, -0.5, 14, [BODY, BELLY], 0.3 * scale, 7);
  if (mass < DEAD_MASS) endRun(why);
  else banner(`${label} -${Math.round(lost)}`, true);
}

function doRoar() {
  if (state !== "play" || roarCharge < ROAR_MAX) return;
  roarCharge = 0;
  roarT = 1;
  sfx.roar();
  shake = 1.2;
  banner("ROAAAR!");
  const reach = 45 + scale * 10;
  for (const z of zs) if (z.on && z.st === 0 && z.z < 3 && z.z > -reach) { flingZombie(z, 1.5); kills++; mass += 0.5; points += 10 * mult(); }
  for (const o of obs) if (o.on && o.st === 0 && (o.chaser || (o.z < 3 && o.z > -reach && o.w <= mass * 2))) { smashObs(o); if (!o.chaser) { mass += o.w * 0.25; points += Math.round(o.w * 4) * mult(); } }
  for (const s of shells) if (s.on) { burst(s.tx, 1, s.tz, 8, 0xffd166, 0.4, 5); s.on = false; s.m.visible = s.ring.visible = s.dot.visible = false; }
  shock.visible = true;
}
const shockMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthWrite: false });
const shock = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), shockMat);
shock.visible = false;
scene.add(shock);
const poundMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
const pound = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40).rotateX(-Math.PI / 2), poundMat);
pound.visible = false;
scene.add(pound);
let poundT = 0, poundR = 1;

function jump() {
  if (state !== "play" || dinoY > 0.01 || turning) return;
  dinoVY = Math.sqrt(2 * G * (1.9 + 1.0 * scale));
  squash = -0.25;
  sfx.jump();
}
function land() {
  dinoY = 0; dinoVY = 0;
  squash = 0.35;
  const R = 2.2 + 1.3 * scale;
  let n = 0;
  for (const z of zs) if (z.on && z.st === 0 && Math.hypot(z.x - px, z.z) < R) { eatZombie(z, scale * 0.5); n++; }
  for (const o of obs) if (o.on && o.st === 0 && !o.chaser && o.w <= mass && Math.hypot(o.x - px, o.z) < R * 0.8 + o.hd) {
    smashObs(o); mass += o.w * 0.3; points += Math.round(o.w * 5) * mult();
  }
  shake = Math.max(shake, 0.35 + 0.08 * scale + n * 0.03);
  sfx.land(Math.min(1, n / 10));
  burst(px, 0.3, 0, 12, [0xdfe7f2, 0xc9b8a0], 0.3 * scale, 6);
  poundT = 1; poundR = R; pound.visible = true;
  if (n >= 5) banner(`STOMP x${n}!`);
}

// --- Input ----------------------------------------------------------
let dragging = false, lastX = 0, downX = 0, downY = 0, downT = 0;
const keys = new Set<string>();
window.addEventListener("pointerdown", (e) => {
  if ((e.target as HTMLElement).closest("button")) return;
  sfx.unlock();
  if (state === "start") { startRun(); return; }
  dragging = true; lastX = downX = e.clientX; downY = e.clientY; downT = performance.now();
});
window.addEventListener("pointermove", (e) => {
  if (!dragging || state !== "play") return;
  const dx = e.clientX - lastX; lastX = e.clientX;
  pxTarget = clamp(pxTarget + (dx / Math.min(window.innerWidth, 700)) * ROAD_HALF * 2.6, -ROAD_HALF, ROAD_HALF);
});
window.addEventListener("pointerup", (e) => {
  if (dragging && performance.now() - downT < 260 && Math.hypot(e.clientX - downX, e.clientY - downY) < 14) jump();
  dragging = false;
});
window.addEventListener("pointercancel", () => { dragging = false; });
window.addEventListener("keydown", (e) => {
  keys.add(e.key);
  if (e.key === " " || e.key === "ArrowUp" || e.key === "w") { if (state === "start") startRun(); else jump(); e.preventDefault(); }
  if (e.key === "r" || e.key === "Enter") doRoar();
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
    const hunger = runT < 3 || turning ? 0 : (0.45 + 0.025 * mass + 6 * (mass / 300) ** 2) * (1 + runT / 90);
    mass -= hunger * dt;
    peak = Math.max(peak, mass);
    const ns = stageOf(mass, stage);
    if (ns > stage) { banner(STAGES[ns].name + "!"); sfx.levelUp(); shake = Math.max(shake, 0.5); }
    else if (ns < stage) { banner("SHRUNK!", true); sfx.levelDown(); }
    stage = ns; peakStage = Math.max(peakStage, stage);
    if (mass < DEAD_MASS) endRun("Your dino starved. Keep eating!");
  }
  const sT = scaleFor(Math.max(mass, DEAD_MASS));
  scale += (sT - scale) * Math.min(1, dt * 3);

  // --- turning at a junction: the world swings round, scrolling pauses
  if (turning) {
    turning += dt / 0.55;
    const k = Math.min(1, turning);
    const e = k * k * (3 - 2 * k);
    world.rotation.y = turnDir * (Math.PI / 2) * e;
    pxTarget = px * (1 - k);
    if (k >= 1) finishTurn();
  }

  // --- speed & scroll
  stun = Math.max(0, stun - dt);
  invuln = Math.max(0, invuln - dt);
  const baseSpd = state === "start" ? 7 : state === "over" ? 0 : (13 + Math.min(14, runT * 0.1)) * (0.78 + 0.22 * scale);
  const want = baseSpd * (stun > 0 ? 0.35 : 1);
  speed += (want - speed) * Math.min(1, dt * (state === "over" ? 3 : 2));
  const dz = turning ? 0 : speed * dt;
  if (playing) dist += dz;
  scrollStreet(dz);
  if (playing && junctionZ !== null && junctionZ >= -0.5 && !turning) beginTurn();

  // --- steering
  if (playing && !turning) {
    const k = (keys.has("ArrowLeft") || keys.has("a") ? -1 : 0) + (keys.has("ArrowRight") || keys.has("d") ? 1 : 0);
    if (k) pxTarget = clamp(pxTarget + k * 16 * dt, -ROAD_HALF, ROAD_HALF);
  }
  const lim = ROAD_HALF - 0.45 * scale;
  pxTarget = clamp(pxTarget, -lim, lim);
  const prevX = px;
  px += (pxTarget - px) * Math.min(1, dt * 10);

  // --- jump
  if (dinoY > 0 || dinoVY > 0) {
    dinoVY -= G * dt;
    dinoY += dinoVY * dt;
    if (dinoY <= 0 && dinoVY < 0) land();
  }

  // --- beats and junctions
  const beforeJunction = junctionZ === null || spawnZ() > junctionZ + 40;
  if (playing && !turning && dist >= nextBeat && beforeJunction) { beat(); nextBeat = dist + 15 + 5 * scale + Math.max(0, 8 - runT * 0.3); }
  if (playing && junctionZ === null && !turning && dist >= nextJunction) startJunction();

  // --- zombies
  const reachX = 0.55 * scale + 0.3, front = -(0.95 * scale + 0.35), back = 0.6 * scale;
  const airborne = dinoY > 1.4;
  for (let i = 0; i < MAXZ; i++) {
    const z = zs[i];
    if (!z.on) continue;
    z.t += dt;
    if (z.st === 0) {
      z.z += dz + (turning ? 0 : z.spd * dt);
      if (z.z > -35) z.x += clamp(px - z.x, -1, 1) * 0.9 * dt;
      z.ry = clamp((px - z.x) * 0.05, -0.6, 0.6);
      z.rz = Math.sin(z.t * 3 + z.ph) * 0.08;
      if (playing && !airborne && Math.abs(z.x - px) < reachX && z.z > front && z.z < back) eatZombie(z, scale * 0.3);
      if (z.z > 40) hideZombie(i);
    } else if (z.st === 1) {
      z.vy -= 30 * dt;
      z.x += z.vx * dt; z.y += z.vy * dt; z.z += z.vz * dt + dz;
      z.rx += z.sx * dt; z.ry += z.sy * dt; z.rz += z.sz * dt;
      if (z.y <= 0 && z.vy < 0) {
        z.st = 2; z.y = 0.1; z.rx = -Math.PI / 2; z.rz = 0;
        burst(z.x, 0.2, z.z, 3, 0x6bd12a, 0.3, 3);
        if (Math.abs(z.x) > ROAD_HALF + 1) z.y = 0.25;
      }
      if (z.z > 40 || z.t > 6) hideZombie(i);
    } else {
      z.z += dz;
      if (z.z > 40) hideZombie(i);
    }
  }

  // --- eggs
  eggChainT -= dt;
  if (eggChainT <= 0) eggChain = 0;
  for (let i = 0; i < MAXEGG; i++) {
    const e = eggs[i];
    if (!e.on) { eggMesh.setMatrixAt(i, ZERO); continue; }
    e.t += dt;
    e.z += dz;
    const ey = 1.2 + Math.sin(e.t * 4) * 0.25;
    if (playing && Math.abs(e.x - px) < 0.7 + 0.5 * scale && Math.abs(e.z) < 0.8 + 0.6 * scale && Math.abs(ey - dinoY - 0.8 * scale) < 1.5 + 1.2 * scale) {
      e.on = false; eggCount++; eggChain++; eggChainT = 0.8;
      points += 25 * mult(); roarCharge = Math.min(ROAR_MAX, roarCharge + 2); mass += 0.5;
      sfx.egg(eggChain);
      burst(e.x, ey, e.z, 6, [0xffe066, 0xffffff, 0xffc21a], 0.18, 4);
      eggMesh.setMatrixAt(i, ZERO);
      continue;
    }
    if (e.z > 40) { e.on = false; continue; }
    tmpM.compose(tmpV.set(e.x, ey, e.z), tmpQ.setFromEuler(tmpE.set(0, e.t * 3, 0.15)), tmpS.set(1, 1, 1));
    eggMesh.setMatrixAt(i, tmpM);
  }
  eggMesh.instanceMatrix.needsUpdate = true;

  // --- obstacles
  const camZ = 7 + 4.6 * scale;
  for (const o of obs) {
    if (!o.on) continue;
    o.t += dt;
    if (o.st === 0) {
      if (o.chaser) {
        // A tank rolling along behind you, out of sight. It fires at you.
        o.z = camZ + 8; o.x += clamp(px - o.x, -1, 1) * 2 * dt;
        o.g.position.set(o.x, 0, o.z);
        if (playing && !turning) {
          o.fireT -= dt;
          if (o.fireT <= 0) { o.fireT = rand(2.6, 3.8); fireShell(o.x, 3.6 + 4 * scale + 5, o.z - 3, true); }
        }
        continue;
      }
      let vz = 0;
      if (!turning) {
        if (o.type === "raptor") { vz = 7; if (o.z > -45) o.x += clamp(px - o.x, -1, 1) * 3 * dt; }
        if (o.type === "zrex") { vz = 3; if (o.z > -60 && o.z < -12) o.x += clamp(px - o.x, -1, 1) * (1.4 + Math.min(2, runT / 90)) * dt; }
      }
      o.x = clamp(o.x, -ROAD_HALF + o.hw, ROAD_HALF - o.hw);
      o.z += dz + vz * dt;
      if (o.legs) {
        const sw = Math.sin(o.t * (o.type === "raptor" ? 14 : 6));
        o.legs[0].rotation.x = sw * 0.7; o.legs[1].rotation.x = -sw * 0.7;
        o.jaw!.rotation.x = 0.25 + Math.sin(o.t * 5) * 0.2;
        o.g.position.y = Math.abs(sw) * 0.1 * o.sc;
      }
      if (o.turret) {
        o.turret.rotation.y = Math.atan2(px - o.x, -o.z);
        if (playing && !turning && o.z > -85 && o.z < -18) {
          o.fireT -= dt;
          if (o.fireT <= 0) { o.fireT = rand(2.4, 3.4); fireShell(o.x, 2, o.z + 3, false); }
        }
      }
      const edible = mass >= o.w;
      o.ringMat.color.set(edible ? 0x39ff6a : 0xff3b3b);
      o.ringMat.opacity = edible ? 0.85 : 0.6 + 0.35 * Math.abs(Math.sin(o.t * 6));
      o.g.position.set(o.x, o.g.position.y, o.z);
      o.ring.position.set(o.x, 0.08, o.z);
      const over = dinoY > o.h * o.sc * 0.85;
      if (playing && !over && Math.abs(o.x - px) < o.hw * o.sc + 0.45 * scale && o.z + o.hd * o.sc > front && o.z - o.hd * o.sc < back) {
        if (edible) {
          smashObs(o);
          mass += o.w * 0.3; points += Math.round(o.w * 5) * mult(); chomp = 1;
          roarCharge = Math.min(ROAR_MAX, roarCharge + 3);
        } else if (invuln <= 0) {
          smashObs(o);
          hurt(0.5, `Flattened by a ${o.type === "zrex" ? "zombie T-rex" : o.type}!`, "OUCH!");
        }
      }
      if (o.z - o.hd * o.sc > 40) killObs(o);
    } else {
      o.vy -= 30 * dt;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt + dz;
      o.g.rotation.x += o.spin.x * dt; o.g.rotation.y += o.spin.y * dt; o.g.rotation.z += o.spin.z * dt;
      o.g.position.set(o.x, o.y, o.z);
      if (o.y < -6 || o.z > 50) { o.on = false; o.g.visible = false; }
    }
  }

  // --- shells
  let behindWarn = false;
  for (const s of shells) {
    if (!s.on) continue;
    s.t += dt;
    s.sz += dz; s.tz += dz;
    const k = Math.min(1, s.t / s.T);
    const arc = Math.sin(k * Math.PI) * (6 + 2 * scale);
    s.m.position.set(s.sx + (s.tx - s.sx) * k, s.sy + (0.3 - s.sy) * k + arc, s.sz + (s.tz - s.sz) * k);
    s.ring.position.set(s.tx, 0.12, s.tz);
    s.dot.position.set(s.tx, 0.11, s.tz);
    const R = 1.3 + 0.35 * scale;
    s.ring.scale.setScalar(R);
    s.dot.scale.setScalar(R * k);
    if (s.behind) behindWarn = true;
    if (k >= 1) {
      s.on = false; s.m.visible = s.ring.visible = s.dot.visible = false;
      sfx.boom();
      burst(s.tx, 0.6, s.tz, 22, [0xff8a2b, 0xffd166, 0x555555, 0xff3b1f], 0.45, 9);
      shake = Math.max(shake, 0.6);
      for (const z of zs) if (z.on && z.st === 0 && Math.hypot(z.x - s.tx, z.z - s.tz) < R + 1) flingZombie(z, 1, s.tx, s.tz);
      if (playing && Math.abs(s.tx - px) < R + 0.35 * scale && Math.abs(s.tz) < R + 0.5 * scale && dinoY < 1.2 * scale) {
        hurt(0.25, "Blown up by a tank shell!", "BOOM!");
      }
    }
  }
  $("behind").classList.toggle("show", behindWarn && playing);
  $("edge").classList.toggle("show", behindWarn && playing);
  bang.visible = behindWarn && playing;
  if (bang.visible) bang.position.y = 2.7 + Math.abs(Math.sin(performance.now() / 120)) * 0.2;

  // --- kaiju can crush the buildings too
  if (playing && stage >= 4 && !turning) {
    for (const b of main.blds) {
      if (b.hide || b.crushed) continue;
      if (Math.abs(b.z) < b.d / 2 + scale * 0.6 && Math.abs(b.x - px) < b.w / 2 + 0.5 * scale + 1.2) {
        b.crushed = true; mass += 10; points += 500 * mult(); sfx.crunch(1); shake = 1.2;
        burst(b.x - Math.sign(b.x) * b.w * 0.3, b.h * 0.4, b.z, 30, [...BCOL, 0x555555], 1.2, 12);
      }
    }
  }

  // --- junction hint
  const jHint = playing && junctionZ !== null && junctionZ > -90 && !turning;
  $("turn").classList.toggle("show", jHint);
  if (junctionZ !== null) {
    const l = px < 0;
    const big = clamp(1 + (-junctionZ) / 60, 1, 2.6);
    signL.scale.setScalar(big * (l ? 1.1 + Math.sin(runT * 10) * 0.05 : 0.85));
    signR.scale.setScalar(big * (!l ? 1.1 + Math.sin(runT * 10) * 0.05 : 0.85));
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
  if (pound.visible) {
    poundT = Math.max(0, poundT - dt * 3);
    pound.scale.setScalar(poundR * (1.2 - poundT * 0.9));
    pound.position.set(px, 0.2, 0);
    poundMat.opacity = poundT * 0.9;
    if (poundT <= 0) pound.visible = false;
  }
  chomp = Math.max(0, chomp - dt * 6);
  shake = Math.max(0, shake - dt * 2.2);
  squash *= Math.exp(-dt * 9);

  // --- animate the dino
  const air = dinoY > 0.01;
  stepPh += air ? 0 : dt * (6 + speed * 0.35) / Math.sqrt(scale);
  const sw = Math.sin(stepPh);
  if (!air && Math.sign(Math.sin(stepPh - dt * 8)) !== Math.sign(sw) && scale > 2.5 && playing) {
    sfx.stomp(); shake = Math.max(shake, 0.08 * scale);
  }
  dino.position.set(px, dinoY, 0);
  dino.scale.setScalar(scale);
  dino.rotation.y = turning ? -turnDir * Math.sin(Math.min(1, turning) * Math.PI) * 0.6 : clamp((prevX - px) / Math.max(dt, 0.001) * 0.015, -0.25, 0.25);
  dRoot.position.y = air ? 0 : Math.abs(sw) * 0.09;
  dRoot.rotation.z = air ? 0 : sw * 0.05;
  dRoot.rotation.x = air ? clamp(-dinoVY * 0.02, -0.3, 0.3) : 0.08;
  dSquash.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
  legs[0].rotation.x = air ? -0.9 : sw * 0.9; legs[1].rotation.x = air ? -0.6 : -sw * 0.9;
  tail.forEach((t, i) => { t.rotation.y = Math.sin(stepPh * 0.5 - i * 0.8) * 0.25; t.rotation.x = air ? -0.25 : 0.05 + Math.sin(stepPh * 2) * 0.05; });
  head.rotation.x = roarT > 0 ? -0.5 * roarT : Math.sin(stepPh * 2) * 0.04;
  jaw.rotation.x = Math.max(chomp * 0.7, roarT * 0.9, air ? 0.4 : 0.12);
  const blink = invuln > 0 && Math.floor(invuln * 12) % 2 === 0;
  for (const m of dinoMeshes) m.visible = !blink;
  if (state === "start") dino.rotation.y = Math.PI + Math.sin(performance.now() / 700) * 0.3;
  if (state === "over") { dRoot.rotation.z = 1.4; dRoot.position.y = 0.2; }

  // --- camera
  const camY = 3.6 + 4 * scale + dinoY * 0.35;
  const shx = (Math.random() - 0.5) * shake, shy = (Math.random() - 0.5) * shake;
  camera.position.set(px * 0.65 + shx, camY + shy, camZ);
  camera.lookAt(px * 0.8, 0.6 + 0.8 * scale + dinoY * 0.3, -14 - 4 * scale);
  const f = scene.fog as THREE.Fog;
  f.near = 60 + 12 * scale; f.far = 150 + 28 * scale;
  sun.position.set(px + 12, 32 + 4 * scale, 16);
  sun.target.position.set(px, 0, -8 - 2 * scale);
  const sc = sun.shadow.camera;
  const ext = 16 + 4 * scale;
  if (sc.right !== ext) { Object.assign(sc, { left: -ext, right: ext, top: ext * 1.4, bottom: -ext * 1.4, near: 1, far: 90 + 10 * scale }); sc.updateProjectionMatrix(); }

  updateParticles(dt, dz);
  updateClips();
}

let hudMass = -1, hudScore = -1, hudRoar = -1, hudEggs = -1, hudStreet = "";
function hud() {
  const score = state === "over" ? finalScore : Math.floor(points + dist / 2);
  if (score !== hudScore) { hudScore = score; $("score").firstChild!.textContent = String(score); }
  $("bestsm").textContent = `Best ${best}`;
  if (eggCount !== hudEggs) { hudEggs = eggCount; $("eggs").textContent = `🥚 ${eggCount}`; }
  const sk = state === "play" && streetKind !== "normal" ? streetKind : "";
  if (sk !== hudStreet) {
    hudStreet = sk;
    $("street").textContent = sk === "tanks" ? "TANK ALLEY · x2 POINTS" : sk === "feast" ? "ZOMBIE FEAST" : "";
    $("street").classList.toggle("show", !!sk);
  }
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
updateClips();
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
    jump,
    setMass: (m: number) => { mass = m; },
    step: (n: number) => { for (let i = 0; i < n; i++) update(1 / 60); },
    steer: (x: number) => { pxTarget = x; },
    junction: () => { nextJunction = dist; },
    tanks: () => { streetKind = "tanks"; spawnObs("tank", 0, 20, 99999, true); },
    auto: (skill = 1) => {
      if (junctionZ !== null && junctionZ > -60) { pxTarget = Math.random() < 0.5 ? -4 : 4; return; }
      const danger = obs.filter((o) => o.on && o.st === 0 && !o.chaser && o.w > mass && o.z > -30 && o.z < 5);
      const hot = shells.filter((s) => s.on && s.t / s.T > 0.4);
      const safe = (x: number) => Math.random() > skill || (danger.every((o) => Math.abs(o.x - x) > o.hw * o.sc + 0.6 * scale + 0.5) && hot.every((s) => Math.abs(s.tx - x) > 2 + 0.6 * scale));
      let bestX = px, bestD = 1e9;
      for (const z of zs) if (z.on && z.st === 0 && z.z < -1 && z.z > -40 && safe(z.x)) { const d = -z.z + Math.abs(z.x - px) * 0.5; if (d < bestD) { bestD = d; bestX = z.x; } }
      for (const o of obs) if (o.on && o.st === 0 && !o.chaser && o.w <= mass && o.z < -1 && o.z > -40 && safe(o.x)) { const d = -o.z * 0.7; if (d < bestD) { bestD = d; bestX = o.x; } }
      if (!safe(bestX)) for (let x = -8; x <= 8; x += 1) if (safe(x)) { bestX = x; break; }
      pxTarget = bestX;
    },
    get state() { return { state, mass, stage, scale, speed, dist, kills, points, runT, eggs: eggCount, street: streetKind, junctionZ, turning, zombies: zs.filter((z) => z.on).length, obs: obs.filter((o) => o.on).length, shells: shells.filter((s) => s.on).length }; },
  };
}
