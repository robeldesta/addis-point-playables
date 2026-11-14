// Procedural circuits: a long winding route packed into a square map, and
// the jumps and rough sections laid along it. Seeded, so every player gets
// the same circuit for a level.

import type { FeatureKind, Terrain } from "./terrain";

export function seeded(seed: number) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export interface RouteOpts {
  seed: number;
  length: number;   // target length in metres
  size: number;     // map side in metres
  step?: number;    // spacing of control points (m): smaller = twistier
  turn?: number;    // max heading change per control point (rad)
  sep?: number;     // minimum distance between separate legs of the route (m)
}

/**
 * Grows a self-avoiding route one control point at a time. Each step picks
 * the heading that keeps the route close to (but not too close to) the parts
 * already laid, so the route packs the map like a winding river instead of
 * trapping itself, and backs up when it runs into a dead end.
 */
export function genRoute(o: RouteOpts): [number, number][] {
  const step = o.step ?? 60, turn = o.turn ?? 0.85, sep = o.sep ?? 78;
  const half = o.size / 2 - 50;
  for (let attempt = 0; attempt < 40; attempt++) {
    const rnd = seeded(o.seed * 131 + attempt * 7);
    const pts: [number, number][] = [];
    const heads: number[] = [];
    const a0 = rnd() * Math.PI * 2;
    pts.push([-half * 0.85 * Math.cos(a0), -half * 0.85 * Math.sin(a0)]);
    heads.push(a0 + (rnd() - 0.5) * 0.8);
    let len = 0, fails = 0, bias = 0;
    const clearance = (x: number, z: number, skip: number) => {
      let m = 1e9;
      for (let j = 0; j < pts.length - skip; j++) m = Math.min(m, Math.hypot(x - pts[j][0], z - pts[j][1]));
      return m;
    };
    const ok = (x: number, z: number, skip: number) =>
      Math.abs(x) < half && Math.abs(z) < half && clearance(x, z, skip) >= sep;
    while (len < o.length && fails < 400) {
      const [lx, lz] = pts[pts.length - 1], h = heads[heads.length - 1];
      if (rnd() < 0.15) bias = (rnd() * 2 - 1) * turn * 0.6;
      let best = -1e9, bx = 0, bz = 0, bh = 0;
      for (let c = 0; c < 24; c++) {
        const th = h + (rnd() * 2 - 1) * turn;
        const x = lx + Math.cos(th) * step, z = lz + Math.sin(th) * step;
        if (!ok(x, z, 3)) continue;
        // one step of lookahead: is there still somewhere to go from here?
        let open = 0;
        for (let d = -2; d <= 2; d++) {
          const t2 = th + d * turn * 0.5;
          if (ok(x + Math.cos(t2) * step, z + Math.sin(t2) * step, 2)) open++;
        }
        if (!open) continue;
        const m = Math.min(clearance(x, z, 3), Math.min(half - Math.abs(x), half - Math.abs(z)) + sep * 0.7);
        const score = -Math.abs(Math.min(m, 500) - sep * 1.35) * 0.04 - Math.abs(th - h - bias) * 1.2 + open * 0.15 + rnd() * 0.6;
        if (score > best) { best = score; bx = x; bz = z; bh = th; }
      }
      if (best > -1e9) { pts.push([bx, bz]); heads.push(bh); len += step; }
      else {
        fails++;
        const back = Math.min(pts.length - 1, 2 + Math.floor(rnd() * 4));
        for (let b = 0; b < back; b++) { pts.pop(); heads.pop(); len -= step; }
        if (!pts.length) break;
      }
    }
    if (len >= o.length) return pts;
  }
  throw new Error("route generation failed");
}

const LEN: Record<FeatureKind, number> = { whoops: 70, bigwhoops: 90, rollers: 90, table: 62, kicker: 50, gap: 46, crest: 55, rocks: 60 };
const JUMPS = new Set<FeatureKind>(["table", "kicker", "gap", "crest"]);

/** lays features along a built route: jumps only where the route is straight enough */
export function genFeatures(T: Terrain, seed: number, mix: Partial<Record<FeatureKind, number>>, gap: [number, number]): [FeatureKind, number, number][] {
  const rnd = seeded(seed * 977 + 3);
  const kinds = Object.entries(mix) as [FeatureKind, number][];
  const total = kinds.reduce((a, [, w]) => a + w, 0);
  const pick = (noJumps: boolean): FeatureKind => {
    for (let t = 0; t < 20; t++) {
      let r = rnd() * total;
      for (const [k, w] of kinds) { r -= w; if (r <= 0) { if (!(noJumps && JUMPS.has(k))) return k; break; } }
    }
    return "whoops";
  };
  const heading = (s: number) => { const p = T.sample(Math.round(s / T.step)); return Math.atan2(p.tx, p.tz); };
  const bend = (a: number, b: number) => {
    let m = 0;
    const h0 = heading(a);
    for (let s = a; s <= b; s += 5) { let d = heading(s) - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; m = Math.max(m, Math.abs(d)); }
    return m;
  };
  const out: [FeatureKind, number, number][] = [];
  let s = 110 + rnd() * 60;
  while (s < T.length - 160) {
    let k = pick(false);
    // a jump needs a straight run-up and a straight landing
    if (JUMPS.has(k) && bend(s - 25, s + LEN[k] + 15) > 0.42) k = pick(true);
    out.push([k, s, LEN[k]]);
    s += LEN[k] + gap[0] + rnd() * (gap[1] - gap[0]);
  }
  return out;
}
