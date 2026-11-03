import * as THREE from "three";
import * as P from "../../src/platform/platform";
import { Sfx } from "./sfx";
import { R, Hit, scoreAt, spot, boardCanvas } from "./board";
import { GameId, GAMES, checkout, x01Target, isBust, CRICKET_NUMS, cricketIdx, markSym } from "./rules";

const GAME_ID = "darts";
const ROUNDS = 10; // Score Attack length, 3 darts each
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const $ = (id: string) => document.getElementById(id)!;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Rivals get steadier as you climb. sigma = spread of their throws in metres.
const RIVALS = [
  { name: "Rookie Rami", sigma: 0.045, col: "#64b5f6", tag: "Just here for the snacks" },
  { name: "Steady Sofia", sigma: 0.033, col: "#81c784", tag: "Never rushes a throw" },
  { name: "Big Ben", sigma: 0.025, col: "#ffb74d", tag: "Loves the 20 bed" },
  { name: "Lucky Lin", sigma: 0.019, col: "#ba68c8", tag: "Somehow always checks out" },
  { name: "Iron Ada", sigma: 0.0135, col: "#e57373", tag: "Cold as steel" },
  { name: "The Champ", sigma: 0.0095, col: "#f5c542", tag: "Undefeated. So far." },
];

// ------------------------------------------------------------------
// Renderer, scene
// ------------------------------------------------------------------
P.initPlatform();
const sfx = new Sfx();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("game").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a120d);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
let camDist = 1.4;

scene.add(new THREE.HemisphereLight(0xfff1dd, 0x3a2416, 0.9));
const lamp = new THREE.SpotLight(0xfff0d0, 6, 3, 0.75, 0.55, 1.2);
lamp.position.set(0, 0.55, 0.75);
lamp.target.position.set(0, -0.02, 0);
lamp.castShadow = true;
lamp.shadow.mapSize.set(1024, 1024);
lamp.shadow.bias = -0.0004;
lamp.shadow.camera.near = 0.2;
lamp.shadow.camera.far = 2;
scene.add(lamp, lamp.target);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Wood-panel wall
const wallTex = canvasTex(1024, 1024, (g) => {
  const w = 128;
  for (let i = 0; i < 8; i++) {
    const l = 26 + Math.random() * 10;
    g.fillStyle = `hsl(24, 42%, ${l}%)`;
    g.fillRect(i * w, 0, w, 1024);
    for (let n = 0; n < 60; n++) {
      g.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
      g.lineWidth = 1 + Math.random() * 2;
      const x = i * w + Math.random() * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + 10, 300, x - 10, 700, x + 4, 1024);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(i * w, 0, 4, 1024);
  }
});
wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
wallTex.repeat.set(3, 3);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 }));
wall.position.z = -0.06;
wall.receiveShadow = true;
scene.add(wall);

// Cabinet behind the board, with open chalkboard doors
const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2a16, roughness: 0.6 });
const cab = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.66, 0.03), woodMat);
cab.position.z = -0.045;
cab.receiveShadow = true;
scene.add(cab);
const chalk = canvasTex(256, 512, (g) => {
  g.fillStyle = "#24302a";
  g.fillRect(0, 0, 256, 512);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 3;
  g.strokeRect(14, 14, 228, 484);
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = "bold 30px Arial";
  g.textAlign = "center";
  g.fillText("HOME", 70, 60);
  g.fillText("AWAY", 186, 60);
  g.beginPath(); g.moveTo(128, 30); g.lineTo(128, 480); g.stroke();
  g.beginPath(); g.moveTo(24, 76); g.lineTo(232, 76); g.stroke();
  g.font = "26px Arial";
  let a = 301, b = 301;
  for (let i = 0; i < 9; i++) {
    a -= 20 + Math.floor(Math.random() * 60); b -= 20 + Math.floor(Math.random() * 60);
    if (a < 0 || b < 0) break;
    g.fillText(String(a), 70, 116 + i * 40);
    g.fillText(String(b), 186, 116 + i * 40);
  }
});
for (const s of [-1, 1]) {
  const door = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.66, 0.02), woodMat);
  panel.position.x = s * 0.165;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.6), new THREE.MeshStandardMaterial({ map: chalk, roughness: 1 }));
  board.position.set(s * 0.165, 0, 0.011);
  door.add(panel, board);
  door.position.set(s * 0.33, 0, -0.03);
  door.rotation.y = s * -0.35;
  scene.add(door);
}

// Catch ring and board
const ring = new THREE.Mesh(
  new THREE.CylinderGeometry(0.29, 0.29, 0.03, 64).rotateX(Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
);
ring.position.z = -0.03;
ring.receiveShadow = true;
scene.add(ring);
const boardTex = new THREE.CanvasTexture(boardCanvas(2048));
boardTex.colorSpace = THREE.SRGBColorSpace;
boardTex.anisotropy = 8;
const boardBody = new THREE.Mesh(
  new THREE.CylinderGeometry(R.numbers, R.numbers, 0.04, 96).rotateX(Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.8 }),
);
boardBody.position.z = -0.0205;
boardBody.castShadow = true;
scene.add(boardBody);
const face = new THREE.Mesh(new THREE.CircleGeometry(R.numbers, 128), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.9 }));
face.receiveShadow = true;
scene.add(face);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return; // Playables may load us in a zero-size view
  renderer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // Fit the whole board, leaving room for the HUD above and below.
  camDist = Math.max(0.33 / t, 0.255 / (t * aspect));
  camera.position.set(0, -0.05, camDist);
  camera.lookAt(0, -0.025, 0);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------
// Darts
// ------------------------------------------------------------------
function makeDart(flight: number, shaft: number): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.8, roughness: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x5d646b, metalness: 0.7, roughness: 0.45 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number) => {
    const m = new THREE.Mesh(geo.rotateX(Math.PI / 2), mat);
    m.position.z = z;
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.ConeGeometry(0.0016, 0.028, 8).rotateX(Math.PI), metal, 0.014);
  add(new THREE.CylinderGeometry(0.0034, 0.0042, 0.048, 12), grip, 0.052);
  for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.0043, 0.0043, 0.003, 12), metal, 0.036 + i * 0.01);
  add(new THREE.CylinderGeometry(0.0022, 0.0026, 0.042, 8), new THREE.MeshStandardMaterial({ color: shaft, roughness: 0.4 }), 0.097);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.017, 0.014);
  shape.lineTo(0.017, 0.036);
  shape.lineTo(0, 0.04);
  shape.closePath();
  const fm = new THREE.MeshStandardMaterial({ color: flight, roughness: 0.5, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.ShapeGeometry(shape), fm);
    f.rotation.x = Math.PI / 2;
    f.rotation.order = "ZXY";
    f.rotation.z = (i * Math.PI) / 2;
    f.position.z = 0.09;
    f.castShadow = true;
    g.add(f);
  }
  return g;
}

interface Flying {
  obj: THREE.Group;
  s: THREE.Vector3;
  e: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  hit: Hit;
  spin: number;
}
const flying: Flying[] = [];
const stuck: THREE.Group[] = [];
const Z = V(0, 0, 1);

function launch(x: number, y: number, who: 0 | 1) {
  const hit = scoreAt(x, y);
  const r = Math.hypot(x, y);
  const z = hit.onBoard ? 0.004 : r < 0.29 ? -0.012 : -0.056;
  const obj = who === 0 ? makeDart(0xd23a2c, 0xf5c542) : makeDart(new THREE.Color(RIVALS[level].col).getHex(), 0x222222);
  scene.add(obj);
  const side = who === 0 ? 0.11 : -0.11;
  const s = V(side, -0.32, Math.min(camDist - 0.25, 1.1));
  flying.push({ obj, s, e: V(x, y, z), t: 0, dur: 0.3, arc: 0.07, hit, spin: Math.random() * 6 });
  sfx.whoosh();
}

const tmp = V(), vel = V();
function updateFlying(dt: number) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.t = Math.min(1, f.t + dt / f.dur);
    const t = f.t;
    tmp.lerpVectors(f.s, f.e, t);
    tmp.y += f.arc * 4 * t * (1 - t);
    f.obj.position.copy(tmp);
    vel.subVectors(f.e, f.s);
    vel.y += f.arc * 4 * (1 - 2 * t);
    f.obj.quaternion.setFromUnitVectors(Z, vel.normalize().negate());
    f.obj.rotateZ(f.spin + t * 8);
    if (t >= 1) {
      flying.splice(i, 1);
      stuck.push(f.obj);
      landed(f.hit, f.e);
    }
  }
}

function clearDarts() {
  for (const d of stuck) scene.remove(d);
  stuck.length = 0;
}

// ------------------------------------------------------------------
// Aim reticle and the hand's sway
// ------------------------------------------------------------------
const ret = new THREE.Group();
const retRingMat = new THREE.MeshBasicMaterial({ color: 0x7cff8a, transparent: true, opacity: 0.9, depthTest: false });
const retRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), retRingMat);
const retDot = new THREE.Mesh(new THREE.CircleGeometry(0.003, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
const retCross = new THREE.Mesh(new THREE.RingGeometry(0.003, 0.0045, 16), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false }));
ret.add(retRing, retCross, retDot);
ret.renderOrder = 10;
ret.traverse((o) => (o.renderOrder = 10));
ret.position.z = 0.03;
ret.visible = false;
scene.add(ret);

const aim = { x: 0, y: 0.103 }; // where the player is pointing (starts on treble 20)
let aiming = false, steady = 0, holdT = 0, fingerSpeed = 0, swayAmp = 0.016;
let lastPx = 0, lastPy = 0, swayT = 0, lastMoveT = 0;
const phase = [0, 0, 0, 0].map(() => Math.random() * 10);
const hist: { t: number; x: number; y: number }[] = [];
const shown = { x: 0, y: 0 };

function sway(t: number) {
  return {
    x: swayAmp * (0.65 * Math.sin(1.25 * t + phase[0]) + 0.35 * Math.sin(2.9 * t + phase[1])),
    y: swayAmp * (0.65 * Math.cos(1.6 * t + phase[2]) + 0.35 * Math.sin(3.4 * t + phase[3])),
  };
}

function updateAim(dt: number) {
  swayT += dt;
  if (aiming) {
    holdT += dt;
    if (fingerSpeed < 80) steady = Math.min(1, steady + dt * 1.7);
    else steady = Math.max(0, steady - dt * fingerSpeed / 500);
    fingerSpeed *= Math.exp(-dt * 12);
  } else steady = Math.max(0, steady - dt * 2);
  const tired = clamp((holdT - 3) / 2.5, 0, 1);
  const goal = aiming ? 0.0165 - 0.0105 * steady + 0.016 * tired : 0.016;
  swayAmp += (goal - swayAmp) * Math.min(1, dt * 8);
  const w = sway(swayT);
  shown.x = aim.x + w.x;
  shown.y = aim.y + w.y;
  ret.position.set(shown.x, shown.y, 0.03);
  ret.visible = state === "aim";
  const rad = Math.max(0.01, swayAmp * 1.3);
  retRing.scale.setScalar(rad);
  const q = aiming ? steady * (1 - tired) : 0;
  retRingMat.color.setRGB(1 - q * 0.6, 0.45 + q * 0.55, 0.35 + q * 0.2);
  retRingMat.opacity = aiming ? 0.95 : 0.55;
  const now = performance.now();
  hist.push({ t: now, x: shown.x, y: shown.y });
  while (hist.length > 2 && now - hist[0].t > 200) hist.shift();
}

function metresPerPx() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return (2 * camDist * t) / window.innerHeight;
}

const canvas = renderer.domElement;
canvas.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  if (state !== "aim" || aiming) return;
  aiming = true;
  holdT = 0;
  steady = 0.25;
  fingerSpeed = 0;
  lastPx = e.clientX;
  lastPy = e.clientY;
  lastMoveT = performance.now();
  canvas.setPointerCapture(e.pointerId);
  hint(false);
});
canvas.addEventListener("pointermove", (e) => {
  if (!aiming) return;
  const k = metresPerPx() * 0.55; // finger moves more than the dart: finer control
  const dx = e.clientX - lastPx, dy = e.clientY - lastPy;
  aim.x = clamp(aim.x + dx * k, -0.28, 0.28);
  aim.y = clamp(aim.y - dy * k, -0.28, 0.28);
  const now = performance.now();
  const ms = clamp(now - lastMoveT, 8, 100);
  lastMoveT = now;
  fingerSpeed = Math.max(fingerSpeed, (Math.hypot(dx, dy) / ms) * 1000);
  lastPx = e.clientX;
  lastPy = e.clientY;
});
canvas.addEventListener("pointerup", () => {
  if (!aiming) return;
  aiming = false;
  if (state !== "aim") return;
  // Use where the sway was a moment ago, so lifting the finger doesn't nudge the dart.
  const now = performance.now();
  const s = hist.find((h) => now - h.t <= 70) ?? hist[hist.length - 1] ?? shown;
  playerThrow(s.x + gauss() * 0.0035, s.y + gauss() * 0.0035);
});
canvas.addEventListener("pointercancel", () => (aiming = false));

// ------------------------------------------------------------------
// Rules and flow
// ------------------------------------------------------------------
type State = "menu" | "aim" | "fly" | "cpu" | "wait" | "over";
let state: State = "menu";
let game: GameId = "x501";
let picked: GameId = "x501"; // game shown in the menu
let level = 0;
let whose: 0 | 1 = 0;
const score = [0, 0];
let turnStart = 0;
let darts: Hit[] = [];
let round = 1;
let playerDarts = 0, playerPoints = 0;
let best = 0, bestNine = 0, wins = 0;
let beaten: Record<string, number> = {};
// cricket
const marks = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
const CRICKET_ROUNDS = 20;
// english cricket
let batting: 0 | 1 = 0, innings = 1, wickets = 0, overs = 0;
const OVERS = 8;
const NINE_DARTS = 9;

// tiny scheduler that respects pause
const timers: { t: number; f: () => void }[] = [];
const later = (t: number, f: () => void) => timers.push({ t, f });
const other = (w: 0 | 1): 0 | 1 => (w === 0 ? 1 : 0);
const rivalName = () => RIVALS[level].name;
const isX01 = () => game === "x501" || game === "x301" || game === "nine";

function startGame(g: GameId, lvl = 0) {
  game = g;
  level = lvl;
  const start = g === "x501" || g === "nine" ? 501 : g === "x301" ? 301 : 0;
  score[0] = score[1] = start;
  round = 1;
  whose = 0;
  playerDarts = playerPoints = 0;
  marks.forEach((m) => m.fill(0));
  batting = 0; innings = 1; wickets = 0; overs = 0;
  timers.length = 0;
  clearDarts();
  aim.x = 0;
  aim.y = 0.103;
  $("menu").classList.add("hide");
  $("over").classList.add("hide");
  $("hud").classList.remove("hide");
  $("turn").classList.remove("hide");
  $("cric").classList.toggle("hide", g !== "cricket");
  beginTurn();
}

function playerHint(): string {
  if (isX01()) {
    const route = checkout(score[0], 3 - darts.length);
    if (route) return "Finish: " + route.map((b) => b.label).join(" · ");
    if (score[0] <= 170 && score[0] > 1) return `${score[0]} left · no finish this turn`;
  }
  if (game === "english") {
    if (whose === batting) return `Batting: score over 40 for runs`;
    return `Bowling: hit the bull for wickets`;
  }
  if (game === "cricket" && round === 1 && darts.length === 0) return "Close 20 to 15 and the bull";
  return "Drag to aim · Hold still · Let go to throw";
}

function beginTurn() {
  clearDarts();
  darts = [];
  turnStart = score[whose];
  drawHud();
  if (whose === 0) {
    state = "aim";
    hint(true, playerHint());
  } else {
    state = "cpu";
    hint(false);
    later(0.7, cpuThrow);
  }
}

function playerThrow(x: number, y: number) {
  state = "fly";
  launch(x, y, 0);
}

function cpuTarget(): { x: number; y: number } {
  if (isX01()) {
    const b = x01Target(score[1], 3 - darts.length);
    return spot(b.num, b.mult);
  }
  if (game === "english") return whose === batting ? spot(20, 3) : spot(25, 2);
  if (game === "cricket") {
    const me = marks[1], them = marks[0];
    const behind = score[1] < score[0];
    // Behind on points with a number to score on: cash in.
    if (behind) {
      const i = CRICKET_NUMS.findIndex((_, k) => me[k] >= 3 && them[k] < 3);
      if (i >= 0) return spot(CRICKET_NUMS[i], CRICKET_NUMS[i] === 25 ? 2 : 3);
    }
    const open = CRICKET_NUMS.findIndex((_, k) => me[k] < 3);
    if (open >= 0) return spot(CRICKET_NUMS[open], CRICKET_NUMS[open] === 25 ? 2 : 3);
    const sc = CRICKET_NUMS.findIndex((_, k) => them[k] < 3);
    if (sc >= 0) return spot(CRICKET_NUMS[sc], CRICKET_NUMS[sc] === 25 ? 2 : 3);
  }
  return spot(20, 3);
}
function cpuThrow() {
  if (state !== "cpu") return;
  const t = cpuTarget();
  const s = RIVALS[level].sigma;
  later(0.15, () => {
    if (state !== "cpu") return;
    state = "fly";
    launch(t.x + gauss() * s, t.y + gauss() * s, 1);
  });
}

function landed(hit: Hit, at: THREE.Vector3) {
  if (hit.onBoard) sfx.thunk();
  else sfx.wall();
  darts.push(hit);
  if (whose === 0) {
    playerDarts++;
    playerPoints += hit.score;
  }
  showMark(hit, at);

  if (game === "attack") {
    score[0] += hit.score;
    drawHud();
    return darts.length === 3 ? endTurn(false) : nextDart();
  }
  if (isX01()) return landedX01(hit);
  if (game === "cricket") return landedCricket(hit);
  return landedEnglish(hit);
}

function landedX01(hit: Hit) {
  const left = score[whose] - hit.score;
  if (isBust(left, hit)) {
    score[whose] = turnStart;
    drawHud();
    sfx.bust();
    const why = left === 0 ? "Finish on a double!" : left === 1 ? "Can't finish on 1" : "Too many!";
    popup("BUST", whose === 0 ? why : `${rivalName()} busts`);
    return endTurn(true);
  }
  score[whose] = left;
  drawHud();
  if (left === 0) {
    sfx.big();
    popup(game === "nine" && playerDarts <= 9 ? "NINE-DARTER!" : "GAME SHOT!", hit.label);
    state = "wait";
    return later(1.8, () => finish(whose === 0));
  }
  if (game === "nine" && playerDarts >= NINE_DARTS) {
    state = "wait";
    return later(1.2, () => finish(false));
  }
  return darts.length === 3 ? endTurn(false) : nextDart();
}

function landedCricket(hit: Hit) {
  const i = cricketIdx(hit);
  if (i >= 0) {
    const me = marks[whose], them = marks[other(whose)];
    for (let m = 0; m < hit.mult; m++) {
      if (me[i] < 3) me[i]++;
      else if (them[i] < 3) score[whose] += CRICKET_NUMS[i];
    }
  }
  drawHud();
  const me = marks[whose];
  if (me.every((m) => m >= 3) && score[whose] >= score[other(whose)]) {
    sfx.big();
    popup("CLOSED OUT!", whose === 0 ? "You win" : `${rivalName()} wins`);
    state = "wait";
    return later(1.8, () => finish(whose === 0));
  }
  return darts.length === 3 ? endTurn(false) : nextDart();
}

function landedEnglish(hit: Hit) {
  if (whose !== batting) {
    if (hit.num === 25) {
      wickets = Math.min(10, wickets + (hit.mult === 2 ? 2 : 1));
      sfx.coin();
    }
  }
  drawHud();
  return darts.length === 3 ? endTurn(false) : nextDart();
}

function nextDart() {
  state = whose === 0 ? "aim" : "cpu";
  if (whose === 0) hint(true, playerHint());
  else later(0.75, cpuThrow);
}

function endTurn(bust: boolean) {
  state = "wait";
  const total = darts.reduce((a, h) => a + h.score, 0);
  const who = whose === 0 ? "" : rivalName();
  let after: (() => boolean) | null = null; // returns true when the game ended

  if (game === "english") {
    if (whose === batting) {
      const runs = Math.max(0, total - 40);
      score[whose] += runs;
      popup(runs ? `${runs} RUN${runs > 1 ? "S" : ""}` : "NO RUNS", total > 40 ? `${total} − 40` : `${total}: need over 40`);
      if (runs >= 60) sfx.big(); else if (runs) sfx.coin();
      // Chasing side passes the target: game over.
      if (innings === 2 && score[batting] > score[other(batting)]) after = () => (finish(batting === 0), true);
    } else {
      overs++;
      const w = darts.filter((h) => h.num === 25).reduce((a, h) => a + (h.mult === 2 ? 2 : 1), 0);
      popup(w ? `${w} WICKET${w > 1 ? "S" : ""}` : "NO WICKETS", `${wickets}/10 · over ${overs} of ${OVERS}`);
      if (wickets >= 10 || overs >= OVERS) {
        after = () => {
          if (innings === 2) return finish(score[0] > score[1]), true;
          innings = 2; batting = other(batting); wickets = 0; overs = 0;
          popup("INNINGS OVER", `${batting === 0 ? "You need" : rivalName() + " needs"} ${score[other(batting)] + 1} to win`);
          return false;
        };
      }
    }
    drawHud();
  } else if (game === "cricket") {
    const m = darts.reduce((a, h) => a + (cricketIdx(h) >= 0 ? h.mult : 0), 0);
    popup(m ? `${m} MARK${m > 1 ? "S" : ""}` : "NO MARKS", who);
    if (whose === 1 && round >= CRICKET_ROUNDS) after = () => (finish(score[0] > score[1]), true);
  } else if (!bust) {
    if (total === 180) { sfx.big(); popup("180!", "Maximum!"); }
    else if (total >= 100) { sfx.coin(); popup(String(total), "Ton+"); }
    else popup(String(total), who);
  }

  later(1.5, () => {
    if (after && after()) return;
    if (game === "attack") {
      round++;
      if (round > ROUNDS) return finish(true);
    } else if (game === "nine") {
      if (playerDarts >= NINE_DARTS) return finish(false);
      round++;
    } else {
      if (whose === 1) round++;
      whose = other(whose);
    }
    if (game === "english" && after) whose = batting; // new innings: batter starts
    beginTurn();
  });
}

function finish(playerWon: boolean) {
  state = "over";
  hint(false);
  const avg = playerDarts ? ((playerPoints / playerDarts) * 3).toFixed(1) : "0";
  let title = "", text = "", again = "Play again";
  const vs = GAMES[game].vs;
  if (game === "attack") {
    const s = score[0];
    const rec = s > best;
    if (rec) best = s;
    title = rec ? "New best!" : "Finished";
    text = `Score <b>${s}</b> · Best <b>${best}</b><br>3-dart average <b>${avg}</b>`;
    P.sendScore(best);
  } else if (game === "nine") {
    const got = 501 - score[0];
    const rec = got > bestNine;
    if (rec) bestNine = got;
    title = playerWon ? "Perfect leg!" : rec ? "New best!" : "Out of darts";
    text = playerWon ? `501 in <b>${playerDarts}</b> darts. Legendary.` : `You cleared <b>${got}</b> of 501 with 9 darts.<br>Best <b>${bestNine}</b>`;
  } else if (playerWon) {
    wins++;
    const n = beaten[game] ?? 0;
    const first = level === n;
    if (first && n < RIVALS.length) beaten[game] = n + 1;
    title = "You win!";
    text = `You beat <b>${rivalName()}</b> at ${GAMES[game].name}.<br>` +
      (game === "english" ? `Runs <b>${score[0]}</b> to <b>${score[1]}</b>` : game === "cricket" ? `Points <b>${score[0]}</b> to <b>${score[1]}</b>` : `3-dart average <b>${avg}</b>`);
    if (level + 1 < RIVALS.length) again = `Next: ${RIVALS[level + 1].name}`;
    else text += "<br><b>You are the champion!</b>";
  } else {
    title = `${rivalName()} wins`;
    text = isX01() ? `You needed <b>${score[0]}</b> more.<br>3-dart average <b>${avg}</b>` : `<b>${score[0]}</b> to <b>${score[1]}</b>`;
  }
  void vs;
  persist();
  $("oTitle").textContent = title;
  $("oText").innerHTML = text;
  $("oAgain").textContent = again;
  $("over").classList.remove("hide");
  lastWon = playerWon;
}
let lastWon = false;

$("oAgain").addEventListener("click", () => {
  sfx.unlock();
  if (GAMES[game].vs && lastWon && level + 1 < RIVALS.length) startGame(game, level + 1);
  else startGame(game, level);
});
$("oMenu").addEventListener("click", showMenu);
$("attackBtn").addEventListener("click", () => { sfx.unlock(); startGame("attack"); });
$("nineBtn").addEventListener("click", () => { sfx.unlock(); startGame("nine"); });

function showMenu() {
  state = "menu";
  timers.length = 0;
  clearDarts();
  hint(false);
  $("over").classList.add("hide");
  $("hud").classList.add("hide");
  $("turn").classList.add("hide");
  $("cric").classList.add("hide");
  $("best").textContent = String(best);
  $("bestNine").textContent = String(bestNine);
  const chips = $("games");
  chips.innerHTML = "";
  (Object.keys(GAMES) as GameId[]).filter((g) => GAMES[g].vs).forEach((g) => {
    const b = document.createElement("button");
    b.className = "chip" + (g === picked ? " on" : "");
    b.textContent = GAMES[g].name;
    b.addEventListener("click", () => { picked = g; showMenu(); });
    chips.appendChild(b);
  });
  $("rules").textContent = GAMES[picked].rules;
  const done = beaten[picked] ?? 0;
  const box = $("ladder");
  box.innerHTML = "";
  RIVALS.forEach((r, i) => {
    const b = document.createElement("button");
    const locked = i > done;
    b.className = "opp" + (locked ? " locked" : i === done ? " next" : "");
    b.innerHTML = `<span class="av" style="background:${r.col}">${r.name.split(" ").map((w) => w[0]).join("")}</span>` +
      `<span class="nm"><b>${r.name}</b><span>${locked ? "Beat the rival above to unlock" : r.tag}</span></span>` +
      `<span class="st">${i < done ? "★" : locked ? "🔒" : "▶"}</span>`;
    b.disabled = locked;
    b.addEventListener("click", () => { sfx.unlock(); startGame(picked, i); });
    box.appendChild(b);
  });
  $("menu").classList.remove("hide");
}

// ------------------------------------------------------------------
// HUD
// ------------------------------------------------------------------
function drawHud() {
  const vs = GAMES[game].vs;
  $("c1").classList.remove("hide");
  if (vs) {
    $("n0").textContent = "You";
    $("n1").textContent = rivalName();
    $("s0").textContent = String(score[0]);
    $("s1").textContent = String(score[1]);
    $("c0").classList.toggle("on", whose === 0);
    $("c1").classList.toggle("on", whose === 1);
  }
  const sub = (w: 0 | 1) => {
    if (isX01()) {
      const r = checkout(score[w], 3);
      return r ? r.map((b) => b.label).join(" ") : w === 0 && playerDarts ? `Avg ${((playerPoints / playerDarts) * 3).toFixed(1)}` : GAMES[game].name;
    }
    if (game === "cricket") return `Points · round ${Math.min(round, CRICKET_ROUNDS)}/${CRICKET_ROUNDS}`;
    if (game === "english") return w === batting ? `Batting · ${wickets}/10 wkts` : `Bowling · over ${Math.min(overs + 1, OVERS)}/${OVERS}`;
    return "";
  };
  if (vs) {
    $("x0").textContent = sub(0);
    $("x1").textContent = sub(1);
  } else if (game === "nine") {
    $("n0").textContent = "Left";
    $("s0").textContent = String(score[0]);
    $("x0").textContent = sub(0);
    $("n1").textContent = "Darts";
    $("s1").textContent = `${playerDarts}/${NINE_DARTS}`;
    $("x1").textContent = `Best ${bestNine} of 501`;
    $("c0").classList.add("on");
    $("c1").classList.remove("on");
  } else {
    $("n0").textContent = "Score";
    $("n1").textContent = "Best";
    $("s0").textContent = String(score[0]);
    $("s1").textContent = String(Math.max(best, score[0]));
    $("x0").textContent = `Round ${Math.min(round, ROUNDS)} of ${ROUNDS}`;
    $("x1").textContent = "30 darts";
    $("c0").classList.add("on");
    $("c1").classList.remove("on");
  }
  for (let i = 0; i < 3; i++) {
    const el = $("d" + i), h = darts[i];
    el.textContent = h ? h.label : "–";
    el.className = "slot" + (h ? " hit" + (h.mult === 3 ? " t" : h.mult === 2 && h.num !== 25 ? " d" : h.num === 25 ? " b" : "") : i === darts.length ? " next" : "");
  }
  let tot = String(darts.reduce((a, h) => a + h.score, 0));
  if (game === "cricket") tot = `${darts.reduce((a, h) => a + (cricketIdx(h) >= 0 ? h.mult : 0), 0)} mk`;
  if (game === "english" && whose !== batting) tot = `${wickets} wk`;
  $("dt").textContent = tot;
  if (game === "cricket") {
    const rows = [0, 1].map((w) => `<tr><th>${w === 0 ? "You" : rivalName().split(" ").pop()}</th>` +
      marks[w].map((m) => `<td class="${m >= 3 ? "c" : ""}">${markSym(m)}</td>`).join("") + "</tr>");
    $("cric").innerHTML = `<table><tr><th></th>${CRICKET_NUMS.map((n) => `<th>${n === 25 ? "B" : n}</th>`).join("")}</tr>${rows.join("")}</table>`;
  }
}

const hintEl = $("hint");
function hint(on: boolean, text?: string) {
  if (text) hintEl.textContent = text;
  hintEl.classList.toggle("off", !on);
}

const popEl = $("pop");
function popup(big: string, small: string) {
  popEl.innerHTML = `${big}${small ? `<small>${small}</small>` : ""}`;
  popEl.classList.remove("show");
  void popEl.offsetWidth;
  popEl.classList.add("show");
}

const markEl = $("mark");
let markT = 0;
const markAt = V();
function showMark(h: Hit, at: THREE.Vector3) {
  markEl.textContent = h.label === "MISS" ? "MISS" : h.label === "BULL" ? "BULL 50" : String(h.score);
  markEl.style.color = h.mult === 3 ? "#ff8a65" : h.num === 25 ? "#f5c542" : h.mult === 2 ? "#81c784" : h.score ? "#fff" : "#bbb";
  markAt.copy(at);
  markT = 0.9;
  markEl.classList.add("show");
  placeMark();
}
function placeMark() {
  const p = markAt.clone().project(camera);
  markEl.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
  markEl.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
}

// ------------------------------------------------------------------
// Save
// ------------------------------------------------------------------
async function load() {
  try {
    const s = await P.loadSave(GAME_ID);
    if (s) {
      const d = JSON.parse(s);
      best = d.best | 0;
      bestNine = d.bestNine | 0;
      wins = d.wins | 0;
      beaten = typeof d.beaten === "object" && d.beaten ? d.beaten : { x301: clamp(d.beaten | 0, 0, RIVALS.length) };
    }
  } catch {
    /* fresh start */
  }
}
function persist() {
  P.save(GAME_ID, JSON.stringify({ best, bestNine, beaten, wins }));
}

// ------------------------------------------------------------------
// Loop
// ------------------------------------------------------------------
let last = performance.now(), running = true, readySent = false, clock = 0;

function update(dt: number) {
  clock += dt;
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) timers.splice(i, 1)[0].f();
  }
  updateAim(dt);
  updateFlying(dt);
  if (markT > 0) {
    markT -= dt;
    placeMark();
    if (markT <= 0) markEl.classList.remove("show");
  }
  // Gentle lamp flicker for life
  lamp.intensity = 6 + Math.sin(clock * 7.3) * 0.08;
}

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

if (location.search.includes("debug")) {
  (window as unknown as Record<string, unknown>).dd = {
    start: startGame,
    menu: showMenu,
    throwAt: (x: number, y: number) => { if (state === "aim") playerThrow(x, y); },
    step: (secs: number) => { for (let t = 0; t < secs; t += 0.05) update(0.05); },
    setScore: (a: number, b: number) => { score[0] = a; score[1] = b; turnStart = score[whose]; drawHud(); },
    state: () => ({ state, game, level, whose, score: [...score], darts: darts.map((d) => d.label), round, best, bestNine, beaten, marks, batting, innings, wickets, overs }),
  };
}

renderer.render(scene, camera);
P.firstFrameReady();
load().then(() => {
  showMenu();
  start();
});
