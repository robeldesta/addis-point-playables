// Balance guard rails for the week-long campaign (bots, not people).
import { describe, expect, test } from "vitest";
import * as G from "./grid";
import * as K from "./campaign";

/** A competent operator: repairs, and eases any plant feeding an overloaded line. */
function operator(s: G.State) {
  for (const l of s.lines) if (l.tripped && l.repair === 0) G.repairLine(s, l.id);
  const hot = s.lines.filter((l) => G.lineLoad(l) > 0.98).sort((a, b) => G.lineLoad(b) - G.lineLoad(a))[0];
  if (hot) {
    const A = s.nodes[hot.a], B = s.nodes[hot.b];
    const p = G.isPlant(A) ? A : G.isPlant(B) ? B : null;
    if (p && p.kind !== "battery") G.setPlant(s, p.id, p.out - 25);
  } else for (const n of s.nodes) if (G.isPlant(n) && !n.auto && s.lines.every((l) => G.lineLoad(l) < 0.85)) G.setAuto(s, n.id, true);
}
function week(seed: number, tariff: number, act: boolean) {
  const c = K.newCampaign(seed);
  while (!c.over) {
    c.tariff = tariff;
    const s = K.startDay(c);
    while (!s.over) { G.tick(s); if (act) operator(s); }
    K.endDay(c, s);
  }
  return c;
}
const avg = (tariff: number, act = true) => [1, 2, 3].map((sd) => week(sd, tariff, act).cash).reduce((a, b) => a + b) / 3;

describe("campaign balance", () => {
  test("operating beats watching", () => { expect(avg(120)).toBeGreaterThan(avg(120, false) + 300_000); });
  test("pricing has a sweet spot: neither cheapest nor greediest wins", () => {
    const mid = avg(150);
    expect(mid).toBeGreaterThan(avg(100));
    expect(mid).toBeGreaterThan(avg(185));
  });
  test("a week is deterministic", () => { expect(week(9, 130, true).cash).toBe(week(9, 130, true).cash); });
});
