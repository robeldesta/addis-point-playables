// Pure game rules for Market Garden. No Phaser here, so it is easy to test.

export interface Crop {
  id: string;
  name: string;
  seed: number; // cost to plant
  sell: number; // base sale price
  grow: number; // seconds to ripen
  unlock: number; // coins to unlock (0 = free)
  color: number;
  leaf: number;
}

export const CROPS: Crop[] = [
  { id: "wheat", name: "Wheat", seed: 1, sell: 3, grow: 5, unlock: 0, color: 0xe8c547, leaf: 0x9bb83a },
  { id: "carrot", name: "Carrot", seed: 4, sell: 10, grow: 12, unlock: 60, color: 0xf08a24, leaf: 0x4caf50 },
  { id: "tomato", name: "Tomato", seed: 10, sell: 26, grow: 25, unlock: 300, color: 0xe53935, leaf: 0x388e3c },
  { id: "corn", name: "Corn", seed: 25, sell: 65, grow: 45, unlock: 1200, color: 0xffd54f, leaf: 0x7cb342 },
  { id: "pumpkin", name: "Pumpkin", seed: 60, sell: 160, grow: 80, unlock: 5000, color: 0xff7f11, leaf: 0x558b2f },
  { id: "berry", name: "Strawberry", seed: 150, sell: 420, grow: 140, unlock: 20000, color: 0xd81b60, leaf: 0x2e7d32 },
  { id: "coffee", name: "Coffee", seed: 400, sell: 1150, grow: 240, unlock: 80000, color: 0x8d2b1f, leaf: 0x1b5e20 },
];

export const cropById = (id: string): Crop => CROPS.find((c) => c.id === id)!;

export const MAX_PLOTS = 12;
export const START_PLOTS = 3;

export type UpgradeId = "plot" | "growth" | "price";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  describe: (lvl: number) => string;
  max: number;
  cost: (lvl: number) => number;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: "plot",
    name: "New plot",
    describe: (l) => `${START_PLOTS + l} of ${MAX_PLOTS} plots`,
    max: MAX_PLOTS - START_PLOTS,
    cost: (l) => Math.round(25 * Math.pow(2.3, l)),
  },
  {
    id: "growth",
    name: "Fertilizer",
    describe: (l) => `Crops grow ${Math.round((1 - growthMult(l)) * 100)}% faster`,
    max: 10,
    cost: (l) => Math.round(50 * Math.pow(2.1, l)),
  },
  {
    id: "price",
    name: "Market stall",
    describe: (l) => `Sell for +${Math.round((priceMult(l) - 1) * 100)}%`,
    max: 15,
    cost: (l) => Math.round(80 * Math.pow(2.0, l)),
  },
];

export const growthMult = (lvl: number) => Math.pow(0.88, lvl);
export const priceMult = (lvl: number) => 1 + 0.15 * lvl;

// Machines: one-time buys that unlock in order as the farm grows.
export type MachineId = "well" | "windmill" | "tractor" | "harvester" | "dam";

export interface MachineDef {
  id: MachineId;
  name: string;
  cost: number;
  desc: string;
}

export const MACHINES: MachineDef[] = [
  { id: "well", name: "Water well", cost: 250, desc: "Crops grow 25% faster" },
  { id: "windmill", name: "Windmill", cost: 1500, desc: "Mills your crops: +30% sale price" },
  { id: "tractor", name: "Tractor", cost: 6000, desc: "Plants empty plots for you" },
  { id: "harvester", name: "Harvester", cost: 25000, desc: "Harvests ripe crops, earns while you're away" },
  { id: "dam", name: "Hydro dam", cost: 120000, desc: "Powers it all: machines 2x faster, +25% growth, full offline pay" },
];

export const has = (s: State, m: MachineId) => s.machines.includes(m);

export function buyMachine(s: State, id: MachineId): boolean {
  const idx = MACHINES.findIndex((m) => m.id === id);
  const m = MACHINES[idx];
  if (has(s, id) || s.coins < m.cost) return false;
  if (idx > 0 && !has(s, MACHINES[idx - 1].id)) return false;
  s.coins -= m.cost;
  s.machines.push(id);
  return true;
}

/** Seconds between tractor/harvester passes (Infinity when you have neither). */
export const machineInterval = (s: State) =>
  !has(s, "tractor") && !has(s, "harvester") ? Infinity : has(s, "dam") ? 1 : 2;

export interface Plot {
  crop: string | null;
  plantedAt: number; // ms timestamp
}

export interface Order {
  crop: string;
  qty: number;
  reward: number;
}

export interface State {
  v: 1;
  coins: number;
  lifetime: number; // total coins ever earned: the score
  plots: Plot[];
  unlocked: string[];
  inventory: Record<string, number>;
  levels: Record<UpgradeId, number>;
  machines: MachineId[];
  selected: string;
  order: Order | null;
  lastSeen: number;
}

export function newState(now: number): State {
  return {
    v: 1,
    coins: 10,
    lifetime: 0,
    plots: Array.from({ length: START_PLOTS }, () => ({ crop: null, plantedAt: 0 })),
    unlocked: ["wheat"],
    inventory: {},
    levels: { plot: 0, growth: 0, price: 0 },
    machines: [],
    selected: "wheat",
    order: null,
    lastSeen: now,
  };
}

export function parseState(raw: string, now: number): State {
  if (!raw) return newState(now);
  try {
    const s = JSON.parse(raw) as State;
    if (s.v !== 1 || !Array.isArray(s.plots)) return newState(now);
    // Fill in anything a future/older version may be missing.
    const base = newState(now);
    return { ...base, ...s, levels: { ...base.levels, ...s.levels }, machines: s.machines ?? [] };
  } catch {
    return newState(now);
  }
}

export const growSeconds = (s: State, cropId: string) =>
  cropById(cropId).grow *
  growthMult(s.levels.growth) *
  (has(s, "well") ? 0.75 : 1) *
  (has(s, "dam") ? 0.75 : 1);

export const salePrice = (s: State, cropId: string) =>
  Math.round(cropById(cropId).sell * priceMult(s.levels.price) * (has(s, "windmill") ? 1.3 : 1));

/** 0..1 growth progress of a plot. */
export function progress(s: State, p: Plot, now: number): number {
  if (!p.crop) return 0;
  return Math.min(1, (now - p.plantedAt) / 1000 / growSeconds(s, p.crop));
}

export const isRipe = (s: State, p: Plot, now: number) => !!p.crop && progress(s, p, now) >= 1;

export function earn(s: State, amount: number): void {
  s.coins += amount;
  s.lifetime += amount;
}

export function plant(s: State, i: number, cropId: string, now: number): boolean {
  const p = s.plots[i];
  const crop = cropById(cropId);
  if (!p || p.crop || s.coins < crop.seed || !s.unlocked.includes(cropId)) return false;
  s.coins -= crop.seed;
  p.crop = cropId;
  p.plantedAt = now;
  return true;
}

export function harvest(s: State, i: number, now: number): string | null {
  const p = s.plots[i];
  if (!p || !isRipe(s, p, now)) return null;
  const id = p.crop!;
  s.inventory[id] = (s.inventory[id] ?? 0) + 1;
  p.crop = null;
  return id;
}

export const inventoryValue = (s: State) =>
  Object.entries(s.inventory).reduce((sum, [id, n]) => sum + n * salePrice(s, id), 0);

export function sellAll(s: State): number {
  const value = inventoryValue(s);
  s.inventory = {};
  earn(s, value);
  return value;
}

export function canFulfil(s: State): boolean {
  return !!s.order && (s.inventory[s.order.crop] ?? 0) >= s.order.qty;
}

export function fulfilOrder(s: State): number {
  if (!canFulfil(s)) return 0;
  const o = s.order!;
  s.inventory[o.crop] -= o.qty;
  earn(s, o.reward);
  s.order = null;
  return o.reward;
}

/** A customer asks for a batch of one crop and pays a 60% bonus. */
export function newOrder(s: State, rand: () => number = Math.random): Order {
  // Favour the newest crops so orders stay worthwhile.
  const pool = s.unlocked.slice(-3);
  const crop = pool[Math.floor(rand() * pool.length)];
  const qty = 2 + Math.floor(rand() * 5);
  return { crop, qty, reward: Math.round(salePrice(s, crop) * qty * 1.6) };
}

export function unlockCrop(s: State, cropId: string): boolean {
  const c = cropById(cropId);
  if (s.unlocked.includes(cropId) || s.coins < c.unlock) return false;
  // Unlock in order only.
  const idx = CROPS.indexOf(c);
  if (idx > 0 && !s.unlocked.includes(CROPS[idx - 1].id)) return false;
  s.coins -= c.unlock;
  s.unlocked.push(cropId);
  s.selected = cropId;
  return true;
}

export function upgradeCost(s: State, id: UpgradeId): number | null {
  const def = UPGRADES.find((u) => u.id === id)!;
  const lvl = s.levels[id];
  return lvl >= def.max ? null : def.cost(lvl);
}

export function buyUpgrade(s: State, id: UpgradeId): boolean {
  const cost = upgradeCost(s, id);
  if (cost === null || s.coins < cost) return false;
  s.coins -= cost;
  s.levels[id]++;
  if (id === "plot") s.plots.push({ crop: null, plantedAt: 0 });
  return true;
}

/** One pass of the machines: harvester picks ripe plots, tractor replants empty ones. */
export function machineTick(s: State, now: number): number {
  let changed = 0;
  s.plots.forEach((p, i) => {
    if (has(s, "harvester") && isRipe(s, p, now)) {
      harvest(s, i, now);
      changed++;
    }
    if (has(s, "tractor") && !p.crop && plant(s, i, s.selected, now)) changed++;
  });
  return changed;
}

const MAX_OFFLINE_SEC = 8 * 3600;

/**
 * Coins earned while away. Needs the harvester. Each plot keeps cycling the
 * selected crop; pay is half rate, or full rate with the hydro dam.
 */
export function offlineEarnings(s: State, now: number): number {
  if (!has(s, "harvester")) return 0;
  const away = Math.min(MAX_OFFLINE_SEC, Math.max(0, (now - s.lastSeen) / 1000));
  if (away < 30) return 0;
  const cropId = s.selected;
  const cycle = growSeconds(s, cropId) + machineInterval(s);
  const profitPerCycle = salePrice(s, cropId) - cropById(cropId).seed;
  const rate = has(s, "dam") ? 1 : 0.5;
  return Math.max(0, Math.floor((away / cycle) * profitPerCycle * s.plots.length * rate));
}

export function formatNum(n: number): string {
  if (n < 1000) return String(Math.floor(n));
  const units = ["K", "M", "B", "T"];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.floor(n)}${units[u]}`;
}
