// The people in the house: two attendants and a vet doing their rounds, plus the
// incidents the AI computer is meant to catch (a feed thief at night, eggs going out the back door).
// Any worker can be taken over by the player, who then gives the orders by tapping.
import { Layout, center, nextWaypoint } from "./layout";
import { DEAD, Flock, GONE, SICK } from "./flock";
import { BAG_KG, CRATE, MANURE_KG, Records } from "./records";

export type Pose = "walk" | "stand" | "pour" | "bend" | "kneel" | "rake" | "away";
export type Carry = "" | "bucket" | "tray" | "bag" | "rake";

export interface Step {
  x?: number;
  z?: number;
  bird?: number; // walk to wherever this hen is now
  dur?: number; // minutes to spend once there
  pose?: Pose; // pose while spending that time
  carry?: Carry;
  brisk?: boolean; // quick steps between feeders on a round
  act?: () => void;
}

export interface Worker {
  id: number;
  name: string;
  role: "attendant" | "vet" | "stranger" | "visitor";
  title: string; // job as the AI computer knows it
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
  litterDay: number;
  sacks: number; // litter sacks raked up and not yet weighed
  kg: number;
}

export const EGG_CART = 360; // 12 trays of 30
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
  private supplyDay = -1;
  private buyDay = -1;
  private fertDay = -1;
  private dayNo: number;
  private grn = 0;
  private waybill = 0;
  readonly rec: Records;

  constructor(readonly L: Layout, readonly flock: Flock) {
    const d = L.mainDoor;
    const mk = (id: number, name: string, role: Worker["role"], side: number, title: string): Worker => ({
      id, name, role, side, title, x: d.x, z: d.z + 1, heading: Math.PI, pose: "away", carry: "", doing: "", plan: [], wait: 0,
      inside: false, manual: false, eggs: 0, fedSlot: -1, eggDay: -1, litterDay: -1, sacks: 0, kg: 0,
    });
    this.workers = [
      mk(0, "Abebe Kebede", "attendant", -1, "Attendant · Pens 1 and 3"),
      mk(1, "Tigist Alemu", "attendant", 1, "Attendant · Pens 2 and 4"),
      mk(2, "Dr. Selam Haile", "vet", 0, "Vet"),
      mk(3, "Unknown person", "stranger", 0, "Not on the staff list"),
      mk(4, "Dawit Tesfaye", "visitor", 0, "Feed supplier"),
      mk(5, "Hana Girma", "visitor", 0, "Egg buyer"),
      mk(6, "Yonas Bekele", "visitor", 0, "Fertilizer plant"),
    ];
    this.rec = new Records(flock.stats.feedBags);
    this.dayNo = flock.day();
  }

  private hours(w: Worker): [number, number] {
    if (w.role === "vet") return [7.5, 17.5];
    if (w.role === "stranger" || w.role === "visitor") return [-1, -1];
    return [5.75, 18.5];
  }

  step(dt: number): void {
    const f = this.flock;
    if (f.day() !== this.dayNo) { this.dayNo = f.day(); this.rec.newDay(); }
    this.rec.litterInHouse += ((f.n - f.stats.died) * MANURE_KG * dt) / 1440;
    this.night();
    this.visitors();
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
    const dur = dead ? 1.5 : 4;
    w.plan = [{ bird: i, carry: "", dur, pose: "kneel", act: () => {
      this.handled.delete(i);
      const k = this.rec.of(w.id);
      k.checked++;
      const a = f.alerts.find((q) => q.bird === i && !q.done);
      if (a && w.role === "vet") k.response.push(Math.max(0, f.time - dur - a.t));
      if (f.st[i] === SICK) k.treated++;
      else if (f.st[i] === DEAD) k.removed++;
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
        f.cleared(i);
        w.doing = "Hen was fine";
      }
    } }];
  }

  /** Fill these feeders from a bucket, starting and ending at the feed store. */
  goFeed(w: Worker, feeders: number[]): void {
    const L = this.L;
    const fs = center(L.feedStore);
    w.doing = "Filling feeders";
    const f = this.flock, rec = this.rec;
    // About 110 g a hen a day in two rounds, shared by the two attendants: so many bags leave the store now.
    const share = this.L.feeders.length ? feeders.length / this.L.feeders.length : 0;
    const bags = Math.max(1, Math.ceil(((f.n - f.stats.died) * 0.11 * share) / 2 / BAG_KG));
    w.plan = [{ x: fs.x + 1, z: fs.z, carry: "", dur: 1, pose: "bend", act: () => {
      f.stats.feedBags -= bags;
      rec.feedRow(f.time, "Issued", -bags, w.name, `Feeding round · ${feeders.length} feeders`, this.feedCamera);
      rec.of(w.id).bags += bags;
    } }];
    for (const k of feeders) {
      const q = L.feeders[k];
      w.plan.push({ x: q.x + 0.45 * (w.side || 1), z: q.z, carry: "bucket", dur: 0.12, pose: "pour", brisk: true, act: () => { rec.of(w.id).feeders++; } });
    }
    w.plan.push({ x: fs.x + 1, z: fs.z, carry: "", dur: 0.5, pose: "bend", act: () => (w.doing = "") });
  }

  /** Pour into one feeder (player order). */
  goFeeder(w: Worker, k: number): void {
    const q = this.L.feeders[k];
    w.doing = "Filling a feeder";
    w.plan = [{ x: q.x + 0.45, z: q.z, carry: "bucket", dur: 0.4, pose: "pour", act: () => { w.doing = ""; this.rec.of(w.id).feeders++; } }];
  }

  /** Collect from these nest boxes into a tray. */
  goNests(w: Worker, nests: number[], thenTable = true): void {
    const f = this.flock, L = this.L;
    w.doing = "Collecting eggs";
    w.plan = nests.map((k) => {
      const q = L.nests[k];
      return { x: q.x + (q.x < 0 ? 0.8 : -0.8), z: q.z, carry: "tray" as Carry, dur: 0.15, pose: "bend" as Pose, act: () => {
        const got = f.collectNear(q.x, q.z, 0.6);
        w.eggs += got;
        this.rec.of(w.id).eggs += got;
        // A full cart (12 trays) goes to the table to be counted before carrying on.
        if (w.eggs >= EGG_CART && thenTable) w.plan.unshift(this.tableStep(w, true));
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
    w.plan.push(this.tableStep(w, false));
  }
  private tableStep(w: Worker, more: boolean): Step {
    const f = this.flock;
    const et = center(this.L.eggTable);
    return { x: et.x, z: et.z - 0.9, carry: "tray", dur: 1, pose: "bend", act: () => {
      const n = w.eggs;
      const r = f.deliver(n, this.eggCamera);
      f.addLog(`${w.name}: ${n} eggs on the table` + (r.counted ? ` · camera counted ${r.counted}` : ""));
      if (n > 0) {
        this.rec.eggRow(f.time, "Counted at table", n, w.name, `${(n / 30).toFixed(1)} trays` + (r.cracked ? ` · ${r.cracked} cracked` : ""), this.eggCamera);
        this.rec.of(w.id).trips++;
      }
      w.eggs = 0;
      if (!more) { w.carry = ""; w.doing = ""; }
    } };
  }

  goRake(w: Worker, x: number, z: number): void {
    w.doing = "Raking wet bedding";
    w.plan = [{ x, z, carry: "rake", dur: 4, pose: "rake", act: () => { this.flock.rake(x, z); this.rec.of(w.id).raked++; w.carry = ""; w.doing = ""; } }];
  }

  /** Clean out caked litter under the drinkers into sacks and weigh them at the scale. */
  goLitter(w: Worker, spots: { x: number; z: number }[]): void {
    const f = this.flock, sc = this.L.litterScale;
    w.doing = "Cleaning out litter";
    w.plan = spots.map((q) => ({ x: q.x + 0.6, z: q.z, carry: "rake" as Carry, dur: 3, pose: "rake" as Pose, act: () => {
      f.rake(q.x, q.z);
      w.sacks++;
      w.kg += Math.round(32 + f.rand() * 12);
    } }));
    w.plan.push({ x: sc.x, z: sc.z - 0.7, carry: "bag", dur: 1.2, pose: "bend", act: () => this.weighLitter(w) });
  }

  private weighLitter(w: Worker): void {
    if (w.sacks > 0) {
      const k = this.rec.of(w.id);
      k.sacks += w.sacks; k.kg += w.kg;
      this.rec.litterRow(this.flock.time, "Weighed out", w.kg, w.sacks, w.name, w.side < 0 ? "Pens 1 and 3 · under drinkers" : "Pens 2 and 4 · under drinkers", this.doorCamera);
      this.flock.addLog(`${w.name}: ${w.sacks} litter sacks weighed, ${w.kg} kg`);
    }
    w.sacks = 0; w.kg = 0; w.carry = ""; w.doing = "";
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
      f.addLog(`${s.name} came in`);
      if (this.doorCamera) f.report("intruder", mx, mz - 1, "Person came in by the main door outside working hours");
      s.doing = "";
      let taken = 0;
      const grab = (): Step => ({ x: fs.x + 1.2, z: fs.z, carry: "", dur: 1.5, pose: "bend", act: () => {
        taken++;
        f.stats.feedBags--;
        this.rec.feedRow(f.time, "Taken, not booked", -1, s.name, "Outside working hours · no feeding round", this.feedCamera);
        s.carry = "bag";
      } });
      const out = (): Step => ({ x: mx, z: mz - 0.3, carry: "bag", dur: 0.4, pose: "bend", act: () => { s.carry = ""; } });
      s.plan = [
        { x: mx + 0.5, z: mz - 2.5, dur: 2, pose: "stand" }, // looks around
        grab(), out(), grab(), out(),
        { x: mx, z: mz - 0.3, dur: 0.1, act: () => {
          s.inside = false; s.pose = "away"; s.doing = "";
          f.addLog(`${s.name} left`);
          if (this.feedCamera) f.report("feedtheft", fs.x, fs.z, `${taken} feed bags carried out with no feeding round on`);
        } },
      ];
    }
  }

  // ---------------------------------------------------------------- visitors
  // People from outside who come in by the main door and whose every load is booked.
  private enter(v: Worker): void {
    const d = this.L.mainDoor;
    v.inside = true;
    v.x = d.x; v.z = d.z - 0.5; v.pose = "stand"; v.carry = ""; v.wait = 0;
    this.flock.addLog(`${v.name} (${v.title}) came in`);
  }
  private leave(v: Worker): Step {
    const d = this.L.mainDoor;
    return { x: d.x, z: d.z - 0.3, dur: 0.1, act: () => { v.inside = false; v.pose = "away"; v.doing = ""; v.carry = ""; this.flock.addLog(`${v.name} left`); } };
  }

  private visitors(): void {
    const f = this.flock, L = this.L, rec = this.rec;
    const h = f.minuteOfDay() / 60, day = f.day();
    const d = L.mainDoor;
    const atDoor = (v: Worker, carry: Carry): Step => ({ x: d.x + 0.3, z: d.z - 0.4, carry, dur: 0.4, pose: "bend" });

    // Feed supplier: unloads 40 bags in five trips, each one booked against the receipt.
    const sup = this.workers[4];
    if (!sup.inside && this.supplyDay !== day && h >= 11 && h < 12 && (day === 1 || rec.book < 50)) {
      this.supplyDay = day;
      this.enter(sup);
      const grn = `GRN-${String(++this.grn).padStart(4, "0")}`;
      const fs = center(L.feedStore);
      sup.doing = `Delivering feed · ${grn}`;
      sup.plan = [];
      for (let k = 1; k <= 5; k++) {
        sup.plan.push(atDoor(sup, ""));
        sup.plan.push({ x: fs.x + 1.2, z: fs.z + 0.3, carry: "bag", dur: 0.6, pose: "bend", act: () => {
          f.stats.feedBags += 8;
          rec.feedRow(f.time, "Delivery", 8, sup.name, `${grn} · load ${k} of 5`, this.feedCamera);
          sup.carry = "";
        } });
      }
      sup.plan.push(this.leave(sup));
    }

    // Egg buyer: takes every full crate on the table, four crates a trip.
    const buy = this.workers[5];
    if (!buy.inside && this.buyDay !== day && h >= 16.5 && h < 17.5 && rec.store >= CRATE) {
      this.buyDay = day;
      this.enter(buy);
      const wb = `WB-${String(++this.waybill).padStart(4, "0")}`;
      const et = center(L.eggTable);
      const trips = Math.min(4, Math.ceil(Math.floor(rec.store / CRATE) / 4));
      buy.doing = `Picking up eggs · ${wb}`;
      buy.plan = [];
      for (let k = 1; k <= trips; k++) {
        buy.plan.push({ x: et.x, z: et.z + 0.9, carry: "", dur: 1, pose: "bend", act: () => {
          const crates = Math.min(4, Math.floor(rec.store / CRATE));
          if (crates > 0) rec.eggRow(f.time, "Picked up", -crates * CRATE, buy.name, `${wb} · ${crates} crates`, this.eggCamera);
          buy.carry = "tray";
        } });
        buy.plan.push(atDoor(buy, "tray"));
      }
      buy.plan.push(this.leave(buy));
    }

    // Fertilizer plant: collects the weighed litter sacks as one production batch.
    const fer = this.workers[6];
    if (!fer.inside && this.fertDay !== day && h >= 17.5 && h < 18.5 && rec.litterSacks > 0) {
      this.fertDay = day;
      this.enter(fer);
      const batch = `FB-${String(++rec.batches).padStart(4, "0")}`;
      const sc = L.litterScale;
      const trips = Math.min(4, Math.ceil(rec.litterSacks / 4));
      fer.doing = `Collecting litter · ${batch}`;
      fer.plan = [];
      for (let k = 1; k <= trips; k++) {
        fer.plan.push({ x: sc.x + 0.6, z: sc.z + 0.3, carry: "", dur: 0.8, pose: "bend", act: () => {
          const n = Math.min(4, rec.litterSacks);
          if (n > 0) {
            const kg = Math.round((rec.litterStore * n) / rec.litterSacks);
            rec.litterRow(f.time, "Issued to fertilizer", -kg, -n, fer.name, `Batch ${batch}`, this.doorCamera);
          }
          fer.carry = "bag";
        } });
        fer.plan.push(atDoor(fer, "bag"));
      }
      fer.plan.push(this.leave(fer));
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
    if (w.role !== "stranger" && w.role !== "visitor" && !w.manual && !onShift && !w.plan.length && w.doing !== "Going home") {
      w.doing = "Going home";
      w.plan = [{ x: this.L.mainDoor.x, z: this.L.mainDoor.z - 0.4, act: () => {
        w.inside = false; w.pose = "away"; w.doing = "";
        f.addLog(`${w.name} left`);
      } }];
    }
    if (!w.plan.length && !w.manual && w.role !== "stranger" && w.role !== "visitor") this.choose(w);
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
        const m = Math.min(Math.max(0, d - stop), WALK * (s.brisk ? 2.5 : 1) * dt);
        if (d > 1e-6) { w.x += (dx / d) * m; w.z += (dz / d) * m; }
        if (w.role === "attendant" || w.role === "vet") this.rec.of(w.id).metres += m;
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
    if (h >= 12.5 && h < 17.5 && w.litterDay !== day) {
      w.litterDay = day;
      const ds = L.drinkers.filter((q) => this.myPens(w).includes(q.pen));
      const spots = [0, 1, 2, 3].map(() => ds[Math.floor(r() * ds.length)]).sort((a, b) => b.z - a.z);
      this.goLitter(w, spots);
      return;
    }
    const eggSlot = h >= 9 && h < 13 ? day * 2 : h >= 13.5 && h < 16 ? day * 2 + 1 : -1;
    if (f.laying && eggSlot >= 0 && w.eggDay !== eggSlot) {
      w.eggDay = eggSlot;
      const pens = this.myPens(w);
      const ks = L.nests.map((_, k) => k).filter((k) => pens.includes(L.nests[k].pen)).sort((a, b) => L.nests[b].z - L.nests[a].z);
      // Attendant 2 sometimes slips part of the tray out the back door before the table.
      const steal = w.id === 1 && eggSlot % 2 === 0 && this.eggTheftDay !== day && (day === 1 || r() < 0.4);
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
          if (took > 0) this.rec.eggRow(f.time, "Missing", -took, w.name, `${picked} picked from nests, ${onTable} reached the table`, this.eggCamera);
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
      w.plan = [{ x: q.x + 0.4, z: q.z, carry: "", dur: 1.5, pose: "bend", act: () => { w.doing = ""; this.rec.of(w.id).drinkers++; } }];
      return;
    }
    w.doing = "";
    const a = L.aisle;
    w.plan = [{ x: a.x0 + 2 + r() * (a.x1 - a.x0 - 4), z: (a.z0 + a.z1) / 2 + (r() - 0.5) * 2, carry: "" }, { dur: 5 + r() * 10, pose: "stand" }];
  }
}
