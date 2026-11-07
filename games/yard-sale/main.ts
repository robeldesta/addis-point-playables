import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as P from "../../src/platform/platform";
import { Course } from "./course";
import { Physics, Skier, litter, type GearName, type PartName, type CrashCause } from "./skier";
import { randomName, randomSuit } from "./names";
import { Sfx } from "./sfx";

// Yard Sale: a downhill ragdoll ski racer. Hold to stay up, slide up to
// tuck for speed, drag to steer. Crash and your body goes full ragdoll:
// skis, boots, poles and helmet rip off when the force on them is too high,
// clothes tear and bruises show. Race random rivals on endless mountains.

const GAME_ID = "yard-sale";
const DT = 1 / 90;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const $ = (id: string) => document.getElementById(id)!;
const DEBUG = new URLSearchParams(location.search).has("debug");

// ------------------------------------------------------------------
// save
// ------------------------------------------------------------------
interface Save { unlocked: number; level: number; coins: number; wax: number; bind: number; pad: number; best: number }
let save: Save = { unlocked: 0, level: 0, coins: 0, wax: 0, bind: 0, pad: 0, best: 0 };
const persist = () => { P.save(GAME_ID, JSON.stringify(save)); };

// ------------------------------------------------------------------
// renderer
// ------------------------------------------------------------------
P.initPlatform();
const host = $("game");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
{
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#1565c0"); gr.addColorStop(0.45, "#64b5f6"); gr.addColorStop(0.75, "#d6ecff"); gr.addColorStop(1, "#f4faff");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog(0xdcefff, 70, 230);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight(0xf0f8ff, 0x8aa0b8, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 120;
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.7 ? 70 : camera.aspect < 1.2 ? 62 : 52;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const sfx = new Sfx();
sfx.setEnabled(P.isAudioEnabled());
P.onAudioChange((on) => sfx.setEnabled(on));
let paused = false;
P.onPause(() => { paused = true; sfx.suspend(); });
P.onResume(() => { paused = false; sfx.resume(); last = performance.now(); });

// ------------------------------------------------------------------
// world building
// ------------------------------------------------------------------
let course: Course;
const world: THREE.Object3D[] = [];
const addW = <T extends THREE.Object3D>(o: T) => { scene.add(o); world.push(o); return o; };

function treeGeo() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.ConeGeometry(1.6 - i * 0.4, 2.4, 7);
    g.translate(0, 1.6 + i * 1.3, 0);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}
const TREE_GEO = treeGeo();
const TRUNK_GEO = new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6).translate(0, 0.7, 0);
const ROCK_GEO = new THREE.DodecahedronGeometry(1, 0);
const SNOWCAP_GEO = new THREE.ConeGeometry(0.9, 0.9, 7).translate(0, 5.1, 0);

function banner(text: string, bg: string, fg: string) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg; g.font = "900 64px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide });
}

function arch(z: number, text: string, bg: string) {
  const x = course.cx(z), w = course.w(z) + 1.2;
  const g = new THREE.Group();
  const post = new THREE.MeshLambertMaterial({ color: 0x37474f });
  for (const s of [-1, 1]) {
    const px = x + s * w;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), post);
    m.position.set(px, course.height(px, z) + 3.5, z);
    m.castShadow = true;
    g.add(m);
  }
  const by = Math.max(course.height(x - w, z), course.height(x + w, z)) + 6.2;
  const b = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 2.2), banner(text, bg, "#fff"));
  b.position.set(x, by, z);
  b.rotation.y = Math.PI;
  g.add(b);
  // line on the snow
  const line = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 0.5), new THREE.MeshBasicMaterial({ color: bg === "#d32f2f" ? 0xd32f2f : 0x1565c0 }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(x, course.height(x, z) + 0.05, z);
  g.add(line);
  addW(g);
}

function buildWorld() {
  for (const o of world) scene.remove(o);
  world.length = 0;
  const c = course;
  // terrain
  let xmin = Infinity, xmax = -Infinity;
  for (let i = 0; i < c.CX.length; i++) { xmin = Math.min(xmin, c.CX[i]); xmax = Math.max(xmax, c.CX[i]); }
  xmin -= 85; xmax += 85;
  const xs = 2.5, cols = Math.ceil((xmax - xmin) / xs) + 1;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const CH = 60;
  for (let z0 = c.zMin; z0 < c.zMax; z0 += CH) {
    const rows = CH + 1;
    const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3);
    for (let r = 0; r < rows; r++) {
      const z = z0 + r;
      const cx = c.cx(z), w = c.w(z);
      for (let k = 0; k < cols; k++) {
        const x = xmin + k * xs;
        const i = (r * cols + k) * 3;
        pos[i] = x; pos[i + 1] = c.height(x, z); pos[i + 2] = z;
        const off = Math.abs(x - cx);
        let s = off < w ? 0.97 + 0.03 * Math.sin(x * 2.2) : 0.9 + 0.05 * Math.sin(x * 0.3 + z * 0.2);
        if (c.jumpBump(x, z) > 0.05) s = 0.86;
        col[i] = s * 0.95; col[i + 1] = s * 0.97; col[i + 2] = s * 1.0;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
      const a = r * cols + k, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    addW(m);
  }
  // jump lips: blue dye
  for (const jp of c.jumps) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(jp.w * 2, 0.08, 0.4), new THREE.MeshBasicMaterial({ color: 0x1e88e5 }));
    lip.position.set(jp.x, c.height(jp.x, jp.z - 0.1) + 0.02, jp.z - 0.2);
    addW(lip);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1, 6), new THREE.MeshLambertMaterial({ color: 0xff6d00 }));
      f.position.set(jp.x + s * (jp.w + 0.5), c.height(jp.x + s * (jp.w + 0.5), jp.z) + 0.5, jp.z);
      addW(f);
    }
  }
  // trees and rocks
  const trees = c.obstacles.filter((o) => o.kind !== "rock");
  const rocks = c.obstacles.filter((o) => o.kind === "rock");
  const tm = new THREE.InstancedMesh(TREE_GEO, new THREE.MeshLambertMaterial({ color: 0x2e5e3e }), trees.length);
  const cap = new THREE.InstancedMesh(SNOWCAP_GEO, new THREE.MeshLambertMaterial({ color: 0xf5f9ff }), trees.length);
  const tr = new THREE.InstancedMesh(TRUNK_GEO, new THREE.MeshLambertMaterial({ color: 0x5d4037 }), trees.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3();
  const tint = new THREE.Color();
  trees.forEach((o, i) => {
    V.set(o.x, c.height(o.x, o.z) - 0.1, o.z);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.x * 13.1);
    S.setScalar(o.s);
    M.compose(V, Q, S);
    tm.setMatrixAt(i, M); cap.setMatrixAt(i, M); tr.setMatrixAt(i, M);
    tint.setHSL(0.36 + (o.s % 0.1) * 0.3, 0.45, 0.22 + (o.x % 1 + 1) % 1 * 0.08);
    tm.setColorAt(i, tint);
  });
  tm.castShadow = false;
  addW(tm); addW(cap); addW(tr);
  const rm = new THREE.InstancedMesh(ROCK_GEO, new THREE.MeshLambertMaterial({ color: 0x78808a, flatShading: true }), Math.max(1, rocks.length));
  rocks.forEach((o, i) => {
    V.set(o.x, c.height(o.x, o.z) + o.r * 0.25, o.z);
    Q.setFromEuler(new THREE.Euler(o.x, o.z, 0));
    S.set(o.r * 1.1, o.r * 0.8, o.r);
    M.compose(V, Q, S);
    rm.setMatrixAt(i, M);
  });
  rm.count = rocks.length;
  rm.castShadow = true;
  addW(rm);
  // nets along both sides
  const netMat = new THREE.MeshLambertMaterial({ color: 0xff6d00, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const pts: number[] = [], idx: number[] = [];
    let n = 0;
    for (let z = -20; z <= c.length + 40; z += 2) {
      const x = c.cx(z) + side * (c.w(z) + 1.2);
      const h = c.height(x, z);
      pts.push(x, h + 0.15, z, x, h + 1.5, z);
      if (n) idx.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, (n - 1) * 2 + 1, n * 2, n * 2 + 1);
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    addW(new THREE.Mesh(g, netMat));
  }
  // gates for flavour: red / blue flags along the course
  const flagMat = [new THREE.MeshLambertMaterial({ color: 0xd32f2f }), new THREE.MeshLambertMaterial({ color: 0x1565c0 })];
  const flagGeo = new THREE.BoxGeometry(0.04, 1.6, 0.9).translate(0, 0.8, 0);
  let fi = 0;
  for (let z = 40; z < c.length - 20; z += 45) {
    if (c.jumps.some((j) => Math.abs(j.z - z) < 25)) continue;
    for (const s of [-1, 1]) {
      const x = c.cx(z) + s * (c.w(z) - 0.6);
      const f = new THREE.Mesh(flagGeo, flagMat[fi % 2]);
      f.position.set(x, c.height(x, z), z);
      addW(f);
    }
    fi++;
  }
  arch(0, "START", "#1565c0");
  arch(c.length, "FINISH", "#d32f2f");
  // crowd at the finish
  const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.25, 0.8, 2, 6).translate(0, 0.65, 0), new THREE.MeshLambertMaterial(), 80);
  for (let i = 0; i < 80; i++) {
    const s = i % 2 ? 1 : -1;
    const z = c.length - 30 + (i / 2) * 1.4;
    const x = c.cx(z) + s * (c.w(z) + 2.5 + Math.random() * 3);
    V.set(x, c.height(x, z), z); Q.identity(); S.setScalar(1);
    M.compose(V, Q, S);
    crowd.setMatrixAt(i, M);
    crowd.setColorAt(i, tint.setHSL(Math.random(), 0.7, 0.5));
  }
  addW(crowd);
  // distant mountains
  const mtn = new THREE.MeshLambertMaterial({ color: 0xc5d5e8, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(60 + Math.random() * 60, 70 + Math.random() * 80, 6), mtn);
    const z = c.length * (i / 14) + 150;
    const s = i % 2 ? 1 : -1;
    m.position.set(c.cx(z) + s * (170 + Math.random() * 80), c.height(0, Math.min(z, c.zMax - 1)) - 20, z + 60);
    addW(m);
  }
}

// ------------------------------------------------------------------
// snow spray and carve tracks
// ------------------------------------------------------------------
const SPRAY = 600;
const spPos = new Float32Array(SPRAY * 3).fill(-9999);
const spVel = new Float32Array(SPRAY * 3);
const spLife = new Float32Array(SPRAY);
let spI = 0;
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, transparent: true, opacity: 0.85, depthWrite: false }));
spray.frustumCulled = false;
scene.add(spray);
function emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life = 0.7) {
  const i = spI; spI = (spI + 1) % SPRAY;
  spPos[i * 3] = x; spPos[i * 3 + 1] = y; spPos[i * 3 + 2] = z;
  spVel[i * 3] = vx; spVel[i * 3 + 1] = vy; spVel[i * 3 + 2] = vz;
  spLife[i] = life * (0.6 + Math.random() * 0.6);
}
const sprayAcc = new Map<Skier, number>();
function sprayFrom(s: Skier, dt: number) {
  if (s.mode !== "ski") return;
  const sp = s.speed();
  const rate = s.carve * sp * 5 + s.skid * 12 + (s.hold ? 0 : sp * 2);
  let acc = (sprayAcc.get(s) ?? 0) + rate * dt;
  const out = -Math.sign(s.steer || 1); // spray flies to the outside of the turn
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  while (acc >= 1) {
    acc -= 1;
    const back = -0.4 - Math.random() * 0.5;
    const side = (Math.random() - 0.5) * 0.4;
    emit(s.pos.x + fx * back + fz * side, s.pos.y + 0.05, s.pos.z + fz * back - fx * side,
      s.vel.x * 0.35 + fz * out * (1.5 + Math.random() * 2.5), 1 + Math.random() * 2.2, s.vel.z * 0.35 - fx * out * (1.5 + Math.random() * 2.5));
  }
  sprayAcc.set(s, acc);
}
function burst(p: THREE.Vector3, v: THREE.Vector3, n: number) {
  for (let i = 0; i < n; i++) emit(p.x, p.y + 0.1, p.z, v.x * 0.3 + (Math.random() - 0.5) * 5, 1 + Math.random() * 4, v.z * 0.3 + (Math.random() - 0.5) * 5, 1);
}
function updateSpray(dt: number) {
  for (let i = 0; i < SPRAY; i++) {
    if (spLife[i] <= 0) continue;
    spLife[i] -= dt;
    if (spLife[i] <= 0) { spPos[i * 3 + 1] = -9999; continue; }
    spVel[i * 3 + 1] -= 9.8 * dt;
    spPos[i * 3] += spVel[i * 3] * dt; spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
  }
  sprayGeo.attributes.position.needsUpdate = true;
}
const TRACKS = 1600;
const tracks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.42).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb8c8dc, transparent: true, opacity: 0.7, depthWrite: false }), TRACKS);
tracks.frustumCulled = false;
tracks.count = 0;
scene.add(tracks);
let trI = 0;
const trLast = new THREE.Vector3(0, -999, 0);
const tM = new THREE.Matrix4(), tQ = new THREE.Quaternion(), tS = new THREE.Vector3(1, 1, 1), tP = new THREE.Vector3(), tN = new THREE.Vector3();
function trackFrom(s: Skier) {
  if (s.mode !== "ski" || s.skiCount() === 0) { trLast.y = -999; return; }
  if (trLast.y > -900 && trLast.distanceToSquared(s.pos) < 0.35 * 0.35) return;
  trLast.copy(s.pos);
  course.normal(s.pos.x, s.pos.z, tN);
  const f = new THREE.Vector3(s.vel.x, 0, s.vel.z);
  if (f.lengthSq() < 0.01) return;
  f.normalize().addScaledVector(tN, -f.dot(tN)).normalize();
  const l = new THREE.Vector3().crossVectors(tN, f);
  tQ.setFromRotationMatrix(tM.makeBasis(l, tN, f));
  for (const side of [-0.1, 0.1]) {
    if ((side < 0 ? !s.gear.skiR.on : !s.gear.skiL.on)) continue;
    tP.copy(s.pos).addScaledVector(l, side);
    tP.y = course.height(tP.x, tP.z) + 0.03;
    tM.compose(tP, tQ, tS);
    tracks.setMatrixAt(trI, tM);
    trI = (trI + 1) % TRACKS;
    tracks.count = Math.min(TRACKS, tracks.count + 1);
  }
  tracks.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------
// race state
// ------------------------------------------------------------------
const ph = new Physics();
let skiers: Skier[] = [];
let player: Skier;
interface AI { s: Skier; skill: number; line: number; phase: number; trick: number; mistakeT: number }
let ais: AI[] = [];
type State = "menu" | "countdown" | "race" | "results";
let state: State = "menu";
let raceT = 0;
let countT = 0;
let endT = 0;
let timeScale = 1, slowT = 0;
let tricks = 0;
let shake = 0;

const hitParts: Record<PartName, string> = { pelvis: "hip", chest: "ribs", head: "head", uArmL: "shoulder", lArmL: "wrist", uArmR: "shoulder", lArmR: "wrist", thighL: "thigh", shinL: "shin", thighR: "thigh", shinR: "shin" };
const gearWords: Record<GearName, string> = { helmet: "helmet", poleL: "left pole", poleR: "right pole", bootL: "left boot", bootR: "right boot", skiL: "left ski", skiR: "right ski" };
const crashWords: Record<CrashCause, string[]> = {
  tree: ["TREE'D!", "TIMBER!", "BARK BITE!"], rock: ["ROCKED!", "STONED!"], net: ["NETTED!", "FENCE FACE!"],
  land: ["PANCAKE!", "SPLAT!", "FLAT LANDING!"], edge: ["CAUGHT AN EDGE!", "CARTWHEEL!"], balance: ["WIPEOUT!", "YARD SALE!"], skier: ["TAKEN OUT!", "COLLISION!"],
};

function feed(t: string) {
  const d = document.createElement("div");
  d.textContent = t;
  $("feed").appendChild(d);
  setTimeout(() => d.remove(), 4000);
  while ($("feed").children.length > 4) $("feed").firstChild!.remove();
}
function big(t: string, bad = false, sub = "") {
  const b = $("big");
  b.textContent = t;
  b.className = "";
  void b.offsetWidth;
  b.className = "show" + (bad ? " bad" : "");
  if (sub) { const s = $("sub"); s.textContent = sub; s.className = ""; void s.offsetWidth; s.className = "show"; }
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const near = (s: Skier) => s.pos.distanceTo(player.pos) < 60;

const events = {
  crash(s: Skier, cause: CrashCause, sp: number) {
    burst(s.pos, s.vel, Math.min(60, 10 + sp * 2));
    if (s === player) {
      big(pick(crashWords[cause]), true);
      sfx.crashBig(); sfx.oof(1);
      if (sp > 7) { timeScale = 0.3; slowT = 0.9; }
      shake = Math.min(1, sp / 20);
    } else if (near(s)) { feed(`💥 ${s.name} wiped out`); sfx.thud(0.6, 0.5); }
  },
  gearOff(s: Skier, g: GearName) {
    if (s === player) { feed(`❌ Lost your ${gearWords[g]}!`); sfx.snap(); }
    else if (near(s)) sfx.snap();
  },
  hit(s: Skier, part: PartName, d: number) {
    if (s === player) {
      sfx.thud(d / 12);
      if (d > 7) { sfx.oof(0.9 + Math.random() * 0.4); feed(`🩹 ${d > 14 ? "Smashed" : "Bruised"} ${hitParts[part]}`); }
      shake = Math.max(shake, Math.min(0.8, d / 20));
    } else if (near(s)) sfx.thud(d / 14, 0.4);
  },
  tear(s: Skier, part: PartName) {
    if (s === player) feed(`🧥 ${part.includes("thigh") || part.includes("shin") || part === "pelvis" ? "Pants" : "Jacket"} torn!`);
  },
  trick(s: Skier, deg: number) {
    if (s === player) { tricks++; big(`${deg}!`, false, "Speed boost"); sfx.trick(); }
  },
  land(s: Skier, q: "clean" | "sketchy") {
    burst(s.pos, s.vel, q === "sketchy" ? 30 : 14);
    if (s === player) { sfx.land(); if (q === "sketchy") feed("😬 Sketchy landing"); }
  },
  getUp(s: Skier, lost: GearName[], spare: boolean) {
    if (s !== player) return;
    if (spare) big("SPARE SKIS", true, "+8s penalty");
    else if (lost.length) feed(`Gone for good: ${lost.map((g) => gearWords[g]).join(", ")}`);
    updateGearHud();
  },
  out(s: Skier) {
    if (s === player) { big("KNOCKED OUT", true, "Ski patrol is on the way"); sfx.fail(); }
    else if (near(s)) feed(`🚑 ${s.name} is out`);
  },
};

function startRace(level: number) {
  for (const s of skiers) s.dispose();
  for (const o of litter) scene.remove(o);
  litter.length = 0;
  course = new Course(level);
  buildWorld();
  tracks.count = 0; trI = 0; trLast.y = -999;
  skiers = []; ais = [];
  player = new Skier({ scene, course, ph, ev: events, name: "You", flag: "⭐", isPlayer: true, look: { suit: 0xe53935, pants: 0x212121, helmet: 0xffeb3b, ski: 0xffeb3b }, });
  player.speedMul = 1 + save.wax * 0.03;
  player.bindMul = 1 + save.bind * 0.2;
  player.armor = 1 - save.pad * 0.1;
  skiers.push(player);
  const n = course.opponents;
  const slots = n + 1;
  const me = Math.floor(slots / 2);
  for (let i = 0; i < slots; i++) {
    const x = course.cx(0) + (i - (slots - 1) / 2) * 2.6;
    if (i === me) { player.place(x, -1); continue; }
    const nm = randomName();
    const s = new Skier({ scene, course, ph, ev: events, name: nm.name, flag: nm.flag, isPlayer: false, look: { suit: randomSuit(), pants: randomSuit(), helmet: randomSuit(), ski: randomSuit() } });
    const skill = clamp(course.aiSkill + (Math.random() - 0.5) * 0.35, 0.15, 1);
    s.speedMul = 0.9 + skill * 0.13;
    s.bindMul = 0.9 + Math.random() * 0.4;
    s.place(x, -1);
    skiers.push(s);
    ais.push({ s, skill, line: (Math.random() - 0.5) * 1.2, phase: Math.random() * 6, trick: 0, mistakeT: 2 + Math.random() * 5 });
  }
  raceT = 0; countT = 3.2; endT = 0; tricks = 0;
  state = "countdown";
  document.body.classList.add("racing");
  $("menu").classList.remove("show"); $("results").classList.remove("show");
  $("hint").style.display = "block";
  buildProgress();
  updateGearHud();
  camPos.copy(player.pos).add(new THREE.Vector3(0, 4, -8));
  big(course.name.toUpperCase(), false, course.level === 0 ? "Practice: no rivals, get the feel" : `${n} rivals · ${course.length} m`);
}

// ------------------------------------------------------------------
// AI
// ------------------------------------------------------------------
const tmpObs: import("./course").Obstacle[] = [];
function wrap(a: number) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function think(a: AI, dt: number) {
  const s = a.s, c = course;
  if (s.finished) { s.hold = false; s.steer = 0; s.lean = 0; return; }
  if (s.mode === "air") {
    s.lean = 0;
    // skilled riders try spins on big air
    if (a.trick === 0 && s.airT < 0.05 && s.vel.y > 2 && Math.random() < a.skill * 0.35) a.trick = Math.random() < 0.5 ? 1 : -1;
    if (a.trick && Math.abs(s.spin) < Math.PI * 2 - 0.4) s.steer = a.trick;
    else { s.steer = clamp(wrap(s.yaw - Math.atan2(s.vel.x, s.vel.z)) * 3, -1, 1); }
    return;
  }
  a.trick = 0;
  if (s.mode !== "ski") return;
  const sp = s.speed();
  const look = 9 + sp * 0.75;
  const zt = s.pos.z + look;
  let xt = c.cx(zt) + a.line * c.w(zt) * 0.55 * Math.sin(zt * 0.012 + a.phase);
  let jumpAhead = false;
  for (const jp of c.jumps) if (jp.z - s.pos.z > -1 && jp.z - s.pos.z < 22) { jumpAhead = true; xt = clamp(xt, jp.x - jp.w * 0.6, jp.x + jp.w * 0.6); }
  for (const o of c.near(s.pos.z + look * 0.5, tmpObs, 2)) {
    const dz = o.z - s.pos.z;
    if (dz < 1 || dz > look + 6) continue;
    const xl = s.pos.x + (xt - s.pos.x) * Math.min(1, dz / look);
    const gap = xl - o.x;
    const need = o.r + 1.7 - a.skill * 0.4;
    if (Math.abs(gap) < need) xt += Math.sign(gap || 1) * (need - Math.abs(gap)) * (look / Math.max(2, dz)) * 1.1;
  }
  // other skiers right ahead
  for (const o of skiers) {
    if (o === s || o.mode === "rag") continue;
    const dz = o.pos.z - s.pos.z, dx = o.pos.x - s.pos.x;
    if (dz > 0 && dz < 8 && Math.abs(dx) < 1.6) xt += (dx > 0 ? -1 : 1) * 2.5;
  }
  const lim = c.w(zt) - 2;
  xt = clamp(xt, c.cx(zt) - lim, c.cx(zt) + lim);
  const want = Math.atan2(xt - s.pos.x, look);
  const err = wrap(want - s.yaw);
  s.steer = clamp(-err * (2.4 + a.skill * 1.5), -1, 1);
  s.hold = true;
  const steep = sp > 17 + a.skill * 10;
  s.lean = jumpAhead ? 0.35 : Math.abs(err) < 0.18 && !steep ? 0.55 + a.skill * 0.45 : 0.25;
  a.mistakeT -= dt;
  if (a.mistakeT < 0) {
    a.mistakeT = 3 + Math.random() * 8 * (0.5 + a.skill);
    if (Math.random() < 0.55 - a.skill * 0.4) s.balV += (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 2.2) * (1 - a.skill * 0.5);
  }
}

// ------------------------------------------------------------------
// input: hold = stay up, slide up = lean forward, drag sideways = steer
// ------------------------------------------------------------------
const input = { down: false, x0: 0, y0: 0, steer: 0, lean: 0, kb: false };
const keys = new Set<string>();
renderer.domElement.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  input.down = true; input.kb = false;
  input.x0 = e.clientX; input.y0 = e.clientY;
  input.steer = 0; input.lean = 0;
  $("hint").style.display = "none";
});
window.addEventListener("pointermove", (e) => {
  if (!input.down) return;
  const w = Math.min(window.innerWidth, 700);
  input.steer = clamp((e.clientX - input.x0) / (w * 0.22), -1, 1);
  input.lean = clamp((input.y0 - e.clientY) / (window.innerHeight * 0.16), 0, 1);
  // let the anchor follow so you never run out of screen
  if (Math.abs(e.clientX - input.x0) > w * 0.3) input.x0 = e.clientX - Math.sign(e.clientX - input.x0) * w * 0.3;
  if (input.y0 - e.clientY > window.innerHeight * 0.22) input.y0 = e.clientY + window.innerHeight * 0.22;
  if (e.clientY > input.y0) input.y0 = e.clientY;
});
const up = () => { input.down = false; input.steer = 0; input.lean = 0; };
window.addEventListener("pointerup", up);
window.addEventListener("pointercancel", up);
window.addEventListener("keydown", (e) => { keys.add(e.key); input.kb = true; sfx.unlock(); $("hint").style.display = "none"; });
window.addEventListener("keyup", (e) => keys.delete(e.key));
let autoPlayer: AI | null = null;
function readInput() {
  if (autoPlayer) { think(autoPlayer, DT); return; }
  if (input.kb && !input.down) {
    const l = keys.has("ArrowLeft") || keys.has("a"), r = keys.has("ArrowRight") || keys.has("d");
    player.steer = (r ? 1 : 0) - (l ? 1 : 0);
    player.lean = keys.has("ArrowUp") || keys.has("w") ? 1 : 0;
    player.hold = !(keys.has("ArrowDown") || keys.has("s"));
    return;
  }
  player.hold = input.down;
  player.steer = input.steer;
  player.lean = input.lean;
}

// ------------------------------------------------------------------
// HUD
// ------------------------------------------------------------------
const GEAR_ICON: [GearName, string][] = [["helmet", "⛑"], ["skiL", "Ski L"], ["skiR", "Ski R"], ["bootL", "Boot L"], ["bootR", "Boot R"], ["poleL", "Pole L"], ["poleR", "Pole R"]];
function updateGearHud() {
  $("gear").innerHTML = GEAR_ICON.map(([g, t]) => `<span class="${player.gear[g].on && (player.mode !== "rag" || player.gear[g].lock) ? "" : "off"}">${t}</span>`).join("");
}
let dots: HTMLElement[] = [];
function buildProgress() {
  const p = $("prog");
  p.innerHTML = "";
  dots = skiers.map((s) => {
    const b = document.createElement("b");
    if (s === player) b.className = "me";
    else b.style.background = "#" + new THREE.Color(s.look.suit).getHexString();
    p.appendChild(b);
    return b;
  });
}
const ord = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
function standings() {
  const fin = skiers.filter((s) => s.finished).sort((a, b) => a.finishTime + a.penalty - (b.finishTime + b.penalty));
  const run = skiers.filter((s) => !s.finished && !s.dnf).sort((a, b) => b.pos.z - a.pos.z);
  const dnf = skiers.filter((s) => s.dnf && !s.finished);
  return [...fin, ...run, ...dnf];
}
let hudT = 0;
function hud(dt: number) {
  hudT -= dt;
  const ks = Math.round(player.speed() * 3.6);
  $("spd").innerHTML = `${ks}<small>km/h</small>`;
  $("time").textContent = fmt(raceT) + (player.penalty ? ` +${player.penalty}s` : "");
  ($("hpfill") as HTMLElement).style.width = player.health + "%";
  ($("leanfill") as HTMLElement).style.height = (player.hold ? player.lean * 100 : 0) + "%";
  skiers.forEach((s, i) => { dots[i].style.left = clamp(s.pos.z / course.length, 0, 1) * 100 + "%"; });
  if (hudT > 0) return;
  hudT = 0.2;
  const st = standings();
  const n = skiers.length;
  if (n > 1) $("pos").innerHTML = `${st.indexOf(player) + 1}<small>${ord(st.indexOf(player) + 1).slice(-2)} / ${n}</small>`;
  else $("pos").innerHTML = `<small>TRIAL</small>`;
  updateGearHud();
}

// ------------------------------------------------------------------
// results
// ------------------------------------------------------------------
function finishRace() {
  state = "results";
  document.body.classList.remove("racing");
  // anyone still going gets a projected time
  for (const s of skiers) {
    if (s.finished || s.dnf) continue;
    const left = course.length - s.pos.z;
    s.finished = true;
    s.finishTime = raceT + left / Math.max(6, s.pos.z / Math.max(1, raceT));
  }
  const st = standings();
  const place = player.dnf ? 0 : st.indexOf(player) + 1;
  const trial = course.level === 0;
  const podium = !player.dnf && (trial || place <= 3);
  $("medal").textContent = player.dnf ? "🚑" : trial ? "🎿" : ["", "🥇", "🥈", "🥉"][place] || "🏁";
  $("rtitle").textContent = player.dnf ? "Did not finish" : trial ? "Trial complete!" : `${ord(place)} place`;
  $("rsub").textContent = `${course.name} · Level ${course.level}`;
  $("table").innerHTML = st.map((s, i) => `<div class="row ${s === player ? "me" : ""}"><span>${s.dnf ? "–" : i + 1}. ${s.flag} ${s.name}</span><span class="t ${s.dnf ? "dnf" : ""}">${s.dnf ? "DNF" : fmt(s.finishTime + s.penalty)}</span></div>`).join("");
  const inj = player.injuries();
  const lost = player.lostGear.map((g) => gearWords[g]);
  $("inj").innerHTML = (inj.length ? inj.join("<br>") : "Not a scratch. Boring!") +
    (lost.length ? `<br>Left on the mountain: ${lost.join(", ")}` : "") +
    `<br><span style="color:#546e7a">Crashes: ${player.crashes} · Health ${Math.round(player.health)}%</span>`;
  let earn = 0;
  if (!player.dnf) earn = trial ? 30 : ([0, 100, 60, 40][place] || 15);
  earn = Math.round(earn * (1 + course.level * 0.1)) + tricks * 10;
  save.coins += earn;
  if (podium && course.level >= save.unlocked) { save.unlocked = course.level + 1; save.best = Math.max(save.best, save.unlocked); P.sendScore(save.unlocked); }
  save.level = podium ? course.level + 1 : course.level;
  persist();
  $("earn").textContent = `+${earn} 🪙` + (tricks ? ` (${tricks} trick${tricks > 1 ? "s" : ""})` : "");
  ($("next") as HTMLButtonElement).style.display = podium ? "" : "none";
  $("next").textContent = trial ? "First race" : "Next level";
  $("retry").textContent = podium ? "Race again" : "Try again (top 3 to advance)";
  $("results").classList.add("show");
  if (podium) sfx.cheer(); else sfx.fail();
}
$("next").onclick = () => { sfx.click(); startRace(course.level + 1); };
$("retry").onclick = () => { sfx.click(); startRace(course.level); };
$("tomenu").onclick = () => { sfx.click(); showMenu(); };

// ------------------------------------------------------------------
// menu + shop
// ------------------------------------------------------------------
let menuLevel = 0;
const UPG: { k: "wax" | "bind" | "pad"; name: string; desc: string }[] = [
  { k: "wax", name: "Race wax", desc: "Less drag, more top speed" },
  { k: "bind", name: "Tight bindings", desc: "Skis stay on in crashes" },
  { k: "pad", name: "Body armor", desc: "Fewer bruises and injuries" },
];
const cost = (lv: number) => 80 + lv * lv * 60 + lv * 60;
function showMenu() {
  state = "menu";
  document.body.classList.remove("racing");
  $("results").classList.remove("show");
  $("menu").classList.add("show");
  menuLevel = clamp(save.level, 0, save.unlocked);
  renderMenu();
}
function renderMenu() {
  const c = new Course(menuLevel);
  $("mname").textContent = c.name;
  $("mlv").textContent = menuLevel === 0 ? "Practice route · no rivals" : `${c.opponents} rivals · ${c.length} m · ${c.jumps.length} jumps`;
  $("mlvn").textContent = `Level ${menuLevel}`;
  ($("lvprev") as HTMLButtonElement).disabled = menuLevel <= 0;
  ($("lvnext") as HTMLButtonElement).disabled = menuLevel >= save.unlocked;
  $("mcoins").textContent = `🪙 ${save.coins}`;
  $("shop").innerHTML = UPG.map((u) => {
    const lv = save[u.k], max = lv >= 5, cst = cost(lv);
    return `<div class="row"><span>${u.name} ${"●".repeat(lv)}${"○".repeat(5 - lv)}<small>${u.desc}</small></span><button data-k="${u.k}" ${max || save.coins < cst ? "disabled" : ""}>${max ? "MAX" : "🪙 " + cst}</button></div>`;
  }).join("");
  $("shop").querySelectorAll("button").forEach((b) => {
    (b as HTMLButtonElement).onclick = () => {
      const k = (b as HTMLElement).dataset.k as "wax" | "bind" | "pad";
      const cst = cost(save[k]);
      if (save.coins < cst || save[k] >= 5) return;
      save.coins -= cst; save[k]++;
      persist(); sfx.coin(); renderMenu();
    };
  });
}
$("lvprev").onclick = () => { menuLevel = Math.max(0, menuLevel - 1); sfx.click(); renderMenu(); };
$("lvnext").onclick = () => { menuLevel = Math.min(save.unlocked, menuLevel + 1); sfx.click(); renderMenu(); };
$("go").onclick = () => { sfx.unlock(); sfx.click(); startRace(menuLevel); };

// ------------------------------------------------------------------
// loop
// ------------------------------------------------------------------
const camPos = new THREE.Vector3(0, 10, -10);
const camLook = new THREE.Vector3();
const camDir = new THREE.Vector3(0, 0, 1);
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3();
let acc = 0;

function physicsStep(dt: number) {
  for (const a of ais) think(a, dt);
  for (const s of skiers) s.step(dt);
  // skier vs skier
  for (let i = 0; i < skiers.length; i++) for (let j = i + 1; j < skiers.length; j++) {
    const a = skiers[i], b = skiers[j];
    if ((a.mode !== "ski" && a.mode !== "air") || (b.mode !== "ski" && b.mode !== "air")) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 0.75 * 0.75 || Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
    const rel = tv.copy(a.vel).sub(b.vel);
    const d = Math.sqrt(d2) || 0.01;
    const closing = (rel.x * dx + rel.z * dz) / d;
    if (closing > 5 && a.invuln <= 0 && b.invuln <= 0) {
      const push = tv2.set(dx / d, 0.3, dz / d).multiplyScalar(closing * 0.4);
      b.crash("skier", push);
      if (Math.random() < 0.6) a.crash("skier", push.clone().multiplyScalar(-0.5));
    } else {
      const k = (0.75 - d) * 0.5;
      a.pos.x -= (dx / d) * k; a.pos.z -= (dz / d) * k;
      b.pos.x += (dx / d) * k; b.pos.z += (dz / d) * k;
    }
  }
  ph.world.step(dt);
  for (const s of skiers) s.checkBreaks();
}

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) return;
  if (slowT > 0) { slowT -= dt; if (slowT <= 0) timeScale = 1; }
  if (state === "countdown") {
    const before = Math.ceil(countT);
    countT -= dt;
    const after = Math.ceil(countT);
    if (after !== before && after > 0 && after <= 3) { big(String(after)); sfx.beep(); }
    if (countT <= 0) {
      state = "race"; big("GO!"); sfx.beep(true);
      for (const s of skiers) s.started = true;
    }
  }
  if (state === "race" || state === "countdown") {
    readInput();
    acc += dt * timeScale;
    let n = 0;
    while (acc >= DT && n < 8) { physicsStep(DT); acc -= DT; n++; }
    if (state === "race") raceT += dt * timeScale;
    for (const s of skiers) {
      if (!s.finished && !s.dnf && s.pos.z >= course.length && s.started) {
        s.finished = true; s.finishTime = raceT;
        if (s === player) { big("FINISH!", false, fmt(raceT + s.penalty)); sfx.cheer(); }
      }
    }
    if (state === "race" && (player.finished || player.dnf)) {
      endT += dt;
      if (endT > (player.dnf ? 3.5 : 3)) finishRace();
    }
    hud(dt);
    sfx.ride(player.mode === "rag" ? 0 : player.speed(), player.skid, player.mode === "air", player.carve);
    for (const s of skiers) if (s.pos.distanceToSquared(player.pos) < 50 * 50) sprayFrom(s, dt * timeScale);
    trackFrom(player);
    landingWarning(dt);
  }
  for (const s of skiers) s.render(dt * timeScale);
  updateSpray(dt * timeScale);
  updateCamera(dt);
  renderer.render(scene, camera);
}

let warnT = 0, warnTxt = "";
function landingWarning(dt: number) {
  warnT -= dt;
  if (warnT > 0) return;
  warnT = 0.1;
  let txt = "";
  if (player.mode === "air" && player.airT > 0.1) {
    const p = player.predictLanding();
    if (p.t > 0.12) {
      if (p.mis > 0.7 && p.mis < 2.4) txt = "↺ STRAIGHTEN YOUR SKIS";
      else if (p.vn > 13.5 && !player.hold) txt = "⚠ HARD LANDING! HOLD ON";
      else if (p.vn > 12 && player.lean > 0.6) txt = "⚠ HARD LANDING! STAND UP, DON'T TUCK";
      else if (p.vn > 15.5) txt = "⚠ TOO BIG! BRACE!";
    }
  }
  if (txt === warnTxt) return;
  warnTxt = txt;
  $("warn").innerHTML = txt ? `<span>${txt}</span>` : "";
  $("warn").classList.toggle("show", !!txt);
}

function updateCamera(dt: number) {
  if (!player) {
    camera.position.set(0, 12, -20); camera.lookAt(0, 0, 20); return;
  }
  const f = player.focus(tv);
  const rag = player.mode === "rag" || player.mode === "out";
  if (!rag && player.speed() > 2) {
    tv2.set(player.vel.x, 0, player.vel.z).normalize();
    camDir.lerp(tv2, 1 - Math.exp(-2.5 * dt)).normalize();
  } else if (!rag) {
    tv2.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    camDir.lerp(tv2, 1 - Math.exp(-2 * dt)).normalize();
  }
  const sp = player.speed();
  const back = rag ? 3.8 : 5.2 + Math.min(3, sp * 0.1);
  const high = rag ? 2.0 : 2.3 + Math.min(1.2, sp * 0.03);
  const want = tv2.copy(f).addScaledVector(camDir, -back);
  want.y = Math.max(want.y, course.height(want.x, want.z) + 1.2) + high;
  camPos.lerp(want, 1 - Math.exp(-(rag ? 4 : 6) * dt));
  const gh = course.height(camPos.x, camPos.z) + 0.8;
  if (camPos.y < gh) camPos.y = gh;
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * shake * 0.4;
    shake = Math.max(0, shake - dt * 2.5);
  }
  camLook.lerp(tv2.copy(f).addScaledVector(camDir, rag ? 0 : 5), 1 - Math.exp(-8 * dt));
  camera.lookAt(camLook);
  camera.fov += ((camera.aspect < 0.7 ? 70 : camera.aspect < 1.2 ? 62 : 52) + (rag ? 0 : Math.min(12, sp * 0.35)) - camera.fov) * (1 - Math.exp(-3 * dt));
  camera.updateProjectionMatrix();
  sun.position.copy(f).add(new THREE.Vector3(-12, 30, -10));
  sun.target.position.copy(f);
}

// ------------------------------------------------------------------
// boot
// ------------------------------------------------------------------
(async () => {
  try {
    const s = await P.loadSave(GAME_ID);
    if (s) save = { ...save, ...JSON.parse(s) };
  } catch { /* fresh start */ }
  course = new Course(clamp(save.level, 0, save.unlocked));
  buildWorld();
  // a menu backdrop with a skier standing at the start
  player = new Skier({ scene, course, ph, ev: events, name: "You", flag: "⭐", isPlayer: true, look: { suit: 0xe53935, pants: 0x212121, helmet: 0xffeb3b, ski: 0xffeb3b } });
  player.place(course.cx(0), -1);
  skiers = [player];
  camPos.set(course.cx(0) + 3, course.height(0, -1) + 2.2, -5);
  showMenu();
  requestAnimationFrame(frame);
  P.firstFrameReady();
  P.gameReady();
})();

if (DEBUG) {
  (window as unknown as { ys: unknown }).ys = {
    start: startRace,
    get player() { return player; },
    get skiers() { return skiers; },
    get course() { return course; },
    get state() { return state; },
    set timeScale(v: number) { timeScale = v; },
    step(n: number) { for (let i = 0; i < n; i++) physicsStep(DT); },
    input,
    auto(on: boolean) { autoPlayer = on ? { s: player, skill: 0.8, line: 0.3, phase: 1, trick: 0, mistakeT: 99 } : null; },
    tick(n: number) { for (let i = 0; i < n; i++) { readInput(); physicsStep(DT); raceT += DT; for (const s of skiers) if (!s.finished && !s.dnf && s.pos.z >= course.length) { s.finished = true; s.finishTime = raceT; } } },
    go() { state = "race"; for (const s of skiers) s.started = true; },
    finishRace,
    save: () => save,
  };
}
