// One heightfield per stage, shared by physics and rendering. A stage is a
// point-to-point route across open desert; the ground around it is shaped by
// the stage's biome (flats, dunes, a sunken wash, a canyon, mountain mesas).

import type { Biome } from "./biomes";

export const N = 320;            // cells per side
export const CELL = 1.5;        // metres per cell
export const HALF = (N * CELL) / 2;
const STEP = 0.5;                // route sample spacing (m)

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type FeatureKind = "whoops" | "bigwhoops" | "rollers" | "table" | "kicker" | "gap" | "crest" | "rocks";
export interface Feature { kind: FeatureKind; at: number; len: number }

function featureHeight(f: Feature, u: number): number {
  if (u < 0 || u > f.len) return 0;
  const ramp = Math.min(1, u / 6, (f.len - u) / 6); // ease in/out of wave sections
  switch (f.kind) {
    case "whoops": return ramp * 0.55 * (0.5 - 0.5 * Math.cos((2 * Math.PI * u) / 9));
    case "bigwhoops": return ramp * 0.95 * (0.5 - 0.5 * Math.cos((2 * Math.PI * u) / 13));
    case "rollers": return ramp * 1.3 * (0.5 - 0.5 * Math.cos((2 * Math.PI * u) / 28));
    case "gap": {
      if (u < 13) return 2.4 * (u / 13) ** 1.6;
      if (u < 15.5) return 2.4 - 2.9 * smooth(13, 15.5, u);
      if (u < 22) return -0.5;
      if (u < 28) return -0.5 + 2.3 * smooth(22, 28, u);
      return 1.8 * (1 - smooth(28, f.len, u));
    }
    case "table": {
      if (u < 16) return 3.0 * smooth(0, 16, u);
      if (u < 30) return 3.0;
      return 3.0 * (1 - smooth(30, f.len, u));
    }
    case "kicker": {
      if (u < 15) return 3.0 * (u / 15) ** 1.35;
      return 3.0 * (1 - smooth(15, f.len, u));
    }
    case "crest": { // sharp dune lip with a long soft landing
      if (u < 18) return 3.6 * (u / 18) ** 1.25;
      return 3.6 * (1 - smooth(18, f.len, u)) ** 0.8;
    }
    default: return 0;
  }
}

export interface Sample { x: number; z: number; tx: number; tz: number; y: number }

export class Terrain {
  readonly h = new Float32Array((N + 1) * (N + 1));
  readonly dist = new Float32Array((N + 1) * (N + 1)).fill(999);
  readonly near = new Int32Array((N + 1) * (N + 1)).fill(-1);
  readonly samples: Sample[] = [];
  readonly features: Feature[] = [];
  length = 0;
  readonly routeW: number;
  readonly offRoute: number;

  constructor(readonly biome: Biome) {
    this.routeW = biome.routeW;
    this.offRoute = biome.routeW + 14;
    this.buildRoute();
    this.buildHeights();
  }

  private buildRoute() {
    const ctrl = this.biome.route.map(([x, z]) => [x * 1.25, z * 1.25] as [number, number]);
    const K = ctrl.length;
    const P = (i: number) => ctrl[Math.max(0, Math.min(K - 1, i))];
    const dense: [number, number][] = [];
    for (let i = 0; i < K - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let j = 0; j < 60; j++) {
        const t = j / 60, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    dense.push(ctrl[K - 1]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = cum[cum.length - 1];
    const n = Math.floor(total / STEP);
    this.length = n * STEP;
    let seg = 0;
    for (let k = 0; k <= n; k++) {
      const s = Math.min(total, k * STEP);
      while (seg < dense.length - 2 && cum[seg + 1] < s) seg++;
      const a = dense[seg], b = dense[seg + 1];
      const t = (s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
      this.samples.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: 0, tz: 0, y: 0 });
    }
    const m = this.samples.length;
    for (let k = 0; k < m; k++) {
      const a = this.samples[Math.max(0, k - 2)], b = this.samples[Math.min(m - 1, k + 2)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      this.samples[k].tx = (b.x - a.x) / l;
      this.samples[k].tz = (b.z - a.z) / l;
    }
    // route height: the ground, smoothed over the biome's window, then carved
    const raw = this.samples.map((p) => this.biome.base(p.x, p.z));
    const W = Math.max(1, Math.round(this.biome.follow / STEP));
    for (let k = 0; k < m; k++) {
      let acc = 0, c = 0;
      for (let j = k - W; j <= k + W; j += 2) { acc += raw[Math.max(0, Math.min(m - 1, j))]; c++; }
      this.samples[k].y = acc / c - this.biome.sink;
    }
    for (const [kind, frac, len] of this.biome.features) this.features.push({ kind, at: frac * this.length, len });
  }

  featureAt(s: number): number {
    let h = 0;
    for (const f of this.features) h += featureHeight(f, s - f.at);
    return h;
  }

  private buildHeights() {
    const B = this.biome;
    const wall = B.wall;           // distance over which the surroundings blend back in
    const R = this.routeW + wall + 4;
    const rc = Math.ceil(R / CELL);
    for (let k = 0; k < this.samples.length; k++) {
      const p = this.samples[k];
      const ci = Math.round((p.x + HALF) / CELL), cj = Math.round((p.z + HALF) / CELL);
      for (let j = Math.max(0, cj - rc); j <= Math.min(N, cj + rc); j++) {
        for (let i = Math.max(0, ci - rc); i <= Math.min(N, ci + rc); i++) {
          const x = i * CELL - HALF, z = j * CELL - HALF;
          const d = Math.hypot(x - p.x, z - p.z);
          const idx = j * (N + 1) + i;
          if (d < this.dist[idx]) { this.dist[idx] = d; this.near[idx] = k; }
        }
      }
    }
    const W = this.routeW;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const idx = j * (N + 1) + i;
        const x = i * CELL - HALF, z = j * CELL - HALF;
        let h = B.base(x, z);
        // keep the truck inside the map
        const e = Math.max(Math.abs(x), Math.abs(z));
        if (e > HALF - 28) h += ((e - HALF + 28) / 28) ** 2 * 26;
        const k = this.near[idx];
        if (k >= 0) {
          const d = this.dist[idx];
          const p = this.samples[k];
          const fade = 1 - smooth(W - 1.5, W + 3, d);
          // light washboard texture on the driven line
          const rough = 0.06 * Math.sin(k * STEP * 1.9) * (1 - smooth(0, W, d));
          const surf = p.y + this.featureAt(k * STEP) * fade + rough;
          const w = smooth(W + 2, W + 2 + wall, d);
          h = surf + (h - surf) * w;
        }
        this.h[idx] = h;
      }
    }
  }

  height(x: number, z: number): number {
    let gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    gx = Math.max(0, Math.min(N - 1e-4, gx));
    gz = Math.max(0, Math.min(N - 1e-4, gz));
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const r = N + 1, b = j * r + i;
    const h00 = this.h[b], h10 = this.h[b + 1], h01 = this.h[b + r], h11 = this.h[b + r + 1];
    if (fx > fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  normal(x: number, z: number, out: { x: number; y: number; z: number }) {
    const e = 0.7;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    const f = (t: number) => oy + dy * t - this.height(ox + dx * t, oz + dz * t);
    if (f(0) <= 0) return 0;
    const step = 0.12;
    let prev = 0;
    for (let t = step; t <= maxT + 1e-6; t += step) {
      const tt = Math.min(t, maxT);
      if (f(tt) <= 0) {
        let lo = prev, hi = tt;
        for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
        return (lo + hi) / 2;
      }
      prev = tt;
    }
    return -1;
  }

  /** nearest route sample index, and distance from the route centre */
  nearest(x: number, z: number, hint = -1): { k: number; d: number } {
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
    if (i >= 0 && j >= 0 && i <= N && j <= N) {
      const idx = j * (N + 1) + i;
      if (this.near[idx] >= 0) return { k: this.near[idx], d: this.dist[idx] };
    }
    let best = 1e9, bk = Math.max(0, hint);
    for (let k = 0; k < this.samples.length; k += 2) {
      const p = this.samples[k];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; bk = k; }
    }
    return { k: bk, d: Math.sqrt(best) };
  }

  sample(k: number): Sample { return this.samples[Math.max(0, Math.min(this.samples.length - 1, Math.round(k)))]; }
  get count() { return this.samples.length; }
  get step() { return STEP; }
}
