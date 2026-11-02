import { describe, expect, test } from "vitest";
import { DEFAULT_DIMS, apportion, area, buildLayout, inRect, mountY } from "./layout";
import { CoverMap, autoPlace, footprint, shopping } from "./gear";
import { DEAD, DEAD_ALERT_MIN, Flock, GONE, HEALTHY, SICK } from "./flock";
import { Staff } from "./staff";

const L = buildLayout(DEFAULT_DIMS);

describe("layout", () => {
  test("apportion adds up exactly", () => {
    expect(apportion(7000, [200, 200, 200, 100]).reduce((a, b) => a + b)).toBe(7000);
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });
  test("birds, feeders and drinkers match the investment plan", () => {
    expect(L.pens.reduce((s, p) => s + p.birds, 0)).toBe(7000);
    expect(L.feeders.length).toBe(200);
    expect(L.drinkers.length).toBe(100);
  });
  test("every feeder and drinker sits inside its own pen", () => {
    for (const f of [...L.feeders, ...L.drinkers]) expect(inRect(L.pens[f.pen], f.x, f.z)).toBe(true);
  });
  test("pens plus aisle fill the house", () => {
    const total = L.pens.reduce((s, p) => s + area(p), 0) + area(L.aisle);
    expect(total).toBeCloseTo(DEFAULT_DIMS.width * DEFAULT_DIMS.length);
  });
});

describe("cameras", () => {
  test("a 2.8mm camera at the quarter line sees about 18 x 7.4 m", () => {
    const f = footprint(L, { x: 5, z: 0, lens: "2.8", rot: 0 });
    expect(mountY(L, 5)).toBeCloseTo(7.1);
    expect(f.x1 - f.x0).toBeCloseTo(17.9, 0);
    expect(f.z1 - f.z0).toBeCloseTo(7.4, 0);
  });
  test("auto placement covers every active pen", () => {
    const gears = autoPlace(L, "2.8");
    const s = new CoverMap(L, gears).stats();
    expect(s.total).toBeGreaterThan(0.99);
    expect(gears.filter((g) => g.kind === "overhead").length).toBe(14);
  });
  test("wider lenses need fewer cameras", () => {
    const n = (lens: "2.0" | "2.8" | "4.0") => autoPlace(L, lens).filter((g) => g.kind === "overhead").length;
    expect(n("2.0")).toBeLessThanOrEqual(n("2.8"));
    expect(n("2.8")).toBeLessThan(n("4.0"));
  });
  test("shopping list sizes the switch for every camera", () => {
    const lines = shopping(L, autoPlace(L, "2.8"));
    expect(lines.find((l) => l.item.startsWith("PoE switch"))?.item).toContain("24-port");
  });
});

describe("flock", () => {
  test("birds stay inside their pens", () => {
    const f = new Flock(L, 3);
    f.step(240);
    for (let i = 0; i < f.n; i += 7) {
      if (f.st[i] === GONE) continue;
      expect(inRect(L.pens[f.pen[i]], f.x[i], f.z[i], -0.01)).toBe(true);
    }
  });
  test("AI only reports a dead bird a camera can see", () => {
    const f = new Flock(L, 4);
    const seen = new Set<number>();
    f.cover = { covered: (x) => x < 0 }; // only the left half has cameras
    const left = f.nearestBird(-5, 0, 50, (s) => s === HEALTHY);
    const right = f.nearestBird(5, 0, 50, (s) => s === HEALTHY);
    f.st[left] = DEAD;
    f.st[right] = DEAD;
    f.step(DEAD_ALERT_MIN + 2);
    for (const a of f.alerts) if (a.kind === "dead") seen.add(a.bird);
    expect(seen.has(left)).toBe(true);
    expect(seen.has(right)).toBe(false);
  });
  test("treated birds recover, untreated ones die", () => {
    const f = new Flock(L, 5);
    const a = f.nearestBird(-5, 0, 50, (s) => s === HEALTHY);
    const b = f.nearestBird(5, 0, 50, (s) => s === HEALTHY);
    f.makeSick(a, 0);
    f.makeSick(b, 0);
    expect(f.st[a]).toBe(SICK);
    f.treat(a);
    f.step(1440 * 4);
    expect(f.st[a]).toBe(HEALTHY);
    expect([DEAD, GONE]).toContain(f.st[b]);
  }, 60000);
  test("laying hens fill the nest boxes in the morning", () => {
    const f = new Flock(L, 6);
    f.setWeeks(24);
    f.step(6 * 60);
    expect(f.stats.laid).toBeGreaterThan(4000);
    expect(f.stats.floorLaid).toBeLessThan(f.stats.laid * 0.1);
  });
});

describe("staff", () => {
  test("workers get through the gates at normal frame rate (no getting stuck at a gate)", () => {
    const L = buildLayout(DEFAULT_DIMS);
    const f = new Flock(L);
    const s = new Staff(L, f);
    const reached = new Set<number>();
    for (let k = 0; k < 60 * 60; k++) { // one sim hour in 1/60-minute frames, like the browser at 1x
      f.step(1 / 60); s.step(1 / 60);
      for (const w of s.workers) if (w.inside && w.z < L.aisle.z0 - 1) reached.add(w.id);
    }
    expect(reached.has(0) && reached.has(1)).toBe(true);
  }, 60000);

  test("attendants walk the feeders and the vet sees to flagged hens", () => {
    const L = buildLayout(DEFAULT_DIMS);
    const f = new Flock(L);
    f.cover = new CoverMap(L, autoPlace(L, "2.8"));
    const s = new Staff(L, f);
    const feederVisits = new Set<number>();
    const poses = new Set<string>();
    let vetTreated = 0;
    for (let m = 0; m < 12 * 60 * 4; m++) {
      f.step(0.25);
      s.step(0.25);
      for (const w of s.workers) {
        poses.add(w.pose);
        if (w.pose === "pour") L.feeders.forEach((q, k) => { if (Math.hypot(q.x - w.x, q.z - w.z) < 0.6) feederVisits.add(k); });
        if (w.role === "vet" && w.doing === "Treated a hen") vetTreated++;
        if (w.pose === "away") continue;
        // Nobody walks through walls of the house.
        expect(Math.abs(w.x)).toBeLessThanOrEqual(L.hw);
        expect(Math.abs(w.z)).toBeLessThanOrEqual(L.hl);
      }
    }
    expect(feederVisits.size).toBeGreaterThan(L.feeders.length * 0.95);
    expect(poses.has("walk") && poses.has("pour") && poses.has("kneel")).toBe(true);
    expect(vetTreated).toBeGreaterThan(0);
  }, 60000);
});

describe("incidents", () => {
  test("day 1: a feed thief before dawn and eggs slipped out the back door are both reported", () => {
    const L = buildLayout(DEFAULT_DIMS);
    const f = new Flock(L);
    f.cover = new CoverMap(L, autoPlace(L, "2.8"));
    f.setWeeks(24);
    f.time = 5 * 60 + 20;
    const s = new Staff(L, f);
    s.eggCamera = true;
    const bags = f.stats.feedBags;
    for (let k = 0; k < 9 * 60 * 4; k++) { f.step(0.25); s.step(0.25); } // to 14:20
    const kinds = f.alerts.map((a) => a.kind);
    expect(kinds).toContain("intruder");
    expect(kinds).toContain("feedtheft");
    expect(f.alerts.filter((a) => a.kind === "eggtheft").length).toBe(2); // back door camera + short count at the table
    expect(f.stats.feedBags).toBe(s.rec.book - 2); // two bags gone that the books never saw
    expect(bags).toBe(60);
    expect(s.workers[3].inside).toBe(false); // the thief left
  }, 60000);

  test("a full day is booked: feed in and out, eggs counted and picked up, litter weighed and sent to fertilizer, staff KPIs", () => {
    const L = buildLayout(DEFAULT_DIMS);
    const f = new Flock(L);
    f.cover = new CoverMap(L, autoPlace(L, "2.8"));
    f.setWeeks(24);
    f.time = 5 * 60 + 20;
    const s = new Staff(L, f);
    s.eggCamera = true;
    for (let k = 0; k < 13 * 60 * 4; k++) { f.step(0.25); s.step(0.25); } // to 18:20
    const r = s.rec;
    const types = (rows: { type: string }[]) => new Set(rows.map((x) => x.type));
    expect(types(r.feed)).toEqual(new Set(["Delivery", "Issued", "Taken, not booked"]));
    expect(types(r.eggs)).toEqual(new Set(["Counted at table", "Picked up", "Missing"]));
    expect(types(r.litter)).toEqual(new Set(["Weighed out", "Issued to fertilizer"]));
    // The running balances add up.
    expect(r.book).toBe(60 + r.feed.reduce((a, x) => a + (x.type === "Taken, not booked" ? 0 : x.bags), 0));
    expect(r.store).toBe(r.eggs.reduce((a, x) => a + (x.type === "Missing" ? 0 : x.eggs), 0));
    expect(r.litterStore).toBe(r.litter.reduce((a, x) => a + x.kg, 0));
    expect(r.fertilizerTotal).toBeGreaterThan(200);
    for (const id of [0, 1]) {
      const k = r.of(id);
      expect(k.eggs).toBeGreaterThan(1000);
      expect(k.bags).toBeGreaterThan(0);
      expect(k.feeders).toBeGreaterThan(80);
      expect(k.kg).toBeGreaterThan(100);
    }
    expect(r.of(2).checked).toBeGreaterThan(0);
    for (const w of s.workers.slice(3)) expect(w.inside).toBe(false); // visitors and the thief all left
  }, 60000);

  test("a player-controlled worker follows orders and does the work", () => {
    const L = buildLayout(DEFAULT_DIMS);
    const f = new Flock(L);
    f.cover = new CoverMap(L, autoPlace(L, "2.8"));
    f.time = 8 * 60;
    const s = new Staff(L, f);
    const w = s.workers[0];
    s.takeOver(w);
    const sick = f.nearestBird(0, 0, 100, (st) => st === SICK);
    s.goHen(w, sick);
    for (let k = 0; k < 60 * 60 && w.plan.length; k++) { f.step(1 / 60); s.step(1 / 60); }
    expect(f.treated[sick]).toBe(1);
    expect(w.manual).toBe(true);
    for (let k = 0; k < 600; k++) { f.step(1 / 60); s.step(1 / 60); }
    expect(w.plan.length).toBe(0); // waits for the next order instead of wandering off
  }, 60000);
});
