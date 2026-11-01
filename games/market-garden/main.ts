import * as THREE from "three";
import * as P from "../../src/platform/platform";
import * as M from "./models";
import { Sfx } from "./sfx";
import { setupDecor } from "./decor";

type Kind = M.ItemKind;
const GAME_ID = "market-garden";
const PRICE: Record<Kind, number> = { seed: 0, wheat: 3, flour: 6, bread: 13, egg: 7, milk: 9, cheese: 20 };
const SEED_COST = 1;

// Every store has a limit. Nothing piles up forever, but you can pay to make stores bigger.
// Tables are indexed by upgrade level; costs are multiplied by the building's tier.
const STORE_CAPS = [10, 15, 20, 30, 40, 60];
const STORE_COST = [40, 100, 240, 550, 1200];
const SPEED_MULT = [1, 0.8, 0.65, 0.5, 0.38];
const SPEED_COST = [80, 200, 500, 1200];
const SHELF_CAPS = [12, 18, 24, 36, 48, 64];
const SHELF_COST = [50, 130, 320, 750, 1600];
// Helpers start out very slow and carry little. Level 0 = not hired.
const HELPER_SPEED = [0, 1.0, 1.7, 2.6, 3.6, 5.0];
const HELPER_CARRY = [0, 2, 4, 6, 8, 10];
const HELPER_COST = [150, 250, 600, 1400, 3200];
// Stand still this long before anything is picked up, dropped or paid.
const HOLD = 1.0;
const PANEL_HOLD = 0.6;
const BUY_HOLD = 0.6;
const ROAD_Z = 8.2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------
// Renderer, camera, lights
// ------------------------------------------------------------------
P.initPlatform();
const host = document.getElementById("game")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
let camOffset = V(0, 15, 10.5);

scene.add(new THREE.HemisphereLight(0xdff4ff, 0x6b8f3a, 1.9));
const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 3;
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return; // Playables may load us in a zero-size view
  renderer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  // Portrait phones need a wider view; wide screens a closer one.
  camera.fov = aspect < 0.75 ? 50 : 40;
  camOffset = aspect < 0.75 ? V(0, 16, 14.5) : V(0, 13, 12);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------
// Scenery (see decor.ts)
// ------------------------------------------------------------------
const decor = setupDecor(scene);

const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "K" : String(Math.floor(n)));
const money = (n: number) => "$" + fmt(n);

// ------------------------------------------------------------------
// Ground decals (zone markers and build pads)
// ------------------------------------------------------------------
class Decal {
  mesh: THREE.Mesh;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  constructor(w: number, d: number, x: number, z: number) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = Math.round((256 * d) / w);
    this.ctx = c.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(x, 0.04, z);
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  zone(label: string, color: string) {
    const { ctx } = this, W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = color;
    ctx.lineWidth = 14;
    ctx.setLineDash([30, 16]);
    ctx.beginPath();
    ctx.roundRect(10, 10, W - 20, H - 20, 36);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = "bold 44px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(label, W / 2, H / 2);
    this.tex.needsUpdate = true;
  }
  pad(name: string, remaining: number, progress: number) {
    const { ctx } = this, W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(30,30,30,0.55)";
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, 30);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "rgba(247,197,49,0.85)";
    ctx.fillRect(0, H * (1 - progress), W, H * progress);
    ctx.restore();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 40px Arial, sans-serif";
    ctx.fillText(name, W / 2, H * 0.28);
    ctx.font = "bold 64px Arial, sans-serif";
    ctx.fillText(money(remaining), W / 2, H * 0.64);
    this.tex.needsUpdate = true;
  }
  dispose() {
    scene.remove(this.mesh);
    this.tex.dispose();
  }
}

// ------------------------------------------------------------------
// Flying objects, piles and stacks
// ------------------------------------------------------------------
interface Flyer { obj: THREE.Object3D; from: THREE.Vector3; to: () => THREE.Vector3; t: number; dur: number; h: number; done?: () => void }
const flyers: Flyer[] = [];
function fly(obj: THREE.Object3D, from: THREE.Vector3, to: () => THREE.Vector3, done?: () => void, dur = 0.28, h = 1.2) {
  obj.position.copy(from);
  scene.add(obj);
  flyers.push({ obj, from: from.clone(), to, t: 0, dur, h, done });
}
function updateFlyers(dt: number) {
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    if (f.obj.userData.dead) {
      scene.remove(f.obj);
      flyers.splice(i, 1);
      continue;
    }
    f.t = Math.min(1, f.t + dt / f.dur);
    const e = f.t * f.t * (3 - 2 * f.t);
    f.obj.position.lerpVectors(f.from, f.to(), e);
    f.obj.position.y += Math.sin(Math.PI * f.t) * f.h;
    if (f.t >= 1) {
      flyers.splice(i, 1);
      scene.remove(f.obj);
      f.done?.();
    }
  }
}

interface Item { kind: Kind; obj: THREE.Object3D; landed: boolean }

/** Items laid out in a grid that grows upward. Used for the farmer's back, vehicles, machines and the stall. */
class Pile {
  items: Item[] = [];
  cap = Infinity;
  label?: M.Label;
  labelY = 0;
  constructor(public group: THREE.Object3D, public cols = 2, public rows = 2, public sx = 0.7, public sz = 0.55, public layerH = 0.27) {}
  get full() { return this.items.length >= this.cap; }
  get space() { return Math.max(0, this.cap - this.items.length); }
  /** Optional limit per product (counters split their space evenly between what they sell). */
  kindCap?: (k: Kind) => number;
  spaceFor(k: Kind) {
    const left = this.space;
    return this.kindCap ? Math.max(0, Math.min(left, this.kindCap(k) - this.countOf(k))) : left;
  }
  fits(k: Kind) { return this.spaceFor(k) > 0; }
  /** Show a small "n/cap" sign above this store. */
  withLabel(y: number, cap: number) {
    this.cap = cap;
    this.label = new M.Label(150, 64, 1.0);
    this.label.sprite.position.set(0, y, 0);
    this.labelY = y;
    this.group.add(this.label.sprite);
    return this;
  }
  updateLabel() {
    if (!this.label) return;
    // Keep the sign above the stack as it grows.
    const layers = Math.ceil(this.count / (this.cols * this.rows));
    this.label.sprite.position.y = Math.max(this.labelY, layers * this.layerH + 0.75);
    this.label.set(this.full ? "FULL" : `${this.count}/${this.cap}`, "", this.full ? "rgba(198,40,40,0.9)" : "rgba(40,28,20,0.8)");
  }
  local(i: number) {
    const per = this.cols * this.rows;
    const c = i % this.cols, r = Math.floor(i / this.cols) % this.rows, l = Math.floor(i / per);
    return V((c - (this.cols - 1) / 2) * this.sx, l * this.layerH, (r - (this.rows - 1) / 2) * this.sz);
  }
  world(i: number) {
    this.group.updateWorldMatrix(true, false);
    return this.group.localToWorld(this.local(i));
  }
  get count() { return this.items.length; }
  countOf(k: Kind) { return this.items.filter((i) => i.kind === k).length; }
  add(kind: Kind, from?: THREE.Vector3) {
    const it: Item = { kind, obj: M.itemMesh(kind), landed: false };
    this.items.push(it);
    const land = () => {
      if (it.obj.userData.dead) return;
      it.landed = true;
      this.group.add(it.obj);
      this.layout();
    };
    if (from) fly(it.obj, from, () => this.world(Math.max(0, this.items.indexOf(it))), land);
    else land();
  }
  /** Remove the newest item matching `pred`. Returns its kind and where it was. */
  take(pred: (k: Kind) => boolean = () => true): { kind: Kind; at: THREE.Vector3 } | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!pred(it.kind)) continue;
      const at = this.world(i);
      this.items.splice(i, 1);
      it.obj.userData.dead = true;
      it.obj.parent?.remove(it.obj);
      this.layout();
      return { kind: it.kind, at };
    }
    return null;
  }
  layout() {
    this.items.forEach((it, i) => {
      if (it.landed) it.obj.position.copy(this.local(i));
    });
  }
  kinds(): Kind[] { return this.items.map((i) => i.kind); }
}

/** Dollars waiting at the stall, shown as stacks of bills. */
class Cash {
  value = 0;
  bills: THREE.Object3D[] = [];
  constructor(public group: THREE.Group) {}
  private slot(i: number) {
    const col = i % 6;
    return V((col % 3) * 0.62 - 0.62, Math.floor(i / 6) * 0.1 + 0.05, Math.floor(col / 3) * 0.4 - 0.2);
  }
  add(v: number, from?: THREE.Vector3) {
    this.value += v;
    const want = Math.min(60, Math.ceil(this.value / 4));
    while (this.bills.length < want) {
      const c = M.cashMesh();
      const target = this.slot(this.bills.length);
      this.bills.push(c);
      if (from) {
        fly(c, from, () => this.group.localToWorld(target.clone()), () => { if (!c.userData.dead) { this.group.add(c); c.position.copy(target); } }, 0.35, 1.5);
      } else {
        this.group.add(c);
        c.position.copy(target);
      }
    }
  }
  collect(to: () => THREE.Vector3): number {
    const v = this.value;
    this.value = 0;
    this.bills.forEach((c, i) => {
      const from = c.getWorldPosition(V());
      c.userData.dead = true;
      c.parent?.remove(c);
      setTimeout(() => fly(M.cashMesh(), from, to, undefined, 0.25, 1.0), i * 12);
    });
    this.bills = [];
    return v;
  }
}

/** Speech bubble over a customer: what they want, how many, and how patient they still are. */
class Bubble {
  sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = "";
  constructor() {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 120;
    this.ctx = c.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }));
    this.sprite.scale.set(2.1, 1.26, 1);
    this.sprite.renderOrder = 15;
  }
  set(kind: Kind, got: number, want: number, patience: number, angry: boolean) {
    const p = Math.round(patience * 20);
    const key = `${kind}${got}${want}${p}${angry}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.ctx;
    g.clearRect(0, 0, 200, 120);
    g.fillStyle = angry ? "#ff6b6b" : "#ffffff";
    g.beginPath();
    g.roundRect(6, 6, 188, 84, 22);
    g.moveTo(88, 88);
    g.lineTo(100, 112);
    g.lineTo(112, 88);
    g.fill();
    if (angry) {
      g.fillStyle = "#fff";
      g.font = "900 50px Arial, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("Grr!", 100, 50);
    } else {
      drawIcon(g, kind, 52, 46);
      g.fillStyle = "#3e2a1f";
      g.font = "900 40px Arial, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(got > 0 ? `${got}/${want}` : `x${want}`, 92, 44);
      // patience bar
      g.fillStyle = "#e0e0e0";
      g.fillRect(24, 74, 152, 8);
      g.fillStyle = patience > 0.5 ? "#43a047" : patience > 0.25 ? "#ffa000" : "#e53935";
      g.fillRect(24, 74, 152 * patience, 8);
    }
    this.tex.needsUpdate = true;
  }
}

function drawIcon(g: CanvasRenderingContext2D, kind: Kind, x: number, y: number) {
  g.save();
  g.translate(x, y);
  if (kind === "wheat") {
    g.strokeStyle = "#b8962e";
    g.lineWidth = 4;
    for (const a of [-0.35, 0, 0.35]) {
      g.save();
      g.rotate(a);
      g.beginPath();
      g.moveTo(0, 26);
      g.lineTo(0, -6);
      g.stroke();
      g.fillStyle = "#f0c94a";
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.ellipse(-4, -6 - k * 7, 4, 6, -0.5, 0, Math.PI * 2);
        g.ellipse(4, -6 - k * 7, 4, 6, 0.5, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  } else if (kind === "flour") {
    g.fillStyle = "#f7f3ea";
    g.strokeStyle = "#cfc6b4";
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(-22, -22, 44, 50, 10);
    g.fill();
    g.stroke();
    g.fillStyle = "#6aa0d8";
    g.fillRect(-22, -2, 44, 10);
  } else if (kind === "egg") {
    g.fillStyle = "#fff6e6";
    g.strokeStyle = "#d9c7a6";
    g.lineWidth = 3;
    for (const dx of [-12, 12]) {
      g.beginPath();
      g.ellipse(dx, 4, 13, 18, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  } else if (kind === "milk") {
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#9bb8d6";
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(-14, -14, 28, 42, 6);
    g.rect(-8, -26, 16, 14);
    g.fill();
    g.stroke();
    g.fillStyle = "#2f7fd0";
    g.fillRect(-9, -30, 18, 6);
    g.fillRect(-14, 4, 28, 10);
  } else if (kind === "cheese") {
    g.fillStyle = "#ffc928";
    g.strokeStyle = "#e08a1e";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-28, 20);
    g.lineTo(28, 20);
    g.lineTo(28, -4);
    g.lineTo(-28, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#e8a91c";
    for (const [cx, cy] of [[-8, 12], [12, 8], [18, 15]]) {
      g.beginPath();
      g.arc(cx, cy, 4, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.fillStyle = "#c98a3c";
    g.beginPath();
    g.ellipse(0, 4, 30, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#f3d19c";
    g.lineWidth = 4;
    for (const dx of [-12, 0, 12]) {
      g.beginPath();
      g.moveTo(dx - 5, -6);
      g.lineTo(dx + 5, 10);
      g.stroke();
    }
  }
  g.restore();
}

// ------------------------------------------------------------------
// The farmer
// ------------------------------------------------------------------
const farmer = M.farmer();
scene.add(farmer.root);
farmer.root.position.set(0, 0, 4);
const bag = new Pile(farmer.back, 1, 1, 0, 0, 0.27);
let capacity = 10;
bag.cap = capacity;

// ------------------------------------------------------------------
// State shared by many systems
// ------------------------------------------------------------------
const built = new Set<string>();
const spinners: ((dt: number) => void)[] = [];
let clock = 0;
let coins = 0, lifetime = 0;

// ------------------------------------------------------------------
// Effects
// ------------------------------------------------------------------
const pops: { obj: THREE.Object3D; t: number; delay: number; base: THREE.Vector3 }[] = [];
function popIn(obj: THREE.Object3D, delay: number) {
  pops.push({ obj, t: 0, delay, base: obj.scale.clone() });
  obj.scale.setScalar(0.0001);
}
function updatePops(dt: number) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.t = Math.min(1, p.t + dt / 0.45);
    const s = p.t >= 1 ? 1 : 1 - Math.pow(2, -10 * p.t) * Math.cos(p.t * 9);
    p.obj.scale.copy(p.base).multiplyScalar(Math.max(0.0001, s));
    if (p.t >= 1) pops.splice(i, 1);
  }
}
const bits: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
const bitGeo = new THREE.BoxGeometry(0.14, 0.14, 0.05);
function confetti(at: THREE.Vector3) {
  const cols = [0xf7c531, 0xe53935, 0x43a047, 0x1e88e5, 0xffffff, 0xff7043];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(bitGeo, M.mat(cols[i % cols.length]));
    m.position.copy(at);
    scene.add(m);
    bits.push({ m, v: V((Math.random() - 0.5) * 7, 5 + Math.random() * 5, (Math.random() - 0.5) * 7), life: 1.4 });
  }
}
function updateBits(dt: number) {
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life -= dt;
    b.v.y -= 16 * dt;
    b.m.position.addScaledVector(b.v, dt);
    b.m.rotation.x += dt * 8;
    b.m.rotation.y += dt * 6;
    if (b.life <= 0 || b.m.position.y < 0) {
      scene.remove(b.m);
      bits.splice(i, 1);
    }
  }
}
const sfx = new Sfx();

// ------------------------------------------------------------------
// Upgrade levels (storage, speed, counters, helpers), all saved
// ------------------------------------------------------------------
const lvl: Record<string, number> = {};
const L = (id: string) => lvl[id] ?? 0;

// ------------------------------------------------------------------
// Fields
// ------------------------------------------------------------------
/** growth: -1 = bare soil (needs seed), 0..1 = growing, 1 = ripe. */
interface Tile { pos: THREE.Vector3; plant: THREE.Group; growth: number; field: number }
const tiles: Tile[] = [];
function makeField(field: number, cx: number, cz: number, animate: boolean, startGrowth = 1) {
  const cols = 4, rows = 5, s = 1.4;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = cx + (c - (cols - 1) / 2) * s, z = cz + (r - (rows - 1) / 2) * s;
      const soil = M.fieldTile();
      soil.position.set(x, 0.06, z);
      scene.add(soil);
      const plant = M.wheatPlant();
      plant.position.set(x, 0.12, z);
      plant.rotation.y = Math.random() * Math.PI;
      scene.add(plant);
      tiles.push({ pos: V(x, 0, z), plant, growth: startGrowth, field });
      if (animate) {
        popIn(soil, (c + r) * 0.04);
        popIn(plant, (c + r) * 0.04 + 0.1);
      }
    }
  }
}
const regrowTime = () => 7 * (built.has("well") ? 0.55 : 1) * (built.has("dam") ? 0.75 : 1);

// ------------------------------------------------------------------
// Colliders, upgrade pads
// ------------------------------------------------------------------
interface Box { x0: number; x1: number; z0: number; z1: number }
const colliders: Box[] = [];
const solid = (x: number, z: number, w: number, d: number) => colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });

/** Purple pads next to each building. Stand on one to open its upgrade menu. */
interface UpPad { owner: string; name: string; pos: THREE.Vector3 }
const upPads: UpPad[] = [];
function addUpPad(owner: string, name: string, pos: THREE.Vector3) {
  if (upPads.some((u) => u.owner === owner)) return;
  new Decal(1.7, 1.7, pos.x, pos.z).zone("UPGRADE", "#9c6bff");
  upPads.push({ owner, name, pos });
}

// ------------------------------------------------------------------
// Counters: market stall, egg stand, dairy stand. Each has its own customers.
// ------------------------------------------------------------------
interface Customer {
  obj: THREE.Group; state: "walk" | "leave"; kind: Kind; want: number; got: number; paid: number; road: boolean; age: number;
  timer: number; patience: number; maxPatience: number; waited: number; angry: boolean; bubble: Bubble; hands: Pile;
}
interface Counter {
  id: string; name: string; tier: number; on: boolean; accepts: Kind[]; side: number; x: number; z: number;
  shelf: Pile; sellZone: THREE.Vector3; cash: Cash; cashZone: THREE.Vector3; upPad: THREE.Vector3;
  customers: Customer[]; spawnTimer: number; lost: number; rating: number; stars: M.Label; kinds: () => Kind[];
  every: () => number; demand: () => { options: [Kind, number][]; maxWant: number };
  build: (animate: boolean) => void;
}
/** side -1: customers queue on the west, you stock from the east. side +1: the other way round. */
function makeCounter(id: string, name: string, tier: number, x: number, z: number, side: number, awning: number, accepts: Kind[],
  every: Counter["every"], demand: Counter["demand"]): Counter {
  const sx = x - side * 2.0;
  const shelfGroup = new THREE.Group();
  shelfGroup.position.set(x, 0.97, z);
  shelfGroup.rotation.y = (side * Math.PI) / 2;
  scene.add(shelfGroup);
  const shelf = new Pile(shelfGroup, 5, 2, 0.6, 0.5, 0.26).withLabel(1.9, SHELF_CAPS[0]);
  shelf.label!.sprite.visible = false;
  const cashGroup = new THREE.Group();
  cashGroup.position.set(sx, 0, z + 2.6);
  scene.add(cashGroup);
  const stars = new M.Label(330, 80, 2.2);
  stars.sprite.position.set(x, 3.3, z);
  stars.sprite.visible = false;
  scene.add(stars.sprite);
  const c: Counter = {
    id, name, tier, on: false, accepts, side, x, z, shelf, sellZone: V(sx, 0, z), cash: new Cash(cashGroup), cashZone: V(sx, 0, z + 2.6),
    upPad: V(sx, 0, z - 2.5), customers: [], spawnTimer: 0.3, lost: 0, rating: 3, stars, every, demand, build: () => {},
    kinds: () => demand().options.map(([k]) => k),
  };
  // Shelf space is shared equally between the products this counter sells right now.
  shelf.kindCap = () => Math.max(1, Math.floor(shelf.cap / c.kinds().length));
  c.build = (animate) => {
    if (c.on) return;
    c.on = true;
    const st = M.stall(awning);
    st.position.set(x, 0, z);
    st.rotation.y = (side * Math.PI) / 2;
    scene.add(st);
    if (animate) popIn(st, 0);
    solid(x, z, 1.3, 3.3);
    new Decal(1.8, 2.6, sx, z).zone("SELL", "#ffd54f");
    shelf.label!.sprite.visible = true;
    stars.sprite.visible = true;
    addUpPad(id, name, c.upPad);
  };
  return c;
}
const stallC = makeCounter("stall", "Market stall", 1, -6.4, 4.4, -1, M.COLORS.roofRed, ["wheat", "flour", "bread"],
  () => (built.has("bakery") ? 2.6 : 3.4),
  () => {
    const options: [Kind, number][] = [["wheat", 1]];
    if (built.has("windmill")) options.push(["flour", 1.4]);
    if (built.has("bakery")) options.push(["bread", 1.8]);
    return { options, maxWant: 1 + options.length };
  });
const eggC = makeCounter("eggs", "Egg stand", 3, 17.4, 4.4, 1, 0xf2b705, ["egg"], () => 3.8, () => ({ options: [["egg", 1]], maxWant: 4 }));
const dairyC = makeCounter("dairy", "Dairy stand", 5, 24.4, 4.4, 1, 0x2f7fd0, ["milk", "cheese"], () => 4.2, () => {
  const options: [Kind, number][] = [["milk", 1]];
  if (built.has("creamery")) options.push(["cheese", 1.5]);
  return { options, maxWant: 1 + options.length };
});
const counters = [stallC, eggC, dairyC];
stallC.build(false);
const counterFor = (k: Kind) => counters.find((c) => c.accepts.includes(k))!;

// Seed crate: stand here to buy seed bags for planting.
const crate = M.seedCrate();
crate.position.set(4.6, 0, 3.6);
crate.rotation.y = 0.15;
scene.add(crate);
solid(4.6, 3.6, 1.4, 1.0);
const seedZone = { pos: V(3.0, 0, 3.0), r: 1.1 };
new Decal(1.9, 1.6, seedZone.pos.x, seedZone.pos.z).zone(`SEEDS $${SEED_COST}`, "#a1887f");

// ------------------------------------------------------------------
// Machines: take one thing in, make another
// ------------------------------------------------------------------
interface Machine {
  id: string; name: string; tier: number; input: Pile; output: Pile; inZone: THREE.Vector3; outZone: THREE.Vector3; upPad: THREE.Vector3;
  center: THREE.Vector3; from: Kind; to: Kind; secs: number; timer: number; on: boolean; anim: (dt: number, working: boolean) => void;
}
/** The upgrade pad sits beside the building, `upDx` to the east (negative: west). */
function makeMachine(id: string, name: string, tier: number, x: number, z: number, from: Kind, to: Kind, secs: number, upDx = -3.6): Machine {
  const ig = new THREE.Group(); ig.position.set(x + 1.8, 0.1, z + 2.3); scene.add(ig);
  const og = new THREE.Group(); og.position.set(x - 1.8, 0.1, z + 2.3); scene.add(og);
  const m: Machine = {
    id, name, tier, input: new Pile(ig, 2, 2).withLabel(1.9, STORE_CAPS[0]), output: new Pile(og, 2, 2).withLabel(1.9, STORE_CAPS[0]), center: V(x, 2, z),
    inZone: V(x + 1.8, 0, z + 2.3), outZone: V(x - 1.8, 0, z + 2.3), upPad: V(x + upDx, 0, z + 0.6),
    from, to, secs, timer: 0, on: false, anim: () => {},
  };
  m.input.label!.sprite.visible = false;
  m.output.label!.sprite.visible = false;
  return m;
}
const mill = makeMachine("mill", "Windmill", 1, -4, -4.6, "wheat", "flour", 1.0);
const bakeryM = makeMachine("bakery", "Bakery", 2, -4, -11.6, "flour", "bread", 1.3);
const coopM = makeMachine("coop", "Hen coop", 3, 15, -5, "wheat", "egg", 1.6);
const shedM = makeMachine("cowshed", "Cow shed", 4, 22, -5, "wheat", "milk", 2.2);
const creamM = makeMachine("creamery", "Creamery", 6, 22, -12, "milk", "cheese", 2.0, 3.6);
const machines = [mill, bakeryM, coopM, shedM, creamM];

function enableMachine(m: Machine) {
  m.on = true;
  m.input.label!.sprite.visible = true;
  m.output.label!.sprite.visible = true;
  new Decal(1.9, 1.9, m.inZone.x, m.inZone.z).zone(m.from.toUpperCase(), "#8bc34a");
  new Decal(1.9, 1.9, m.outZone.x, m.outZone.z).zone(m.to.toUpperCase(), "#4fc3f7");
  addUpPad(m.id, m.name, m.upPad);
}
const machineSecs = (m: Machine) => m.secs * SPEED_MULT[L(m.id + ".speed")] * (built.has("dam") ? 0.5 : 1);

/** Apply storage upgrade levels to every store. */
function applyCaps() {
  for (const m of machines) {
    m.input.cap = STORE_CAPS[L(m.id + ".in")];
    m.output.cap = STORE_CAPS[L(m.id + ".out")];
  }
  for (const c of counters) c.shelf.cap = SHELF_CAPS[L(c.id + ".shelf")];
}

// ------------------------------------------------------------------
// Vehicles and helpers both carry things around
// ------------------------------------------------------------------
interface Carrier { load: Pile; timer: number }
interface Vehicle extends Carrier { obj: THREE.Group; cap: number; speed: number; state: string; home: THREE.Vector3; think: (v: Vehicle, dt: number) => void }
const vehicles: Vehicle[] = [];
function moveTo(obj: THREE.Object3D, target: THREE.Vector3, speed: number, dt: number): boolean {
  const d = V(target.x - obj.position.x, 0, target.z - obj.position.z);
  const dist = d.length();
  if (dist < 0.15) return true;
  const step = Math.min(dist, speed * dt);
  d.normalize();
  obj.position.x += d.x * step;
  obj.position.z += d.z * step;
  const want = Math.atan2(d.x, d.z);
  let diff = want - obj.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  obj.rotation.y += diff * Math.min(1, dt * 10);
  return dist - step < 0.15;
}
function harvestInto(t: Tile, load: Pile) {
  t.growth = -1;
  load.add("wheat", t.pos.clone().setY(0.6));
  decor.burst(t.pos.clone().setY(0.5), 0xf0c94a, 4);
  sfx.pop();
}
function plantTile(t: Tile) {
  t.growth = 0;
  decor.burst(t.pos.clone().setY(0.3), 0x8d6e4a, 4);
}
/** Unload one item at a time. Waits (returns false) while the target is full. */
function unloadTick(v: Carrier, dt: number, target: Pile): boolean {
  if (v.load.count === 0) return true;
  if (!v.load.items.some((i) => target.fits(i.kind))) return false;
  v.timer -= dt;
  if (v.timer > 0) return false;
  v.timer = 0.07;
  const it = v.load.take((k) => target.fits(k));
  if (it) target.add(it.kind, it.at);
  return v.load.count === 0;
}
const vSpeed = (v: Vehicle) => v.speed * (built.has("dam") ? 1.3 : 1);
function nearestTile(from: THREE.Vector3, pred: (t: Tile) => boolean): Tile | null {
  let best: Tile | null = null, bd = Infinity;
  for (const t of tiles) {
    if (!pred(t)) continue;
    const d = t.pos.distanceToSquared(from);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
let seedSpend = 0;
/** Tractor: plants bare soil in every field, paying for each seed bag. */
function tractorWorker(v: Vehicle, dt: number) {
  const target = coins >= SEED_COST ? nearestTile(v.obj.position, (t) => t.growth < 0) : null;
  if (!target) { moveTo(v.obj, v.home, vSpeed(v), dt); return; }
  if (moveTo(v.obj, target.pos, vSpeed(v), dt)) {
    coins -= SEED_COST;
    seedSpend += SEED_COST;
    plantTile(target);
  }
  for (const t of tiles) {
    if (t.growth < 0 && coins >= SEED_COST && t.pos.distanceTo(v.obj.position) < 0.7) {
      coins -= SEED_COST;
      seedSpend += SEED_COST;
      plantTile(t);
    }
  }
}
/** Harvester: cuts ripe wheat, takes it to the windmill (or the stall), waits if storage is full. */
function harvesterWorker(v: Vehicle, dt: number) {
  const dest = mill.on ? { pos: mill.inZone, pile: mill.input } : { pos: stallC.sellZone, pile: stallC.shelf };
  if (v.state === "gather") {
    const best = v.load.count < v.cap ? nearestTile(v.obj.position, (t) => t.growth >= 1) : null;
    if (!best) { v.state = v.load.count > 0 ? "deliver" : "home"; return; }
    if (moveTo(v.obj, best.pos, vSpeed(v), dt)) harvestInto(best, v.load);
    for (const t of tiles) if (t.growth >= 1 && v.load.count < v.cap && t.pos.distanceTo(v.obj.position) < 0.8) harvestInto(t, v.load);
  } else if (v.state === "deliver") {
    if (moveTo(v.obj, dest.pos, vSpeed(v), dt) && unloadTick(v, dt, dest.pile)) v.state = "home";
  } else {
    // Only go out when there's ripe wheat and somewhere to put it.
    const ripe = tiles.filter((t) => t.growth >= 1).length;
    if (v.load.count > 0) v.state = "deliver";
    else if (ripe >= 4 && dest.pile.spaceFor("wheat") >= 4) v.state = "gather";
    else moveTo(v.obj, v.home, vSpeed(v), dt);
  }
}
function vanWorker(v: Vehicle, dt: number) {
  if (v.state === "fetch") {
    if (moveTo(v.obj, bakeryM.outZone, vSpeed(v), dt)) {
      v.timer -= dt;
      if (v.timer <= 0) {
        v.timer = 0.07;
        const it = v.load.count < v.cap ? bakeryM.output.take() : null;
        if (it) v.load.add(it.kind, it.at);
        if (v.load.count >= v.cap || (!it && v.load.count > 0)) v.state = "deliver";
        else if (!it) v.state = "home";
      }
    }
  } else if (v.state === "deliver") {
    if (moveTo(v.obj, stallC.sellZone.clone().add(V(1.4, 0, -0.6)), vSpeed(v), dt) && unloadTick(v, dt, stallC.shelf)) v.state = "home";
  } else {
    if (bakeryM.output.count >= 4 && stallC.shelf.spaceFor("bread") >= 4) v.state = "fetch";
    else moveTo(v.obj, v.home, vSpeed(v), dt);
  }
}
function addVehicle(obj: THREE.Group, home: THREE.Vector3, cap: number, speed: number, think: Vehicle["think"]) {
  obj.position.copy(home);
  scene.add(obj);
  popIn(obj, 0);
  const lg = obj.getObjectByName("load")!;
  vehicles.push({ obj, load: new Pile(lg, 2, 2, 0.5, 0.45, 0.26), cap, speed, state: "home", home: home.clone(), timer: 0, think });
}
function garage(x: number, z: number) {
  const g = new THREE.Group();
  const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  g.add(M.mesh(B(2.4, 0.06, 2.8), 0x8c8c8c, 0, 0.03, 0, false));
  for (const [px, pz] of [[-1.1, -1.3], [1.1, -1.3], [-1.1, 1.3], [1.1, 1.3]]) g.add(M.mesh(B(0.15, 2.4, 0.15), M.COLORS.woodDark, px, 1.2, pz));
  g.add(M.mesh(B(2.7, 0.15, 3.1), M.COLORS.roofRed, 0, 2.45, 0));
  g.position.set(x, 0, z);
  scene.add(g);
  popIn(g, 0);
}

function walkAnim(obj: THREE.Object3D, moving: boolean) {
  const k = moving ? Math.sin(clock * 12 + obj.id) : 0;
  obj.children[0].rotation.x = k * 0.5;
  obj.children[1].rotation.x = -k * 0.5;
  const arms = obj.children.filter((ch) => ch.name === "arm");
  if (arms.length === 2) {
    arms[0].rotation.x = -k * 0.6;
    arms[1].rotation.x = k * 0.6;
  }
  obj.position.y = moving ? Math.abs(k) * 0.06 : 0;
}

/** Hired farmhands. Each one runs a single route; you pay to make them faster and stronger. */
interface End { pos: THREE.Vector3; pile: Pile }
interface HelperDef {
  id: string; name: string; owner: string; tier: number; shirt: number; home: THREE.Vector3; desc: string; kind: Kind;
  src: () => End | "field"; dst: () => End;
}
const shelfEnd = (c: Counter): End => ({ pos: c.sellZone, pile: c.shelf });
const outEnd = (m: Machine): End => ({ pos: m.outZone, pile: m.output });
const inEnd = (m: Machine): End => ({ pos: m.inZone, pile: m.input });
const HELPERS: HelperDef[] = [
  { id: "h.wheat", kind: "wheat", name: "Wheat seller", owner: "stall", tier: 1, shirt: 0x7cb342, home: V(-2.6, 0, 1.2), desc: "Cuts ripe wheat and stocks it on the market stall", src: () => "field", dst: () => shelfEnd(stallC) },
  { id: "h.flourS", kind: "flour", name: "Flour seller", owner: "stall", tier: 2, shirt: 0x90a4ae, home: V(-2.6, 0, -0.4), desc: "Carries flour from the windmill to the market stall", src: () => outEnd(mill), dst: () => shelfEnd(stallC) },
  { id: "h.flour", kind: "flour", name: "Flour helper", owner: "bakery", tier: 2, shirt: 0x1e88e5, home: V(-1.8, 0, -7.6), desc: "Carries flour from the windmill to the bakery", src: () => outEnd(mill), dst: () => inEnd(bakeryM) },
  { id: "h.bread", kind: "bread", name: "Bread helper", owner: "bakery", tier: 2, shirt: 0xef6c00, home: V(-1.8, 0, -12.8), desc: "Carries bread from the bakery to the market stall", src: () => outEnd(bakeryM), dst: () => shelfEnd(stallC) },
  { id: "h.hen", kind: "wheat", name: "Hen feeder", owner: "coop", tier: 3, shirt: 0x8e24aa, home: V(18.4, 0, -8.0), desc: "Cuts ripe wheat and feeds it to the hens", src: () => "field", dst: () => inEnd(coopM) },
  { id: "h.egg", kind: "egg", name: "Egg helper", owner: "coop", tier: 3, shirt: 0xfdd835, home: V(12.6, 0, 0.8), desc: "Carries eggs from the coop to the egg stand", src: () => outEnd(coopM), dst: () => shelfEnd(eggC) },
  { id: "h.cow", kind: "wheat", name: "Cow feeder", owner: "cowshed", tier: 4, shirt: 0x6d4c41, home: V(25.8, 0, -1.2), desc: "Cuts ripe wheat and feeds it to the cows", src: () => "field", dst: () => inEnd(shedM) },
  { id: "h.milk", kind: "milk", name: "Milk helper", owner: "cowshed", tier: 4, shirt: 0x039be5, home: V(19.4, 0, -1.2), desc: "Carries milk to the creamery (or the dairy stand)", src: () => outEnd(shedM), dst: () => (creamM.on ? inEnd(creamM) : shelfEnd(dairyC)) },
  { id: "h.milkS", kind: "milk", name: "Milk seller", owner: "dairy", tier: 4, shirt: 0x4fc3f7, home: V(20.6, 0, 1.6), desc: "Carries milk from the cow shed to the dairy stand", src: () => outEnd(shedM), dst: () => shelfEnd(dairyC) },
  { id: "h.cheese", kind: "cheese", name: "Cheese helper", owner: "creamery", tier: 6, shirt: 0xffa000, home: V(19.4, 0, -10.4), desc: "Carries cheese from the creamery to the dairy stand", src: () => outEnd(creamM), dst: () => shelfEnd(dairyC) },
];
interface Helper extends Carrier { def: HelperDef; obj: THREE.Group; state: "home" | "fetch" | "deliver" }
const helpers: Helper[] = [];
function spawnHelper(def: HelperDef, animate: boolean) {
  if (helpers.some((h) => h.def === def)) return;
  const obj = M.person(def.shirt);
  // straw hat so helpers stand out from shoppers
  obj.add(M.mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10), 0xe8c66a, 0, 1.55, 0, false));
  obj.add(M.mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.2, 8), 0xe8c66a, 0, 1.66, 0, false));
  const back = new THREE.Group();
  back.position.set(0, 0.95, -0.34);
  obj.add(back);
  obj.position.copy(def.home);
  scene.add(obj);
  if (animate) popIn(obj, 0);
  helpers.push({ def, obj, load: new Pile(back, 1, 1, 0, 0, 0.27), state: "home", timer: 0 });
}
function helperThink(h: Helper, dt: number) {
  const lv = L(h.def.id);
  const speed = HELPER_SPEED[lv] * (built.has("dam") ? 1.3 : 1), cap = HELPER_CARRY[lv];
  const src = h.def.src(), dst = h.def.dst();
  const bx = h.obj.position.x, bz = h.obj.position.z;
  if (h.state === "home") {
    const has = src === "field" ? tiles.some((t) => t.growth >= 1) : src.pile.count > 0;
    if (h.load.count > 0) h.state = "deliver";
    else if (has && dst.pile.fits(h.def.kind)) h.state = "fetch";
    else moveTo(h.obj, h.def.home, speed, dt);
  } else if (h.state === "fetch") {
    const want = Math.min(cap, dst.pile.spaceFor(h.def.kind));
    if (want === 0 && h.load.count === 0) h.state = "home";
    else if (h.load.count >= Math.max(1, want)) h.state = "deliver";
    else if (src === "field") {
      const t = nearestTile(h.obj.position, (tt) => tt.growth >= 1);
      if (!t) h.state = h.load.count ? "deliver" : "home";
      else if (moveTo(h.obj, t.pos, speed, dt)) harvestInto(t, h.load);
    } else if (moveTo(h.obj, src.pos, speed, dt)) {
      h.timer -= dt;
      if (h.timer <= 0) {
        h.timer = 0.2;
        const it = src.pile.take();
        if (it) h.load.add(it.kind, it.at);
        else h.state = h.load.count ? "deliver" : "home";
      }
    }
  } else if (moveTo(h.obj, dst.pos, speed, dt) && unloadTick(h, dt, dst.pile)) h.state = "home";
  walkAnim(h.obj, Math.abs(bx - h.obj.position.x) + Math.abs(bz - h.obj.position.z) > 1e-4);
}

// ------------------------------------------------------------------
// Build pads: stand on them to spend coins
// ------------------------------------------------------------------
interface PadDef { id: string; name: string; cost: number; x: number; z: number; msg?: string; build: (animate: boolean) => void }
const PADS: PadDef[] = [
  { id: "field2", name: "New field", cost: 30, x: 4, z: -9.6, build: (a) => makeField(2, 4, -9.6, a, -1) },
  {
    id: "windmill", name: "Windmill", cost: 80, x: -4, z: -4.6, build: (a) => {
      const w = M.windmill();
      w.root.position.set(-4, 0, -4.6);
      scene.add(w.root);
      if (a) popIn(w.root, 0);
      solid(-4, -4.6, 2.8, 2.8);
      enableMachine(mill);
      mill.anim = (dt, working) => { w.blades.rotation.z -= dt * (working ? 4 : 0.6); };
    },
  },
  { id: "basket", name: "Big basket", cost: 120, x: 1.6, z: 4.6, build: () => { capacity = Math.max(capacity, 20); bag.cap = capacity; } },
  {
    id: "well", name: "Water well", cost: 160, x: 0.4, z: -5.8, build: (a) => {
      const w = M.well();
      w.root.position.set(0.4, 0, -5.8);
      scene.add(w.root);
      if (a) popIn(w.root, 0);
      solid(0.4, -5.8, 1.8, 1.8);
      spinners.push(() => { w.bucket.position.y = 1.4 + Math.sin(clock * 2) * 0.25; });
    },
  },
  {
    id: "bakery", name: "Bakery", cost: 400, x: -4, z: -11.6, build: (a) => {
      const b = M.bakery();
      b.root.position.set(-4, 0, -11.6);
      scene.add(b.root);
      if (a) popIn(b.root, 0);
      solid(-4, -11.6, 3.2, 2.6);
      enableMachine(bakeryM);
      bakeryM.anim = (_dt, working) => {
        b.smoke.children.forEach((p, i) => {
          p.position.y = ((clock * 0.6 + i * 0.33) % 1) * 1.4;
          p.scale.setScalar(working ? 0.6 + p.position.y * 0.5 : 0.001);
        });
      };
    },
  },
  {
    id: "coop", name: "Hen coop", cost: 600, x: 15, z: -5, msg: "Hens turn wheat into eggs. Sell them at the egg stand!", build: (a) => {
      const c = M.coop();
      c.root.position.set(15, 0, -5);
      scene.add(c.root);
      if (a) popIn(c.root, 0);
      solid(15, -5, 2.8, 2.6);
      enableMachine(coopM);
      coopM.anim = (_dt, working) => { c.hen.position.y = 0.95 + (working ? Math.abs(Math.sin(clock * 9)) * 0.14 : 0); };
      for (let i = 0; i < 5; i++) decor.addCritter(M.chicken(), [12.6, 17.4, -8.6, -6.9], 1.4);
      eggC.build(a);
    },
  },
  {
    id: "tractor", name: "Tractor (plants)", cost: 700, x: 8.6, z: -2, build: () => {
      garage(8.6, -2);
      addVehicle(M.tractor(), V(8.6, 0, -2), 8, 3.2, tractorWorker);
    },
  },
  { id: "basket2", name: "Huge basket", cost: 900, x: 1.6, z: 4.6, build: () => { capacity = Math.max(capacity, 35); bag.cap = capacity; } },
  { id: "field3", name: "Feed field", cost: 1000, x: 15, z: -12, build: (a) => makeField(3, 15, -12, a, -1) },
  {
    id: "cowshed", name: "Cow shed", cost: 1300, x: 22, z: -5, msg: "Cows turn wheat into milk. Sell it at the dairy stand!", build: (a) => {
      const s = M.cowshed();
      s.root.position.set(22, 0, -5);
      scene.add(s.root);
      if (a) popIn(s.root, 0);
      solid(22, -5, 2.8, 2.6);
      enableMachine(shedM);
      const head = s.cow.getObjectByName("head")!;
      shedM.anim = (_dt, working) => { head.rotation.x = working ? Math.max(0, Math.sin(clock * 5)) * 0.5 : 0; };
      dairyC.build(a);
    },
  },
  {
    id: "harvester", name: "Harvester", cost: 1500, x: 8.6, z: -9.6, build: () => {
      garage(8.6, -9.6);
      addVehicle(M.harvester(), V(8.6, 0, -9.6), 12, 3.0, harvesterWorker);
    },
  },
  {
    id: "creamery", name: "Creamery", cost: 2200, x: 22, z: -12, msg: "Milk becomes cheese. Cheese sells for $20!", build: (a) => {
      const c = M.creamery();
      c.root.position.set(22, 0, -12);
      scene.add(c.root);
      if (a) popIn(c.root, 0);
      solid(22, -12, 3.0, 2.4);
      enableMachine(creamM);
      creamM.anim = (dt, working) => { c.churn.rotation.y += dt * (working ? 6 : 0); };
    },
  },
  {
    id: "van", name: "Delivery van", cost: 2500, x: -9, z: -1, build: () => {
      garage(-9, -1);
      addVehicle(M.van(), V(-9, 0, -1), 12, 4.5, vanWorker);
    },
  },
  {
    id: "dam", name: "Hydro dam", cost: 5000, x: 0, z: -15.4, build: (a) => {
      const d = M.dam();
      d.root.position.set(0, 0, -18.6);
      scene.add(d.root);
      if (a) popIn(d.root, 0);
      solid(0, -18.6, 7.2, 1.8);
      spinners.push((dt) => d.turbines.forEach((t) => (t.rotation.y += dt * 6)));
    },
  },
];

interface LivePad { def: PadDef; paid: number; decal: Decal; acc: number; coinTimer: number }
let livePads: LivePad[] = [];
const paidSaved: Record<string, number> = {};

function refreshPads() {
  // Show the next two things you can build, in order.
  const next = PADS.filter((p) => !built.has(p.id)).slice(0, 2);
  livePads = livePads.filter((lp) => {
    if (next.includes(lp.def)) return true;
    lp.decal.dispose();
    return false;
  });
  for (const def of next) {
    if (livePads.some((lp) => lp.def === def)) continue;
    const decal = new Decal(2.4, 2.4, def.x, def.z);
    const lp: LivePad = { def, paid: paidSaved[def.id] ?? 0, decal, acc: 0, coinTimer: 0 };
    decal.pad(def.name, def.cost - lp.paid, lp.paid / def.cost);
    popIn(decal.mesh, 0.1);
    livePads.push(lp);
  }
}

// ------------------------------------------------------------------
// HUD
// ------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const hudCoins = $("coins"), hudBag = $("bag"), hint = $("hint"), toastEl = $("toast");
const joyBase = $("joy"), joyKnob = $("knob");
let shownCoins = -1, toastTimer = 0;
function toast(msg: string, secs = 2.2) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastTimer = secs;
}

function completePad(lp: LivePad) {
  built.add(lp.def.id);
  delete paidSaved[lp.def.id];
  lp.def.build(true);
  confetti(V(lp.def.x, 1, lp.def.z));
  sfx.build();
  toast(lp.def.msg ?? `${lp.def.name} built!`, lp.def.msg ? 3.5 : 2.2);
  refreshPads();
  persist();
}

// ------------------------------------------------------------------
// Upgrade menu: opens while you stand on a purple pad. Hold a button to buy.
// ------------------------------------------------------------------
interface Row { key: string; title: string; detail: string; cost: number | null; buy: () => void }
const panel = $("panel"), panelTitle = $("ptitle"), panelRows = $("prows");
let panelOwner: string | null = null, rows: Row[] = [];
let btnHold: { row: Row; el: HTMLElement; t: number } | null = null;

function levelRow(key: string, title: string, caps: number[], costs: number[], tier: number, unit: (v: number) => string, after = applyCaps): Row {
  const l = L(key), max = l >= costs.length || l >= caps.length - 1;
  return {
    key, title,
    detail: max ? `${unit(caps[l])} (max)` : `${unit(caps[l])} → ${unit(caps[l + 1])}`,
    cost: max ? null : costs[l] * tier,
    buy: () => { lvl[key] = l + 1; after(); },
  };
}
/** A helper can be hired once the building it takes from exists. */
function helperReady(d: HelperDef) {
  if (d.id === "h.flourS") return mill.on;
  if (d.id === "h.milkS") return shedM.on;
  return true;
}
function helperRow(d: HelperDef): Row {
  const l = L(d.id), max = l >= HELPER_SPEED.length - 1;
  if (l === 0) {
    return { key: d.id, title: `Hire ${d.name}`, detail: `${d.desc}. Very slow at first.`, cost: HELPER_COST[0] * d.tier, buy: () => { lvl[d.id] = 1; spawnHelper(d, true); } };
  }
  return {
    key: d.id, title: `${d.name} · level ${l}`,
    detail: max ? `Top speed, carries ${HELPER_CARRY[l]} (max)` : `Faster, carries ${HELPER_CARRY[l]} → ${HELPER_CARRY[l + 1]}`,
    cost: max ? null : HELPER_COST[l] * d.tier,
    buy: () => { lvl[d.id] = l + 1; },
  };
}
function rowsFor(owner: string): Row[] {
  const out: Row[] = [];
  const m = machines.find((mm) => mm.id === owner);
  if (m) {
    const holds = (v: number) => `Holds ${v}`;
    out.push(levelRow(m.id + ".in", `${m.from[0].toUpperCase() + m.from.slice(1)} storage (in)`, STORE_CAPS, STORE_COST, m.tier, holds));
    out.push(levelRow(m.id + ".out", `${m.to[0].toUpperCase() + m.to.slice(1)} storage (out)`, STORE_CAPS, STORE_COST, m.tier, holds));
    out.push(levelRow(m.id + ".speed", "Work speed", SPEED_MULT, SPEED_COST, m.tier, (v) => `${(1 / v).toFixed(1)}x`));
  }
  const c = counters.find((cc) => cc.id === owner);
  if (c) {
    const n = c.kinds().length;
    out.push(levelRow(c.id + ".shelf", "Counter space", SHELF_CAPS, SHELF_COST, c.tier, (v) => (n > 1 ? `${Math.floor(v / n)} of each` : `Holds ${v}`)));
  }
  for (const d of HELPERS) if (d.owner === owner && helperReady(d)) out.push(helperRow(d));
  return out;
}
function renderPanel() {
  if (!panelOwner) return;
  rows = rowsFor(panelOwner);
  panelTitle.textContent = upPads.find((u) => u.owner === panelOwner)?.name ?? "";
  panelRows.innerHTML = "";
  rows.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "row";
    el.innerHTML = `<div class="rtext"><b></b><span></span></div><button class="buy" data-i="${i}"><i></i><em></em></button>`;
    el.querySelector("b")!.textContent = r.title;
    el.querySelector("span")!.textContent = r.detail;
    el.querySelector("em")!.textContent = r.cost === null ? "MAX" : money(r.cost);
    panelRows.appendChild(el);
  });
  updatePanelButtons();
}
function updatePanelButtons() {
  panelRows.querySelectorAll<HTMLElement>("button.buy").forEach((b) => {
    const r = rows[Number(b.dataset.i)];
    b.classList.toggle("off", r.cost === null || coins < r.cost);
    b.classList.toggle("max", r.cost === null);
  });
}
function openPanel(owner: string) {
  panelOwner = owner;
  renderPanel();
  panel.classList.add("show");
  sfx.tick();
}
function closePanel() {
  panelOwner = null;
  btnHold = null;
  panel.classList.remove("show");
}
panel.addEventListener("pointerdown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button.buy");
  if (!b) return;
  const r = rows[Number(b.dataset.i)];
  if (!r || r.cost === null) return;
  if (coins < r.cost) { toast(`Need ${money(r.cost - coins)} more`); return; }
  btnHold = { row: r, el: b, t: 0 };
  b.classList.add("holding");
});
const cancelBuy = () => {
  if (!btnHold) return;
  btnHold.el.classList.remove("holding");
  btnHold.el.style.setProperty("--p", "0");
  btnHold = null;
};
function updateBuyHold(dt: number) {
  if (!btnHold) return;
  btnHold.t += dt;
  btnHold.el.style.setProperty("--p", String(Math.min(1, btnHold.t / BUY_HOLD)));
  if (btnHold.t < BUY_HOLD) return;
  const r = btnHold.row;
  cancelBuy();
  if (r.cost === null || coins < r.cost) return;
  coins -= r.cost;
  r.buy();
  sfx.build();
  const at = upPads.find((u) => u.owner === panelOwner)?.pos ?? playerPos();
  confetti(at.clone().setY(1));
  toast(r.title.startsWith("Hire ") ? `${r.title.slice(5)} hired!` : `${r.title.replace(/ · level \d+/, "")} upgraded!`);
  renderPanel();
  persist();
}

// ------------------------------------------------------------------
// Reputation: every shopper leaves a review. Fast service = 5 stars,
// a long wait scores lower, giving up scores 1. The rating is a running
// average of recent reviews, so it moves steadily, never hits 0, and can
// always be rebuilt. More stars bring shoppers more often.
// ------------------------------------------------------------------
const RATING_MIN = 1, RATING_MAX = 5;
function review(c: Counter, cu: Customer, served: boolean) {
  let score = 1;
  if (served) {
    // time from joining the line to being fully served
    const t = cu.age;
    score = t <= 10 ? 5 : t >= 45 ? 2 : 5 - ((t - 10) / 35) * 3;
  } else if (cu.got > 0) score = 1.5;
  const before = c.rating;
  c.rating = THREE.MathUtils.clamp(c.rating * 0.88 + score * 0.12, RATING_MIN, RATING_MAX);
  if (Math.floor(before * 2) !== Math.floor(c.rating * 2)) {
    toast(`${c.name}: ${c.rating.toFixed(1)} stars ${c.rating > before ? "▲" : "▼"}`);
  }
}
/** 1 star: shoppers come 3x less often than at 3 stars. 5 stars: about 1.7x more often. */
const ratingRate = (r: number) => Math.max(0.33, r / 3);
function drawStars(c: Counter) {
  const r = c.rating;
  const full = Math.round(r);
  const bg = r >= 4 ? "rgba(46,125,50,0.9)" : r >= 2.5 ? "rgba(40,28,20,0.85)" : "rgba(198,40,40,0.9)";
  c.stars.set(`${"★".repeat(full)}${"☆".repeat(5 - full)} ${r.toFixed(1)}`, "", bg);
}

// ------------------------------------------------------------------
// Customers
// ------------------------------------------------------------------
const SHIRTS = [0xe57373, 0x64b5f6, 0x81c784, 0xffb74d, 0xba68c8, 0x4db6ac, 0xf06292, 0xfff176];
const queueSlot = (c: Counter, i: number) => (i === 0 ? V(c.x + c.side * 1.5, 0, c.z) : V(c.x + c.side * 2.0, 0, c.z + i * 1.2));
const spawnX = (c: Counter) => (c.side < 0 ? -17 : 34);

/** What shoppers ask for. Processed goods are more popular once you can make them. */
function pickDemand(c: Counter): { kind: Kind; want: number } {
  const { options, maxWant } = c.demand();
  let r = Math.random() * options.reduce((a, [, w]) => a + w, 0);
  let kind: Kind = options[0][0];
  for (const [k, w] of options) {
    if ((r -= w) <= 0) { kind = k; break; }
  }
  return { kind, want: 1 + Math.floor(Math.random() * maxWant) };
}

function updateCounter(c: Counter, dt: number) {
  if (!c.on) return;
  c.spawnTimer -= dt;
  const waiting = c.customers.filter((cu) => cu.state === "walk").length;
  // A long line puts people off: no new shoppers join when it's full.
  if (c.spawnTimer <= 0 && waiting < 6) {
    c.spawnTimer = (c.every() / ratingRate(c.rating)) * (0.7 + Math.random() * 0.6);
    const obj = M.person(SHIRTS[Math.floor(Math.random() * SHIRTS.length)]);
    obj.position.set(spawnX(c), 0, ROAD_Z);
    scene.add(obj);
    const bubble = new Bubble();
    bubble.sprite.position.set(0, 2.6, 0);
    obj.add(bubble.sprite);
    const hg = new THREE.Group();
    hg.position.set(0, 0.9, 0.38);
    obj.add(hg);
    const d = pickDemand(c);
    const maxPatience = 26 + d.want * 4;
    c.customers.push({ obj, state: "walk", kind: d.kind, want: d.want, got: 0, paid: 0, road: true, age: 0, timer: 0, patience: maxPatience, maxPatience, waited: 0, angry: false, bubble, hands: new Pile(hg, 1, 1, 0, 0, 0.22) });
  }
  let queueIdx = 0;
  for (const cu of [...c.customers]) {
    if (cu.state === "leave") {
      cu.bubble.sprite.visible = cu.angry;
      // back to the road, then off along it
      if (cu.road) {
        if (moveTo(cu.obj, V(spawnX(c), 0, ROAD_Z), 3.2, dt)) {
          scene.remove(cu.obj);
          c.customers.splice(c.customers.indexOf(cu), 1);
        }
      } else if (moveTo(cu.obj, V(cu.obj.position.x, 0, ROAD_Z), 3.2, dt)) cu.road = true;
      walkAnim(cu.obj, true);
      continue;
    }
    cu.age += dt;
    const slot = queueSlot(c, queueIdx);
    let arrived = false;
    if (cu.road) {
      if (moveTo(cu.obj, V(slot.x, 0, ROAD_Z), 3.4, dt)) cu.road = false;
    } else arrived = moveTo(cu.obj, slot, 3.4, dt);
    walkAnim(cu.obj, !arrived);
    cu.bubble.set(cu.kind, cu.got, cu.want, cu.patience / cu.maxPatience, false);
    if (arrived) {
      let diff = (-c.side * Math.PI) / 2 - cu.obj.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      cu.obj.rotation.y += diff * Math.min(1, dt * 8);
      cu.patience -= dt;
      if (queueIdx === 0) {
        cu.timer -= dt;
        if (cu.timer <= 0) {
          // Shoppers only buy what they came for.
          const it = c.shelf.take((k) => k === cu.kind);
          if (it) {
            cu.timer = 0.3;
            cu.hands.add(it.kind, it.at);
            cu.got++;
            cu.paid += PRICE[it.kind];
            cu.patience = Math.min(cu.maxPatience, cu.patience + 4);
            sfx.tick();
          } else cu.waited += dt;
          if (cu.got >= cu.want) {
            c.cash.add(cu.paid, cu.obj.position.clone().setY(1.2));
            decor.floatText(money(cu.paid), cu.obj.position.clone().setY(2.6));
            sfx.coin();
            cu.state = "leave";
            review(c, cu, true);
          }
        }
      }
      if (cu.patience <= 0 && cu.state === "walk") {
        cu.state = "leave";
        cu.angry = true;
        cu.bubble.set(cu.kind, cu.got, cu.want, 0, true);
        if (cu.paid > 0) c.cash.add(cu.paid, cu.obj.position.clone().setY(1.2));
        c.lost++;
        review(c, cu, false);
        if (c.lost % 2 === 1) toast(`A customer gave up waiting for ${cu.kind}. Your rating drops!`);
      }
    }
    queueIdx++;
  }
}

// Bouncing arrow that points at what to do next.
const arrow = new THREE.Group();
const arrowMesh = M.mesh(new THREE.ConeGeometry(0.45, 0.9, 4), 0xffeb3b, 0, 0, 0, false);
arrowMesh.rotation.x = Math.PI;
arrow.add(arrowMesh);
scene.add(arrow);

// Ring on the ground that fills while you wait in a zone.
const ringGroup = new THREE.Group();
const ringMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
const ringBg = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.02, 40), ringMat(0x000000, 0.3));
const ringFg = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.02, 40, 1, 0, 0.01), ringMat(0xffffff, 0.95));
for (const r of [ringBg, ringFg]) { r.rotation.x = -Math.PI / 2; r.renderOrder = 3; ringGroup.add(r); }
ringGroup.position.y = 0.07;
ringGroup.visible = false;
scene.add(ringGroup);
let ringStep = -1;
let ringWant: { pos: THREE.Vector3; r: number; p: number } | null = null;
function updateRing() {
  if (!ringWant) { ringGroup.visible = false; return; }
  ringGroup.visible = true;
  ringGroup.position.set(ringWant.pos.x, 0.07, ringWant.pos.z);
  ringGroup.scale.setScalar(ringWant.r);
  const step = Math.round(ringWant.p * 40);
  if (step !== ringStep) {
    ringStep = step;
    ringFg.geometry.dispose();
    ringFg.geometry = new THREE.RingGeometry(0.82, 1.02, 40, 1, Math.PI / 2, -Math.max(0.01, (step / 40) * Math.PI * 2));
  }
}

// ------------------------------------------------------------------
// Input: drag anywhere for a joystick, or WASD / arrows
// ------------------------------------------------------------------
const move = V();
let joyId: number | null = null;
const joyOrigin = { x: 0, y: 0 };
const keys = new Set<string>();
window.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  if ((e.target as HTMLElement).closest?.("#panel")) return; // taps on the menu don't move the farmer
  if (joyId !== null) return;
  joyId = e.pointerId;
  joyOrigin.x = e.clientX;
  joyOrigin.y = e.clientY;
  joyBase.style.left = `${e.clientX}px`;
  joyBase.style.top = `${e.clientY}px`;
  joyKnob.style.transform = "translate(-50%, -50%)";
  joyBase.classList.add("on");
});
window.addEventListener("pointermove", (e) => {
  if (e.pointerId !== joyId) return;
  const dx = e.clientX - joyOrigin.x, dy = e.clientY - joyOrigin.y;
  const len = Math.hypot(dx, dy), max = 55;
  const k = len > max ? max / len : 1;
  joyKnob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
  if (len < 6) move.set(0, 0, 0);
  else move.set(dx, 0, dy).normalize().multiplyScalar(Math.min(1, len / max));
});
const endJoy = (e: PointerEvent) => {
  cancelBuy();
  if (e.pointerId !== joyId) return;
  joyId = null;
  move.set(0, 0, 0);
  joyBase.classList.remove("on");
};
window.addEventListener("pointerup", endJoy);
window.addEventListener("pointercancel", endJoy);
window.addEventListener("keydown", (e) => { keys.add(e.key.toLowerCase()); sfx.unlock(); });
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
function keyMove() {
  const v = V((keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0), 0,
    (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0));
  return v.lengthSq() ? v.normalize() : null;
}

// ------------------------------------------------------------------
// Player logic
// ------------------------------------------------------------------
let playerMoving = false;
let walkPhase = 0, dropTimer = 0, payTick = 0, fullWarn = 0;
const playerPos = () => farmer.root.position;
const near = (p: THREE.Vector3, r: number) => Math.hypot(p.x - playerPos().x, p.z - playerPos().z) < r;

// How long the farmer has stood in each zone. Nothing happens until HOLD has passed,
// so walking past a zone never grabs or spends anything by accident.
const dwell = new Map<string, number>();
const seenZones = new Set<string>();
function ready(key: string, pos: THREE.Vector3, r: number, dt: number, wants: boolean, hold = HOLD): boolean {
  seenZones.add(key);
  if (!near(pos, r)) { dwell.delete(key); return false; }
  const t = (dwell.get(key) ?? 0) + dt;
  dwell.set(key, t);
  if (!wants) return false;
  if (t < hold) {
    if (!ringWant) ringWant = { pos, r, p: t / hold };
    return false;
  }
  return true;
}
function warn(msg: string) {
  if (fullWarn <= 0) { toast(msg); fullWarn = 4; }
}

function updatePlayer(dt: number) {
  const dir = keyMove() ?? move;
  const pos = farmer.root.position;
  if (dir.lengthSq() > 0.001) {
    pos.addScaledVector(dir, 6.2 * dt);
    const want = Math.atan2(dir.x, dir.z);
    let diff = want - farmer.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    farmer.root.rotation.y += diff * Math.min(1, dt * 14);
    walkPhase += dt * 13 * dir.length();
  } else walkPhase = 0;
  const k = Math.sin(walkPhase);
  farmer.legL.rotation.x = k * 0.6;
  farmer.legR.rotation.x = -k * 0.6;
  farmer.body.position.y = Math.abs(k) * 0.08;
  farmer.back.rotation.x = -k * 0.03;
  farmer.arms[0].rotation.x = -k * 0.7;
  farmer.arms[1].rotation.x = k * 0.7;
  playerMoving = dir.lengthSq() > 0.001;

  // bounds and building collisions
  pos.x = THREE.MathUtils.clamp(pos.x, -11.5, 27);
  pos.z = THREE.MathUtils.clamp(pos.z, -16.5, 11);
  const r = 0.4;
  for (const b of colliders) {
    if (pos.x > b.x0 - r && pos.x < b.x1 + r && pos.z > b.z0 - r && pos.z < b.z1 + r) {
      const dl = pos.x - (b.x0 - r), dr = b.x1 + r - pos.x, dn = pos.z - (b.z0 - r), ds = b.z1 + r - pos.z;
      const m = Math.min(dl, dr, dn, ds);
      if (m === dl) pos.x = b.x0 - r; else if (m === dr) pos.x = b.x1 + r; else if (m === dn) pos.z = b.z0 - r; else pos.z = b.z1 + r;
    }
  }

  // harvest by walking through ripe wheat
  fullWarn -= dt;
  for (const t of tiles) {
    if (!near(t.pos, 0.95)) continue;
    if (t.growth < 0) {
      // plant from a seed bag you're carrying
      if (bag.take((kk) => kk === "seed")) { plantTile(t); sfx.tick(); }
      continue;
    }
    if (t.growth < 1) continue;
    if (bag.full) {
      warn("Basket full! Take it to the stall");
      break;
    }
    t.growth = -1;
    bag.add("wheat", t.pos.clone().setY(0.7));
    decor.burst(t.pos.clone().setY(0.5), 0xf0c94a, 5);
    sfx.pop();
  }

  // Zones: stand still for a moment, then items move one at a time.
  ringWant = null;
  seenZones.clear();
  dropTimer -= dt;
  const tick = dropTimer <= 0;
  let did = false;
  for (const c of counters) {
    if (!c.on) continue;
    const has = bag.items.some((i) => c.accepts.includes(i.kind));
    const fits = bag.items.some((i) => c.accepts.includes(i.kind) && c.shelf.fits(i.kind));
    if (ready("sell:" + c.id, c.sellZone, 1.2, dt, fits)) {
      if (tick) {
        const it = bag.take((kk) => c.accepts.includes(kk) && c.shelf.fits(kk));
        if (it) { c.shelf.add(it.kind, it.at); did = true; }
      }
    } else if (has && !fits && near(c.sellZone, 1.2)) warn(`No room for that on the ${c.name.toLowerCase()}. Upgrade it on the purple pad`);
    if (near(c.cashZone, 1.25) && c.cash.value > 0) {
      const v = c.cash.collect(() => playerPos().clone().setY(1.4));
      decor.floatText("+" + money(v), playerPos().clone().setY(2.8), "#ffe066");
      coins += v;
      lifetime += v;
      P.sendScore(lifetime);
      sfx.coin();
    }
  }
  // Seeds cost money, but you're never stuck: they're free if you're broke.
  const free = coins < SEED_COST && tiles.every((t) => t.growth < 0) && bag.countOf("wheat") === 0;
  if (ready("seeds", seedZone.pos, seedZone.r, dt, !bag.full && (coins >= SEED_COST || free)) && tick) {
    if (!free) { coins -= SEED_COST; seedSpend += SEED_COST; }
    bag.add("seed", crate.position.clone().setY(1));
    did = true;
  }
  for (const m of machines) {
    if (!m.on) continue;
    if (ready("in:" + m.id, m.inZone, 1.1, dt, bag.countOf(m.from) > 0 && !m.input.full) && tick) {
      const it = bag.take((kk) => kk === m.from);
      if (it) { m.input.add(it.kind, it.at); did = true; }
    }
    if (ready("out:" + m.id, m.outZone, 1.1, dt, m.output.count > 0 && !bag.full) && tick) {
      const it = m.output.take();
      if (it) { bag.add(it.kind, it.at); did = true; }
    }
  }
  if (did) { dropTimer = 0.06; sfx.tick(); }

  // pay into build pads (after a short wait, so you never pay by accident)
  for (const lp of livePads) {
    const p = V(lp.def.x, 0, lp.def.z);
    if (!ready("pad:" + lp.def.id, p, 1.25, dt, coins > 0)) { lp.acc = 0; continue; }
    lp.acc += Math.max(25, lp.def.cost / 1.6) * dt;
    const amt = Math.min(Math.floor(lp.acc), coins, lp.def.cost - lp.paid);
    if (amt > 0) {
      lp.acc -= amt;
      coins -= amt;
      lp.paid += amt;
      paidSaved[lp.def.id] = lp.paid;
      lp.decal.pad(lp.def.name, lp.def.cost - lp.paid, lp.paid / lp.def.cost);
    }
    lp.coinTimer -= dt;
    if (lp.coinTimer <= 0) {
      lp.coinTimer = 0.05;
      fly(M.cashMesh(), playerPos().clone().setY(1.3), () => p, undefined, 0.22, 0.8);
      if (++payTick % 2 === 0) sfx.tick();
    }
    if (lp.paid >= lp.def.cost) completePad(lp);
    break;
  }

  // upgrade pads open their menu
  let onUp: string | null = null;
  for (const u of upPads) if (ready("up:" + u.owner, u.pos, 0.9, dt, true, PANEL_HOLD)) onUp = u.owner;
  if (onUp && onUp !== panelOwner) openPanel(onUp);
  else if (!onUp && panelOwner && !upPads.some((u) => u.owner === panelOwner && near(u.pos, 1.3))) closePanel();

  for (const key of [...dwell.keys()]) if (!seenZones.has(key)) dwell.delete(key);
}

// ------------------------------------------------------------------
// Machines, fields, guidance
// ------------------------------------------------------------------
function updateMachines(dt: number) {
  for (const m of machines) {
    if (!m.on) continue;
    const working = m.input.count > 0 && !m.output.full;
    m.anim(dt, working);
    if (!working) { m.timer = 0; continue; }
    m.timer += dt;
    if (m.timer >= machineSecs(m)) {
      m.timer = 0;
      if (m.input.take()) m.output.add(m.to, m.center);
    }
  }
}

function updateFields(dt: number) {
  const rt = regrowTime();
  for (const t of tiles) {
    t.plant.visible = t.growth >= 0;
    if (t.growth < 0) continue;
    if (t.growth < 1) t.growth = Math.min(1, t.growth + dt / rt);
    const s = 0.15 + 0.85 * t.growth;
    t.plant.scale.set(s, s, s);
    t.plant.rotation.z = t.growth >= 1 ? Math.sin(clock * 2 + t.pos.x) * 0.05 : 0;
  }
}

const anyUpgrade = () => Object.values(lvl).some((v) => v > 0);
function updateGuide() {
  let target: THREE.Vector3 | null = null;
  let msg = "";
  const nextPad = livePads[0];
  const front = counters.map((c) => ({ c, cu: c.customers.find((cu) => cu.state === "walk" && !cu.road) })).find((x) => x.cu && x.cu.waited > 2.5 && x.c.shelf.countOf(x.cu.kind) === 0);
  const fullStore = machines.find((m) => m.on && (m.output.full || m.input.full)) ?? null;
  if (lifetime === 0 && stallC.cash.value === 0) {
    if (bag.count === 0 && stallC.shelf.count === 0) { msg = "Walk into the wheat to harvest it"; target = V(4, 0, -1.8); }
    else if (bag.count > 0) { msg = "Carry it to the market stall and wait a second"; target = stallC.sellZone; }
    else msg = "Customers are buying...";
  } else if (stallC.cash.value > 0 && lifetime < 20) {
    msg = "Collect your cash"; target = stallC.cashZone;
  } else if (lifetime < 120 && !tiles.some((t) => t.growth >= 0) && bag.countOf("seed") === 0 && bag.countOf("wheat") === 0) {
    msg = "Buy seeds at the seed crate"; target = seedZone.pos;
  } else if (lifetime < 120 && bag.countOf("seed") > 0 && tiles.some((t) => t.growth < 0)) {
    msg = "Walk over bare soil to plant"; target = nearestTile(playerPos(), (t) => t.growth < 0)?.pos ?? null;
  } else if (built.size === 0 && nextPad && coins >= 10) {
    msg = "Stand on the pad to build"; target = V(nextPad.def.x, 0, nextPad.def.z);
  } else if (built.has("windmill") && built.size <= 2 && lifetime < 250 && bag.countOf("wheat") > 0) {
    msg = "Flour sells for more: drop wheat at the windmill"; target = mill.inZone;
  } else if (coopM.on && coopM.input.count + coopM.output.count + eggC.shelf.count === 0 && L("h.hen") === 0 && lifetime < 2500) {
    msg = "Hens eat wheat: bring some to the coop"; target = bag.countOf("wheat") > 0 ? coopM.inZone : null;
  } else if (!anyUpgrade() && fullStore && coins >= STORE_COST[0] * fullStore.tier) {
    msg = `${fullStore.name} is full: upgrade it on the purple pad`; target = fullStore.upPad;
  } else if (front?.cu) {
    const k = front.cu.kind;
    msg = `Your customer wants ${k}!`;
    const src = machines.find((m) => m.on && m.to === k);
    if (bag.countOf(k) > 0) target = front.c.sellZone;
    else if (src && src.output.count > 0) target = src.outZone;
  } else if (nextPad && coins + nextPad.paid >= nextPad.def.cost) {
    target = V(nextPad.def.x, 0, nextPad.def.z);
  }
  if (panelOwner) { msg = ""; target = null; }
  hint.textContent = msg;
  hint.classList.toggle("show", !!msg);
  arrow.visible = !!target;
  if (target) arrow.position.set(target.x, 1.3 + Math.abs(Math.sin(clock * 4)) * 0.6, target.z);
}

// ------------------------------------------------------------------
// Save / load
// ------------------------------------------------------------------
interface SaveData {
  v: 3; coins: number; lifetime: number; built: string[]; paid: Record<string, number>; lvl: Record<string, number>;
  bag: Kind[]; shelves: Record<string, Kind[]>; machines: Record<string, [Kind[], Kind[]]>; cash: Record<string, number>; tiles?: number[];
  rating?: Record<string, number>;
}
interface SaveV2 {
  v: 2; coins: number; lifetime: number; built: string[]; paid: Record<string, number>;
  bag: Kind[]; shelf: Kind[]; mill: [Kind[], Kind[]]; bakery: [Kind[], Kind[]]; cash: number; tiles?: number[];
}
function persist() {
  const d: SaveData = {
    v: 3, coins, lifetime, built: [...built], paid: { ...paidSaved }, lvl: { ...lvl }, bag: bag.kinds(),
    shelves: Object.fromEntries(counters.map((c) => [c.id, c.shelf.kinds()])),
    machines: Object.fromEntries(machines.map((m) => [m.id, [m.input.kinds(), m.output.kinds()]])),
    cash: Object.fromEntries(counters.map((c) => [c.id, c.cash.value])),
    rating: Object.fromEntries(counters.map((c) => [c.id, Math.round(c.rating * 100) / 100])),
    tiles: tiles.map((t) => Math.round(t.growth * 100) / 100),
  };
  P.save(GAME_ID, JSON.stringify(d));
}
function upgradeSave(o: SaveV2): SaveData {
  return {
    v: 3, coins: o.coins, lifetime: o.lifetime, built: o.built, paid: o.paid ?? {}, lvl: {}, bag: o.bag,
    shelves: { stall: o.shelf }, machines: { mill: o.mill, bakery: o.bakery }, cash: { stall: o.cash }, tiles: o.tiles,
  };
}
async function load() {
  let d: SaveData | null = null;
  try {
    const raw = await P.loadSave(GAME_ID);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.v === 3) d = parsed;
    else if (parsed && parsed.v === 2) d = upgradeSave(parsed);
  } catch { /* fresh start */ }
  makeField(1, 4, -2, false);
  if (d) {
    coins = d.coins;
    lifetime = d.lifetime;
    Object.assign(paidSaved, d.paid ?? {});
    Object.assign(lvl, d.lvl ?? {});
    for (const p of PADS) if (d.built.includes(p.id)) { built.add(p.id); p.build(false); }
    applyCaps();
    // Older saves may hold more than today's limits allow: trim to the caps.
    const fill = (src: Kind[] | undefined, pile: Pile) => (src ?? []).slice(0, pile.cap).forEach((k) => pile.add(k));
    fill(d.bag, bag);
    for (const c of counters) {
      c.rating = THREE.MathUtils.clamp(d.rating?.[c.id] ?? 3, RATING_MIN, RATING_MAX);
      if (c.on) (d.shelves[c.id] ?? []).forEach((k) => { if (c.shelf.fits(k)) c.shelf.add(k); });
    }
    for (const m of machines) if (m.on && d.machines[m.id]) { fill(d.machines[m.id][0], m.input); fill(d.machines[m.id][1], m.output); }
    d.tiles?.forEach((g, i) => { if (tiles[i]) tiles[i].growth = g; });
    for (const c of counters) if (c.on && (d.cash[c.id] ?? 0) > 0) c.cash.add(d.cash[c.id]);
    for (const h of HELPERS) {
      const owner = machines.find((m) => m.id === h.owner) ?? counters.find((c) => c.id === h.owner);
      if (L(h.id) > 0 && owner?.on) spawnHelper(h, false);
    }
  }
  applyCaps();
  // Restored things appear instantly, without the pop-in.
  pops.forEach((p) => p.obj.scale.copy(p.base));
  pops.length = 0;
  refreshPads();
}

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
let saveTimer = 0, last = performance.now(), running = true, readySent = false;

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  renderer.render(scene, camera);
  if (!readySent) {
    readySent = true;
    P.gameReady();
  }
}

function update(dt: number) {
  clock += dt;

  updatePlayer(dt);
  updateRing();
  updateBuyHold(dt);
  updateFields(dt);
  updateMachines(dt);
  for (const c of counters) updateCounter(c, dt);
  for (const v of vehicles) {
    const bx = v.obj.position.x, bz = v.obj.position.z;
    v.think(v, dt);
    const moving = Math.abs(bx - v.obj.position.x) + Math.abs(bz - v.obj.position.z) > 1e-4;
    v.obj.position.y = moving ? Math.abs(Math.sin(clock * 20)) * 0.04 : 0;
  }
  for (const h of helpers) helperThink(h, dt);
  spinners.forEach((f) => f(dt));
  decor.update(dt, clock, farmer.root.position, playerMoving);
  for (const c of counters) { c.shelf.updateLabel(); if (c.on) drawStars(c); }
  for (const m of machines) { m.input.updateLabel(); m.output.updateLabel(); }
  updateFlyers(dt);
  updatePops(dt);
  updateBits(dt);
  updateGuide();

  // camera follows the farmer
  const goal = farmer.root.position.clone().add(camOffset);
  camera.position.lerp(goal, Math.min(1, dt * 6));
  camera.lookAt(camera.position.clone().sub(camOffset).add(V(0, 0.5, 0)));
  sun.position.copy(farmer.root.position).add(V(8, 18, 6));
  sun.target.position.copy(farmer.root.position);

  if (shownCoins !== coins) {
    shownCoins = coins;
    hudCoins.textContent = fmt(coins);
    const pill = hudCoins.parentElement!;
    pill.classList.remove("bump");
    void pill.offsetWidth;
    pill.classList.add("bump");
    if (panelOwner) updatePanelButtons();
  }
  hudBag.textContent = bag.count >= capacity ? "FULL" : `${bag.count}/${capacity}`;
  hudBag.parentElement!.classList.toggle("full", bag.count >= capacity);

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.classList.remove("show");
  }

  saveTimer += dt;
  if (saveTimer > 4) { saveTimer = 0; persist(); }
}

function start() {
  last = performance.now();
  renderer.setAnimationLoop(frame);
}

P.onPause(() => {
  if (!running) return;
  running = false;
  renderer.setAnimationLoop(null);
  sfx.suspend();
  persist();
});
P.onResume(() => {
  if (running) return;
  running = true;
  sfx.resume();
  start();
});
sfx.enabled = P.isAudioEnabled();
P.onAudioChange((on) => (sfx.enabled = on));

// Test hook for automated playtests (only with ?debug in the URL).
if (location.search.includes("debug")) {
  (window as unknown as Record<string, unknown>).mg = {
    go: (x: number, z: number) => farmer.root.position.set(x, 0, z),
    /** Run the game forward without drawing (headless browsers are slow). */
    step: (secs: number) => { for (let t = 0; t < secs; t += 0.05) update(0.05); },
    give: (n: number) => { coins += n; },
    build: (id: string) => { const p = PADS.find((pp) => pp.id === id); if (p && !built.has(p.id)) { built.add(p.id); p.build(true); refreshPads(); } },
    setLvl: (k: string, v: number) => { lvl[k] = v; applyCaps(); const h = HELPERS.find((hh) => hh.id === k); if (h && v > 0) spawnHelper(h, true); },
    rate: (id: string, r: number) => { const c = counters.find((cc) => cc.id === id); if (c) c.rating = r; },
    fill: (id: string, kind: Kind, n: number) => {
      const m = machines.find((mm) => mm.id === id);
      const pile = m ? m.output : counters.find((c) => c.id === id)?.shelf;
      for (let i = 0; i < n && pile && pile.fits(kind); i++) pile.add(kind);
    },
    state: () => ({
      coins, lifetime, bag: bag.kinds().join(","), built: [...built], lvl: { ...lvl }, panel: panelOwner,
      shelves: Object.fromEntries(counters.map((c) => [c.id, `${c.shelf.count}/${c.shelf.cap} ${c.kinds().map((k) => k + ":" + c.shelf.countOf(k)).join(",")} r${c.rating.toFixed(2)}`])),
      machines: Object.fromEntries(machines.filter((m) => m.on).map((m) => [m.id, `${m.input.count}/${m.input.cap} -> ${m.output.count}/${m.output.cap}`])),
      helpers: helpers.map((h) => `${h.def.id}:${h.state}:${h.load.count}`),
      q: counters.map((c) => c.customers.map((cu) => `${cu.state}:${cu.kind}x${cu.want}`).join(" ")),
    }),
  };
}

renderer.render(scene, camera);
P.firstFrameReady();
load().then(() => {
  if (lifetime === 0) toast("Welcome to your farm!");
  start();
});
