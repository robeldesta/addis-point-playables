import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as P from "../../src/platform/platform";
import { Sfx } from "./sfx";

// Strike Lane: a 10-frame bowling game. Slide to line up, flick up to bowl,
// curve the flick to hook the ball. Pins use a small hand-made 2D physics model
// (circles for standing pins, capsules for fallen ones) so chain reactions happen.

const GAME_ID = "bowling";
const LANE_HALF = 0.53; // lane is 1.06 m wide
const GUTTER_W = 0.24;
const WALL_X = LANE_HALF + GUTTER_W;
const PIN_Z = -18.29; // head pin, measured from the foul line
const PIT_Z = PIN_Z - 1.0;
const BALL_R = 0.108;
const BALL_M = 7;
const PIN_M = 1.5;
const PIN_R = 0.06;
const PIN_H = 0.38;
const PIN_LEN = 0.3; // capsule length of a lying pin
const START_Z = -0.25;
const DT = 1 / 240;

type V2 = { x: number; z: number };
interface Pin {
  x: number; z: number; vx: number; vz: number;
  standing: boolean; tilt: number; dx: number; dz: number; spin: number;
  gone: boolean; drop: number; wob: number; wobT: number;
  mesh: THREE.Object3D; idx: number;
}
const ball = {
  x: 0, z: START_Z, vx: 0, vz: 0, hook: 0, gutter: false, active: false, inPit: false, y: BALL_R,
};

// ------------------------------------------------------------------
// Renderer, scene
// ------------------------------------------------------------------
P.initPlatform();
const host = document.getElementById("game")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120f1c);
scene.fog = new THREE.Fog(0x120f1c, 26, 48);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x3a2a1a, 0.9));
const key = new THREE.DirectionalLight(0xfff1dd, 1.8);
key.position.set(1.5, 6, -14);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 3, bottom: -3, near: 0.5, far: 20 });
key.shadow.bias = -0.0008;
scene.add(key, key.target);
// Warm light over the pin deck so the rack pops.
const deckLight = new THREE.PointLight(0xfff0d0, 6, 6, 1.6);
deckLight.position.set(0, 2.2, PIN_Z - 0.2);
scene.add(deckLight);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  // Narrow screens need a taller field of view to keep the lane width visible.
  camera.fov = aspect < 0.8 ? 58 : aspect < 1.3 ? 50 : 42;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------
// Textures (drawn on canvases, no image files)
// ------------------------------------------------------------------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const LANE_LEN = -PIT_Z + 0.2;
function laneTexture(markings: boolean) {
  return canvasTex(256, 4096, (g) => {
    const boards = 20;
    const bw = 256 / boards;
    for (let i = 0; i < boards; i++) {
      const l = 62 + Math.random() * 10;
      g.fillStyle = `hsl(${30 + Math.random() * 6}, ${50 + Math.random() * 10}%, ${l}%)`;
      g.fillRect(i * bw, 0, bw, 4096);
      // grain
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(120,70,20,${Math.random() * 0.08})`;
        g.fillRect(i * bw + Math.random() * bw, Math.random() * 4096, 1, 60 + Math.random() * 300);
      }
      g.fillStyle = "rgba(80,45,10,.35)";
      g.fillRect(i * bw, 0, 1, 4096);
    }
    if (!markings) return;
    const zToY = (z: number) => (1 - -z / LANE_LEN) * 4096; // canvas top is the far end
    // Foul line
    g.fillStyle = "#222";
    g.fillRect(0, zToY(-0.02), 256, 10);
    // Guide dots near the foul line, arrows at 4.6 m
    g.fillStyle = "#3a2a6a";
    for (let i = 2; i < boards; i += 3) {
      g.beginPath(); g.arc(i * bw + bw / 2, zToY(-2.1), 3.5, 0, Math.PI * 2); g.fill();
    }
    for (let i = 1; i <= 7; i++) {
      const bx = (i * 2.5 + 0.5) * bw;
      const depth = Math.abs(i - 4) * 18;
      const y = zToY(-4.6) + depth;
      g.beginPath();
      g.moveTo(bx, y - 34); g.lineTo(bx + 6, y); g.lineTo(bx - 6, y); g.closePath(); g.fill();
    }
    // Pin spots
    g.fillStyle = "rgba(60,30,10,.5)";
    for (const p of rackSpots()) {
      g.beginPath();
      g.ellipse(((p.x + LANE_HALF) / (LANE_HALF * 2)) * 256, zToY(p.z), 4, 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function rackSpots(): V2[] {
  const out: V2[] = [];
  for (let r = 0; r < 4; r++)
    for (let i = 0; i <= r; i++) out.push({ x: (i - r / 2) * 0.305, z: PIN_Z - r * 0.264 });
  return out;
}

// ------------------------------------------------------------------
// World geometry
// ------------------------------------------------------------------
const laneMatProps = { roughness: 0.18, metalness: 0, envMapIntensity: 1.2 };
function buildLane(cx: number, main: boolean) {
  const g = new THREE.Group();
  g.position.x = cx;
  const tex = laneTexture(true);
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE_HALF * 2, LANE_LEN),
    new THREE.MeshStandardMaterial({ map: tex, ...laneMatProps }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.z = -LANE_LEN / 2;
  lane.receiveShadow = main;
  g.add(lane);
  // Approach area behind the foul line
  const ap = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE_HALF * 2 + GUTTER_W * 2, 5),
    new THREE.MeshStandardMaterial({ map: laneTexture(false), color: 0xd9b48a, ...laneMatProps }),
  );
  ap.rotation.x = -Math.PI / 2;
  ap.position.set(0, -0.001, 2.5);
  g.add(ap);
  // Gutters
  const gutMat = new THREE.MeshStandardMaterial({ color: 0x6b6f82, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const gut = new THREE.Mesh(new THREE.CylinderGeometry(GUTTER_W / 2, GUTTER_W / 2, LANE_LEN, 16, 1, true, Math.PI / 2, Math.PI), gutMat);
    gut.rotation.x = Math.PI / 2;
    gut.position.set(s * (LANE_HALF + GUTTER_W / 2), 0, -LANE_LEN / 2);
    g.add(gut);
  }
  // Pit (dark hole behind the pin deck)
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(WALL_X * 2, 1.6), new THREE.MeshBasicMaterial({ color: 0x050308 }));
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(0, -0.005, PIT_Z - 0.8);
  g.add(pit);
  // Kickback side walls at the pin deck
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2245, roughness: 0.6 });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 3.2), wallMat);
    w.position.set(s * (WALL_X + 0.03), 0.35, PIN_Z - 0.7);
    g.add(w);
  }
  // Masking unit over the pin deck
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(WALL_X * 2 + 0.12, 0.6), new THREE.MeshBasicMaterial({ map: maskTex }));
  mask.position.set(0, 1.55, PIN_Z - 0.5);
  g.add(mask);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(WALL_X * 2 + 0.12, 0.85), new THREE.MeshStandardMaterial({ color: 0x0b0814 }));
  back.position.set(0, 0.4, PIT_Z - 1.4);
  g.add(back);
  scene.add(g);
  return g;
}

const maskTex = canvasTex(512, 256, (g) => {
  const grd = g.createLinearGradient(0, 0, 512, 256);
  grd.addColorStop(0, "#3b1d7a"); grd.addColorStop(0.5, "#b0247a"); grd.addColorStop(1, "#ff8a1e");
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = "rgba(255,255,255,.18)"; g.lineWidth = 14;
  for (let i = -6; i < 12; i++) { g.beginPath(); g.moveTo(i * 60, 256); g.lineTo(i * 60 + 160, 0); g.stroke(); }
  g.fillStyle = "#fff"; g.font = "900 64px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 8;
  g.fillText("STRIKE LANE", 256, 128);
});

// Ball return / divider between lanes, with a glowing strip.
const LANE_PITCH = WALL_X * 2 + 0.5;
for (const s of [-1, 1]) {
  for (let k = 0; k < 2; k++) {
    const x = s * (WALL_X + 0.25 + k * LANE_PITCH);
    const div = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, LANE_LEN + 4), new THREE.MeshStandardMaterial({ color: 0x241b3d, roughness: 0.7 }));
    div.position.set(x, 0.06, -LANE_LEN / 2 + 2);
    scene.add(div);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, LANE_LEN + 4), new THREE.MeshBasicMaterial({ color: k === 0 ? 0x3ad6ff : 0xff4fb0 }));
    glow.position.set(x, 0.125, -LANE_LEN / 2 + 2);
    scene.add(glow);
  }
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 60), new THREE.MeshStandardMaterial({ color: 0x1a1430, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -0.15, -20);
scene.add(floor);
// Ceiling light bars for depth
for (let i = 0; i < 6; i++) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 2.4), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x3ad6ff : 0xff4fb0 }));
  bar.position.set((i % 2 ? 1 : -1) * 2.2, 2.6, -4 - i * 2.6);
  scene.add(bar);
}

buildLane(0, true);
for (const s of [-1, 1]) for (let k = 1; k <= 2; k++) buildLane(s * k * LANE_PITCH, false);

// ------------------------------------------------------------------
// Pins and ball meshes
// ------------------------------------------------------------------
const pinProfile = [
  [0.0, 0], [0.026, 0], [0.034, 0.02], [0.052, 0.07], [0.06, 0.115], [0.056, 0.16], [0.042, 0.21],
  [0.026, 0.25], [0.023, 0.27], [0.027, 0.3], [0.032, 0.33], [0.03, 0.355], [0.02, 0.372], [0.0, 0.38],
].map(([r, y]) => new THREE.Vector2(r, y));
const pinGeo = new THREE.LatheGeometry(pinProfile, 20);
const pinTex = canvasTex(4, 256, (g) => {
  g.fillStyle = "#fbfbf6"; g.fillRect(0, 0, 4, 256);
  g.fillStyle = "#d81f26";
  // Lathe v runs along the profile points, so stripes sit around the neck.
  g.fillRect(0, 256 * (1 - 0.66), 4, 9);
  g.fillRect(0, 256 * (1 - 0.6), 4, 9);
});
pinTex.flipY = true;
const pinMat = new THREE.MeshPhysicalMaterial({ map: pinTex, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });

function makePinMesh() {
  const m = new THREE.Mesh(pinGeo, pinMat);
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

// Decorative racks on the neighbouring lanes.
for (const s of [-1, 1]) for (let k = 1; k <= 2; k++) {
  for (const p of rackSpots()) {
    const pm = makePinMesh();
    pm.position.set(p.x + s * k * LANE_PITCH, 0, p.z);
    scene.add(pm);
  }
}

const BALL_COLORS = [
  ["#1e3cff", "#00d4ff"], ["#c2185b", "#ff8a65"], ["#2e7d32", "#c6ff00"], ["#4a148c", "#ea80fc"], ["#212121", "#ff9800"],
];
function ballTexture(c1: string, c2: string) {
  return canvasTex(512, 256, (g) => {
    g.fillStyle = c1; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = i % 3 === 0 ? c2 : `rgba(255,255,255,${0.05 + Math.random() * 0.12})`;
      g.globalAlpha = 0.5 + Math.random() * 0.5;
      g.lineWidth = 2 + Math.random() * 7;
      g.beginPath();
      const y = Math.random() * 256;
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 50 + i) * 30 + Math.random() * 8);
      g.stroke();
    }
    g.globalAlpha = 1;
    // Finger holes
    g.fillStyle = "#0a0a0a";
    for (const [x, y, r] of [[250, 70, 11], [280, 70, 11], [265, 110, 14]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  });
}
let ballStyle = 0;
const ballMat = new THREE.MeshPhysicalMaterial({ roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
function setBallStyle(i: number) {
  ballStyle = i;
  ballMat.map?.dispose();
  ballMat.map = ballTexture(BALL_COLORS[i][0], BALL_COLORS[i][1]);
  ballMat.needsUpdate = true;
}
setBallStyle(Math.floor(Math.random() * BALL_COLORS.length));
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), ballMat);
ballMesh.castShadow = true;
ballMesh.rotation.set(0.3, 0.2, 0);
scene.add(ballMesh);

// Aim arrow shown while flicking.
const aimTex = canvasTex(64, 256, (g) => {
  const grd = g.createLinearGradient(0, 256, 0, 0);
  grd.addColorStop(0, "rgba(255,210,60,0)"); grd.addColorStop(0.3, "rgba(255,210,60,.85)"); grd.addColorStop(1, "rgba(255,240,150,1)");
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(22, 256); g.lineTo(22, 60); g.lineTo(4, 60); g.lineTo(32, 0); g.lineTo(60, 60); g.lineTo(42, 60); g.lineTo(42, 256); g.fill();
});
const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 2.4), new THREE.MeshBasicMaterial({ map: aimTex, transparent: true, depthWrite: false }));
aim.rotation.order = "YXZ";
aim.visible = false;
scene.add(aim);

// ------------------------------------------------------------------
// Pins: state
// ------------------------------------------------------------------
const pins: Pin[] = rackSpots().map((p, idx) => {
  const mesh = makePinMesh();
  scene.add(mesh);
  return { x: p.x, z: p.z, vx: 0, vz: 0, standing: true, tilt: 0, dx: 0, dz: -1, spin: 0, gone: false, drop: 0, wob: 0, wobT: 0, mesh, idx };
});

function resetRack() {
  const spots = rackSpots();
  for (const p of pins) {
    const s = spots[p.idx];
    Object.assign(p, { x: s.x, z: s.z, vx: 0, vz: 0, standing: true, tilt: 0, spin: 0, gone: false, drop: 0, wob: 0 });
    p.mesh.visible = true;
    p.mesh.scale.setScalar(1);
  }
}
const standingCount = () => pins.filter((p) => p.standing && !p.gone).length;

// ------------------------------------------------------------------
// Physics
// ------------------------------------------------------------------
function closestOnSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): V2 {
  const ex = bx - ax, ez = bz - az;
  const l2 = ex * ex + ez * ez;
  if (l2 < 1e-9) return { x: ax, z: az };
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2));
  return { x: ax + ex * t, z: az + ez * t };
}
function pinSeg(p: Pin): [number, number, number, number] {
  const l = PIN_LEN * Math.sin(p.tilt);
  return [p.x, p.z, p.x + p.dx * l, p.z + p.dz * l];
}
const pinRad = (p: Pin) => (p.tilt > 0.6 ? 0.05 : PIN_R);

type Body = { x: number; z: number; vx: number; vz: number };
/** Resolve contact between two bodies given their closest points. Returns the speed change given to b. */
function collide(a: Body, ia: number, pa: V2, ra: number, b: Body, ib: number, pb: V2, rb: number, e: number): number {
  let nx = pa.x - pb.x, nz = pa.z - pb.z;
  const d = Math.hypot(nx, nz);
  if (d >= ra + rb) return 0;
  if (d < 1e-6) { nx = Math.random() - 0.5; nz = 0.5; } else { nx /= d; nz /= d; }
  const pen = ra + rb - d;
  const tot = ia + ib;
  a.x += nx * pen * (ia / tot); a.z += nz * pen * (ia / tot);
  b.x -= nx * pen * (ib / tot); b.z -= nz * pen * (ib / tot);
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (vn >= 0) return 0;
  const j = (-(1 + e) * vn) / tot;
  a.vx += j * ia * nx; a.vz += j * ia * nz;
  b.vx -= j * ib * nx; b.vz -= j * ib * nz;
  // A little scatter so racks never fall the same way twice.
  const kick = j * ib * (Math.random() - 0.5) * 0.35;
  b.vx += -nz * kick; b.vz += nx * kick;
  return j * ib;
}

function knock(p: Pin, dv: number) {
  if (dv <= 0.02) return;
  if (p.standing && p.tilt === 0) {
    if (dv > 0.3) {
      p.standing = false;
      const s = Math.hypot(p.vx, p.vz) || 1;
      const a = Math.atan2(p.vx / s, p.vz / s) + (Math.random() - 0.5) * 0.9;
      p.dx = Math.sin(a); p.dz = Math.cos(a);
      p.spin = (Math.random() - 0.5) * 8;
    } else {
      p.wob = Math.min(0.25, dv * 0.8); p.wobT = 0;
    }
  }
  sfx.hit(Math.min(1, dv / 4));
  hitCount++;
}

let hitCount = 0;
function step(dt: number) {
  // Ball
  if (ball.active && !ball.inPit) {
    const sp = Math.hypot(ball.vx, ball.vz);
    const progress = Math.min(1, -ball.z / -PIN_Z);
    if (!ball.gutter) {
      // Hook kicks in on the back half of the lane, like a real ball leaving the oil.
      const k = smooth(0.3, 0.8, progress);
      ball.vx += ball.hook * k * dt;
      if (Math.abs(ball.x) > LANE_HALF - BALL_R * 0.3 && ball.z > PIN_Z + 0.2) {
        ball.gutter = true;
        sfx.thud();
      }
    }
    if (ball.gutter) {
      const side = Math.sign(ball.x) || 1;
      ball.x += (side * (LANE_HALF + GUTTER_W / 2) - ball.x) * Math.min(1, dt * 12);
      ball.vx = 0;
      ball.y += (BALL_R - 0.07 - ball.y) * Math.min(1, dt * 10);
    }
    const dec = sp > 0.01 ? Math.max(0, sp - 0.12 * dt) / sp : 0;
    ball.vx *= dec; ball.vz *= dec;
    ball.x += ball.vx * dt; ball.z += ball.vz * dt;
    if (ball.z < PIT_Z - 0.15) {
      ball.inPit = true;
      sfx.thud();
    }
  }
  // Pins
  for (const p of pins) {
    if (p.gone) continue;
    if (!p.standing && p.tilt < Math.PI / 2) p.tilt = Math.min(Math.PI / 2, p.tilt + dt * (3 + p.tilt * 9));
    if (!p.standing && p.spin) {
      const a = p.spin * dt;
      const c = Math.cos(a), s = Math.sin(a);
      const dx = p.dx * c - p.dz * s;
      p.dz = p.dx * s + p.dz * c; p.dx = dx;
      p.spin *= Math.exp(-dt * 2);
    }
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 0) {
      const decel = p.standing ? 5 : 2.2;
      const f = Math.max(0, sp - decel * dt) / sp;
      p.vx *= f; p.vz *= f;
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (p.wob > 0) { p.wobT += dt; p.wob *= Math.exp(-dt * 3); if (p.wob < 0.005) p.wob = 0; }
    // Kickback walls on the deck bounce pins back into play.
    if (p.z < PIN_Z + 1.5 && Math.abs(p.x) > WALL_X - 0.05) {
      p.x = Math.sign(p.x) * (WALL_X - 0.05);
      if (Math.sign(p.vx) === Math.sign(p.x)) { p.vx *= -0.5; sfx.hit(0.3); }
    }
    if (p.standing && Math.abs(p.x) > LANE_HALF) knock(p, 1); // tipped into the gutter
    if (p.z < PIT_Z) { p.gone = true; p.standing = false; }
  }
  // Ball vs pins
  if (ball.active && !ball.gutter && !ball.inPit) {
    for (const p of pins) {
      if (p.gone) continue;
      const [ax, az, bx, bz] = pinSeg(p);
      const cp = closestOnSeg(ball.x, ball.z, ax, az, bx, bz);
      const dv = collide(ball, 1 / BALL_M, { x: ball.x, z: ball.z }, BALL_R, p, 1 / PIN_M, cp, pinRad(p), 0.5);
      knock(p, dv);
    }
  }
  // Pin vs pin
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i];
    if (a.gone) continue;
    for (let j = i + 1; j < pins.length; j++) {
      const b = pins[j];
      if (b.gone) continue;
      if (Math.abs(a.x - b.x) > 0.75 || Math.abs(a.z - b.z) > 0.75) continue;
      const sa = pinSeg(a), sb = pinSeg(b);
      // Closest points between two segments: best of the four endpoint tests.
      let best = Infinity, pa: V2 = { x: a.x, z: a.z }, pb: V2 = { x: b.x, z: b.z };
      const tryPair = (p: V2, q: V2) => {
        const d = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
        if (d < best) { best = d; pa = p; pb = q; }
      };
      for (const e of [{ x: sa[0], z: sa[1] }, { x: sa[2], z: sa[3] }]) tryPair(e, closestOnSeg(e.x, e.z, sb[0], sb[1], sb[2], sb[3]));
      for (const e of [{ x: sb[0], z: sb[1] }, { x: sb[2], z: sb[3] }]) tryPair(closestOnSeg(e.x, e.z, sa[0], sa[1], sa[2], sa[3]), e);
      const va = Math.hypot(a.vx, a.vz), vb = Math.hypot(b.vx, b.vz);
      const dv = collide(a, 1 / PIN_M, pa, pinRad(a), b, 1 / PIN_M, pb, pinRad(b), 0.6);
      if (dv > 0) {
        knock(b, dv);
        knock(a, Math.abs(Math.hypot(a.vx, a.vz) - va) + (vb > va ? dv * 0.6 : 0));
      }
    }
  }
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------
// Rendering sync
// ------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const tmpAxis = new THREE.Vector3();
function syncMeshes(dt: number) {
  for (const p of pins) {
    const m = p.mesh;
    if (p.gone) {
      p.drop += dt;
      m.position.y = -p.drop * 2;
      if (p.drop > 0.6) m.visible = false;
    } else {
      const gutterDrop = Math.abs(p.x) > LANE_HALF + 0.02 ? -0.07 : 0;
      m.position.set(p.x, PIN_R * Math.sin(p.tilt) * 0.85 + gutterDrop, p.z);
    }
    m.position.x = p.x; m.position.z = p.z;
    let tilt = p.tilt, dx = p.dx, dz = p.dz;
    if (p.wob > 0) { tilt = Math.sin(p.wobT * 18) * p.wob; dx = 0; dz = -1; }
    tmpAxis.set(dz, 0, -dx);
    if (tmpAxis.lengthSq() < 1e-6) tmpAxis.set(1, 0, 0);
    m.quaternion.setFromAxisAngle(tmpAxis.normalize(), tilt);
  }
  ballMesh.visible = !ball.inPit;
  ballMesh.position.set(ball.x, ball.y, ball.z);
  const sp = Math.hypot(ball.vx, ball.vz);
  if (sp > 0.01 && !ball.gutter) {
    tmpAxis.set(ball.vz, 0, -ball.vx).normalize();
    ballMesh.rotateOnWorldAxis(tmpAxis, (sp * dt) / BALL_R);
    // Side spin from the hook
    ballMesh.rotateOnWorldAxis(UP, ball.hook * dt * 3);
  } else if (ball.gutter && sp > 0.01) {
    tmpAxis.set(-1, 0, 0);
    ballMesh.rotateOnWorldAxis(tmpAxis, (sp * dt) / BALL_R);
  }
}

// ------------------------------------------------------------------
// Camera
// ------------------------------------------------------------------
const camPos = new THREE.Vector3(0, 1.3, 2.4);
const camLook = new THREE.Vector3(0, 0, -10);
const tPos = new THREE.Vector3();
const tLook = new THREE.Vector3();
let shake = 0;
function updateCamera(dt: number) {
  const portrait = camera.aspect < 0.8;
  if (state === "aim" || state === "intro" || state === "over") {
    tPos.set(ball.x * 0.5, portrait ? 2.1 : 1.5, portrait ? 2.6 : 2.3);
    tLook.set(ball.x * 0.15, 0, portrait ? -5.5 : -8);
  } else {
    const bz = ball.inPit ? PIT_Z : ball.z;
    const z = Math.max(bz + 2.8, PIN_Z + (portrait ? 3.3 : 2.8));
    const near = smooth(-6, PIN_Z + 4, bz);
    tPos.set(ball.x * 0.35 * (1 - near), (portrait ? 1.6 : 1.2) - near * 0.2, z);
    tLook.set(ball.x * 0.2 * (1 - near), 0.05, Math.max(bz - 7, PIN_Z - 0.4));
  }
  const k = 1 - Math.exp(-dt * (state === "rolling" ? 7 : 4));
  camPos.lerp(tPos, k);
  camLook.lerp(tLook, k);
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 6);
    if (shake < 0.001) shake = 0;
  }
  camera.lookAt(camLook);
  key.target.position.set(0, 0, Math.max(ball.z - 1, PIN_Z - 0.5));
  key.position.set(1.2, 6, key.target.position.z + 2);
}

// ------------------------------------------------------------------
// Game flow and scoring
// ------------------------------------------------------------------
type State = "intro" | "aim" | "rolling" | "settle" | "over";
let state: State = "intro";
let frames: number[][] = [[]];
let standingBefore = 10;
let rollTime = 0;
let quiet = 0;
let settleT = 0;
let best = 0;
let gamesPlayed = 0;
let paused = false;
const sfx = new Sfx();

function totals(fr: number[][]): (number | null)[] {
  const flat = fr.flat();
  const out: (number | null)[] = [];
  let i = 0, sum = 0, broken = false;
  for (let f = 0; f < 10; f++) {
    const r = fr[f];
    if (broken || !r || r.length === 0) { out.push(null); broken = true; continue; }
    let add: number | undefined;
    if (f < 9) {
      if (r[0] === 10) add = flat[i + 1] !== undefined && flat[i + 2] !== undefined ? 10 + flat[i + 1] + flat[i + 2] : undefined;
      else if (r.length < 2) add = undefined;
      else if (r[0] + r[1] === 10) add = flat[i + 2] !== undefined ? 10 + flat[i + 2] : undefined;
      else add = r[0] + r[1];
    } else {
      add = tenthDone(r) ? r.reduce((a, b) => a + b, 0) : undefined;
    }
    if (add === undefined) { out.push(null); broken = true; continue; }
    sum += add;
    out.push(sum);
    i += r.length;
  }
  return out;
}
function tenthDone(r: number[]) {
  if (r.length === 3) return true;
  return r.length === 2 && r[0] + r[1] < 10;
}
function marks(f: number, r: number[]): string[] {
  const num = (n: number) => (n === 0 ? "-" : String(n));
  if (f < 9) {
    if (r[0] === 10) return ["", "X"];
    const out = r.map(num);
    if (r.length === 2 && r[0] + r[1] === 10) out[1] = "/";
    return out;
  }
  const out: string[] = [];
  for (let k = 0; k < r.length; k++) {
    const fresh = k === 0 || (k === 1 && r[0] === 10) || (k === 2 && (r[1] === 10 && r[0] === 10 || (r[0] !== 10 && r[0] + r[1] === 10)));
    if (fresh) out.push(r[k] === 10 ? "X" : num(r[k]));
    else out.push(r[k - 1] + r[k] === 10 ? "/" : num(r[k]));
  }
  return out;
}

const boardEl = document.getElementById("board")!;
const infoEl = document.getElementById("info")!;
const hintEl = document.getElementById("hint")!;
const bigEl = document.getElementById("big")!;
const overEl = document.getElementById("over")!;
function renderBoard() {
  const tot = totals(frames);
  const cur = frames.length - 1;
  let html = "";
  for (let f = 0; f < 10; f++) {
    const r = frames[f] ?? [];
    const m = marks(f, r);
    const slots = f < 9 ? 2 : 3;
    while (m.length < slots) m.push("");
    html += `<div class="fr${f === 9 ? " ten" : ""}${f === cur && state !== "over" ? " cur" : ""}"><div class="n">${f + 1}</div><div class="r">${m
      .map((s) => `<span class="${s === "X" || s === "/" ? "x" : ""}">${s}</span>`)
      .join("")}</div><div class="t">${tot[f] ?? ""}</div></div>`;
  }
  boardEl.innerHTML = html;
  const shown = tot.filter((t) => t !== null).pop() ?? 0;
  infoEl.textContent = state === "over" ? `Final ${shown} · Best ${best}` : `Frame ${Math.min(10, frames.length)} · Score ${shown} · Best ${best}`;
}

function showBig(text: string, small = false) {
  bigEl.textContent = text;
  bigEl.className = "";
  void bigEl.offsetWidth;
  bigEl.className = small ? "show small" : "show";
}

function resetBall() {
  Object.assign(ball, { x: 0, z: START_Z, vx: 0, vz: 0, hook: 0, gutter: false, active: false, inPit: false, y: BALL_R });
  ballMesh.visible = true;
}

function newGame() {
  frames = [[]];
  resetRack();
  resetBall();
  standingBefore = 10;
  state = "aim";
  overEl.classList.remove("show");
  hintEl.classList.add("show");
  renderBoard();
}

function bowl(xStart: number, angle: number, speed: number, hook: number) {
  if (state !== "aim") return;
  ball.x = Math.max(-LANE_HALF + BALL_R, Math.min(LANE_HALF - BALL_R, xStart));
  ball.vx = Math.sin(angle) * speed;
  ball.vz = -Math.cos(angle) * speed;
  ball.hook = hook;
  ball.active = true;
  state = "rolling";
  rollTime = 0;
  quiet = 0;
  hitCount = 0;
  standingBefore = standingCount();
  hintEl.classList.remove("show");
  sfx.swoosh();
}

function endRoll() {
  const down = standingBefore - standingCount();
  const fi = frames.length - 1;
  const r = frames[fi];
  r.push(down);
  const tenth = fi === 9;
  let label = "";
  let small = true;
  const rackClear = standingCount() === 0;
  if (rackClear && (r.length === 1 || (tenth && freshRack(r)))) { label = "STRIKE!"; small = false; sfx.strike(); shake = 0.05; }
  else if (rackClear) { label = "SPARE!"; small = false; sfx.spare(); shake = 0.03; }
  else if (down === 0) { label = ball.gutter ? "Gutter ball" : "Miss"; sfx.sad(); }
  else label = `${down} pin${down === 1 ? "" : "s"}`;
  showBig(label, small);

  let next: "keep" | "rack" | "frame" | "over";
  if (!tenth) next = r[0] === 10 || r.length === 2 ? "frame" : "keep";
  else if (tenthDone(r)) next = "over";
  else next = rackClear ? "rack" : "keep";

  state = "settle";
  settleT = 0;
  pendingNext = next;
  renderBoard();
}
// In the 10th frame, was the roll just made on a full rack?
function freshRack(r: number[]) {
  const k = r.length - 1;
  if (k === 0) return true;
  if (k === 1) return r[0] === 10;
  return (r[0] === 10 && r[1] === 10) || (r[0] !== 10 && r[0] + r[1] === 10);
}
let pendingNext: "keep" | "rack" | "frame" | "over" = "keep";

function finishSettle() {
  if (pendingNext === "over") {
    const final = totals(frames)[9] ?? 0;
    gamesPlayed++;
    const isBest = final > best;
    if (isBest) best = final;
    void P.save(GAME_ID, JSON.stringify({ best, gamesPlayed, ballStyle }));
    P.sendScore(best);
    state = "over";
    document.getElementById("final")!.textContent = String(final);
    document.getElementById("bestline")!.textContent = `Best: ${best}`;
    document.getElementById("newbest")!.textContent = isBest && gamesPlayed > 1 ? "New best!" : isBest ? "" : "";
    overEl.classList.add("show");
    renderBoard();
    return;
  }
  if (pendingNext === "frame") frames.push([]);
  // Sweep away knocked pins.
  for (const p of pins) if (!p.standing) { p.gone = true; p.mesh.visible = false; }
  if (pendingNext !== "keep") resetRack();
  // Standing pins that slid stay where they are, but stop moving.
  for (const p of pins) { p.vx = 0; p.vz = 0; p.wob = 0; }
  resetBall();
  state = "aim";
  if (frames.length === 1 && frames[0].length === 0) hintEl.classList.add("show");
  renderBoard();
}

// ------------------------------------------------------------------
// Input: slide sideways to line up, flick up to bowl, curve to hook
// ------------------------------------------------------------------
type Pt = { x: number; y: number; t: number };
let pts: Pt[] = [];
let ptrId: number | null = null;
let startBallX = 0;
let swipeFrom = -1;
window.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  if (state !== "aim" || ptrId !== null) return;
  if ((e.target as HTMLElement).closest("button")) return;
  ptrId = e.pointerId;
  pts = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
  startBallX = ball.x;
  swipeFrom = -1;
});
window.addEventListener("pointermove", (e) => {
  if (e.pointerId !== ptrId || state !== "aim") return;
  const p = { x: e.clientX, y: e.clientY, t: performance.now() };
  pts.push(p);
  const w = window.innerWidth, h = window.innerHeight;
  if (swipeFrom < 0) {
    const up = pts[0].y - p.y;
    if (up > Math.min(28, h * 0.04)) {
      swipeFrom = pts.length - 2;
    } else {
      const lim = LANE_HALF - BALL_R;
      ball.x = Math.max(-lim, Math.min(lim, startBallX + ((p.x - pts[0].x) / Math.min(w, h * 0.7)) * 1.3));
    }
  }
  if (swipeFrom >= 0) {
    const s = readSwipe();
    aim.visible = true;
    aim.position.set(ball.x, 0.004, ball.z - 1.4);
    aim.rotation.set(-Math.PI / 2, 0, 0);
    aim.rotation.y = -s.angle;
    aim.position.x = ball.x + Math.sin(s.angle) * 1.4;
    aim.position.z = ball.z - Math.cos(s.angle) * 1.4;
  }
});
function readSwipe() {
  const a = pts[Math.max(0, swipeFrom)], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dx, -dy) * 0.085;
  // Bulge of the path away from the straight chord gives hook (curve right, ball hooks left).
  let bulge = 0;
  for (let i = swipeFrom; i < pts.length; i++) {
    const q = pts[i];
    const cross = ((q.x - a.x) * dy - (q.y - a.y) * dx) / len;
    if (Math.abs(cross) > Math.abs(bulge)) bulge = cross;
  }
  const hook = Math.max(-1, Math.min(1, (bulge / len) * 4)) * 1.6;
  return { angle, hook, len, dy };
}
function endPointer(e: PointerEvent) {
  if (e.pointerId !== ptrId) return;
  ptrId = null;
  aim.visible = false;
  if (state !== "aim" || swipeFrom < 0) return;
  const s = readSwipe();
  const h = window.innerHeight;
  if (-s.dy < h * 0.08) return; // too short to count
  // Speed from the last 120 ms of the flick.
  const now = pts[pts.length - 1];
  let i = pts.length - 1;
  while (i > swipeFrom && now.t - pts[i].t < 120) i--;
  const ref = pts[i];
  const dt = Math.max(16, now.t - ref.t) / 1000;
  const vy = (ref.y - now.y) / dt / h; // screen heights per second
  const speed = Math.max(5, Math.min(10.5, 4.5 + vy * 1.3));
  bowl(ball.x, s.angle, speed, s.hook);
}
window.addEventListener("pointerup", endPointer);
window.addEventListener("pointercancel", endPointer);
document.getElementById("again")!.addEventListener("click", () => { sfx.unlock(); sfx.click(); newGame(); });

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
let last = performance.now();
let acc = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) return;
  if (state === "rolling" || state === "settle") {
    acc += dt;
    while (acc >= DT) { step(DT); acc -= DT; }
  } else acc = 0;
  if (state === "rolling") {
    rollTime += dt;
    const moving = pins.some((p) => !p.gone && (Math.hypot(p.vx, p.vz) > 0.05 || (!p.standing && p.tilt < Math.PI / 2)));
    const ballDone = ball.inPit || Math.hypot(ball.vx, ball.vz) < 0.2;
    quiet = ballDone && !moving ? quiet + dt : 0;
    if (quiet > 0.6 || rollTime > 9) endRoll();
  } else if (state === "settle") {
    settleT += dt;
    if (settleT > 1.5) finishSettle();
  }
  sfx.setRoll(ball.active && !ball.inPit ? Math.hypot(ball.vx, ball.vz) / 22 : 0);
  syncMeshes(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

P.onPause(() => { paused = true; sfx.suspend(); });
P.onResume(() => { paused = false; last = performance.now(); sfx.resume(); });
P.onAudioChange((on) => { sfx.enabled = on; });
sfx.enabled = P.isAudioEnabled();

renderBoard();
renderer.render(scene, camera);
P.firstFrameReady();
requestAnimationFrame(frame);

void P.loadSave(GAME_ID).then((raw) => {
  try {
    const d = raw ? JSON.parse(raw) : {};
    best = d.best ?? 0;
    gamesPlayed = d.gamesPlayed ?? 0;
  } catch { /* fresh start */ }
  newGame();
  P.gameReady();
});

// Test hook for automated playtests (only with ?debug in the URL).
if (location.search.includes("debug")) {
  (window as unknown as { bowl: unknown }).bowl = {
    bowl, get state() { return state; }, get frames() { return frames; }, totals: () => totals(frames),
    standing: standingCount, ball, pins,
  };
}
