import * as THREE from "three";
import * as P from "../../src/platform/platform";
import * as M from "./models";
import { Sfx } from "./sfx";
import { setupDecor } from "./decor";

type Kind = M.ItemKind;
const GAME_ID = "market-garden";
const PRICE: Record<Kind, number> = { seed: 0, wheat: 3, flour: 6, bread: 13 };
const SEED_COST = 1;
// Every store has a limit. Nothing piles up forever.
const CAP = { shelf: 12, machineIn: 10, machineOut: 10 };
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
  constructor(public group: THREE.Object3D, public cols = 2, public rows = 2, public sx = 0.7, public sz = 0.55, public layerH = 0.27) {}
  get full() { return this.items.length >= this.cap; }
  get space() { return Math.max(0, this.cap - this.items.length); }
  /** Show a small "n/cap" sign above this store. */
  withLabel(y: number, cap: number) {
    this.cap = cap;
    this.label = new M.Label(150, 64, 1.0);
    this.label.sprite.position.set(0, y, 0);
    this.group.add(this.label.sprite);
    return this;
  }
  updateLabel() {
    this.label?.set(this.full ? "FULL" : `${this.count}/${this.cap}`, "", this.full ? "rgba(198,40,40,0.9)" : "rgba(40,28,20,0.8)");
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
// Buildings
// ------------------------------------------------------------------
interface Box { x0: number; x1: number; z0: number; z1: number }
const colliders: Box[] = [];
const solid = (x: number, z: number, w: number, d: number) => colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });

const stallObj = M.stall();
// The stall faces west, toward the customers; you stock it from the east side.
stallObj.position.set(-6.4, 0, 4.4);
stallObj.rotation.y = -Math.PI / 2;
scene.add(stallObj);
solid(-6.4, 4.4, 1.3, 3.3);
const shelfGroup = new THREE.Group();
shelfGroup.position.set(-6.4, 0.97, 4.4);
shelfGroup.rotation.y = -Math.PI / 2;
scene.add(shelfGroup);
const shelf = new Pile(shelfGroup, 5, 2, 0.6, 0.5, 0.26).withLabel(1.9, CAP.shelf);
const sellZone = { pos: V(-4.4, 0, 4.4), r: 1.2 };
new Decal(1.8, 2.6, sellZone.pos.x, sellZone.pos.z).zone("SELL", "#ffd54f");
const cashGroup = new THREE.Group();
cashGroup.position.set(-4.4, 0, 7.0);
scene.add(cashGroup);
const cash = new Cash(cashGroup);
const cashZone = { pos: V(-4.4, 0, 7.0), r: 1.25 };

// Seed crate: stand here to buy seed bags for planting.
const crate = M.seedCrate();
crate.position.set(4.6, 0, 3.6);
crate.rotation.y = 0.15;
scene.add(crate);
solid(4.6, 3.6, 1.4, 1.0);
const seedZone = { pos: V(3.0, 0, 3.0), r: 1.1 };
new Decal(1.9, 1.6, seedZone.pos.x, seedZone.pos.z).zone(`SEEDS $${SEED_COST}`, "#a1887f");

interface Machine {
  input: Pile; output: Pile; inZone: THREE.Vector3; outZone: THREE.Vector3; center: THREE.Vector3;
  from: Kind; to: Kind; secs: number; timer: number; on: boolean; anim: (dt: number, working: boolean) => void;
}
function makeMachine(x: number, z: number, from: Kind, to: Kind, secs: number): Machine {
  const ig = new THREE.Group(); ig.position.set(x + 1.8, 0.1, z + 2.3); scene.add(ig);
  const og = new THREE.Group(); og.position.set(x - 1.8, 0.1, z + 2.3); scene.add(og);
  return {
    input: new Pile(ig, 2, 2).withLabel(1.9, CAP.machineIn), output: new Pile(og, 2, 2).withLabel(1.9, CAP.machineOut), center: V(x, 2, z),
    inZone: V(x + 1.8, 0, z + 2.3), outZone: V(x - 1.8, 0, z + 2.3),
    from, to, secs, timer: 0, on: false, anim: () => {},
  };
}
const mill = makeMachine(-4, -4.6, "wheat", "flour", 1.0);
const bakeryM = makeMachine(-4, -11.6, "flour", "bread", 1.3);
for (const m of [mill, bakeryM]) for (const p of [m.input, m.output]) p.label!.sprite.visible = false;

function enableMachine(m: Machine, label: [string, string]) {
  m.on = true;
  m.input.label!.sprite.visible = true;
  m.output.label!.sprite.visible = true;
  new Decal(1.9, 1.9, m.inZone.x, m.inZone.z).zone(label[0], "#8bc34a");
  new Decal(1.9, 1.9, m.outZone.x, m.outZone.z).zone(label[1], "#4fc3f7");
}

// ------------------------------------------------------------------
// Vehicles
// ------------------------------------------------------------------
interface Vehicle { obj: THREE.Group; load: Pile; cap: number; speed: number; state: string; home: THREE.Vector3; timer: number; think: (v: Vehicle, dt: number) => void }
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
function unloadTick(v: Vehicle, dt: number, target: Pile): boolean {
  if (v.load.count === 0) return true;
  if (target.full) return false;
  v.timer -= dt;
  if (v.timer > 0) return false;
  v.timer = 0.07;
  const it = v.load.take();
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
  const dest = mill.on ? { pos: mill.inZone, pile: mill.input } : { pos: sellZone.pos, pile: shelf };
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
    else if (ripe >= 4 && dest.pile.space >= 4) v.state = "gather";
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
    if (moveTo(v.obj, sellZone.pos.clone().add(V(1.4, 0, -0.6)), vSpeed(v), dt) && unloadTick(v, dt, shelf)) v.state = "home";
  } else {
    if (bakeryM.output.count >= 4 && shelf.space >= 4) v.state = "fetch";
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

// ------------------------------------------------------------------
// Build pads: stand on them to spend coins
// ------------------------------------------------------------------
interface PadDef { id: string; name: string; cost: number; x: number; z: number; build: (animate: boolean) => void }
const PADS: PadDef[] = [
  { id: "field2", name: "New field", cost: 30, x: 4, z: -9.6, build: (a) => makeField(2, 4, -9.6, a, -1) },
  {
    id: "windmill", name: "Windmill", cost: 80, x: -4, z: -4.6, build: (a) => {
      const w = M.windmill();
      w.root.position.set(-4, 0, -4.6);
      scene.add(w.root);
      if (a) popIn(w.root, 0);
      solid(-4, -4.6, 2.8, 2.8);
      enableMachine(mill, ["WHEAT", "FLOUR"]);
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
      enableMachine(bakeryM, ["FLOUR", "BREAD"]);
      bakeryM.anim = (_dt, working) => {
        b.smoke.children.forEach((p, i) => {
          p.position.y = ((clock * 0.6 + i * 0.33) % 1) * 1.4;
          p.scale.setScalar(working ? 0.6 + p.position.y * 0.5 : 0.001);
        });
      };
    },
  },
  {
    id: "tractor", name: "Tractor (plants)", cost: 700, x: 8.6, z: -2, build: () => {
      garage(8.6, -2);
      addVehicle(M.tractor(), V(8.6, 0, -2), 8, 3.2, tractorWorker);
    },
  },
  { id: "basket2", name: "Huge basket", cost: 900, x: 1.6, z: 4.6, build: () => { capacity = Math.max(capacity, 35); bag.cap = capacity; } },
  {
    id: "harvester", name: "Harvester", cost: 1500, x: 8.6, z: -9.6, build: () => {
      garage(8.6, -9.6);
      addVehicle(M.harvester(), V(8.6, 0, -9.6), 12, 3.0, harvesterWorker);
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
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastTimer = 2.2;
}

function completePad(lp: LivePad) {
  built.add(lp.def.id);
  delete paidSaved[lp.def.id];
  lp.def.build(true);
  confetti(V(lp.def.x, 1, lp.def.z));
  sfx.build();
  toast(`${lp.def.name} built!`);
  refreshPads();
  persist();
}

// ------------------------------------------------------------------
// Customers
// ------------------------------------------------------------------
interface Customer {
  obj: THREE.Group; state: "walk" | "leave"; kind: Kind; want: number; got: number; paid: number;
  timer: number; patience: number; maxPatience: number; waited: number; angry: boolean; bubble: Bubble; hands: Pile;
}
const customers: Customer[] = [];
const SHIRTS = [0xe57373, 0x64b5f6, 0x81c784, 0xffb74d, 0xba68c8, 0x4db6ac, 0xf06292, 0xfff176];
let spawnTimer = 0.3, lostSales = 0;
const queueSlot = (i: number) => (i === 0 ? V(-7.9, 0, 4.4) : V(-8.4, 0, 4.4 + i * 1.2));

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

/** What shoppers ask for. Processed goods are more popular once you can make them. */
function pickDemand(): { kind: Kind; want: number } {
  const options: [Kind, number][] = [["wheat", 1]];
  if (built.has("windmill")) options.push(["flour", 1.4]);
  if (built.has("bakery")) options.push(["bread", 1.8]);
  let r = Math.random() * options.reduce((a, [, w]) => a + w, 0);
  let kind: Kind = "wheat";
  for (const [k, w] of options) {
    if ((r -= w) <= 0) { kind = k; break; }
  }
  const tier = options.length;
  return { kind, want: 1 + Math.floor(Math.random() * (1 + tier)) };
}

function updateCustomers(dt: number) {
  spawnTimer -= dt;
  const waiting = customers.filter((c) => c.state === "walk").length;
  // A long line puts people off: no new shoppers join when it's full.
  if (spawnTimer <= 0 && waiting < 6) {
    spawnTimer = (built.has("bakery") ? 2.6 : 3.4) * (0.7 + Math.random() * 0.6);
    const obj = M.person(SHIRTS[Math.floor(Math.random() * SHIRTS.length)]);
    obj.position.set(-17, 0, 8.2);
    scene.add(obj);
    const bubble = new Bubble();
    bubble.sprite.position.set(0, 2.6, 0);
    obj.add(bubble.sprite);
    const hg = new THREE.Group();
    hg.position.set(0, 0.9, 0.38);
    obj.add(hg);
    const d = pickDemand();
    const maxPatience = 26 + d.want * 4;
    customers.push({ obj, state: "walk", kind: d.kind, want: d.want, got: 0, paid: 0, timer: 0, patience: maxPatience, maxPatience, waited: 0, angry: false, bubble, hands: new Pile(hg, 1, 1, 0, 0, 0.22) });
  }
  let queueIdx = 0;
  for (const c of [...customers]) {
    if (c.state === "leave") {
      c.bubble.sprite.visible = c.angry;
      if (moveTo(c.obj, V(-17, 0, 1.5), 3.2, dt)) {
        scene.remove(c.obj);
        customers.splice(customers.indexOf(c), 1);
      }
      walkAnim(c.obj, true);
      continue;
    }
    const arrived = moveTo(c.obj, queueSlot(queueIdx), 3.4, dt);
    walkAnim(c.obj, !arrived);
    c.bubble.set(c.kind, c.got, c.want, c.patience / c.maxPatience, false);
    if (arrived) {
      let diff = Math.PI / 2 - c.obj.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      c.obj.rotation.y += diff * Math.min(1, dt * 8);
      c.patience -= dt;
      if (queueIdx === 0) {
        c.timer -= dt;
        if (c.timer <= 0) {
          // Shoppers only buy what they came for.
          const it = shelf.take((k) => k === c.kind);
          if (it) {
            c.timer = 0.3;
            c.hands.add(it.kind, it.at);
            c.got++;
            c.paid += PRICE[it.kind];
            c.patience = Math.min(c.maxPatience, c.patience + 4);
            sfx.tick();
          } else c.waited += dt;
          if (c.got >= c.want) {
            cash.add(c.paid, c.obj.position.clone().setY(1.2));
            decor.floatText(money(c.paid), c.obj.position.clone().setY(2.6));
            sfx.coin();
            c.state = "leave";
          }
        }
      }
      if (c.patience <= 0 && c.state === "walk") {
        c.state = "leave";
        c.angry = true;
        c.bubble.set(c.kind, c.got, c.want, 0, true);
        if (c.paid > 0) cash.add(c.paid, c.obj.position.clone().setY(1.2));
        lostSales++;
        if (lostSales % 2 === 1) toast(`A customer gave up waiting for ${c.kind}`);
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

// ------------------------------------------------------------------
// Input: drag anywhere for a joystick, or WASD / arrows
// ------------------------------------------------------------------
const move = V();
let joyId: number | null = null;
const joyOrigin = { x: 0, y: 0 };
const keys = new Set<string>();
window.addEventListener("pointerdown", (e) => {
  sfx.unlock();
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
  pos.x = THREE.MathUtils.clamp(pos.x, -11.5, 11.5);
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
      if (bag.take((k) => k === "seed")) { plantTile(t); sfx.tick(); }
      continue;
    }
    if (t.growth < 1) continue;
    if (bag.full) {
      if (fullWarn <= 0) { toast("Basket full! Take it to the stall"); fullWarn = 4; }
      break;
    }
    t.growth = -1;
    bag.add("wheat", t.pos.clone().setY(0.7));
    decor.burst(t.pos.clone().setY(0.5), 0xf0c94a, 5);
    sfx.pop();
  }

  // drop off and pick up, one item at a time
  dropTimer -= dt;
  if (dropTimer <= 0) {
    let did = false;
    if (near(sellZone.pos, sellZone.r) && bag.count > 0) {
      if (shelf.full) {
        if (fullWarn <= 0) { toast("Counter is full! Wait for customers"); fullWarn = 4; }
      } else {
        const it = bag.take((k) => k !== "seed");
        if (it) { shelf.add(it.kind, it.at); did = true; }
      }
    }
    if (near(seedZone.pos, seedZone.r) && !bag.full) {
      // Seeds cost money, but you're never stuck: they're free if you're broke.
      const free = coins < SEED_COST && tiles.every((t) => t.growth < 0) && bag.countOf("wheat") === 0;
      if (coins >= SEED_COST || free) {
        if (!free) { coins -= SEED_COST; seedSpend += SEED_COST; }
        bag.add("seed", crate.position.clone().setY(1));
        did = true;
      }
    }
    for (const m of [mill, bakeryM]) {
      if (!m.on) continue;
      if (near(m.inZone, 1.1) && !m.input.full) {
        const it = bag.take((kk) => kk === m.from);
        if (it) { m.input.add(it.kind, it.at); did = true; }
      }
      if (near(m.outZone, 1.1) && !bag.full) {
        const it = m.output.take();
        if (it) { bag.add(it.kind, it.at); did = true; }
      }
    }
    if (did) { dropTimer = 0.06; sfx.tick(); }
  }

  if (near(cashZone.pos, cashZone.r) && cash.value > 0) {
    const v = cash.collect(() => playerPos().clone().setY(1.4));
    decor.floatText("+" + money(v), playerPos().clone().setY(2.8), "#ffe066");
    coins += v;
    lifetime += v;
    P.sendScore(lifetime);
    sfx.coin();
  }

  // pay into build pads
  for (const lp of livePads) {
    if (!near(V(lp.def.x, 0, lp.def.z), 1.25) || coins <= 0) { lp.acc = 0; continue; }
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
      fly(M.cashMesh(), playerPos().clone().setY(1.3), () => V(lp.def.x, 0.1, lp.def.z), undefined, 0.22, 0.8);
      if (++payTick % 2 === 0) sfx.tick();
    }
    if (lp.paid >= lp.def.cost) completePad(lp);
    break;
  }
}

// ------------------------------------------------------------------
// Machines, fields, guidance
// ------------------------------------------------------------------
function updateMachines(dt: number) {
  for (const m of [mill, bakeryM]) {
    if (!m.on) continue;
    const working = m.input.count > 0 && !m.output.full;
    m.anim(dt, working);
    if (!working) { m.timer = 0; continue; }
    m.timer += dt;
    if (m.timer >= m.secs * (built.has("dam") ? 0.5 : 1)) {
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

function updateGuide() {
  let target: THREE.Vector3 | null = null;
  let msg = "";
  const nextPad = livePads[0];
  const front = customers.find((c) => c.state === "walk");
  if (lifetime === 0 && cash.value === 0) {
    if (bag.count === 0 && shelf.count === 0) { msg = "Walk into the wheat to harvest it"; target = V(4, 0, -1.8); }
    else if (bag.count > 0) { msg = "Carry it to the market stall"; target = sellZone.pos; }
    else msg = "Customers are buying...";
  } else if (cash.value > 0 && lifetime < 20) {
    msg = "Collect your cash"; target = cashZone.pos;
  } else if (lifetime < 120 && !tiles.some((t) => t.growth >= 0) && bag.countOf("seed") === 0 && bag.countOf("wheat") === 0) {
    msg = "Buy seeds at the seed crate"; target = seedZone.pos;
  } else if (lifetime < 120 && bag.countOf("seed") > 0 && tiles.some((t) => t.growth < 0)) {
    msg = "Walk over bare soil to plant"; target = nearestTile(playerPos(), (t) => t.growth < 0)?.pos ?? null;
  } else if (built.size === 0 && nextPad && coins >= 10) {
    msg = "Stand on the pad to build"; target = V(nextPad.def.x, 0, nextPad.def.z);
  } else if (built.has("windmill") && built.size <= 2 && lifetime < 250 && bag.countOf("wheat") > 0) {
    msg = "Flour sells for more: drop wheat at the windmill"; target = mill.inZone;
  } else if (front && front.waited > 2.5 && shelf.countOf(front.kind) === 0) {
    const k = front.kind;
    msg = `Your customer wants ${k}!`;
    const src = k === "wheat" ? null : k === "flour" ? mill : bakeryM;
    if (bag.countOf(k) > 0) target = sellZone.pos;
    else if (src && src.output.count > 0) target = src.outZone;
  } else if (nextPad && coins + nextPad.paid >= nextPad.def.cost) {
    target = V(nextPad.def.x, 0, nextPad.def.z);
  }
  hint.textContent = msg;
  hint.classList.toggle("show", !!msg);
  arrow.visible = !!target;
  if (target) arrow.position.set(target.x, 1.3 + Math.abs(Math.sin(clock * 4)) * 0.6, target.z);
}

// ------------------------------------------------------------------
// Save / load
// ------------------------------------------------------------------
interface SaveData {
  v: 2; coins: number; lifetime: number; built: string[]; paid: Record<string, number>;
  bag: Kind[]; shelf: Kind[]; mill: [Kind[], Kind[]]; bakery: [Kind[], Kind[]]; cash: number; tiles?: number[];
}
function persist() {
  const d: SaveData = {
    v: 2, coins, lifetime, built: [...built], paid: { ...paidSaved }, bag: bag.kinds(), shelf: shelf.kinds(),
    mill: [mill.input.kinds(), mill.output.kinds()], bakery: [bakeryM.input.kinds(), bakeryM.output.kinds()], cash: cash.value,
    tiles: tiles.map((t) => Math.round(t.growth * 100) / 100),
  };
  P.save(GAME_ID, JSON.stringify(d));
}
async function load() {
  let d: SaveData | null = null;
  try {
    const raw = await P.loadSave(GAME_ID);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.v === 2) d = parsed;
  } catch { /* fresh start */ }
  makeField(1, 4, -2, false);
  if (d) {
    coins = d.coins;
    lifetime = d.lifetime;
    Object.assign(paidSaved, d.paid ?? {});
    for (const p of PADS) if (d.built.includes(p.id)) { built.add(p.id); p.build(false); }
    // Older saves may hold more than today's limits allow: trim to the caps.
    const fill = (src: Kind[], pile: Pile) => src.slice(0, pile.cap).forEach((k) => pile.add(k));
    fill(d.bag, bag);
    fill(d.shelf, shelf);
    fill(d.mill[0], mill.input);
    fill(d.mill[1], mill.output);
    fill(d.bakery[0], bakeryM.input);
    fill(d.bakery[1], bakeryM.output);
    d.tiles?.forEach((g, i) => { if (tiles[i]) tiles[i].growth = g; });
    if (d.cash > 0) cash.add(d.cash);
  }
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
  clock += dt;

  updatePlayer(dt);
  updateFields(dt);
  updateMachines(dt);
  updateCustomers(dt);
  for (const v of vehicles) {
    const bx = v.obj.position.x, bz = v.obj.position.z;
    v.think(v, dt);
    const moving = Math.abs(bx - v.obj.position.x) + Math.abs(bz - v.obj.position.z) > 1e-4;
    v.obj.position.y = moving ? Math.abs(Math.sin(clock * 20)) * 0.04 : 0;
  }
  spinners.forEach((f) => f(dt));
  decor.update(dt, clock, farmer.root.position, playerMoving);
  for (const p of [shelf, mill.input, mill.output, bakeryM.input, bakeryM.output]) p.updateLabel();
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
  }
  hudBag.textContent = bag.count >= capacity ? "FULL" : `${bag.count}/${capacity}`;
  hudBag.parentElement!.classList.toggle("full", bag.count >= capacity);

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.classList.remove("show");
  }

  saveTimer += dt;
  if (saveTimer > 4) { saveTimer = 0; persist(); }

  renderer.render(scene, camera);
  if (!readySent) {
    readySent = true;
    P.gameReady();
  }
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
    state: () => ({ coins, lifetime, bag: bag.count, shelf: shelf.count, cash: cash.value, built: [...built], q: customers.map((c) => `${c.state}:${c.kind}x${c.want}:w${c.waited.toFixed(1)}:p${c.patience.toFixed(0)}`) }),
  };
}

renderer.render(scene, camera);
P.firstFrameReady();
load().then(() => {
  if (lifetime === 0) toast("Welcome to your farm!");
  start();
});
