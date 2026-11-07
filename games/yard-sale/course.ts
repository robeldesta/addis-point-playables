// Procedural downhill course. Skiers travel toward +z. Everything is driven
// by a seeded RNG, so level N always builds the same mountain.

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ObKind = "tree" | "rock" | "pine";
export interface Obstacle { x: number; z: number; r: number; h: number; kind: ObKind; s: number }
export interface Jump { z: number; len: number; height: number; x: number; w: number }

const PRE = 80; // meters of terrain before the start line
const POST = 160; // run-out after the finish

const ADJ = ["Widowmaker", "Frostbite", "Silver", "Thunder", "Devil's", "Moonlight", "Iron", "Howling", "Crystal", "Broken", "Avalanche", "Glacier", "Black Ice", "Eagle", "Wolf", "Shadow", "Sunrise", "Kamikaze", "Polar", "Last Chance"];
const NOUN = ["Ridge", "Couloir", "Bowl", "Run", "Chute", "Descent", "Gully", "Express", "Face", "Drop", "Highway", "Gauntlet", "Plunge", "Peak", "Pass", "Wall"];

export class Course {
  level: number;
  name: string;
  length: number; // start line z = 0, finish line z = length
  E: Float32Array; // elevation per meter, index = z + PRE
  CX: Float32Array; // centerline x
  W: Float32Array; // piste half width
  mog: Float32Array; // mogul strength
  jumps: Jump[] = [];
  obstacles: Obstacle[] = [];
  buckets = new Map<number, Obstacle[]>();
  zMin = -PRE;
  zMax: number;
  opponents: number;
  aiSkill: number;

  constructor(level: number) {
    this.level = level;
    const R = rng(1000 + level * 7919);
    const trial = level === 0;
    const d = Math.min(level, 30) / 30; // difficulty 0..1
    this.length = trial ? 650 : Math.round(800 + d * 900 + R() * 200);
    this.opponents = trial ? 0 : Math.min(3 + Math.floor(level / 2), 7);
    this.aiSkill = trial ? 0 : Math.min(0.35 + level * 0.05, 1);
    this.name = trial ? "Trial Run" : `${ADJ[Math.floor(R() * ADJ.length)]} ${NOUN[Math.floor(R() * NOUN.length)]}`;
    this.zMax = this.length + POST;
    const N = PRE + this.zMax + 2;
    this.E = new Float32Array(N);
    this.CX = new Float32Array(N);
    this.W = new Float32Array(N);
    this.mog = new Float32Array(N);

    // --- slope profile: sections with different steepness
    const grade = new Float32Array(N); // degrees
    let z = 0;
    const baseMin = trial ? 9 : 11 + d * 6;
    const baseMax = trial ? 15 : 17 + d * 13;
    while (z < N) {
      const len = 70 + R() * 150;
      const g = baseMin + R() * (baseMax - baseMin);
      for (let i = 0; i < len && z < N; i++, z++) grade[z] = g;
    }
    // flat start pad and flat run-out after the finish
    for (let i = 0; i < N; i++) {
      const wz = i - PRE;
      if (wz < 15) grade[i] = wz < -10 ? 4 : 7;
      if (wz > this.length + 10) grade[i] = Math.max(-6, grade[i] * (1 - (wz - this.length - 10) / 40));
    }
    // smooth grade
    const sg = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0, c = 0;
      for (let k = -18; k <= 18; k++) { const j = i + k; if (j >= 0 && j < N) { s += grade[j]; c++; } }
      sg[i] = s / c;
    }

    // --- jumps
    const jumpCount = trial ? 2 : 2 + Math.floor(R() * 2 + d * 4);
    for (let j = 0; j < jumpCount; j++) {
      const jz = trial ? [220, 470][j] : 120 + ((j + 0.5) / jumpCount) * (this.length - 220) + (R() - 0.5) * 40;
      const height = trial ? 1.5 + j * 0.7 : 1.4 + R() * (1.0 + d * 1.8);
      const len = 6 + height * 2.2;
      this.jumps.push({ z: Math.round(jz), len, height, x: 0, w: 7 + R() * 4 });
      // steeper landing zone after the lip
      for (let k = 0; k < 75; k++) { const i = Math.round(jz) + PRE + k; const f = k < 50 ? 1 : 1 - (k - 50) / 25; if (i < N) sg[i] += (8 + height * 2) * f; }
    }

    let e = 0;
    for (let i = 0; i < N; i++) {
      this.E[i] = e;
      e -= Math.tan((sg[i] * Math.PI) / 180);
    }

    // --- centerline and width
    const amps = [R() * (8 + d * 22), R() * (5 + d * 12), R() * 3];
    const freqs = [0.004 + R() * 0.004, 0.011 + R() * 0.01, 0.03 + R() * 0.02];
    const ph = [R() * 6.28, R() * 6.28, R() * 6.28];
    for (let i = 0; i < N; i++) {
      const wz = i - PRE;
      const ramp = Math.min(1, Math.max(0, wz / 60));
      let x = 0;
      for (let k = 0; k < 3; k++) x += amps[k] * Math.sin(wz * freqs[k] + ph[k]);
      x -= amps[0] * Math.sin(ph[0]) + amps[1] * Math.sin(ph[1]) + amps[2] * Math.sin(ph[2]);
      this.CX[i] = x * ramp;
      const wBase = trial ? 22 : 20 - d * 7;
      this.W[i] = wz < 10 ? 26 : wBase + 5 * Math.sin(wz * 0.013 + ph[1]);
    }
    for (const jp of this.jumps) jp.x = this.cx(jp.z);

    // --- moguls in some sections (not on trial)
    if (!trial) {
      const mc = Math.floor(R() * 2 + d * 3);
      for (let m = 0; m < mc; m++) {
        const mz = 80 + R() * (this.length - 160);
        const ml = 40 + R() * 50;
        if (this.jumps.some((jp) => Math.abs(jp.z - mz) < ml + 30)) continue;
        for (let k = 0; k < ml; k++) {
          const i = Math.round(mz + k) + PRE;
          if (i < N) this.mog[i] = Math.sin((k / ml) * Math.PI) * (0.35 + d * 0.35);
        }
      }
    }

    // --- obstacles: forest outside the nets, tree islands and rocks on piste
    for (let wz = -PRE + 4; wz < this.zMax; wz += 3) {
      for (const side of [-1, 1]) {
        const n = 2 + Math.floor(R() * 2);
        for (let k = 0; k < n; k++) {
          const off = this.w(wz) + 3 + R() * 45;
          const x = this.cx(wz) + side * off;
          const s = 0.7 + R() * 0.9;
          this.addOb({ x, z: wz + R() * 3, r: 0.45 * s, h: 6 * s, kind: R() < 0.8 ? "pine" : "tree", s });
        }
      }
    }
    const onPiste = trial ? 6 : Math.floor(8 + d * 40 + R() * 6);
    for (let k = 0; k < onPiste; k++) {
      const wz = 60 + R() * (this.length - 80);
      if (this.jumps.some((jp) => wz > jp.z - jp.len - 12 && wz < jp.z + 75)) continue;
      const lat = (R() * 2 - 1) * (this.w(wz) - 3);
      const rock = R() < 0.4;
      if (trial && Math.abs(lat) < 8) continue;
      const cluster = rock ? 1 : 1 + Math.floor(R() * 3);
      for (let c = 0; c < cluster; c++) {
        const s = rock ? 0.6 + R() * 0.8 : 0.7 + R() * 0.6;
        this.addOb({
          x: this.cx(wz) + lat + (R() - 0.5) * 4 * c,
          z: wz + (R() - 0.5) * 5 * c,
          r: rock ? 0.9 * s : 0.45 * s,
          h: rock ? 1.1 * s : 6 * s,
          kind: rock ? "rock" : "pine",
          s,
        });
      }
    }
  }

  private addOb(o: Obstacle) {
    this.obstacles.push(o);
    const b = Math.floor(o.z / 10);
    let arr = this.buckets.get(b);
    if (!arr) this.buckets.set(b, (arr = []));
    arr.push(o);
  }

  near(z: number, out: Obstacle[], span = 1) {
    out.length = 0;
    const b = Math.floor(z / 10);
    for (let k = b - span; k <= b + span; k++) {
      const a = this.buckets.get(k);
      if (a) for (const o of a) out.push(o);
    }
    return out;
  }

  private sample(arr: Float32Array, z: number) {
    const f = z + PRE;
    const i = Math.max(0, Math.min(arr.length - 2, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - i));
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }
  cx(z: number) { return this.sample(this.CX, z); }
  w(z: number) { return this.sample(this.W, z); }

  jumpBump(x: number, z: number) {
    let b = 0;
    for (const jp of this.jumps) {
      const s = z - (jp.z - jp.len);
      if (s < 0 || s > jp.len + 0.6) continue;
      const lat = Math.abs(x - jp.x);
      if (lat > jp.w + 4) continue;
      const fall = lat < jp.w ? 1 : 1 - (lat - jp.w) / 4;
      if (s <= jp.len) b += jp.height * Math.pow(s / jp.len, 2.2) * fall;
      else b += jp.height * fall * (1 - (s - jp.len) / 0.6);
    }
    return b;
  }

  height(x: number, z: number) {
    let h = this.sample(this.E, z);
    const c = this.cx(z), w = this.w(z);
    const off = Math.abs(x - c);
    const d = off - w;
    if (d > 0) h += d * 0.32 + d * d * 0.006;
    h += 0.22 * Math.sin(x * 0.23 + z * 0.05) * Math.sin(z * 0.11) + 0.12 * Math.sin(x * 0.7 + z * 0.31);
    const m = this.sample(this.mog, z);
    if (m > 0 && d < 0) h += m * (Math.sin(x * 0.85 + z * 0.15) * Math.sin(z * 0.8));
    h += this.jumpBump(x, z);
    return h;
  }

  normal(x: number, z: number, out: { x: number; y: number; z: number }) {
    const e = 0.25;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    let nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    out.x = nx; out.y = ny; out.z = nz;
    return out;
  }
}
