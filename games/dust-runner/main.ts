import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as P from "../../src/platform/platform";
import { Terrain, N, CELL, HALF, TRACK_HALF_W } from "./terrain";
import { Truck, type Input } from "./truck";
import { TruckView } from "./model";
import { Autopilot } from "./autopilot";
import { Sfx } from "./sfx";

// Dust Runner: driving prototype. One long-travel trophy truck, one desert
// loop with whoops, rollers and jumps. The question it answers: is the
// truck fun to drive?

const GAME_ID = "dust-runner";
const DT = 1 / 120;
const $ = (id: string) => document.getElementById(id)!;
const qs = new URLSearchParams(location.search);
const DEBUG = qs.has("debug");
const AUTO = qs.has("auto");
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// seeded random for decor
let seed = 1234567;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ------------------------------------------------------------------
// save
// ------------------------------------------------------------------
interface Save { bestLap: number; bestAir: number; laps: number }
let save: Save = { bestLap: 0, bestAir: 0, laps: 0 };
const persist = () => { P.save(GAME_ID, JSON.stringify(save)); };

// ------------------------------------------------------------------
// renderer / scene
// ------------------------------------------------------------------
P.initPlatform();
const host = $("game");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
{
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#3d7fd1"); gr.addColorStop(0.42, "#86b9ea"); gr.addColorStop(0.62, "#f3d9b1"); gr.addColorStop(1, "#f6c993");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog(0xf0d3a8, 90, 380);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
scene.add(new THREE.HemisphereLight(0xdbeaff, 0xc08850, 1.35));
const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 150;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();

let viewW = 1, viewH = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;
  viewW = w; viewH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------
// terrain
// ------------------------------------------------------------------
const terrain = new Terrain();
{
  const R = N + 1;
  const pos = new Float32Array(R * R * 3);
  const col = new Float32Array(R * R * 3);
  const sand = new THREE.Color(0xeec48a), sand2 = new THREE.Color(0xe0aa6c), crest = new THREE.Color(0xf3d29c);
  const road = new THREE.Color(0xa86c3c), rut = new THREE.Color(0x7d4f2c), berm = new THREE.Color(0xcf9963), rock = new THREE.Color(0xc0784a);
  const c = new THREE.Color();
  const nrm = { x: 0, y: 1, z: 0 };
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const idx = j * R + i;
    const x = i * CELL - HALF, z = j * CELL - HALF, y = terrain.h[idx];
    pos.set([x, y, z], idx * 3);
    const n1 = Math.sin(x * 0.11 + z * 0.07) * Math.cos(z * 0.13 - x * 0.05);
    const n2 = Math.sin(x * 0.53 + z * 0.41) * 0.5 + Math.sin(x * 1.7 - z * 1.3) * 0.5;
    c.copy(sand).lerp(sand2, 0.5 + 0.5 * n1);
    c.lerp(crest, clamp((y - 3) / 6, 0, 0.6));
    terrain.normal(x, z, nrm);
    if (nrm.y < 0.85) c.lerp(rock, clamp((0.85 - nrm.y) * 4, 0, 0.8));
    const d = terrain.dist[idx];
    if (d < TRACK_HALF_W + 3.5) {
      const rc = new THREE.Color().copy(road);
      const rr = Math.min(Math.abs(d - 1.15), Math.abs(d - 3.6));
      if (rr < 0.7) rc.lerp(rut, (1 - rr / 0.7) * 0.6);
      if (d > TRACK_HALF_W) rc.lerp(berm, clamp((d - TRACK_HALF_W) / 2, 0, 1));
      c.lerp(rc, clamp((TRACK_HALF_W + 3.5 - d) / 2, 0, 1));
    }
    const sh = 1 + n2 * 0.035;
    col.set([c.r * sh, c.g * sh, c.b * sh], idx * 3);
  }
  const index: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * R + i, b = a + 1, cc = a + R + 1, d = a + R;
    index.push(a, cc, b, a, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = true;
  scene.add(m);
  // outer desert floor up to the horizon
  const outer = new THREE.Mesh(new THREE.RingGeometry(190, 1200, 48, 1), new THREE.MeshLambertMaterial({ color: 0xe0b27a }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = 18;
  scene.add(outer);
}

// ------------------------------------------------------------------
// decor
// ------------------------------------------------------------------
const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const dummy = new THREE.Object3D();
function freeSpot(minDist: number, lim = 182): [number, number] | null {
  for (let t = 0; t < 30; t++) {
    const x = (rnd() * 2 - 1) * lim, z = (rnd() * 2 - 1) * lim;
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
    if (terrain.dist[j * (N + 1) + i] > minDist) return [x, z];
  }
  return null;
}
// distant mesas
{
  const layers = [0xc8774a, 0xd98d5c, 0xb8653d];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
    const r = 300 + rnd() * 200;
    const w = 25 + rnd() * 50, h = 30 + rnd() * 50;
    const grp = new THREE.Group();
    let y = 0;
    for (let l = 0; l < 3; l++) {
      const lh = h / 3;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w * (1 - l * 0.12) * 0.85, w * (1 - l * 0.12), lh, 7), flat(layers[l]));
      m.position.y = y + lh / 2;
      y += lh;
      grp.add(m);
    }
    grp.position.set(Math.cos(a) * r, 14, Math.sin(a) * r);
    grp.rotation.y = rnd() * 6;
    grp.scale.z = 0.5 + rnd() * 0.8;
    scene.add(grp);
  }
}
// bushes and small rocks (no collision)
{
  const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 0), flat(0x8a8f4a), 260);
  const pebble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.4, 0), flat(0xa86f45), 220);
  for (let i = 0; i < 260; i++) {
    const p = freeSpot(TRACK_HALF_W + 3); if (!p) continue;
    const s = 0.6 + rnd() * 1.1;
    dummy.position.set(p[0], terrain.height(p[0], p[1]) + 0.15 * s, p[1]);
    dummy.scale.set(s, s * 0.6, s);
    dummy.rotation.set(0, rnd() * 6, 0);
    dummy.updateMatrix();
    bush.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < 220; i++) {
    const p = freeSpot(TRACK_HALF_W + 2); if (!p) continue;
    const s = 0.4 + rnd() * 0.9;
    dummy.position.set(p[0], terrain.height(p[0], p[1]), p[1]);
    dummy.scale.set(s, s * 0.7, s);
    dummy.rotation.set(rnd(), rnd() * 6, rnd());
    dummy.updateMatrix();
    pebble.setMatrixAt(i, dummy.matrix);
  }
  bush.castShadow = pebble.castShadow = true;
  scene.add(bush, pebble);
}
// boulders (solid)
interface Boulder { x: number; z: number; r: number; top: number }
const boulders: Boulder[] = [];
{
  const COUNT = 38;
  const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), flat(0xb06a40), COUNT);
  for (let i = 0; i < COUNT; i++) {
    const p = freeSpot(TRACK_HALF_W + 9); if (!p) continue;
    const r = 1.2 + rnd() * 1.8;
    const y = terrain.height(p[0], p[1]);
    dummy.position.set(p[0], y + r * 0.35, p[1]);
    dummy.scale.set(r, r * 0.75, r * (0.8 + rnd() * 0.4));
    dummy.rotation.set(rnd() * 0.5, rnd() * 6, rnd() * 0.5);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    boulders.push({ x: p[0], z: p[1], r: r * 0.95, top: y + r * 1.0 });
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}
// cacti (knock them over)
interface Cactus { x: number; z: number; y: number; s: number; rot: number; tilt: number; tiltV: number; ax: number; az: number; down: boolean }
const cacti: Cactus[] = [];
const cactusMesh = (() => {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.28, 0.33, 3.2, 7); trunk.translate(0, 1.6, 0); parts.push(trunk);
  const top = new THREE.SphereGeometry(0.28, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2); top.translate(0, 3.2, 0); parts.push(top);
  for (const [sx, h, len] of [[1, 1.4, 1.1], [-1, 1.9, 0.9]] as const) {
    const arm = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 6); arm.rotateZ(Math.PI / 2); arm.translate(sx * 0.55, h, 0); parts.push(arm);
    const up = new THREE.CylinderGeometry(0.18, 0.2, len, 6); up.translate(sx * 0.85, h + len / 2, 0); parts.push(up);
    const cap = new THREE.SphereGeometry(0.18, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(sx * 0.85, h + len, 0); parts.push(cap);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  const COUNT = 70;
  const mesh = new THREE.InstancedMesh(g, flat(0x5f8a3e), COUNT);
  for (let i = 0; i < COUNT; i++) {
    const p = freeSpot(TRACK_HALF_W + 5) ?? [0, 0];
    const c: Cactus = { x: p[0], z: p[1], y: terrain.height(p[0], p[1]) - 0.1, s: 0.8 + rnd() * 0.6, rot: rnd() * 6, tilt: 0, tiltV: 0, ax: 1, az: 0, down: false };
    cacti.push(c);
  }
  mesh.castShadow = true;
  scene.add(mesh);
  return mesh;
})();
const _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cax = new THREE.Vector3();
function cactusMatrix(i: number) {
  const c = cacti[i];
  _cq.setFromAxisAngle(_cax.set(0, 1, 0), c.rot);
  _cq2.setFromAxisAngle(_cax.set(c.ax, 0, c.az), c.tilt);
  dummy.quaternion.copy(_cq2).multiply(_cq);
  dummy.position.set(c.x, c.y, c.z);
  dummy.scale.setScalar(c.s);
  dummy.updateMatrix();
  cactusMesh.setMatrixAt(i, dummy.matrix);
}
cacti.forEach((_, i) => cactusMatrix(i));
// things the truck can flatten: flag posts and signs
interface Knock { x: number; z: number; r: number; tilt: number; tiltV: number; ax: number; az: number; down: boolean; apply: (q: THREE.Quaternion) => void }
const knocks: Knock[] = [];
const _kq = new THREE.Quaternion(), _kax = new THREE.Vector3();
// course markers: posts with flags along both edges
{
  const every = Math.round(18 / terrain.step);
  const n = (Math.ceil(terrain.count / every) + 1) * 2;
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 5), flat(0x3a3a3a), n);
  const flagG = new THREE.PlaneGeometry(0.6, 0.38); flagG.translate(0.3, 0, 0);
  const flag = new THREE.InstancedMesh(flagG, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), n);
  const ca = new THREE.Color(0xff5a1f), cb = new THREE.Color(0xfff3e0);
  let m = 0;
  for (let k = 0; k < terrain.count - every / 2; k += every) {
    const s = terrain.sample(k);
    for (const side of [1, -1]) {
      const x = s.x + s.tz * side * (TRACK_HALF_W + 3.2), z = s.z - s.tx * side * (TRACK_HALF_W + 3.2);
      const y = terrain.height(x, z);
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(s.tx, s.tz) + Math.PI / 2);
      const base = new THREE.Vector3(x, y, z), idx = m;
      const pm4 = new THREE.Matrix4(), off = new THREE.Matrix4(), yawM = new THREE.Matrix4().makeRotationFromQuaternion(yaw), one = new THREE.Vector3(1, 1, 1);
      const apply = (tq: THREE.Quaternion) => {
        pm4.compose(base, tq, one).multiply(off.makeTranslation(0, 0.9, 0));
        post.setMatrixAt(idx, pm4);
        pm4.compose(base, tq, one).multiply(off.makeTranslation(0, 1.6, 0)).multiply(yawM);
        flag.setMatrixAt(idx, pm4);
        post.instanceMatrix.needsUpdate = flag.instanceMatrix.needsUpdate = true;
      };
      apply(new THREE.Quaternion());
      flag.setColorAt(m, (k / every) % 2 ? ca : cb);
      knocks.push({ x, z, r: 1.7, tilt: 0, tiltV: 0, ax: 1, az: 0, down: false, apply });
      m++;
    }
  }
  post.count = flag.count = m;
  scene.add(post, flag);
}
// start/finish arch + chevron boards before each jump
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
{
  const s = terrain.sample(0);
  const head = Math.atan2(s.tx, s.tz);
  const arch = new THREE.Group();
  const pm = flat(0x1d2430);
  const span = TRACK_HALF_W + 2.2;
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), pm);
    p.position.set(side * span, 3, 0);
    p.castShadow = true;
    arch.add(p);
  }
  const check = canvasTex(512, 64, (g) => {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? "#111" : "#fff"; g.fillRect(i * 16, j * 16, 16, 16); }
  });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.1, 0.3), [pm, pm, pm, pm, new THREE.MeshBasicMaterial({ map: check }), new THREE.MeshBasicMaterial({ map: check })]);
  banner.position.y = 6;
  banner.castShadow = true;
  arch.add(banner);
  for (const side of [1, -1]) boulders.push({ x: s.x + s.tz * side * span, z: s.z - s.tx * side * span, r: 0.4, top: s.y + 7 });
  arch.position.set(s.x, s.y + 0.2, s.z);
  arch.rotation.y = head;
  scene.add(arch);

  const chev = canvasTex(128, 128, (g) => {
    g.fillStyle = "#ffb300"; g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#111"; g.beginPath(); g.moveTo(64, 14); g.lineTo(114, 80); g.lineTo(88, 80); g.lineTo(64, 48); g.lineTo(40, 80); g.lineTo(14, 80); g.closePath(); g.fill();
    g.fillRect(14, 96, 100, 14);
  });
  const boardM = new THREE.MeshLambertMaterial({ map: chev });
  for (const f of terrain.features) {
    if (f.kind !== "gap" && f.kind !== "kicker" && f.kind !== "table") continue;
    const k = Math.round((f.at - 12) / terrain.step);
    const ss = terrain.sample(k);
    for (const side of [1, -1]) {
      const x = ss.x + ss.tz * side * (TRACK_HALF_W + 4.2), z = ss.z - ss.tx * side * (TRACK_HALF_W + 4.2);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 5), pm); pole.position.y = 1; g.add(pole);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), boardM); b.position.y = 2.2; g.add(b);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), pm); back.position.y = 2.2; back.rotation.y = Math.PI; g.add(back);
      g.position.set(x, terrain.height(x, z), z);
      g.rotation.y = Math.atan2(ss.tx, ss.tz) + Math.PI;
      scene.add(g);
      const yawQ = g.quaternion.clone();
      knocks.push({ x, z, r: 1.9, tilt: 0, tiltV: 0, ax: 1, az: 0, down: false, apply: (tq) => { g.quaternion.copy(tq).multiply(yawQ); } });
    }
  }
}

// ------------------------------------------------------------------
// dust particles
// ------------------------------------------------------------------
const DUST_N = 700;
const dPos = new Float32Array(DUST_N * 3), dVel = new Float32Array(DUST_N * 3);
const dAge = new Float32Array(DUST_N).fill(99), dLife = new Float32Array(DUST_N).fill(1), dSize0 = new Float32Array(DUST_N);
const dSize = new Float32Array(DUST_N), dAlpha = new Float32Array(DUST_N);
let dNext = 0;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
dustGeo.setAttribute("size", new THREE.BufferAttribute(dSize, 1));
dustGeo.setAttribute("alpha", new THREE.BufferAttribute(dAlpha, 1));
const dustMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color(0xe9c99a) } },
  vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float uScale;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale / max(0.5, -mv.z); vA = alpha; }`,
  fragmentShader: `uniform vec3 uColor; varying float vA;
    void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.05, d)); }`,
  transparent: true, depthWrite: false,
});
const dust = new THREE.Points(dustGeo, dustMat);
dust.frustumCulled = false;
scene.add(dust);
function emitDust(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) {
  const i = dNext; dNext = (dNext + 1) % DUST_N;
  dPos[i * 3] = x; dPos[i * 3 + 1] = y; dPos[i * 3 + 2] = z;
  dVel[i * 3] = vx; dVel[i * 3 + 1] = vy; dVel[i * 3 + 2] = vz;
  dAge[i] = 0; dLife[i] = life; dSize0[i] = size;
}
function updateDust(dt: number) {
  for (let i = 0; i < DUST_N; i++) {
    if (dAge[i] >= dLife[i]) { dAlpha[i] = 0; dSize[i] = 0; continue; }
    dAge[i] += dt;
    const t = dAge[i] / dLife[i];
    const drag = Math.exp(-dt * 2.2);
    dVel[i * 3] *= drag; dVel[i * 3 + 1] = dVel[i * 3 + 1] * drag + 0.4 * dt; dVel[i * 3 + 2] *= drag;
    dPos[i * 3] += dVel[i * 3] * dt; dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt; dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
    dSize[i] = dSize0[i] * (0.6 + t * 2.2);
    dAlpha[i] = 0.5 * (1 - t) * Math.min(1, t * 8);
  }
  dustGeo.attributes.position.needsUpdate = true;
  dustGeo.attributes.size.needsUpdate = true;
  dustGeo.attributes.alpha.needsUpdate = true;
}

// ------------------------------------------------------------------
// truck
// ------------------------------------------------------------------
const truck = new Truck();
const view = new TruckView();
scene.add(view.root);
const pilot = new Autopilot(terrain);
const sfx = new Sfx();
let paused = false;
P.onAudioChange((on) => sfx.setEnabled(on));
sfx.setEnabled(P.isAudioEnabled());
P.onPause(() => { paused = true; sfx.suspend(); });
P.onResume(() => { paused = false; sfx.resume(); });

function placeAtTrack(k: number) {
  const s = terrain.sample(k), s2 = terrain.sample(k + 4);
  truck.place(s.x, s.z, Math.atan2(s2.x - s.x, s2.z - s.z), terrain);
  pilot.k = ((k % terrain.count) + terrain.count) % terrain.count;
}

// ------------------------------------------------------------------
// input
// ------------------------------------------------------------------
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyR" && mode === "drive") resetTruck();
  sfx.unlock();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

const touch = { steer: 0, gas: false, brake: false, steerId: -1, steerX0: 0, gasId: -1, brakeId: -1 };
const steerZone = $("steerzone"), knob = $("knob"), ring = $("ring");
const gasBtn = $("gas"), brakeBtn = $("brake");
let usedTouch = false;
steerZone.addEventListener("pointerdown", (e) => {
  if (touch.steerId !== -1) return;
  touch.steerId = e.pointerId; touch.steerX0 = e.clientX;
  steerZone.setPointerCapture(e.pointerId);
  ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`;
  knob.style.left = `${e.clientX}px`; knob.style.top = `${e.clientY}px`;
  document.body.classList.add("steering");
  sfx.unlock(); usedTouch = true;
});
steerZone.addEventListener("pointermove", (e) => {
  if (e.pointerId !== touch.steerId) return;
  const range = Math.min(80, viewW * 0.12);
  const dx = clamp(e.clientX - touch.steerX0, -range, range);
  touch.steer = dx / range;
  knob.style.left = `${touch.steerX0 + dx}px`;
});
const endSteer = (e: PointerEvent) => {
  if (e.pointerId !== touch.steerId) return;
  touch.steerId = -1; touch.steer = 0;
  document.body.classList.remove("steering");
};
steerZone.addEventListener("pointerup", endSteer);
steerZone.addEventListener("pointercancel", endSteer);
function pedal(el: HTMLElement, key: "gas" | "brake") {
  el.addEventListener("pointerdown", (e) => { touch[key] = true; el.classList.add("on"); el.setPointerCapture(e.pointerId); sfx.unlock(); usedTouch = true; e.preventDefault(); });
  const up = () => { touch[key] = false; el.classList.remove("on"); };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("lostpointercapture", up);
}
pedal(gasBtn, "gas");
pedal(brakeBtn, "brake");
$("reset").addEventListener("pointerdown", (e) => { e.stopPropagation(); resetTruck(); });
document.addEventListener("contextmenu", (e) => e.preventDefault());

let kbSteer = 0;
function readInput(dt: number, out: Input): Input {
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  // keyboard steering ramps in, like a thumb would
  kbSteer += clamp(target - kbSteer, -dt * (target === 0 ? 6 : 3.5), dt * (target === 0 ? 6 : 3.5));
  out.steer = clamp(kbSteer + touch.steer, -1, 1);
  out.throttle = keys.has("ArrowUp") || keys.has("KeyW") || touch.gas ? 1 : 0;
  out.brake = keys.has("ArrowDown") || keys.has("KeyS") || touch.brake ? 1 : 0;
  out.handbrake = keys.has("Space");
  return out;
}

// ------------------------------------------------------------------
// game state
// ------------------------------------------------------------------
type Mode = "menu" | "drive";
let mode: Mode = "menu";
const input: Input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
let lapTime = 0, lapRunning = false, nextCp = 1, lastQ = 3, lapN = 0;
let flipTimer = 0, stuckTimer = 0;
let launchX = 0, launchZ = 0, wasAir = false, airPeak = 0;
let shake = 0;

function resetTruck() {
  const near = terrain.nearest(truck.pos.x, truck.pos.z, pilot.k);
  placeAtTrack(near.k - 12);
  flipTimer = 0; stuckTimer = 0;
  pop("Reset", "");
}

function startDrive() {
  mode = "drive";
  document.body.classList.add("driving");
  $("menu").classList.remove("show");
  placeAtTrack(terrain.count - 40);
  lapRunning = false; lapTime = 0; nextCp = 1; lastQ = 3; lapN = 0;
  camSnap = true;
  sfx.unlock();
  if (!usedTouch && !("ontouchstart" in window)) document.body.classList.add("kb");
}
$("go").addEventListener("click", startDrive);

let popTimer: number | undefined;
function pop(big: string, small: string, cls = "") {
  const b = $("big"), s = $("sub");
  b.textContent = big; s.textContent = small;
  b.className = cls; s.className = "";
  void b.offsetWidth;
  b.classList.add("show"); if (small) s.classList.add("show");
  clearTimeout(popTimer);
  popTimer = window.setTimeout(() => { b.className = ""; s.className = ""; }, 1800);
}
const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

function physicsStep(dt: number) {
  if (mode === "drive" && !AUTO) readInput(dt, input);
  else pilot.drive(truck, input, mode === "menu" ? 24 : 30);
  truck.step(dt, input, terrain);
  // boulders
  for (const b of boulders) {
    const dx = truck.pos.x - b.x, dz = truck.pos.z - b.z;
    const rr = b.r + 1.5;
    const d2 = dx * dx + dz * dz;
    if (d2 > rr * rr || truck.pos.y > b.top + 0.8) continue;
    const d = Math.sqrt(d2) || 1;
    const nx = dx / d, nz = dz / d;
    truck.pos.x += nx * (rr - d); truck.pos.z += nz * (rr - d);
    const vn = truck.vel.x * nx + truck.vel.z * nz;
    if (vn < 0) {
      truck.vel.x -= nx * vn * 1.3; truck.vel.z -= nz * vn * 1.3;
      truck.ang.y += (Math.random() - 0.5) * Math.min(2, -vn * 0.15);
      if (vn < -3) { sfx.thud(-vn / 12); shake = Math.min(1, shake + -vn * 0.05); }
    }
  }
}

function gameTick(dt: number) {
  // cacti
  for (let i = 0; i < cacti.length; i++) {
    const c = cacti[i];
    if (!c.down) {
      const dx = c.x - truck.pos.x, dz = c.z - truck.pos.z;
      if (dx * dx + dz * dz < 2.6 * 2.6 && truck.vel.lengthSq() > 4) {
        c.down = true;
        const v = Math.hypot(truck.vel.x, truck.vel.z) || 1;
        c.ax = truck.vel.z / v; c.az = -truck.vel.x / v;
        c.tiltV = 1.5 + v * 0.1;
        truck.vel.multiplyScalar(0.93);
        sfx.thud(0.5);
        for (let k = 0; k < 10; k++) emitDust(c.x, c.y + 0.5, c.z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 1.2, 1.4);
      }
    } else if (c.tilt < 1.45) {
      c.tiltV += 6 * dt;
      c.tilt = Math.min(1.45, c.tilt + c.tiltV * dt);
      cactusMatrix(i);
      cactusMesh.instanceMatrix.needsUpdate = true;
    }
  }

  for (const c of knocks) {
    if (!c.down) {
      const dx = c.x - truck.pos.x, dz = c.z - truck.pos.z;
      if (dx * dx + dz * dz < c.r * c.r && truck.vel.lengthSq() > 4) {
        c.down = true;
        const v = Math.hypot(truck.vel.x, truck.vel.z) || 1;
        c.ax = truck.vel.z / v; c.az = -truck.vel.x / v;
        c.tiltV = 3 + v * 0.25;
        truck.vel.multiplyScalar(0.97);
        sfx.thud(0.3);
        for (let k = 0; k < 6; k++) emitDust(c.x, terrain.height(c.x, c.z) + 0.3, c.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 1, 1.2);
      }
    } else if (c.tilt < 1.5) {
      c.tiltV += 8 * dt;
      c.tilt = Math.min(1.5, c.tilt + c.tiltV * dt);
      c.apply(_kq.setFromAxisAngle(_kax.set(c.ax, 0, c.az), c.tilt));
    }
  }

  // dust from the tyres
  const spd = truck.vel.length();
  for (const w of truck.wheels) {
    if (!w.grounded) continue;
    const rate = (Math.max(0, spd - 3) * 0.35 + w.slip * 2.5) * dt;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    n = Math.min(n, 3);
    for (let k = 0; k < n; k++) {
      emitDust(w.contact.x + (Math.random() - 0.5) * 0.5, w.contact.y + 0.15, w.contact.z + (Math.random() - 0.5) * 0.5,
        -truck.vel.x * 0.15 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, -truck.vel.z * 0.15 + (Math.random() - 0.5) * 2,
        0.8 + Math.random() * 0.6 + spd * 0.02, 0.9 + Math.random() * 0.9);
    }
  }

  // air time
  const inAir = truck.grounded === 0;
  if (inAir && !wasAir) { launchX = truck.pos.x; launchZ = truck.pos.z; airPeak = 0; }
  if (inAir) airPeak = Math.max(airPeak, truck.airTime);
  if (!inAir && wasAir) {
    const dist = Math.hypot(truck.pos.x - launchX, truck.pos.z - launchZ);
    const hard = truck.bottomOut > 3 || truck.impact > 4;
    if (airPeak > 0.25) {
      sfx.thud(clamp(airPeak * 0.6 + (hard ? 0.4 : 0), 0.2, 1));
      shake = Math.min(1, shake + airPeak * 0.35);
      for (const w of truck.wheels) for (let k = 0; k < 8; k++)
        emitDust(w.contact.x, w.contact.y + 0.2, w.contact.z, (Math.random() - 0.5) * 6, 1 + Math.random() * 2, (Math.random() - 0.5) * 6, 1.4, 1.6);
    }
    if (mode === "drive" && airPeak > 0.6) {
      const best = airPeak > save.bestAir;
      if (best) { save.bestAir = airPeak; persist(); }
      const word = airPeak > 1.6 ? "HUGE AIR" : airPeak > 1.1 ? "BIG AIR" : "AIR";
      pop(`${word} ${airPeak.toFixed(1)}s`, `${Math.round(dist)} m${best ? " · new best!" : ""}${hard ? " · hard landing" : ""}`, hard ? "bad" : "");
    }
  }
  wasAir = inAir;
  if (truck.impact > 5 && !inAir) { sfx.thud(truck.impact / 10); shake = Math.min(1, shake + truck.impact * 0.04); }

  if (mode !== "drive") return;

  // flipped or stuck: auto reset
  if (truck.isUpsideDown()) flipTimer += dt; else flipTimer = 0;
  if (flipTimer > 2.2) { resetTruck(); pop("Flipped!", "Back on the track"); }
  const near = terrain.nearest(truck.pos.x, truck.pos.z, pilot.k);
  pilot.k = near.k;

  // lap timing via quarter checkpoints
  const q = Math.floor((near.k / terrain.count) * 4) % 4;
  if (near.d < 30) {
    if (q === 0 && lastQ === 3) {
      if (lapRunning && nextCp === 4) {
        lapN++;
        save.laps++;
        const best = !save.bestLap || lapTime < save.bestLap;
        if (best) save.bestLap = lapTime;
        persist();
        sfx.ding();
        pop(`LAP ${fmt(lapTime)}`, best ? "New best lap!" : `Best ${fmt(save.bestLap)}`);
      } else if (!lapRunning) pop("GO!", "Lap timer started");
      lapRunning = true; lapTime = 0; nextCp = 1;
    } else if (q === nextCp) nextCp++;
    lastQ = q;
  }
  if (lapRunning) lapTime += dt;
}

// ------------------------------------------------------------------
// camera
// ------------------------------------------------------------------
const camDir = new THREE.Vector3(0, 0, 1);
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camSnap = true;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
function updateCamera(dt: number) {
  const fw = truck.forward(_v);
  const flatF = _w.set(fw.x, 0, fw.z);
  if (flatF.lengthSq() < 0.05 || truck.isUpsideDown()) flatF.set(truck.vel.x, 0, truck.vel.z);
  if (flatF.lengthSq() > 1e-4) {
    flatF.normalize();
    if (camSnap) camDir.copy(flatF);
    else camDir.lerp(flatF, 1 - Math.exp(-dt * (truck.grounded ? 3.2 : 1.2))).normalize();
  }
  const portrait = viewH > viewW;
  const spd = Math.abs(truck.speed);
  const dist = (portrait ? 9.5 : 8) + spd * 0.06;
  const height = (portrait ? 3.9 : 3.2) + spd * 0.015;
  const target = _v.copy(truck.pos).addScaledVector(camDir, -dist);
  target.y = truck.pos.y + height;
  const gy = terrain.height(target.x, target.z) + 1.6;
  if (target.y < gy) target.y = gy;
  if (camSnap) camPos.copy(target);
  else {
    camPos.x += (target.x - camPos.x) * (1 - Math.exp(-dt * 8));
    camPos.z += (target.z - camPos.z) * (1 - Math.exp(-dt * 8));
    camPos.y += (target.y - camPos.y) * (1 - Math.exp(-dt * 4.5));
    if (camPos.y < gy) camPos.y = gy;
  }
  const look = _w.copy(truck.pos).addScaledVector(camDir, 4);
  look.y = truck.pos.y + 0.9;
  if (camSnap) camLook.copy(look); else camLook.lerp(look, 1 - Math.exp(-dt * 10));
  camSnap = false;
  camera.position.copy(camPos);
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.35;
    camera.position.y += (Math.random() - 0.5) * shake * 0.35;
    shake *= Math.exp(-dt * 6);
  }
  camera.lookAt(camLook);
  const fov = (portrait ? 70 : 60) + Math.min(14, spd * 0.35);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  sun.position.copy(truck.pos).addScaledVector(SUN_DIR, 60);
  sun.target.position.copy(truck.pos);
  dustMat.uniforms.uScale.value = (viewH * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

// ------------------------------------------------------------------
// HUD
// ------------------------------------------------------------------
const spdEl = $("spdv"), lapEl = $("lap"), bestEl = $("best"), fpsEl = $("fps");
let fpsAcc = 0, fpsN = 0;
function hud(dt: number) {
  spdEl.textContent = String(Math.round(Math.abs(truck.speed) * 3.6));
  lapEl.textContent = lapRunning ? fmt(lapTime) : "--:--";
  bestEl.textContent = save.bestLap ? `Best ${fmt(save.bestLap)}` : "Cross the line to start";
  if (DEBUG) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps · gnd ${truck.grounded} · ${truck.wheels.map((w) => w.comp.toFixed(2)).join(" ")}`; fpsAcc = 0; fpsN = 0; }
  }
}

// ------------------------------------------------------------------
// loop
// ------------------------------------------------------------------
let last = performance.now(), acc = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (paused) return;
  dt = Math.min(dt, 0.1);
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 10) { physicsStep(DT); acc -= DT; steps++; }
  if (steps === 10) acc = 0;
  gameTick(dt);
  updateDust(dt);
  view.update(truck, input.brake > 0 && truck.speed > 0.5);
  updateCamera(dt);
  if (mode === "drive") {
    const slip = truck.wheels.reduce((a, w) => a + w.slip, 0);
    sfx.drive(truck.rpm, input.throttle, truck.vel.length(), truck.grounded, slip);
  } else sfx.mute();
  hud(dt);
  renderer.render(scene, camera);
}

async function boot() {
  try {
    const raw = await P.loadSave(GAME_ID);
    if (raw) save = { ...save, ...JSON.parse(raw) };
  } catch { /* fresh save */ }
  if (DEBUG) { document.body.classList.add("debug"); Object.assign(window as any, { scene, camera, renderer, truck, knocks }); }
  placeAtTrack(0);
  for (let i = 0; i < 60; i++) physicsStep(DT); // settle the suspension
  if (qs.has("drive")) startDrive();
  last = performance.now();
  requestAnimationFrame(frame);
  P.firstFrameReady();
  P.gameReady();
}
boot();
