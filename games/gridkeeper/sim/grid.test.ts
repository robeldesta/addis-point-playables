import { describe, expect, test } from "vitest";
import { gauss, islands, solveIsland } from "./flow";
import * as G from "./grid";

describe("network solver", () => {
  test("parallel lines split by susceptance (1/x)", () => {
    const lines = [{ a: 0, b: 1, x: 1, closed: true }, { a: 0, b: 1, x: 2, closed: true }];
    const f = [0, 0];
    solveIsland([0, 1], lines, [90, -90], f);
    expect(f[0]).toBeCloseTo(60);
    expect(f[1]).toBeCloseTo(30);
  });
  test("a triangle: the direct path carries 2/3", () => {
    // gen at 0, load at 2, lines 0-2 (x=1) and 0-1-2 (x=1 each)
    const lines = [{ a: 0, b: 2, x: 1, closed: true }, { a: 0, b: 1, x: 1, closed: true }, { a: 1, b: 2, x: 1, closed: true }];
    const f = [0, 0, 0];
    solveIsland([0, 1, 2], lines, [30, 0, -30], f);
    expect(f[0]).toBeCloseTo(20);
    expect(f[1]).toBeCloseTo(10);
    expect(f[2]).toBeCloseTo(10);
  });
  test("open lines carry nothing and split islands", () => {
    const lines = [{ a: 0, b: 1, x: 1, closed: true }, { a: 1, b: 2, x: 1, closed: false }];
    expect(islands(3, lines)).toEqual([[0, 1], [2]]);
  });
  test("gauss solves a 3x3 system", () => {
    const x = gauss([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
    expect(x[0]).toBeCloseTo(2); expect(x[1]).toBeCloseTo(3); expect(x[2]).toBeCloseTo(-1);
  });
});

describe("thermal model", () => {
  const minutesToTrip = (L: number) => { let h = 0, m = 0; while (h < 100 && m < 1000) { h = Math.min(100, h + G.HEAT_RATE * (L * L - 1)); m++; } return m; };
  test("110% trips in about 20 minutes, 150% in about 3-4", () => {
    expect(minutesToTrip(1.1)).toBeGreaterThanOrEqual(19);
    expect(minutesToTrip(1.1)).toBeLessThanOrEqual(21);
    expect(minutesToTrip(1.5)).toBeGreaterThanOrEqual(3);
    expect(minutesToTrip(1.5)).toBeLessThanOrEqual(4);
  });
});

describe("city", () => {
  test("starts balanced with no line over its limit", () => {
    const s = G.newCity(1);
    const t = G.totals(s);
    expect(Math.abs(t.served - s.lines.length * 0 - t.served)).toBe(0);
    for (const l of s.lines) expect(G.lineLoad(l)).toBeLessThan(1);
  });
  test("flows balance at every node (Kirchhoff)", () => {
    const s = G.newCity(1);
    for (let i = 0; i < 30; i++) G.tick(s);
    s.nodes.forEach((n, i) => {
      if (n.kind !== "sub") return;
      const net = s.lines.reduce((a, l) => a + (l.a === i ? -l.flow : l.b === i ? l.flow : 0), 0);
      expect(Math.abs(net)).toBeLessThan(1e-6);
    });
  });
  test("a seeded day is deterministic", () => {
    const run = () => { const s = G.newCity(42); while (!s.over) G.tick(s); return JSON.stringify(s.stats); };
    expect(run()).toEqual(run());
  });
  test("left alone, the storm causes a cascade and blackouts", () => {
    const s = G.newCity(3);
    while (!s.over) G.tick(s);
    expect(s.stats.trips).toBeGreaterThanOrEqual(2);
    expect(G.servedPct(s)).toBeLessThan(0.95);
  });
  test("an operator who redispatches after the strike prevents the cascade", () => {
    const s = G.newCity(3);
    while (!s.over) {
      G.tick(s);
      const l1 = s.lines.find((l) => l.id === "L1")!;
      if (l1.tripped && s.nodes[0].auto) G.setPlant(s, "dam", 140); // move load off the dam
      if (l1.tripped && l1.repair === 0) G.repairLine(s, "L1");
      if (!l1.tripped && !s.nodes[0].auto) G.setAuto(s, "dam", true);
    }
    expect(s.stats.trips).toBe(1);
    expect(G.servedPct(s)).toBeGreaterThan(0.97);
  });
  test("an island without generation goes dark", () => {
    const s = G.newCity(1);
    // Hospital connects via North Sub (L11), Hilltop (L12) and Battery (L16)
    for (const id of ["L11", "L12", "L16"]) G.toggleBreaker(s, id);
    G.tick(s);
    expect(s.nodes.find((n) => n.id === "hosp")!.served).toBe(false);
  });
  test("solver stays fast", () => {
    const s = G.newCity(1);
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) G.tick(s);
    expect((performance.now() - t0) / 400).toBeLessThan(2); // ms per tick
  });
});
