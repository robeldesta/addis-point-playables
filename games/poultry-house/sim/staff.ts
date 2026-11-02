// The farm staff: two attendants and a vet who come in, do their rounds and go home.
// They work on the same flock the cameras watch, so what they do shows up on the feeds.
import { Layout, center, nextWaypoint } from "./layout";
import { DEAD, Flock, GONE, SICK } from "./flock";

export type Pose = "walk" | "stand" | "pour" | "bend" | "kneel" | "rake" | "away";
export type Carry = "" | "bucket" | "tray" | "bag" | "rake";

interface Step {
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
  role: "attendant" | "vet";
  side: number; // attendants: -1 looks after the left pens, +1 the right
  x: number;
  z: number;
  heading: number;
  pose: Pose;
  carry: Carry;
  doing: string; // plain words for the label, e.g. "Filling feeders"
  plan: Step[];
  wait: number;
  inside: boolean;
  eggs: number;
  fedSlot: number; // which feeding slot (day*2 + 0/1) was done last
  eggDay: number;
}

const WALK = 2.2; // metres per simulated minute (looks like a steady walk at 1x)

export class Staff {
  readonly workers: Worker[];
  private handled = new Set<number>(); // hens the vet is already going to
  eggCamera = false;
  benched = -1; // the worker the player is standing in for stays off the floor

  constructor(readonly L: Layout, readonly flock: Flock) {
    const d = L.mainDoor;
    const mk = (id: number, name: string, role: Worker["role"], side: number): Worker => ({
      id, name, role, side, x: d.x, z: d.z + 1, heading: Math.PI, pose: "away", carry: "", doing: "", plan: [], wait: 0,
      inside: false, eggs: 0, fedSlot: -1, eggDay: -1,
    });
    this.workers = [mk(0, "Attendant 1", "attendant", -1), mk(1, "Attendant 2", "attendant", 1), mk(2, "Vet", "vet", 0)];
  }

  private hours(w: Worker): [number, number] {
    return w.role === "vet" ? [7.5, 17.5] : [5.75, 18.5];
  }

  step(dt: number): void {
    for (const w of this.workers) this.tick(w, dt);
  }

  private tick(w: Worker, dt: number): void {
    const f = this.flock;
    if (w.id === this.benched) {
      if (w.inside) { w.inside = false; w.pose = "away"; w.plan = []; w.doing = ""; w.carry = ""; }
      return;
    }
    const h = f.minuteOfDay() / 60;
    const [from, to] = this.hours(w);
    const onShift = h >= from && h < to;

    if (!w.inside) {
      if (!onShift) return;
      w.inside = true;
      w.x = this.L.mainDoor.x; w.z = this.L.mainDoor.z - 0.5;
      w.pose = "stand"; w.plan = []; w.wait = 0;
      f.addLog(`${w.name} came in` + (f.doorCam ? " · seen by door camera" : ""));
    }
    if (!onShift && !w.plan.length && w.doing !== "Going home") {
      w.doing = "Going home";
      w.plan = [{ x: this.L.mainDoor.x, z: this.L.mainDoor.z - 0.4, act: () => {
        w.inside = false; w.pose = "away"; w.doing = "";
        f.addLog(`${w.name} left` + (f.doorCam ? " · seen by door camera" : ""));
      } }];
    }
    if (!w.plan.length) this.choose(w);
    const s = w.plan[0];
    if (!s) return;

    // Walk to the step's spot, then spend its time there.
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
      if (best >= 0) {
        const i = best;
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
              f.addLog(`${w.name} took a dead hen out` + (f.doorCam ? " · seen by door camera" : ""));
            } });
          } else {
            f.flag[i] &= ~1;
            w.doing = "Hen was fine";
          }
        } }];
        return;
      }
      // Otherwise walk slowly along a pen, looking at the flock.
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
      const feeders = L.feeders.filter((q) => pens.includes(q.pen));
      // Snake along the rows so the walk is short.
      feeders.sort((a, b) => Math.round(a.z) - Math.round(b.z) || (Math.round(a.z) % 2 ? b.x - a.x : a.x - b.x));
      const fs = center(L.feedStore);
      w.doing = "Filling feeders";
      w.plan = [{ x: fs.x + 1, z: fs.z, carry: "", dur: 1, pose: "bend" }];
      feeders.forEach((q) => w.plan.push({ x: q.x + 0.45 * Math.sign(w.side || 1), z: q.z, carry: "bucket", dur: 0.25, pose: "pour" }));
      w.plan.push({ x: fs.x + 1, z: fs.z, carry: "", dur: 0.5, pose: "bend", act: () => (w.doing = "") });
      return;
    }
    if (f.laying && h >= 9.5 && h < 13 && w.eggDay !== day) {
      w.eggDay = day;
      const pens = this.myPens(w);
      const nests = L.nests.filter((q) => pens.includes(q.pen)).sort((a, b) => b.z - a.z);
      const et = center(L.eggTable);
      w.doing = "Collecting eggs";
      w.plan = nests.map((q) => ({ x: q.x + (q.x < 0 ? 0.8 : -0.8), z: q.z, carry: "tray" as Carry, dur: 0.15, pose: "bend" as Pose, act: () => {
        w.eggs += f.collectNear(q.x, q.z, 0.6);
      } }));
      w.plan.push({ x: et.x, z: et.z - 0.9, carry: "tray", dur: 1, pose: "bend", act: () => {
        const r2 = f.deliver(w.eggs, this.eggCamera);
        f.addLog(`${w.name} put ${w.eggs} eggs on the table` + (r2.counted ? ` · camera counted ${r2.counted}` : " · no camera, counted by hand"));
        w.eggs = 0; w.carry = ""; w.doing = "";
      } });
      return;
    }
    const wet = f.alerts.find((a) => !a.done && a.kind === "wet" && (w.side < 0 ? a.x < 0 : a.x >= 0));
    if (wet) {
      w.doing = "Raking wet bedding";
      w.plan = [{ x: wet.x, z: wet.z, carry: "rake", dur: 4, pose: "rake", act: () => { f.rake(wet.x, wet.z); w.carry = ""; } }];
      return;
    }
    if (f.lightsOn() && r() < 0.6) {
      const ds = L.drinkers.filter((q) => this.myPens(w).includes(q.pen));
      const q = ds[Math.floor(r() * ds.length)];
      w.doing = "Checking drinkers";
      w.plan = [{ x: q.x + 0.4, z: q.z, carry: "", dur: 1.5, pose: "bend" }];
      return;
    }
    w.doing = "";
    const a = L.aisle;
    w.plan = [{ x: a.x0 + 2 + r() * (a.x1 - a.x0 - 4), z: (a.z0 + a.z1) / 2 + (r() - 0.5) * 2, carry: "" }, { dur: 5 + r() * 10, pose: "stand" }];
  }
}
