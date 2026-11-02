// Poultry House: plan the AI camera gear for the EcoGreen farm, then play the farm roles.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as P from "../../src/platform/platform";
import { DEFAULT_DIMS, Dims, Layout, buildLayout, center, inRect, mountY, rectD, rectW, roofY } from "./sim/layout";
import {
  CoverMap, DOOR_RADIUS, EGG_RADIUS, Gear, GearKind, LENS, Lens, SENSOR_RADIUS,
  autoPlace, coversBackDoor, coversDoor, coversEggTable, coversFeedStore, footprint, shopping,
} from "./sim/gear";
import { DEAD, Flock, GONE, HEALTHY, SICK } from "./sim/flock";

const GAME_ID = "poultry-house";
type Mode = "plan" | "play";
type Tool = GearKind | "remove";
type Role = "doctor" | "eggs" | "litter" | "manager";
type Overlay = "none" | "coverage" | "litter" | "feeders";

const ROLES: Record<Role, { name: string; color: number; help: string }> = {
  doctor: { name: "Doctor", color: 0xffffff, help: "Tap a bird or a red/orange alert. Walk there to treat a sick bird or bag a dead one, then take bags out the main door." },
  eggs: { name: "Egg collector", color: 0x42a5f5, help: "Walk past the nest boxes and floor eggs to collect them, then bring them to the egg table to be counted." },
  litter: { name: "Litter keeper", color: 0x66bb6a, help: "Tap dark, wet litter to rake it and add dry bedding. Wet litter makes ammonia and sick birds." },
  manager: { name: "Manager", color: 0xf5c542, help: "Watch the AI: counts, alerts, feeder activity and the door log. Tap an alert to look at it." },
};

// ------------------------------------------------------------------ state
let dims: Dims = { ...DEFAULT_DIMS };
let L: Layout = buildLayout(dims);
let gears: Gear[] = autoPlace(L, "2.8");
let cover = new CoverMap(L, gears);
let flock = new Flock(L);
let mode: Mode = "plan";
let tool: Tool = "overhead";
let lens: Lens = "2.8";
let rot: 0 | 1 = 0;
let role: Role = "doctor";
let speed = 1;
let overlay: Overlay = "coverage";
let truth = false;

const player = {
  x: 0, z: 0, tx: 0, tz: 0, moving: false,
  job: null as null | { kind: "bird"; i: number } | { kind: "rake"; x: number; z: number; t: number },
  eggs: 0, dead: 0, nearDoor: true,
};

// ------------------------------------------------------------------ renderer
P.initPlatform();
const host = document.getElementById("game")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
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
const PX = 8; // floor texture pixels per metre

let birdBody: THREE.InstancedMesh;
let birdHead: THREE.InstancedMesh;
let feederMesh: THREE.InstancedMesh;
let markerMesh: THREE.InstancedMesh;
let eggMesh: THREE.InstancedMesh;
let nestGroup: THREE.Group;
let bagsGroup: THREE.Group;
let playerMesh: THREE.Group;
let jobRing: THREE.Mesh;
const MAX_MARKERS = 600;
const MAX_EGGS = 4000;

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
  const { hw, hl } = L;
  const d = L.dims;

  // Floor, painted on a canvas so litter wetness and camera coverage can show on it.
  floorCanvas = document.createElement("canvas");
  floorCanvas.width = Math.ceil(d.width * PX);
  floorCanvas.height = Math.ceil(d.length * PX);
  floorCtx = floorCanvas.getContext("2d")!;
  floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.magFilter = THREE.NearestFilter;
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
  for (const [x0, z0, x1, z1] of edges.values()) {
    const len = Math.hypot(x1 - x0, z1 - z0);
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

  playerMesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.25, 12), mat(0xffffff));
  body.position.y = 0.7;
  body.name = "body";
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat(0x6d4c41));
  headM.position.y = 1.5;
  playerMesh.add(body, headM);
  world.add(playerMesh);
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

function drawFloor() {
  const ctx = floorCtx;
  const W = floorCanvas.width, H = floorCanvas.height;
  // Canvas y=0 is the back wall (z = -hl), matching the plane's UV after rotation.
  const px = (x: number) => (x + L.hw) * PX;
  const pz = (z: number) => (z + L.hl) * PX;
  ctx.fillStyle = "#8f8d88";
  ctx.fillRect(0, 0, W, H);
  for (const p of L.pens) {
    if (!p.active) { ctx.fillStyle = "#9a9892"; ctx.fillRect(px(p.x0), pz(p.z0), rectW(p) * PX, rectD(p) * PX); continue; }
    for (let z = Math.floor(p.z0); z < p.z1; z++)
      for (let x = Math.floor(p.x0); x < p.x1; x++) {
        const w = flock.wetAt(x + 0.5, z + 0.5);
        const showWet = overlay === "litter" || role === "litter" && mode === "play";
        const k = showWet ? Math.min(1, w * 1.2) : Math.min(1, w * 0.6);
        const r = 214 - 120 * k, g = 182 - 110 * k, b = 112 - 70 * k;
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(px(Math.max(x, p.x0)), pz(Math.max(z, p.z0)), PX + 1, PX + 1);
      }
  }
  const showCover = mode === "plan" || overlay === "coverage";
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
function buildGear() {
  clearGroup(gearGroup);
  const showPlan = mode === "plan";
  for (const g of gears) {
    if (g.kind === "overhead") {
      const y = mountY(L, g.x);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf5f5f5));
      dome.rotation.x = Math.PI;
      dome.position.set(g.x, y, g.z);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(0x111111));
      lens.position.set(g.x, y - 0.12, g.z);
      gearGroup.add(dome, lens);
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
  flock.setSensors(gears.filter((g) => g.kind === "sensor").map((g) => ({ x: g.x, z: g.z })));
  buildGear();
  drawFloor();
  renderPanel();
  if (saveIt) persist();
}

function persist() {
  void P.save(GAME_ID, JSON.stringify({ v: 1, dims, gears, lens }));
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

function updatePlayer(dt: number) {
  const visible = mode === "play" && role !== "manager";
  playerMesh.visible = visible;
  jobRing.visible = false;
  if (!visible) return;
  ((playerMesh.getObjectByName("body") as THREE.Mesh).material as THREE.MeshLambertMaterial).color.setHex(ROLES[role].color);
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
    } else {
      player.x += (dx / d) * step; player.z += (dz / d) * step;
      playerMesh.rotation.y = Math.atan2(dx, dz);
    }
  }
  if (player.job?.kind === "rake") {
    const j = player.job;
    if (!player.moving) {
      j.t -= dt;
      playerMesh.rotation.y += dt * 6;
      if (j.t <= 0) {
        flock.rake(j.x, j.z);
        player.job = null;
        drawFloor();
        toast("Raked and topped up with dry bedding");
      }
    }
  }
  playerMesh.position.set(player.x, 0, player.z);

  // Egg collector picks up anything within reach.
  if (role === "eggs") {
    const got = flock.collectNear(player.x, player.z, 1.1);
    if (got) player.eggs += got;
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
  if (mode === "plan") renderPlan();
  else renderPlay();
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
    <p>Width, length and peak are tape-measured. Wall height and aisle are still photo estimates. Applying re-places the gear.</p>
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

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.mode as Mode;
    document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
    if (mode === "play" && overlay === "coverage") overlay = "none";
    buildGear();
    drawFloor();
    renderPanel();
    if (mode === "play") toast(`Playing as ${ROLES[role].name}. Tap the floor to walk.`);
  }),
);
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
  b.addEventListener("click", () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll("[data-speed]").forEach((x) => x.classList.toggle("on", x === b));
  }),
);

function rebuildAll(regear: boolean) {
  L = buildLayout(dims);
  dims = { ...L.dims };
  if (regear) gears = autoPlace(L, lens);
  const weeks = flock.weeks;
  flock = new Flock(L);
  flock.setWeeks(weeks);
  lastWeeks = -1;
  buildWorld();
  gearChanged(regear);
  frameHouse();
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
    if (speed > 0) flock.step(dt * speed);
    updatePlayer(dt);
    const light = flock.lightsOn();
    hemi.intensity = light ? 1.7 : 0.35;
    sun.intensity = light ? 1.1 : 0.1;
    (scene.background as THREE.Color).setHex(light ? 0x2a2622 : 0x0d0c0b);
    updateBirds();
    updateFeeders();
    uiT -= dt; floorT -= dt;
    if (toastT > 0 && (toastT -= dt) <= 0) toastEl.classList.remove("show");
    if (uiT <= 0) {
      uiT = 0.5;
      clockEl.textContent = `Day ${flock.day()} ${flock.clock()}${light ? "" : " · lights off"}`;
      ageEl.textContent = `Week ${flock.weeks} · ${flock.laying ? "laying hens" : "pullets"} · ${L.dims.width}×${L.dims.length} m`;
      updateStats();
      if (lastBags !== flock.stats.feedBags) { lastBags = flock.stats.feedBags; updateBags(); }
    }
    if (floorT <= 0) { floorT = 2; drawFloor(); }
  }
  controls.update();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    const raw = await P.loadSave(GAME_ID);
    if (raw) {
      const s = JSON.parse(raw) as { dims?: Dims; gears?: Gear[]; lens?: Lens };
      if (s.dims) dims = { ...DEFAULT_DIMS, ...s.dims };
      if (s.lens && s.lens in LENS) lens = s.lens;
      L = buildLayout(dims);
      flock = new Flock(L);
      if (Array.isArray(s.gears)) gears = s.gears.filter((g) => g && typeof g.x === "number" && inRect({ x0: -L.hw, x1: L.hw, z0: -L.hl, z1: L.hl }, g.x, g.z));
    }
  } catch {
    /* bad save: start fresh */
  }
  buildWorld();
  gearChanged(false);
  frameHouse();
  P.firstFrameReady();
  requestAnimationFrame(frame);
  P.gameReady();
}
void boot();
