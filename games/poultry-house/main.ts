// Poultry House: plan the AI camera gear for the EcoGreen farm, then play the farm roles.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as P from "../../src/platform/platform";
import { DEFAULT_DIMS, Dims, GATE_W, Layout, buildLayout, center, inRect, mountY, rectD, rectW, roofY } from "./sim/layout";
import {
  CoverMap, DOOR_RADIUS, EGG_RADIUS, Gear, GearKind, LENS, Lens, SENSOR_RADIUS,
  autoPlace, coversBackDoor, coversDoor, coversEggTable, coversFeedStore, footprint, shopping,
} from "./sim/gear";
import { DEAD, Flock, GONE, HEALTHY, SICK } from "./sim/flock";
import { Staff, Worker } from "./sim/staff";
import { Person, makePerson, posePerson } from "./person";

const GAME_ID = "poultry-house";
const SAVE_V = 2; // bump when DEFAULT_DIMS change so old saved sizes are dropped
type Mode = "plan" | "play" | "tour" | "monitor";
type Tool = GearKind | "remove";
type Role = "doctor" | "eggs" | "litter" | "manager";
type Overlay = "none" | "coverage" | "litter" | "feeders";

const ROLES: Record<Role, { name: string; color: number; help: string }> = {
  doctor: { name: "Doctor", color: 0xffffff, help: "Tap a bird or a red/orange alert. Walk there to treat a sick bird or bag a dead one, then take bags out the main door." },
  eggs: { name: "Egg collector", color: 0x42a5f5, help: "Walk past the nest boxes and floor eggs to collect them, then bring them to the egg table to be counted." },
  litter: { name: "Floor keeper", color: 0x66bb6a, help: "Tap dark, wet litter to rake it and add dry bedding. Wet litter makes ammonia and sick birds." },
  manager: { name: "Manager", color: 0xf5c542, help: "Watch the AI: counts, alerts, feeder activity and the door log. Tap an alert to look at it." },
};

// ------------------------------------------------------------------ state
let dims: Dims = { ...DEFAULT_DIMS };
let L: Layout = buildLayout(dims);
let gears: Gear[] = autoPlace(L, "2.8");
let cover = new CoverMap(L, gears);
let flock = new Flock(L);
let staff = new Staff(L, flock);
let mode: Mode = "monitor";
let tool: Tool = "overhead";
let lens: Lens = "2.8";
let rot: 0 | 1 = 0;
let role: Role = "doctor";
let speed = 1;
let overlay: Overlay = "none";
let truth = false;

const player = {
  x: 0, z: 0, tx: 0, tz: 0, moving: false,
  job: null as null | { kind: "bird"; i: number } | { kind: "rake"; x: number; z: number; t: number },
  eggs: 0, dead: 0, nearDoor: true,
  route: [] as { x: number; z: number }[],
};

// ------------------------------------------------------------------ renderer
P.initPlatform();
const host = document.getElementById("game")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 4;
controls.maxDistance = 140;
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
}
window.addEventListener("resize", resize);
resize();

function frameHouse() {
  const s = Math.max(L.dims.length, L.dims.width * 1.6);
  const portrait = camera.aspect < 0.8;
  camera.position.set(0, s * (portrait ? 1.35 : 0.8), L.hl + s * (portrait ? 0.75 : 0.55));
  // Leave room for the side panel on wide screens, and the bottom sheet on phones.
  controls.target.set(portrait ? 0 : L.hw * 0.7, 0, portrait ? L.hl * 0.35 : 0);
  controls.update();
}

// ------------------------------------------------------------------ helpers
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mat = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const basic = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

const labels: THREE.Sprite[] = [];
function label(text: string, size = 1, color = "#fff"): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 44px system-ui, Arial";
  c.width = Math.ceil(ctx.measureText(text).width) + 36;
  c.height = 64;
  ctx.font = "bold 44px system-ui, Arial";
  ctx.fillStyle = "rgba(28,24,20,.78)";
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 18);
  ctx.fill();
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

function clearGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
    else if (mm) {
      const tex = (mm as THREE.MeshBasicMaterial).map;
      if (tex) tex.dispose();
      mm.dispose();
    }
  });
  g.clear();
}

// ------------------------------------------------------------------ world
const world = new THREE.Group();
const gearGroup = new THREE.Group();
scene.add(world, gearGroup);

let floorCanvas: HTMLCanvasElement;
let floorCtx: CanvasRenderingContext2D;
let floorTex: THREE.CanvasTexture;
const PX = 24; // floor texture pixels per metre (cameras look closely at the litter)

let birdBody: THREE.InstancedMesh;
let birdHead: THREE.InstancedMesh;
let feederMesh: THREE.InstancedMesh;
let markerMesh: THREE.InstancedMesh;
let eggMesh: THREE.InstancedMesh;
let nestGroup: THREE.Group;
let bagsGroup: THREE.Group;
let playerMesh: THREE.Group;
let playerPerson: Person;
let playerPose: "walk" | "stand" | "kneel" | "rake" = "stand";
let crew: { p: Person; tag: THREE.Sprite; text: string }[] = [];
let jobRing: THREE.Mesh;
const MAX_MARKERS = 600;
const MAX_EGGS = 4000;
const EGG_CART = 360; // 12 trays of 30

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
    const top = 0.15 * ppm, h = 0.9 * ppm;
    for (let x = 0; x < lenM - 0.5; x += 5) ctx.fillRect(x * sx + 0.3 * sx, top, 4.4 * sx, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildWorld() {
  clearGroup(world);
  labels.length = 0;
  const { hw, hl } = L;
  const d = L.dims;

  // Floor, painted on a canvas so litter wetness and camera coverage can show on it.
  floorCanvas = document.createElement("canvas");
  floorCanvas.width = Math.ceil(d.width * PX);
  floorCanvas.height = Math.ceil(d.length * PX);
  floorCtx = floorCanvas.getContext("2d")!;
  floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(d.width, d.length), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  world.add(floor);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(d.width + 80, d.length + 80), mat(0x6b7a45));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  world.add(ground);

  // Walls face inward, so you can always see in from outside.
  const walls: [number, number, number, number, number, boolean][] = [
    [d.width, 0, hl, Math.PI, 0, false],
    [d.width, 0, -hl, 0, 0, false],
    [d.length, -hw, 0, Math.PI / 2, 0, true],
    [d.length, hw, 0, -Math.PI / 2, 0, true],
  ];
  for (const [len, x, z, ry, , win] of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, d.eave), new THREE.MeshLambertMaterial({ map: wallTexture(len, d.eave, win) }));
    m.position.set(x, d.eave / 2, z);
    m.rotation.y = ry;
    world.add(m);
  }
  const door = (p: { x: number; z: number }, w: number, color: number, inward: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.2), mat(color));
    m.position.set(p.x, 1.6, p.z + inward * 0.03);
    m.rotation.y = inward > 0 ? 0 : Math.PI;
    world.add(m);
    const s = label(color === 0xa52a2a ? "Main door" : "Back door", 0.7);
    s.position.set(p.x, 3.7, p.z + inward * 0.5);
    world.add(s);
  };
  door(L.mainDoor, 3, 0xa52a2a, -1);
  door(L.backDoor, 2.4, 0x1e8a6a, 1);

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

  // Low block walls with wire mesh between pens and along the aisle.
  const edges = new Map<string, [number, number, number, number]>();
  for (const p of L.pens) {
    const e: [number, number, number, number][] = [[p.x0, p.z0, p.x1, p.z0], [p.x0, p.z1, p.x1, p.z1], [p.x0, p.z0, p.x0, p.z1], [p.x1, p.z0, p.x1, p.z1]];
    for (const [x0, z0, x1, z1] of e) {
      const onShell = (x0 === x1 && Math.abs(Math.abs(x0) - hw) < 1e-6) || (z0 === z1 && Math.abs(Math.abs(z0) - hl) < 1e-6);
      if (!onShell) edges.set([x0, z0, x1, z1].map((v) => v.toFixed(2)).join(","), [x0, z0, x1, z1]);
    }
  }
  const blockMat = mat(0x9e9c96);
  const meshMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  // Cut a gap in the wall wherever there is a gate, and hang an open gate beside it.
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
    leaf.rotation.y = Math.PI / 2; // swung open into the pen
    world.add(leaf);
  }
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
    const s = label(p.active ? `${p.name} · ${p.birds.toLocaleString()} birds` : p.name, 0.8, p.active ? "#fff" : "#c9bba8");
    const c = center(p);
    s.position.set(c.x, 2.6, c.z);
    world.add(s);
  }

  // Feeders (red) and drinkers (white). Feeder colour changes in the feeder overlay.
  const fGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.32, 12);
  feederMesh = new THREE.InstancedMesh(fGeo, mat(0xffffff), L.feeders.length);
  const dummy = new THREE.Object3D();
  L.feeders.forEach((f, i) => {
    dummy.position.set(f.x, 0.16, f.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    feederMesh.setMatrixAt(i, dummy.matrix);
    feederMesh.setColorAt(i, new THREE.Color(0xd32f2f));
  });
  world.add(feederMesh);
  const lids = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 12), mat(0x222222), L.feeders.length);
  L.feeders.forEach((f, i) => { dummy.position.set(f.x, 0.34, f.z); dummy.updateMatrix(); lids.setMatrixAt(i, dummy.matrix); });
  world.add(lids);
  const drk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.15, 0.38, 10), mat(0xf4f4f0), L.drinkers.length);
  const base = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 14), mat(0xd32f2f), L.drinkers.length);
  L.drinkers.forEach((f, i) => {
    dummy.position.set(f.x, 0.22, f.z); dummy.updateMatrix(); drk.setMatrixAt(i, dummy.matrix);
    dummy.position.set(f.x, 0.03, f.z); dummy.updateMatrix(); base.setMatrixAt(i, dummy.matrix);
  });
  world.add(drk, base);

  // Nest boxes (only once the hens are near laying age).
  nestGroup = new THREE.Group();
  const nestMat = mat(0x8d6e4a);
  for (const n of L.nests) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.9), nestMat);
    b.position.set(n.x, 0.45, n.z);
    nestGroup.add(b);
  }
  world.add(nestGroup);

  // Aisle: feed store, egg table, PC + switch.
  bagsGroup = new THREE.Group();
  world.add(bagsGroup);
  const fs = L.feedStore;
  const fsL = label("Feed store", 0.6);
  fsL.position.set((fs.x0 + fs.x1) / 2, 2.2, (fs.z0 + fs.z1) / 2);
  world.add(fsL);
  const et = L.eggTable;
  const table = new THREE.Mesh(new THREE.BoxGeometry(rectW(et), 0.9, rectD(et)), mat(0x9c6b3e));
  table.position.set((et.x0 + et.x1) / 2, 0.45, (et.z0 + et.z1) / 2);
  const etL = label("Egg table", 0.6);
  etL.position.set(table.position.x, 2, table.position.z);
  const pc = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.6), mat(0x222222));
  pc.position.set(L.pc.x, 0.55, L.pc.z);
  const pcL = label("AI PC + PoE switch", 0.55);
  pcL.position.set(L.pc.x - 1, 1.9, L.pc.z);
  world.add(table, etL, pc, pcL);

  // Birds: an instanced body and head for every bird.
  birdBody = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat(0xffffff), flock.n);
  birdHead = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat(0xffffff), flock.n);
  birdBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birdHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tint = new THREE.Color();
  for (let i = 0; i < flock.n; i++) {
    const v = ((i * 2654435761) >>> 0) / 4294967296;
    tint.setRGB(0.55 + v * 0.12, 0.27 + v * 0.06, 0.12);
    birdBody.setColorAt(i, tint);
    birdHead.setColorAt(i, tint);
  }
  world.add(birdBody, birdHead);

  markerMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.26, 0.36, 20).rotateX(-Math.PI / 2), basic(0xffffff), MAX_MARKERS);
  markerMesh.renderOrder = 5;
  world.add(markerMesh);
  eggMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat(0xf3e2c3), MAX_EGGS);
  world.add(eggMesh);

  playerPerson = makePerson({ coat: 0xffffff, trousers: 0x37474f, hat: 0 });
  playerMesh = playerPerson.root;
  world.add(playerMesh);
  // The farm staff: attendants in dark blue overalls and caps, the vet in a white coat.
  crew = staff.workers.map((w) => {
    const p = makePerson(w.role === "vet"
      ? { coat: 0xf4f4f4, trousers: 0x455a64, hat: 0 }
      : { coat: w.side < 0 ? 0x1f4e8c : 0x2e6b3a, trousers: w.side < 0 ? 0x1f4e8c : 0x2e6b3a, hat: 0xf5c542, skin: w.side < 0 ? 0x5a3a28 : 0x7a5038 });
    const tag = workerTag();
    world.add(p.root, tag);
    return { p, tag, text: "" };
  });
  jobRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24).rotateX(-Math.PI / 2), basic(0xf5c542, 0.9));
  jobRing.visible = false;
  world.add(jobRing);

  player.x = L.mainDoor.x; player.z = L.mainDoor.z - 1.2; player.moving = false; player.job = null;
  player.eggs = 0; player.dead = 0;
  drawFloor();
  updateBags();
}

function updateBags() {
  clearGroup(bagsGroup);
  const fs = L.feedStore;
  const n = Math.min(40, Math.ceil(Math.max(0, flock.stats.feedBags) / 3));
  const m = mat(0xf0ece4);
  for (let k = 0; k < n; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.85), m);
    const col = k % 5, layer = Math.floor(k / 5);
    b.position.set(fs.x0 + 0.35 + col * 0.58, 0.09 + layer * 0.19, (fs.z0 + fs.z1) / 2);
    bagsGroup.add(b);
  }
}

// Straw texture, drawn once and tiled over the litter.
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
    const light = r() < 0.55;
    g.strokeStyle = light ? `rgba(245,222,160,${0.35 + r() * 0.4})` : `rgba(120,90,45,${0.25 + r() * 0.35})`;
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
  // Canvas y=0 is the back wall (z = -hl), matching the plane's UV after rotation.
  const px = (x: number) => (x + L.hw) * PX;
  const pz = (z: number) => (z + L.hl) * PX;
  // Litter colour from wetness, one pixel per square metre, smoothed when scaled up.
  if (!wetCanvas || wetCanvas.width !== flock.wc || wetCanvas.height !== flock.wr) {
    wetCanvas = document.createElement("canvas");
    wetCanvas.width = flock.wc; wetCanvas.height = flock.wr;
  }
  const wctx = wetCanvas.getContext("2d")!;
  const img = wctx.createImageData(flock.wc, flock.wr);
  const showWet = overlay === "litter" || (role === "litter" && mode === "play");
  for (let c = 0; c < flock.wet.length; c++) {
    const k = showWet ? Math.min(1, flock.wet[c] * 1.2) : Math.min(1, flock.wet[c] * 0.75);
    img.data[c * 4] = 200 - 115 * k; img.data[c * 4 + 1] = 168 - 105 * k; img.data[c * 4 + 2] = 104 - 66 * k; img.data[c * 4 + 3] = 255;
  }
  wctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(wetCanvas, 0, 0, W, H);
  ctx.fillStyle = straw(ctx);
  ctx.fillRect(0, 0, W, H);
  // Concrete: the aisle and the empty pen.
  ctx.fillStyle = "#8f8d88";
  ctx.fillRect(px(L.aisle.x0), pz(L.aisle.z0), rectW(L.aisle) * PX, rectD(L.aisle) * PX);
  for (const p of L.pens) if (!p.active) { ctx.fillStyle = "#9a9892"; ctx.fillRect(px(p.x0), pz(p.z0), rectW(p) * PX, rectD(p) * PX); }
  const showCover = mode === "plan" || (mode === "tour" && tourCover) || overlay === "coverage";
  if (showCover) {
    const s = cover.step * PX;
    for (let r = 0; r < cover.rows; r++)
      for (let c = 0; c < cover.cols; c++) {
        const x = -L.hw + (c + 0.5) * cover.step, z = -L.hl + (r + 0.5) * cover.step;
        if (flock.penAt(x, z) < 0) continue;
        ctx.fillStyle = cover.mask[r * cover.cols + c] ? "rgba(79,195,247,.28)" : "rgba(239,83,80,.45)";
        ctx.fillRect(c * s, r * s, s, s);
      }
  }
  floorTex.needsUpdate = true;
}

// ------------------------------------------------------------------ gear visuals
const domes: THREE.Object3D[] = [];
function buildGear() {
  clearGroup(gearGroup);
  domes.length = 0;
  const showPlan = mode === "plan" || (mode === "tour" && tourCover);
  for (const g of gears) {
    if (g.kind === "overhead") {
      const y = mountY(L, g.x);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf5f5f5));
      dome.rotation.x = Math.PI;
      dome.position.set(g.x, y, g.z);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(0x111111));
      lens.position.set(g.x, y - 0.12, g.z);
      gearGroup.add(dome, lens);
      domes.push(dome);
      if (showPlan) {
        const f = footprint(L, g);
        const pts: number[] = [];
        for (const [cx, cz] of [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]]) pts.push(g.x, y, g.z, cx, 0.02, cz);
        const loop = [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1], [f.x0, f.z0]];
        for (let k = 0; k < 4; k++) pts.push(loop[k][0], 0.04, loop[k][1], loop[k + 1][0], 0.04, loop[k + 1][1]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        gearGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.55 })));
      }
    } else if (g.kind === "door" || g.kind === "egg") {
      const r = g.kind === "door" ? DOOR_RADIUS : EGG_RADIUS;
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.36), mat(0x263238));
      cam.position.set(g.x, 3, g.z);
      gearGroup.add(cam);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 40).rotateX(-Math.PI / 2), basic(g.kind === "door" ? 0xab47bc : 0xf5c542, 0.7));
      ring.position.set(g.x, 0.05, g.z);
      gearGroup.add(ring);
      if (showPlan) {
        const s = label(g.kind === "door" ? "Door camera" : "Egg table camera", 0.5);
        s.position.set(g.x, 3.6, g.z);
        gearGroup.add(s);
      }
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.12), mat(0xfdd835));
      box.position.set(g.x, 1.6, g.z);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, roofY(L, g.x) - 1.6), mat(0x333333));
      wire.position.set(g.x, (roofY(L, g.x) + 1.6) / 2, g.z);
      gearGroup.add(box, wire);
      if (showPlan) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(SENSOR_RADIUS - 0.06, SENSOR_RADIUS, 40).rotateX(-Math.PI / 2), basic(0xfdd835, 0.35));
        ring.position.set(g.x, 0.05, g.z);
        gearGroup.add(ring);
      }
    }
  }
}

function gearChanged(saveIt = true) {
  cover = new CoverMap(L, gears);
  flock.cover = cover;
  flock.doorCam = coversDoor(L, gears);
  flock.feedCam = coversFeedStore(L, gears);
  staff.eggCamera = coversEggTable(L, gears);
  flock.setSensors(gears.filter((g) => g.kind === "sensor").map((g) => ({ x: g.x, z: g.z })));
  buildGear();
  drawFloor();
  renderPanel();
  if (mode === "monitor") buildFeeds();
  if (saveIt) persist();
}

function persist() {
  void P.save(GAME_ID, JSON.stringify({ v: SAVE_V, dims, gears, lens }));
}

// ------------------------------------------------------------------ per-frame visuals
const dummy = new THREE.Object3D();
const colTmp = new THREE.Color();
let lastAge = -1;
let lastWeeks = -1;

function updateBirds() {
  const s = flock.weeks >= 19 ? 1 : 0.65 + flock.weeks * 0.018;
  const recolor = lastWeeks !== flock.weeks;
  for (let i = 0; i < flock.n; i++) {
    const st = flock.st[i];
    const x = flock.x[i], z = flock.z[i], h = flock.head[i];
    if (st === GONE) {
      dummy.scale.set(0, 0, 0); dummy.updateMatrix();
      birdBody.setMatrixAt(i, dummy.matrix); birdHead.setMatrixAt(i, dummy.matrix);
      continue;
    }
    const dead = st === DEAD, sick = st === SICK;
    dummy.position.set(x, (dead ? 0.08 : sick ? 0.09 : 0.12) * s, z);
    dummy.rotation.set(0, h, dead ? Math.PI / 2 : 0);
    dummy.scale.set(0.12 * s, (sick ? 0.095 : 0.11) * s, 0.17 * s);
    dummy.updateMatrix();
    birdBody.setMatrixAt(i, dummy.matrix);
    const fwd = (dead ? 0.1 : 0.15) * s;
    const up = (dead ? 0.06 : sick ? 0.15 : 0.22) * s;
    dummy.position.set(x + Math.sin(h) * fwd + (dead ? Math.cos(h) * 0.08 * s : 0), up, z + Math.cos(h) * fwd);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.07 * s);
    dummy.updateMatrix();
    birdHead.setMatrixAt(i, dummy.matrix);
    // Colour: healthy brown, sick dull grey-brown, dead dark.
    if (recolor || st !== HEALTHY || flock.flag[i]) {
      const v = ((i * 2654435761) >>> 0) / 4294967296;
      if (dead) colTmp.setRGB(0.28, 0.22, 0.18);
      else if (sick) colTmp.setRGB(0.45, 0.38, 0.32);
      else colTmp.setRGB(0.55 + v * 0.12, 0.27 + v * 0.06, 0.12);
      birdBody.setColorAt(i, colTmp);
      if (!sick && !dead) colTmp.setRGB(0.75, 0.15, 0.12); // red comb
      birdHead.setColorAt(i, colTmp);
    }
  }
  if (recolor) lastWeeks = flock.weeks;
  birdBody.instanceMatrix.needsUpdate = true;
  birdHead.instanceMatrix.needsUpdate = true;
  if (birdBody.instanceColor) birdBody.instanceColor.needsUpdate = true;
  if (birdHead.instanceColor) birdHead.instanceColor.needsUpdate = true;

  // Rings: what the AI flagged, and (with "show truth") what it missed.
  let m = 0;
  const ring = (x: number, z: number, c: number) => {
    if (m >= MAX_MARKERS) return;
    dummy.position.set(x, 0.05, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    markerMesh.setMatrixAt(m, dummy.matrix);
    markerMesh.setColorAt(m, colTmp.setHex(c));
    m++;
  };
  for (let i = 0; i < flock.n; i++) {
    const st = flock.st[i];
    if (st === GONE || st === HEALTHY && !(flock.flag[i] & 1)) continue;
    if (st === DEAD) {
      if (flock.flag[i] & 2) ring(flock.x[i], flock.z[i], 0xef5350);
      else if (truth) ring(flock.x[i], flock.z[i], 0xb39ddb);
    } else if (flock.flag[i] & 1) ring(flock.x[i], flock.z[i], 0xffa726);
    else if (truth && st === SICK) ring(flock.x[i], flock.z[i], 0xfff176);
  }
  for (const a of flock.alerts) if (!a.done && a.kind === "wet") ring(a.x, a.z, 0x8d6e63);
  markerMesh.count = m;
  markerMesh.instanceMatrix.needsUpdate = true;
  if (markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;

  // Eggs: up to four shown per nest box, plus each floor egg.
  let e = 0;
  const egg = (x: number, y: number, z: number) => {
    if (e >= MAX_EGGS) return;
    dummy.position.set(x, y, z); dummy.scale.set(0.045, 0.06, 0.045); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    eggMesh.setMatrixAt(e++, dummy.matrix);
  };
  L.nests.forEach((n, k) => {
    const c = Math.min(4, Math.ceil(flock.nestEggs[k] / 10));
    for (let j = 0; j < c; j++) egg(n.x + (n.x < 0 ? 0.3 : -0.3), 0.72, n.z - 0.3 + j * 0.2);
  });
  for (const f of flock.floorEggs) egg(f.x, 0.05, f.z);
  eggMesh.count = e;
  eggMesh.instanceMatrix.needsUpdate = true;
  nestGroup.visible = flock.weeks >= 16;
}

function updateFeeders() {
  if (overlay !== "feeders") {
    if (lastAge !== 0) {
      for (let k = 0; k < L.feeders.length; k++) feederMesh.setColorAt(k, colTmp.setHex(0xd32f2f));
      if (feederMesh.instanceColor) feederMesh.instanceColor.needsUpdate = true;
      lastAge = 0;
    }
    return;
  }
  lastAge = 1;
  for (let k = 0; k < L.feeders.length; k++) {
    const f = L.feeders[k];
    if (!cover.covered(f.x, f.z)) { feederMesh.setColorAt(k, colTmp.setHex(0x555555)); continue; }
    const v = Math.min(1, flock.visits[k] / 25);
    colTmp.setRGB(0.15 + 0.8 * v, 0.35 + 0.5 * (1 - Math.abs(v - 0.5) * 2) * 0.6, 0.9 - 0.8 * v);
    feederMesh.setColorAt(k, colTmp);
  }
  if (feederMesh.instanceColor) feederMesh.instanceColor.needsUpdate = true;
}

// ------------------------------------------------------------------ player
const toastEl = document.getElementById("toast")!;
let toastT = 0;
function toast(t: string) {
  toastEl.textContent = t;
  toastEl.classList.add("show");
  toastT = 2.2;
}

function walkTo(x: number, z: number) {
  player.tx = Math.max(-L.hw + 0.4, Math.min(L.hw - 0.4, x));
  player.tz = Math.max(-L.hl + 0.4, Math.min(L.hl - 0.4, z));
  player.moving = true;
}

let playerHeading = Math.PI;

/** A floating sign above a worker saying what they are doing (house view only, never in camera pictures). */
function workerTag(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 72;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(3.6, 0.5, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 11;
  labels.push(s);
  return s;
}
function writeTag(s: THREE.Sprite, name: string, doing: string, color: string) {
  const tex = (s.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
  const c = tex.image as HTMLCanvasElement;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  const text = doing ? `${name} · ${doing}` : name;
  ctx.font = "bold 38px system-ui, Arial";
  const w = Math.min(c.width, ctx.measureText(text).width + 40);
  const x0 = (c.width - w) / 2;
  ctx.fillStyle = "rgba(28,24,20,.82)";
  ctx.beginPath(); ctx.roundRect(x0, 4, w, 62, 16); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x0 + 22, 35, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x0 + 38, 37, w - 46);
  tex.needsUpdate = true;
}

function updateCrew(t: number) {
  staff.benched = mode === "play" ? (role === "doctor" ? 2 : role === "eggs" || role === "litter" ? 0 : -1) : -1;
  staff.workers.forEach((w, k) => {
    const c = crew[k];
    if (!c) return;
    posePerson(c.p, w.x, w.z, w.heading, w.pose, w.carry, t);
    c.tag.visible = w.pose !== "away";
    c.tag.position.set(c.p.root.position.x, 2.05, c.p.root.position.z);
    const text = w.doing || " ";
    if (text !== c.text) {
      c.text = text;
      writeTag(c.tag, w.name, w.doing, w.role === "vet" ? "#ffffff" : w.side < 0 ? "#4f8fe0" : "#5fbf6f");
    }
  });
}

function updatePlayer(dt: number) {
  const visible = mode === "play" && role !== "manager";
  playerMesh.visible = visible;
  jobRing.visible = false;
  if (!visible) return;
  playerPerson.coatMat.color.setHex(ROLES[role].color === 0xffffff ? 0xf4f4f4 : ROLES[role].color);
  playerPose = player.moving ? "walk" : "stand";
  if (player.job?.kind === "bird") {
    const i = player.job.i;
    player.tx = flock.x[i]; player.tz = flock.z[i]; player.moving = true;
    jobRing.visible = true;
    jobRing.position.set(flock.x[i], 0.06, flock.z[i]);
  }
  if (player.moving) {
    const dx = player.tx - player.x, dz = player.tz - player.z;
    const d = Math.hypot(dx, dz);
    const step = 3 * dt;
    const stopAt = player.job?.kind === "bird" ? 0.6 : 0.05;
    if (d <= stopAt + step) {
      if (stopAt < 0.1) { player.x = player.tx; player.z = player.tz; }
      player.moving = false;
      arrive();
      const next = player.route.shift();
      if (next) walkTo(next.x, next.z);
    } else {
      player.x += (dx / d) * step; player.z += (dz / d) * step;
      playerHeading = Math.atan2(dx, dz);
    }
  }
  if (player.job?.kind === "rake") {
    const j = player.job;
    if (!player.moving) {
      j.t -= dt;
      playerPose = "rake";
      if (j.t <= 0) {
        flock.rake(j.x, j.z);
        player.job = null;
        drawFloor();
        toast("Raked and topped up with dry bedding");
      }
    }
  }
  posePerson(playerPerson, player.x, player.z, playerHeading, playerPose, playerPose === "rake" ? "rake" : player.eggs ? "tray" : player.dead ? "bag" : "", performance.now() / 1000);

  // Egg collector picks up anything within reach.
  if (role === "eggs") {
    const got = flock.collectNear(player.x, player.z, 1.1);
    if (got) player.eggs += got;
    if (player.eggs >= EGG_CART) player.route = [];
    const et = center(L.eggTable);
    if (player.eggs && Math.hypot(player.x - et.x, player.z - et.z) < 1.9) {
      const r = flock.deliver(player.eggs, coversEggTable(L, gears));
      toast(r.counted ? `${player.eggs} eggs counted by the camera · ${r.cracked} cracked` : `${player.eggs} eggs on the table · no camera, count by hand`);
      player.eggs = 0;
    }
  }
  // Anyone carrying dead birds drops them out the main door.
  const atDoor = Math.hypot(player.x - L.mainDoor.x, player.z - L.mainDoor.z) < 2.2;
  if (player.dead && atDoor) {
    toast(`${player.dead} dead bird${player.dead > 1 ? "s" : ""} taken out for disposal`);
    flock.addLog(`${ROLES[role].name} took ${player.dead} dead bird(s) out`);
    player.dead = 0;
  }
  if (atDoor !== player.nearDoor) {
    player.nearDoor = atDoor;
    if (!atDoor) flock.addLog(`${ROLES[role].name} entered` + (flock.doorCam ? " · seen by door camera" : " · no door camera, not recorded"));
  }
  const carry = document.getElementById("carry")!;
  const parts: string[] = [];
  if (player.eggs) parts.push(`🥚 ${player.eggs} eggs`);
  if (player.dead) parts.push(`🛍 ${player.dead} dead bird${player.dead > 1 ? "s" : ""} (take to main door)`);
  carry.textContent = parts.join(" · ");
  carry.classList.toggle("show", parts.length > 0);
}

function arrive() {
  const job = player.job;
  if (job?.kind !== "bird") return;
  const i = job.i;
  player.job = null;
  if (flock.st[i] === SICK) {
    if (flock.treat(i)) toast("Treated. The bird should recover in about 12 hours.");
    else toast("Already treated");
  } else if (flock.st[i] === DEAD) {
    flock.remove(i);
    player.dead++;
    toast("Dead bird bagged. Take it out the main door.");
  } else {
    flock.flag[i] &= ~1;
    toast("Checked: this bird is healthy, just resting.");
  }
}

// ------------------------------------------------------------------ input
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(V(0, 1, 0), 0);
let downAt: { x: number; y: number; t: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 450;
  downAt = null;
  if (moved > 8 || !quick) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(groundPlane, hit)) return;
  if (Math.abs(hit.x) > L.hw || Math.abs(hit.z) > L.hl) return;
  onTap(hit.x, hit.z);
});

let nextGearId = 1000;
function onTap(x: number, z: number) {
  if (mode === "tour") return;
  if (mode === "plan") {
    if (tool === "remove") {
      let best = -1, bd = 2.2;
      gears.forEach((g, k) => { const d = Math.hypot(g.x - x, g.z - z); if (d < bd) { bd = d; best = k; } });
      if (best >= 0) { gears.splice(best, 1); gearChanged(); }
      return;
    }
    const sx = Math.round(x * 2) / 2, sz = Math.round(z * 2) / 2;
    gears.push({ id: nextGearId++, kind: tool, x: sx, z: sz, lens, rot });
    gearChanged();
    return;
  }
  if (role === "manager") return;
  if (role === "doctor") {
    const i = flock.nearestBird(x, z, 0.7, (s) => s !== GONE);
    if (i >= 0) { player.job = { kind: "bird", i }; return; }
  }
  if (role === "litter") {
    const i = flock.nearestBird(x, z, 0.5, (s) => s === DEAD);
    if (i >= 0) { player.job = { kind: "bird", i }; return; }
    if (flock.penAt(x, z) >= 0) { player.job = { kind: "rake", x, z, t: 2 }; walkTo(x, z); return; }
  }
  player.job = null;
  walkTo(x, z);
}

function focusOn(x: number, z: number) {
  const off = camera.position.clone().sub(controls.target);
  const len = Math.min(off.length(), 22);
  off.setLength(len);
  controls.target.set(x, 0, z);
  camera.position.copy(controls.target).add(off);
}

// ------------------------------------------------------------------ panel UI
const panel = document.getElementById("panel")!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtT = (t: number) => {
  const m = Math.floor(t % 1440);
  return `D${Math.floor(t / 1440) + 1} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

function renderPanel() {
  if (mode === "play") renderPlay();
  else renderPlan();
}

function renderPlan() {
  const st = cover.stats();
  const cls = st.total > 0.97 ? "good" : st.total > 0.8 ? "warn" : "bad";
  const counts = (k: GearKind) => gears.filter((g) => g.kind === k).length;
  const tools: [Tool, string, string][] = [
    ["overhead", "Ceiling camera", `${counts("overhead")} placed`],
    ["door", "Door camera", `${counts("door")} placed`],
    ["egg", "Egg table camera", `${counts("egg")} placed`],
    ["sensor", "Ammonia sensor", `${counts("sensor")} placed`],
    ["remove", "Remove", "tap gear to delete"],
  ];
  const shop = shopping(L, gears);
  const checks = [
    [coversDoor(L, gears), "Main door watched (staff and vet visits)"],
    [coversBackDoor(L, gears), "Back door watched"],
    [coversEggTable(L, gears), "Egg table counted by camera"],
    [coversFeedStore(L, gears), "Feed bags counted by aisle camera"],
  ] as const;
  panel.innerHTML = `
    <h3>Floor seen by ceiling cameras</h3>
    <div class="big ${cls}">${pct(st.total)}</div>
    <div class="pens">${L.pens.filter((p) => p.active).map((p) => `<span>${p.name}: ${pct(st.perPen[p.id])}</span>`).join("")}</div>
    <p>Blue floor is seen, red is a blind spot. A sick or dead bird in a blind spot is never reported.</p>
    ${checks.map(([ok, t]) => `<div class="pens"><span style="color:${ok ? "var(--good)" : "var(--bad)"}">${ok ? "✓" : "✗"} ${t}</span></div>`).join("")}
    <h3>Tap the floor to place</h3>
    <div class="grid2">${tools.map(([k, n, s]) => `<button class="chip ${tool === k ? "on" : ""}" data-tool="${k}"><b>${n}</b><small>${s}</small></button>`).join("")}</div>
    <div class="row">
      <label class="f">Lens<select id="lens">${(Object.keys(LENS) as Lens[]).map((k) => `<option value="${k}" ${k === lens ? "selected" : ""}>${LENS[k].label}</option>`).join("")}</select></label>
      <label class="f">Wide side<select id="rot"><option value="0" ${rot === 0 ? "selected" : ""}>Across the house</option><option value="1" ${rot === 1 ? "selected" : ""}>Along the house</option></select></label>
    </div>
    <div class="row"><button class="btn" data-act="auto">Auto place for this lens</button><button class="btn ghost" data-act="clear">Clear all</button></div>
    <h3>Shopping list</h3>
    <table class="shop">${shop.map((l) => `<tr><td>${esc(l.item)}${l.note ? `<br><small>${esc(l.note)}</small>` : ""}</td><td class="q">${l.qty}</td></tr>`).join("")}</table>
    <h3>House size</h3>
    <p>Width, length and wall height are tape-measured. Peak height and aisle are still photo estimates. Applying re-places the gear.</p>
    <div class="grid3">
      ${dimInput("width", "Width m")}${dimInput("length", "Length m")}${dimInput("aisle", "Aisle m")}
      ${dimInput("eave", "Wall height m")}${dimInput("ridge", "Peak height m")}${dimInput("birds", "Birds")}
    </div>
    <div class="row"><button class="btn" data-act="dims">Apply size</button><button class="btn ghost" data-act="resetdims">Measured size</button></div>`;
}

const dimInput = (k: keyof Dims, t: string) =>
  `<label class="f">${t}<input type="number" step="${k === "birds" ? 100 : 0.5}" data-dim="${k}" value="${L.dims[k]}"></label>`;

function renderPlay() {
  panel.innerHTML = `
    <h3>Your role</h3>
    <div class="grid2">${(Object.keys(ROLES) as Role[]).map((k) => `<button class="chip ${role === k ? "on" : ""}" data-role="${k}"><b>${ROLES[k].name}</b></button>`).join("")}</div>
    <p>${ROLES[role].help}</p>
    <h3>Flock age</h3>
    <div class="grid2">
      <button class="chip ${flock.weeks < 19 ? "on" : ""}" data-weeks="10"><b>Week 10</b><small>growing pullets</small></button>
      <button class="chip ${flock.weeks >= 19 ? "on" : ""}" data-weeks="24"><b>Week 24</b><small>laying hens</small></button>
    </div>
    <h3>What the AI sees</h3>
    <div class="grid3" id="stats"></div>
    <h3>Floor overlay</h3>
    <div class="grid2">${(["none", "coverage", "litter", "feeders"] as Overlay[]).map((o) => `<button class="chip ${overlay === o ? "on" : ""}" data-overlay="${o}"><b>${{ none: "None", coverage: "Camera coverage", litter: "Wet litter", feeders: "Feeder activity" }[o]}</b></button>`).join("")}</div>
    <div class="row"><button class="chip ${truth ? "on" : ""}" data-act="truth"><b>${truth ? "Hide" : "Show"} what the AI missed</b><small>yellow = sick, purple = dead, not seen</small></button></div>
    <div class="legend"><span style="--c:#ffa726">AI: not moving</span><span style="--c:#ef5350">AI: dead</span><span style="--c:#8d6e63">AI: wet litter</span></div>
    <h3>Alerts</h3>
    <ul class="alerts" id="alerts"></ul>
    <h3>Door and store log</h3>
    <ul class="log" id="log"></ul>`;
  updateStats();
}

function updateStats() {
  if (mode !== "play") return;
  const s = document.getElementById("stats");
  if (!s) return;
  let alive = 0, sick = 0, dead = 0, seen = 0, flaggedSick = 0, flaggedDead = 0;
  for (let i = 0; i < flock.n; i++) {
    const st = flock.st[i];
    if (st === GONE) continue;
    if (st === DEAD) { dead++; if (flock.flag[i] & 2) flaggedDead++; continue; }
    alive++;
    if (st === SICK) sick++;
    if (flock.flag[i] & 1) flaggedSick++;
    if (cover.covered(flock.x[i], flock.z[i])) seen++;
  }
  let ppm = 0;
  for (const p of flock.sensors) ppm = Math.max(ppm, flock.ammonia(p.x, p.z));
  const stat = (k: string, v: string) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`;
  s.innerHTML = [
    stat("Birds alive", alive.toLocaleString()),
    stat("Seen by cameras", `${seen.toLocaleString()} (${pct(alive ? seen / alive : 0)})`),
    stat("Not moving (AI)", `${flaggedSick}${truth ? ` / ${sick} sick` : ""}`),
    stat("Dead (AI)", `${flaggedDead}${truth ? ` / ${dead}` : ""}`),
    stat("Eggs laid today", flock.laying ? flock.today.laid.toLocaleString() : "—"),
    stat("Eggs counted", flock.laying ? `${flock.stats.aiEggs.toLocaleString()}${flock.stats.delivered > flock.stats.aiEggs ? ` (+${flock.stats.delivered - flock.stats.aiEggs} by hand)` : ""}` : "—"),
    stat("Feed bags", String(Math.max(0, flock.stats.feedBags))),
    stat("Ammonia", flock.sensors.length ? `${Math.round(ppm)} ppm` : "no sensor"),
    stat("Treated · Removed", `${flock.stats.treated} · ${flock.stats.removed}`),
  ].join("");
  const al = document.getElementById("alerts")!;
  const list = flock.alerts.slice(0, 10);
  al.innerHTML = list.length
    ? list.map((a) => `<li class="${a.done ? "done" : ""}" data-alert="${a.id}"><span class="dot k-${a.kind}"></span><span style="flex:1">${esc(a.text)}</span><i>${fmtT(a.t)}</i></li>`).join("")
    : `<li>No alerts yet</li>`;
  document.getElementById("log")!.innerHTML = flock.log.slice(0, 8).map((l) => `<li>${fmtT(l.t)} · ${esc(l.text)}</li>`).join("") || "<li>Nothing yet</li>";
}

panel.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest("[data-tool],[data-act],[data-role],[data-weeks],[data-overlay],[data-alert]") as HTMLElement | null;
  if (!t) return;
  const d = t.dataset;
  if (d.tool) { tool = d.tool as Tool; renderPanel(); }
  else if (d.role) { role = d.role as Role; player.job = null; drawFloor(); renderPanel(); }
  else if (d.weeks) {
    flock.setWeeks(Number(d.weeks));
    toast(flock.laying ? "Week 24: hens are laying. Nest boxes are in." : "Week 10: growing pullets, no eggs yet.");
    renderPanel();
  } else if (d.overlay) { overlay = d.overlay as Overlay; drawFloor(); renderPanel(); }
  else if (d.alert) {
    const a = flock.alerts.find((q) => q.id === Number(d.alert));
    if (!a) return;
    focusOn(a.x, a.z);
    if (!a.done && role === "doctor" && a.bird >= 0) player.job = { kind: "bird", i: a.bird };
    if (!a.done && role === "litter" && a.kind === "wet") { player.job = { kind: "rake", x: a.x, z: a.z, t: 2 }; walkTo(a.x, a.z); }
    if (!a.done && role === "litter" && a.kind === "dead") player.job = { kind: "bird", i: a.bird };
  } else if (d.act === "auto") { gears = autoPlace(L, lens); gearChanged(); toast(`${gears.filter((g) => g.kind === "overhead").length} ceiling cameras with ${LENS[lens].label} lenses`); }
  else if (d.act === "clear") { gears = []; gearChanged(); }
  else if (d.act === "truth") { truth = !truth; renderPanel(); }
  else if (d.act === "dims" || d.act === "resetdims") {
    if (d.act === "resetdims") dims = { ...DEFAULT_DIMS };
    else {
      const next = { ...dims };
      panel.querySelectorAll<HTMLInputElement>("[data-dim]").forEach((inp) => {
        (next as unknown as Record<string, number>)[inp.dataset.dim!] = Number(inp.value);
      });
      dims = next;
    }
    rebuildAll(true);
    toast(`House set to ${L.dims.width} × ${L.dims.length} m. Gear re-placed.`);
  }
});
panel.addEventListener("change", (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.id === "lens") { lens = t.value as Lens; persist(); }
  if (t.id === "rot") rot = Number(t.value) as 0 | 1;
});

document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
  b.addEventListener("click", () => {
    setSpeed(Number(b.dataset.speed));
  }),
);

function rebuildAll(regear: boolean) {
  L = buildLayout(dims);
  dims = { ...L.dims };
  if (regear) gears = autoPlace(L, lens);
  const weeks = flock.weeks;
  flock = new Flock(L);
  flock.setWeeks(weeks);
  staff = new Staff(L, flock);
  lastWeeks = -1;
  buildWorld();
  gearChanged(regear);
  frameHouse();
}


// ------------------------------------------------------------------ guided experience
// The start menu, the camera tour and one clear task at a time for each job.
// Everything technical stays in the "More details" panel.
const menuEl = document.getElementById("menu")!;
const cardEl = document.getElementById("card")!;
const detailsBtn = document.getElementById("detailsBtn")!;
let tourStep = 0;
let tourCover = true;
let follow = false;
let stashed: Gear | null = null;
let pulse = false;

function niceTime(): string {
  const m = Math.floor(flock.minuteOfDay());
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "am" : "pm"}`;
}

function setSpeed(v: number) {
  speed = v;
  document.querySelectorAll<HTMLElement>("[data-speed]").forEach((x) => x.classList.toggle("on", Number(x.dataset.speed) === v));
}

function showDetails(on: boolean) {
  panel.classList.toggle("hidden", !on);
  detailsBtn.classList.toggle("on", on);
  if (on) renderPanel();
  // On phones the details sheet and the card share the bottom of the screen.
  if (window.innerWidth <= 720) cardEl.classList.toggle("hidden", on || mode === "plan");
}
detailsBtn.addEventListener("click", () => showDetails(panel.classList.contains("hidden")));
document.getElementById("menuBtn")!.addEventListener("click", showMenu);

function showMenu() {
  restoreStash();
  menuEl.classList.remove("hidden");
  setSpeed(0);
}

function flyTo(x: number, z: number, dist: number, height = 0.75) {
  controls.target.set(x, 0, z);
  const dir = V(0, height, 0.65).normalize().multiplyScalar(dist);
  camera.position.set(x + dir.x, dir.y, z + dir.z);
  controls.update();
}

function restoreStash() {
  if (stashed) { gears.push(stashed); stashed = null; gearChanged(false); }
}

menuEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-start]") as HTMLElement | null;
  if (!b) return;
  menuEl.classList.add("hidden");
  const what = b.dataset.start!;
  follow = false;
  player.job = null;
  setMonitor(what === "monitor");
  if (what === "monitor") return;
  if (what === "tour") { mode = "tour"; tourStep = 0; showDetails(false); renderTour(); }
  else if (what === "plan") {
    mode = "plan"; overlay = "coverage";
    cardEl.classList.add("hidden");
    buildGear(); drawFloor(); showDetails(true); frameHouse(); setSpeed(1);
    toast("Pick a camera type in the panel, then tap the floor to place it");
  } else startJob(what as Role);
});

// ---- tour
type TourStep = { title: string; text: string; go: () => void };
const pc = () => L.pc;
const firstPenCam = () => gears.find((g) => g.kind === "overhead");
const TOUR: TourStep[] = [
  { title: "The poultry house", text: "This is EcoGreen's poultry house: 20 m wide and 55 m long, with 7,000 hens in 4 pens. Drag to look around. Pinch or scroll to zoom.",
    go: () => { tourCover = false; frameHouse(); } },
  { title: "Cameras in the roof", text: "", go: () => {
      tourCover = false; pulse = true;
      const g = firstPenCam(); if (g) flyTo(g.x, g.z + 4, 20, 0.55);
    } },
  { title: "What each camera sees", text: "", go: () => { tourCover = true; frameHouse(); } },
  { title: "Blind spots", text: "Watch: we take one camera away. Its patch of floor turns red. A sick or dead hen there would not be noticed by anyone until it is too late.",
    go: () => {
      tourCover = true;
      const k = gears.findIndex((g) => g.kind === "overhead");
      if (k >= 0 && !stashed) { stashed = gears.splice(k, 1)[0]; gearChanged(false); }
      if (stashed) flyTo(stashed.x, stashed.z, 26);
    } },
  { title: "Spotting sick and dead hens", text: "The computer watches how much every hen moves. A hen that stands still for 30 minutes gets an orange ! above her. A dead hen gets a red ✖. The doctor gets an alert on their phone.",
    go: () => {
      tourCover = false; setSpeed(5);
      const a = flock.alerts.find((q) => !q.done && (q.kind === "sick" || q.kind === "dead"));
      if (a) flyTo(a.x, a.z, 14); else frameHouse();
    } },
  { title: "Who comes in", text: "A camera over each door records who comes in and when: workers, the vet and visitors. No more guessing when the hens were last checked.",
    go: () => { tourCover = false; flyTo(L.mainDoor.x, L.mainDoor.z - 2, 14); } },
  { title: "Counting eggs", text: "Eggs are collected in trays and put on this table. A camera above it counts every egg and spots cracked ones, so the numbers go straight into the ERP.",
    go: () => { tourCover = false; const c = center(L.eggTable); flyTo(c.x, c.z, 10); } },
  { title: "Air sensors", text: "Small yellow sensors hang in each pen and measure ammonia, the sharp smell that comes from wet bedding. Too much of it makes hens sick, so the floor keeper is warned early.",
    go: () => { tourCover = false; const g = gears.find((q) => q.kind === "sensor"); if (g) flyTo(g.x, g.z, 12); } },
  { title: "One computer runs it all", text: "Every camera plugs into one network switch and one computer in the corner. The computer runs the AI on the farm, so it keeps working even if the internet drops.",
    go: () => { tourCover = false; flyTo(pc().x - 1, pc().z, 10); } },
  { title: "What to buy", text: "", go: () => { tourCover = true; frameHouse(); } },
];

function tourText(i: number): string {
  const roof = gears.filter((g) => g.kind === "overhead").length + (stashed ? 1 : 0);
  if (i === 1) return `${roof} cameras hang from the roof beams, about ${mountY(L, L.hw / 2).toFixed(0)} m up, looking straight down at the hens. They are the white domes you see pulsing.`;
  if (i === 2) {
    const f = firstPenCam() ? footprint(L, firstPenCam()!) : null;
    const size = f ? `about ${Math.round(f.x1 - f.x0)} × ${Math.round(f.z1 - f.z0)} m` : "a patch";
    return `Each camera sees ${size} of floor. Blue floor means a camera can see it. Together they cover ${pctOf(cover.stats().total)} of the pens, so no hen is out of sight.`;
  }
  return TOUR[i].text;
}
const pctOf = (v: number) => `${Math.round(v * 100)}%`;

function buyList(): string {
  const n = (k: GearKind) => gears.filter((g) => g.kind === k).length + (stashed && stashed.kind === k ? 1 : 0);
  const cams = n("overhead") + n("door") + n("egg");
  const cable = shopping(L, gears).find((l) => l.item.startsWith("Cat6"));
  return `<ul class="buy">
    <li><b>${cams} cameras</b>: ${n("overhead")} for the roof, ${n("door")} for the doors, ${n("egg")} for the egg table</li>
    <li><b>${n("sensor")} air sensors</b> (ammonia, temperature, humidity)</li>
    <li><b>1 network switch</b> that powers the cameras through the cable</li>
    <li><b>1 AI computer</b> with a backup battery (UPS)</li>
    ${cable ? `<li><b>${cable.note?.replace("about ", "About ").replace(" of runs", "")} of cable</b> in plastic pipe, so rats can't chew it</li>` : ""}
  </ul>`;
}

function renderTour() {
  cardEl.classList.remove("hidden");
  pulse = false;
  if (tourStep !== 3) restoreStash();
  TOUR[tourStep].go();
  if (tourStep !== 4) setSpeed(1);
  buildGear();
  drawFloor();
  const last = tourStep === TOUR.length - 1;
  cardEl.innerHTML = `
    <div class="steps">How the cameras work · ${tourStep + 1} of ${TOUR.length}</div>
    <h2>${TOUR[tourStep].title}</h2>
    ${last ? `<p>Everything the farm needs, worked out from the house size:</p>${buyList()}` : `<p>${tourText(tourStep)}</p>`}
    <div class="acts">
      ${tourStep > 0 ? `<button class="btn ghost" data-tour="back">Back</button>` : ""}
      ${last ? `<button class="btn" data-tour="jobs">Try a job</button><button class="btn ghost" data-tour="plan">Change the plan</button>`
             : `<button class="btn" data-tour="next">Next</button>`}
    </div>`;
}

cardEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-tour],[data-task]") as HTMLElement | null;
  if (!b) return;
  const t = b.dataset.tour;
  if (t === "next") { tourStep = Math.min(TOUR.length - 1, tourStep + 1); renderTour(); }
  else if (t === "back") { tourStep = Math.max(0, tourStep - 1); renderTour(); }
  else if (t === "jobs") { restoreStash(); showMenu(); }
  else if (t === "plan") {
    restoreStash(); mode = "plan"; cardEl.classList.add("hidden"); buildGear(); drawFloor(); showDetails(true);
  } else if (b.dataset.task) runTask(b.dataset.task);
});

// ---- jobs
let taskAction: Record<string, () => void> = {};
function runTask(k: string) { taskAction[k]?.(); updateCard(true); }

function startJob(r: Role) {
  restoreStash();
  mode = "play";
  role = r;
  overlay = "none";
  truth = false;
  showDetails(false);
  if (r === "eggs" && !flock.laying) {
    flock.setWeeks(24);
    flock.fillNests();
    toast("The hens are now 24 weeks old and have laid this morning's eggs");
  }
  if (r === "manager") { follow = false; frameHouse(); }
  else {
    follow = true;
    player.x = L.mainDoor.x; player.z = L.mainDoor.z - 1.2;
    flyTo(player.x, player.z - 3, 16, 0.8);
  }
  setSpeed(1);
  buildGear();
  drawFloor();
  cardEl.classList.remove("hidden");
  updateCard(true);
}

let lastCard = "";
function updateCard(force = false) {
  if (mode !== "play" || cardEl.classList.contains("hidden") && !force) return;
  taskAction = {};
  const html = cardFor(role);
  if (html !== lastCard || force) { cardEl.innerHTML = html; lastCard = html; }
}

const btn = (key: string, label: string, act: () => void, ghost = false) => {
  taskAction[key] = act;
  return `<button class="btn ${ghost ? "ghost" : ""}" data-task="${key}">${label}</button>`;
};
const head = (who: string, title: string) => `<div class="who">${who}</div><h2>${title}</h2>`;
const fastBtn = () => btn("fast", "Speed up time ▶▶", () => setSpeed(5), true);

function openAlerts(kinds: string[]) {
  return flock.alerts.filter((a) => !a.done && kinds.includes(a.kind) && (a.bird < 0 || flock.st[a.bird] !== GONE));
}
function nearest<T extends { x: number; z: number }>(list: T[]): T | undefined {
  let best: T | undefined, bd = Infinity;
  for (const a of list) { const d = Math.hypot(a.x - player.x, a.z - player.z); if (d < bd) { bd = d; best = a; } }
  return best;
}
const where = (x: number, z: number) => flock.penName(x, z);
const goBird = (i: number) => () => { player.job = { kind: "bird", i }; };
const goDoor = () => { player.job = null; walkTo(L.mainDoor.x, L.mainDoor.z - 1); };

function cardFor(r: Role): string {
  if (r === "doctor") {
    const done = `<div class="progress">Treated: ${flock.stats.treated} · Dead hens removed: ${flock.stats.removed}</div>`;
    if (player.dead) return head("Doctor", "Take the dead hen out") +
      `<p>You are carrying ${player.dead} dead hen${player.dead > 1 ? "s" : ""}. Take ${player.dead > 1 ? "them" : "her"} out of the main door so disease doesn't spread.</p><div class="acts">${btn("door", "Walk to the door", goDoor)}</div>` + done;
    if (player.job?.kind === "bird") return head("Doctor", "On your way") + `<p>Walking to the hen the camera flagged...</p>` + done;
    const a = nearest(openAlerts(["sick", "dead"]).map((q) => ({ ...q, x: flock.x[q.bird], z: flock.z[q.bird] })));
    if (a && a.kind === "dead") return head("Doctor", "A hen has died") +
      `<p>The camera sees a hen lying still in ${where(a.x, a.z)}, marked with a red ✖. Pick her up before the others peck at her.</p><div class="acts">${btn("go", "Go and pick her up", goBird(a.bird))}</div>` + done;
    if (a) return head("Doctor", "A hen isn't moving") +
      `<p>The camera spotted a hen in ${where(a.x, a.z)} that has hardly moved for 30 minutes (orange !). Go and check her. If she's sick you'll treat her.</p><div class="acts">${btn("go", "Go and check her", goBird(a.bird))}</div>` + done;
    return head("Doctor", "All hens look fine") + `<p>No alerts right now. Speed up time and wait for the cameras to spot something.</p><div class="acts">${fastBtn()}</div>` + done;
  }
  if (r === "eggs") {
    const et = center(L.eggTable);
    const done = `<div class="progress">Eggs counted at the table: ${flock.stats.aiEggs.toLocaleString()}${flock.stats.cracked ? ` (${flock.stats.cracked} cracked)` : ""}</div>`;
    let best = -1;
    L.nests.forEach((n, k) => { if (flock.nestEggs[k] && (best < 0 || flock.nestEggs[k] > flock.nestEggs[best])) best = k; });
    let inNests = 0;
    for (let k = 0; k < flock.nestEggs.length; k++) inNests += flock.nestEggs[k];
    const floor = flock.floorEggs.length;
    if (player.eggs >= EGG_CART || (player.eggs && best < 0 && !floor)) return head("Egg collector", "Your cart is full") +
      `<p>You have ${player.eggs} eggs. Put them on the egg table, where the camera counts them.</p><div class="acts">${btn("table", "Walk to the egg table", () => walkTo(et.x, et.z - 1.2))}</div>` + done;
    if (best >= 0) {
      const n = L.nests[best];
      const pen = L.pens[n.pen];
      const collectRow = () => {
        // Walk the row of boxes on that wall, nearest end first.
        const row = L.nests.filter((q, k) => q.pen === n.pen && q.x === n.x && flock.nestEggs[k] > 0)
          .map((q) => ({ x: q.x + (q.x < 0 ? 0.9 : -0.9), z: q.z }));
        row.sort((a, b2) => a.z - b2.z);
        if (Math.abs(row[row.length - 1].z - player.z) < Math.abs(row[0].z - player.z)) row.reverse();
        player.job = null;
        player.route = row;
        const first = player.route.shift()!;
        walkTo(first.x, first.z);
      };
      return head("Egg collector", "Eggs are waiting") +
        `<p>${inNests.toLocaleString()} eggs are in the nest boxes along the walls${floor ? `, and ${floor} were laid on the floor (pick those up before they get dirty)` : ""}. Your cart holds ${EGG_CART} eggs (12 trays).</p>
        <div class="acts">${player.route.length ? "" : btn("nest", `Collect from the ${pen.name} boxes`, collectRow)}${player.eggs ? btn("table", `Deliver ${player.eggs} eggs`, () => { player.route = []; walkTo(et.x, et.z - 1.2); }, !!player.route.length || player.eggs < EGG_CART) : ""}</div>` + done;
    }
    if (floor) {
      const f = nearest(flock.floorEggs)!;
      return head("Egg collector", "Eggs on the floor") + `<p>${floor} eggs were laid on the floor. Pick them up before they get dirty or broken.</p><div class="acts">${btn("floor", "Go to the nearest one", () => walkTo(f.x, f.z))}</div>` + done;
    }
    return head("Egg collector", "No eggs waiting") + `<p>Hens lay mostly between 6 and 11 in the morning. Speed up time to the next morning.</p><div class="acts">${fastBtn()}</div>` + done;
  }
  if (r === "litter") {
    const done = `<div class="progress">Darker floor = wetter bedding. Wet spots come from leaky drinkers.</div>`;
    if (player.dead) return head("Floor keeper", "Take the dead hen out") + `<p>Take the dead hen out of the main door.</p><div class="acts">${btn("door", "Walk to the door", goDoor)}</div>` + done;
    if (player.job?.kind === "rake") return head("Floor keeper", "Raking") + `<p>Raking the wet bedding and adding dry bedding on top...</p>` + done;
    const w = nearest(openAlerts(["wet"]));
    if (w) return head("Floor keeper", "Wet bedding spotted") +
      `<p>The camera sees a dark, wet patch in ${where(w.x, w.z)}. Wet bedding makes ammonia, which makes hens sick. Rake it and add dry bedding.</p><div class="acts">${btn("rake", "Go and rake it", () => { player.job = { kind: "rake", x: w.x, z: w.z, t: 2 }; walkTo(w.x, w.z); })}</div>` + done;
    const d = nearest(openAlerts(["dead"]).map((q) => ({ ...q, x: flock.x[q.bird], z: flock.z[q.bird] })));
    if (d) return head("Floor keeper", "A dead hen") + `<p>Pick up the dead hen in ${where(d.x, d.z)}.</p><div class="acts">${btn("go", "Go and pick her up", goBird(d.bird))}</div>` + done;
    return head("Floor keeper", "The floor is dry") + `<p>Nothing to do right now. Tap any dark patch to rake it, or speed up time.</p><div class="acts">${fastBtn()}</div>` + done;
  }
  // Manager: the whole farm in a few plain lines.
  let alive = 0, sick = 0, dead = 0;
  for (let i = 0; i < flock.n; i++) {
    const st = flock.st[i];
    if (st === GONE) continue;
    if (st === DEAD) { if (flock.flag[i] & 2 || truth) dead++; continue; }
    alive++;
    if (flock.flag[i] & 1 || truth && st === SICK) sick++;
  }
  let ppm = 0;
  for (const p of flock.sensors) ppm = Math.max(ppm, flock.ammonia(p.x, p.z));
  const days = Math.floor(Math.max(0, flock.stats.feedBags) / Math.max(1, Math.ceil((alive * 0.11) / 50)));
  const wet = openAlerts(["wet"]).length;
  const last = flock.log[0];
  return head("Manager", "The farm right now") + `<ul class="sum">
      <li><span class="i">🐔</span><span>${alive.toLocaleString()} hens alive</span></li>
      <li><span class="i">${sick ? "⚠️" : "✅"}</span><span>${sick ? `${sick} hen${sick > 1 ? "s" : ""} not moving, doctor alerted` : "No hens look sick"}</span></li>
      <li><span class="i">${dead ? "✖" : "✅"}</span><span>${dead ? `${dead} dead hen${dead > 1 ? "s" : ""} to remove` : "No dead hens"}</span></li>
      <li><span class="i">🥚</span><span>${flock.laying ? `${flock.today.laid.toLocaleString()} eggs laid today, ${flock.today.delivered.toLocaleString()} counted at the table` : "Too young to lay yet"}</span></li>
      <li><span class="i">🌾</span><span>Feed store: ${Math.max(0, flock.stats.feedBags)} bags, about ${days} days left</span></li>
      <li><span class="i">${ppm > 20 || wet ? "⚠️" : "✅"}</span><span>${ppm > 20 ? "Air smells of ammonia, check the bedding" : wet ? `${wet} wet bedding patch${wet > 1 ? "es" : ""} to rake` : "Air and bedding are fine"}</span></li>
      ${last ? `<li><span class="i">🚪</span><span>${esc(last.text)}</span></li>` : ""}
    </ul>
    <div class="acts">${btn("truth", truth ? "Show only what cameras see" : "What did the cameras miss?", () => { truth = !truth; }, true)}${btn("feed", overlay === "feeders" ? "Hide feeder activity" : "Show busy feeders", () => { overlay = overlay === "feeders" ? "none" : "feeders"; toast(overlay === "feeders" ? "Red feeders are busy, blue ones are quiet, grey ones no camera sees" : "Feeder colours off"); }, true)}</div>
    <div class="acts" style="margin-top:8px">${fastBtn()}</div>`;
}

// ---- floating icons above flagged hens and wet patches
function iconMaterial(text: string, bg: string): THREE.SpriteMaterial {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 8; ctx.strokeStyle = "#fff"; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "bold 76px system-ui, Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true });
}
const ICONS = { sick: iconMaterial("!", "#f57c00"), dead: iconMaterial("✖", "#d32f2f"), wet: iconMaterial("≈", "#6d4c41"), miss: iconMaterial("?", "#7e57c2") };
const iconPool: THREE.Sprite[] = [];
const iconGroup = new THREE.Group();
scene.add(iconGroup);
function updateIcons(t: number) {
  let k = 0;
  const put = (x: number, z: number, m: THREE.SpriteMaterial) => {
    if (k >= 80) return;
    let s = iconPool[k];
    if (!s) { s = new THREE.Sprite(m); s.renderOrder = 12; iconPool.push(s); iconGroup.add(s); }
    s.material = m;
    s.visible = true;
    const size = follow ? 0.9 : 1.6;
    s.scale.set(size, size, 1);
    s.position.set(x, 1.3 + Math.sin(t * 3 + k) * 0.15 + (follow ? 0 : 0.8), z);
    k++;
  };
  if (mode !== "plan") {
    for (const a of flock.alerts) {
      if (a.done) continue;
      if ((a.kind === "sick" || a.kind === "dead") && a.bird >= 0 && flock.st[a.bird] !== GONE) put(flock.x[a.bird], flock.z[a.bird], ICONS[a.kind]);
      else if (a.kind === "wet" && mode === "play") put(a.x, a.z, ICONS.wet);
    }
    if (truth) for (let i = 0; i < flock.n; i++) {
      const st = flock.st[i];
      if ((st === SICK && !(flock.flag[i] & 1)) || (st === DEAD && !(flock.flag[i] & 2))) put(flock.x[i], flock.z[i], ICONS.miss);
    }
  }
  for (let j = k; j < iconPool.length; j++) iconPool[j].visible = false;
}

// Keep the worker in view while they walk, without fighting the player's own drags.
let tourFocused = -1;
function followPlayer(dt: number) {
  if (mode === "tour" && tourStep === 4 && tourFocused !== 4) {
    const a = flock.alerts.find((q) => !q.done && (q.kind === "sick" || q.kind === "dead") && q.bird >= 0);
    if (a) { tourFocused = 4; flyTo(flock.x[a.bird], flock.z[a.bird], 12); }
  }
  if (mode === "tour" && tourStep !== 4) tourFocused = -1;
  if (!follow || mode !== "play" || role === "manager" || !player.moving) return;
  const want = V(player.x, 0, player.z);
  const delta = want.sub(controls.target).multiplyScalar(Math.min(1, dt * 2.5));
  controls.target.add(delta);
  camera.position.add(delta);
}

function pulseDomes(t: number) {
  const s = pulse ? 1.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * 5)) : 1;
  for (const d of domes) d.scale.setScalar(s);
}


// ------------------------------------------------------------------ camera monitor
// What each camera actually sees, rendered from the camera's own position and lens,
// with the AI's marks drawn on top. This is the farm office screen.
const monitorEl = document.getElementById("monitor")!;
const feedBox = document.getElementById("feedBox")!;
const aiCanvas = document.getElementById("ai") as HTMLCanvasElement;
const aiCtx = aiCanvas.getContext("2d")!;
const thumbsEl = document.getElementById("thumbs")!;
const feedInfo = document.getElementById("feedInfo")!;
const feedCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 80);
const thumbCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 80);
let feedList: Gear[] = [];
let feedSel = 0;
let thumbTurn = 0;
let fullRedraw = true;
let showBoxes = true;
let infoT = 0;
const START_DAY = Date.UTC(2026, 10, 2);

function setMonitor(on: boolean) {
  monitorEl.classList.toggle("hidden", !on);
  controls.enabled = !on;
  if (!on) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    return;
  }
  restoreStash();
  mode = "monitor";
  overlay = "none";
  cardEl.classList.add("hidden");
  showDetails(false);
  menuEl.classList.add("hidden");
  setSpeed(1);
  drawFloor();
  buildFeeds();
}
monitorEl.addEventListener("scroll", () => (fullRedraw = true));
window.addEventListener("resize", () => (fullRedraw = true));

function feedName(i: number): string {
  const g = feedList[i];
  const n = `CAM ${String(i + 1).padStart(2, "0")}`;
  if (g.kind === "overhead") return `${n} · ${flock.penName(g.x, g.z).toUpperCase()}`;
  if (g.kind === "egg") return `${n} · EGG TABLE`;
  return `${n} · ${isBackDoor(g) ? "BACK DOOR" : "MAIN DOOR"}`;
}
const isBackDoor = (g: Gear) => Math.hypot(g.x - L.backDoor.x, g.z - L.backDoor.z) < Math.hypot(g.x - L.mainDoor.x, g.z - L.mainDoor.z);

function buildFeeds() {
  const order: Record<string, number> = { overhead: 0, door: 1, egg: 2 };
  feedList = gears.filter((g) => g.kind !== "sensor").sort((a, b) =>
    order[a.kind] - order[b.kind] || flock.penAt(a.x, a.z) - flock.penAt(b.x, b.z) || b.z - a.z || a.x - b.x);
  feedSel = Math.min(feedSel, Math.max(0, feedList.length - 1));
  thumbsEl.innerHTML = feedList.map((_, i) => `<button class="thumb ${i === feedSel ? "on" : ""}" data-feed="${i}"><span>${esc(feedName(i))}</span><i class="hidden"></i></button>`).join("");
  fullRedraw = true;
  infoT = 0;
}
thumbsEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-feed]") as HTMLElement | null;
  if (!b) return;
  feedSel = Number(b.dataset.feed);
  thumbsEl.querySelectorAll(".thumb").forEach((t, i) => t.classList.toggle("on", i === feedSel));
  infoT = 0;
  if (window.innerWidth <= 860) monitorEl.scrollTo({ top: 0, behavior: "smooth" });
});
feedInfo.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-boxes]")) { showBoxes = !showBoxes; infoT = 0; }
});

/** Point a camera exactly where the real one hangs, with the real lens. */
function aimCamera(cam: THREE.PerspectiveCamera, g: Gear) {
  cam.aspect = 16 / 9;
  if (g.kind === "overhead") {
    const hf = (LENS[g.lens].h * Math.PI) / 180;
    cam.fov = (2 * Math.atan(Math.tan(hf / 2) / cam.aspect) * 180) / Math.PI;
    cam.position.set(g.x, mountY(L, g.x) - 0.2, g.z);
    if (g.rot === 0) cam.up.set(0, 0, -1); else cam.up.set(1, 0, 0);
    cam.lookAt(g.x, 0, g.z);
  } else if (g.kind === "door") {
    const d = isBackDoor(g) ? L.backDoor : L.mainDoor;
    const inward = d.z > 0 ? -1 : 1;
    cam.fov = 62;
    cam.up.set(0, 1, 0);
    cam.position.set(d.x, 3.2, d.z + inward * 0.4);
    cam.lookAt(d.x + 1.5, 0.4, d.z + inward * 8);
  } else {
    const c = center(L.eggTable);
    cam.fov = 50;
    cam.up.set(0, 1, 0);
    cam.position.set(c.x, 2.5, c.z + 1.2);
    cam.lookAt(c.x, 0.9, c.z);
  }
  cam.updateProjectionMatrix();
}

function renderMonitor(t: number) {
  if (!feedList.length) { renderer.setScissorTest(false); renderer.clear(); return; }
  const ch = renderer.domElement.clientHeight;
  // Hide the planning aids: a real camera only sees the house and the hens.
  const vis = [gearGroup.visible, iconGroup.visible, markerMesh.visible, jobRing.visible];
  gearGroup.visible = iconGroup.visible = markerMesh.visible = jobRing.visible = false;
  for (const l of labels) l.visible = false;
  if (fullRedraw) { renderer.setScissorTest(false); renderer.setClearColor(0x1d1a16); renderer.clear(); }
  renderer.setScissorTest(true);
  const draw = (el: Element, cam: THREE.PerspectiveCamera) => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > ch || r.width < 4) return;
    const y = ch - r.bottom;
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.render(scene, cam);
  };
  aimCamera(feedCam, feedList[feedSel]);
  draw(feedBox, feedCam);
  const thumbs = thumbsEl.children;
  const n = fullRedraw ? feedList.length : Math.min(2, feedList.length);
  for (let k = 0; k < n; k++) {
    const i = thumbTurn++ % feedList.length;
    aimCamera(thumbCam, feedList[i]);
    if (thumbs[i]) draw(thumbs[i], thumbCam);
  }
  fullRedraw = false;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, renderer.domElement.clientWidth, ch);
  [gearGroup.visible, iconGroup.visible, markerMesh.visible, jobRing.visible] = vis;
  for (const l of labels) l.visible = true;
  drawAI(feedList[feedSel], t);
  if ((infoT -= 1 / 60) <= 0) { infoT = 0.5; updateFeedInfo(); }
}

const v3 = new THREE.Vector3();
function stamp(): string {
  const d = new Date(START_DAY + flock.time * 60000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
const inView = new Set<number>();

function drawAI(g: Gear, t: number) {
  const r = feedBox.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (aiCanvas.width !== W || aiCanvas.height !== H) { aiCanvas.width = W; aiCanvas.height = H; }
  const ctx = aiCtx;
  ctx.clearRect(0, 0, W, H);
  const proj = (x: number, y: number, z: number) => {
    v3.set(x, y, z).project(feedCam);
    return { x: ((v3.x + 1) / 2) * W, y: ((1 - v3.y) / 2) * H, ok: v3.z < 1 && Math.abs(v3.x) <= 1 && Math.abs(v3.y) <= 1 };
  };
  const f = Math.max(11, Math.round(W / 70));
  const placed: [number, number, number][] = [];
  const tag = (x: number, y: number, text: string, bg: string) => {
    ctx.font = `800 ${f}px system-ui, Arial`;
    const w = ctx.measureText(text).width + f;
    const tx = Math.min(W - w - 4, Math.max(4, x - w / 2));
    let ty = Math.min(H - f * 1.6, Math.max(4, y - f * 1.9));
    // Don't let two tags sit on top of each other.
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
      if (st === DEAD) continue; // not noticed yet: the AI waits 10 minutes
      if (showBoxes) ctx.strokeRect(p.x - hb, p.y - hb, hb * 2, hb * 2);
    }
    const blink = 0.6 + 0.4 * Math.sin(t * 6);
    for (const i of flagged) {
      const p = proj(flock.x[i], 0.1, flock.z[i]);
      const dead = (flock.flag[i] & 2) !== 0;
      const col = dead ? `rgba(244,67,54,${blink})` : `rgba(255,152,0,${blink})`;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = col;
      const bb = hb * 1.6;
      ctx.strokeRect(p.x - bb, p.y - bb, bb * 2, bb * 2);
      const mins = dead ? Math.round(flock.still[i]) : Math.round(flock.low[i]);
      tag(p.x, p.y - bb, dead ? `DEAD · ${mins} min` : `NOT MOVING · ${mins} min`, dead ? "#d32f2f" : "#ef6c00");
    }
  } else if (g.kind === "door") {
    // handled below with everyone else
  } else {
    const c = center(L.eggTable);
    const a = proj(c.x - 0.9, 0.95, c.z - 0.45), b = proj(c.x + 0.9, 0.95, c.z + 0.45);
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = "rgba(255,213,79,.9)";
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    tag((a.x + b.x) / 2, Math.min(a.y, b.y), `EGGS COUNTED TODAY · ${flock.today.delivered.toLocaleString()}`, "#8d6e00");
  }
  // People: the AI boxes every person it sees and says who it is and what they are doing.
  const people: { x: number; z: number; o: THREE.Object3D; name: string; doing: string }[] = [];
  staff.workers.forEach((w, k) => { if (w.pose !== "away" && crew[k]) people.push({ x: w.x, z: w.z, o: crew[k].p.root, name: w.name, doing: w.doing }); });
  if (playerMesh.visible) people.push({ x: player.x, z: player.z, o: playerMesh, name: `${ROLES[role].name} (you)`, doing: "" });
  for (const q of people) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, seen = 0;
    for (const dx of [-0.35, 0.35]) for (const dz of [-0.35, 0.35]) for (const y of [0, 1.8]) {
      const pt = proj(q.x + dx, y, q.z + dz);
      if (v3.z >= 1) continue;
      if (pt.ok) seen++;
      x0 = Math.min(x0, pt.x); x1 = Math.max(x1, pt.x); y0 = Math.min(y0, pt.y); y1 = Math.max(y1, pt.y);
    }
    if (!seen) continue;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#4fc3f7";
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    tag((x0 + x1) / 2, y0, `PERSON · ${q.name.toUpperCase()}${q.doing ? ` · ${q.doing}` : ""}`, "#0277bd");
  }
  // CCTV text, like the real recorder puts on screen.
  ctx.font = `700 ${f}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 4;
  ctx.fillStyle = "#fff";
  ctx.fillText(feedName(feedSel), f, f);
  ctx.fillText(stamp(), f, H - f * 2.2);
  if (Math.sin(t * 4) > -0.3) { ctx.fillStyle = "#ff3b30"; ctx.beginPath(); ctx.arc(W - f * 4.6, f * 1.55, f * 0.45, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#fff";
  ctx.fillText("REC", W - f * 3.8, f);
  if (g.kind === "overhead") {
    let alive = 0;
    for (const i of inView) if (flock.st[i] < DEAD) alive++;
    const txt = `AI COUNT ${alive}`;
    ctx.fillText(txt, W - ctx.measureText(txt).width - f, H - f * 2.2);
  }
  ctx.shadowBlur = 0;
}

function updateFeedInfo() {
  const g = feedList[feedSel];
  if (!g) { feedInfo.innerHTML = "<h2>No cameras placed</h2>"; return; }
  // Alert badges on the thumbnails.
  const badges = thumbsEl.querySelectorAll("i");
  feedList.forEach((q, i) => {
    let n = 0;
    if (q.kind === "overhead") {
      const fp = footprint(L, q);
      for (const a of flock.alerts) if (!a.done && (a.kind === "sick" || a.kind === "dead") && a.bird >= 0 && flock.st[a.bird] !== GONE && inRect(fp, flock.x[a.bird], flock.z[a.bird])) n++;
    }
    const b = badges[i] as HTMLElement | undefined;
    if (b) { b.textContent = String(n); b.classList.toggle("hidden", n === 0); }
  });
  if (g.kind === "overhead") {
    const fp = footprint(L, g);
    let alive = 0, sick = 0, dead = 0;
    for (const i of inView) {
      if (flock.st[i] < DEAD) alive++;
      if (flock.flag[i] & 2) dead++; else if (flock.flag[i] & 1) sick++;
    }
    feedInfo.innerHTML = `
      <h2>Roof camera ${feedSel + 1}</h2>
      <div class="sub">${flock.penName(g.x, g.z)} · hangs ${mountY(L, g.x).toFixed(1)} m up · sees about ${Math.round(fp.x1 - fp.x0)} × ${Math.round(fp.z1 - fp.z0)} m of floor</div>
      <div class="big">${alive.toLocaleString()}</div>
      <div>hens counted in this picture</div>
      <ul>
        <li><span class="sw" style="border-color:#6eff96"></span><span>Green box: a hen the AI is counting and watching</span></li>
        <li><span class="sw" style="border-color:#ff9800"></span><span>Orange: a hen that hasn't moved for 30 minutes. The doctor gets an alert.${sick ? ` <b>${sick} now.</b>` : ""}</span></li>
        <li><span class="sw" style="border-color:#f44336"></span><span>Red: a dead hen. Someone is sent to remove her.${dead ? ` <b>${dead} now.</b>` : ""}</span></li>
      </ul>
      <div class="row"><button class="btn ghost" data-boxes>${showBoxes ? "Hide green boxes" : "Show green boxes"}</button></div>`;
  } else if (g.kind === "door") {
    const entries = flock.log.filter((l) => /entered|came in|left|took|refilled|delivery|eggs on the table/i.test(l.text)).slice(0, 5);
    feedInfo.innerHTML = `
      <h2>${isBackDoor(g) ? "Back" : "Main"} door camera</h2>
      <div class="sub">Above the door, looking in</div>
      <p>Records everyone who comes in and out: workers, the vet, visitors, and feed going out of the store.</p>
      <ul>${entries.map((l) => `<li><span>${fmtT(l.t)}</span><span>${esc(l.text)}</span></li>`).join("") || "<li>Nobody yet today</li>"}</ul>`;
  } else {
    feedInfo.innerHTML = `
      <h2>Egg table camera</h2>
      <div class="sub">Above the table where trays are put down</div>
      <div class="big">${flock.today.delivered.toLocaleString()}</div>
      <div>eggs counted today${flock.stats.cracked ? `, ${flock.stats.cracked} cracked` : ""}</div>
      <p style="color:var(--muted)">Every tray put on the table is counted automatically, so the ERP gets the number without anyone writing it down.</p>`;
  }
}

// ------------------------------------------------------------------ loop
let paused = false;
P.onPause(() => (paused = true));
P.onResume(() => (paused = false));

const clockEl = document.getElementById("clock")!;
const ageEl = document.getElementById("age")!;
let uiT = 0, floorT = 0, last = performance.now(), lastBags = -1;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    if (speed > 0) {
      // Small steps so a worker never jumps across the house at high speed.
      let left = dt * speed;
      while (left > 0) { const h = Math.min(left, 0.5); flock.step(h); staff.step(h); left -= h; }
    }
    updatePlayer(dt);
    updateCrew(now / 1000);
    const light = flock.lightsOn();
    hemi.intensity = light ? 1.7 : 0.35;
    sun.intensity = light ? 1.1 : 0.1;
    (scene.background as THREE.Color).setHex(light ? 0x2a2622 : 0x0d0c0b);
    updateBirds();
    updateFeeders();
    updateIcons(now / 1000);
    followPlayer(dt);
    pulseDomes(now / 1000);
    uiT -= dt; floorT -= dt;
    if (toastT > 0 && (toastT -= dt) <= 0) toastEl.classList.remove("show");
    if (uiT <= 0) {
      uiT = 0.5;
      clockEl.textContent = `Day ${flock.day()} · ${niceTime()}${light ? "" : " · night"}`;
      ageEl.textContent = flock.laying ? `Laying hens, ${flock.weeks} weeks old` : `Young hens, ${flock.weeks} weeks old`;
      updateStats();
      updateCard();
      if (lastBags !== flock.stats.feedBags) { lastBags = flock.stats.feedBags; updateBags(); }
    }
    if (floorT <= 0) { floorT = 2; drawFloor(); }
  }
  controls.update();
  if (mode === "monitor") renderMonitor(now / 1000);
  else renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    const raw = await P.loadSave(GAME_ID);
    if (raw) {
      const s = JSON.parse(raw) as { v?: number; dims?: Dims; gears?: Gear[]; lens?: Lens };
      if (s.v !== SAVE_V) throw new Error("old save"); // measurements changed, start from the new defaults
      if (s.dims) dims = { ...DEFAULT_DIMS, ...s.dims };
      if (s.lens && s.lens in LENS) lens = s.lens;
      L = buildLayout(dims);
      flock = new Flock(L);
      staff = new Staff(L, flock);
      if (Array.isArray(s.gears)) gears = s.gears.filter((g) => g && typeof g.x === "number" && inRect({ x0: -L.hw, x1: L.hw, z0: -L.hl, z1: L.hl }, g.x, g.z));
    }
  } catch {
    /* bad save: start fresh */
  }
  buildWorld();
  gearChanged(false);
  frameHouse();
  setMonitor(true);
  P.firstFrameReady();
  requestAnimationFrame(frame);
  P.gameReady();
}
void boot();

// Hook for automated screenshots and checks (harmless in normal play).
(window as unknown as { __poultry: unknown }).__poultry = {
  get staff() { return staff; },
  get flock() { return flock; },
  scene,
  advance: (min: number) => { for (let t = 0; t < min; t += 0.25) { flock.step(0.25); staff.step(0.25); } },
  feeds: () => feedList.map((g, i) => ({ i, kind: g.kind, x: g.x, z: g.z, fp: g.kind === "overhead" ? footprint(L, g) : null })),
  pick: (i: number) => { feedSel = i; thumbsEl.querySelectorAll(".thumb").forEach((t, k) => t.classList.toggle("on", k === i)); infoT = 0; },
  look: (x: number, z: number, dist: number, h = 0.5) => { setMonitor(false); mode = "tour"; cardEl.classList.add("hidden"); flyTo(x, z, dist, h); },
};
