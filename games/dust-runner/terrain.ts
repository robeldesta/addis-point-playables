// Desert test area: one heightfield shared by physics and rendering.
// A closed dirt loop runs through rolling dunes, with whoops, rollers,
// a gap jump, a tabletop and a big kicker placed along it.

export const N = 320;            // cells per side
export const CELL = 1.25;        // metres per cell
export const HALF = (N * CELL) / 2;
export const TRACK_HALF_W = 6.5; // half width of the dirt road
const STEP = 0.5;                // centreline sample spacing (m)

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function baseHeight(x: number, z: number): number {
  let h = 2.6 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 - 0.4);
  h += 1.4 * Math.sin((x + z) * 0.033 + 0.7);
  h += 0.5 * Math.sin(x * 0.09 - z * 0.07);
  h += 0.25 * Math.sin(x * 0.21 + z * 0.17) * Math.cos(z * 0.13);
  // wind-blown dune crests
  const ridge = Math.abs(Math.sin(x * 0.013 + z * 0.021 + Math.sin(z * 0.011) * 2));
  h += 3.2 * ridge * ridge * ridge;
  // berm at the edge of the playable area
  const d = Math.max(Math.abs(x), Math.abs(z));
  if (d > 168) h += ((d - 168) / 30) ** 2 * 22;
  return h;
}

export type FeatureKind = "whoops" | "gap" | "rollers" | "table" | "kicker" | "start";
interface Feature { kind: FeatureKind; at: number; len: number }

function featureHeight(f: Feature, u: number): number {
  if (u < 0 || u > f.len) return 0;
  switch (f.kind) {
    case "whoops": { const lam = 9; return 0.42 * (0.5 - 0.5 * Math.cos((2 * Math.PI * u) / lam)); }
    case "rollers": { const lam = 26; return 1.1 * (0.5 - 0.5 * Math.cos((2 * Math.PI * u) / lam)); }
    case "gap": {
      // kicker 2.4 m high, a dip, then a downhill landing ramp
      if (u < 13) return 2.4 * (u / 13) ** 1.6;
      if (u < 15.5) return 2.4 - (2.4 + 0.5) * smooth(13, 15.5, u);
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

  constructor() {
    this.buildTrack();
    this.buildHeights();
  }

  private buildTrack() {
    // control points of a lumpy closed loop
    const ctrl: [number, number][] = [];
    const K = 22;
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2;
      const r = 128 + 30 * Math.sin(2 * a + 0.4) + 16 * Math.cos(3 * a + 1.0);
      ctrl.push([Math.cos(a) * r, Math.sin(a) * r * 0.92]);
    }
    // closed Catmull-Rom, densely evaluated
    const dense: [number, number][] = [];
    for (let i = 0; i < K; i++) {
      const p0 = ctrl[(i - 1 + K) % K], p1 = ctrl[i], p2 = ctrl[(i + 1) % K], p3 = ctrl[(i + 2) % K];
      for (let j = 0; j < 60; j++) {
        const t = j / 60, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    // resample at an even spacing
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const n = Math.floor(total / STEP);
    this.length = n * STEP;
    let seg = 0;
    for (let k = 0; k < n; k++) {
      const s = (k / n) * total;
      while (cum[seg + 1] < s) seg++;
      const a = dense[seg], b = dense[(seg + 1) % dense.length];
      const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
      this.samples.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: 0, tz: 0, y: 0 });
    }
    for (let k = 0; k < n; k++) {
      const a = this.samples[(k - 2 + n) % n], b = this.samples[(k + 2) % n];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      this.samples[k].tx = (b.x - a.x) / l;
      this.samples[k].tz = (b.z - a.z) / l;
    }
    // road height follows the dunes, heavily smoothed
    const raw = this.samples.map((p) => baseHeight(p.x, p.z));
    const W = Math.round(40 / STEP);
    let acc = 0;
    for (let k = -W; k <= W; k++) acc += raw[(k + n) % n];
    for (let k = 0; k < n; k++) {
      this.samples[k].y = acc / (2 * W + 1) - 0.4;
      acc += raw[(k + W + 1) % n] - raw[(k - W + n) % n];
    }
    // features, spread around the lap
    const L = this.length;
    const put = (kind: FeatureKind, frac: number, len: number) => this.features.push({ kind, at: frac * L, len });
    put("whoops", 0.07, 75);
    put("gap", 0.2, 46);
    put("rollers", 0.33, 88);
    put("table", 0.48, 62);
    put("whoops", 0.62, 68);
    put("kicker", 0.76, 55);
    put("rollers", 0.88, 66);
  }

  /** feature bump at a distance along the track */
  featureAt(s: number): number {
    let h = 0;
    for (const f of this.features) h += featureHeight(f, s - f.at);
    return h;
  }

  private buildHeights() {
    const R = TRACK_HALF_W + 12;
    const rc = Math.ceil(R / CELL);
    // stamp nearest centreline sample into the grid
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
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const idx = j * (N + 1) + i;
        const x = i * CELL - HALF, z = j * CELL - HALF;
        let h = baseHeight(x, z);
        const k = this.near[idx];
        if (k >= 0) {
          const d = this.dist[idx];
          const p = this.samples[k];
          const fade = 1 - smooth(TRACK_HALF_W - 1, TRACK_HALF_W + 2.5, d);
          const berm = 0.45 * Math.exp(-(((d - (TRACK_HALF_W + 1.8)) / 1.1) ** 2));
          const surf = p.y + this.featureAt(k * STEP) * fade + berm;
          const w = 1 - smooth(TRACK_HALF_W + 2.5, TRACK_HALF_W + 12, d);
          h = h + (surf - h) * w;
        }
        this.h[idx] = h;
      }
    }
  }

  /** exact height of the rendered triangles */
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

  /** smoothed normal (central differences) */
  normal(x: number, z: number, out: { x: number; y: number; z: number }) {
    const e = 0.7;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  /** ray march + bisection. returns t or -1 */
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

  /** nearest centreline sample index, and distance from the road centre */
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

  sample(k: number): Sample { const n = this.samples.length; return this.samples[((k % n) + n) % n]; }
  get count() { return this.samples.length; }
  get step() { return STEP; }
}
