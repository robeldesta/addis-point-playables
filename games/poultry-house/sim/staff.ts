// The people in the house: two attendants and a vet doing their rounds, plus the
// incidents the AI computer is meant to catch (a feed thief at night, eggs going out the back door).
// Any worker can be taken over by the player, who then gives the orders by tapping.
import { Layout, center, nextWaypoint } from "./layout";
import { DEAD, Flock, GONE, SICK } from "./flock";

export type Pose = "walk" | "stand" | "pour" | "bend" | "kneel" | "rake" | "away";
export type Carry = "" | "bucket" | "tray" | "bag" | "rake";

export interface Step {
  x?: number;
  z?: number;
  bird?: number; // walk to wherever this hen is now
  dur?: number; // minutes to spend once there
  pose?: Pose; // pose while spending that time
  carry?: Carry;
  act?: () => void;
}

export interface Worker {
  id: number;
  name: string;
  role: "attendant" | "vet" | "stranger";
  side: number; // attendants: -1 looks after the left pens, +1 the right
  x: number;
  z: number;
  heading: number;
  pose: Pose;
  carry: Carry;
  doing: string; // a few plain words, e.g. "Filling feeders"
  plan: Step[];
  wait: number;
  inside: boolean;
  manual: boolean; // the player is giving the orders
  eggs: number;
  fedSlot: number; // which feeding slot (day*2 + 0/1) was done last
  eggDay: number;
}

export const WALK = 2.2; // metres per simulated minute (a steady walk at 1x)

export class Staff {
  readonly workers: Worker[];
  private handled = new Set<number>(); // hens the vet is already going to
  eggCamera = false;
  doorCamera = true;
  backDoorCamera = true;
  feedCamera = true;
  private theftDay = -1;
  private eggTheftDay = -1;

  constructor(readonly L: Layout, readonly flock: Flock) {
    const d = L.mainDoor;
    const mk = (id: number, name: string, role: Worker["role"], side: number): Worker => ({
      id, name, role, side, x: d.x, z: d.z + 1, heading: Math.PI, pose: "away", carry: "", doing: "", plan: [], wait: 0,
      inside: false, manual: false, eggs: 0, fedSlot: -1, eggDay: -1,
    });
    this.workers = [
      mk(0, "Attendant 1", "attendant", -1),
      mk(1, "Attendant 2", "attendant", 1),
      mk(2, "Vet", "vet", 0),
      mk(3, "Unknown person", "stranger", 0),
    ];
  }

  private hours(w: Worker): [number, number] {
    if (w.role === "vet") return [7.5, 17.5];
    if (w.role === "stranger") return [-1, -1];
    return [5.75, 18.5];
  }

  step(dt: number): void {
    this.night();
    for (const w of this.workers) this.tick(w, dt);
  }

  // ---------------------------------------------------------------- orders
  // The same building blocks serve the automatic rounds and the player's taps.

  goTo(w: Worker, x: number, z: number, doing = ""): void {
    w.doing = doing;
    w.plan = [{ x, z }];
  }

  /** Walk to a hen and see to her: treat if sick, bag and take out if dead. */
  goHen(w: Worker, i: number): void {
    const f = this.flock, L = this.L;
    this.handled.add(i);
    const dead = f.st[i] === DEAD;
    w.doing = dead ? "Removing a dead hen" : "Checking a hen";
    w.plan = [{ bird: i, carry: "", dur: dead ? 1.5 : 4, pose: "kneel", act: () => {
      this.handled.delete(i);
      if (f.st[i] === SICK) { f.treat(i); w.doing = "Treated a hen"; }
      else if (f.st[i] === DEAD) {
        f.remove(i);
        w.carry = "bag";
        w.doing = "Taking a dead hen out";
        w.plan.push({ x: L.mainDoor.x + 0.8, z: L.mainDoor.z - 0.5, carry: "bag", dur: 0.5, pose: "bend", act: () => {
          w.carry = "";
          w.doing = "";
          f.addLog(`${w.name} took a dead hen out`);
        } });
      } else {
        f.flag[i] &= ~1;
        w.doing = "Hen was fine";
      }
    } }];
  }

  /** Fill these feeders from a bucket, starting and ending at the feed store. */
  goFeed(w: Worker, feeders: number[]): void {
    const L = this.L;
    const fs = center(L.feedStore);
    w.doing = "Filling feeders";
    w.plan = [{ x: fs.x + 1, z: fs.z, carry: "", dur: 1, pose: "bend" }];
    for (const k of feeders) {
      const q = L.feeders[k];
      w.plan.push({ x: q.x + 0.45 * (w.side || 1), z: q.z, carry: "bucket", dur: 0.25, pose: "pour" });
    }
    w.plan.push({ x: fs.x + 1, z: fs.z, carry: "", dur: 0.5, pose: "bend", act: () => (w.doing = "") });
  }

  /** Pour into one feeder (player order). */
  goFeeder(w: Worker, k: number): void {
    const q = this.L.feeders[k];
    w.doing = "Filling a feeder";
    w.plan = [{ x: q.x + 0.45, z: q.z, carry: "bucket", dur: 0.4, pose: "pour", act: () => { w.doing = ""; } }];
  }

  /** Collect from these nest boxes into a tray. */
  goNests(w: Worker, nests: number[], thenTable = true): void {
    const f = this.flock, L = this.L;
    w.doing = "Collecting eggs";
    w.plan = nests.map((k) => {
      const q = L.nests[k];
      return { x: q.x + (q.x < 0 ? 0.8 : -0.8), z: q.z, carry: "tray" as Carry, dur: 0.15, pose: "bend" as Pose, act: () => {
        w.eggs += f.collectNear(q.x, q.z, 0.6);
      } };
    });
    if (thenTable) this.pushTable(w);
  }

  /** Put the tray down at the egg table, where its camera counts it. */
  goTable(w: Worker): void {
    w.doing = "Taking eggs to the table";
    w.plan = [];
    this.pushTable(w);
  }

  private pushTable(w: Worker): void {
    const f = this.flock;
    const et = center(this.L.eggTable);
    w.plan.push({ x: et.x, z: et.z - 0.9, carry: "tray", dur: 1, pose: "bend", act: () => {
      const n = w.eggs;
      const r = f.deliver(n, this.eggCamera);
      f.addLog(`${w.name}: ${n} eggs on the table` + (r.counted ? ` · camera counted ${r.counted}` : ""));
      w.eggs = 0; w.carry = ""; w.doing = "";
    } });
  }

  goRake(w: Worker, x: number, z: number): void {
    w.doing = "Raking wet bedding";
    w.plan = [{ x, z, carry: "rake", dur: 4, pose: "rake", act: () => { this.flock.rake(x, z); w.carry = ""; w.doing = ""; } }];
  }

  takeOver(w: Worker | null): void {
    for (const q of this.workers) {
      if (q.manual && q !== w) { q.manual = false; q.plan = []; q.wait = 0; q.doing = ""; }
    }
    if (!w) return;
    w.manual = true;
    w.plan = []; w.wait = 0; w.doing = "";
    if (!w.inside) {
      w.inside = true;
      w.x = this.L.mainDoor.x; w.z = this.L.mainDoor.z - 0.5; w.pose = "stand";
    }
  }

  // ---------------------------------------------------------------- incidents
  private night(): void {
    const f = this.flock, L = this.L;
    const h = f.minuteOfDay() / 60, day = f.day();
    const s = this.workers[3];
    // Before the morning shift, someone lets themselves in and carries out feed bags.
    const at = day === 1 ? 5.35 : 3 + ((day * 7) % 5) * 0.4;
    if (this.theftDay !== day && h >= at && h < at + 0.5 && !s.inside && !s.manual) {
      this.theftDay = day;
      s.inside = true;
      s.x = L.mainDoor.x; s.z = L.mainDoor.z - 0.5; s.pose = "stand"; s.carry = "";
      const fs = center(L.feedStore);
      const mx = L.mainDoor.x, mz = L.mainDoor.z;
      if (this.doorCamera) f.report("intruder", mx, mz - 1, "Person came in by the main door outside working hours");
      s.doing = "";
      let taken = 0;
      const grab = (): Step => ({ x: fs.x + 1.2, z: fs.z, carry: "", dur: 1.5, pose: "bend", act: () => {
        taken++;
        f.stats.feedBags--;
        s.carry = "bag";
      } });
      const out = (): Step => ({ x: mx, z: mz - 0.3, carry: "bag", dur: 0.4, pose: "bend", act: () => { s.carry = ""; } });
      s.plan = [
        { x: mx + 0.5, z: mz - 2.5, dur: 2, pose: "stand" }, // looks around
        grab(), out(), grab(), out(),
        { x: mx, z: mz - 0.3, dur: 0.1, act: () => {
          s.inside = false; s.pose = "away"; s.doing = "";
          if (this.feedCamera) f.report("feedtheft", fs.x, fs.z, `${taken} feed bags carried out with no feeding round on`);
        } },
      ];
    }
  }

  // ---------------------------------------------------------------- per worker
  private tick(w: Worker, dt: number): void {
    const f = this.flock;
    const h = f.minuteOfDay() / 60;
    const [from, to] = this.hours(w);
    const onShift = h >= from && h < to;

    if (!w.inside) {
      if (!onShift || w.manual) return;
      w.inside = true;
      w.x = this.L.mainDoor.x; w.z = this.L.mainDoor.z - 0.5;
      w.pose = "stand"; w.plan = []; w.wait = 0;
      f.addLog(`${w.name} came in`);
    }
    if (w.role !== "stranger" && !w.manual && !onShift && !w.plan.length && w.doing !== "Going home") {
      w.doing = "Going home";
      w.plan = [{ x: this.L.mainDoor.x, z: this.L.mainDoor.z - 0.4, act: () => {
        w.inside = false; w.pose = "away"; w.doing = "";
        f.addLog(`${w.name} left`);
      } }];
    }
    if (!w.plan.length && !w.manual && w.role !== "stranger") this.choose(w);
    const s = w.plan[0];
    if (!s) { if (w.pose === "walk") w.pose = "stand"; return; }

    // Walk to the step's spot (through the pen gates), then spend its time there.
    if (s.bird !== undefined && f.st[s.bird] === GONE) { w.plan.shift(); w.wait = 0; return; }
    const tx = s.bird !== undefined ? f.x[s.bird] : s.x;
    const tz = s.bird !== undefined ? f.z[s.bird] : s.z;
    if (tx !== undefined && tz !== undefined && w.wait <= 0) {
      const wp = nextWaypoint(this.L, w.x, w.z, tx, tz);
      const direct = wp.x === tx && wp.z === tz;
      const dx = wp.x - w.x, dz = wp.z - w.z;
      const d = Math.hypot(dx, dz);
      const stop = direct && s.bird !== undefined ? 0.45 : 0.05;
      if (d > stop + 0.01 || !direct) {
        const m = Math.min(Math.max(0, d - stop), WALK * dt);
        if (d > 1e-6) { w.x += (dx / d) * m; w.z += (dz / d) * m; }
        if (d > 1e-3) w.heading = Math.atan2(dx, dz);
        w.pose = "walk";
        if (s.carry !== undefined) w.carry = s.carry;
        return;
      }
      if (s.bird !== undefined) w.heading = Math.atan2(dx, dz);
      w.wait = s.dur ?? 0;
      if (w.wait <= 0) w.wait = 1e-6;
    }
    if (w.wait <= 0) w.wait = s.dur ?? 1e-6;
    w.pose = s.pose ?? "stand";
    if (s.carry !== undefined) w.carry = s.carry;
    w.wait -= dt;
    if (w.wait <= 0) {
      w.wait = 0;
      w.plan.shift();
      s.act?.();
    }
  }

  private myPens(w: Worker): number[] {
    return this.L.pens.filter((p) => p.active && (w.side < 0 ? p.x1 <= 0 : p.x0 >= 0)).map((p) => p.id);
  }

  private choose(w: Worker): void {
    const f = this.flock, L = this.L;
    const h = f.minuteOfDay() / 60;
    const day = f.day();
    const r = f.rand;

    if (w.role === "vet") {
      // Go to the nearest hen the cameras flagged that nobody is seeing to.
      let best = -1, bd = Infinity;
      for (const a of f.alerts) {
        if (a.done || a.bird < 0 || this.handled.has(a.bird) || (a.kind !== "sick" && a.kind !== "dead")) continue;
        if (f.st[a.bird] === GONE) continue;
        const d = Math.hypot(f.x[a.bird] - w.x, f.z[a.bird] - w.z);
        if (d < bd) { bd = d; best = a.bird; }
      }
      if (best >= 0) { this.goHen(w, best); return; }
      const p = L.pens.filter((q) => q.active)[Math.floor(r() * 4) % 4];
      w.doing = "Walking the pens";
      w.plan = [
        { x: p.x0 + 1 + r() * (p.x1 - p.x0 - 2), z: p.z0 + 1 + r() * (p.z1 - p.z0 - 2), carry: "" },
        { dur: 3 + r() * 4, pose: "stand" },
      ];
      return;
    }

    // Attendants: feed at 07:00 and 15:00, collect eggs in the morning, rake wet spots, check drinkers.
    const slot = h >= 7 && h < 10 ? day * 2 : h >= 15 && h < 18 ? day * 2 + 1 : -1;
    if (slot >= 0 && w.fedSlot !== slot) {
      w.fedSlot = slot;
      const pens = this.myPens(w);
      const ks = L.feeders.map((_, k) => k).filter((k) => pens.includes(L.feeders[k].pen));
      // Snake along the rows so the walk is short.
      ks.sort((a, b) => {
        const A = L.feeders[a], B = L.feeders[b];
        return Math.round(A.z) - Math.round(B.z) || (Math.round(A.z) % 2 ? B.x - A.x : A.x - B.x);
      });
      this.goFeed(w, ks);
      return;
    }
    if (f.laying && h >= 9.5 && h < 13 && w.eggDay !== day) {
      w.eggDay = day;
      const pens = this.myPens(w);
      const ks = L.nests.map((_, k) => k).filter((k) => pens.includes(L.nests[k].pen)).sort((a, b) => L.nests[b].z - L.nests[a].z);
      // Attendant 2 sometimes slips part of the tray out the back door before the table.
      const steal = w.id === 1 && this.eggTheftDay !== day && (day === 1 || r() < 0.4);
      this.goNests(w, ks, !steal);
      if (steal) {
        this.eggTheftDay = day;
        const bd = L.backDoor;
        let took = 0, picked = 0;
        w.plan.push({ x: bd.x, z: bd.z + 0.6, carry: "tray", dur: 1, pose: "bend", act: () => {
          picked = w.eggs;
          took = Math.min(w.eggs, 30 + Math.floor(r() * 30));
          w.eggs -= took;
          if (this.backDoorCamera) f.report("eggtheft", bd.x, bd.z + 1, `${w.name} took the egg tray to the back door before the egg table`);
        } });
        this.pushTable(w);
        const last = w.plan[w.plan.length - 1];
        const done = last.act!;
        last.act = () => {
          const onTable = w.eggs;
          done();
          if (this.eggCamera && took > 0) {
            const et = center(L.eggTable);
            f.report("eggtheft", et.x, et.z, `${took} eggs missing: ${picked} picked up from the nests, ${onTable} counted at the table`);
          }
        };
      }
      return;
    }
    const wet = f.alerts.find((a) => !a.done && a.kind === "wet" && (w.side < 0 ? a.x < 0 : a.x >= 0));
    if (wet) { this.goRake(w, wet.x, wet.z); return; }
    if (f.lightsOn() && r() < 0.6) {
      const ds = L.drinkers.filter((q) => this.myPens(w).includes(q.pen));
      const q = ds[Math.floor(r() * ds.length)];
      w.doing = "Checking drinkers";
      w.plan = [{ x: q.x + 0.4, z: q.z, carry: "", dur: 1.5, pose: "bend", act: () => { w.doing = ""; } }];
      return;
    }
    w.doing = "";
    const a = L.aisle;
    w.plan = [{ x: a.x0 + 2 + r() * (a.x1 - a.x0 - 4), z: (a.z0 + a.z1) / 2 + (r() - 0.5) * 2, carry: "" }, { dur: 5 + r() * 10, pose: "stand" }];
  }
}
