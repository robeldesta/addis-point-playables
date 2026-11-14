import * as THREE from "three";
import * as P from "../../src/platform/platform";
import { Truck, type Input } from "./truck";
import { TruckView } from "./model";
import { Autopilot } from "./autopilot";
import { Sfx } from "./sfx";
import { BIOMES, medalFor, MEDAL_ICON, type Biome, type Medal } from "./biomes";
import { buildWorld, type World } from "./world";
import type { Terrain } from "./terrain";
import { TRUCKS, UPGRADES, MAX_LEVEL, buildSpec, rate, upgradePrice, payout, type Levels } from "./trucks";
import { makeRival, rivalStep, rivalRecover, gridPlace, wallCollide, truckCollide, LapCounter, type Rival } from "./race";

// Dust Runner: trophy truck stages across five desert places. Each stage is
// a point-to-point run through open terrain with checkpoint gates.

const GAME_ID = "dust-runner";
const DT = 1 / 120;
const $ = (id: string) => document.getElementById(id)!;
const qs = new URLSearchParams(location.search);
const DEBUG = qs.has("debug");
const AUTO = qs.has("auto");
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------
// save
// ------------------------------------------------------------------
interface Garage { cash: number; owned: string[]; cur: string; lv: Record<string, Levels> }
interface Save { bestAir: number; places: Record<string, number>; race: Record<string, { pos: number; time: number }>; garage: Garage }
let save: Save = { bestAir: 0, places: {}, race: {}, garage: { cash: 0, owned: ["rookie"], cur: "rookie", lv: {} } };
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
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1400);
const hemi = new THREE.HemisphereLight(0xdbeaff, 0xc08850, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 150;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
let skyTex: THREE.Texture | null = null;
const dustColor = new THREE.Color(0xe9c99a);

function applyLook(b: Biome) {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, b.sky[0]); gr.addColorStop(0.42, b.sky[1]); gr.addColorStop(0.6, b.sky[2]); gr.addColorStop(1, b.sky[3]);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  skyTex?.dispose();
  skyTex = new THREE.CanvasTexture(c); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(b.fog, b.fogNear, b.fogFar);
  hemi.color.setHex(b.hemiSky); hemi.groundColor.setHex(b.hemiGround); hemi.intensity = b.hemiI;
  sun.color.setHex(b.sun); sun.intensity = b.sunI;
  SUN_DIR.set(...b.sunDir).normalize();
  dustColor.setHex(b.crest).lerp(new THREE.Color(b.track), 0.5);
}

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
// world (one per place)
// ------------------------------------------------------------------
let world: World;
let terrain: Terrain;
let worldIdx = -1;
let pilot: Autopilot;
function loadWorld(i: number) {
  if (i === worldIdx) return;
  if (world) { scene.remove(world.group); world.dispose(); }
  worldIdx = i;
  world = buildWorld(BIOMES[i], i + 1);
  terrain = world.terrain;
  pilot = new Autopilot(terrain, 5);
  scene.add(world.group);
  applyLook(BIOMES[i]);
  for (const v of rivalViews) scene.remove(v.root);
  rivals = []; rivalViews = [];
  if (BIOMES[i].stadium) {
    RIVALS.forEach(([name, livery, cap, lat]) => {
      const r = makeRival(terrain, name, livery, cap, lat);
      const v = new TruckView(livery);
      rivals.push(r); rivalViews.push(v); scene.add(v.root);
    });
    lapC = new LapCounter(terrain, 0);
    gridAll();
  }
}

// ------------------------------------------------------------------
// stadium race: rivals and the starting grid
// ------------------------------------------------------------------
const RIVALS: [string, number, number, number][] = [
  ["Blaze", 0x1565c0, 30, 4.3],
  ["Viper", 0x2e9e4f, 31, 5.0],
  ["Ace", 0xf2c200, 32, 5.8],
];
let rivals: Rival[] = [];
let rivalViews: TruckView[] = [];
let lapC: LapCounter;
const isRace = () => !!BIOMES[worldIdx]?.stadium;
/** grid: two rows behind the line, the player starts at the back */
function gridAll() {
  const n = terrain.count;
  const slots = [[0, -2.4], [0, 2.4], [1, -2.4], [1, 2.4]];
  rivals.forEach((r, i) => {
    const k = n - 8 - slots[i][0] * 13;
    gridPlace(r.truck, terrain, k, slots[i][1]);
    r.pilot.k = k; r.lap.reset(k); r.done = 0; r.flipT = r.stuckT = 0;
  });
  const k = n - 8 - slots[3][0] * 13;
  gridPlace(truck, terrain, k, slots[3][1]);
  pilot.k = k; lapC.reset(k);
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
  uniforms: { uScale: { value: 400 }, uColor: { value: dustColor } },
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
let view = new TruckView();
scene.add(view.root);
const truckDef = () => TRUCKS.find((t) => t.id === save.garage.cur) ?? TRUCKS[0];
const levels = (id: string): Levels => (save.garage.lv[id] ??= [0, 0, 0, 0]);
/** puts the selected truck, with its upgrades, under the player */
function applyTruck() {
  const d = truckDef();
  truck.spec = buildSpec(d, levels(d.id));
  scene.remove(view.root);
  view = new TruckView(d.livery);
  scene.add(view.root);
}
const sfx = new Sfx();
let paused = false;
P.onAudioChange((on) => sfx.setEnabled(on));
sfx.setEnabled(P.isAudioEnabled());
P.onPause(() => { paused = true; sfx.suspend(); });
P.onResume(() => { paused = false; sfx.resume(); });

function placeAtTrack(k: number) {
  const s = terrain.sample(k), s2 = terrain.sample(k + 4);
  truck.place(s.x, s.z, Math.atan2(s2.x - s.x, s2.z - s.z), terrain);
  const n = terrain.count;
  pilot.k = terrain.loop ? ((Math.round(k) % n) + n) % n : clamp(Math.round(k), 0, n - 1);
}

// ------------------------------------------------------------------
// input
// ------------------------------------------------------------------
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyR" && mode === "drive") resetTruck();
  if ((e.code === "KeyF" || e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) setFocus(!focusOn);
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
$("focus").addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); sfx.unlock(); setFocus(!focusOn); });
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
let penalty = 0, offTrack = false, runAir = 0;
// focus: slow motion earned by air time
let focus = 0, focusOn = false, timeScale = 1;
const FOCUS_SCALE = 0.35, FOCUS_DRAIN = 0.3, FOCUS_FILL = 0.2; // drain per real second, fill per second of air
let flipTimer = 0;
let launchX = 0, launchZ = 0, wasAir = false, airPeak = 0;
let shake = 0;
const _kq = new THREE.Quaternion(), _kax = new THREE.Vector3();

function setFocus(on: boolean) {
  if (on && (focus < 0.1 || mode !== "drive")) return;
  focusOn = on;
  document.body.classList.toggle("focusing", on);
}
function resetTruck() {
  const near = terrain.nearest(truck.pos.x, truck.pos.z, pilot.k);
  placeAtTrack(terrain.loop ? near.k - 12 : Math.max(world.startK, near.k - 12));
  flipTimer = 0;
  pop("Reset", "");
}

// ---- stages ----
let stageIdx = 0;
let phase: "count" | "run" | "done" = "run";
let countT = 0, stageTime = 0, prog = 0, progK = 0, lastCount = 0, nextGate = 0;
const splits: number[] = [];

function startStage(i: number) {
  loadWorld(i);
  stageIdx = i;
  mode = "drive";
  document.body.classList.add("driving", "staged");
  $("menu").classList.remove("show");
  $("results").classList.remove("show");
  setFocus(false);
  focus = 0; penalty = 0; runAir = 0;
  for (const c of world.knocks) if (c.down || c.tilt) { c.down = false; c.tilt = 0; c.tiltV = 0; c.apply(_kq.identity()); }
  phase = "count";
  if (isRace()) gridAll(); else placeAtTrack(world.startK - 14);
  for (let s = 0; s < 40; s++) physicsStep(DT);
  progK = world.startK - 14; prog = progK;
  countT = 3.2; lastCount = 4; stageTime = 0; nextGate = 0; splits.length = 0;
  lapShown = 0; lapStart = 0; bestLap = 0; raceClock = 0;
  camSnap = true;
  sfx.unlock();
  if (!usedTouch && !("ontouchstart" in window)) document.body.classList.add("kb");
}
const unlocked = (i: number) => i === 0 || !!BIOMES[i].stadium || !!medalFor(BIOMES[i - 1], save.places[BIOMES[i - 1].id] ?? 0);
// ---- stadium race ----
let lapShown = 0, lapStart = 0, bestLap = 0, raceClock = 0;
const ORD = ["", "1st", "2nd", "3rd", "4th"];
const POS_MEDAL: Medal[] = ["", "gold", "silver", "bronze", ""];
function racePlace() {
  // finished trucks rank by time, the rest by distance covered
  const me = lapC.prog;
  let ahead = 0;
  for (const r of rivals) if (r.done || r.lap.prog > me) ahead++;
  return ahead + 1;
}
function raceTick(dt: number) {
  const n = terrain.count, laps = BIOMES[stageIdx].laps ?? 3;
  if (phase === "count") return;
  raceClock += dt;
  for (const r of rivals) if (!r.done && r.lap.prog >= laps * n) r.done = raceClock;
  if (phase !== "run") return;
  stageTime += dt;
  const lap = lapC.lap();
  if (lap > lapShown) {
    const lt = stageTime - lapStart;
    lapStart = stageTime; lapShown = lap;
    if (!bestLap || lt < bestLap) bestLap = lt;
    if (lap < laps) { sfx.ding(); pop(lap === laps - 1 ? "FINAL LAP" : `LAP ${lap + 1}/${laps}`, `${fmt2(lt)} · ${ORD[racePlace()]}`); }
  }
  if (lapC.prog >= laps * n) finishRace();
}
function finishRace() {
  const b = BIOMES[stageIdx];
  phase = "done";
  const t = stageTime, place = racePlace();
  const prev = save.race[b.id];
  const best = !prev || place < prev.pos || (place === prev.pos && t < prev.time);
  if (best) save.race[b.id] = { pos: place, time: t };
  const earned = payout(POS_MEDAL[place], true, runAir);
  save.garage.cash += earned;
  persist();
  sfx.ding();
  pop(place === 1 ? "YOU WIN!" : `${ORD[place]} PLACE`, fmt2(t), place === 1 ? "" : place === 4 ? "bad" : "");
  const idx = stageIdx;
  window.setTimeout(() => {
    if (stageIdx !== idx || phase !== "done" || mode !== "drive") return;
    const m = POS_MEDAL[place];
    $("rmedal").textContent = MEDAL_ICON[m] || "🏁";
    $("rtitle").textContent = place === 1 ? "1st place!" : `${ORD[place]} place`;
    $("rplace").textContent = b.name;
    $("rtime").textContent = fmt2(t);
    $("rpen").textContent = `Best lap ${fmt2(bestLap)}`;
    $("rbest").textContent = best ? "New personal best!" : `Best ${ORD[prev!.pos]} · ${fmt2(prev!.time)}`;
    const order = rivals.map((r) => ({ name: r.name, t: r.done, prog: r.lap.prog, me: false }))
      .sort((a, c) => (a.t && c.t ? a.t - c.t : a.t ? -1 : c.t ? 1 : c.prog - a.prog));
    order.splice(place - 1, 0, { name: "You", t, prog: 0, me: true });
    $("rcash").textContent = `+$${earned} · you have $${save.garage.cash}`;
    $("rtargets").innerHTML = order.map((o, i) => `<span class="${o.me ? "got" : ""}">${ORD[i + 1]} ${o.name} ${o.t ? fmt2(o.t) : "racing"}</span>`).join("");
    ($("rnext") as HTMLButtonElement).style.display = "none";
    $("results").classList.add("show");
    document.body.classList.remove("driving");
  }, 1600);
}

function finishStage() {
  const b = BIOMES[stageIdx];
  phase = "done";
  const t = stageTime;
  const prev = save.places[b.id] ?? 0;
  const best = !prev || t < prev;
  if (best) save.places[b.id] = t;
  const earned = payout(medalFor(b, t), true, runAir);
  save.garage.cash += earned;
  persist();
  sfx.ding();
  const m = medalFor(b, t);
  pop("FINISH", fmt2(t));
  const idx = stageIdx;
  window.setTimeout(() => {
    if (stageIdx !== idx || phase !== "done" || mode !== "drive") return;
    $("rmedal").textContent = MEDAL_ICON[m] || "🏁";
    $("rtitle").textContent = m ? `${m[0].toUpperCase()}${m.slice(1)} medal!` : "No medal";
    $("rplace").textContent = b.name;
    $("rtime").textContent = fmt2(t);
    $("rpen").textContent = penalty > 0.05 ? `includes +${penalty.toFixed(1)}s off the route` : "Clean run, no off-route time";
    $("rbest").textContent = best ? "New best time!" : `Best ${fmt2(prev)}`;
    $("rtargets").innerHTML = targetsHtml(b, save.places[b.id]);
    $("rcash").textContent = `+$${earned} · you have $${save.garage.cash}`;
    const nx = $("rnext") as HTMLButtonElement;
    nx.style.display = idx < BIOMES.length - 1 ? "" : "none";
    nx.disabled = !unlocked(idx + 1);
    nx.textContent = nx.disabled ? "Next place 🔒 (get bronze)" : `Next: ${BIOMES[idx + 1]?.name ?? ""}`;
    $("results").classList.add("show");
    document.body.classList.remove("driving");
  }, 1400);
}
function targetsHtml(b: Biome, best?: number) {
  const row = (m: "gold" | "silver" | "bronze") =>
    `<span class="${best && best <= b[m] ? "got" : ""}">${MEDAL_ICON[m]} ${fmt2(b[m])}</span>`;
  return row("gold") + row("silver") + row("bronze");
}
function showMenu() {
  mode = "menu";
  setFocus(false);
  document.body.classList.remove("driving", "staged", "offtrack");
  $("results").classList.remove("show");
  buildStageList();
  $("menu").classList.add("show");
  if (isRace()) gridAll(); else placeAtTrack(world.startK);
  camSnap = true;
}
function buildStageList() {
  const list = $("stagelist");
  list.innerHTML = "";
  let medals = 0;
  BIOMES.forEach((b, i) => {
    const best = save.places[b.id] ?? 0;
    const race = save.race[b.id];
    const m = b.stadium ? POS_MEDAL[race?.pos ?? 0] : medalFor(b, best);
    if (m) medals++;
    const open = unlocked(i);
    const el = document.createElement("button");
    el.className = "stage" + (open ? "" : " locked") + (b.stadium ? " race" : "");
    el.style.setProperty("--c", "#" + b.ground[1].toString(16).padStart(6, "0"));
    el.innerHTML = `<b>${i + 1}. ${b.name}</b><span class="m">${open ? MEDAL_ICON[m] || "" : "🔒"}</span>` +
      `<small>${open ? b.blurb : "Get bronze on the place before"}</small>` +
      `<small class="t">${b.stadium ? (race ? `Best ${ORD[race.pos]} · ${fmt2(race.time)}` : "Win for gold") : best ? "Best " + fmt2(best) : "Gold " + fmt2(b.gold)}</small>`;
    if (open) el.addEventListener("click", () => startStage(i));
    list.appendChild(el);
  });
  $("medals").textContent = `${medals} / ${BIOMES.length} places medalled`;
  $("cash1").textContent = `$${save.garage.cash}`;
}
$("rretry").addEventListener("click", () => startStage(stageIdx));
$("rnext").addEventListener("click", () => { if (unlocked(stageIdx + 1)) startStage(stageIdx + 1); });
$("rmenu").addEventListener("click", showMenu);

// ---- garage ----
let gIdx = 0;
function openGarage() {
  gIdx = Math.max(0, TRUCKS.findIndex((t) => t.id === save.garage.cur));
  $("menu").classList.remove("show");
  $("garage").classList.add("show");
  drawGarage();
}
function drawGarage() {
  const g = save.garage, d = TRUCKS[gIdx];
  const own = g.owned.includes(d.id);
  $("cash2").textContent = `$${g.cash}`;
  $("tname").textContent = `${d.name}${own ? "" : " 🔒"}`;
  $("tblurb").textContent = d.blurb;
  const base = rate(buildSpec(d, [0, 0, 0, 0])), now = rate(buildSpec(d, levels(d.id)));
  const row = (label: string, k: keyof typeof base) =>
    `<div class="stat"><span>${label}</span><i><b class="up" style="width:${now[k]}%"><b style="width:${(base[k] / now[k]) * 100}%"></b></b></i></div>`;
  $("tstats").innerHTML = row("Power", "power") + row("Suspension", "susp") + row("Grip", "grip") + row("Stability", "stab");
  const act = $("tact") as HTMLButtonElement;
  if (!own) { act.textContent = `Buy $${d.price}`; act.disabled = g.cash < d.price; }
  else if (g.cur === d.id) { act.textContent = "Driving this one"; act.disabled = true; }
  else { act.textContent = "Drive this truck"; act.disabled = false; }
  act.style.opacity = act.disabled ? "0.55" : "1";
  const lv = levels(d.id);
  $("uplist").innerHTML = UPGRADES.map((u, i) => {
    const price = upgradePrice(d, lv[i]);
    const pips = Array.from({ length: MAX_LEVEL }, (_, j) => `<i class="${j < lv[i] ? "on" : ""}"></i>`).join("");
    const label = lv[i] >= MAX_LEVEL ? "MAX" : `$${price}`;
    return `<div class="up"><span class="ic">${u.icon}</span><span class="nm"><b>${u.name}</b><small>${u.blurb}</small></span><span class="pips">${pips}</span>` +
      `<button data-i="${i}" ${!own || lv[i] >= MAX_LEVEL || g.cash < price ? "disabled" : ""}>${label}</button></div>`;
  }).join("");
}
$("uplist").addEventListener("click", (e) => {
  const i = Number((e.target as HTMLElement).closest("button")?.dataset.i ?? -1);
  if (i < 0) return;
  const d = TRUCKS[gIdx], lv = levels(d.id), price = upgradePrice(d, lv[i]);
  if (!save.garage.owned.includes(d.id) || lv[i] >= MAX_LEVEL || save.garage.cash < price) return;
  save.garage.cash -= price; lv[i]++;
  persist(); sfx.unlock(); sfx.ding();
  if (d.id === save.garage.cur) applyTruck();
  drawGarage();
});
$("tact").addEventListener("click", () => {
  const g = save.garage, d = TRUCKS[gIdx];
  if (!g.owned.includes(d.id)) {
    if (g.cash < d.price) return;
    g.cash -= d.price; g.owned.push(d.id); sfx.unlock(); sfx.ding();
  }
  g.cur = d.id;
  persist();
  applyTruck();
  drawGarage();
});
$("tprev").addEventListener("click", () => { gIdx = (gIdx + TRUCKS.length - 1) % TRUCKS.length; drawGarage(); });
$("tnext").addEventListener("click", () => { gIdx = (gIdx + 1) % TRUCKS.length; drawGarage(); });
$("garagebtn").addEventListener("click", openGarage);
$("gback").addEventListener("click", () => { $("garage").classList.remove("show"); showMenu(); });
$("quit").addEventListener("pointerdown", (e) => { e.stopPropagation(); showMenu(); });

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
const fmt2 = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

function physicsStep(dt: number) {
  if (mode === "drive" && !AUTO) {
    readInput(dt, input);
    if (phase === "count") { input.throttle = 0; input.brake = 0; input.handbrake = true; }
    if (phase === "done") { input.throttle = 0; input.brake = 1; input.steer = 0; }
  } else pilot.drive(truck, input, mode === "menu" ? 26 : 45);
  truck.step(dt, input, terrain);
  if (isRace()) {
    const hold = mode === "drive" && phase === "count";
    for (const r of rivals) rivalStep(r, terrain, dt, hold);
    const all = [truck, ...rivals.map((r) => r.truck)];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const hit = truckCollide(all[i], all[j]);
      if (hit > 2 && i === 0) { sfx.thud(Math.min(1, hit / 10)); shake = Math.min(1, shake + hit * 0.03); }
    }
    const wh = wallCollide(truck, terrain, pilot.k);
    if (wh > 3) { sfx.thud(Math.min(1, wh / 12)); shake = Math.min(1, shake + wh * 0.04); }
    for (const r of rivals) wallCollide(r.truck, terrain, r.pilot.k);
  }
  for (const b of world.boulders) {
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
  for (const c of world.knocks) {
    if (!c.down) {
      const dx = c.x - truck.pos.x, dz = c.z - truck.pos.z;
      if (dx * dx + dz * dz < c.r * c.r && truck.vel.lengthSq() > 4) {
        c.down = true;
        const v = Math.hypot(truck.vel.x, truck.vel.z) || 1;
        c.ax = truck.vel.z / v; c.az = -truck.vel.x / v;
        c.tiltV = 3 + v * 0.25;
        truck.vel.multiplyScalar(c.slow);
        sfx.thud(0.3);
        const y = terrain.height(c.x, c.z);
        for (let k = 0; k < 6; k++) emitDust(c.x, y + 0.3, c.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 1, 1.2);
      }
    } else if (c.tilt < 1.5) {
      c.tiltV += 8 * dt;
      c.tilt = Math.min(1.5, c.tilt + c.tiltV * dt);
      c.apply(_kq.setFromAxisAngle(_kax.set(c.ax, 0, c.az), c.tilt));
    }
  }

  // dust from the tyres
  tyreDust(truck, dt);
  for (const r of rivals) tyreDust(r.truck, dt);
  if (isRace()) {
    for (const r of rivals) {
      rivalRecover(r, terrain, dt, mode !== "drive" || phase === "run");
      const nn = terrain.nearest(r.truck.pos.x, r.truck.pos.z, r.pilot.k);
      r.lap.update(nn.k, nn.d);
    }
  }
  airTick(dt);
}
function tyreDust(tr: Truck, dt: number) {
  const spd = tr.vel.length();
  for (const w of tr.wheels) {
    if (!w.grounded) continue;
    const rate = (Math.max(0, spd - 3) * 0.35 + w.slip * 2.5) * dt;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    n = Math.min(n, 3);
    for (let k = 0; k < n; k++) {
      emitDust(w.contact.x + (Math.random() - 0.5) * 0.5, w.contact.y + 0.15, w.contact.z + (Math.random() - 0.5) * 0.5,
        -tr.vel.x * 0.15 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, -tr.vel.z * 0.15 + (Math.random() - 0.5) * 2,
        0.8 + Math.random() * 0.6 + spd * 0.02, 0.9 + Math.random() * 0.9);
    }
  }
}
function airTick(dt: number) {

  // air time
  const inAir = truck.grounded === 0;
  if (inAir && !wasAir) { launchX = truck.pos.x; launchZ = truck.pos.z; airPeak = 0; }
  if (inAir) airPeak = Math.max(airPeak, truck.airTime);
  if (inAir && truck.airTime > 0.15 && mode === "drive" && !focusOn) focus = Math.min(1, focus + FOCUS_FILL * dt);
  if (inAir && truck.airTime > 0.15 && mode === "drive" && phase === "run") runAir += dt;
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

  const near = terrain.nearest(truck.pos.x, truck.pos.z, pilot.k);
  if (mode !== "drive") {
    pilot.k = near.k;
    if ((!terrain.loop && near.k > world.finishK - 10) || truck.isUpsideDown()) placeAtTrack(world.startK);
    if (isRace() && rivals.every((r) => r.lap.prog > 6 * terrain.count)) gridAll();
    return;
  }
  if (truck.isUpsideDown()) flipTimer += dt; else flipTimer = 0;
  if (flipTimer > 2.2) { resetTruck(); pop("Flipped!", "Back on the route"); }
  pilot.k = near.k;
  if (isRace()) { offTrack = false; lapC.update(near.k, near.d); raceTick(dt); countdown(dt); return; }
  offTrack = near.d > terrain.offRoute;
  stageTick(dt, near);
}

function countdown(dt: number) {
  if (phase !== "count") return false;
  countT -= dt;
  const c = Math.ceil(countT);
  if (c !== lastCount && c >= 1 && c <= 3) { lastCount = c; pop(String(c), BIOMES[stageIdx].name); sfx.beep(false); }
  if (countT <= 0) { phase = "run"; pop("GO!", ""); sfx.beep(true); }
  return true;
}
function stageTick(dt: number, near: { k: number; d: number }) {
  if (countdown(dt)) return;
  // progress along the route; big jumps in position (cutting across) don't count
  if (near.d < 45) {
    const dk = near.k - progK;
    if (Math.abs(dk) < 60) prog += dk;
    progK = near.k;
  }
  if (phase !== "run") return;
  stageTime += dt;
  if (offTrack) { stageTime += dt; penalty += dt; }
  if (nextGate < world.gates.length && prog >= world.gates[nextGate]) {
    nextGate++;
    splits.push(stageTime);
    sfx.ding();
    pop(`CHECKPOINT ${nextGate}/${world.gates.length}`, fmt2(stageTime));
  }
  if (prog >= world.finishK) finishStage();
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
  const fov = (portrait ? 70 : 60) + Math.min(14, spd * 0.35) - (1 - timeScale) * 9;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  sun.position.copy(truck.pos).addScaledVector(SUN_DIR, 60);
  sun.target.position.copy(truck.pos);
  dustMat.uniforms.uScale.value = (viewH * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

// ------------------------------------------------------------------
// HUD
// ------------------------------------------------------------------
const progFill = $("progfill");
const offEl = $("offtxt"), focusFill = $("focusfill"), focusBtn = $("focus");
const spdEl = $("spdv"), lapEl = $("lap"), bestEl = $("best"), fpsEl = $("fps");
let fpsAcc = 0, fpsN = 0;
function hud(dt: number) {
  spdEl.textContent = String(Math.round(Math.abs(truck.speed) * 3.6));
  if (mode === "drive") {
    const b = BIOMES[stageIdx];
    lapEl.textContent = fmt2(stageTime);
    if (b.stadium) {
      const laps = b.laps ?? 3;
      bestEl.textContent = `${ORD[racePlace()]} / ${rivals.length + 1} · Lap ${clamp(lapC.lap() + 1, 1, laps)}/${laps}`;
      progFill.style.width = `${clamp(lapC.prog / (laps * terrain.count), 0, 1) * 100}%`;
    } else {
    const next = stageTime <= b.gold ? ["🥇", b.gold] : stageTime <= b.silver ? ["🥈", b.silver] : stageTime <= b.bronze ? ["🥉", b.bronze] : null;
    bestEl.textContent = next ? `${next[0]} ${fmt2(next[1] as number)}` : "No medal this run";
    progFill.style.width = `${clamp((prog - world.startK) / (world.finishK - world.startK), 0, 1) * 100}%`;
    }
  }
  document.body.classList.toggle("offtrack", mode === "drive" && offTrack && phase === "run");
  offEl.textContent = `OFF ROUTE · TIME x2  +${penalty.toFixed(1)}s`;
  focusFill.style.height = `${focus * 100}%`;
  focusBtn.classList.toggle("ready", focus >= 0.25 && !focusOn);
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
  if (focusOn) { focus -= FOCUS_DRAIN * dt; if (focus <= 0) { focus = 0; setFocus(false); } }
  timeScale += ((focusOn ? FOCUS_SCALE : 1) - timeScale) * Math.min(1, dt * 8);
  const realDt = dt;
  dt *= timeScale;
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 10) { physicsStep(DT); acc -= DT; steps++; }
  if (steps === 10) acc = 0;
  gameTick(dt);
  updateDust(dt);
  view.update(truck, input.brake > 0 && truck.speed > 0.5);
  rivals.forEach((r, i) => rivalViews[i].update(r.truck, r.input.brake > 0 && r.truck.speed > 0.5));
  updateCamera(realDt);
  if (mode === "drive") {
    const slip = truck.wheels.reduce((a, w) => a + w.slip, 0);
    sfx.drive(truck.rpm * (0.55 + 0.45 * timeScale), input.throttle, truck.vel.length() * timeScale, truck.grounded, slip * timeScale);
  } else sfx.mute();
  hud(realDt);
  renderer.render(scene, camera);
}

async function boot() {
  try {
    const raw = await P.loadSave(GAME_ID);
    if (raw) save = { ...save, ...JSON.parse(raw) };
    if (!save.places) save.places = {};
    if (!save.race) save.race = {};
    if (!save.garage) save.garage = { cash: 0, owned: ["rookie"], cur: "rookie", lv: {} };
  } catch { /* fresh save */ }
  applyTruck();
  if (DEBUG) document.body.classList.add("debug");
  let first = 0;
  for (let i = 0; i < BIOMES.length; i++) if (unlocked(i) && !BIOMES[i].stadium) first = i;
  loadWorld(qs.has("place") ? +(qs.get("place") || 0) : first);
  if (!isRace()) placeAtTrack(world.startK);
  for (let i = 0; i < 60; i++) physicsStep(DT); // settle the suspension
  buildStageList();
  if (qs.has("place")) startStage(+(qs.get("place") || 0));
  if (DEBUG) Object.assign(window as any, { scene, camera, renderer, truck, get world() { return world; }, get rivals() { return rivals; }, get lapC() { return lapC; }, get save() { return save; } });
  last = performance.now();
  requestAnimationFrame(frame);
  P.firstFrameReady();
  P.gameReady();
}
boot();
