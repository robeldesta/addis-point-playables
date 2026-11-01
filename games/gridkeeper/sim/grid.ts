// Gridkeeper simulation: world state and the fixed-step tick.
// Never imports Phaser. One tick = one game minute.
//
// Three separate systems (see the GDD):
//   1. network solver   (flow.ts, DC power flow per island)
//   2. frequency/balance (per island: droop response, inertia, auto shedding)
//   3. thermal           (line heat from load, trips at 100)

import { islands, solveIsland, type FlowLine } from "./flow";

export type NodeKind = "hydro" | "gas" | "battery" | "sub" | "district";
export type Profile = "homes" | "commerce" | "market" | "flat";

export interface GNode {
  id: string; name: string; kind: NodeKind; x: number; y: number;
  // plants
  cap: number; ramp: number; out: number; set: number; online: boolean; auto: boolean;
  soc: number; socMax: number; // battery MWh
  // districts
  base: number; profile: Profile; critical: boolean; priority: number;
  served: boolean; shedAt: number; shedBy: "" | "auto" | "player" | "island" | "capacity";
  demand: number; // MW right now (even when dark)
  df: number; // frequency deviation of this node's island, Hz
  lost: boolean; // district now buys from the rival utility (no load, no revenue)
  boost: number; // demand multiplier from incidents (match night, heatwave)
  litMin: number; minutes: number; // reliability this day, for customer loyalty
}

export interface GLine {
  id: string; a: number; b: number; x: number; limit: number;
  closed: boolean; tripped: boolean; heat: number; flow: number; repair: number; trippedAt: number;
  rating: number; // normal limit; heatwaves derate `limit` below this
  hardened: boolean; // storm-proofed: lightning can't trip it
  peak: number; // highest load fraction today
}

/** A scripted incident on today's forecast. */
export interface Incident {
  at: number; dur: number; done: 0 | 1 | 2; // 0 waiting, 1 active, 2 over
  kind: "heat" | "spike" | "fuel" | "fault";
  target?: string; mult?: number; text: string;
}

/** Money for the day. All $ amounts. */
export interface Econ {
  tariff: number; // what you charge, $/MWh
  fuelPrice: number; // gas, $/MWh
  hydroCost: number;
  water: number; waterMax: number; inflow: number; // dam reservoir (MWh) and river inflow (MW) once it's empty
  fineMWh: number; fineCritical: number;
  rev: number; fuel: number; hydro: number; fines: number;
}

export interface GEvent { minute: number; text: string; kind: "trip" | "shed" | "storm" | "info" | "restore"; line?: string; node?: string }

export interface Storm { start: number; end: number; target: string; hit: boolean; chance: number }

export interface State {
  v: 1;
  seed: number;
  minute: number; // absolute game minute since 00:00 day 1
  start: number; end: number;
  nodes: GNode[];
  lines: GLine[];
  events: GEvent[];
  storm: Storm | null;
  randomFaults: boolean; // off in the first scenario so the lesson is the scripted strike
  incidents: Incident[];
  econ: Econ;
  repairMin: number;
  stats: { demandMWh: number; servedMWh: number; weightedLost: number; trips: number; worstChain: number; minF: number };
  chain: { count: number; last: number };
  over: boolean;
  solveMs: number;
}

// ---------------------------------------------------------------------------
// RNG

export function rand(s: State): number {
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------------------
// Constants (tuning knobs)

export const HEAT_RATE = 24; // H += HEAT_RATE·(L² − 1) per minute
export const UFLS_HZ = 49.2; // automatic shedding threshold (deviation −0.8)
export const DROOP = 2.5; // Hz for a plant to move its full capacity
export const INERTIA = 0.6; // M = INERTIA × online capacity (MW per Hz per minute)
export const DAMPING = 0.2;
export const REPAIR_MIN = 30;
const FAULT_RATE = 1 / 40000; // per line per minute in calm weather

export const fmtTime = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// Map: a stylised, Addis-inspired city. Loose nicknames, not a real map.

type NodeSpec = Partial<GNode> & Pick<GNode, "id" | "name" | "kind" | "x" | "y">;
const N = (n: NodeSpec): GNode => ({
  cap: 0, ramp: 0, out: 0, set: 0, online: true, auto: false, soc: 0, socMax: 0,
  base: 0, profile: "flat", critical: false, priority: 5, served: true, shedAt: -1e9, shedBy: "", demand: 0, df: 0,
  lost: false, boost: 1, litMin: 0, minutes: 0,
  ...n,
});

export function newCity(seed = (Date.now() ^ 0x2545f491) | 0, setup?: (s: State) => void): State {
  const nodes: GNode[] = [
    N({ id: "dam", name: "River Dam", kind: "hydro", x: 110, y: 880, cap: 250, ramp: 30, out: 170, set: 170, auto: true }),
    N({ id: "gas", name: "Gas Plant", kind: "gas", x: 610, y: 890, cap: 150, ramp: 15, out: 60, set: 60, auto: true }),
    N({ id: "bat", name: "Battery", kind: "battery", x: 640, y: 330, cap: 50, ramp: 50, out: 0, set: 0, soc: 120, socMax: 200 }),
    N({ id: "subS", name: "South Sub", kind: "sub", x: 340, y: 730 }),
    N({ id: "subN", name: "North Sub", kind: "sub", x: 330, y: 360 }),
    N({ id: "centre", name: "Old Centre", kind: "district", x: 360, y: 545, base: 70, profile: "commerce", priority: 3 }),
    N({ id: "market", name: "Big Market", kind: "district", x: 120, y: 520, base: 60, profile: "market", priority: 2 }),
    N({ id: "hill", name: "Hilltop", kind: "district", x: 250, y: 150, base: 45, profile: "homes", priority: 1 }),
    N({ id: "east", name: "East Ring", kind: "district", x: 560, y: 520, base: 55, profile: "homes", priority: 1 }),
    N({ id: "air", name: "Airport", kind: "district", x: 610, y: 690, base: 35, profile: "flat", priority: 4 }),
    N({ id: "hosp", name: "Hospital", kind: "district", x: 480, y: 190, base: 25, profile: "flat", critical: true, priority: 9 }),
  ];
  const ix = (id: string) => nodes.findIndex((n) => n.id === id);
  const L = (id: string, a: string, b: string, limit: number): GLine => {
    const A = nodes[ix(a)], B = nodes[ix(b)];
    const len = Math.hypot(A.x - B.x, A.y - B.y);
    return { id, a: ix(a), b: ix(b), x: len / 1000, limit, closed: true, tripped: false, heat: 0, flow: 0, repair: 0, trippedAt: -1e9, rating: limit, hardened: false, peak: 0 };
  };
  const lines: GLine[] = [
    L("L1", "dam", "subS", 150),
    L("L2", "dam", "market", 160),
    L("L3", "gas", "subS", 110),
    L("L4", "gas", "air", 90),
    L("L5", "subS", "centre", 120),
    L("L6", "subS", "air", 70),
    L("L7", "market", "centre", 80),
    L("L8", "market", "subN", 100),
    L("L9", "centre", "subN", 80),
    L("L10", "subN", "hill", 90),
    L("L11", "subN", "hosp", 70),
    L("L12", "hill", "hosp", 50),
    L("L13", "centre", "east", 70),
    L("L14", "air", "east", 70),
    L("L15", "east", "bat", 60),
    L("L16", "bat", "hosp", 50),
  ];
  const start = 16 * 60;
  const s: State = {
    v: 1, seed, minute: start, start, end: 24 * 60 - 1, nodes, lines, events: [],
    storm: { start: 18 * 60 + 30, end: 19 * 60 + 30, target: "L1", hit: false, chance: 0.7 },
    randomFaults: false,
    incidents: [], repairMin: REPAIR_MIN,
    econ: { tariff: 120, fuelPrice: 110, hydroCost: 8, water: 1e9, waterMax: 1e9, inflow: 60, fineMWh: 250, fineCritical: 1500, rev: 0, fuel: 0, hydro: 0, fines: 0 },
    stats: { demandMWh: 0, servedMWh: 0, weightedLost: 0, trips: 0, worstChain: 0, minF: 50 },
    chain: { count: 0, last: -1e9 }, over: false, solveMs: 0,
  };
  setup?.(s);
  for (const l of s.lines) l.limit = l.rating;
  s.minute = s.start;
  updateDemand(s);
  balanceAndSolve(s, false);
  return s;
}

// ---------------------------------------------------------------------------
// Demand

const PROFILES: Record<Profile, number[]> = {
  //        0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23
  homes:   [0.5, .45, .45, .45, .5, .6, .75, .85, .7, .6, .6, .6, .65, .6, .6, .65, .75, .9, 1.05, 1.18, 1.2, 1.1, .9, .7],
  commerce:[.4, .35, .35, .35, .4, .5, .6, .8, .95, 1, 1, 1, 1, 1, 1, 1, 1, .95, .9, .85, .75, .65, .5, .45],
  market:  [.3, .3, .3, .3, .35, .5, .7, .9, 1, 1.05, 1.05, 1.05, 1, 1, 1, 1, .95, .9, .85, .8, .7, .55, .4, .35],
  flat:    [.85, .85, .85, .85, .85, .9, .95, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, .95, .9, .9],
};
export function profileAt(p: Profile, minute: number): number {
  const h = (minute % 1440) / 60;
  const a = Math.floor(h), f = h - a;
  const arr = PROFILES[p];
  return arr[a % 24] * (1 - f) + arr[(a + 1) % 24] * f;
}
/** Price response: customers use a bit less when power is expensive. */
export const priceFactor = (tariff: number) => Math.pow(tariff / 120, -0.6);
function updateDemand(s: State) {
  const pf = priceFactor(s.econ.tariff);
  for (const n of s.nodes) if (n.kind === "district") n.demand = n.lost ? 0 : n.base * n.boost * pf * profileAt(n.profile, s.minute) * (1 + 0.02 * Math.sin(s.minute / 7 + n.x));
}
/** Total demand expected at a future minute (forecast strip). */
export function forecastDemand(s: State, minute: number): number {
  const pf = priceFactor(s.econ.tariff);
  return s.nodes.reduce((a, n) => a + (n.kind === "district" && !n.lost ? n.base * pf * profileAt(n.profile, minute) : 0), 0);
}

// ---------------------------------------------------------------------------
// Helpers

export const isPlant = (n: GNode) => n.kind === "hydro" || n.kind === "gas" || n.kind === "battery";
export const load = (n: GNode) => (n.kind === "district" && n.served ? n.demand : 0);
export const lineLoad = (l: GLine) => (l.closed && !l.tripped ? Math.abs(l.flow) / l.limit : 0);
export const isLive = (l: GLine) => l.closed && !l.tripped;
const asFlow = (s: State, closed?: (l: GLine, i: number) => boolean): FlowLine[] =>
  s.lines.map((l, i) => ({ a: l.a, b: l.b, x: l.x, closed: closed ? closed(l, i) : isLive(l) }));

let curEcon: Econ | null = null; // set during a tick so plantMax can see the reservoir
export function plantMax(n: GNode, econ: Econ | null = curEcon): number {
  if (!n.online) return 0;
  if (n.kind === "battery") return n.soc > 0.5 ? n.cap : 0;
  if (n.kind === "hydro" && econ && econ.water <= 0) return Math.min(n.cap, econ.inflow);
  return n.cap;
}
function plantMin(n: GNode): number {
  if (!n.online) return 0;
  if (n.kind === "battery") return n.soc < n.socMax - 0.5 ? -n.cap : 0;
  return 0;
}

// ---------------------------------------------------------------------------
// The tick

export function tick(s: State) {
  if (s.over) return;
  curEcon = s.econ;
  s.minute++;
  incidents(s);
  updateDemand(s);
  weather(s);
  dispatch(s);
  balanceAndSolve(s, true);
  for (let pass = 0; pass < 3; pass++) {
    const tripped = thermalTrips(s);
    if (!tripped) break;
    balanceAndSolve(s, false); // flows re-split instantly after a trip
  }
  repairs(s);
  restore(s);
  accounting(s);
  if (s.minute >= s.end) s.over = true;
}

/** AGC: plants on auto follow their island's demand; everything moves at its ramp rate. */
function dispatch(s: State) {
  const isl = islands(s.nodes.length, asFlow(s));
  for (const group of isl) {
    const ns = group.map((i) => s.nodes[i]);
    const demand = ns.reduce((a, n) => a + load(n), 0);
    const fixed = ns.filter((n) => isPlant(n) && !n.auto).reduce((a, n) => a + n.set, 0);
    const autos = ns.filter((n) => isPlant(n) && n.auto && n.online);
    let need = demand - fixed;
    for (const n of autos) { n.set = clamp(need, plantMin(n), plantMax(n)); need -= n.set; }
  }
  for (const n of s.nodes) {
    if (!isPlant(n)) continue;
    const target = clamp(n.set, plantMin(n), plantMax(n));
    n.out += clamp(target - n.out, -n.ramp, n.ramp);
    if (!n.online) n.out = 0;
  }
}

/**
 * Steps 3–7 of the update order: islands, mismatch, frequency + auto shedding,
 * balance each island, solve flows. `dynamics` = advance frequency this call.
 */
export function balanceAndSolve(s: State, dynamics: boolean) {
  curEcon = s.econ;
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const fl = asFlow(s);
  const isl = islands(s.nodes.length, fl);
  const inject = new Array<number>(s.nodes.length).fill(0);

  for (const group of isl) {
    const ns = group.map((i) => s.nodes[i]);
    const plants = ns.filter((n) => isPlant(n) && n.online);
    const districts = ns.filter((n) => n.kind === "district");
    const df0 = ns.reduce((a, n) => a + n.df, 0) / ns.length;

    // An island with no generation goes dark.
    if (!plants.length || plants.every((p) => plantMax(p) <= 0)) {
      for (const d of districts) if (d.served) shed(s, d, "island");
      for (const n of ns) n.df = 0;
      continue;
    }
    // Explicit balancing: shed until demand fits what the island can produce.
    const capMax = plants.reduce((a, p) => a + plantMax(p), 0);
    let demand = districts.reduce((a, d) => a + load(d), 0);
    if (demand > capMax) {
      for (const d of [...districts].sort((a, b) => a.priority - b.priority)) {
        if (demand <= capMax) break;
        if (!d.served) continue;
        shed(s, d, "capacity");
        demand -= d.demand;
      }
    }

    // Frequency: scheduled output + droop response vs demand.
    let df = df0;
    const scheduled = plants.reduce((a, p) => a + p.out, 0);
    const droop = (p: GNode) => (p.kind === "gas" || p.kind === "hydro" || p.kind === "battery" ? clamp((-df / DROOP) * p.cap, plantMin(p) - p.out, plantMax(p) - p.out) : 0);
    if (dynamics) {
      const resp = plants.reduce((a, p) => a + droop(p), 0);
      const mismatch = scheduled + resp - demand;
      const M = Math.max(30, INERTIA * plants.reduce((a, p) => a + p.cap, 0));
      df = clamp(df + mismatch / M - DAMPING * df, -3, 3);
      if (50 + df < UFLS_HZ) {
        const last = Math.max(...districts.filter((d) => d.shedBy === "auto").map((d) => d.shedAt), -1e9);
        if (s.minute - last >= 2) {
          const victim = [...districts].filter((d) => d.served).sort((a, b) => a.priority - b.priority)[0];
          if (victim) { shed(s, victim, "auto"); demand -= victim.demand; }
        }
      }
    }
    for (const n of ns) n.df = df;
    s.stats.minF = Math.min(s.stats.minF, 50 + df);

    // Balance injections (distributed slack by headroom) so the DC solve is exact.
    const actual = plants.map((p) => p.out + (dynamics ? droop(p) : 0));
    let gap = demand - actual.reduce((a, b) => a + b, 0);
    const room = plants.map((p, i) => (gap > 0 ? plantMax(p) - actual[i] : actual[i] - plantMin(p)));
    const roomSum = room.reduce((a, b) => a + Math.max(0, b), 0);
    plants.forEach((p, i) => {
      const extra = roomSum > 0 ? (gap * Math.max(0, room[i])) / roomSum : gap / plants.length;
      inject[s.nodes.indexOf(p)] += actual[i] + extra;
    });
    for (const d of districts) inject[s.nodes.indexOf(d)] -= load(d);
  }

  const flows = new Array<number>(s.lines.length).fill(0);
  for (const group of isl) solveIsland(group, fl, inject, flows);
  s.lines.forEach((l, i) => (l.flow = flows[i]));
  // plant outputs as delivered (for display and battery accounting)
  s.nodes.forEach((n, i) => { if (isPlant(n)) (n as GNode & { delivered?: number }).delivered = inject[i] + 0; });
  if (t0) s.solveMs = performance.now() - t0;
}

function shed(s: State, d: GNode, by: GNode["shedBy"]) {
  if (!d.served) return;
  d.served = false; d.shedAt = s.minute; d.shedBy = by;
  const why = by === "auto" ? "frequency fell below 49.2 Hz" : by === "island" ? "it was cut off from every power plant" : by === "capacity" ? "its part of the grid ran out of generation" : "you switched it off";
  s.events.push({ minute: s.minute, kind: "shed", node: d.id, text: `${d.name} went dark: ${why}.` });
}

/** Step 8–9: heat and trips. Returns true if anything tripped. */
function thermalTrips(s: State): boolean {
  let any = false;
  for (const l of s.lines) {
    if (!isLive(l)) { l.heat = Math.max(0, l.heat - 15); continue; }
    if (l.heat < 100) continue;
    tripLine(s, l, `overheated at ${Math.round(lineLoad(l) * 100)}% load`);
    any = true;
  }
  return any;
}
export function heatStep(s: State) {
  for (const l of s.lines) if (isLive(l)) { const L = lineLoad(l); l.heat = clamp(l.heat + HEAT_RATE * (L * L - 1), 0, 100); }
}

export function tripLine(s: State, l: GLine, why: string) {
  if (l.tripped) return;
  l.tripped = true; l.heat = Math.min(l.heat, 100); l.trippedAt = s.minute;
  s.stats.trips++;
  if (s.minute - s.chain.last <= 30) s.chain.count++; else s.chain.count = 1;
  s.chain.last = s.minute;
  s.stats.worstChain = Math.max(s.stats.worstChain, s.chain.count);
  const A = s.nodes[l.a].name, B = s.nodes[l.b].name;
  s.events.push({ minute: s.minute, kind: "trip", line: l.id, text: `${A} – ${B} line tripped: ${why}.` });
}

function incidents(s: State) {
  for (const inc of s.incidents) {
    if (inc.done === 0 && s.minute >= inc.at) {
      inc.done = 1;
      s.events.push({ minute: s.minute, kind: inc.kind === "fault" ? "trip" : "storm", text: inc.text, node: inc.kind === "spike" ? inc.target : undefined, line: inc.kind === "fault" ? inc.target : undefined });
      if (inc.kind === "heat") { for (const n of s.nodes) if (n.kind === "district" && n.profile === "homes") n.boost *= inc.mult ?? 1.2; for (const l of s.lines) l.limit = Math.round(l.rating * 0.9); }
      if (inc.kind === "spike") { const n = s.nodes.find((x) => x.id === inc.target); if (n) n.boost *= inc.mult ?? 1.4; }
      if (inc.kind === "fuel") s.econ.fuelPrice = Math.round(s.econ.fuelPrice * (inc.mult ?? 1.8));
      if (inc.kind === "fault") { const l = s.lines.find((x) => x.id === inc.target); if (l && isLive(l)) tripLine(s, l, "equipment failure"); }
    } else if (inc.done === 1 && s.minute >= inc.at + inc.dur) {
      inc.done = 2;
      if (inc.kind === "heat") { for (const n of s.nodes) if (n.kind === "district" && n.profile === "homes") n.boost /= inc.mult ?? 1.2; for (const l of s.lines) l.limit = l.rating; }
      if (inc.kind === "spike") { const n = s.nodes.find((x) => x.id === inc.target); if (n) n.boost /= inc.mult ?? 1.4; }
      if (inc.kind === "fuel") s.econ.fuelPrice = Math.round(s.econ.fuelPrice / (inc.mult ?? 1.8));
    }
  }
}

function weather(s: State) {
  heatStep(s);
  const st = s.storm;
  const stormy = !!st && s.minute >= st.start && s.minute <= st.end;
  if (st && s.minute === st.start) s.events.push({ minute: s.minute, kind: "storm", text: "Storm reached the city. Lines in its path may fail." });
  if (st && stormy && !st.hit && s.minute === st.start + 12) {
    st.hit = true;
    const l = s.lines.find((x) => x.id === st.target);
    if (l && isLive(l) && !l.hardened) tripLine(s, l, "lightning strike");
    else if (l && l.hardened) s.events.push({ minute: s.minute, kind: "info", line: l.id, text: `Lightning hit ${s.nodes[l.a].name} – ${s.nodes[l.b].name}, but your storm-proofing held.` });
  }
  if (s.randomFaults) for (const l of s.lines) {
    if (!isLive(l)) continue;
    const p = FAULT_RATE * (stormy ? 4 : 1) * (l.heat > 50 ? 2 : 1);
    if (rand(s) < p) tripLine(s, l, "a fault (old equipment)");
  }
}

function repairs(s: State) {
  for (const l of s.lines) {
    if (l.repair > 0) {
      l.repair--;
      if (l.repair === 0) { l.tripped = false; l.heat = 0; s.events.push({ minute: s.minute, kind: "restore", line: l.id, text: `${s.nodes[l.a].name} – ${s.nodes[l.b].name} line repaired.` }); }
    }
  }
  for (const n of s.nodes) if (n.kind === "battery") n.soc = clamp(n.soc - n.out / 60 * (n.out < 0 ? 0.9 : 1), 0, n.socMax);
}

/** Bring districts back when their island has room and frequency is healthy. */
function restore(s: State) {
  const isl = islands(s.nodes.length, asFlow(s));
  for (const group of isl) {
    const ns = group.map((i) => s.nodes[i]);
    const plants = ns.filter((n) => isPlant(n) && n.online);
    if (!plants.length) continue;
    const df = ns[0].df;
    if (50 + df < 49.85) continue;
    // only plants on auto will pick up a restored district
    const head = plants.filter((p) => p.auto).reduce((a, p) => a + Math.max(0, plantMax(p) - p.out), 0);
    const waiting = ns.filter((n) => n.kind === "district" && !n.lost && !n.served && n.shedBy !== "player" && s.minute - n.shedAt >= 5).sort((a, b) => b.priority - a.priority)[0];
    if (waiting && head > waiting.demand * 1.15) {
      waiting.served = true; waiting.shedBy = "";
      s.events.push({ minute: s.minute, kind: "restore", node: waiting.id, text: `${waiting.name} is back on.` });
      return; // one per minute
    }
  }
}

function accounting(s: State) {
  for (const n of s.nodes) {
    if (n.kind !== "district") continue;
    s.stats.demandMWh += n.demand / 60;
    if (n.served) s.stats.servedMWh += n.demand / 60;
    else s.stats.weightedLost += (n.demand / 60) * (n.critical ? 10 : 1);
    if (n.lost) continue;
    n.minutes++;
    if (n.served) { n.litMin++; s.econ.rev += (n.demand / 60) * s.econ.tariff; }
    else s.econ.fines += (n.demand / 60) * (n.critical ? s.econ.fineCritical : s.econ.fineMWh);
  }
  const e = s.econ;
  for (const n of s.nodes) {
    if (n.kind === "gas") e.fuel += (Math.max(0, n.out) / 60) * e.fuelPrice;
    if (n.kind === "hydro") { e.hydro += (Math.max(0, n.out) / 60) * e.hydroCost; if (e.water < 1e8) e.water = Math.max(0, e.water - Math.max(0, n.out - e.inflow) / 60); }
  }
  for (const l of s.lines) l.peak = Math.max(l.peak, lineLoad(l));
}

// ---------------------------------------------------------------------------
// Player actions

export function toggleBreaker(s: State, id: string) {
  const l = s.lines.find((x) => x.id === id);
  if (!l || l.tripped) return;
  l.closed = !l.closed;
  s.events.push({ minute: s.minute, kind: "info", line: l.id, text: `You ${l.closed ? "closed" : "opened"} the ${s.nodes[l.a].name} – ${s.nodes[l.b].name} breaker.` });
  balanceAndSolve(s, false);
}
export function cutLine(s: State, id: string) {
  const l = s.lines.find((x) => x.id === id);
  if (l && isLive(l)) { tripLine(s, l, "you cut it (test)"); balanceAndSolve(s, false); }
}
export function repairLine(s: State, id: string) {
  const l = s.lines.find((x) => x.id === id);
  if (l && l.tripped && l.repair === 0) l.repair = s.repairMin;
}
export function setPlant(s: State, id: string, mw: number) {
  const n = s.nodes.find((x) => x.id === id);
  if (!n || !isPlant(n)) return;
  n.auto = false;
  n.set = clamp(Math.round(mw), -n.cap * (n.kind === "battery" ? 1 : 0), n.cap);
}
export function setAuto(s: State, id: string, on: boolean) {
  const n = s.nodes.find((x) => x.id === id);
  if (n && isPlant(n)) n.auto = on;
}
export function toggleDistrict(s: State, id: string) {
  const n = s.nodes.find((x) => x.id === id);
  if (!n || n.kind !== "district") return;
  if (n.served) shed(s, n, "player");
  else { n.served = true; n.shedBy = ""; s.events.push({ minute: s.minute, kind: "restore", node: n.id, text: `You switched ${n.name} back on.` }); }
  balanceAndSolve(s, false);
}

/** Predicted line loads if a breaker were toggled (for the preview). Does not change state. */
export function previewToggle(s: State, id: string): number[] {
  const clone: State = JSON.parse(JSON.stringify(s));
  const l = clone.lines.find((x) => x.id === id);
  if (l && !l.tripped) l.closed = !l.closed;
  balanceAndSolve(clone, false);
  return clone.lines.map((x) => lineLoad(x));
}

export function servedPct(s: State): number {
  return s.stats.demandMWh > 0 ? s.stats.servedMWh / s.stats.demandMWh : 1;
}
export function totals(s: State) {
  const demand = s.nodes.reduce((a, n) => a + (n.kind === "district" ? n.demand : 0), 0);
  const served = s.nodes.reduce((a, n) => a + load(n), 0);
  const gen = s.nodes.reduce((a, n) => a + (isPlant(n) ? n.out : 0), 0);
  const capacity = s.nodes.reduce((a, n) => a + (isPlant(n) ? plantMax(n, s.econ) : 0), 0);
  // frequency of the island serving the most load
  const isl = islands(s.nodes.length, asFlow(s));
  let best = isl[0], bestLoad = -1;
  for (const g of isl) { const l = g.reduce((a, i) => a + load(s.nodes[i]) + (s.nodes[i].kind === "district" ? 0.001 : 0), 0); if (l > bestLoad) { bestLoad = l; best = g; } }
  const df = s.nodes[best[0]].df;
  return { demand, served, gen, capacity, hz: 50 + df };
}
