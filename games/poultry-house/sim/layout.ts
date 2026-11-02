// The EcoGreen poultry house: tape measurements where we have them, site photos for the rest.
// Coordinates are metres. x runs across the width (0 = ridge line),
// z runs along the length, with the front door end at z = +length/2.

export interface Dims {
  width: number; // wall to wall across
  length: number; // wall to wall along
  eave: number; // floor to where the roof meets the side wall
  ridge: number; // floor to the roof peak
  aisle: number; // concrete service aisle depth at the door end
  birds: number;
  feeders: number;
  drinkers: number;
  trussSpacing: number;
}

// Tape-measured on 2 Nov 2026: 20 x 55 m, side walls 6.7 m high.
// The peak (about 2 m above the walls), aisle depth and pen split are still photo estimates.
export const DEFAULT_DIMS: Dims = {
  width: 20,
  length: 55,
  eave: 6.7,
  ridge: 8.7,
  aisle: 5,
  birds: 7000,
  feeders: 200,
  drinkers: 100,
  trussSpacing: 5,
};

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Pen extends Rect { id: number; name: string; active: boolean; birds: number }
export interface Spot { x: number; z: number; pen: number }
export interface Point { x: number; z: number }
/** An opening in a low pen wall. `outer` is the area on the +z side (towards the main door), `inner` the -z side. */
export interface Gate { x: number; z: number; outer: number; inner: number }
export const AISLE = -1;
export const GATE_W = 1.2;

export interface Layout {
  dims: Dims;
  hw: number;
  hl: number;
  aisle: Rect;
  pens: Pen[];
  feeders: Spot[];
  drinkers: Spot[];
  nests: Spot[];
  trusses: number[];
  mainDoor: Point;
  backDoor: Point;
  eggTable: Rect;
  feedStore: Rect;
  gates: Gate[];
  pc: Point;
}

export const rectW = (r: Rect) => r.x1 - r.x0;
export const rectD = (r: Rect) => r.z1 - r.z0;
export const area = (r: Rect) => rectW(r) * rectD(r);
export const inRect = (r: Rect, x: number, z: number, m = 0) =>
  x >= r.x0 + m && x <= r.x1 - m && z >= r.z0 + m && z <= r.z1 - m;
export const center = (r: Rect): Point => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function sanitize(d: Dims): Dims {
  const n = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  const width = clamp(n(d.width, 20), 8, 60);
  const length = clamp(n(d.length, 45), 12, 150);
  const eave = clamp(n(d.eave, 5), 2.5, 10);
  const ridge = clamp(n(d.ridge, 7), eave, eave + 6);
  const aisle = clamp(n(d.aisle, 5), 2, Math.min(10, length / 3));
  return {
    width,
    length,
    eave,
    ridge,
    aisle,
    birds: Math.round(clamp(n(d.birds, 7000), 100, 20000)),
    feeders: Math.round(clamp(n(d.feeders, 200), 4, 600)),
    drinkers: Math.round(clamp(n(d.drinkers, 100), 4, 400)),
    trussSpacing: clamp(n(d.trussSpacing, 5), 3, 8),
  };
}

/** Height of the underside of the roof at x. */
export function roofY(L: Layout, x: number): number {
  const d = L.dims;
  return d.eave + (d.ridge - d.eave) * Math.max(0, 1 - Math.abs(x) / L.hw);
}

/** Where a ceiling camera hangs: just under the truss bottom chord. */
export function mountY(L: Layout, x: number): number {
  return roofY(L, x) - 0.6;
}

// Spread n items over a grid inside a pen, keeping 1 m off the walls.
function gridSpots(pen: Pen, n: number, shift: number): Spot[] {
  const m = 1;
  const w = Math.max(0.5, rectW(pen) - 2 * m);
  const d = Math.max(0.5, rectD(pen) - 2 * m);
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / d)));
  const rows = Math.ceil(n / cols);
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = pen.x0 + m + (w * (c + 0.5 + shift)) / cols;
    const z = pen.z0 + m + (d * (r + 0.5 + shift)) / rows;
    out.push({ x: clamp(x, pen.x0 + m, pen.x1 - m), z: clamp(z, pen.z0 + m, pen.z1 - m), pen: pen.id });
  }
  return out;
}

// Split a whole number across weights so the parts add up exactly.
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

export function buildLayout(input: Dims): Layout {
  const d = sanitize(input);
  const hw = d.width / 2;
  const hl = d.length / 2;
  const front = hl - d.aisle; // pens stop here, the aisle runs to the door wall
  const mid = (-hl + front) / 2; // low block wall across the middle
  const backQ = (-hl + mid) / 2;

  // From the photos: two pens in front, two behind the middle wall,
  // and an empty concrete pen at the back right next to the green door.
  const pens: Pen[] = [
    { id: 0, name: "Pen 1", x0: -hw, x1: 0, z0: mid, z1: front, active: true, birds: 0 },
    { id: 1, name: "Pen 2", x0: 0, x1: hw, z0: mid, z1: front, active: true, birds: 0 },
    { id: 2, name: "Pen 3", x0: -hw, x1: 0, z0: -hl, z1: mid, active: true, birds: 0 },
    { id: 3, name: "Pen 4", x0: 0, x1: hw, z0: backQ, z1: mid, active: true, birds: 0 },
    { id: 4, name: "Spare pen", x0: 0, x1: hw, z0: -hl, z1: backQ, active: false, birds: 0 },
  ];
  const active = pens.filter((p) => p.active);
  const birds = apportion(d.birds, active.map(area));
  active.forEach((p, i) => (p.birds = birds[i]));

  const feederSplit = apportion(d.feeders, active.map((p) => p.birds));
  const drinkerSplit = apportion(d.drinkers, active.map((p) => p.birds));
  const feeders: Spot[] = [];
  const drinkers: Spot[] = [];
  active.forEach((p, i) => {
    feeders.push(...gridSpots(p, feederSplit[i], 0));
    drinkers.push(...gridSpots(p, drinkerSplit[i], 0.5));
  });

  // Nest boxes along the side walls (needed before laying starts, week 18-20).
  const nests: Spot[] = [];
  for (const p of active) {
    const xs: number[] = [];
    if (p.x0 <= -hw + 1e-6) xs.push(-hw + 0.3);
    if (p.x1 >= hw - 1e-6) xs.push(hw - 0.3);
    for (const x of xs) for (let z = p.z0 + 1; z <= p.z1 - 1; z += 1) nests.push({ x, z, pen: p.id });
  }

  const nT = Math.max(2, Math.round(d.length / d.trussSpacing) + 1);
  const trusses = Array.from({ length: nT }, (_, i) => -hl + (i * d.length) / (nT - 1));

  const aisleMid = (front + hl) / 2;
  const tableHalf = Math.min(0.5, (d.aisle - 1) / 4);
  return {
    dims: d,
    hw,
    hl,
    aisle: { x0: -hw, x1: hw, z0: front, z1: hl },
    pens,
    feeders,
    drinkers,
    nests,
    trusses,
    mainDoor: { x: -hw + Math.min(5, d.width * 0.25), z: hl },
    backDoor: { x: hw - Math.min(2.5, d.width * 0.12), z: -hl },
    eggTable: { x0: 1, x1: 3, z0: aisleMid - tableHalf, z1: aisleMid + tableHalf },
    feedStore: { x0: -hw + 0.3, x1: -hw + 3.3, z0: front + 0.3, z1: front + Math.min(2.4, d.aisle - 0.5) },
    // Gates from the aisle into the front pens, through the middle wall, and into the spare pen.
    gates: [
      { x: -hw / 2, z: front, outer: AISLE, inner: 0 },
      { x: hw / 2, z: front, outer: AISLE, inner: 1 },
      { x: -hw / 2, z: mid, outer: 0, inner: 2 },
      { x: hw / 2, z: mid, outer: 1, inner: 3 },
      { x: hw / 2, z: backQ, outer: 3, inner: 4 },
    ],
    pc: { x: hw - 1, z: hl - 1 },
  };
}

/** Which pen a point is in, or AISLE. */
export function regionAt(L: Layout, x: number, z: number): number {
  if (z > L.aisle.z0) return AISLE;
  for (const p of L.pens) if (inRect(p, x, z)) return p.id;
  return AISLE;
}

/**
 * Where to walk next to get from (x, z) to (tx, tz) without climbing over pen walls:
 * straight there if it is in the same area, otherwise to the next gate on the way.
 */
export function nextWaypoint(L: Layout, x: number, z: number, tx: number, tz: number): Point {
  const from = regionAt(L, x, z), to = regionAt(L, tx, tz);
  if (from === to) return { x: tx, z: tz };
  const parent = (r: number) => L.gates.find((g) => g.inner === r)?.outer ?? AISLE;
  const chain = (r: number) => { const c = [r]; while (r !== AISLE && c.length < 10) { r = parent(r); c.push(r); } return c; };
  const up = chain(to);
  let gate: Gate | undefined;
  if (up.includes(from)) {
    const child = up[up.indexOf(from) - 1]; // one step down towards the target
    gate = L.gates.find((g) => g.inner === child);
  } else {
    gate = L.gates.find((g) => g.inner === from); // one step up towards the aisle
  }
  if (!gate) return { x: tx, z: tz };
  const side = gate.outer === from ? 1 : -1;
  const near = { x: gate.x, z: gate.z + side * 0.5 }, far = { x: gate.x, z: gate.z - side * 0.5 };
  // Once lined up in front of the gate, walk on through it to the other side.
  const lined = Math.abs(x - gate.x) < 0.3 && (z - gate.z) * side < 0.6;
  return lined ? far : near;
}
