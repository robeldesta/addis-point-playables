// The business layer: a week running the city's power company.
// Each day you set a price, buy upgrades, then survive a shift full of incidents.
// A rival utility competes for your districts and reacts to your price.
// Pure TS, no Phaser.

import { newCity, rand, servedPct, type Incident, type State } from "./grid";

export const DAYS = 7;
export const START = 17 * 60; // shifts start at 17:00, right before the evening peak
export const END = 23 * 60;
export const FIXED_COST = 80_000; // staff, maintenance, loan payments per day
export const RIVAL_FLOOR = 95; // rival can't price below its own costs
export const TARIFF_MIN = 80, TARIFF_MAX = 200;
export const BANKRUPT = -300_000;

export type UpgradeId = "reinforce" | "storm" | "gas2" | "battery" | "crew";
export interface UpgradeDef { id: UpgradeId; name: string; cost: number; upkeep: number; once: boolean; text: string }
export const UPGRADES: UpgradeDef[] = [
  { id: "reinforce", name: "Reinforce a line", cost: 60_000, upkeep: 0, once: false, text: "+40 MW on yesterday's busiest line" },
  { id: "storm", name: "Storm-proof a line", cost: 35_000, upkeep: 0, once: false, text: "Lightning can't trip tomorrow's storm target" },
  { id: "gas2", name: "Second gas turbine", cost: 150_000, upkeep: 6_000, once: true, text: "+80 MW at the gas plant (fuel still costs)" },
  { id: "battery", name: "Bigger battery", cost: 90_000, upkeep: 2_000, once: true, text: "+40 MW, +160 MWh of storage" },
  { id: "crew", name: "Second repair crew", cost: 40_000, upkeep: 3_000, once: true, text: "Repairs take 15 min instead of 30" },
];

export interface DayReport {
  day: number; rev: number; fuel: number; hydro: number; fines: number; fixed: number; profit: number;
  served: number; stars: number; news: string[]; rivalTariff: number; tariff: number;
}

export interface Plan { stormTarget: string | null; stormAt: number; water: number; fuelPrice: number; incidents: Incident[] }

export interface Campaign {
  v: 2;
  seed: number;
  day: number; // 1-based day about to be played (or being played)
  cash: number;
  tariff: number;
  rival: { tariff: number; last: number };
  lost: string[]; // districts that buy from the rival
  reinforced: Record<string, number>; // line id -> extra MW
  hardened: string[];
  owned: UpgradeId[];
  history: DayReport[];
  plan: Plan; // today's forecast, rolled the evening before so you can prepare
  busiest: string; // yesterday's busiest line (target for "reinforce")
  over: boolean;
  bankrupt: boolean;
}

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const rng = (seed: number) => { const st = { seed } as unknown as State; return () => rand(st); };

/** Lines that a storm can realistically hit (long overhead lines). */
const EXPOSED = ["L1", "L2", "L3", "L5", "L8", "L10", "L13", "L14"];
const SPIKES: { id: string; text: string }[] = [
  { id: "market", text: "Football final on big screens at Big Market" },
  { id: "centre", text: "Night concert in the Old Centre" },
  { id: "air", text: "Airport opens its new terminal" },
  { id: "east", text: "Wedding season in East Ring" },
  { id: "hill", text: "Hilltop holiday lights switched on" },
];

export function newCampaign(seed = (Date.now() ^ 0x5bd1e995) | 0): Campaign {
  const c: Campaign = {
    v: 2, seed, day: 1, cash: 150_000, tariff: 120, rival: { tariff: 120, last: 120 }, lost: [], reinforced: {}, hardened: [], owned: [],
    history: [], plan: null as unknown as Plan, busiest: "L2", over: false, bankrupt: false,
  };
  c.plan = rollPlan(c);
  return c;
}

/** Today's incidents. Day 1 is a teaching day; later days get busier. */
export function rollPlan(c: Campaign): Plan {
  const r = rng(c.seed * 31 + c.day * 7919);
  if (c.day === 1) {
    return {
      stormTarget: "L1", stormAt: START + 20, water: 1500, fuelPrice: 110,
      incidents: [
        { at: 19 * 60 + 10, dur: 50, done: 0, kind: "spike", target: "market", mult: 1.5, text: "Football final on big screens at Big Market: demand jumps." },
      ],
    };
  }
  const n = Math.min(4, 1 + Math.ceil(c.day / 2));
  const incidents: Incident[] = [];
  const kinds: Incident["kind"][] = ["spike", "heat", "fuel", "fault", "spike"];
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const kind = pick(r, kinds);
    const at = START + 30 + Math.floor(r() * 280);
    if (kind === "spike") {
      const sp = pick(r, SPIKES.filter((x) => !used.has(x.id) && !c.lost.includes(x.id)));
      if (!sp) continue;
      used.add(sp.id);
      incidents.push({ at, dur: 40 + Math.floor(r() * 40), done: 0, kind, target: sp.id, mult: 1.4 + r() * 0.3, text: `${sp.text}: demand jumps.` });
    } else if (kind === "heat" && !used.has("heat")) {
      used.add("heat");
      incidents.push({ at: START + 40 + Math.floor(r() * 60), dur: 150, done: 0, kind, mult: 1.2, text: "Heatwave: fans and fridges on full, and hot lines carry 10% less." });
    } else if (kind === "fuel" && !used.has("fuel")) {
      used.add("fuel");
      incidents.push({ at, dur: 999, done: 0, kind, mult: 1.8, text: "Gas price shock: fuel now costs 80% more." });
    } else if (kind === "fault") {
      const l = pick(r, ["L5", "L6", "L8", "L9", "L11", "L13"]);
      incidents.push({ at, dur: 0, done: 0, kind, target: l, text: "Old equipment failed." });
    }
  }
  incidents.sort((a, b) => a.at - b.at);
  const storm = r() < 0.75;
  const dry = r() < 0.35 + c.day * 0.05;
  return {
    stormTarget: storm ? pick(r, EXPOSED) : null,
    stormAt: START + 15 + Math.floor(r() * 200),
    water: dry ? 950 + Math.floor(r() * 150) : 1250 + Math.floor(r() * 250),
    fuelPrice: 95 + Math.floor(r() * 40),
    incidents,
  };
}

/** Build the grid state for today's shift. */
export function startDay(c: Campaign): State {
  const p = c.plan;
  return newCity(c.seed + c.day * 101, (s) => {
    s.start = START; s.end = END;
    s.storm = p.stormTarget ? { start: p.stormAt, end: p.stormAt + 45, target: p.stormTarget, hit: false, chance: 1 } : null;
    s.incidents = JSON.parse(JSON.stringify(p.incidents));
    s.econ.tariff = c.tariff;
    s.econ.fuelPrice = p.fuelPrice;
    s.econ.water = s.econ.waterMax = p.water;
    s.repairMin = c.owned.includes("crew") ? 15 : 30;
    for (const l of s.lines) { l.rating += c.reinforced[l.id] ?? 0; l.hardened = c.hardened.includes(l.id); }
    for (const n of s.nodes) {
      if (n.kind === "district" && c.lost.includes(n.id)) { n.lost = true; n.served = true; }
      if (n.kind === "gas" && c.owned.includes("gas2")) n.cap += 80;
      if (n.kind === "battery" && c.owned.includes("battery")) { n.cap += 40; n.ramp += 40; n.socMax += 160; n.soc += 120; }
    }
  });
}

export const upkeep = (c: Campaign) => UPGRADES.filter((u) => c.owned.includes(u.id)).reduce((a, u) => a + u.upkeep, 0);

export function stars(s: State): boolean[] {
  const hospDark = s.events.some((e) => e.kind === "shed" && e.node === "hosp");
  return [servedPct(s) >= 0.99, !hospDark && s.stats.worstChain <= 3, s.stats.minF >= 49.2];
}

/**
 * Close the books, then customers and the rival react.
 * Customers compare price and how often their lights went out today.
 */
export function endDay(c: Campaign, s: State): DayReport {
  const e = s.econ;
  const fixed = FIXED_COST + upkeep(c);
  const profit = Math.round(e.rev - e.fuel - e.hydro - e.fines - fixed);
  const news: string[] = [];
  const r = rng(c.seed * 17 + c.day * 104729);

  // Customers: utility in "dollars". 10% of the evening in the dark ≈ $40/MWh of annoyance.
  // Each district has its own switching hassle; at most one moves each way per day.
  const LOYAL: Record<string, number> = { homes: 6, commerce: 10, market: 5, flat: 14 };
  type Mover = { n: (typeof s.nodes)[number]; m: number; rel: number };
  let leaver = null as Mover | null;
  let returner = null as Mover | null;
  for (const n of s.nodes) {
    if (n.kind !== "district" || n.critical) continue; // the hospital is regulated, it stays
    const rel = n.minutes ? n.litMin / n.minutes : 1;
    const you = -c.tariff - 400 * (1 - rel);
    const them = -c.rival.tariff - 400 * 0.02;
    const hassle = LOYAL[n.profile] ?? 12;
    if (!c.lost.includes(n.id)) { const m = them - you - hassle; if (m > 0 && (!leaver || m > leaver.m)) leaver = { n, m, rel }; }
    else { const m = you - them - hassle; if (m > 0 && (!returner || m > returner.m)) returner = { n, m, rel }; }
  }
  if (leaver && r() < 0.8) {
    c.lost.push(leaver.n.id);
    news.push(leaver.rel < 0.97 ? `${leaver.n.name} switched to Volt Co after ${Math.round((1 - leaver.rel) * 100)}% of the evening in the dark.` : `${leaver.n.name} switched to Volt Co: their $${c.rival.tariff} beats your $${c.tariff}.`);
  }
  if (returner && r() < 0.7) {
    const back = returner.n.id;
    c.lost = c.lost.filter((x) => x !== back);
    news.push(`${returner.n.name} came back to you from Volt Co.`);
  }

  // The rival matches undercuts (price war), often follows you up (a quiet truce),
  // but grabs customers when you get greedy or when it's hungry.
  const prev = c.rival.tariff;
  let next = prev;
  if (c.tariff <= prev - 5) next = Math.max(RIVAL_FLOOR, c.tariff - 5);
  else if (c.tariff > 165) next = Math.max(RIVAL_FLOOR, 150 - Math.floor(r() * 3) * 5);
  else if (c.tariff >= prev + 10) next = r() < 0.7 ? c.tariff - 10 : prev;
  else if (r() < 0.25) next = Math.max(RIVAL_FLOOR, prev - 15); // hungry for customers
  next = Math.max(RIVAL_FLOOR, Math.min(190, Math.round(next / 5) * 5));
  if (next < prev) news.push(`Volt Co cut its price to $${next}/MWh.`);
  else if (next > prev) news.push(`Volt Co raised its price to $${next}/MWh.`);
  c.rival = { tariff: next, last: prev };

  const st = stars(s);
  const rep: DayReport = {
    day: c.day, rev: Math.round(e.rev), fuel: Math.round(e.fuel), hydro: Math.round(e.hydro), fines: Math.round(e.fines), fixed, profit,
    served: servedPct(s), stars: st.filter(Boolean).length, news, rivalTariff: prev, tariff: c.tariff,
  };
  c.history.push(rep);
  c.cash += profit;
  let busiest = s.lines[0];
  for (const l of s.lines) if (l.peak > busiest.peak) busiest = l;
  c.busiest = busiest.id;
  if (c.cash < BANKRUPT) { c.over = true; c.bankrupt = true; }
  c.day++;
  if (c.day > DAYS) c.over = true;
  if (!c.over) c.plan = rollPlan(c);
  return rep;
}

export function canBuy(c: Campaign, id: UpgradeId): boolean {
  const u = UPGRADES.find((x) => x.id === id)!;
  if (u.once && c.owned.includes(id)) return false;
  if (id === "storm" && (!c.plan.stormTarget || c.hardened.includes(c.plan.stormTarget))) return false;
  return c.cash >= u.cost;
}

export function buy(c: Campaign, id: UpgradeId): boolean {
  if (!canBuy(c, id)) return false;
  const u = UPGRADES.find((x) => x.id === id)!;
  c.cash -= u.cost;
  if (id === "reinforce") c.reinforced[c.busiest] = (c.reinforced[c.busiest] ?? 0) + 40;
  else if (id === "storm") c.hardened.push(c.plan.stormTarget!);
  else c.owned.push(id);
  return true;
}

export const score = (c: Campaign) => Math.max(0, Math.round(c.cash));
