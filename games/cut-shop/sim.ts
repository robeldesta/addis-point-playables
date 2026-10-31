// Cut Shop: the economic simulation. Pure logic, no DOM, so it can be
// balance-tested headless. One turn = one week of five working days.

export type SegId = "stands" | "signs" | "decor" | "parts" | "models";
export type MatId = "ply" | "acr" | "steel";
export type MachineKind = "hobby" | "pro" | "fiber";
export type Priority = "fifo" | "margin" | "due";
export type Persona = "cutter" | "premium" | "copycat";

export const SEGS: SegId[] = ["stands", "signs", "decor", "parts", "models"];
export const MATS: MatId[] = ["ply", "acr", "steel"];

export interface SegDef {
  id: SegId;
  name: string;
  icon: string;
  mat: MatId;
  sheets: number; // sheets of material per unit
  cutMin: number; // laser minutes per unit at speed 1
  ref: number; // the price customers consider "normal"
  potential: number; // weekly units the whole city would buy at ref price
  elasticity: number; // how hard customers punish a high price
  qualityW: number; // how much they care about reputation
  speedW: number; // how much they care about lead time
  promise: number; // days customers expect to wait
  minPrecision: number;
  fiber: boolean; // needs a fiber laser (metal)
  blurb: string;
}

export const SEG: Record<SegId, SegDef> = {
  stands: { id: "stands", name: "Phone stands & gifts", icon: "📱", mat: "ply", sheets: 0.1, cutMin: 12, ref: 14, potential: 560, elasticity: 5, qualityW: 0.35, speedW: 0.5, promise: 5, minPrecision: 0, fiber: false, blurb: "High volume, thin margins. Shoppers chase the lowest price." },
  signs: { id: "signs", name: "Shop signs", icon: "🪧", mat: "acr", sheets: 0.35, cutMin: 45, ref: 75, potential: 115, elasticity: 3.4, qualityW: 0.7, speedW: 0.9, promise: 4, minPrecision: 0, fiber: false, blurb: "Businesses pay well but hate waiting." },
  decor: { id: "decor", name: "Wedding decor", icon: "💍", mat: "ply", sheets: 0.18, cutMin: 24, ref: 30, potential: 190, elasticity: 3.6, qualityW: 1.0, speedW: 0.6, promise: 7, minPrecision: 0, fiber: false, blurb: "Seasonal. Peaks in summer. Couples care about quality." },
  parts: { id: "parts", name: "Machine parts", icon: "⚙️", mat: "steel", sheets: 0.15, cutMin: 20, ref: 26, potential: 300, elasticity: 4, qualityW: 1.1, speedW: 0.8, promise: 5, minPrecision: 0, fiber: true, blurb: "Steady B2B demand. Needs a fiber laser for metal." },
  models: { id: "models", name: "Architect models", icon: "🏛️", mat: "acr", sheets: 0.6, cutMin: 120, ref: 260, potential: 26, elasticity: 2.6, qualityW: 1.5, speedW: 0.3, promise: 10, minPrecision: 0.8, fiber: false, blurb: "Premium, precise work. Needs a precise laser (Pro or better)." },
};

export interface MatDef { id: MatId; name: string; base: number; icon: string }
export const MAT: Record<MatId, MatDef> = {
  ply: { id: "ply", name: "Plywood", base: 20, icon: "🟫" },
  acr: { id: "acr", name: "Acrylic", base: 34, icon: "🟦" },
  steel: { id: "steel", name: "Steel", base: 60, icon: "⬜" },
};

export interface MachineDef {
  kind: MachineKind;
  name: string;
  speed: number;
  precision: number;
  buy: number;
  lease: number; // 0 = can't lease
  power: number; // $ electricity per running hour
  wear: number; // condition lost per running hour
  service: number;
  repair: number;
  blurb: string;
}
export const MACH: Record<MachineKind, MachineDef> = {
  hobby: { kind: "hobby", name: "Hobby CO₂ 40W", speed: 1, precision: 0.65, buy: 4500, lease: 0, power: 1.5, wear: 0.26, service: 180, repair: 550, blurb: "Slow, a bit sloppy. Wood and acrylic." },
  pro: { kind: "pro", name: "Pro CO₂ 100W", speed: 2, precision: 0.86, buy: 30000, lease: 700, power: 3, wear: 0.17, service: 450, repair: 1500, blurb: "2.2× faster, precise enough for architect models." },
  fiber: { kind: "fiber", name: "Fiber laser 2kW", speed: 2, precision: 0.95, buy: 65000, lease: 1550, power: 10, wear: 0.14, service: 1100, repair: 3800, blurb: "Cuts steel. Unlocks machine parts." },
};

export interface TierDef { name: string; rent: number; slots: number; storage: number }
export const TIERS: TierDef[] = [
  { name: "Garage unit", rent: 650, slots: 2, storage: 80 },
  { name: "Studio", rent: 1500, slots: 4, storage: 200 },
  { name: "Factory floor", rent: 3000, slots: 8, storage: 500 },
];
export const MOVE_COST = 2500;

export type UpgradeId = "nesting" | "qc" | "extractor" | "webstore" | "crm" | "analytics";
export interface UpgradeDef { id: UpgradeId; name: string; cost: number; weekly: number; blurb: string }
export const UPG: Record<UpgradeId, UpgradeDef> = {
  nesting: { id: "nesting", name: "Nesting software", cost: 2400, weekly: 0, blurb: "Packs parts tighter. Scrap 14% → 6%." },
  qc: { id: "qc", name: "QC station", cost: 3000, weekly: 0, blurb: "Catches bad cuts. Defects −40%." },
  extractor: { id: "extractor", name: "Fume extractor", cost: 1800, weekly: 0, blurb: "Machines wear 25% slower. Staff happier. Inspectors happy." },
  webstore: { id: "webstore", name: "Online store", cost: 2000, weekly: 60, blurb: "+25% potential for stands and decor. +$60/wk hosting." },
  crm: { id: "crm", name: "Quoting software", cost: 1500, weekly: 30, blurb: "Contract bids score 6% better and you see rivals' bid range." },
  analytics: { id: "analytics", name: "Market analytics", cost: 1200, weekly: 0, blurb: "Demand forecasts get 3× more accurate." },
};

export const WAGE = 750;
export const HIRE_FEE = 400;
export const ADMIN = 200;
export const OWNER_DRAW = 500; // your own living costs
export const SCRAP = 0.14;
export const SCRAP_NESTED = 0.06;
export const RUSH_MARKUP = 1.35;
export const HOLDING = 0.015; // per week, of inventory value
export const WEEKS = 52;

// ---------------------------------------------------------------------------

export interface Machine { id: number; kind: MachineKind; cond: number; leased: boolean; down: number; service: boolean; hours: number; age: number }
export interface Worker { id: number; name: string; skill: number; morale: number; wage: number; weeks: number; owner?: boolean; intern?: number }
export interface Job { seg: SegId; units: number; day: number; due: number; price: number; contract?: number }
export interface Contract {
  id: number; client: string; seg: SegId; qty: number; weeks: number; maxPrice: number;
  bid: number; // your per-unit bid, 0 = no bid
  status: "open" | "won" | "lost" | "done" | "late";
  winner?: string; bids?: { who: string; price: number }[]; due?: number; delivered: number;
}
export interface Rival {
  id: number; name: string; persona: Persona; color: string; cash: number; aw: number;
  rep: Record<SegId, number>; on: Record<SegId, boolean>; price: Record<SegId, number>;
  cap: number; fiberCap: number; costMin: number; fixed: number;
  util: number; profit: number; units: Record<SegId, number>; lead: Record<SegId, number>;
  bust: boolean; hot: number; known: boolean;
}
export interface Mod { kind: "demand" | "mat" | "elec" | "ref"; seg?: SegId; mat?: MatId; mult: number; weeks: number; label: string }

export interface SegStats { orders: number; done: number; onTime: number; late: number; lost: number; defects: number; revenue: number; matCost: number; minutes: number; share: number; missed: number }
export interface DaySnap { cash: number; orders: number; done: number; running: number[]; note?: string }
export interface Report {
  week: number;
  revenue: number; contractRevenue: number;
  costs: { label: string; amount: number }[];
  profit: number;
  seg: Record<SegId, SegStats>;
  days: DaySnap[];
  notes: string[];
  rivalMoves: string[];
  util: number;
}

export interface EventChoice { label: string; hint: string; fx: string }
export interface GameEvent { id: string; title: string; text: string; choices: EventChoice[]; data?: any }

export interface State {
  v: number;
  seed: number;
  week: number; // 1-based, the week being planned
  cash: number;
  debt: number;
  tier: number;
  machines: Machine[];
  workers: Worker[];
  nextId: number;
  inv: Record<MatId, number>;
  matIdx: Record<MatId, number>;
  matHist: Record<MatId, number[]>;
  price: Record<SegId, number>;
  open: Record<SegId, boolean>;
  rep: Record<SegId, number>;
  aw: number;
  marketing: number;
  overtime: boolean;
  priority: Priority;
  upg: Record<UpgradeId, boolean>;
  jobs: Job[];
  contracts: Contract[];
  rivals: Rival[];
  mods: Mod[];
  trend: Record<SegId, number>;
  refMult: Record<SegId, number>;
  rentMult: number;
  event: GameEvent | null;
  last: Report | null;
  hist: { week: number; cash: number; worth: number; profit: number; revenue: number }[];
  priceHist: { week: number; you: Record<SegId, number>; rivals: Record<string, Record<SegId, number>> }[];
  over: null | "bankrupt" | "done";
  best: number;
  bestEver: number;
  coach: number;
  lastDemand: Record<SegId, number>;
}

// ---------------------------------------------------------------------------
// RNG (seeded, stored in state so a save resumes deterministically)

export function rand(s: State): number {
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randn = (s: State) => {
  const u = Math.max(1e-9, rand(s)), v = rand(s);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
function poisson(s: State, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * randn(s)));
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(s); } while (p > L);
  return k - 1;
}
const pick = <T>(s: State, a: T[]): T => a[Math.floor(rand(s) * a.length)];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const segRec = <T>(f: (k: SegId) => T): Record<SegId, T> => Object.fromEntries(SEGS.map((k) => [k, f(k)])) as Record<SegId, T>;
const matRec = <T>(f: (k: MatId) => T): Record<MatId, T> => Object.fromEntries(MATS.map((k) => [k, f(k)])) as Record<MatId, T>;
export const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------

const NAMES = ["Sam", "Lina", "Tomas", "Ayo", "Mei", "Ravi", "Noor", "Jonas", "Elif", "Kofi", "Ana", "Yuki", "Dawit", "Zara", "Leo", "Ines"];

export function newGame(seed = (Date.now() ^ 0x5bd1e995) | 0): State {
  const s: State = {
    v: 1, seed, week: 1, cash: 9000, debt: 0, tier: 0,
    machines: [{ id: 1, kind: "hobby", cond: 88, leased: false, down: 0, service: false, hours: 0, age: 40 }],
    workers: [{ id: 2, name: "You", skill: 0.55, morale: 80, wage: 0, weeks: 0, owner: true }],
    nextId: 10,
    inv: { ply: 24, acr: 8, steel: 0 },
    matIdx: { ply: 1, acr: 1, steel: 1 },
    matHist: { ply: [1], acr: [1], steel: [1] },
    price: segRec((k) => SEG[k].ref),
    open: { stands: true, signs: true, decor: true, parts: false, models: false },
    rep: segRec(() => 50),
    aw: 25, marketing: 100, overtime: false, priority: "fifo",
    upg: { nesting: false, qc: false, extractor: false, webstore: false, crm: false, analytics: false },
    jobs: [], contracts: [], mods: [],
    trend: segRec(() => 1), refMult: segRec(() => 1), rentMult: 1,
    rivals: [
      mkRival(1, "Zap Bros", "cutter", "#ff4d6d", 14000, 45, 40, ["stands", "signs", "decor"], 8000, 0.19, 1700),
      mkRival(2, "Atelier Lumen", "premium", "#b388ff", 38000, 55, 68, ["signs", "decor", "models"], 5500, 0.22, 3000),
      mkRival(3, "Mirror Lasers", "copycat", "#4dd0e1", 20000, 35, 52, ["stands", "signs", "decor"], 5000, 0.2, 1400),
    ],
    event: null, last: null, hist: [], priceHist: [], over: null, best: 0, bestEver: 0, coach: 0,
    lastDemand: segRec(() => 0),
  };
  s.rivals[0].price = segRec((k) => round2(SEG[k].ref * 0.9));
  s.rivals[1].price = segRec((k) => round2(SEG[k].ref * 1.3));
  s.rivals[2].price = segRec((k) => round2(SEG[k].ref * 1.0));
  s.hist.push({ week: 0, cash: s.cash, worth: netWorth(s), profit: 0, revenue: 0 });
  s.contracts.push(makeContract(s, "stands"));
  return s;
}

function mkRival(id: number, name: string, persona: Persona, color: string, cash: number, aw: number, rep: number, segs: SegId[], cap: number, costMin: number, fixed: number): Rival {
  return {
    id, name, persona, color, cash, aw, rep: segRec(() => rep), on: segRec((k) => segs.includes(k)), price: segRec((k) => SEG[k].ref),
    cap, fiberCap: 0, costMin, fixed, util: 0.7, profit: 0, units: segRec(() => 0), lead: segRec((k) => SEG[k].promise * 0.5),
    bust: false, hot: 0, known: false,
  };
}

// ---------------------------------------------------------------------------
// Derived numbers the UI also needs

export const scrapRate = (s: State) => (s.upg.nesting ? SCRAP_NESTED : SCRAP);
export const matPrice = (s: State, m: MatId) => round2(MAT[m].base * s.matIdx[m] * modMult(s, "mat", undefined, m));
export const elecMult = (s: State) => modMult(s, "elec");
export const refPrice = (s: State, k: SegId) => SEG[k].ref * s.refMult[k];

function modMult(s: State, kind: Mod["kind"], seg?: SegId, mat?: MatId): number {
  let m = 1;
  for (const x of s.mods) if (x.kind === kind && (x.seg === undefined || x.seg === seg) && (x.mat === undefined || x.mat === mat)) m *= x.mult;
  return m;
}

export function season(k: SegId, week: number): number {
  const w = ((week - 1) % 52) + 1;
  switch (k) {
    case "stands": return w >= 45 && w <= 51 ? 1.9 : w === 6 || w === 7 ? 1.3 : 1;
    case "decor": return w >= 18 && w <= 38 ? 1.45 : w <= 8 || w >= 46 ? 0.65 : 1;
    case "parts": return 1 + 0.12 * Math.sin((w / 52) * Math.PI * 2);
    case "models": return w >= 36 && w <= 44 ? 1.25 : 1;
    default: return 1;
  }
}

export function potential(s: State, k: SegId, week = s.week): number {
  let p = SEG[k].potential * season(k, week) * s.trend[k] * modMult(s, "demand", k);
  if (s.upg.webstore && (k === "stands" || k === "decor")) p *= 1.25;
  return p;
}

export function canMake(s: State, k: SegId, kind: MachineKind): boolean {
  const d = SEG[k], m = MACH[kind];
  if (d.fiber !== (kind === "fiber")) return false;
  return m.precision >= d.minPrecision;
}
export const segPossible = (s: State, k: SegId) => s.machines.some((m) => canMake(s, k, m.kind));

export function avgSkill(s: State): number {
  if (!s.workers.length) return 0.5;
  return s.workers.reduce((a, w) => a + w.skill, 0) / s.workers.length;
}

/** Fraction of cuts that fail and must be redone, for a machine. */
export function defectRate(s: State, kind: MachineKind): number {
  const m = MACH[kind];
  let d = 0.1 * ((1 - m.precision) / 0.35) * (1.25 - avgSkill(s));
  if (s.overtime) d *= 1.3;
  if (s.upg.qc) d *= 0.6;
  const tired = s.workers.filter((w) => w.morale < 40).length / Math.max(1, s.workers.length);
  d *= 1 + tired * 0.5;
  return clamp(d, 0.005, 0.4);
}

export const hoursPerPerson = (s: State) => (s.overtime ? 52 : 40);
export function staffHours(s: State): number {
  return s.workers.reduce((a, w) => a + (w.intern ? 20 : hoursPerPerson(s)) * (w.weeks < 1 && !w.owner ? 0.5 : 1), 0);
}

/** Weekly cutting minutes (speed adjusted) available for a segment, ignoring other segments. */
export function capacityFor(s: State, k: SegId): number {
  let mach = 0;
  for (const m of s.machines) if (canMake(s, k, m.kind)) mach += 80 * 60 * MACH[m.kind].speed * (m.down > 0 ? 0.5 : 1);
  return Math.min(mach, staffHours(s) * 60 * bestSpeed(s, k));
}
function bestSpeed(s: State, k: SegId) {
  let b = 0;
  for (const m of s.machines) if (canMake(s, k, m.kind)) b = Math.max(b, MACH[m.kind].speed);
  return b || 1;
}

/** Laser-minutes of work currently queued that a machine class can do. */
function backlogMin(s: State, k: SegId): number {
  let t = 0;
  const fiber = SEG[k].fiber;
  for (const j of s.jobs) if (SEG[j.seg].fiber === fiber) t += j.units * SEG[j.seg].cutMin;
  return t;
}

/** Expected days a new order waits. */
export function leadDays(s: State, k: SegId): number {
  const cap = capacityFor(s, k) / 5; // speed-adjusted minutes per day
  if (cap <= 0) return 99;
  return round2(0.6 + backlogMin(s, k) / cap);
}

export function unitMatCost(s: State, k: SegId): number {
  return SEG[k].sheets * matPrice(s, SEG[k].mat) * (1 + scrapRate(s));
}
/** Variable cost per good unit: material (incl. scrap & defects) + electricity. */
export function unitVarCost(s: State, k: SegId): number {
  const kind = bestKind(s, k);
  const d = kind ? defectRate(s, kind) : 0.08;
  const sp = kind ? MACH[kind].speed : 1;
  const pw = kind ? MACH[kind].power : 1.5;
  return (unitMatCost(s, k) + (SEG[k].cutMin / sp / 60) * pw * elecMult(s)) / (1 - d);
}
function bestKind(s: State, k: SegId): MachineKind | undefined {
  let best: MachineKind | undefined;
  for (const m of s.machines) if (canMake(s, k, m.kind) && (!best || MACH[m.kind].speed > MACH[best].speed)) best = m.kind;
  return best;
}
/** Laser minutes one good unit really takes on your best machine. */
export function unitMinutes(s: State, k: SegId): number {
  const kind = bestKind(s, k);
  if (!kind) return SEG[k].cutMin;
  return SEG[k].cutMin / MACH[kind].speed / (1 - defectRate(s, kind));
}

export function fixedWeekly(s: State): number {
  let f = TIERS[s.tier].rent * s.rentMult + ADMIN + OWNER_DRAW;
  for (const w of s.workers) f += w.wage;
  for (const m of s.machines) if (m.leased) f += MACH[m.kind].lease;
  for (const u of Object.keys(UPG) as UpgradeId[]) if (s.upg[u]) f += UPG[u].weekly;
  f += s.marketing;
  f += s.debt * interestRate(s);
  return f;
}
export const interestRate = (_s: State) => 0.006;
export function creditLimit(s: State): number {
  const assets = s.machines.filter((m) => !m.leased).reduce((a, m) => a + resale(m), 0);
  return Math.round((8000 + assets * 0.6 + Math.max(0, s.best) * 0.1) / 500) * 500;
}
export function resale(m: Machine): number {
  if (m.leased) return 0;
  return Math.round(MACH[m.kind].buy * 0.6 * (0.45 + m.cond / 180) * Math.max(0.5, 1 - m.age / 400));
}
export function invValue(s: State): number {
  return MATS.reduce((a, k) => a + s.inv[k] * matPrice(s, k), 0);
}
export function netWorth(s: State): number {
  return Math.round(s.cash - s.debt + invValue(s) + s.machines.reduce((a, m) => a + resale(m), 0));
}
export const storageUsed = (s: State) => MATS.reduce((a, k) => a + s.inv[k], 0);

// ---------------------------------------------------------------------------
// Demand: multinomial logit over every shop in a segment plus "not buying".

interface Offer { who: string; price: number; rep: number; lead: number; aw: number }

function utility(s: State, k: SegId, o: Offer): number {
  const d = SEG[k];
  const ref = refPrice(s, k);
  return -d.elasticity * Math.log(o.price / ref) + d.qualityW * (o.rep - 50) / 45 - d.speedW * (o.lead / d.promise) + 0.8 * (o.aw - 40) / 40 - 0.6;
}

function offers(s: State, k: SegId, you: { price: number; lead: number } | null): Offer[] {
  const list: Offer[] = [];
  if (you) list.push({ who: "you", price: you.price, rep: s.rep[k], lead: you.lead, aw: s.aw });
  for (const r of s.rivals) if (!r.bust && r.on[k]) list.push({ who: r.name, price: r.price[k], rep: r.rep[k], lead: r.lead[k], aw: r.aw });
  return list;
}

export function shares(s: State, k: SegId, you: { price: number; lead: number } | null, week = s.week): { who: string; units: number; share: number }[] {
  const os = offers(s, k, you);
  const ex = os.map((o) => Math.exp(utility(s, k, o)));
  const tot = 1 + ex.reduce((a, b) => a + b, 0);
  const pot = potential(s, k, week);
  return os.map((o, i) => ({ who: o.who, share: ex[i] / tot, units: (pot * ex[i]) / tot }));
}

/** What the player would sell at a price this week, from the player's point of view. */
export function forecast(s: State, k: SegId, price = s.price[k]) {
  const lead = leadDays(s, k);
  const sh = shares(s, k, { price, lead });
  const you = sh.find((x) => x.who === "you")!;
  const units = you.units;
  const vc = unitVarCost(s, k);
  const err = s.upg.analytics ? 0.08 : 0.25;
  return {
    units, lo: units * (1 - err), hi: units * (1 + err), share: you.share,
    margin: price - vc, contribution: units * (price - vc), minutes: units * unitMinutes(s, k), lead, vc,
    perHour: (price - vc) / (unitMinutes(s, k) / 60),
  };
}

// ---------------------------------------------------------------------------
// Contracts: sealed-bid tenders against the rivals

const CLIENTS: Record<SegId, string[]> = {
  stands: ["Brightline Telecom", "City Museum shop", "Hotel Cascada", "Startup Fest"],
  signs: ["Grand Mall", "Riverside Clinic", "Northside Gym", "Bean Republic cafés"],
  decor: ["Bloom Weddings", "Gala Events Co.", "Crystal Ballroom", "Summer Fair"],
  parts: ["Vela Robotics", "Pump & Valve Ltd", "AgriTech Works", "Metro Rail depot"],
  models: ["Studio Ortega", "Kline Architects", "City Planning Office", "Harbor Developments"],
};

export function makeContract(s: State, seg?: SegId): Contract {
  const k = seg ?? pick(s, SEGS);
  const d = SEG[k];
  const minutes = 900 + rand(s) * 2400;
  const qty = Math.max(4, Math.round(minutes / d.cutMin / 5) * 5);
  return {
    id: s.nextId++, client: pick(s, CLIENTS[k]), seg: k, qty, weeks: 2 + Math.floor(rand(s) * 2),
    maxPrice: round2(refPrice(s, k) * (0.95 + rand(s) * 0.25)), bid: 0, status: "open", delivered: 0,
  };
}

function rivalBid(s: State, r: Rival, c: Contract): number | null {
  if (r.bust) return null;
  const d = SEG[c.seg];
  if (d.fiber && r.fiberCap <= 0) return null;
  if (d.minPrecision > 0.8 && r.persona !== "premium") return null;
  if (r.util > 0.97 && rand(s) < 0.6) return null;
  const cost = d.sheets * matPrice(s, d.mat) * 1.12 + d.cutMin * r.costMin;
  const mk = r.persona === "cutter" ? 1.12 : r.persona === "premium" ? 1.7 : 1.35;
  const load = r.util > 0.85 ? 1.15 : 1;
  return round2(Math.max(cost * 1.04, cost * mk * load * (0.92 + rand(s) * 0.16)));
}

function resolveContract(s: State, c: Contract, notes: string[]) {
  const bids: { who: string; price: number; rep: number }[] = [];
  if (c.bid > 0) bids.push({ who: "you", price: c.bid, rep: s.rep[c.seg] + (s.upg.crm ? 12 : 0) });
  for (const r of s.rivals) {
    const b = rivalBid(s, r, c);
    if (b !== null) bids.push({ who: r.name, price: b, rep: r.rep[c.seg] });
  }
  const valid = bids.filter((b) => b.price <= c.maxPrice);
  valid.sort((a, b) => a.price / (1 + (a.rep - 50) / 200) - b.price / (1 + (b.rep - 50) / 200));
  c.bids = bids.map((b) => ({ who: b.who, price: b.price }));
  const w = valid[0];
  if (!w) { c.status = "lost"; c.winner = "nobody (all over budget)"; if (c.bid) notes.push(`📄 ${c.client}: every bid was over their $${c.maxPrice} budget.`); return; }
  c.winner = w.who;
  if (w.who === "you") {
    c.status = "won";
    const day0 = (s.week - 1) * 5;
    c.due = day0 + c.weeks * 5 - 1;
    s.jobs.push({ seg: c.seg, units: c.qty, day: day0, due: c.due, price: c.bid, contract: c.id });
    notes.push(`📄 You won ${c.client}: ${c.qty} × ${SEG[c.seg].name.toLowerCase()} at $${c.bid}. Due in ${c.weeks} weeks.`);
  } else {
    c.status = "lost";
    const r = s.rivals.find((x) => x.name === w.who);
    if (r) r.hot += c.qty * SEG[c.seg].cutMin; // eats their capacity
    if (c.bid) notes.push(`📄 ${w.who} won ${c.client} at $${w.price}/unit (you bid $${c.bid}).`);
  }
}

// ---------------------------------------------------------------------------
// Player actions (all return an error string, or "" on success)

export function slotsFree(s: State) { return TIERS[s.tier].slots - s.machines.length; }

export function buyMachine(s: State, kind: MachineKind, lease: boolean, price?: number, cond = 100): string {
  if (slotsFree(s) <= 0) return "No room. Move to a bigger workshop first.";
  const cost = lease ? MACH[kind].lease * 2 : price ?? MACH[kind].buy; // lease = 2 weeks deposit
  if (s.cash < cost) return `Need $${fmt(cost)} cash. Borrow on the Money tab.`;
  s.cash -= cost;
  s.machines.push({ id: s.nextId++, kind, cond, leased: lease, down: 1, service: false, hours: 0, age: 0 });
  return "";
}
export function sellMachine(s: State, id: number): string {
  const m = s.machines.find((x) => x.id === id);
  if (!m) return "";
  if (s.machines.length === 1) return "You can't sell your last laser.";
  s.cash += m.leased ? -MACH[m.kind].lease * 2 : resale(m);
  s.machines = s.machines.filter((x) => x !== m);
  return "";
}
export function hire(s: State): string {
  if (s.cash < HIRE_FEE) return "Not enough cash for the hiring fee.";
  s.cash -= HIRE_FEE;
  const used = new Set(s.workers.map((w) => w.name));
  const name = NAMES.find((n) => !used.has(n)) ?? `Op ${s.nextId}`;
  s.workers.push({ id: s.nextId++, name, skill: 0.3 + rand(s) * 0.2, morale: 70, wage: WAGE, weeks: 0 });
  return "";
}
export function fire(s: State, id: number): string {
  const w = s.workers.find((x) => x.id === id);
  if (!w || w.owner) return "";
  const sev = w.intern ? 0 : w.wage * 2;
  s.cash -= sev;
  s.workers = s.workers.filter((x) => x !== w);
  if (!w.intern) for (const o of s.workers) o.morale = clamp(o.morale - 12, 0, 100);
  return "";
}
export function giveRaise(s: State, id: number): string {
  const w = s.workers.find((x) => x.id === id);
  if (!w || w.owner) return "";
  w.wage += 75;
  w.morale = clamp(w.morale + 20, 0, 100);
  return "";
}
export function buyMat(s: State, m: MatId, qty: number): string {
  const room = TIERS[s.tier].storage - storageUsed(s);
  if (qty > room) return room <= 0 ? "Storage is full." : `Only room for ${Math.floor(room)} more sheets.`;
  const cost = matOrderCost(s, m, qty);
  if (s.cash < cost) return "Not enough cash.";
  s.cash -= cost;
  s.inv[m] += qty;
  return "";
}
export const bulkDiscount = (qty: number) => (qty >= 100 ? 0.12 : qty >= 40 ? 0.06 : 0);
export const matOrderCost = (s: State, m: MatId, qty: number) => Math.round(qty * matPrice(s, m) * (1 - bulkDiscount(qty)));

export function buyUpgrade(s: State, u: UpgradeId): string {
  if (s.upg[u]) return "";
  if (s.cash < UPG[u].cost) return "Not enough cash.";
  s.cash -= UPG[u].cost;
  s.upg[u] = true;
  if (u === "extractor") for (const w of s.workers) w.morale = clamp(w.morale + 10, 0, 100);
  return "";
}
export function moveTier(s: State, t: number): string {
  if (t === s.tier) return "";
  if (t < s.tier && s.machines.length > TIERS[t].slots) return "Too many machines for a smaller space.";
  if (t < s.tier && storageUsed(s) > TIERS[t].storage) return "Too much stock for a smaller space.";
  if (s.cash < MOVE_COST) return `Moving costs $${fmt(MOVE_COST)}.`;
  s.cash -= MOVE_COST;
  s.tier = t;
  s.rentMult = 1;
  return "";
}
export function borrow(s: State, amt: number): string {
  if (s.debt + amt > creditLimit(s)) return `The bank caps you at $${fmt(creditLimit(s))}.`;
  s.debt += amt; s.cash += amt;
  return "";
}
export function repay(s: State, amt: number): string {
  amt = Math.min(amt, s.debt);
  if (s.cash < amt) return "Not enough cash.";
  s.debt -= amt; s.cash -= amt;
  return "";
}

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// ---------------------------------------------------------------------------
// The week

export function runWeek(s: State): Report {
  const notes: string[] = [];
  const rivalMoves: string[] = [];
  const startCash = s.cash;
  const st = segRec<SegStats>(() => ({ orders: 0, done: 0, onTime: 0, late: 0, lost: 0, defects: 0, revenue: 0, matCost: 0, minutes: 0, share: 0, missed: 0 }));
  let contractRevenue = 0;
  let rush = 0, power = 0, repairs = 0, penalties = 0;
  const day0 = (s.week - 1) * 5;

  // 1. Tenders close
  for (const c of s.contracts) if (c.status === "open") resolveContract(s, c, notes);

  // 2. Demand rates for the week (customers look at this week's prices and wait times)
  const rate = segRec((k) => {
    if (!s.open[k] || !segPossible(s, k)) return 0;
    return forecast(s, k).units;
  });
  for (const k of SEGS) {
    const sh = shares(s, k, s.open[k] && segPossible(s, k) ? { price: s.price[k], lead: leadDays(s, k) } : null);
    st[k].share = sh.find((x) => x.who === "you")?.share ?? 0;
    s.lastDemand[k] = rate[k];
  }

  // services queued from last week happen on Monday
  for (const m of s.machines) if (m.service) { m.down = Math.max(m.down, 1); }

  const days: DaySnap[] = [];
  const totalStaffMin = staffHours(s) * 60;
  let staffLeft = totalStaffMin;
  let ordersSoFar = 0, doneSoFar = 0;
  let runMinTotal = 0, availMinTotal = 0;

  for (let d = 0; d < 5; d++) {
    const today = day0 + d;
    let note: string | undefined;
    // arrivals
    for (const k of SEGS) {
      const n = poisson(s, rate[k] / 5);
      if (n > 0) {
        s.jobs.push({ seg: k, units: n, day: today, due: today + SEG[k].promise, price: s.price[k] });
        st[k].orders += n; ordersSoFar += n;
      }
    }
    // breakdowns
    for (const m of s.machines) {
      if (m.down > 0) continue;
      const p = 0.003 + Math.pow((100 - m.cond) / 100, 2.5) * 0.3;
      if (m.hours > 0 && rand(s) < p) {
        m.down = 2 + Math.floor(rand(s) * 2);
        m.cond = Math.min(100, m.cond + 25);
        repairs += MACH[m.kind].repair;
        note = `🔥 ${MACH[m.kind].name} broke down! ${m.down} days of repairs.`;
        notes.push(note);
      }
    }
    // production
    let dayStaff = totalStaffMin / 5;
    const running: number[] = [];
    const machines = [...s.machines].sort((a, b) => (b.kind === "fiber" ? 1 : 0) - (a.kind === "fiber" ? 1 : 0) || MACH[b.kind].speed - MACH[a.kind].speed);
    for (const m of machines) {
      if (m.down > 0) {
        if (m.service) { m.cond = 100; m.service = false; repairs += MACH[m.kind].service; }
        m.down--; running.push(0); continue;
      }
      const def = MACH[m.kind];
      const eligible = s.jobs.filter((j) => canMake(s, j.seg, m.kind));
      let mins = Math.min(16 * 60, dayStaff); // real minutes on this machine today
      availMinTotal += 16 * 60;
      if (!eligible.length || mins <= 0) { running.push(0); continue; }
      sortJobs(s, eligible, m.kind);
      const dr = defectRate(s, m.kind);
      let used = 0;
      for (const j of eligible) {
        if (mins - used <= 0.01) break;
        const per = SEG[j.seg].cutMin / def.speed / (1 - dr);
        const can = Math.min(j.units, Math.floor((mins - used) / per + 1e-9));
        if (can <= 0) {
          continue;
        }
        used += can * per;
        j.units -= can;
        const k = j.seg;
        // materials incl. scrap and failed cuts
        const sheets = can * SEG[k].sheets * (1 + scrapRate(s)) / (1 - dr);
        const have = Math.min(s.inv[SEG[k].mat], sheets);
        s.inv[SEG[k].mat] -= have;
        const short = sheets - have;
        const mp = matPrice(s, SEG[k].mat);
        let mc = have * mp;
        if (short > 0) { mc += short * mp * RUSH_MARKUP; rush += short * mp * (RUSH_MARKUP - 1); }
        st[k].matCost += mc;
        st[k].defects += can * dr / (1 - dr);
        st[k].done += can; doneSoFar += can;
        st[k].minutes += can * per;
        const late = today > j.due;
        if (late) st[k].late += can; else st[k].onTime += can;
        let pay = can * j.price;
        if (j.contract) {
          const c = s.contracts.find((x) => x.id === j.contract);
          if (c) { c.delivered += can; if (late) pay *= 0.7; }
          contractRevenue += pay;
        }
        st[k].revenue += pay;
        s.cash += pay - mc;
      }
      s.jobs = s.jobs.filter((j) => j.units > 0);
      const realUsed = Math.min(used, mins);
      dayStaff -= realUsed; staffLeft -= realUsed;
      m.hours += realUsed / 60;
      m.cond = clamp(m.cond - (realUsed / 60) * def.wear * (s.upg.extractor ? 0.75 : 1), 0, 100);
      power += (realUsed / 60) * def.power * elecMult(s);
      runMinTotal += realUsed;
      running.push(realUsed / (16 * 60));
    }
    // cancellations: retail customers give up after twice the promised wait
    for (const j of s.jobs) {
      if (j.contract) continue;
      if (today - j.day >= SEG[j.seg].promise * 2) { st[j.seg].lost += j.units; j.units = 0; }
    }
    s.jobs = s.jobs.filter((j) => j.units > 0);
    days.push({ cash: s.cash, orders: ordersSoFar, done: doneSoFar, running, note });
  }
  s.cash -= power;

  // Contracts due
  for (const c of s.contracts) {
    if (c.status === "won" && c.delivered >= c.qty) { c.status = "done"; notes.push(`✅ Delivered ${c.client} in full.`); }
    else if (c.status === "won" && c.due !== undefined && day0 + 4 >= c.due && c.delivered < c.qty) {
      c.status = "late";
      const pen = round2((c.qty - c.delivered) * c.bid * 0.25);
      penalties += pen;
      s.rep[c.seg] = clamp(s.rep[c.seg] - 10, 0, 100);
      notes.push(`⚠️ Missed the ${c.client} deadline. $${fmt(pen)} penalty, reputation hit. They still get the rest (at 70% pay).`);
    }
  }
  s.contracts = s.contracts.filter((c) => c.status === "won" || c.status === "late" || (c.status !== "open" && c.id >= s.nextId - 40)).slice(-8);
  for (const c of s.contracts) if (c.status === "late" && c.delivered >= c.qty) c.status = "done";

  // 3. Weekly bills
  const costs: { label: string; amount: number }[] = [];
  const add = (label: string, amount: number) => { if (amount > 0.5) costs.push({ label, amount: Math.round(amount) }); };
  const matTotal = SEGS.reduce((a, k) => a + st[k].matCost, 0);
  add("Materials", matTotal - rush);
  add("Rush material fees", rush);
  add("Electricity", power);
  const wages = s.workers.reduce((a, w) => a + w.wage, 0);
  const ot = s.overtime ? s.workers.reduce((a, w) => a + (w.owner || w.intern ? 0 : w.wage * 0.3 * 1.5), 0) : 0;
  add("Wages", wages);
  add("Overtime", ot);
  const rent = TIERS[s.tier].rent * s.rentMult;
  add("Rent", rent);
  const leases = s.machines.filter((m) => m.leased).reduce((a, m) => a + MACH[m.kind].lease, 0);
  add("Machine leases", leases);
  add("Repairs & service", repairs);
  add("Marketing", s.marketing);
  const subs = (Object.keys(UPG) as UpgradeId[]).reduce((a, u) => a + (s.upg[u] ? UPG[u].weekly : 0), 0);
  add("Admin & software", ADMIN + subs);
  add("Your living costs", OWNER_DRAW);
  const hold = invValue(s) * HOLDING;
  add("Storage & insurance", hold);
  const interest = s.debt * interestRate(s);
  add("Loan interest", interest);
  add("Late penalties", penalties);
  s.cash -= wages + ot + rent + leases + repairs + s.marketing + ADMIN + OWNER_DRAW + subs + hold + interest + penalties;

  const revenue = SEGS.reduce((a, k) => a + st[k].revenue, 0);
  const profit = s.cash - startCash;
  const totalCosts = costs.reduce((a, c) => a + c.amount, 0);

  // 4. Reputation, awareness, staff
  for (const k of SEGS) {
    const x = st[k];
    const n = x.done + x.lost;
    if (n > 0) {
      const onTime = x.done ? x.onTime / x.done : 0;
      const quality = clamp(1 - (x.done ? x.defects / x.done : 0) * 4, 0, 1);
      const target = 100 * (0.55 * onTime + 0.45 * quality) - (x.lost / n) * 70;
      s.rep[k] = clamp(s.rep[k] + 0.3 * (target - s.rep[k]), 0, 100);
    } else s.rep[k] += (45 - s.rep[k]) * 0.05;
  }
  const doneAll = SEGS.reduce((a, k) => a + st[k].done, 0);
  s.aw = clamp(s.aw * 0.9 + Math.sqrt(s.marketing) * 0.5 + Math.min(4, doneAll / 120), 0, 100);

  for (const w of s.workers) {
    w.weeks++;
    w.skill = clamp(w.skill + 0.025 * (1 - w.skill), 0, 1);
    if (w.owner) continue;
    w.morale += s.overtime ? -7 : 3;
    w.morale += (70 - w.morale) * 0.05;
    w.morale = clamp(w.morale, 0, 100);
    if (w.intern !== undefined) { w.intern--; if (w.intern <= 0) { notes.push(`🎓 ${w.name}'s internship ended.`); w.morale = -1; } continue; }
    if (w.morale < 35 && rand(s) < 0.25) { notes.push(`🚪 ${w.name} quit. Morale was too low.`); w.morale = -1; }
  }
  s.workers = s.workers.filter((w) => w.morale >= 0);
  for (const m of s.machines) { m.age++; }

  // 5. Rivals
  rivalsWeek(s, rivalMoves);

  // 6. World drift
  for (const m of MATS) {
    s.matIdx[m] = clamp(s.matIdx[m] + 0.2 * (1 - s.matIdx[m]) + randn(s) * 0.045, 0.7, 1.8);
    s.matHist[m].push(round2(s.matIdx[m] * modMult(s, "mat", undefined, m)));
    if (s.matHist[m].length > 20) s.matHist[m].shift();
  }
  for (const k of SEGS) s.trend[k] = clamp(s.trend[k] + 0.15 * (1 - s.trend[k]) + randn(s) * 0.03, 0.7, 1.4);
  for (const x of s.mods) x.weeks--;
  s.mods = s.mods.filter((x) => x.weeks > 0);

  // Insights
  insights(s, st, notes);

  // 7. Money trouble
  if (s.cash < 0) {
    const need = Math.ceil(-s.cash / 500) * 500;
    if (s.debt + need <= creditLimit(s)) {
      s.debt += need; s.cash += need;
      notes.unshift(`🏦 Cash went negative, so the bank auto-lent you $${fmt(need)}.`);
    } else {
      s.over = "bankrupt";
    }
  }

  const rep: Report = {
    week: s.week, revenue, contractRevenue, costs, profit: Math.round(revenue - totalCosts), seg: st, days, notes, rivalMoves,
    util: availMinTotal ? runMinTotal / Math.max(1, Math.min(availMinTotal, totalStaffMin)) : 0,
  };
  s.last = rep;
  s.priceHist.push({ week: s.week, you: { ...s.price }, rivals: Object.fromEntries(s.rivals.map((r) => [r.name, { ...r.price }])) });
  if (s.priceHist.length > 16) s.priceHist.shift();
  s.week++;
  const worth = netWorth(s);
  s.hist.push({ week: rep.week, cash: Math.round(s.cash), worth, profit: rep.profit, revenue: Math.round(revenue) });
  s.best = Math.max(s.best, worth);
  if (!s.over && s.week > WEEKS) s.over = "done";

  // 8. Next week's world
  if (!s.over) {
    if (s.week % 3 === 0 || (s.week > 4 && rand(s) < 0.15)) {
      const pool = SEGS.filter((k) => k !== "models" || s.week > 8);
      s.contracts.push(makeContract(s, pick(s, pool)));
    }
    s.event = rollEvent(s);
  }
  return rep;
}

function sortJobs(s: State, jobs: Job[], kind: MachineKind) {
  if (s.priority === "fifo") jobs.sort((a, b) => a.day - b.day);
  else if (s.priority === "due") jobs.sort((a, b) => a.due - b.due);
  else {
    const v = (j: Job) => (j.price - unitVarCost(s, j.seg)) / (SEG[j.seg].cutMin / MACH[kind].speed);
    jobs.sort((a, b) => (b.contract ? 1 : 0) - (a.contract ? 1 : 0) || v(b) - v(a));
  }
}

// ---------------------------------------------------------------------------

function rivalsWeek(s: State, moves: string[]) {
  const live = s.rivals.filter((r) => !r.bust);
  // sales this week
  for (const r of live) {
    let minutes = r.hot, revenue = 0, mat = 0;
    r.hot = 0;
    const want = segRec(() => 0);
    for (const k of SEGS) {
      if (!r.on[k]) continue;
      const sh = shares(s, k, s.open[k] && segPossible(s, k) ? { price: s.price[k], lead: leadDays(s, k) } : null);
      want[k] = sh.find((x) => x.who === r.name)?.units ?? 0;
      minutes += want[k] * SEG[k].cutMin;
    }
    const cap = r.cap + r.fiberCap;
    const fill = minutes > 0 ? Math.min(1, cap / minutes) : 1;
    r.util = cap > 0 ? Math.min(1.5, minutes / cap) : 0;
    for (const k of SEGS) {
      const u = want[k] * fill;
      r.units[k] = u;
      revenue += u * r.price[k];
      mat += u * SEG[k].sheets * matPrice(s, SEG[k].mat) * 1.12;
      const load = r.util;
      r.lead[k] = round2(SEG[k].promise * (load < 0.85 ? 0.45 : 0.45 + (load - 0.85) * 4));
      const base = r.persona === "premium" ? 70 : r.persona === "cutter" ? 42 : 52;
      r.rep[k] = clamp(r.rep[k] + 0.15 * (base - (load > 1 ? (load - 1) * 60 : 0) - r.rep[k]), 0, 100);
    }
    const used = Math.min(minutes, cap);
    r.profit = revenue - mat - used * r.costMin - r.fixed;
    r.cash += r.profit;
  }

  // pricing for next week
  const you = (k: SegId) => (s.open[k] && segPossible(s, k) ? s.price[k] : null);
  for (const r of live) {
    for (const k of SEGS) {
      if (!r.on[k]) continue;
      const d = SEG[k];
      const unit = d.sheets * matPrice(s, d.mat) * 1.12 + d.cutMin * r.costMin;
      const old = r.price[k];
      let p = old;
      const others = [you(k), ...live.filter((o) => o !== r && o.on[k]).map((o) => o.price[k])].filter((x): x is number => x !== null);
      const low = others.length ? Math.min(...others) : refPrice(s, k);
      if (r.persona === "cutter") {
        let target = low * 0.93;
        let floor = unit * 1.1;
        if (r.cash < 3000) floor = unit * 1.3; // desperate: needs margin
        if (r.util > 1) target = old * 1.06;
        p = Math.max(floor, 0.5 * old + 0.5 * target);
      } else if (r.persona === "premium") {
        const f = r.util > 0.95 ? 1.05 : r.util < 0.55 ? 0.97 : 1;
        p = clamp(old * f, refPrice(s, k) * 1.1, refPrice(s, k) * 1.65);
      } else {
        // copycat: tit-for-tat on the player's price
        const y = you(k);
        const target = y ?? refPrice(s, k) * 1.05;
        p = Math.max(unit * 1.05, 0.35 * old + 0.65 * target * (r.util > 1 ? 1.05 : 1));
      }
      p = round2(p);
      r.price[k] = p;
      const ch = (p - old) / old;
      if (Math.abs(ch) >= 0.04) moves.push(`${r.name} ${ch < 0 ? "cut" : "raised"} ${d.name.toLowerCase()} to $${p.toFixed(2)} (${ch > 0 ? "+" : ""}${Math.round(ch * 100)}%).`);
    }
    // strategy: enter markets, grow, go bust
    if (r.persona === "copycat" && s.week >= 6) {
      for (const k of SEGS) {
        if (r.on[k] || !s.open[k] || !s.last) continue;
        const yr = s.last.seg[k].revenue;
        if (yr > 2200 && (!SEG[k].fiber || r.fiberCap > 0) && (SEG[k].minPrecision < 0.8) && rand(s) < 0.5) {
          r.on[k] = true; r.price[k] = round2(s.price[k] * 0.97);
          moves.push(`👀 ${r.name} saw your ${SEG[k].name.toLowerCase()} sales and started selling them too.`);
        }
      }
    }
    if (r.persona === "cutter" && r.cash > 70000 && r.fiberCap === 0 && s.week > 14) {
      r.fiberCap = 2400; r.cash -= 45000; r.on.parts = true; r.price.parts = round2(refPrice(s, "parts") * 0.9);
      moves.push(`⚙️ ${r.name} bought a fiber laser. They're coming for machine parts.`);
    }
    if (r.util > 1.05 && r.cash > 30000 && rand(s) < 0.3) {
      r.cap += 1500; r.fixed += 500; r.cash -= 15000;
      moves.push(`📈 ${r.name} added another laser. More capacity, more pressure to fill it.`);
    }
    if (s.week > 8 && r.util < 0.4 && r.cap > 3000 && rand(s) < 0.2) {
      r.cap -= 1000; r.fixed -= 300; r.cash += 6000;
      moves.push(`📉 ${r.name} sold a laser. Business is slow for them.`);
    }
    if (r.cash < -6000) {
      r.bust = true;
      moves.push(`💀 ${r.name} went out of business! Their customers are up for grabs.`);
    }
    if (r.cash < 2000 && !r.bust) r.known = true;
  }
  // Fat margins attract new shops (and a bust leaves a gap someone fills)
  const recent = s.hist.slice(-4);
  const avgProfit = recent.length ? recent.reduce((a, h) => a + h.profit, 0) / recent.length : 0;
  const busts = s.rivals.filter((r) => r.bust).length;
  const chance = (avgProfit > 5000 ? Math.min(0.25, avgProfit / 60000) : 0) + (busts > 0 ? 0.08 : 0);
  const live2 = s.rivals.filter((r) => !r.bust).length;
  if (live2 < 4 && s.rivals.length < 6 && s.week > 8 && rand(s) < chance) {
    const n = s.rivals.length;
    const names = ["Kerf & Co", "Beam Factory", "Lumo Cut", "Northcut"];
    const colors = ["#ffd54f", "#81c784", "#ff8a65", "#90caf9"];
    const persona: Persona = pick(s, ["cutter", "copycat", "premium"]);
    // go where the player makes the most money
    const best = s.last ? [...SEGS].sort((a, b) => s.last!.seg[b].revenue - s.last!.seg[a].revenue).slice(0, 3) : ["stands", "signs", "decor"] as SegId[];
    const r = mkRival(10 + n, names[(n - 3) % 4], persona, colors[(n - 3) % 4], 40000, 30, persona === "premium" ? 62 : 50, best, 6000, 0.2, 1600);
    if (best.includes("parts")) r.fiberCap = 2500;
    r.price = segRec((x) => round2(refPrice(s, x) * (persona === "cutter" ? 0.92 : persona === "premium" ? 1.25 : 1)));
    s.rivals.push(r);
    moves.push(`🆕 ${r.name} opened across town, going after ${best.map((k) => SEG[k].name.toLowerCase()).join(", ")}. Big margins attract competition.`);
  }
}

function insights(s: State, st: Record<SegId, SegStats>, notes: string[]) {
  for (const k of SEGS) {
    const x = st[k];
    if (x.lost > 0) notes.push(`⌛ ${x.lost} ${SEG[k].name.toLowerCase()} orders walked away after waiting too long. That's lost sales and reputation.`);
  }
  for (const m of s.machines) if (m.cond < 45) notes.push(`🛠️ ${MACH[m.kind].name} is at ${Math.round(m.cond)}% condition. Breakdowns get much likelier below 50%.`);
  const unhappy = s.workers.filter((w) => !w.owner && w.morale < 45);
  if (unhappy.length) notes.push(`😟 ${unhappy.map((w) => w.name).join(", ")} ${unhappy.length > 1 ? "are" : "is"} unhappy. Overtime and layoffs hurt morale.`);
  // best and worst margin per laser hour
  const open = SEGS.filter((k) => st[k].done > 0);
  if (open.length >= 2) {
    const perHr = (k: SegId) => (st[k].revenue - st[k].matCost) / Math.max(1, st[k].minutes / 60);
    open.sort((a, b) => perHr(b) - perHr(a));
    const a = open[0], b = open[open.length - 1];
    if (perHr(a) > perHr(b) * 1.3) notes.push(`💡 Each laser hour earned $${fmt(perHr(a))} on ${SEG[a].name.toLowerCase()} vs $${fmt(perHr(b))} on ${SEG[b].name.toLowerCase()}.`);
  }
  for (const k of SEGS) {
    if (!s.open[k]) continue;
    const cheapest = s.rivals.filter((r) => !r.bust && r.on[k]).sort((a, b) => a.price[k] - b.price[k])[0];
    if (cheapest && st[k].share < 0.06 && s.price[k] > cheapest.price[k] * 1.15) notes.push(`📉 Your ${SEG[k].name.toLowerCase()} are ${Math.round((s.price[k] / cheapest.price[k] - 1) * 100)}% pricier than ${cheapest.name}. Only ${Math.round(st[k].share * 100)}% of buyers picked you.`);
  }
}

// ---------------------------------------------------------------------------
// Events: decisions with consequences

const EV = {
  viral: () => ({ id: "viral", title: "A stand goes viral", text: "A creator's video of a laser-cut phone stand hit 4M views. Demand for stands will double for 3 weeks across town.", choices: [
    { label: "Ride the wave", hint: "Free. Everyone shares the boom.", fx: "viral" },
    { label: "Run ads on it ($600)", hint: "+20 awareness right now.", fx: "viral_ads" },
  ] }),
  acrShortage: () => ({ id: "acrShortage", title: "Acrylic shortage", text: "A resin plant fire upstream. Suppliers warn acrylic prices will jump ~60% next week for about a month.", choices: [
    { label: "Stock up 30 sheets now", hint: "Pay today's price. Uses storage.", fx: "acr_stock" },
    { label: "Wait it out", hint: "Keep cash. Pay more later.", fx: "acr_wait" },
  ] }),
  raise: (w: Worker) => ({ id: "raise", title: `${w.name} asks for a raise`, text: `${w.name} says other shops pay $100/week more. ${w.name} is ${Math.round(w.skill * 100)}% skilled.`, data: w.id, choices: [
    { label: "Give +$100/week", hint: "Morale jumps. Fixed cost rises.", fx: "raise_yes" },
    { label: "Decline", hint: "Saves money. Morale drops.", fx: "raise_no" },
  ] }),
  refund: () => ({ id: "refund", title: "Scorched edges", text: "A café says their $480 sign order has burn marks and wants a full refund. They have 12k followers.", choices: [
    { label: "Refund $480", hint: "Customers notice. +rep for signs.", fx: "refund_yes" },
    { label: "Refuse", hint: "Keep the cash. They'll post a review.", fx: "refund_no" },
  ] }),
  rent: () => ({ id: "rent", title: "Landlord letter", text: "Your landlord is raising rent 12% from next week. You can lock in today's rent for the rest of the year by paying $1,000 now.", choices: [
    { label: "Lock it in ($1,000)", hint: "Rent stays flat.", fx: "rent_lock" },
    { label: "Accept the increase", hint: "+12% rent every week.", fx: "rent_up" },
  ] }),
  usedPro: () => ({ id: "usedPro", title: "Closing-down sale", text: "A shop across town is closing and selling its Pro CO₂ 100W at 55% condition for $11,000 (new: $26,000).", choices: [
    { label: "Buy it ($11,000)", hint: "Needs a free machine slot.", fx: "used_buy" },
    { label: "Pass", hint: "Someone else will get it.", fx: "none" },
  ] }),
  bigbox: () => ({ id: "bigbox", title: "Big-box imports", text: "A chain store now sells imported phone stands for $9. What customers consider a 'fair price' for stands just dropped 15%, for good.", choices: [
    { label: "Noted", hint: "Rethink your stand pricing.", fx: "bigbox" },
  ] }),
  power: () => ({ id: "power", title: "Power price spike", text: "A heatwave pushed electricity prices up 80% for the next 4 weeks. Fiber lasers feel it most.", choices: [
    { label: "Noted", hint: "Variable costs are up.", fx: "power" },
  ] }),
  plyDeal: () => ({ id: "plyDeal", title: "Supplier overstock", text: "Your plywood supplier offers 60 sheets at 30% off. You'd need the storage room.", choices: [
    { label: "Take the deal", hint: "Cheap plywood for weeks.", fx: "ply_deal" },
    { label: "Pass", hint: "", fx: "none" },
  ] }),
  expo: () => ({ id: "expo", title: "Maker Expo booth", text: "A booth at this weekend's Maker Expo costs $1,500. Thousands of event planners and shop owners attend.", choices: [
    { label: "Book the booth ($1,500)", hint: "+25 awareness. Signs and decor demand +30% for 2 weeks.", fx: "expo" },
    { label: "Skip it", hint: "", fx: "none" },
  ] }),
  intern: () => ({ id: "intern", title: "Free intern?", text: "A design student wants a 4-week internship. Unpaid, 20 hours a week, a little clumsy.", choices: [
    { label: "Take them on", hint: "+20 staff hours/week for 4 weeks.", fx: "intern" },
    { label: "No thanks", hint: "", fx: "none" },
  ] }),
  inspect: () => ({ id: "inspect", title: "Fire inspection", text: "An inspector flagged laser fumes. Install a fume extractor ($1,800) or pay a $1,200 fine.", choices: [
    { label: "Install extractor", hint: "Better long-term: slower wear, happier staff.", fx: "inspect_fix" },
    { label: "Pay the fine", hint: "Cheaper today.", fx: "inspect_fine" },
  ] }),
  poach: (w: Worker, r: Rival) => ({ id: "poach", title: "Poaching attempt", text: `${r.name} offered ${w.name} a job at $150/week more.`, data: w.id, choices: [
    { label: "Counter-offer +$150/week", hint: `${w.name} stays.`, fx: "poach_keep" },
    { label: "Let them go", hint: `Lose ${w.name}'s skill.`, fx: "poach_go" },
  ] }),
  slowdown: () => ({ id: "slowdown", title: "Economic slowdown", text: "Businesses are tightening budgets. Sign and machine-part demand will be down 25% for 6 weeks.", choices: [
    { label: "Noted", hint: "", fx: "slowdown" },
  ] }),
  auction: (r: Rival) => ({ id: "auction", title: `${r.name} liquidation`, text: `The bank is auctioning ${r.name}'s Pro CO₂ 100W (70% condition). Opening price $9,500.`, choices: [
    { label: "Buy it ($9,500)", hint: "Needs a free machine slot.", fx: "auction_buy" },
    { label: "Pass", hint: "", fx: "none" },
  ] }),
} satisfies Record<string, (...a: any[]) => GameEvent>;

function rollEvent(s: State): GameEvent | null {
  const justBust = s.rivals.find((r) => r.bust && !r.known);
  if (justBust) { justBust.known = true; return EV.auction(justBust); }
  if (s.week < 3 || rand(s) > 0.3) return null;
  const staff = s.workers.filter((w) => !w.owner && !w.intern);
  const opts: (() => GameEvent)[] = [EV.viral, EV.acrShortage, EV.refund, EV.power, EV.plyDeal, EV.expo, EV.intern, EV.slowdown];
  if (staff.length) opts.push(() => EV.raise(pick(s, staff)));
  if (staff.some((w) => w.skill > 0.5)) {
    const live = s.rivals.filter((r) => !r.bust);
    if (live.length) opts.push(() => EV.poach(staff.sort((a, b) => b.skill - a.skill)[0], pick(s, live)));
  }
  if (s.rentMult === 1) opts.push(EV.rent);
  if (!s.machines.some((m) => m.kind === "pro")) opts.push(EV.usedPro);
  if (s.refMult.stands === 1 && s.week > 10) opts.push(EV.bigbox);
  if (!s.upg.extractor) opts.push(EV.inspect);
  return pick(s, opts)();
}

export function applyChoice(s: State, fx: string): string {
  const ev = s.event;
  s.event = null;
  switch (fx) {
    case "viral": s.mods.push({ kind: "demand", seg: "stands", mult: 2, weeks: 3, label: "Viral stands" }); break;
    case "viral_ads": s.mods.push({ kind: "demand", seg: "stands", mult: 2, weeks: 3, label: "Viral stands" }); s.cash -= 600; s.aw = clamp(s.aw + 20, 0, 100); break;
    case "acr_stock": { const e = buyMat(s, "acr", 30); s.mods.push({ kind: "mat", mat: "acr", mult: 1.6, weeks: 4, label: "Acrylic shortage" }); if (e) return e; break; }
    case "acr_wait": s.mods.push({ kind: "mat", mat: "acr", mult: 1.6, weeks: 4, label: "Acrylic shortage" }); break;
    case "raise_yes": { const w = s.workers.find((x) => x.id === ev?.data); if (w) { w.wage += 100; w.morale = clamp(w.morale + 25, 0, 100); } break; }
    case "raise_no": { const w = s.workers.find((x) => x.id === ev?.data); if (w) w.morale = clamp(w.morale - 25, 0, 100); break; }
    case "refund_yes": s.cash -= 480; s.rep.signs = clamp(s.rep.signs + 3, 0, 100); s.aw = clamp(s.aw + 3, 0, 100); break;
    case "refund_no": s.rep.signs = clamp(s.rep.signs - 9, 0, 100); s.rep.decor = clamp(s.rep.decor - 3, 0, 100); break;
    case "rent_lock": s.cash -= 1000; s.rentMult = 0.999; break;
    case "rent_up": s.rentMult = 1.12; break;
    case "used_buy": { const e = buyMachine(s, "pro", false, 11000, 55); if (e) return e; break; }
    case "auction_buy": { const e = buyMachine(s, "pro", false, 9500, 70); if (e) return e; break; }
    case "bigbox": s.refMult.stands = 0.85; break;
    case "power": s.mods.push({ kind: "elec", mult: 1.8, weeks: 4, label: "Power price spike" }); break;
    case "ply_deal": {
      const room = TIERS[s.tier].storage - storageUsed(s);
      const q = Math.min(60, Math.floor(room));
      const cost = Math.round(q * matPrice(s, "ply") * 0.7);
      if (q <= 0) return "No storage room.";
      if (s.cash < cost) return "Not enough cash.";
      s.cash -= cost; s.inv.ply += q; break;
    }
    case "expo": s.cash -= 1500; s.aw = clamp(s.aw + 25, 0, 100); s.mods.push({ kind: "demand", seg: "signs", mult: 1.3, weeks: 2, label: "Expo buzz" }, { kind: "demand", seg: "decor", mult: 1.3, weeks: 2, label: "Expo buzz" }); break;
    case "intern": s.workers.push({ id: s.nextId++, name: "Intern", skill: 0.2, morale: 90, wage: 0, weeks: 1, intern: 4 }); break;
    case "inspect_fix": if (!s.upg.extractor) { s.cash -= UPG.extractor.cost; s.upg.extractor = true; } break;
    case "inspect_fine": s.cash -= 1200; break;
    case "poach_keep": { const w = s.workers.find((x) => x.id === ev?.data); if (w) { w.wage += 150; w.morale = clamp(w.morale + 15, 0, 100); } break; }
    case "poach_go": s.workers = s.workers.filter((x) => x.id !== ev?.data); break;
    case "slowdown": s.mods.push({ kind: "demand", seg: "signs", mult: 0.75, weeks: 6, label: "Slowdown" }, { kind: "demand", seg: "parts", mult: 0.75, weeks: 6, label: "Slowdown" }); break;
  }
  return "";
}

/** Final grade for the year. */
export function grade(worth: number): { letter: string; title: string } {
  if (worth >= 400000) return { letter: "S", title: "Laser tycoon" };
  if (worth >= 200000) return { letter: "A", title: "Town's top shop" };
  if (worth >= 100000) return { letter: "B", title: "Thriving business" };
  if (worth >= 50000) return { letter: "C", title: "Paying the bills" };
  if (worth >= 15000) return { letter: "D", title: "Hanging on" };
  return { letter: "F", title: "Back to the garage" };
}
