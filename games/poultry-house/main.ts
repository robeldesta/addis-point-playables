// Poultry House: a walk-through demo of EcoGreen's AI camera system for management.
// Roam the house, tap anything, watch the staff work (or take one over), look through
// any camera, and see what the AI computer logs.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as P from "../../src/platform/platform";
import { DEFAULT_DIMS, GATE_W, Layout, buildLayout, center, inRect, mountY, rectD, rectW, roofY } from "./sim/layout";
import { CoverMap, Gear, LENS, autoPlace, coversBackDoor, coversDoor, coversEggTable, coversFeedStore, footprint } from "./sim/gear";
import { Alert, DEAD, Flock, GONE, HEALTHY, SICK } from "./sim/flock";
import { Staff, Worker } from "./sim/staff";
import { CRATE, Kpi, emptyKpi } from "./sim/records";
import { Person, makePerson, posePerson } from "./person";

// ------------------------------------------------------------------ state
const L: Layout = buildLayout(DEFAULT_DIMS);
const gears: Gear[] = autoPlace(L, "2.8");
const cover = new CoverMap(L, gears);
const flock = new Flock(L);
flock.setWeeks(24); // show the house as it will run: laying hens
flock.time = 5 * 60 + 20; // start before dawn, just before the first incident
flock.cover = cover;
flock.doorCam = coversDoor(L, gears);
flock.feedCam = coversFeedStore(L, gears);
flock.setSensors(gears.filter((g) => g.kind === "sensor").map((g) => ({ x: g.x, z: g.z })));
const staff = new Staff(L, flock);
staff.eggCamera = coversEggTable(L, gears);
staff.doorCamera = flock.doorCam;
staff.backDoorCamera = coversBackDoor(L, gears);
staff.feedCamera = flock.feedCam;

type Sel =
  | { kind: "cam"; g: Gear }
  | { kind: "sensor"; g: Gear }
  | { kind: "hen"; i: number }
  | { kind: "worker"; w: Worker }
  | { kind: "feeder"; k: number }
  | { kind: "drinker"; k: number }
  | { kind: "nest"; k: number }
  | { kind: "table" | "pc" | "store" | "scale" | "maindoor" | "backdoor" };
let sel: Sel | null = null;
let follow: Worker | null = null;
let speed = 1;
let view: "house" | "cams" = "house";

// ------------------------------------------------------------------ renderer
P.initPlatform();
const host = document.getElementById("game")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }) // the camera wall redraws two thumbnails a frame and keeps the rest;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.autoClear = false;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.5;
controls.maxDistance = 120;
controls.screenSpacePanning = false; // panning slides along the floor
const hemi = new THREE.HemisphereLight(0xfff6e0, 0x5a4a38, 1.7);
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(-20, 40, 15);
scene.add(hemi, sun);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fullRedraw = true;
}
window.addEventListener("resize", resize);

function startView() {
  // Standing above the main door, looking down the house.
  const portrait = camera.aspect < 0.8;
  controls.target.set(0, 0, L.hl - (portrait ? 22 : 16));
  camera.position.set(-2, portrait ? 26 : 17, L.hl + (portrait ? 14 : 8));
  controls.update();
}

function flyTo(x: number, z: number, dist = 9) {
  const off = camera.position.clone().sub(controls.target);
  off.setLength(dist);
  if (off.y < dist * 0.35) off.y = dist * 0.6;
  controls.target.set(x, 0, z);
  camera.position.set(x + off.x, off.y, z + off.z);
  controls.update();
}

// ------------------------------------------------------------------ helpers
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mat = (color: number) => new THREE.MeshLambertMaterial({ color });
const basic = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const hhmm = (t: number) => {
  const m = Math.floor(t % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const labels: THREE.Sprite[] = []; // hidden when rendering what a camera sees
function label(text: string, size = 1, color = "#fff"): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 44px system-ui, Arial";
  c.width = Math.ceil(ctx.measureText(text).width) + 36;
  c.height = 64;
  ctx.font = "bold 44px system-ui, Arial";
  ctx.fillStyle = "rgba(28,24,20,.78)";
  ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, 18); ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 18, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((c.width / c.height) * size, size, 1);
  s.renderOrder = 10;
  labels.push(s);
  return s;
}

/** Things you can tap. Each mesh carries what it stands for. */
const pickables: THREE.Object3D[] = [];
function pickable<T extends THREE.Object3D>(o: T, s: Sel | ((id: number) => Sel)): T {
  o.userData.sel = s;
  pickables.push(o);
  return o;
}

// ------------------------------------------------------------------ world
const world = new THREE.Group();
const gearGroup = new THREE.Group(); // camera domes etc. (hidden from camera pictures)
const overlayGroup = new THREE.Group(); // selection ring, footprint, AI marks (hidden from camera pictures)
scene.add(world, gearGroup, overlayGroup);

const PX = 24; // floor texture pixels per metre
const floorCanvas = document.createElement("canvas");
floorCanvas.width = Math.ceil(L.dims.width * PX);
floorCanvas.height = Math.ceil(L.dims.length * PX);
const floorCtx = floorCanvas.getContext("2d")!;
const floorTex = new THREE.CanvasTexture(floorCanvas);
floorTex.colorSpace = THREE.SRGBColorSpace;
floorTex.anisotropy = 4;

function wallTexture(lenM: number, hM: number, windows: boolean): THREE.CanvasTexture {
  const ppm = 20;
  const c = document.createElement("canvas");
  c.width = Math.min(2048, Math.ceil(lenM * ppm));
  c.height = Math.ceil(hM * ppm);
  const sx = c.width / lenM;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#b9b7b1";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(90,88,84,.55)";
  ctx.lineWidth = 1;
  for (let y = 0, row = 0; y < c.height; y += 0.2 * ppm, row++) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
    for (let x = (row % 2) * 0.2 * sx; x < c.width; x += 0.4 * sx) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 0.2 * ppm); ctx.stroke();
    }
  }
  ctx.fillStyle = "rgba(120,118,112,.9)";
  for (let x = 0; x <= lenM; x += 5) ctx.fillRect(x * sx - 0.15 * sx, 0, 0.3 * sx, c.height);
  if (windows) {
    ctx.fillStyle = "#f1f6f8";
    for (let x = 0; x < lenM - 0.5; x += 5) ctx.fillRect(x * sx + 0.3 * sx, 0.15 * ppm, 4.4 * sx, 0.9 * ppm);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let floorMesh: THREE.Mesh;
let birdBody: THREE.InstancedMesh;
let birdHead: THREE.InstancedMesh;
let markerMesh: THREE.InstancedMesh;
let eggMesh: THREE.InstancedMesh;
let trayMesh: THREE.InstancedMesh;
let bagsGroup: THREE.Group;
let sacksGroup: THREE.Group;
let crew: { p: Person; tag: THREE.Sprite; text: string }[] = [];
const MAX_MARKERS = 400;
const MAX_EGGS = 4000;
const MAX_TRAYS = 18 * 12; // 6 x 3 stacks on the table, up to 12 trays high

function buildWorld() {
  const { hw, hl } = L;
  const d = L.dims;
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(d.width, d.length), new THREE.MeshLambertMaterial({ map: floorTex }));
  floorMesh.rotation.x = -Math.PI / 2;
  world.add(floorMesh);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(d.width + 80, d.length + 80), mat(0x6b7a45));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  world.add(ground);

  // Walls face inward, so you can always see in from outside.
  const walls: [number, number, number, number, boolean][] = [
    [d.width, 0, hl, Math.PI, false],
    [d.width, 0, -hl, 0, false],
    [d.length, -hw, 0, Math.PI / 2, true],
    [d.length, hw, 0, -Math.PI / 2, true],
  ];
  for (const [len, x, z, ry, win] of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, d.eave), new THREE.MeshLambertMaterial({ map: wallTexture(len, d.eave, win) }));
    m.position.set(x, d.eave / 2, z);
    m.rotation.y = ry;
    world.add(m);
  }
  const door = (p: { x: number; z: number }, w: number, color: number, inward: number, name: string, s: Sel) => {
    const m = pickable(new THREE.Mesh(new THREE.PlaneGeometry(w, 3.2), mat(color)), s);
    m.position.set(p.x, 1.6, p.z + inward * 0.03);
    m.rotation.y = inward > 0 ? 0 : Math.PI;
    world.add(m);
    const l = label(name, 0.6);
    l.position.set(p.x, 3.7, p.z + inward * 0.5);
    world.add(l);
  };
  door(L.mainDoor, 3, 0xa52a2a, -1, "Main door", { kind: "maindoor" });
  door(L.backDoor, 2.4, 0x1e8a6a, 1, "Back door", { kind: "backdoor" });

  // Steel trusses and purlins (the roof sheets are left off so you can see in).
  const pts: number[] = [];
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (const z of L.trusses) {
    const top = (x: number) => V(x, roofY(L, x), z);
    const bot = (x: number) => V(x, roofY(L, x) - 0.6, z);
    seg(top(-hw), top(0)); seg(top(0), top(hw)); seg(bot(-hw), bot(0)); seg(bot(0), bot(hw));
    for (let x = -hw, k = 0; x < hw - 1e-6; x += 1, k++) {
      seg(bot(x), top(x));
      seg(k % 2 ? bot(x) : top(x), k % 2 ? top(Math.min(hw, x + 1)) : bot(Math.min(hw, x + 1)));
    }
  }
  for (let x = -hw; x <= hw + 1e-6; x += d.width / 12) seg(V(x, roofY(L, x), -hl), V(x, roofY(L, x), hl));
  const trussGeo = new THREE.BufferGeometry();
  trussGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  world.add(new THREE.LineSegments(trussGeo, new THREE.LineBasicMaterial({ color: 0xc0472b })));

  // Low block walls with wire mesh between pens, with gates.
  const edges = new Map<string, [number, number, number, number]>();
  for (const p of L.pens) {
    const e: [number, number, number, number][] = [[p.x0, p.z0, p.x1, p.z0], [p.x0, p.z1, p.x1, p.z1], [p.x0, p.z0, p.x0, p.z1], [p.x1, p.z0, p.x1, p.z1]];
    for (const [x0, z0, x1, z1] of e) {
      const onShell = (x0 === x1 && Math.abs(Math.abs(x0) - hw) < 1e-6) || (z0 === z1 && Math.abs(Math.abs(z0) - hl) < 1e-6);
      if (!onShell) edges.set([x0, z0, x1, z1].map((v) => v.toFixed(2)).join(","), [x0, z0, x1, z1]);
    }
  }
  const pieces: [number, number, number, number][] = [];
  for (const [x0, z0, x1, z1] of edges.values()) {
    const cuts = z0 === z1 ? L.gates.filter((g) => Math.abs(g.z - z0) < 1e-3 && g.x > Math.min(x0, x1) && g.x < Math.max(x0, x1)).map((g) => g.x).sort((a, b) => a - b) : [];
    let start = Math.min(x0, x1);
    for (const gx of cuts) { pieces.push([start, z0, gx - GATE_W / 2, z0]); start = gx + GATE_W / 2; }
    pieces.push(z0 === z1 ? [start, z0, Math.max(x0, x1), z1] : [x0, z0, x1, z1]);
  }
  const gateMat = mat(0x8d6e4a);
  for (const g of L.gates) {
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.1), gateMat);
      post.position.set(g.x + (s * GATE_W) / 2, 0.95, g.z);
      world.add(post);
    }
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(GATE_W - 0.1, 1.1, 0.05), gateMat);
    leaf.position.set(g.x - GATE_W / 2 + 0.05, 0.6, g.z - (GATE_W - 0.1) / 2);
    leaf.rotation.y = Math.PI / 2;
    world.add(leaf);
  }
  const blockMat = mat(0x9e9c96);
  const meshMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  for (const [x0, z0, x1, z1] of pieces) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) continue;
    const along = x0 === x1 ? Math.PI / 2 : 0;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 0.2), blockMat);
    wall.position.set((x0 + x1) / 2, 0.3, (z0 + z1) / 2);
    wall.rotation.y = along;
    const net = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), meshMat);
    net.position.set((x0 + x1) / 2, 1.2, (z0 + z1) / 2);
    net.rotation.y = along;
    world.add(wall, net);
  }
  for (const p of L.pens) {
    const s = label(p.name, 0.8, p.active ? "#fff" : "#c9bba8");
    const c = center(p);
    s.position.set(c.x, 2.6, c.z);
    world.add(s);
  }

  // Feeders, drinkers, nest boxes.
  const dummy = new THREE.Object3D();
  const feeders = pickable(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.24, 0.32, 12), mat(0xd32f2f), L.feeders.length), (k) => ({ kind: "feeder", k }));
  const lids = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 12), mat(0x222222), L.feeders.length);
  L.feeders.forEach((f, i) => {
    dummy.position.set(f.x, 0.16, f.z); dummy.updateMatrix(); feeders.setMatrixAt(i, dummy.matrix);
    dummy.position.set(f.x, 0.34, f.z); dummy.updateMatrix(); lids.setMatrixAt(i, dummy.matrix);
  });
  const drk = pickable(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.15, 0.38, 10), mat(0xf4f4f0), L.drinkers.length), (k) => ({ kind: "drinker", k }));
  const base = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 14), mat(0xd32f2f), L.drinkers.length);
  L.drinkers.forEach((f, i) => {
    dummy.position.set(f.x, 0.22, f.z); dummy.updateMatrix(); drk.setMatrixAt(i, dummy.matrix);
    dummy.position.set(f.x, 0.03, f.z); dummy.updateMatrix(); base.setMatrixAt(i, dummy.matrix);
  });
  world.add(feeders, lids, drk, base);
  const nestMat = mat(0x8d6e4a);
  L.nests.forEach((n, k) => {
    const b = pickable(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.9), nestMat), { kind: "nest", k });
    b.position.set(n.x, 0.45, n.z);
    world.add(b);
  });

  // Aisle: feed store, egg table, AI computer.
  bagsGroup = new THREE.Group();
  world.add(bagsGroup);
  const fs = L.feedStore;
  const store = pickable(new THREE.Mesh(new THREE.BoxGeometry(rectW(fs), 0.05, rectD(fs)), mat(0x7b6a55)), { kind: "store" });
  store.position.set((fs.x0 + fs.x1) / 2, 0.025, (fs.z0 + fs.z1) / 2);
  const fsL = label("Feed store", 0.6);
  fsL.position.set((fs.x0 + fs.x1) / 2, 2.2, (fs.z0 + fs.z1) / 2);
  const et = L.eggTable;
  const table = pickable(new THREE.Mesh(new THREE.BoxGeometry(rectW(et), 0.9, rectD(et)), mat(0x9c6b3e)), { kind: "table" });
  table.position.set((et.x0 + et.x1) / 2, 0.45, (et.z0 + et.z1) / 2);
  const etL = label("Egg table", 0.6);
  etL.position.set(table.position.x, 2, table.position.z);
  const pc = pickable(new THREE.Group(), { kind: "pc" });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.5), mat(0x222222));
  tower.position.set(0.2, 1.05, 0);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.6), mat(0x6d5a44));
  desk.position.y = 0.4;
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.04), mat(0x111111));
  screen.position.set(-0.25, 1.05, 0.15);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.32), basic(0x2e7d32));
  glow.position.set(-0.25, 1.05, 0.125); glow.rotation.y = Math.PI;
  pc.add(desk, tower, screen, glow);
  pc.position.set(L.pc.x - 0.3, 0, L.pc.z - 0.2);
  const pcL = label("AI computer", 0.55);
  pcL.position.set(L.pc.x - 0.6, 1.9, L.pc.z);
  // Litter scale: sacks of litter are weighed here, then go to fertilizer production.
  sacksGroup = new THREE.Group();
  const ls = L.litterScale;
  const scale = pickable(new THREE.Group(), { kind: "scale" });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 1.1), mat(0x8a9399));
  plate.position.y = 0.04;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), mat(0x555b60));
  post.position.set(0.5, 0.55, 0.5);
  const dial = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.08), mat(0x222222));
  dial.position.set(0.5, 1.15, 0.5);
  scale.add(plate, post, dial);
  scale.position.set(ls.x, 0, ls.z);
  const lsL = label("Litter scale", 0.55);
  lsL.position.set(ls.x, 1.9, ls.z);
  world.add(store, fsL, table, etL, pc, pcL, scale, lsL, sacksGroup);

  // Birds: an instanced body and head for every bird.
  birdBody = pickable(new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat(0xffffff), flock.n), (i) => ({ kind: "hen", i }));
  birdHead = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat(0xffffff), flock.n);
  birdBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birdHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tint = new THREE.Color();
  for (let i = 0; i < flock.n; i++) { birdBody.setColorAt(i, tint); birdHead.setColorAt(i, tint); }
  world.add(birdBody, birdHead);

  markerMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.26, 0.36, 20).rotateX(-Math.PI / 2), basic(0xffffff), MAX_MARKERS);
  markerMesh.renderOrder = 5;
  overlayGroup.add(markerMesh);
  eggMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat(0xf3e2c3), MAX_EGGS);
  trayMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.045, 0.3), mat(0xb9a98c), MAX_TRAYS);
  trayMesh.count = 0;
  // These move every frame; their cached bounds go stale, so never cull them (it hid eggs from the egg camera).
  for (const m of [eggMesh, trayMesh, markerMesh, birdHead]) m.frustumCulled = false;
  world.add(eggMesh, trayMesh);

  // The people.
  crew = staff.workers.map((w) => {
    const look = w.role === "vet" ? { coat: 0xf4f4f4, trousers: 0x455a64, hat: 0 }
      : w.role === "stranger" ? { coat: 0x2b2b2b, trousers: 0x1a1a1a, hat: 0x111111, skin: 0x4a3020 }
      : w.role === "visitor" ? [{ coat: 0x8d5524, trousers: 0x3e2723, hat: 0xd84315 }, { coat: 0x6a1b9a, trousers: 0x263238, hat: 0 }, { coat: 0x558b2f, trousers: 0x33691e, hat: 0xfbc02d }][(w.id - 4) % 3]
      : { coat: w.side < 0 ? 0x1f4e8c : 0x2e6b3a, trousers: w.side < 0 ? 0x1f4e8c : 0x2e6b3a, hat: 0xf5c542, skin: w.side < 0 ? 0x5a3a28 : 0x7a5038 };
    const p = makePerson(look);
    p.root.traverse((o) => { o.userData.sel = { kind: "worker", w } as Sel; });
    pickables.push(p.root);
    const tag = workerTag();
    world.add(p.root, tag);
    return { p, tag, text: "" };
  });
  drawFloor();
  updateBags();
}

function updateBags() {
  bagsGroup.clear();
  const fs = L.feedStore;
  const n = Math.min(40, Math.ceil(Math.max(0, flock.stats.feedBags) / 3));
  const m = mat(0xf0ece4);
  const geo = new THREE.BoxGeometry(0.55, 0.18, 0.85);
  for (let k = 0; k < n; k++) {
    const b = new THREE.Mesh(geo, m);
    const col = k % 5, layer = Math.floor(k / 5);
    b.position.set(fs.x0 + 0.35 + col * 0.58, 0.09 + layer * 0.19, (fs.z0 + fs.z1) / 2);
    bagsGroup.add(b);
  }
}

/** Litter sacks waiting by the scale for the fertilizer plant. */
function updateSacks() {
  sacksGroup.clear();
  const ls = L.litterScale;
  const m = mat(0x5d4a36);
  const geo = new THREE.SphereGeometry(0.24, 10, 8);
  const n = Math.min(24, staff.rec.litterSacks);
  for (let k = 0; k < n; k++) {
    const b = new THREE.Mesh(geo, m);
    b.scale.set(1, 1.25, 0.9);
    const col = k % 6, layer = Math.floor(k / 6);
    b.position.set(ls.x + 0.9 + (col % 3) * 0.48, 0.3 + layer * 0.42, ls.z - 0.4 + Math.floor(col / 3) * 0.5);
    sacksGroup.add(b);
  }
}

let strawPattern: CanvasPattern | null = null;
function straw(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (strawPattern) return strawPattern;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 420; k++) {
    const x = r() * 96, y = r() * 96, a = r() * Math.PI, l = 2 + r() * 7;
    g.strokeStyle = r() < 0.55 ? `rgba(245,222,160,${0.35 + r() * 0.4})` : `rgba(120,90,45,${0.25 + r() * 0.35})`;
    g.lineWidth = 0.6 + r() * 0.9;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  strawPattern = ctx.createPattern(c, "repeat")!;
  return strawPattern;
}
let wetCanvas: HTMLCanvasElement | null = null;
function drawFloor() {
  const ctx = floorCtx;
  const W = floorCanvas.width, H = floorCanvas.height;
  const px = (x: number) => (x + L.hw) * PX;
  const pz = (z: number) => (z + L.hl) * PX;
  if (!wetCanvas) { wetCanvas = document.createElement("canvas"); wetCanvas.width = flock.wc; wetCanvas.height = flock.wr; }
  const wctx = wetCanvas.getContext("2d")!;
  const img = wctx.createImageData(flock.wc, flock.wr);
  for (let c = 0; c < flock.wet.length; c++) {
    const k = Math.min(1, flock.wet[c] * 0.9);
    img.data[c * 4] = 200 - 115 * k; img.data[c * 4 + 1] = 168 - 105 * k; img.data[c * 4 + 2] = 104 - 66 * k; img.data[c * 4 + 3] = 255;
  }
  wctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(wetCanvas, 0, 0, W, H);
  ctx.fillStyle = straw(ctx);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#8f8d88";
  ctx.fillRect(px(L.aisle.x0), pz(L.aisle.z0), rectW(L.aisle) * PX, rectD(L.aisle) * PX);
  for (const p of L.pens) if (!p.active) { ctx.fillStyle = "#9a9892"; ctx.fillRect(px(p.x0), pz(p.z0), rectW(p) * PX, rectD(p) * PX); }
  floorTex.needsUpdate = true;
}

// ------------------------------------------------------------------ gear
function buildGear() {
  for (const g of gears) {
    if (g.kind === "overhead") {
      const y = mountY(L, g.x);
      const grp = pickable(new THREE.Group(), { kind: "cam", g });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf5f5f5));
      dome.rotation.x = Math.PI;
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(0x111111));
      lens.position.y = -0.16;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6), mat(0x555555));
      pole.position.y = 0.3;
      grp.add(dome, lens, pole);
      grp.position.set(g.x, y, g.z);
      gearGroup.add(grp);
    } else if (g.kind === "door" || g.kind === "egg") {
      const grp = pickable(new THREE.Group(), { kind: "cam", g });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.4), mat(0xeeeeee));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), mat(0x111111));
      lens.position.z = 0.21;
      grp.add(body, lens);
      const at = camPose(g);
      grp.position.copy(at.pos);
      grp.lookAt(at.look);
      gearGroup.add(grp);
    } else {
      const grp = pickable(new THREE.Group(), { kind: "sensor", g });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.14), mat(0xfdd835));
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, roofY(L, g.x) - 1.6), mat(0x333333));
      wire.position.y = (roofY(L, g.x) - 1.6) / 2;
      grp.add(box, wire);
      grp.position.set(g.x, 1.6, g.z);
      gearGroup.add(grp);
    }
  }
}

// ------------------------------------------------------------------ per-frame visuals
const dummy = new THREE.Object3D();
const colTmp = new THREE.Color();
let colored = false;
function updateBirds() {
  for (let i = 0; i < flock.n; i++) {
    const st = flock.st[i];
    const x = flock.x[i], z = flock.z[i], h = flock.head[i];
    if (st === GONE) {
      dummy.scale.set(0, 0, 0); dummy.updateMatrix();
      birdBody.setMatrixAt(i, dummy.matrix); birdHead.setMatrixAt(i, dummy.matrix);
      continue;
    }
    const dead = st === DEAD, sick = st === SICK;
    dummy.position.set(x, dead ? 0.08 : sick ? 0.09 : 0.12, z);
    dummy.rotation.set(0, h, dead ? Math.PI / 2 : 0);
    dummy.scale.set(0.12, sick ? 0.095 : 0.11, 0.17);
    dummy.updateMatrix();
    birdBody.setMatrixAt(i, dummy.matrix);
    const fwd = dead ? 0.1 : 0.15;
    const up = dead ? 0.06 : sick ? 0.15 : 0.22;
    dummy.position.set(x + Math.sin(h) * fwd + (dead ? Math.cos(h) * 0.08 : 0), up, z + Math.cos(h) * fwd);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.07);
    dummy.updateMatrix();
    birdHead.setMatrixAt(i, dummy.matrix);
    if (!colored || st !== HEALTHY || flock.treated[i]) {
      const v = ((i * 2654435761) >>> 0) / 4294967296;
      if (dead) colTmp.setRGB(0.28, 0.22, 0.18);
      else if (sick) colTmp.setRGB(0.45, 0.38, 0.32);
      else colTmp.setRGB(0.55 + v * 0.12, 0.27 + v * 0.06, 0.12);
      birdBody.setColorAt(i, colTmp);
      if (!sick && !dead) colTmp.setRGB(0.75, 0.15, 0.12);
      birdHead.setColorAt(i, colTmp);
    }
  }
  colored = true;
  birdBody.instanceMatrix.needsUpdate = true;
  birdHead.instanceMatrix.needsUpdate = true;
  if (birdBody.instanceColor) birdBody.instanceColor.needsUpdate = true;
  if (birdHead.instanceColor) birdHead.instanceColor.needsUpdate = true;
  birdBody.computeBoundingSphere();

  // Rings on the floor: what the AI has flagged.
  let m = 0;
  const ring = (x: number, z: number, c: number, s = 1) => {
    if (m >= MAX_MARKERS) return;
    dummy.position.set(x, 0.05, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, 1, s); dummy.updateMatrix();
    markerMesh.setMatrixAt(m, dummy.matrix);
    markerMesh.setColorAt(m, colTmp.setHex(c));
    m++;
  };
  for (let i = 0; i < flock.n; i++) {
    if (flock.st[i] === GONE || !flock.flag[i]) continue;
    ring(flock.x[i], flock.z[i], flock.flag[i] & 2 ? 0xef5350 : 0xffa726);
  }
  for (const a of flock.alerts) if (!a.done && a.kind === "wet") ring(a.x, a.z, 0x8d6e63, 3);
  markerMesh.count = m;
  markerMesh.instanceMatrix.needsUpdate = true;
  if (markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;

  let e = 0;
  const egg = (x: number, y: number, z: number) => {
    if (e >= MAX_EGGS) return;
    dummy.position.set(x, y, z); dummy.scale.set(0.045, 0.06, 0.045); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    eggMesh.setMatrixAt(e++, dummy.matrix);
  };
  // Egg table first so it always shows: eggs counted and not yet picked up, in trays of 30.
  const trays = Math.min(MAX_TRAYS, Math.ceil(staff.rec.store / 30));
  const et = L.eggTable;
  const cols = 6, rows = 3, stacks = cols * rows;
  const sx = (et.x1 - et.x0) / cols, sz = (et.z1 - et.z0) / rows;
  const top = new Array(stacks).fill(0);
  for (let k = 0; k < trays; k++) {
    const st = k % stacks, lvl = Math.floor(k / stacks);
    top[st] = lvl + 1;
    dummy.position.set(et.x0 + (st % cols + 0.5) * sx, 0.9 + 0.025 + lvl * 0.05, et.z0 + (Math.floor(st / cols) + 0.5) * sz);
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    trayMesh.setMatrixAt(k, dummy.matrix);
  }
  trayMesh.count = trays;
  trayMesh.instanceMatrix.needsUpdate = true;
  top.forEach((n, st) => {
    if (!n) return;
    const cx = et.x0 + (st % cols + 0.5) * sx, cz = et.z0 + (Math.floor(st / cols) + 0.5) * sz;
    const y = 0.9 + n * 0.05 + 0.02;
    for (let j = 0; j < 30; j++) {
      if (e >= MAX_EGGS) return;
      dummy.position.set(cx - 0.12 + (j % 6) * 0.048, y, cz - 0.1 + Math.floor(j / 6) * 0.05);
      dummy.scale.set(0.02, 0.026, 0.02); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      eggMesh.setMatrixAt(e++, dummy.matrix);
    }
  });
  L.nests.forEach((n, k) => {
    const c = Math.min(4, Math.ceil(flock.nestEggs[k] / 10));
    for (let j = 0; j < c; j++) egg(n.x + (n.x < 0 ? 0.3 : -0.3), 0.72, n.z - 0.3 + j * 0.2);
  });
  for (const f of flock.floorEggs) egg(f.x, 0.05, f.z);
  eggMesh.count = e;
  eggMesh.instanceMatrix.needsUpdate = true;
}

/** A box above each person: who the AI says they are, what they are doing, and today's numbers. */
function workerTag(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 560; c.height = 176;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(3.2, 1.006, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 11;
  labels.push(s);
  return s;
}
function writeTag(s: THREE.Sprite, lines: string[], color: string, bad: boolean) {
  const tex = (s.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
  const c = tex.image as HTMLCanvasElement;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  const [name, id, what, nums] = lines;
  ctx.font = "bold 36px system-ui, Arial";
  const wName = ctx.measureText(name).width;
  ctx.font = "bold 22px system-ui, Arial";
  const wId = ctx.measureText(id).width;
  ctx.font = "26px system-ui, Arial";
  const w = Math.min(c.width, Math.max(wName + wId + 90, ctx.measureText(what).width + 36, ctx.measureText(nums).width + 36));
  const x0 = (c.width - w) / 2;
  ctx.fillStyle = "rgba(24,21,18,.88)";
  ctx.beginPath(); ctx.roundRect(x0, 2, w, 158, 14); ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x0, 2, 8, 158);
  ctx.beginPath(); ctx.moveTo(c.width / 2 - 12, 160); ctx.lineTo(c.width / 2 + 12, 160); ctx.lineTo(c.width / 2, 174); ctx.fill();
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px system-ui, Arial";
  ctx.fillText(name, x0 + 22, 30, w - wId - 70);
  // The AI's identification badge.
  ctx.font = "bold 22px system-ui, Arial";
  const bx = x0 + w - wId - 30;
  ctx.fillStyle = bad ? "#ef5350" : "#2e7d32";
  ctx.beginPath(); ctx.roundRect(bx - 6, 14, wId + 24, 32, 8); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(id, bx + 6, 31);
  ctx.font = "26px system-ui, Arial";
  ctx.fillStyle = "#e8dccb";
  ctx.fillText(what, x0 + 22, 80, w - 36);
  ctx.fillStyle = bad ? "#ff8a80" : "#f5c542";
  ctx.font = "bold 26px system-ui, Arial";
  ctx.fillText(nums, x0 + 22, 126, w - 36);
  tex.needsUpdate = true;
}
const workerColor = (w: Worker) => w.role === "vet" ? "#ffffff" : w.role === "stranger" ? "#ef5350" : w.role === "visitor" ? "#ffb74d" : w.side < 0 ? "#4f8fe0" : "#5fbf6f";
const minutes = (r: number[]) => r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : 0;

/** The four lines in the box above a person. */
function tagLines(w: Worker): string[] {
  const k = staff.rec.kpi.get(w.id) ?? emptyKpi();
  const id = w.role === "stranger" ? "NO MATCH" : w.role === "visitor" ? "VISITOR ✓" : "STAFF ✓";
  const what = `${w.title}${w.doing ? ` · ${w.doing}` : ""}`;
  let nums = "";
  if (w.role === "attendant") nums = `Eggs ${k.eggs.toLocaleString()} · Feeders ${k.feeders} · Bags ${k.bags} · Litter ${k.kg} kg`;
  else if (w.role === "vet") nums = `Checked ${k.checked} · Treated ${k.treated} · Removed ${k.removed} · Reply ${minutes(k.response)} min`;
  else if (w.role === "stranger") nums = w.carry === "bag" ? "Carrying a feed bag · reported" : "Outside working hours · reported";
  else nums = w.carry === "bag" ? "Carrying a sack" : w.carry === "tray" ? "Carrying egg crates" : "Every load booked";
  return [(w.manual ? "You · " : "") + w.name, id, what, nums];
}

function updateCrew(t: number) {
  staff.workers.forEach((w, k) => {
    const c = crew[k];
    posePerson(c.p, w.x, w.z, w.heading, w.pose, w.carry, t);
    c.tag.visible = w.pose !== "away";
    c.tag.position.set(c.p.root.position.x, 2.05, c.p.root.position.z);
    if (!c.tag.visible) return;
    const lines = tagLines(w);
    const text = lines.join("|");
    if (text !== c.text) { c.text = text; writeTag(c.tag, lines, workerColor(w), w.role === "stranger"); }
  });
}

// ------------------------------------------------------------------ selection
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32).rotateX(-Math.PI / 2), basic(0xf5c542, 0.95));
selRing.renderOrder = 6;
selRing.visible = false;
const youRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2), basic(0x4fc3f7, 0.95));
youRing.visible = false;
const footLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4fc3f7 }));
footLines.visible = false;
overlayGroup.add(selRing, youRing, footLines);

function selPos(s: Sel): { x: number; z: number; r: number } | null {
  switch (s.kind) {
    case "cam": case "sensor": return { x: s.g.x, z: s.g.z, r: 0.5 };
    case "hen": return { x: flock.x[s.i], z: flock.z[s.i], r: 0.35 };
    case "worker": return s.w.pose === "away" ? null : { x: s.w.x, z: s.w.z, r: 0.6 };
    case "feeder": return { ...L.feeders[s.k], r: 0.45 };
    case "drinker": return { ...L.drinkers[s.k], r: 0.45 };
    case "nest": return { ...L.nests[s.k], r: 0.7 };
    case "table": return { ...center(L.eggTable), r: 1.3 };
    case "store": return { ...center(L.feedStore), r: 1.8 };
    case "pc": return { x: L.pc.x - 0.3, z: L.pc.z - 0.2, r: 0.9 };
    case "scale": return { x: L.litterScale.x + 0.6, z: L.litterScale.z, r: 1.3 };
    case "maindoor": return { x: L.mainDoor.x, z: L.mainDoor.z - 0.6, r: 1.6 };
    case "backdoor": return { x: L.backDoor.x, z: L.backDoor.z + 0.6, r: 1.4 };
  }
}

function select(s: Sel | null) {
  sel = s;
  if (follow && !(s?.kind === "worker" && s.w === follow)) follow = null;
  footLines.visible = false;
  if (s?.kind === "cam" && s.g.kind === "overhead") {
    const f = footprint(L, s.g);
    const y = mountY(L, s.g.x);
    const pts: number[] = [];
    const cs = [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]];
    for (let k = 0; k < 4; k++) {
      pts.push(s.g.x, y, s.g.z, cs[k][0], 0.03, cs[k][1]);
      pts.push(cs[k][0], 0.03, cs[k][1], cs[(k + 1) % 4][0], 0.03, cs[(k + 1) % 4][1]);
    }
    footLines.geometry.dispose();
    footLines.geometry = new THREE.BufferGeometry();
    footLines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    footLines.visible = true;
  }
  renderInfo(true);
}

/** Which camera (if any) sees this spot on the floor. */
function camAt(x: number, z: number): Gear | undefined {
  return gears.find((g) => g.kind === "overhead" && inRect(footprint(L, g), x, z));
}
const camNo = (g: Gear) => `CAM ${String(feedOrder().indexOf(g) + 1).padStart(2, "0")}`;

const infoEl = document.getElementById("info")!;
const infoFeed = document.getElementById("infoFeed")!;
let infoKey = "";

function renderInfo(force = false) {
  const s = sel;
  const you = staff.workers.find((w) => w.manual);
  if (!s && !you) { infoEl.classList.add("hidden"); infoFeed.classList.add("hidden"); infoKey = ""; return; }
  let title = "", facts: string[] = [], tag = "", btns = "", feed = false;
  const fact = (k: string, v: string) => facts.push(`<li>${k} <b>${v}</b></li>`);
  if (!s && you) {
    title = `You are ${esc(you.name)}`;
    tag = `<span class="tag blue">${you.doing ? esc(you.doing) : "Waiting"}</span>`;
    facts.push("<li>Tap a hen, feeder, nest box, the egg table or the floor</li>");
    if (you.eggs) fact("Eggs in tray", String(you.eggs));
    btns = `<button class="btn ghost" data-act="release">Stop playing</button>`;
  } else if (s) switch (s.kind) {
    case "cam": {
      const g = s.g;
      title = `${g.kind === "overhead" ? "Roof camera" : g.kind === "egg" ? "Egg table camera" : "Door camera"} · ${camNo(g)}`;
      if (g.kind === "overhead") {
        const f = footprint(L, g);
        fact("Where", `${flock.penName(g.x, g.z)}, ${mountY(L, g.x).toFixed(1)} m up`);
        fact("Sees", `${Math.round(rectW(f))} × ${Math.round(rectD(f))} m of floor`);
        fact("Lens", `${g.lens} mm · ${LENS[g.lens].h}° wide`);
      } else fact("Watches", g.kind === "egg" ? "trays put on the egg table" : isBackDoor(g) ? "the back door" : "the main door and feed store");
      feed = true;
      btns = `<button class="btn" data-act="opencam">Full screen</button>`;
      break;
    }
    case "sensor": title = "Ammonia sensor"; fact("Reading", `${Math.round(flock.ammonia(s.g.x, s.g.z))} ppm`); fact("Alarm above", "20 ppm"); break;
    case "hen": {
      const i = s.i, st = flock.st[i];
      title = `Hen #${i + 1}`;
      tag = st === DEAD ? `<span class="tag bad">Dead</span>` : st === SICK ? `<span class="tag warn">${flock.treated[i] ? "Sick · treated" : "Sick"}</span>` : `<span class="tag good">Healthy</span>`;
      if (st === SICK) fact("Barely moved for", `${Math.round(flock.low[i])} min`);
      if (st === DEAD) fact("Lying still for", `${Math.round(flock.still[i])} min`);
      fact("AI", flock.flag[i] & 2 ? "flagged dead" : flock.flag[i] & 1 ? "flagged not moving" : st === HEALTHY ? "watching, normal" : "not flagged yet");
      const c = camAt(flock.x[i], flock.z[i]);
      fact("Seen by", c ? camNo(c) : "no camera");
      fact("In", flock.penName(flock.x[i], flock.z[i]));
      if (st === SICK || st === DEAD) btns = `<button class="btn" data-act="sendvet">Send the vet</button>`;
      break;
    }
    case "worker": {
      const w = s.w;
      title = w.name;
      tag = w.pose === "away" ? `<span class="tag">Not in</span>` : `<span class="tag ${w.role === "stranger" ? "bad" : "blue"}">${esc(w.doing || "Standing by")}</span>`;
      fact("AI identity", w.role === "stranger" ? "no match, not on the staff list" : w.role === "visitor" ? "registered visitor" : "staff, face matched");
      fact("Job", esc(w.title));
      const k = staff.rec.kpi.get(w.id) ?? emptyKpi();
      if (w.role === "attendant") {
        fact("Eggs picked today", `${k.eggs.toLocaleString()} in ${k.trips} trips`);
        fact("Feed today", `${k.bags} bags into ${k.feeders} feeders`);
        fact("Drinkers checked", String(k.drinkers));
        fact("Litter weighed out", `${k.kg} kg in ${k.sacks} sacks`);
      }
      if (w.role === "vet") { fact("Hens checked", String(k.checked)); fact("Treated / removed", `${k.treated} / ${k.removed}`); fact("Average reply to AI alert", `${minutes(k.response)} min`); }
      if (w.eggs) fact("Eggs in tray", String(w.eggs));
      if (w.pose !== "away") { const c = camAt(w.x, w.z); fact("Seen by", c ? camNo(c) : nearDoor(w) ? "door camera" : "no camera"); }
      btns = (w.pose !== "away" ? `<button class="btn ghost" data-act="follow">${follow === w ? "Stop following" : "Follow"}</button>` : "") +
        (w.role === "attendant" || w.role === "vet" ? `<button class="btn" data-act="${w.manual ? "release" : "play"}">${w.manual ? "Stop playing" : "Play as " + esc(w.name)}</button>` : "");
      break;
    }
    case "feeder": {
      title = `Feeder ${s.k + 1}`;
      fact("In", L.pens[L.feeders[s.k].pen].name);
      fact("Hen visits, last hour", String(Math.round(flock.visits[s.k])));
      const c = camAt(L.feeders[s.k].x, L.feeders[s.k].z);
      fact("Seen by", c ? camNo(c) : "no camera");
      break;
    }
    case "drinker": {
      const q = L.drinkers[s.k];
      title = `Drinker ${s.k + 1}`;
      const wv = flock.wetAt(q.x, q.z);
      tag = wv > 0.75 ? `<span class="tag bad">Leaking</span>` : wv > 0.45 ? `<span class="tag warn">Damp around it</span>` : `<span class="tag good">Dry</span>`;
      fact("In", L.pens[q.pen].name);
      break;
    }
    case "nest": title = "Nest box"; fact("Eggs in it", String(flock.nestEggs[s.k])); fact("In", L.pens[L.nests[s.k].pen].name); break;
    case "table": title = "Egg table"; fact("Waiting for pick-up", `${staff.rec.store.toLocaleString()} eggs (${Math.floor(staff.rec.store / CRATE)} crates)`); fact("Counted today", flock.today.delivered.toLocaleString()); if (flock.yesterday) fact("Yesterday", flock.yesterday.delivered.toLocaleString()); fact("Laid today", flock.today.laid.toLocaleString()); fact("Counted by", staff.eggCamera ? "egg table camera" : "hand"); break;
    case "store": {
      title = "Feed store";
      const gap = staff.rec.book - flock.stats.feedBags;
      tag = gap > 0 ? `<span class="tag bad">${gap} bags short</span>` : `<span class="tag good">Matches the books</span>`;
      fact("By the books", `${staff.rec.book} bags`);
      fact("Camera count", `${Math.max(0, flock.stats.feedBags)} bags`);
      fact("Issued today", `${staff.rec.feedUsedToday} bags`);
      fact("Watched by", flock.feedCam ? "main door camera" : "no camera");
      btns = `<button class="btn" data-act="dash:feed">Open feed ledger</button>`;
      break;
    }
    case "scale": {
      const r = staff.rec;
      title = "Litter scale";
      fact("Waiting for the fertilizer plant", `${r.litterStore.toLocaleString()} kg in ${r.litterSacks} sacks`);
      fact("Weighed out today", `${r.litterOutToday.toLocaleString()} kg`);
      fact("Sent to fertilizer so far", `${r.fertilizerTotal.toLocaleString()} kg in ${r.batches} batches`);
      fact("Still in the house (estimate)", `${Math.round(r.litterInHouse).toLocaleString()} kg`);
      btns = `<button class="btn" data-act="dash:litter">Open litter ledger</button>`;
      break;
    }
    case "maindoor": title = "Main door"; fact("Camera", flock.doorCam ? "yes, logs everyone in and out" : "none"); break;
    case "backdoor": title = "Back door"; fact("Camera", staff.backDoorCamera ? "yes" : "none"); break;
    case "pc": {
      title = "AI computer";
      fact("Watching", `${gears.filter((g) => g.kind !== "sensor").length} cameras, ${gears.filter((g) => g.kind === "sensor").length} sensors`);
      fact("Open incidents", String(openIncidents().length));
      btns = `<button class="btn" data-act="openlog">Open the log</button><button class="btn" data-act="dash:overview">Dashboard</button>`;
      break;
    }
  }
  if (you && s) btns += `<button class="btn ghost" data-act="release">Stop playing</button>`;
  const html = `<h2>${esc(title)} ${tag}<button class="x" data-act="close" title="Close">✕</button></h2>${feed ? `<div class="feedspace" id="feedspace"></div>` : ""}<ul class="facts">${facts.join("")}</ul>${btns ? `<div class="row">${btns}</div>` : ""}`;
  if (!force && (html === infoKey || infoHold)) return;
  infoKey = html;
  infoEl.innerHTML = html;
  infoEl.classList.remove("hidden");
  infoFeed.classList.toggle("hidden", !feed);
}

let infoHold = false; // don't swap the card's buttons while a finger is on them
infoEl.addEventListener("pointerdown", () => (infoHold = true));
window.addEventListener("pointerup", () => setTimeout(() => (infoHold = false), 50));
const nearDoor = (w: Worker) => Math.hypot(w.x - L.mainDoor.x, w.z - L.mainDoor.z) < 4 || Math.hypot(w.x - L.backDoor.x, w.z - L.backDoor.z) < 4;

infoEl.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
  if (!a) return;
  const s = sel;
  switch (a.dataset.act) {
    case "close": select(null); return;
    case "opencam": if (s?.kind === "cam") { showCams(true); pickFeed(feedOrder().indexOf(s.g)); } return;
    case "openlog": showLog(true); return;
    case "dash:feed": case "dash:litter": case "dash:overview": showDash(true, a.dataset.act.slice(5) as DashTab); return;
    case "follow": if (s?.kind === "worker") { follow = follow === s.w ? null : s.w; renderInfo(true); } return;
    case "play": if (s?.kind === "worker") { staff.takeOver(s.w); follow = s.w; select(null); } return;
    case "release": staff.takeOver(null); follow = null; renderInfo(true); return;
    case "sendvet": if (s?.kind === "hen") {
      const vet = staff.workers[2];
      if (!vet.inside) { staff.takeOver(null); vet.inside = true; vet.x = L.mainDoor.x; vet.z = L.mainDoor.z - 0.5; }
      staff.goHen(vet, s.i);
      select({ kind: "worker", w: vet }); follow = vet;
    } return;
  }
});

/** The player is one of the workers: a tap is an order. */
function order(w: Worker, s: Sel | null, x: number, z: number) {
  if (s?.kind === "hen") { staff.goHen(w, s.i); return; }
  if (s?.kind === "feeder") { staff.goFeeder(w, s.k); return; }
  if (s?.kind === "nest") { staff.goNests(w, [s.k], false); return; }
  if (s?.kind === "table") { if (w.eggs) staff.goTable(w); else staff.goTo(w, x, z + 0.9); return; }
  const wet = flock.alerts.find((a) => !a.done && a.kind === "wet" && Math.hypot(a.x - x, a.z - z) < 1.8);
  if (wet || flock.wetAt(x, z) > 0.6) { staff.goRake(w, x, z); return; }
  staff.goTo(w, Math.max(-L.hw + 0.4, Math.min(L.hw - 0.4, x)), Math.max(-L.hl + 0.4, Math.min(L.hl - 0.4, z)), "Walking");
}

// ------------------------------------------------------------------ input
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; hideHint(); });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || view !== "house") return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 8) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects([...pickables, floorMesh], true);
  let s: Sel | null = null;
  let gx = 0, gz = 0;
  for (const h of hits) {
    if (h.object === floorMesh) { gx = h.point.x; gz = h.point.z; break; }
    let o: THREE.Object3D | null = h.object;
    while (o && !o.userData.sel) o = o.parent;
    if (!o) continue;
    const u = o.userData.sel as Sel | ((id: number) => Sel);
    if (typeof u === "function") { if (h.instanceId === undefined) continue; s = u(h.instanceId); }
    else s = u;
    if (s.kind === "hen" && flock.st[s.i] === GONE) { s = null; continue; }
    gx = h.point.x; gz = h.point.z;
    break;
  }
  // Hens are small: a tap near one picks it, flagged ones first.
  if (!s && hits.some((h) => h.object === floorMesh) && flock.penAt(gx, gz) >= 0) {
    const flagged = flock.nearestBird(gx, gz, 1.2, (st) => st === SICK || st === DEAD);
    const any = flock.nearestBird(gx, gz, 0.45, (st) => st !== GONE);
    const i = flagged >= 0 ? flagged : any;
    if (i >= 0) s = { kind: "hen", i };
  }
  const you = staff.workers.find((w) => w.manual);
  if (you && s?.kind !== "worker" && s?.kind !== "cam" && s?.kind !== "pc") {
    if (hits.length) order(you, s, gx, gz);
    return;
  }
  select(s);
});

// Keyboard: WASD / arrows slide around the house.
const keys = new Set<string>();
window.addEventListener("keydown", (e) => { keys.add(e.key.toLowerCase()); hideHint(); });
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
function keyMove(dt: number) {
  let f = 0, r = 0;
  if (keys.has("w") || keys.has("arrowup")) f++;
  if (keys.has("s") || keys.has("arrowdown")) f--;
  if (keys.has("d") || keys.has("arrowright")) r++;
  if (keys.has("a") || keys.has("arrowleft")) r--;
  if (!f && !r) return;
  follow = null;
  const dir = controls.target.clone().sub(camera.position); dir.y = 0; dir.normalize();
  const right = V(-dir.z, 0, dir.x);
  const step = dir.multiplyScalar(f).add(right.multiplyScalar(r)).multiplyScalar(12 * dt);
  controls.target.add(step); camera.position.add(step);
}

const hintEl = document.getElementById("hint")!;
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; setTimeout(() => hintEl.classList.add("gone"), 2500); } }

document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
function setSpeed(v: number) {
  speed = v;
  document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((x) => x.classList.toggle("on", Number(x.dataset.speed) === v));
}

// ------------------------------------------------------------------ AI computer log
const logEl = document.getElementById("ailog")!;
const logBtn = document.getElementById("logBtn")!;
const logBadge = document.getElementById("logBadge")!;
const ICON: Record<string, string> = { sick: "🟠", dead: "🔴", wet: "💧", ammonia: "🌫️", feed: "🌾", intruder: "🚨", feedtheft: "🚨", eggtheft: "🚨" };
const TITLE: Record<string, string> = { sick: "Hen not moving", dead: "Dead hen", wet: "Wet bedding", ammonia: "Ammonia high", feed: "Feed low", intruder: "After-hours entry", feedtheft: "Feed taken", eggtheft: "Eggs missing" };
const openIncidents = () => flock.alerts.filter((a) => !a.done);
let logShown: Alert[] = [];

function showLog(on: boolean) {
  logEl.classList.toggle("hidden", !on);
  logBtn.classList.toggle("on", on);
  if (on) renderLog();
}
logBtn.addEventListener("click", () => { if (view === "cams") showCams(false); if (dashOpen) showDash(false); showLog(logEl.classList.contains("hidden")); });

function renderLog() {
  let alive = 0, sick = 0;
  for (let i = 0; i < flock.n; i++) { if (flock.st[i] < DEAD) alive++; if (flock.flag[i] & 1 && flock.st[i] === SICK) sick++; }
  const stat = (k: string, v: string) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`;
  // People incidents stay on top: they are the ones management asks about.
  const people = ["intruder", "feedtheft", "eggtheft"];
  logShown = [...flock.alerts].sort((a, b) => Number(people.includes(b.kind)) - Number(people.includes(a.kind)) || Number(a.done) - Number(b.done) || b.t - a.t).slice(0, 40);
  logEl.innerHTML = `
    <h3>Right now</h3>
    <div class="stats">${stat("Hens alive", alive.toLocaleString())}${stat("Flagged sick", String(sick))}${stat("Died today", String(flock.today.died))}
      ${stat("Eggs counted today", flock.today.delivered.toLocaleString())}${stat("Feed bags", String(Math.max(0, flock.stats.feedBags)))}${stat("Ammonia", `${Math.round(maxAmmonia())} ppm`)}</div>
    ${flock.yesterday ? `<div class="stats" style="margin-top:6px">${stat("Yesterday laid", flock.yesterday.laid.toLocaleString())}${stat("Yesterday counted", flock.yesterday.delivered.toLocaleString())}${stat("Yesterday died", String(flock.yesterday.died))}</div>` : ""}
    <h3>Incidents</h3>
    <ul class="inc">${logShown.map((a, k) => `<li data-inc="${k}" class="${a.done ? "done" : people.includes(a.kind) ? "hot" : ""}"><span class="ico">${ICON[a.kind] ?? "•"}</span>
      <span><b>${TITLE[a.kind] ?? a.kind}</b><br><small>${esc(a.text)}</small></span><span class="t">${hhmm(a.t)}${a.done ? " ✓" : ""}</span></li>`).join("") || "<li>Nothing yet</li>"}</ul>
    <h3>Door log</h3>
    <ul class="log">${flock.log.slice(0, 12).map((l) => `<li><span>${hhmm(l.t)}</span><span>${esc(l.text)}</span></li>`).join("")}</ul>`;
}
logEl.addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest("[data-inc]") as HTMLElement | null;
  if (!li) return;
  const a = logShown[Number(li.dataset.inc)];
  if (!a) return;
  if (window.innerWidth <= 760) showLog(false);
  if (a.bird >= 0 && flock.st[a.bird] !== GONE) { select({ kind: "hen", i: a.bird }); flyTo(flock.x[a.bird], flock.z[a.bird], 6); return; }
  flyTo(a.x, a.z, 10);
  // Show the camera that caught it.
  const g = a.kind === "intruder" || a.kind === "feedtheft" ? gears.find((q) => q.kind === "door" && !isBackDoor(q))
    : a.kind === "eggtheft" ? gears.find((q) => (q.kind === "door" && isBackDoor(q) && a.z < 0) || (q.kind === "egg" && a.z > 0))
    : camAt(a.x, a.z);
  select(g ? { kind: "cam", g } : null);
});
function maxAmmonia(): number {
  let m = 0;
  for (const s of flock.sensors) m = Math.max(m, flock.ammonia(s.x, s.z));
  return m;
}

// ------------------------------------------------------------------ dashboard: the AI computer's database
type DashTab = "overview" | "feed" | "eggs" | "litter" | "staff";
const dashEl = document.getElementById("dash")!;
const dashBtn = document.getElementById("dashBtn")!;
let dashOpen = false, dashTab: DashTab = "overview", dashDay: "today" | "yesterday" = "today", dashKey = "";

function showDash(on: boolean, tab?: DashTab) {
  if (tab) dashTab = tab;
  dashOpen = on;
  if (on) { if (view === "cams") showCams(false); showLog(false); }
  dashEl.classList.toggle("hidden", !on);
  dashBtn.classList.toggle("on", on);
  controls.enabled = !on && view === "house";
  dashKey = "";
  if (on) renderDash();
}
dashBtn.addEventListener("click", () => showDash(!dashOpen));
dashEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-tab],[data-day],[data-close]") as HTMLElement | null;
  if (!b) return;
  if (b.dataset.close !== undefined) { showDash(false); return; }
  if (b.dataset.tab) dashTab = b.dataset.tab as DashTab;
  if (b.dataset.day) dashDay = b.dataset.day as "today" | "yesterday";
  dashKey = "";
  renderDash();
});

const when = (t: number) => `D${Math.floor(t / 1440) + 1} ${hhmm(t)}`;
const n0 = (v: number) => (Math.round(v) || 0).toLocaleString();
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString();
const cam = (c: boolean) => c ? `<span class="ok">✓</span>` : `<span class="no">—</span>`;
const tile = (k: string, v: string, sub = "", tone = "") => `<div class="tile ${tone}"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
function table(cols: string[], rows: string[][], right: number[]): string {
  const th = cols.map((c, i) => `<th class="${right.includes(i) ? "r" : ""}">${c}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td class="${right.includes(i) ? "r" : ""}">${c}</td>`).join("")}</tr>`).join("");
  return `<div class="tbl"><table><thead><tr>${th}</tr></thead><tbody>${tr || `<tr><td colspan="${cols.length}" class="empty">No rows yet</td></tr>`}</tbody></table></div>`;
}

function dashNumbers() {
  const r = staff.rec;
  const start = (flock.day() - 1) * 1440;
  let alive = 0;
  for (let i = 0; i < flock.n; i++) if (flock.st[i] < DEAD) alive++;
  const sum = <T,>(rows: T[], f: (x: T) => number, ok: (x: T) => boolean) => rows.reduce((a, x) => a + (ok(x) ? f(x) : 0), 0);
  const today = (x: { t: number }) => x.t >= start;
  return {
    alive,
    picked: -sum(r.eggs, (x) => x.eggs, (x) => today(x) && x.type === "Picked up"),
    missing: -sum(r.eggs, (x) => x.eggs, (x) => today(x) && x.type === "Missing"),
    delivered: sum(r.feed, (x) => x.bags, (x) => today(x) && x.type === "Delivery"),
    unbooked: -sum(r.feed, (x) => x.bags, (x) => x.type === "Taken, not booked"),
    issuedKg: -sum(r.litter, (x) => x.kg, (x) => today(x) && x.type === "Issued to fertilizer"),
  };
}

function renderDash() {
  const r = staff.rec, N = dashNumbers();
  const gap = r.book - flock.stats.feedBags;
  const gPerHen = N.alive ? (r.feedUsedToday * 50000) / N.alive : 0;
  const vet = r.kpi.get(2) ?? emptyKpi();
  let body = "";
  if (dashTab === "overview") {
    body = `
      <h3>Eggs</h3><div class="tiles">
        ${tile("Laid today (roof cameras)", n0(flock.today.laid), `${N.alive ? ((flock.today.laid / N.alive) * 100).toFixed(1) : 0}% of hens so far`)}
        ${tile("Counted at the table", n0(flock.today.delivered), "egg table camera")}
        ${tile("Picked up by buyer", n0(N.picked), `${N.picked / CRATE} crates`)}
        ${tile("Waiting on the table", n0(r.store), `${Math.floor(r.store / CRATE)} full crates`)}
        ${tile("Missing today", n0(N.missing), N.missing ? "see Eggs ledger" : "none", N.missing ? "bad" : "good")}
        ${flock.yesterday ? tile("Yesterday laid / counted", `${n0(flock.yesterday.laid)} / ${n0(flock.yesterday.delivered)}`, `laying rate ${((flock.yesterday.laid / N.alive) * 100).toFixed(1)}%`) : ""}
      </div>
      <h3>Feed</h3><div class="tiles">
        ${tile("Bags by the books", n0(r.book), "receipts minus issues")}
        ${tile("Bags the camera counts", n0(Math.max(0, flock.stats.feedBags)), "feed store")}
        ${tile("Gap", n0(gap), gap > 0 ? `${N.unbooked} taken without booking` : "books match", gap > 0 ? "bad" : "good")}
        ${tile("Issued today", `${r.feedUsedToday} bags`, `${gPerHen.toFixed(0)} g a hen so far`)}
        ${tile("Delivered today", `${N.delivered} bags`)}
      </div>
      <h3>Litter → fertilizer</h3><div class="tiles">
        ${tile("Weighed out today", `${n0(r.litterOutToday)} kg`)}
        ${tile("At the scale", `${n0(r.litterStore)} kg`, `${r.litterSacks} sacks`)}
        ${tile("Issued to fertilizer today", `${n0(N.issuedKg)} kg`)}
        ${tile("Issued in total", `${n0(r.fertilizerTotal)} kg`, `${r.batches} batches`)}
        ${tile("Still in the house", `${n0(r.litterInHouse)} kg`, "estimate, 100 g a hen a day")}
      </div>
      <h3>Flock and vet</h3><div class="tiles">
        ${tile("Hens alive", n0(N.alive))}
        ${tile("Died today", String(flock.today.died), `${((flock.stats.died / flock.n) * 100).toFixed(2)}% since start`)}
        ${tile("Hens checked by vet", String(vet.checked), `${vet.treated} treated, ${vet.removed} removed`)}
        ${tile("Vet reply to AI alert", `${minutes(vet.response)} min`, "average today")}
        ${tile("Open incidents", String(openIncidents().length), "", openIncidents().some((a) => ["intruder", "feedtheft", "eggtheft"].includes(a.kind)) ? "bad" : "")}
      </div>`;
  } else if (dashTab === "feed") {
    body = `<div class="tiles">${tile("By the books", `${r.book} bags`)}${tile("Camera count", `${Math.max(0, flock.stats.feedBags)} bags`)}${tile("Gap", `${gap} bags`, "", gap > 0 ? "bad" : "good")}${tile("Issued today", `${r.feedUsedToday} bags`)}${tile("Yesterday", `${r.feedUsedYesterday} bags`)}</div>
      <h3>feed_ledger · ${r.feed.length} rows</h3>` +
      table(["#", "Time", "Type", "Bags", "By", "Reference", "Book after", "Camera"],
        r.feed.map((x) => [String(x.id), when(x.t), x.type === "Taken, not booked" ? `<span class="bad">${x.type}</span>` : x.type, signed(x.bags), esc(x.by), esc(x.note), String(x.book), cam(x.camera)]), [0, 3, 6]);
  } else if (dashTab === "eggs") {
    body = `<div class="tiles">${tile("Counted today", n0(flock.today.delivered))}${tile("Picked up today", n0(N.picked), `${N.picked / CRATE} crates`)}${tile("On the table", n0(r.store))}${tile("Missing today", n0(N.missing), "", N.missing ? "bad" : "good")}</div>
      <h3>egg_ledger · ${r.eggs.length} rows</h3>` +
      table(["#", "Time", "Type", "Eggs", "Crates", "By", "Reference", "On table after", "Camera"],
        r.eggs.map((x) => [String(x.id), when(x.t), x.type === "Missing" ? `<span class="bad">${x.type}</span>` : x.type, signed(x.eggs), x.crates.toFixed(1), esc(x.by), esc(x.note), n0(x.store), cam(x.camera)]), [0, 3, 4, 7]);
  } else if (dashTab === "litter") {
    body = `<div class="tiles">${tile("Weighed out today", `${n0(r.litterOutToday)} kg`)}${tile("Yesterday", `${n0(r.litterOutYesterday)} kg`)}${tile("At the scale", `${n0(r.litterStore)} kg`, `${r.litterSacks} sacks`)}${tile("To fertilizer, total", `${n0(r.fertilizerTotal)} kg`, `${r.batches} batches`)}${tile("In the house", `${n0(r.litterInHouse)} kg`, "estimate")}</div>
      <h3>litter_ledger · ${r.litter.length} rows</h3>` +
      table(["#", "Time", "Type", "kg", "Sacks", "By", "Source / batch", "At scale after", "Camera"],
        r.litter.map((x) => [String(x.id), when(x.t), x.type, signed(x.kg), signed(x.sacks), esc(x.by), esc(x.note), n0(x.store), cam(x.camera)]), [0, 3, 4, 7]);
  } else {
    const src = dashDay === "today" ? r.kpi : r.kpiYesterday;
    const staffRows = staff.workers.filter((w) => w.role === "attendant" || w.role === "vet").map((w) => {
      const k: Kpi = src.get(w.id) ?? emptyKpi();
      return [`<b>${esc(w.name)}</b>`, esc(w.title), dashDay === "today" ? (w.inside ? esc(w.doing || "Standing by") : "Not in") : "", n0(k.eggs), String(k.trips), String(k.bags), String(k.feeders), String(k.drinkers), String(k.checked), String(k.treated), String(k.removed), `${k.kg}`, String(k.raked), w.role === "vet" ? `${minutes(k.response)}` : "", (k.metres / 1000).toFixed(1)];
    });
    body = `<div class="seg"><button data-day="today" class="${dashDay === "today" ? "on" : ""}">Today</button><button data-day="yesterday" class="${dashDay === "yesterday" ? "on" : ""}">Yesterday</button></div>
      <h3>staff_kpi · ${dashDay}</h3>` +
      table(["Name", "Job", "Now", "Eggs picked", "Table trips", "Feed bags", "Feeders filled", "Drinkers checked", "Hens checked", "Treated", "Dead removed", "Litter kg", "Wet spots raked", "Reply min", "km walked"], staffRows, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) +
      `<h3>visitors_log</h3>` +
      table(["Time", "Who", "AI identity", "Event"], flock.log.flatMap((l) => {
        const w = staff.workers.find((q) => (q.role === "visitor" || q.role === "stranger") && l.text.startsWith(q.name));
        return w ? [[when(l.t), esc(w.name), w.role === "stranger" ? `<span class="bad">No match · reported</span>` : esc(w.title), / left$/.test(l.text) ? "Left" : "Came in"]] : [];
      }).slice(0, 30), []);
  }
  const tabs: [DashTab, string][] = [["overview", "Overview"], ["feed", "Feed"], ["eggs", "Eggs"], ["litter", "Litter"], ["staff", "Staff KPIs"]];
  const html = `<div class="dhead"><h2>Dashboard <small>Day ${flock.day()} · ${flock.clock()}</small></h2>
      <nav>${tabs.map(([k, v]) => `<button data-tab="${k}" class="${k === dashTab ? "on" : ""}">${v}</button>`).join("")}</nav>
      <button class="x" data-close title="Close">✕</button></div><div class="dbody">${body}</div>`;
  if (html === dashKey) return;
  dashKey = html;
  const scroller = dashEl.querySelector(".dbody");
  const top = scroller ? scroller.scrollTop : 0;
  const tbl = dashEl.querySelector(".tbl"), tl = tbl ? tbl.scrollLeft : 0;
  dashEl.innerHTML = html;
  const ns = dashEl.querySelector(".dbody");
  if (ns) ns.scrollTop = top;
  const nt = dashEl.querySelector(".tbl");
  if (nt) nt.scrollLeft = tl;
}

// ------------------------------------------------------------------ cameras: what they see
const monitorEl = document.getElementById("monitor")!;
const camsBtn = document.getElementById("camsBtn")!;
const houseBtn = document.getElementById("houseBtn")!;
const feedBox = document.getElementById("feedBox")!;
const aiCanvas = document.getElementById("ai") as HTMLCanvasElement;
const aiCtx = aiCanvas.getContext("2d")!;
const thumbsEl = document.getElementById("thumbs")!;
const feedInfo = document.getElementById("feedInfo")!;
const feedCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 80);
const thumbCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 80);
const previewCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 80);
let feedSel = 0;
let thumbTurn = 0;
let fullRedraw = true;
let infoT = 0;
const START_DAY = Date.UTC(2026, 10, 2);
const isBackDoor = (g: Gear) => Math.hypot(g.x - L.backDoor.x, g.z - L.backDoor.z) < Math.hypot(g.x - L.mainDoor.x, g.z - L.mainDoor.z);
let feedList: Gear[] = [];
function feedOrder(): Gear[] {
  if (feedList.length) return feedList;
  const order: Record<string, number> = { overhead: 0, door: 1, egg: 2 };
  feedList = gears.filter((g) => g.kind !== "sensor").sort((a, b) =>
    order[a.kind] - order[b.kind] || flock.penAt(a.x, a.z) - flock.penAt(b.x, b.z) || b.z - a.z || a.x - b.x);
  return feedList;
}
function feedName(i: number): string {
  const g = feedOrder()[i];
  const n = `CAM ${String(i + 1).padStart(2, "0")}`;
  if (g.kind === "overhead") return `${n} · ${flock.penName(g.x, g.z).toUpperCase()}`;
  if (g.kind === "egg") return `${n} · EGG TABLE`;
  return `${n} · ${isBackDoor(g) ? "BACK DOOR" : "MAIN DOOR"}`;
}

function showCams(on: boolean) {
  view = on ? "cams" : "house";
  monitorEl.classList.toggle("hidden", !on);
  camsBtn.classList.toggle("hidden", on);
  houseBtn.classList.toggle("hidden", !on);
  infoEl.classList.toggle("hidden", on || !infoKey);
  if (on) { showLog(false); infoFeed.classList.add("hidden"); }
  else renderInfo(true);
  controls.enabled = !on;
  fullRedraw = true;
  if (on) {
    thumbsEl.innerHTML = feedOrder().map((_, i) => `<button class="thumb ${i === feedSel ? "on" : ""}" data-feed="${i}"><span>${esc(feedName(i))}</span><i class="hidden"></i></button>`).join("");
    infoT = 0;
  }
}
camsBtn.addEventListener("click", () => { if (dashOpen) showDash(false); showCams(true); });
houseBtn.addEventListener("click", () => showCams(false));
monitorEl.addEventListener("scroll", () => (fullRedraw = true));
function pickFeed(i: number) {
  feedSel = Math.max(0, i);
  thumbsEl.querySelectorAll(".thumb").forEach((t, k) => t.classList.toggle("on", k === feedSel));
  infoT = 0;
}
thumbsEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-feed]") as HTMLElement | null;
  if (!b) return;
  pickFeed(Number(b.dataset.feed));
  if (window.innerWidth <= 860) monitorEl.scrollTo({ top: 0, behavior: "smooth" });
});

/** Where a wall camera hangs and what it looks at. */
function camPose(g: Gear): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  if (g.kind === "door") {
    const d = isBackDoor(g) ? L.backDoor : L.mainDoor;
    const inward = d.z > 0 ? -1 : 1;
    return { pos: V(d.x, 3.2, d.z + inward * 0.4), look: V(d.x + 1.5, 0.4, d.z + inward * 8), fov: 62 };
  }
  const c = center(L.eggTable);
  return { pos: V(c.x, 2.5, c.z + 1.2), look: V(c.x, 0.9, c.z), fov: 50 };
}

/** Point a camera exactly where the real one hangs, with the real lens. */
function aimCamera(cam: THREE.PerspectiveCamera, g: Gear) {
  cam.aspect = 16 / 9;
  if (g.kind === "overhead") {
    const hf = (LENS[g.lens].h * Math.PI) / 180;
    cam.fov = (2 * Math.atan(Math.tan(hf / 2) / cam.aspect) * 180) / Math.PI;
    cam.position.set(g.x, mountY(L, g.x) - 0.2, g.z);
    if (g.rot === 0) cam.up.set(0, 0, -1); else cam.up.set(1, 0, 0);
    cam.lookAt(g.x, 0, g.z);
  } else {
    const p = camPose(g);
    cam.fov = p.fov;
    cam.up.set(0, 1, 0);
    cam.position.copy(p.pos);
    cam.lookAt(p.look);
  }
  cam.updateProjectionMatrix();
}

/** Render what a camera sees into a DOM box (the WebGL canvas fills the window). */
function drawInto(el: Element, cam: THREE.PerspectiveCamera) {
  const r = el.getBoundingClientRect();
  const ch = renderer.domElement.clientHeight;
  if (r.bottom < 0 || r.top > ch || r.width < 4) return;
  const y = ch - r.bottom;
  renderer.setViewport(r.left, y, r.width, r.height);
  renderer.setScissor(r.left, y, r.width, r.height);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setScissorTest(false);
}
function asCamera(on: boolean) {
  // A real camera only sees the house, the hens and the people.
  gearGroup.visible = overlayGroup.visible = !on;
  for (const l of labels) l.visible = !on && !(l.userData.off);
}

function renderMonitor(t: number) {
  const list = feedOrder();
  if (fullRedraw) { renderer.setScissorTest(false); renderer.setClearColor(0x1d1a16); renderer.clear(); }
  asCamera(true);
  aimCamera(feedCam, list[feedSel]);
  drawInto(feedBox, feedCam);
  const thumbs = thumbsEl.children;
  const n = fullRedraw ? list.length : Math.min(2, list.length);
  for (let k = 0; k < n; k++) {
    const i = thumbTurn++ % list.length;
    aimCamera(thumbCam, list[i]);
    if (thumbs[i]) drawInto(thumbs[i], thumbCam);
  }
  fullRedraw = false;
  asCamera(false);
  drawAI(aiCanvas, aiCtx, feedBox, feedCam, list[feedSel], t, feedName(feedSel));
  if ((infoT -= 1 / 60) <= 0) { infoT = 0.5; updateFeedInfo(); }
}

const v3 = new THREE.Vector3();
function stamp(): string {
  const d = new Date(START_DAY + flock.time * 60000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
const inView = new Set<number>();

function drawAI(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, box: Element, cam: THREE.PerspectiveCamera, g: Gear, t: number, name: string, small = false) {
  const r = box.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.clearRect(0, 0, W, H);
  const proj = (x: number, y: number, z: number) => {
    v3.set(x, y, z).project(cam);
    return { x: ((v3.x + 1) / 2) * W, y: ((1 - v3.y) / 2) * H, ok: v3.z < 1 && Math.abs(v3.x) <= 1 && Math.abs(v3.y) <= 1 };
  };
  const f = Math.max(small ? 9 : 11, Math.round(W / (small ? 48 : 70)));
  const placed: [number, number, number][] = [];
  const tag = (x: number, y: number, text: string, bg: string) => {
    ctx.font = `800 ${f}px system-ui, Arial`;
    const w = ctx.measureText(text).width + f;
    const tx = Math.min(W - w - 4, Math.max(4, x - w / 2));
    let ty = Math.min(H - f * 1.6, Math.max(4, y - f * 1.9));
    for (let k = 0; k < 6 && placed.some((q) => tx < q[0] + q[2] && q[0] < tx + w && Math.abs(ty - q[1]) < f * 1.6); k++) ty += f * 1.7;
    placed.push([tx, ty, w]);
    ctx.fillStyle = bg;
    ctx.fillRect(tx, ty, w, f * 1.5);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, tx + f / 2, ty + f * 0.78);
  };
  inView.clear();
  if (g.kind === "overhead") {
    const a = proj(g.x, 0.1, g.z), b = proj(g.x + 1, 0.1, g.z);
    const ppm = Math.hypot(b.x - a.x, b.y - a.y);
    const hb = 0.24 * ppm;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = "rgba(110,255,150,.38)";
    const flagged: number[] = [];
    for (let i = 0; i < flock.n; i++) {
      const st = flock.st[i];
      if (st === GONE) continue;
      const p = proj(flock.x[i], 0.1, flock.z[i]);
      if (!p.ok) continue;
      inView.add(i);
      if (flock.flag[i]) { flagged.push(i); continue; }
      if (st === DEAD) continue;
      if (!small) ctx.strokeRect(p.x - hb, p.y - hb, hb * 2, hb * 2);
    }
    const blink = 0.6 + 0.4 * Math.sin(t * 6);
    for (const i of flagged) {
      const p = proj(flock.x[i], 0.1, flock.z[i]);
      const dead = (flock.flag[i] & 2) !== 0;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = dead ? `rgba(244,67,54,${blink})` : `rgba(255,152,0,${blink})`;
      const bb = hb * 1.6;
      ctx.strokeRect(p.x - bb, p.y - bb, bb * 2, bb * 2);
      const mins = dead ? Math.round(flock.still[i]) : Math.round(flock.low[i]);
      tag(p.x, p.y - bb, dead ? `DEAD · ${mins} min` : `NOT MOVING · ${mins} min`, dead ? "#d32f2f" : "#ef6c00");
    }
  } else if (g.kind === "egg") {
    const c = center(L.eggTable);
    const a = proj(c.x - 0.9, 0.95, c.z - 0.45), b = proj(c.x + 0.9, 0.95, c.z + 0.45);
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = "rgba(255,213,79,.9)";
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    tag((a.x + b.x) / 2, Math.min(a.y, b.y), `EGGS TODAY · ${flock.today.delivered.toLocaleString()}`, "#8d6e00");
  }
  // People: boxed, named, and what they are doing. Strangers in red.
  staff.workers.forEach((w) => {
    if (w.pose === "away") return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, seen = 0;
    for (const dx of [-0.35, 0.35]) for (const dz of [-0.35, 0.35]) for (const y of [0, 1.8]) {
      const pt = proj(w.x + dx, y, w.z + dz);
      if (v3.z >= 1) continue;
      if (pt.ok) seen++;
      x0 = Math.min(x0, pt.x); x1 = Math.max(x1, pt.x); y0 = Math.min(y0, pt.y); y1 = Math.max(y1, pt.y);
    }
    if (!seen) return;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    const bad = w.role === "stranger", guest = w.role === "visitor";
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = bad ? "#ef5350" : guest ? "#ffb74d" : "#4fc3f7";
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    const what = bad ? "UNKNOWN PERSON" + (w.carry === "bag" ? " · CARRYING FEED BAG" : "")
      : `${w.name.toUpperCase()}${small ? "" : ` · ${w.title}`}${w.doing && !small ? ` · ${w.doing}` : ""}${w.carry === "tray" && w.eggs ? ` · ${w.eggs} EGGS` : ""}`;
    tag((x0 + x1) / 2, y0, what, bad ? "#c62828" : guest ? "#e65100" : "#0277bd");
  });
  ctx.font = `700 ${f}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 4;
  ctx.fillStyle = "#fff";
  ctx.fillText(name, f, f);
  if (!small) ctx.fillText(stamp(), f, H - f * 2.2);
  if (Math.sin(t * 4) > -0.3) { ctx.fillStyle = "#ff3b30"; ctx.beginPath(); ctx.arc(W - f * 4.6, f * 1.55, f * 0.45, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#fff";
  ctx.fillText("REC", W - f * 3.8, f);
  if (g.kind === "overhead") {
    let alive = 0;
    for (const i of inView) if (flock.st[i] < DEAD) alive++;
    const txt = `COUNT ${alive}`;
    ctx.fillText(txt, W - ctx.measureText(txt).width - f, H - f * 2.2);
  }
  ctx.shadowBlur = 0;
}

function updateFeedInfo() {
  const list = feedOrder();
  const g = list[feedSel];
  const badges = thumbsEl.querySelectorAll("i");
  list.forEach((q, i) => {
    let n = 0;
    if (q.kind === "overhead") {
      const fp = footprint(L, q);
      for (const a of flock.alerts) if (!a.done && a.bird >= 0 && flock.st[a.bird] !== GONE && inRect(fp, flock.x[a.bird], flock.z[a.bird])) n++;
    }
    const b = badges[i] as HTMLElement | undefined;
    if (b) { b.textContent = String(n); b.classList.toggle("hidden", n === 0); }
  });
  const legend = `<ul>
      <li><span class="sw" style="border-color:#6eff96"></span><span>Hen being counted</span></li>
      <li><span class="sw" style="border-color:#ff9800"></span><span>Not moving 30+ min</span></li>
      <li><span class="sw" style="border-color:#f44336"></span><span>Dead</span></li>
      <li><span class="sw" style="border-color:#4fc3f7"></span><span>Staff</span></li>
      <li><span class="sw" style="border-color:#ef5350;background:#ef5350"></span><span>Unknown person</span></li></ul>`;
  if (g.kind === "overhead") {
    let alive = 0;
    for (const i of inView) if (flock.st[i] < DEAD) alive++;
    feedInfo.innerHTML = `<h2>${esc(feedName(feedSel))}</h2><div class="sub">${mountY(L, g.x).toFixed(1)} m up · ${g.lens} mm lens</div>
      <div class="big">${alive.toLocaleString()}</div><div>hens in view</div>${legend}`;
  } else if (g.kind === "door") {
    const entries = flock.log.slice(0, 6);
    feedInfo.innerHTML = `<h2>${esc(feedName(feedSel))}</h2>${legend}
      <ul>${entries.map((l) => `<li><span>${hhmm(l.t)}</span><span>${esc(l.text)}</span></li>`).join("")}</ul>`;
  } else {
    feedInfo.innerHTML = `<h2>${esc(feedName(feedSel))}</h2><div class="big">${flock.today.delivered.toLocaleString()}</div><div>eggs counted today</div>`;
  }
}

// Small live picture in the info card when a camera is selected.
const prevCanvas = document.createElement("canvas");
prevCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
infoFeed.appendChild(prevCanvas);
const prevCtx = prevCanvas.getContext("2d")!;
function renderPreview(t: number) {
  const space = document.getElementById("feedspace");
  if (!space || sel?.kind !== "cam" || view !== "house") return;
  const r = space.getBoundingClientRect();
  Object.assign(infoFeed.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  asCamera(true);
  aimCamera(previewCam, sel.g);
  drawInto(space, previewCam);
  asCamera(false);
  drawAI(prevCanvas, prevCtx, space, previewCam, sel.g, t, camNo(sel.g), true);
}

// ------------------------------------------------------------------ loop
let paused = false;
P.onPause(() => (paused = true));
P.onResume(() => (paused = false));

const clockEl = document.getElementById("clock")!;
const dayEl = document.getElementById("day")!;
let uiT = 0, floorT = 0, last = performance.now(), lastBags = -1, lastSacks = -1;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (!paused) {
    if (speed > 0) {
      let left = dt * speed;
      while (left > 0) { const h = Math.min(left, 0.5); flock.step(h); staff.step(h); left -= h; }
    }
    const light = flock.lightsOn();
    hemi.intensity = light ? 1.7 : 0.45;
    sun.intensity = light ? 1.1 : 0.15;
    (scene.background as THREE.Color).setHex(light ? 0x2a2622 : 0x0d0c0b);
    updateBirds();
    updateCrew(t);
    keyMove(dt);
    if (follow && follow.pose !== "away") {
      const k = Math.min(1, dt * 4);
      const dx = (follow.x - controls.target.x) * k, dz = (follow.z - controls.target.z) * k;
      controls.target.x += dx; controls.target.z += dz;
      camera.position.x += dx; camera.position.z += dz;
    }
    // Rings: the selected thing, and the worker you are playing.
    const p = sel && selPos(sel);
    selRing.visible = !!p;
    if (p) { selRing.position.set(p.x, 0.06, p.z); selRing.scale.setScalar(p.r / 0.5); }
    const you = staff.workers.find((w) => w.manual);
    youRing.visible = !!you && you.pose !== "away";
    if (you) youRing.position.set(you.x, 0.07, you.z);
    uiT -= dt; floorT -= dt;
    if (uiT <= 0) {
      uiT = 0.4;
      clockEl.textContent = flock.clock();
      dayEl.textContent = `Day ${flock.day()}${light ? "" : " · night"}`;
      const open = openIncidents().filter((a) => ["intruder", "feedtheft", "eggtheft", "dead"].includes(a.kind)).length;
      logBadge.textContent = String(open);
      logBadge.classList.toggle("hidden", open === 0);
      if (!logEl.classList.contains("hidden")) renderLog();
      if (view === "house") renderInfo();
      if (lastBags !== flock.stats.feedBags) { lastBags = flock.stats.feedBags; updateBags(); }
      if (lastSacks !== staff.rec.litterSacks) { lastSacks = staff.rec.litterSacks; updateSacks(); }
      if (dashOpen) renderDash();
    }
    if (floorT <= 0) { floorT = 2; drawFloor(); }
  }
  controls.update();
  renderer.setClearColor(scene.background as THREE.Color);
  if (dashOpen) return; // the dashboard covers the house
  if (view === "cams") { renderMonitor(t); return; }
  renderer.setViewport(0, 0, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  renderer.clear();
  renderer.render(scene, camera);
  renderPreview(t);
}

// Hook for automated checks.
(window as unknown as { __poultry: unknown }).__poultry = {
  staff, flock, gears, rec: staff.rec, dash: (tab: DashTab) => showDash(true, tab), select: (s: Sel | null) => select(s), feeds: feedOrder, look: (x: number, z: number, d: number) => flyTo(x, z, d),
  advance: (min: number) => { for (let k = 0; k < min * 60; k++) { flock.step(1 / 60); staff.step(1 / 60); } },
};

// ------------------------------------------------------------------ boot
buildWorld();
buildGear();
resize();
startView();
P.firstFrameReady();
requestAnimationFrame(frame);
P.gameReady();
