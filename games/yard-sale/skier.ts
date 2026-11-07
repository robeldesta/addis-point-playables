import * as THREE from "three";
import * as CANNON from "cannon-es";
import type { Course, Obstacle } from "./course";

// A skier is a jointed body. While skiing, a procedural rig poses it. When it
// crashes, every body part becomes a rigid body in a cannon-es ragdoll, and
// each piece of gear is locked on with a joint that snaps when the force on it
// gets too high. That is how skis, boots, poles and helmets come off.

export type PartName = "pelvis" | "chest" | "head" | "uArmL" | "lArmL" | "uArmR" | "lArmR" | "thighL" | "shinL" | "thighR" | "shinR";
export type GearName = "helmet" | "poleL" | "poleR" | "bootL" | "bootR" | "skiL" | "skiR";
type V3 = [number, number, number];

interface PartDef { name: PartName; parent: PartName | null; joint: V3; center: V3; half: V3; cloth: "jacket" | "pants" | null; mass: number }
const PARTS: PartDef[] = [
  { name: "pelvis", parent: null, joint: [0, 0, 0], center: [0, 0, 0], half: [0.16, 0.1, 0.11], cloth: "pants", mass: 12 },
  { name: "chest", parent: "pelvis", joint: [0, 0.1, 0], center: [0, 0.22, 0], half: [0.18, 0.22, 0.12], cloth: "jacket", mass: 20 },
  { name: "head", parent: "chest", joint: [0, 0.22, 0], center: [0, 0.14, 0], half: [0.11, 0.12, 0.11], cloth: null, mass: 5 },
  { name: "uArmL", parent: "chest", joint: [0.23, 0.17, 0], center: [0, -0.15, 0], half: [0.05, 0.15, 0.05], cloth: "jacket", mass: 2.5 },
  { name: "lArmL", parent: "uArmL", joint: [0, -0.15, 0], center: [0, -0.14, 0], half: [0.045, 0.14, 0.045], cloth: "jacket", mass: 1.8 },
  { name: "uArmR", parent: "chest", joint: [-0.23, 0.17, 0], center: [0, -0.15, 0], half: [0.05, 0.15, 0.05], cloth: "jacket", mass: 2.5 },
  { name: "lArmR", parent: "uArmR", joint: [0, -0.15, 0], center: [0, -0.14, 0], half: [0.045, 0.14, 0.045], cloth: "jacket", mass: 1.8 },
  { name: "thighL", parent: "pelvis", joint: [0.09, -0.07, 0], center: [0, -0.22, 0], half: [0.075, 0.22, 0.075], cloth: "pants", mass: 9 },
  { name: "shinL", parent: "thighL", joint: [0, -0.22, 0], center: [0, -0.2, 0], half: [0.06, 0.2, 0.06], cloth: "pants", mass: 4 },
  { name: "thighR", parent: "pelvis", joint: [-0.09, -0.07, 0], center: [0, -0.22, 0], half: [0.075, 0.22, 0.075], cloth: "pants", mass: 9 },
  { name: "shinR", parent: "thighR", joint: [0, -0.22, 0], center: [0, -0.2, 0], half: [0.06, 0.2, 0.06], cloth: "pants", mass: 4 },
];
const n3 = (x: number, y: number, z: number) => new CANNON.Vec3(x, y, z).unit();
// cone joints: axis in parent frame (neutral pose), axis in child frame, cone, twist
const JOINTS: Record<string, { a: CANNON.Vec3; b: CANNON.Vec3; cone: number; twist: number }> = {
  chest: { a: n3(0, 1, 0.15), b: n3(0, 1, 0), cone: 0.55, twist: 0.4 },
  head: { a: n3(0, 1, 0.1), b: n3(0, 1, 0), cone: 0.6, twist: 0.7 },
  uArmL: { a: n3(0.35, -0.8, 0.35), b: n3(0, -1, 0), cone: 1.35, twist: 0.8 },
  uArmR: { a: n3(-0.35, -0.8, 0.35), b: n3(0, -1, 0), cone: 1.35, twist: 0.8 },
  lArmL: { a: n3(0, -0.7, 0.7), b: n3(0, -1, 0), cone: 0.8, twist: 0.3 },
  lArmR: { a: n3(0, -0.7, 0.7), b: n3(0, -1, 0), cone: 0.8, twist: 0.3 },
  thighL: { a: n3(0.12, -0.85, 0.5), b: n3(0, -1, 0), cone: 1.0, twist: 0.4 },
  thighR: { a: n3(-0.12, -0.85, 0.5), b: n3(0, -1, 0), cone: 1.0, twist: 0.4 },
  shinL: { a: n3(0, -0.7, -0.7), b: n3(0, -1, 0), cone: 0.8, twist: 0.2 },
  shinR: { a: n3(0, -0.7, -0.7), b: n3(0, -1, 0), cone: 0.8, twist: 0.2 },
};

interface GearDef { name: GearName; parent: PartName | GearName; at: V3; half: V3; mass: number }
const GEAR: GearDef[] = [
  { name: "helmet", parent: "head", at: [0, 0.035, -0.005], half: [0.13, 0.1, 0.135], mass: 0.6 },
  { name: "bootL", parent: "shinL", at: [0, -0.23, 0.03], half: [0.075, 0.09, 0.16], mass: 1.8 },
  { name: "bootR", parent: "shinR", at: [0, -0.23, 0.03], half: [0.075, 0.09, 0.16], mass: 1.8 },
  { name: "skiL", parent: "bootL", at: [0, -0.1, 0.08], half: [0.05, 0.012, 0.85], mass: 1.6 },
  { name: "skiR", parent: "bootR", at: [0, -0.1, 0.08], half: [0.05, 0.012, 0.85], mass: 1.6 },
  { name: "poleL", parent: "lArmL", at: [0, -0.14, 0], half: [0.016, 0.58, 0.016], mass: 0.35 },
  { name: "poleR", parent: "lArmR", at: [0, -0.14, 0], half: [0.016, 0.58, 0.016], mass: 0.35 },
];
// force (N) on a gear joint that makes it let go
const BREAK: Record<GearName, number> = { helmet: 2300, poleL: 320, poleR: 320, bootL: 5200, bootR: 5200, skiL: 1150, skiR: 1150 };

export const GROUP_WORLD = 1, GROUP_BODY = 2, GROUP_GEAR = 4;

// ------------------------------------------------------------------
// shared physics world
// ------------------------------------------------------------------
export class Physics {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  snow = new CANNON.Material("snow");
  flesh = new CANNON.Material("flesh");
  ski = new CANNON.Material("ski");
  constructor() {
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 14;
    this.world.allowSleep = false;
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.snow, this.flesh, { friction: 0.22, restitution: 0.08 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.snow, this.ski, { friction: 0.04, restitution: 0.1 }));
  }
}

// static terrain + obstacles around a crash, rebuilt as the body tumbles
class Patch {
  bodies: CANNON.Body[] = [];
  cx = 0; cz = 0;
  static SIZE = 44;
  constructor(private ph: Physics, private course: Course) {}
  build(x: number, z: number) {
    this.clear();
    const S = Patch.SIZE, es = 1, N = S / es + 1;
    const x0 = Math.round(x - S / 2), z0 = Math.round(z - S / 3);
    this.cx = x0 + S / 2; this.cz = z0 + S / 2;
    const data: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) row.push(this.course.height(x0 + i * es, z0 + (N - 1) * es - j * es));
      data.push(row);
    }
    const hf = new CANNON.Heightfield(data, { elementSize: es });
    const b = new CANNON.Body({ mass: 0, material: this.ph.snow, collisionFilterGroup: GROUP_WORLD });
    b.addShape(hf);
    b.position.set(x0, 0, z0 + (N - 1) * es);
    b.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.add(b);
    const obs: Obstacle[] = [];
    for (const o of this.course.near(z, obs, 3)) {
      if (Math.abs(o.x - x) > S / 2 || o.z < z0 || o.z > z0 + S) continue;
      const base = this.course.height(o.x, o.z);
      const ob = new CANNON.Body({ mass: 0, material: this.ph.snow, collisionFilterGroup: GROUP_WORLD });
      if (o.kind === "rock") ob.addShape(new CANNON.Sphere(o.r * 1.05));
      else ob.addShape(new CANNON.Box(new CANNON.Vec3(0.18 * o.s + 0.05, o.h / 2, 0.18 * o.s + 0.05)));
      ob.position.set(o.x, base + (o.kind === "rock" ? o.r * 0.4 : o.h / 2), o.z);
      this.add(ob);
    }
    // nets
    for (let zz = z0; zz < z0 + S; zz += 4) {
      for (const side of [-1, 1]) {
        const nx = this.course.cx(zz + 2) + side * (this.course.w(zz + 2) + 1.2);
        const nb = new CANNON.Body({ mass: 0, material: this.ph.snow, collisionFilterGroup: GROUP_WORLD });
        nb.addShape(new CANNON.Box(new CANNON.Vec3(0.1, 0.8, 2.1)));
        const ang = Math.atan2(this.course.cx(zz + 4) - this.course.cx(zz), 4);
        nb.position.set(nx, this.course.height(nx, zz + 2) + 0.7, zz + 2);
        nb.quaternion.setFromEuler(0, ang, 0);
        this.add(nb);
      }
    }
  }
  private add(b: CANNON.Body) { this.ph.world.addBody(b); this.bodies.push(b); }
  clear() { for (const b of this.bodies) this.ph.world.removeBody(b); this.bodies.length = 0; }
}

// ------------------------------------------------------------------
// textures: skin with bruises, clothing with tears
// ------------------------------------------------------------------
function canvasTex(w: number, h: number, fill: string) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = fill; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { c, g, t };
}
type CT = ReturnType<typeof canvasTex>;

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, jag = 0.45) {
  g.beginPath();
  const n = 9 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - jag + Math.random() * jag * 2);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.8;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
}

const SKINS = ["#f1c7a5", "#e0ac7e", "#c68a5c", "#8d5a3b", "#5c3a24", "#f6d5bd"];
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();

export interface Look { suit: number; pants: number; helmet: number; ski: number }

interface PartVis { def: PartDef; group: THREE.Group; skin: CT; cloth?: CT; clothA?: CT; joint: THREE.Object3D; center: THREE.Object3D; body?: CANNON.Body; hits: number; lastHit: number }
interface GearVis { def: GearDef; obj: THREE.Object3D; anchor: THREE.Object3D; body?: CANNON.Body; lock?: CANNON.LockConstraint; on: boolean }

export type Mode = "ski" | "air" | "rag" | "getup" | "out";
export type CrashCause = "tree" | "rock" | "net" | "land" | "edge" | "balance" | "skier";

export interface Events {
  crash?(s: Skier, cause: CrashCause, speed: number): void;
  gearOff?(s: Skier, g: GearName): void;
  hit?(s: Skier, part: PartName, dmg: number): void;
  tear?(s: Skier, part: PartName): void;
  trick?(s: Skier, deg: number): void;
  land?(s: Skier, quality: "clean" | "sketchy"): void;
  getUp?(s: Skier, lost: GearName[], spare: boolean): void;
  out?(s: Skier): void;
}

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);

export class Skier {
  name: string;
  flag: string;
  isPlayer: boolean;
  scene: THREE.Scene;
  course: Course;
  ph: Physics;
  ev: Events;
  look: Look;
  root = new THREE.Object3D();
  parts = {} as Record<PartName, PartVis>;
  gear = {} as Record<GearName, GearVis>;
  patch: Patch;
  skinTone: string;
  face: CT;

  // ski state
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  mode: Mode = "ski";
  steer = 0; lean = 0; hold = false; // inputs
  sSteer = 0; sLean = 0; sCrouch = 0.3; // smoothed pose
  balance = 0; balV = 0;
  airT = 0; spin = 0;
  skid = 0;
  normal = new THREE.Vector3(0, 1, 0);
  // race
  started = false;
  finished = false;
  finishTime = 0;
  penalty = 0;
  dnf = false;
  // damage
  health = 100;
  dmg = {} as Record<PartName, number>;
  tears = 0;
  bruises = 0;
  crashes = 0;
  lostGear: GearName[] = [];
  ragT = 0; restT = 0; getupT = 0;
  invuln = 0;
  // upgrades
  speedMul = 1; bindMul = 1; armor = 1;
  private getupFrom = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();

  constructor(opts: { scene: THREE.Scene; course: Course; ph: Physics; ev: Events; name: string; flag: string; look: Look; isPlayer: boolean }) {
    this.scene = opts.scene; this.course = opts.course; this.ph = opts.ph; this.ev = opts.ev;
    this.name = opts.name; this.flag = opts.flag; this.look = opts.look; this.isPlayer = opts.isPlayer;
    this.patch = new Patch(this.ph, this.course);
    this.skinTone = SKINS[Math.floor(Math.random() * SKINS.length)];
    this.face = canvasTex(128, 64, this.skinTone);
    this.drawFace();
    this.buildRig();
    this.buildGear();
    for (const p of PARTS) this.dmg[p.name] = 0;
  }

  // ---------------- construction
  private buildRig() {
    const suit = new THREE.Color(this.look.suit);
    const suitHex = "#" + suit.getHexString();
    const pantsHex = "#" + new THREE.Color(this.look.pants).getHexString();
    for (const def of PARTS) {
      const joint = new THREE.Object3D();
      const center = new THREE.Object3D();
      joint.add(center);
      center.position.set(...def.center);
      if (def.parent) {
        this.parts[def.parent].center.add(joint);
        joint.position.set(...def.joint);
      } else this.root.add(joint);
      const group = new THREE.Group();
      const [hx, hy, hz] = def.half;
      let skin: CT;
      if (def.name === "head") {
        skin = this.face;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshLambertMaterial({ map: skin.t }));
        m.castShadow = true;
        group.add(m);
      } else {
        skin = canvasTex(64, 64, this.skinTone);
        const r = Math.min(hx, hz);
        const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, hy * 2 - r * 2), 4, 10);
        const sm = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: skin.t }));
        sm.scale.set((hx / r) * 0.93, 0.98, (hz / r) * 0.93);
        group.add(sm);
        let cloth: CT | undefined, clothA: CT | undefined;
        if (def.cloth) {
          const base = def.cloth === "jacket" ? suitHex : pantsHex;
          cloth = canvasTex(64, 64, base);
          if (def.cloth === "jacket") { // stripe for style
            cloth.g.fillStyle = "rgba(255,255,255,.85)";
            cloth.g.fillRect(0, 40, 64, 5);
          }
          clothA = canvasTex(64, 64, "#fff");
          const cm = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: cloth.t, alphaMap: clothA.t, alphaTest: 0.5, side: THREE.DoubleSide }));
          cm.scale.set((hx / r) * 1.05, 1.02, (hz / r) * 1.05);
          cm.castShadow = true;
          group.add(cm);
          this.parts[def.name] = { def, group, skin, cloth, clothA, joint, center, hits: 0, lastHit: -1 };
        }
        if (def.name.startsWith("lArm")) { // glove
          const gl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x222222 }));
          gl.position.y = -0.13;
          group.add(gl);
        }
        if (def.name.startsWith("shin")) { // sock, visible when the boot is gone
          const sk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.24), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
          sk.position.set(0, -0.24, 0.04);
          group.add(sk);
          const st = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.03, 0.245), new THREE.MeshLambertMaterial({ color: 0xd32f2f }));
          st.position.set(0, -0.2, 0.04);
          group.add(st);
        }
      }
      if (!this.parts[def.name]) this.parts[def.name] = { def, group, skin, joint, center, hits: 0, lastHit: -1 };
      this.scene.add(group);
    }
  }

  private buildGear() {
    const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c });
    for (const def of GEAR) {
      const anchor = new THREE.Object3D();
      anchor.position.set(...def.at);
      const parentNode = (this.parts as Record<string, PartVis>)[def.parent]?.center ?? this.gear[def.parent as GearName].anchor;
      parentNode.add(anchor);
      const obj = new THREE.Group();
      if (def.name === "helmet") {
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), lam(this.look.helmet));
        h.castShadow = true;
        const gog = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), new THREE.MeshLambertMaterial({ color: 0xff9800, emissive: 0x442200 }));
        gog.position.set(0, 0.0, 0.12);
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 4, 20), lam(0x111111));
        strap.rotation.x = Math.PI / 2;
        obj.add(h, gog, strap);
      } else if (def.name.startsWith("boot")) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.3), lam(0x263238));
        b.castShadow = true;
        const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.03, 0.12), lam(0xbdbdbd));
        buckle.position.set(0, 0.04, 0.04);
        obj.add(b, buckle);
      } else if (def.name.startsWith("ski")) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.024, 1.6), lam(this.look.ski));
        s.castShadow = true;
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.024, 0.16), lam(this.look.ski));
        tip.position.set(0, 0.035, 0.85); tip.rotation.x = -0.6;
        const bind = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.34), lam(0x212121));
        bind.position.y = 0.025;
        obj.add(s, tip, bind);
      } else {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.16, 6), lam(0xb0bec5));
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), lam(0x111111));
        grip.position.y = 0.5;
        const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 10), lam(0x111111));
        basket.position.y = -0.5;
        obj.add(p, grip, basket);
      }
      this.scene.add(obj);
      this.gear[def.name] = { def, obj, anchor, on: true };
    }
  }

  drawFace() {
    const { g, t } = this.face;
    const W = 128, H = 64;
    const ex = W * 0.25; // front of the sphere
    g.fillStyle = "#fff";
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(ex + s * 7, H * 0.46, 3.2, 3.8, 0, 0, 7); g.fill(); }
    g.fillStyle = "#222";
    for (const s of [-1, 1]) { g.beginPath(); g.arc(ex + s * 7, H * 0.47, 1.8, 0, 7); g.fill(); }
    g.strokeStyle = "#7a3b2e"; g.lineWidth = 1.6;
    g.beginPath(); g.arc(ex, H * 0.6, 4, 0.2, Math.PI - 0.2); g.stroke();
    // hair at the back
    g.fillStyle = ["#3e2723", "#212121", "#f9a825", "#6d4c41", "#bf360c"][Math.floor(Math.random() * 5)];
    g.fillRect(ex + 22, 0, 60, H * 0.55);
    g.fillRect(0, 0, W, H * 0.18);
    t.needsUpdate = true;
  }

  // ---------------- damage visuals
  private bruise(p: PartVis, sev: number) {
    const sk = p.skin;
    const W = sk.c.width, H = sk.c.height;
    const x = p.def.name === "head" ? W * (0.15 + Math.random() * 0.2) : Math.random() * W;
    const y = H * (0.2 + Math.random() * 0.6);
    const r = 4 + sev * 2.5;
    const gr = sk.g.createRadialGradient(x, y, 0, x, y, r);
    const purple = sev > 2 ? "rgba(80,20,90,.85)" : "rgba(150,40,90,.7)";
    gr.addColorStop(0, purple);
    gr.addColorStop(0.6, "rgba(120,30,60,.45)");
    gr.addColorStop(1, "rgba(120,30,60,0)");
    sk.g.fillStyle = gr;
    sk.g.beginPath(); sk.g.arc(x, y, r, 0, 7); sk.g.fill();
    if (sev > 2.5) { // scrape
      sk.g.strokeStyle = "rgba(190,20,20,.8)"; sk.g.lineWidth = 1;
      for (let i = 0; i < 4; i++) { sk.g.beginPath(); sk.g.moveTo(x - r * 0.6, y + i * 2 - 3); sk.g.lineTo(x + r * 0.6, y + i * 2 - 4); sk.g.stroke(); }
    }
    sk.t.needsUpdate = true;
    this.bruises++;
  }
  private blackEye() {
    const g = this.face.g, H = 64, ex = 32;
    const s = Math.random() < 0.5 ? -1 : 1;
    const gr = g.createRadialGradient(ex + s * 7, H * 0.47, 2, ex + s * 7, H * 0.47, 7);
    gr.addColorStop(0, "rgba(40,0,50,0)"); gr.addColorStop(0.4, "rgba(60,10,70,.9)"); gr.addColorStop(1, "rgba(60,10,70,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(ex + s * 7, H * 0.47, 7, 0, 7); g.fill();
    this.face.t.needsUpdate = true;
  }
  private bloodyNose() {
    const g = this.face.g, H = 64, ex = 32;
    g.fillStyle = "rgba(180,0,0,.9)";
    g.fillRect(ex - 1.5, H * 0.52, 1.5, 6); g.fillRect(ex + 1, H * 0.53, 1.2, 5);
    this.face.t.needsUpdate = true;
  }
  private tear(p: PartVis) {
    if (!p.cloth || !p.clothA) return;
    const W = 64, H = 64;
    const x = Math.random() * W, y = H * (0.15 + Math.random() * 0.7);
    const r = 6 + Math.random() * 7;
    p.cloth.g.fillStyle = "rgba(30,20,10,.7)";
    blob(p.cloth.g, x, y, r * 1.35, 0.6); p.cloth.g.fill();
    p.cloth.g.fillStyle = "#e8e0d0"; // white fluff
    for (let i = 0; i < 6; i++) { p.cloth.g.fillRect(x + (Math.random() - 0.5) * r * 2.4, y + (Math.random() - 0.5) * r * 2, 2, 2); }
    p.clothA.g.fillStyle = "#000";
    blob(p.clothA.g, x, y, r, 0.55); p.clothA.g.fill();
    // what the hole reveals: scraped skin
    const gr = p.skin.g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(170,20,30,.75)"); gr.addColorStop(1, "rgba(140,40,80,.25)");
    p.skin.g.fillStyle = gr; p.skin.g.beginPath(); p.skin.g.arc(x, y, r, 0, 7); p.skin.g.fill();
    p.cloth.t.needsUpdate = p.clothA.t.needsUpdate = p.skin.t.needsUpdate = true;
    this.tears++;
    this.ev.tear?.(this, p.def.name);
  }

  private onHit(p: PartVis, impact: number) {
    if (this.mode !== "rag") return;
    const iv = impact - 4;
    if (iv <= 0) return;
    // one hit per part per moment: resting contacts re-report every step
    if (this.ragT - p.lastHit < 0.3) return;
    p.lastHit = this.ragT;
    let f = p.def.name === "head" ? (this.gear.helmet.on ? 0.55 : 1.7) : p.def.name === "chest" ? 1 : p.def.name === "pelvis" ? 0.8 : 0.7;
    f *= this.armor;
    const d = Math.pow(iv, 1.25) * f;
    if (d < 0.6) return;
    const before = this.dmg[p.def.name];
    this.dmg[p.def.name] += d;
    this.health = Math.max(0, this.health - d * 0.9);
    this.bruise(p, Math.min(4, d / 2));
    if (p.def.name === "head") {
      if (before < 6 && before + d >= 6) this.blackEye();
      if (before < 14 && before + d >= 14) this.bloodyNose();
      if (before < 24 && before + d >= 24) this.blackEye();
    }
    const tb = Math.floor(before / 5), ta = Math.floor((before + d) / 5);
    for (let i = tb; i < ta && i < tb + 2; i++) this.tear(p);
    this.ev.hit?.(this, p.def.name, d);
  }

  // ---------------- placement
  place(x: number, z: number, yaw = 0) {
    this.pos.set(x, this.course.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.mode = "ski";
    this.updatePose(0);
    this.syncFromRig();
  }

  skiCount() {
    return (this.gear.skiL.on && this.gear.bootL.on ? 1 : 0) + (this.gear.skiR.on && this.gear.bootR.on ? 1 : 0);
  }
  poleCount() { return (this.gear.poleL.on ? 1 : 0) + (this.gear.poleR.on ? 1 : 0); }
  speed() { return this.vel.length(); }

  // ---------------- ski physics
  private F = new THREE.Vector3();
  private L = new THREE.Vector3();
  private N = new THREE.Vector3();
  private P2 = new THREE.Vector3();
  private obs: Obstacle[] = [];

  step(dt: number) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.mode === "ski") this.stepGround(dt);
    else if (this.mode === "air") this.stepAir(dt);
    else if (this.mode === "rag") this.stepRag(dt);
    else if (this.mode === "getup") {
      this.getupT += dt;
      if (this.getupT > 0.7) { this.mode = "ski"; this.invuln = 1.5; }
    }
    if (this.mode === "ski" || this.mode === "air") this.checkObstacles();
  }

  private stepGround(dt: number) {
    const c = this.course, n = this.N;
    c.normal(this.pos.x, this.pos.z, n);
    this.normal.lerp(n, 0.2);
    const F = this.F.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    F.addScaledVector(n, -F.dot(n)).normalize();
    const L = this.L.crossVectors(n, F);
    this.vel.addScaledVector(n, -this.vel.dot(n));
    const sp = this.vel.length();
    const skis = this.skiCount();
    const handling = skis === 2 ? 1 : 0.55;
    if (!this.started || this.finished) { if (!this.started) { this.vel.set(0, 0, 0); return; } }
    const turnRate = (2.5 / (1 + sp / 20)) * (this.hold ? 1 : 0.75) * (1 - 0.4 * this.lean) * handling;
    this.yaw += -this.steer * turnRate * dt;
    // keep skiers heading downhill-ish
    // gravity along the slope
    this.vel.x += n.x * n.y * G * dt;
    this.vel.y += (-G + n.y * n.y * G) * dt;
    this.vel.z += n.z * n.y * G * dt;
    let vf = this.vel.dot(F), vl = this.vel.dot(L);
    const grip = (this.hold ? 7.5 : 5) * handling;
    const vl0 = vl;
    vl *= Math.exp(-grip * dt);
    this.skid = Math.abs(vl0) * 0.7 + this.skid * 0.3;
    let mu = this.hold ? 0.035 : 0.26;
    if (skis === 0) mu = 0.35;
    const dv = mu * G * n.y * dt;
    vf = Math.sign(vf) * Math.max(0, Math.abs(vf) - dv);
    if (this.hold && sp < 9 && this.poleCount()) vf += 1.6 * (this.poleCount() / 2) * (1 - sp / 9) * dt;
    let k = this.hold ? 0.0095 + (0.0042 - 0.0095) * this.lean : 0.013;
    if (skis === 1) k *= 1.4;
    k /= this.speedMul;
    vf -= k * vf * Math.abs(vf) * dt;
    vl -= k * vl * Math.abs(vl) * dt;
    this.vel.copy(F).multiplyScalar(vf).addScaledVector(L, vl);
    // balance: bumps and compressions push you fore/aft, holding steadies you
    const P2 = this.P2.copy(this.pos).addScaledVector(this.vel, dt);
    const h2 = c.height(P2.x, P2.z);
    if (P2.y < h2 + 0.035) {
      P2.y = h2;
      c.normal(P2.x, P2.z, n);
      const vn = this.vel.dot(n);
      if (vn > G * n.y * dt * 2) {
        // the ground falls away faster than gravity can pull us down: launch
        this.pos.copy(P2);
        this.pos.y = h2 + 0.01;
        this.mode = "air"; this.airT = 0; this.spin = 0;
        return;
      }
      if (vn < 0) {
        this.vel.addScaledVector(n, -vn);
        const comp = -vn;
        if (comp > 0.4) this.balV += comp * (0.5 + this.lean * 0.9) * (Math.random() < 0.5 ? -0.6 : 1);
      }
      this.pos.copy(P2);
    } else {
      this.pos.copy(P2);
      this.mode = "air"; this.airT = 0; this.spin = 0;
    }
    if (skis === 1) this.balV += (Math.random() - 0.5) * sp * 0.08;
    this.stepBalance(dt);
    this.checkNets();
  }

  private stepBalance(dt: number) {
    const restore = this.hold ? 9 : 5;
    this.balV += -this.balance * restore * dt;
    this.balV *= Math.exp(-4 * dt);
    this.balance += this.balV * dt;
    if (Math.abs(this.balance) > 1 && this.invuln <= 0) this.crash("balance");
  }

  private stepAir(dt: number) {
    this.airT += dt;
    this.vel.y -= G * dt;
    const k = 0.003;
    this.vel.addScaledVector(this.vel, -k * this.vel.length() * dt);
    const sr = -this.steer * 6.5 * dt;
    this.yaw += sr; this.spin += sr;
    this.pos.addScaledVector(this.vel, dt);
    const c = this.course, h = c.height(this.pos.x, this.pos.z);
    this.stepBalance(dt * 0.3);
    if (this.pos.y > h) return;
    // landing
    this.pos.y = h;
    const n = c.normal(this.pos.x, this.pos.z, this.N);
    const vn = -this.vel.dot(n);
    this.vel.addScaledVector(n, vn);
    const F = this.F.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).addScaledVector(n, -0).normalize();
    const hv = this.P2.set(this.vel.x, 0, this.vel.z);
    const sp = hv.length();
    let mis = 0;
    if (sp > 0.5) mis = Math.acos(Math.max(-1, Math.min(1, F.dot(hv) / sp)));
    this.mode = "ski";
    if (this.invuln > 0) { this.yaw = Math.atan2(this.vel.x, this.vel.z); return; }
    if (vn > 12.5 || (sp > 5 && mis > 0.8 && mis < 2.35) || this.skiCount() === 0 && vn > 6) {
      this.crash(vn > 12.5 ? "land" : "edge");
      return;
    }
    if (mis >= 2.35) this.yaw += Math.PI; // landed switch: spin around
    const deg = Math.round(Math.abs(this.spin) / (Math.PI * 2)) * 360;
    if (deg >= 360 && mis < 0.8) {
      this.ev.trick?.(this, deg);
      this.vel.multiplyScalar(1 + 0.04 * (deg / 360));
    }
    const sketch = vn > 7.5 || mis > 0.45;
    if (sketch) this.balV += (vn - 4) * 0.28 * (Math.random() < 0.5 ? -1 : 1);
    this.ev.land?.(this, sketch ? "sketchy" : "clean");
  }

  private checkNets() {
    const c = this.course;
    const off = this.pos.x - c.cx(this.pos.z);
    const lim = c.w(this.pos.z) + 0.7;
    if (Math.abs(off) < lim) return;
    const side = Math.sign(off);
    const outV = this.vel.x * side;
    if (outV > 6.5 && this.invuln <= 0) { this.crash("net"); return; }
    this.pos.x = c.cx(this.pos.z) + side * lim;
    if (outV > 0) this.vel.x -= outV * side * 1.3;
    this.vel.multiplyScalar(0.985);
    this.balV += 0.3 * (Math.random() - 0.5);
  }

  private checkObstacles() {
    if (this.invuln > 0) return;
    const c = this.course;
    for (const o of c.near(this.pos.z, this.obs, 1)) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const rr = o.r + 0.75;
      if (dx * dx + dz * dz > rr * rr) continue;
      const base = c.height(o.x, o.z);
      if (this.pos.y > base + o.h * (o.kind === "rock" ? 0.75 : 1)) continue;
      this.crash(o.kind === "rock" ? "rock" : "tree");
      return;
    }
  }

  // ---------------- crash -> ragdoll
  crash(cause: CrashCause, push?: THREE.Vector3) {
    if (this.mode === "rag" || this.mode === "out") return;
    const sp = this.speed();
    this.crashes++;
    this.updatePose(0);
    this.root.updateMatrixWorld(true);
    this.mode = "rag";
    this.ragT = 0; this.restT = 0;
    for (const p of Object.values(this.parts)) p.lastHit = -1;
    this.patch.build(this.pos.x, this.pos.z);
    const w = this.ph.world;
    const v = this.vel.clone();
    if (push) v.add(push);
    // tumble: pitch forward on bad landings, spin on edge catches
    const F = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const side = new THREE.Vector3().crossVectors(UP, F);
    const spinAxis = cause === "edge" || cause === "skier" ? F.clone().multiplyScalar((Math.random() < 0.5 ? -1 : 1) * 0.8).addScaledVector(UP, 0.6) : side.clone();
    const spinRate = Math.min(6, sp * 0.26) * (cause === "balance" && this.balance < 0 ? -1 : 1);
    for (const def of PARTS) {
      const p = this.parts[def.name];
      p.center.getWorldPosition(tmpV);
      p.center.getWorldQuaternion(tmpQ);
      const b = new CANNON.Body({
        mass: def.mass, material: this.ph.flesh,
        collisionFilterGroup: GROUP_BODY, collisionFilterMask: GROUP_WORLD,
        linearDamping: 0.05, angularDamping: 0.25,
      });
      b.addShape(new CANNON.Box(new CANNON.Vec3(...def.half)));
      b.position.set(tmpV.x, tmpV.y, tmpV.z);
      b.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
      // velocity of this point from the tumble
      const r = tmpV.clone().sub(this.pos);
      const ang = spinAxis.clone().multiplyScalar(spinRate);
      const tv = new THREE.Vector3().crossVectors(ang, r);
      b.velocity.set(v.x + tv.x, v.y + tv.y + (cause === "land" ? -1 : 1.5), v.z + tv.z);
      b.angularVelocity.set(ang.x + (Math.random() - 0.5) * 2, ang.y + (Math.random() - 0.5) * 2, ang.z + (Math.random() - 0.5) * 2);
      b.addEventListener("collide", (e: { contact: CANNON.ContactEquation }) => {
        this.onHit(p, Math.abs(e.contact.getImpactVelocityAlongNormal()));
      });
      w.addBody(b);
      p.body = b;
    }
    for (const def of PARTS) {
      if (!def.parent) continue;
      const a = this.parts[def.parent].body!, b = this.parts[def.name].body!;
      const j = JOINTS[def.name];
      const c = new CANNON.ConeTwistConstraint(a, b, {
        pivotA: new CANNON.Vec3(...def.joint),
        pivotB: new CANNON.Vec3(-def.center[0], -def.center[1], -def.center[2]),
        axisA: j.a, axisB: j.b, angle: j.cone, twistAngle: j.twist, collideConnected: false,
      });
      w.addConstraint(c);
      (b as unknown as { joint: CANNON.Constraint }).joint = c;
    }
    for (const def of GEAR) {
      const g = this.gear[def.name];
      if (!g.on) continue;
      g.anchor.getWorldPosition(tmpV);
      g.anchor.getWorldQuaternion(tmpQ);
      const b = new CANNON.Body({
        mass: def.mass, material: def.name.startsWith("ski") ? this.ph.ski : this.ph.flesh,
        collisionFilterGroup: GROUP_GEAR, collisionFilterMask: GROUP_WORLD,
        linearDamping: 0.03, angularDamping: 0.2,
      });
      b.addShape(new CANNON.Box(new CANNON.Vec3(...def.half)));
      b.position.set(tmpV.x, tmpV.y, tmpV.z);
      b.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
      const parentBody = (this.parts as Record<string, PartVis>)[def.parent]?.body ?? this.gear[def.parent as GearName].body!;
      b.velocity.copy(parentBody.velocity);
      b.angularVelocity.copy(parentBody.angularVelocity);
      w.addBody(b);
      const lock = new CANNON.LockConstraint(parentBody, b);
      w.addConstraint(lock);
      g.body = b; g.lock = lock;
    }
    this.ev.crash?.(this, cause, sp);
  }

  /** call after every physics substep */
  checkBreaks() {
    if (this.mode !== "rag") return;
    for (const def of GEAR) {
      const g = this.gear[def.name];
      if (!g.lock) continue;
      let m = 0;
      for (const e of g.lock.equations) m = Math.max(m, Math.abs(e.multiplier));
      const lim = BREAK[def.name] * this.bindMul * (def.name.startsWith("pole") || def.name === "helmet" ? 1 : 1);
      if (m > lim * (0.8 + Math.random() * 0.4)) {
        this.ph.world.removeConstraint(g.lock);
        g.lock = undefined;
        // fling a bit
        g.body!.angularVelocity.x += (Math.random() - 0.5) * 8;
        g.body!.angularVelocity.z += (Math.random() - 0.5) * 8;
        this.ev.gearOff?.(this, def.name);
      }
    }
  }

  private stepRag(dt: number) {
    this.ragT += dt;
    const pb = this.parts.pelvis.body!;
    this.pos.set(pb.position.x, pb.position.y, pb.position.z);
    this.vel.set(pb.velocity.x, pb.velocity.y, pb.velocity.z);
    // keep the patch under the tumbling body
    if (Math.abs(pb.position.x - this.patch.cx) > Patch.SIZE * 0.3 || Math.abs(pb.position.z - this.patch.cz) > Patch.SIZE * 0.3) this.patch.build(pb.position.x, pb.position.z + 6);
    // fell through? put back on top
    const h = this.course.height(pb.position.x, pb.position.z);
    if (pb.position.y < h - 0.6) for (const p of Object.values(this.parts)) { p.body!.position.y += h - pb.position.y + 0.3; p.body!.velocity.y = Math.abs(p.body!.velocity.y) * 0.3; }
    if (this.health <= 0 && this.mode === "rag" && this.ragT > 2.5) {
      this.mode = "out"; this.dnf = true; this.ev.out?.(this);
      return;
    }
    if (this.vel.length() < 0.9) this.restT += dt; else this.restT = 0;
    if ((this.restT > 0.9 && this.ragT > 1.4) || this.ragT > 7) this.getUp();
  }

  private getUp() {
    if (this.health <= 0) { this.mode = "out"; this.dnf = true; this.ev.out?.(this); return; }
    const pb = this.parts.pelvis.body!;
    const px = pb.position.x, pz = pb.position.z;
    const lost: GearName[] = [];
    for (const def of GEAR) {
      const g = this.gear[def.name];
      if (!g.on || !g.body) continue;
      if (g.lock) continue; // still attached
      // detached: grab it if it is close, otherwise it is gone
      const parentOn = (this.parts as Record<string, PartVis>)[def.parent] ? true : this.gear[def.parent as GearName].on;
      const d = Math.hypot(g.body.position.x - px, g.body.position.z - pz);
      if (d < 12 && parentOn) continue;
      lost.push(def.name);
    }
    // a lost boot takes its locked ski with it
    for (const [b, s] of [["bootL", "skiL"], ["bootR", "skiR"]] as [GearName, GearName][]) {
      if (lost.includes(b) && !lost.includes(s) && this.gear[s].lock) lost.push(s);
    }
    for (const n of lost) {
      const g = this.gear[n];
      const left = g.obj.clone();
      left.position.copy(g.obj.position); left.quaternion.copy(g.obj.quaternion);
      this.scene.add(left);
      litter.push(left);
      g.on = false;
      g.obj.visible = false;
      this.lostGear.push(n);
    }
    // record pose for a short blend, then tear down bodies
    this.getupFrom.clear();
    for (const p of Object.values(this.parts)) this.getupFrom.set(p.group, { p: p.group.position.clone(), q: p.group.quaternion.clone() });
    for (const g of Object.values(this.gear)) if (g.on) this.getupFrom.set(g.obj, { p: g.obj.position.clone(), q: g.obj.quaternion.clone() });
    this.removeBodies();
    let spare = false;
    if (this.skiCount() === 0) { // no skis left at all: a spare set, at a cost
      spare = true;
      this.penalty += 8;
      for (const n of ["bootL", "bootR", "skiL", "skiR"] as GearName[]) { this.gear[n].on = true; this.gear[n].obj.visible = true; }
    }
    const c = this.course;
    const lim = c.w(pz) - 1.5;
    const x = c.cx(pz) + Math.max(-lim, Math.min(lim, px - c.cx(pz)));
    this.pos.set(x, c.height(x, pz), pz);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.balance = 0; this.balV = 0;
    this.mode = "getup"; this.getupT = 0;
    this.ev.getUp?.(this, lost, spare);
  }

  removeBodies() {
    const w = this.ph.world;
    for (const p of Object.values(this.parts)) {
      if (p.body) { const j = (p.body as unknown as { joint?: CANNON.Constraint }).joint; if (j) w.removeConstraint(j); w.removeBody(p.body); p.body = undefined; }
    }
    for (const g of Object.values(this.gear)) {
      if (g.lock) { w.removeConstraint(g.lock); g.lock = undefined; }
      if (g.body) { w.removeBody(g.body); g.body = undefined; }
    }
    this.patch.clear();
  }

  dispose() {
    this.removeBodies();
    for (const p of Object.values(this.parts)) this.scene.remove(p.group);
    for (const g of Object.values(this.gear)) this.scene.remove(g.obj);
  }

  // ---------------- posing and drawing
  updatePose(dt: number) {
    const k = dt ? 1 - Math.exp(-10 * dt) : 1;
    const air = this.mode === "air";
    const crouchT = air ? 0.55 : this.hold ? 0.35 + 0.55 * this.lean : 0.22;
    this.sCrouch += (crouchT - this.sCrouch) * k;
    this.sLean += ((this.hold ? this.lean : 0) - this.sLean) * k;
    this.sSteer += (this.steer - this.sSteer) * k;
    const a = this.sCrouch; // knee bend
    const lean = this.sLean;
    const sp = Math.min(1, this.speed() / 18);
    const P = this.parts;
    // root on the ground, facing yaw, tilted halfway to the slope
    const up = tmpV.copy(this.normal).lerp(UP, 0.5).normalize();
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const left = new THREE.Vector3().crossVectors(up, fwd);
    const m = new THREE.Matrix4().makeBasis(left, up, fwd);
    this.root.quaternion.setFromRotationMatrix(m);
    const roll = this.mode === "ski" ? this.sSteer * (0.15 + 0.35 * sp) : 0;
    this.root.quaternion.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    this.root.position.copy(this.pos);
    const thigh = 0.44, shin = 0.4;
    const pelvisTilt = 0.15 + lean * 0.55 + this.balance * 0.35;
    P.pelvis.joint.position.set(0, 0.07 + (thigh + shin) * Math.cos(a) + 0.15 - a * 0.02, -0.05 - a * 0.05);
    P.pelvis.joint.rotation.set(pelvisTilt, 0, 0);
    P.chest.joint.rotation.set(0.1 + lean * 0.55 - this.balance * 0.2, 0, -roll * 0.3);
    P.head.joint.rotation.set(-(0.15 + lean * 0.75) + this.balance * 0.2, 0, 0);
    for (const s of [1, -1]) {
      const L = s > 0 ? "L" : "R";
      const flail = air || Math.abs(this.balance) > 0.45 ? Math.sin(performance.now() / 70 + s) * 0.9 : 0;
      P[("thigh" + L) as PartName].joint.rotation.set(-a - pelvisTilt + (s * this.sSteer * 0.08), 0, s * 0.03);
      P[("shin" + L) as PartName].joint.rotation.set(2 * a, 0, 0);
      P[("uArm" + L) as PartName].joint.rotation.set(-(0.35 + lean * 0.9) - pelvisTilt * 0.4 + flail, 0, s * (0.25 + (air ? 0.4 : 0)));
      P[("lArm" + L) as PartName].joint.rotation.set(-(0.7 + lean * 0.5), 0, 0);
      // boots flat on the skis
      this.gear[("boot" + L) as GearName].anchor.rotation.set(-a, 0, 0);
      this.gear[("pole" + L) as GearName].anchor.rotation.set(1.55 + lean * 0.5, 0, s * 0.08);
      this.gear[("pole" + L) as GearName].anchor.position.set(0, -0.14, 0);
    }
    // pole hangs from the hand: offset center down its length
    for (const L of ["L", "R"]) {
      const an = this.gear[("pole" + L) as GearName].anchor;
      an.updateMatrix();
      an.position.add(new THREE.Vector3(0, -0.45, 0).applyEuler(an.rotation));
    }
  }

  syncFromRig() {
    this.root.updateMatrixWorld(true);
    for (const p of Object.values(this.parts)) {
      p.center.matrixWorld.decompose(p.group.position, p.group.quaternion, tmpS);
    }
    for (const g of Object.values(this.gear)) {
      if (!g.on) continue;
      g.anchor.matrixWorld.decompose(g.obj.position, g.obj.quaternion, tmpS);
    }
  }

  render(dt: number) {
    if (this.mode === "rag" || this.mode === "out") {
      for (const p of Object.values(this.parts)) {
        if (!p.body) continue;
        p.group.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
        p.group.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      }
      for (const g of Object.values(this.gear)) {
        if (!g.on || !g.body) continue;
        g.obj.position.set(g.body.position.x, g.body.position.y, g.body.position.z);
        g.obj.quaternion.set(g.body.quaternion.x, g.body.quaternion.y, g.body.quaternion.z, g.body.quaternion.w);
      }
      return;
    }
    this.updatePose(dt);
    this.syncFromRig();
    if (this.mode === "getup") {
      const t = Math.min(1, this.getupT / 0.6);
      const e = t * t * (3 - 2 * t);
      for (const [o, f] of this.getupFrom) {
        o.position.lerpVectors(f.p, o.position, e);
        o.quaternion.slerpQuaternions(f.q, o.quaternion.clone(), e);
      }
    }
  }

  focus(out: THREE.Vector3) {
    if (this.mode === "rag" || this.mode === "out") return out.copy(this.parts.pelvis.group.position);
    return out.copy(this.pos).add(new THREE.Vector3(0, 0.9, 0));
  }

  /** words for the hospital report */
  injuries(): string[] {
    const d = this.dmg, out: string[] = [];
    const arm = Math.max(d.uArmL + d.lArmL, d.uArmR + d.lArmR);
    const leg = Math.max(d.thighL + d.shinL, d.thighR + d.shinR);
    if (d.head > 24) out.push("Concussion"); else if (d.head > 6) out.push("Black eye");
    if (d.head > 14) out.push("Bloody nose");
    if (d.chest > 20) out.push("Cracked ribs"); else if (d.chest > 7) out.push("Bruised ribs");
    if (d.pelvis > 14) out.push("Bruised tailbone");
    if (arm > 18) out.push("Dislocated shoulder"); else if (arm > 8) out.push("Sprained wrist");
    if (leg > 18) out.push("Twisted knee"); else if (leg > 8) out.push("Bruised shin");
    if (this.tears) out.push(`Torn clothes ×${this.tears}`);
    if (this.bruises && !out.length) out.push(`${this.bruises} bruises`);
    return out;
  }
}

export const litter: THREE.Object3D[] = [];
