// The flock: every bird, the eggs, the litter, and what the AI cameras notice.
// Time is in simulated minutes. At 1x speed, one real second is one minute.
import { Layout, Point, inRect } from "./layout";

export const HEALTHY = 0, SICK = 1, DEAD = 2, GONE = 3;
const REST = 0, WANDER = 1, TO_FEED = 2, EAT = 3, TO_DRINK = 4, DRINK = 5, TO_NEST = 6, NEST = 7;

export const SICK_ALERT_MIN = 30; // AI flags a bird that has barely moved for this long
export const DEAD_ALERT_MIN = 10; // AI flags a bird lying still for this long
export const WET_ALERT = 0.75;
export const AMMONIA_ALERT = 20; // ppm

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Cover { covered(x: number, z: number): boolean }
export type AlertKind = "sick" | "dead" | "wet" | "ammonia" | "feed" | "intruder" | "feedtheft" | "eggtheft";
export interface Alert { id: number; kind: AlertKind; bird: number; x: number; z: number; t: number; done: boolean; text: string }
export interface FloorEgg { x: number; z: number; t: number }

export class Flock {
  readonly n: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly head: Float32Array;
  readonly st: Uint8Array;
  readonly pen: Uint8Array;
  readonly mode: Uint8Array;
  readonly hunger: Float32Array;
  readonly thirst: Float32Array;
  readonly act: Float32Array; // recent metres per minute
  readonly low: Float32Array; // minutes of very low activity
  readonly still: Float32Array; // minutes since death
  readonly sickT: Float32Array;
  readonly endAt: Float32Array; // sick: dies (or recovers, if treated) when sickT reaches this
  readonly timer: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly tgt: Int16Array;
  readonly treated: Uint8Array;
  readonly flag: Uint8Array; // 1 = AI flagged sick, 2 = AI flagged dead
  readonly layAt: Float32Array; // minute of today this hen will lay, or -1

  readonly nestEggs: Uint16Array;
  floorEggs: FloorEgg[] = [];
  readonly wet: Float32Array; // litter wetness per 1 m cell, 0 dry .. 1 soaked
  readonly wc: number;
  readonly wr: number;
  private readonly wetFlag: Uint8Array;
  readonly visits: Float32Array; // feeder visits in roughly the last hour
  readonly spill: Float32Array; // how much each drinker leaks into the litter

  time = 6 * 60; // Day 1, 06:00
  weeks = 10;
  alerts: Alert[] = [];
  log: { t: number; text: string }[] = [];
  stats = { died: 0, removed: 0, treated: 0, recovered: 0, laid: 0, floorLaid: 0, floorLost: 0, delivered: 0, aiEggs: 0, cracked: 0, feedBags: 120 };
  today = { laid: 0, delivered: 0, died: 0 };
  yesterday: { laid: number; delivered: number; died: number } | null = null;

  cover: Cover | null = null;
  sensors: Point[] = [];
  doorCam = false;
  feedCam = false;

  private feedersByPen: number[][] = [];
  private drinkersByPen: number[][] = [];
  private nestsByPen: number[][] = [];
  private sensorFlag: Uint8Array = new Uint8Array(0);
  private nextId = 1;
  private wetScan = 0;
  readonly rand: () => number;

  constructor(readonly L: Layout, seed = 7) {
    this.rand = rng(seed);
    const r = this.rand;
    this.n = L.pens.reduce((s, p) => s + (p.active ? p.birds : 0), 0);
    const n = this.n;
    const F = () => new Float32Array(n);
    this.x = F(); this.z = F(); this.head = F(); this.hunger = F(); this.thirst = F();
    this.act = F(); this.low = F(); this.still = F(); this.sickT = F(); this.endAt = F();
    this.timer = F(); this.tx = F(); this.tz = F(); this.layAt = F().fill(-1);
    this.st = new Uint8Array(n); this.pen = new Uint8Array(n); this.mode = new Uint8Array(n);
    this.treated = new Uint8Array(n); this.flag = new Uint8Array(n); this.tgt = new Int16Array(n).fill(-1);

    for (const p of L.pens) {
      this.feedersByPen[p.id] = [];
      this.drinkersByPen[p.id] = [];
      this.nestsByPen[p.id] = [];
    }
    L.feeders.forEach((f, i) => this.feedersByPen[f.pen].push(i));
    L.drinkers.forEach((f, i) => this.drinkersByPen[f.pen].push(i));
    L.nests.forEach((f, i) => this.nestsByPen[f.pen].push(i));
    this.nestEggs = new Uint16Array(L.nests.length);
    this.visits = new Float32Array(L.feeders.length);
    // Most drinkers drip a little; about one in ten leaks badly.
    this.spill = new Float32Array(L.drinkers.length).map(() => (r() < 0.1 ? 0.0005 : 0.00012 + 0.00016 * r()));

    let i = 0;
    for (const p of L.pens) {
      if (!p.active) continue;
      for (let k = 0; k < p.birds; k++, i++) {
        this.pen[i] = p.id;
        this.x[i] = p.x0 + 0.3 + r() * (p.x1 - p.x0 - 0.6);
        this.z[i] = p.z0 + 0.3 + r() * (p.z1 - p.z0 - 0.6);
        this.head[i] = r() * Math.PI * 2;
        this.hunger[i] = r() * 0.6;
        this.thirst[i] = r() * 0.6;
        this.act[i] = 0.3;
        this.timer[i] = r() * 10;
      }
    }

    this.wc = Math.ceil(L.dims.width);
    this.wr = Math.ceil(L.dims.length);
    this.wet = new Float32Array(this.wc * this.wr);
    this.wetFlag = new Uint8Array(this.wc * this.wr);
    for (let c = 0; c < this.wet.length; c++) {
      const cx = -L.hw + (c % this.wc) + 0.5;
      const cz = -L.hl + Math.floor(c / this.wc) + 0.5;
      if (this.penAt(cx, cz) >= 0) this.wet[c] = 0.12 + 0.1 * r();
    }
    for (const d of L.drinkers) {
      const c = this.cell(d.x, d.z);
      if (c >= 0) this.wet[c] = Math.min(1, this.wet[c] + 0.2 + 0.25 * r());
    }

    // Start with a few problems so every role has something to do.
    for (let k = 0; k < 4; k++) {
      const i = Math.floor(r() * n);
      this.makeSick(i, 300 + r() * 600);
      // Already sitting still for a while, so the cameras notice within minutes.
      this.mode[i] = REST; this.timer[i] = 120; this.act[i] = 0; this.low[i] = SICK_ALERT_MIN - 5 - k * 3;
    }
    this.st[Math.floor(r() * n)] = DEAD;
  }

  get laying(): boolean { return this.weeks >= 19; }
  day(): number { return Math.floor(this.time / 1440) + 1; }
  minuteOfDay(): number { return this.time % 1440; }
  lightsOn(): boolean { const h = this.minuteOfDay() / 60; return h >= 5 && h < 21; }
  clock(): string {
    const m = Math.floor(this.minuteOfDay());
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  penAt(x: number, z: number): number {
    for (const p of this.L.pens) if (p.active && inRect(p, x, z)) return p.id;
    return -1;
  }
  cell(x: number, z: number): number {
    const c = Math.floor(x + this.L.hw);
    const r = Math.floor(z + this.L.hl);
    if (c < 0 || r < 0 || c >= this.wc || r >= this.wr) return -1;
    return r * this.wc + c;
  }
  wetAt(x: number, z: number): number { const c = this.cell(x, z); return c < 0 ? 0 : this.wet[c]; }

  setWeeks(w: number): void {
    this.weeks = w;
    if (this.laying) this.planLaying(true);
    else this.layAt.fill(-1);
  }

  /** Put a morning's worth of eggs in the nest boxes, so the egg job can start straight away. */
  fillNests(share = 0.6): void {
    for (const p of this.L.pens) {
      const nests = this.nestsByPen[p.id];
      if (!p.active || !nests.length) continue;
      let left = Math.round(p.birds * share);
      this.stats.laid += left; this.today.laid += left;
      for (let k = 0; left > 0; k = (k + 1) % nests.length) {
        const add = Math.min(left, 1 + Math.floor(this.rand() * 4));
        this.nestEggs[nests[k]] += add;
        left -= add;
      }
    }
  }

  setSensors(points: Point[]): void {
    this.sensors = points;
    this.sensorFlag = new Uint8Array(points.length);
  }

  /** Ammonia estimate in ppm from the litter around a point. */
  ammonia(x: number, z: number, r = 5): number {
    let s = 0, k = 0;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const c = this.cell(x + dx, z + dz);
        if (c < 0 || this.penAt(x + dx, z + dz) < 0) continue;
        s += this.wet[c];
        k++;
      }
    const w = k ? s / k : 0;
    return 3 + 60 * Math.pow(w, 1.2);
  }

  makeSick(i: number, already = 0): void {
    if (this.st[i] !== HEALTHY) return;
    this.st[i] = SICK;
    this.sickT[i] = already;
    this.endAt[i] = already + 1440 * (1.5 + this.rand() * 2); // dies in 1.5-3.5 days untreated
    this.treated[i] = 0;
  }

  // ---------------------------------------------------------------- actions
  treat(i: number): boolean {
    if (this.st[i] !== SICK || this.treated[i]) return false;
    this.treated[i] = 1;
    this.endAt[i] = this.sickT[i] + 720; // well again in 12 hours
    this.stats.treated++;
    this.closeAlerts((a) => a.bird === i && a.kind === "sick");
    return true;
  }
  /** Pick up a dead bird (or cull a sick one). */
  remove(i: number): boolean {
    if (this.st[i] !== DEAD) return false;
    this.st[i] = GONE;
    this.stats.removed++;
    this.closeAlerts((a) => a.bird === i);
    return true;
  }
  rake(x: number, z: number): void {
    for (let dz = -1.5; dz <= 1.5; dz += 1)
      for (let dx = -1.5; dx <= 1.5; dx += 1) {
        const c = this.cell(x + dx, z + dz);
        if (c >= 0) { this.wet[c] *= 0.3; this.wetFlag[c] = 0; }
      }
    this.closeAlerts((a) => a.kind === "wet" && Math.hypot(a.x - x, a.z - z) < 2.5);
  }
  collectNear(x: number, z: number, r: number): number {
    let got = 0;
    this.L.nests.forEach((s, k) => {
      if (this.nestEggs[k] && Math.hypot(s.x - x, s.z - z) <= r) { got += this.nestEggs[k]; this.nestEggs[k] = 0; }
    });
    this.floorEggs = this.floorEggs.filter((e) => {
      if (Math.hypot(e.x - x, e.z - z) <= r) { got++; return false; }
      return true;
    });
    return got;
  }
  /** Eggs put on the egg table. Returns what the egg table camera counted. */
  deliver(n: number, camera: boolean): { counted: number; cracked: number } {
    this.stats.delivered += n;
    this.today.delivered += n;
    if (!camera) return { counted: 0, cracked: 0 };
    let cracked = 0;
    for (let k = 0; k < n; k++) if (this.rand() < 0.015) cracked++;
    this.stats.aiEggs += n;
    this.stats.cracked += cracked;
    return { counted: n, cracked };
  }
  nearestBird(x: number, z: number, r: number, want: (s: number) => boolean): number {
    let best = -1, bd = r * r;
    for (let i = 0; i < this.n; i++) {
      if (!want(this.st[i])) continue;
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  addLog(text: string): void {
    this.log.unshift({ t: this.time, text });
    if (this.log.length > 60) this.log.length = 60;
  }
  /** Something the AI computer noticed outside the flock itself (people, theft). */
  report(kind: AlertKind, x: number, z: number, text: string): void { this.alert(kind, -1, x, z, text); }
  private alert(kind: AlertKind, bird: number, x: number, z: number, text: string): void {
    this.alerts.unshift({ id: this.nextId++, kind, bird, x, z, t: this.time, done: false, text });
    if (this.alerts.length > 200) this.alerts.length = 200;
  }
  private closeAlerts(f: (a: Alert) => boolean): void {
    for (const a of this.alerts) if (!a.done && f(a)) a.done = true;
  }
  penName(x: number, z: number): string {
    const p = this.penAt(x, z);
    return p < 0 ? "aisle" : this.L.pens[p].name;
  }

  // ---------------------------------------------------------------- simulation
  step(dt: number): void {
    while (dt > 1e-9) {
      const h = Math.min(dt, 0.25);
      this.tick(h);
      dt -= h;
    }
  }

  private crossed(prev: number, minuteOfDay: number): boolean {
    return Math.floor((prev - minuteOfDay) / 1440) !== Math.floor((this.time - minuteOfDay) / 1440);
  }

  private planLaying(todayOnly = false): void {
    const now = this.minuteOfDay();
    for (let i = 0; i < this.n; i++) {
      this.layAt[i] = -1;
      if (this.st[i] !== HEALTHY || this.rand() > 0.88) continue;
      const t = 6 * 60 + this.rand() * 5 * 60; // 06:00 - 11:00
      if (!todayOnly || t > now) this.layAt[i] = t;
    }
  }

  private refill(): void {
    let alive = 0;
    for (let i = 0; i < this.n; i++) if (this.st[i] < DEAD) alive++;
    const kg = alive * 0.11 / 2; // two feeds a day, about 110 g per bird per day
    const bags = Math.ceil(kg / 50);
    this.stats.feedBags -= bags;
    this.addLog(`Feeders refilled: ${bags} bags (${Math.round(kg)} kg) out of the store` + (this.feedCam ? " · counted by aisle camera" : " · not seen, no aisle camera"));
    if (this.stats.feedBags < 20) {
      this.alert("feed", -1, (this.L.feedStore.x0 + this.L.feedStore.x1) / 2, (this.L.feedStore.z0 + this.L.feedStore.z1) / 2,
        `Feed store low: ${Math.max(0, this.stats.feedBags)} bags left`);
      this.stats.feedBags += 120;
      this.addLog("Feed delivery: 120 bags in");
    }
  }

  private tick(dt: number): void {
    const prev = this.time;
    this.time += dt;
    const r = this.rand;
    if (this.crossed(prev, 0)) {
      this.addLog(`Day ${this.day() - 1} closed: ${this.today.laid} eggs laid, ${this.today.delivered} counted at the table, ${this.today.died} died`);
      this.yesterday = this.today;
      this.today = { laid: 0, delivered: 0, died: 0 };
      if (this.laying) this.planLaying();
    }
    if (this.crossed(prev, 7 * 60) || this.crossed(prev, 15 * 60)) this.refill();

    const light = this.lightsOn();
    const mod = this.minuteOfDay();
    const L = this.L;

    // New illness: about 4 birds a day, more where the litter is wet.
    if (r() < (4 / 1440) * dt * (this.n / 7000)) {
      const i = Math.floor(r() * this.n);
      if (this.st[i] === HEALTHY && r() < 0.3 + 0.7 * this.wetAt(this.x[i], this.z[i])) this.makeSick(i);
    }

    const cov = this.cover;
    for (let i = 0; i < this.n; i++) {
      const s = this.st[i];
      if (s === GONE) continue;
      if (s === DEAD) {
        this.still[i] += dt;
        if (light && cov && !(this.flag[i] & 2) && this.still[i] >= DEAD_ALERT_MIN && cov.covered(this.x[i], this.z[i])) {
          this.flag[i] |= 2;
          this.alert("dead", i, this.x[i], this.z[i], `Dead bird · ${this.penName(this.x[i], this.z[i])}`);
        }
        continue;
      }
      const sick = s === SICK;
      if (sick) {
        this.sickT[i] += dt;
        if (this.sickT[i] >= this.endAt[i]) {
          if (this.treated[i]) {
            this.st[i] = HEALTHY;
            this.flag[i] &= ~1;
            this.stats.recovered++;
          } else {
            this.st[i] = DEAD;
            this.still[i] = 0;
            this.mode[i] = REST;
            this.stats.died++;
            this.today.died++;
            continue;
          }
        }
      }
      if (light) {
        this.hunger[i] = Math.min(1, this.hunger[i] + dt / (sick ? 400 : 90));
        this.thirst[i] = Math.min(1, this.thirst[i] + dt / (sick ? 300 : 60));
      }

      // Laying: off to a nest box (most of the time) or drop it on the floor.
      if (this.layAt[i] >= 0 && mod >= this.layAt[i] && !sick) {
        this.layAt[i] = -1;
        const nests = this.nestsByPen[this.pen[i]];
        if (nests.length && r() < 0.95) {
          let best = nests[Math.floor(r() * nests.length)];
          for (let k = 0; k < 2; k++) {
            const c = nests[Math.floor(r() * nests.length)];
            if (this.d2(i, L.nests[c]) < this.d2(i, L.nests[best])) best = c;
          }
          this.goTo(i, TO_NEST, best, L.nests[best].x + (L.nests[best].x < 0 ? 0.35 : -0.35), L.nests[best].z + (r() - 0.5) * 0.6);
        } else {
          this.floorEggs.push({ x: this.x[i], z: this.z[i], t: this.time });
          this.stats.laid++; this.stats.floorLaid++; this.today.laid++;
        }
      }

      let moved = 0;
      const m = this.mode[i];
      if (!light && m !== REST) { this.mode[i] = REST; this.timer[i] = 30 + r() * 60; }
      else if (m === REST) { this.timer[i] -= dt; if (this.timer[i] <= 0) this.decide(i, light); }
      else if (m === EAT) { this.hunger[i] -= dt / 4; if (this.hunger[i] <= 0.05) this.decide(i, light); }
      else if (m === DRINK) { this.thirst[i] -= dt / 2; if (this.thirst[i] <= 0.05) this.decide(i, light); }
      else if (m === NEST) {
        this.timer[i] -= dt;
        if (this.timer[i] <= 0) {
          const k = this.tgt[i];
          if (k >= 0 && this.nestEggs[k] < 60000) this.nestEggs[k]++;
          this.stats.laid++; this.today.laid++;
          this.decide(i, light);
        }
      } else {
        const dx = this.tx[i] - this.x[i], dz = this.tz[i] - this.z[i];
        const d = Math.hypot(dx, dz);
        const stepLen = (sick ? 0.1 : 0.45) * dt;
        if (d <= stepLen) {
          this.x[i] = this.tx[i]; this.z[i] = this.tz[i]; moved = d;
          if (m === TO_FEED) { this.mode[i] = EAT; this.visits[this.tgt[i]] += 1; }
          else if (m === TO_DRINK) this.mode[i] = DRINK;
          else if (m === TO_NEST) { this.mode[i] = NEST; this.timer[i] = 5 + r() * 10; }
          else { this.mode[i] = REST; this.timer[i] = sick ? 10 : 1 + r() * 3; }
        } else {
          this.x[i] += (dx / d) * stepLen; this.z[i] += (dz / d) * stepLen; moved = stepLen;
          this.head[i] = Math.atan2(dx, dz);
        }
        if (m === TO_DRINK || m === WANDER || m === TO_FEED) {
          const c = this.cell(this.x[i], this.z[i]);
          if (c >= 0) this.wet[c] = Math.min(1, this.wet[c] + 0.00001 * dt);
        }
      }

      // Activity tracking, exactly what an overhead camera can measure.
      this.act[i] += (moved / dt - this.act[i]) * Math.min(1, dt / 8);
      if (!light) this.low[i] = 0;
      else if (this.act[i] < 0.04) this.low[i] += dt;
      else this.low[i] = 0;

      if (light && cov && !(this.flag[i] & 1) && this.low[i] >= SICK_ALERT_MIN && cov.covered(this.x[i], this.z[i])) {
        this.flag[i] |= 1;
        this.alert("sick", i, this.x[i], this.z[i], `Bird barely moving for ${SICK_ALERT_MIN}+ min · ${this.penName(this.x[i], this.z[i])}`);
      }
      // A flagged bird that turns out fine clears itself.
      if ((this.flag[i] & 1) && this.st[i] === HEALTHY && this.low[i] === 0 && this.act[i] > 0.2) {
        this.flag[i] &= ~1;
        this.closeAlerts((a) => a.bird === i && a.kind === "sick");
      }
    }

    // Litter: drinkers spill, birds add droppings, ventilation dries it.
    for (let c = 0; c < this.wet.length; c++) this.wet[c] *= 1 - 0.0004 * dt;
    for (let k = 0; k < this.L.drinkers.length; k++) {
      const d = this.L.drinkers[k];
      const c = this.cell(d.x, d.z);
      if (c >= 0) this.wet[c] = Math.min(1, this.wet[c] + this.spill[k] * dt);
    }
    for (let k = 0; k < this.visits.length; k++) this.visits[k] *= 1 - dt / 60;

    // Floor eggs left more than 6 hours get dirty or broken.
    if (this.floorEggs.length && this.floorEggs[0].t < this.time - 360) {
      const before = this.floorEggs.length;
      this.floorEggs = this.floorEggs.filter((e) => e.t >= this.time - 360);
      this.stats.floorLost += before - this.floorEggs.length;
    }

    this.wetScan += dt;
    if (this.wetScan >= 10) {
      this.wetScan = 0;
      for (let c = 0; c < this.wet.length; c++) {
        const cx = -L.hw + (c % this.wc) + 0.5, cz = -L.hl + Math.floor(c / this.wc) + 0.5;
        if (this.wet[c] > WET_ALERT && !this.wetFlag[c] && cov && cov.covered(cx, cz)) {
          this.wetFlag[c] = 1;
          this.alert("wet", -1, cx, cz, `Wet litter patch · ${this.penName(cx, cz)}`);
        } else if (this.wet[c] < 0.5) this.wetFlag[c] = 0;
      }
      this.sensors.forEach((s, k) => {
        const ppm = this.ammonia(s.x, s.z);
        if (ppm > AMMONIA_ALERT && !this.sensorFlag[k]) {
          this.sensorFlag[k] = 1;
          this.alert("ammonia", -1, s.x, s.z, `Ammonia ${Math.round(ppm)} ppm · ${this.penName(s.x, s.z)}`);
        } else if (ppm < AMMONIA_ALERT - 4) this.sensorFlag[k] = 0;
      });
    }
  }

  private d2(i: number, p: Point): number { return (this.x[i] - p.x) ** 2 + (this.z[i] - p.z) ** 2; }

  private goTo(i: number, mode: number, tgt: number, x: number, z: number): void {
    const p = this.L.pens[this.pen[i]];
    this.mode[i] = mode;
    this.tgt[i] = tgt;
    this.tx[i] = Math.min(p.x1 - 0.2, Math.max(p.x0 + 0.2, x));
    this.tz[i] = Math.min(p.z1 - 0.2, Math.max(p.z0 + 0.2, z));
  }

  private pickNear(i: number, list: number[], spots: Point[]): number {
    let best = list[Math.floor(this.rand() * list.length)];
    for (let k = 0; k < 3; k++) {
      const c = list[Math.floor(this.rand() * list.length)];
      if (this.d2(i, spots[c]) < this.d2(i, spots[best])) best = c;
    }
    return best;
  }

  private decide(i: number, light: boolean): void {
    const r = this.rand;
    const sick = this.st[i] === SICK;
    if (!light) { this.mode[i] = REST; this.timer[i] = 20 + r() * 40; return; }
    const pen = this.pen[i];
    const feeders = this.feedersByPen[pen], drinkers = this.drinkersByPen[pen];
    if (this.hunger[i] > 0.6 && feeders.length && (!sick || r() < 0.3)) {
      const f = this.pickNear(i, feeders, this.L.feeders);
      const a = r() * Math.PI * 2;
      this.goTo(i, TO_FEED, f, this.L.feeders[f].x + Math.sin(a) * 0.34, this.L.feeders[f].z + Math.cos(a) * 0.34);
      return;
    }
    if (this.thirst[i] > 0.6 && drinkers.length && (!sick || r() < 0.4)) {
      const f = this.pickNear(i, drinkers, this.L.drinkers);
      const a = r() * Math.PI * 2;
      this.goTo(i, TO_DRINK, f, this.L.drinkers[f].x + Math.sin(a) * 0.27, this.L.drinkers[f].z + Math.cos(a) * 0.27);
      return;
    }
    if (r() < (sick ? 0.8 : 0.5)) {
      this.mode[i] = REST;
      this.timer[i] = sick ? 20 + r() * 70 : 2 + r() * 12;
      return;
    }
    const p = this.L.pens[pen];
    let tx = this.x[i] + (r() - 0.5) * 5;
    let tz = this.z[i] + (r() - 0.5) * 5;
    if (sick) {
      // Sick birds drift away from the flock, toward a wall.
      const toX = this.x[i] - p.x0 < p.x1 - this.x[i] ? p.x0 : p.x1;
      tx = this.x[i] + (toX - this.x[i]) * 0.3;
      tz = this.z[i] + (r() - 0.5) * 1.5;
    }
    this.goTo(i, WANDER, -1, tx, tz);
  }
}
