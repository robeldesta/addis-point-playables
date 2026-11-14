import { SPEC, type Spec } from "./truck";

// The garage: trucks you can own and the four upgrade lines for each.
// Every number that changes how a truck drives lives here.

export const UPGRADES = [
  { id: "engine", name: "Engine", icon: "🔥", blurb: "More power, higher top speed" },
  { id: "susp", name: "Suspension", icon: "🌀", blurb: "Longer travel, softer landings" },
  { id: "tyres", name: "Tyres", icon: "⭕", blurb: "More grip in corners" },
  { id: "stab", name: "Stability", icon: "⚖️", blurb: "Harder to roll, steadier in the air" },
] as const;
export const MAX_LEVEL = 4;
/** price of the next level (index = current level), scaled by the truck's class */
export const LEVEL_PRICE = [200, 400, 750, 1200];

export interface TruckDef {
  id: string;
  name: string;
  blurb: string;
  number: string;
  livery: number;
  price: number;
  priceMul: number; // upgrades cost more on better trucks
  base: Partial<Omit<Spec, "inertia">>;
}

export const TRUCKS: TruckDef[] = [
  {
    id: "rookie", name: "Rookie 11", number: "11", livery: 0xd32f2f, price: 0, priceMul: 1,
    blurb: "Tired old truck. Soft, tippy, slow. Make it yours.",
    base: {},
  },
  {
    id: "sidewinder", name: "Sidewinder", number: "27", livery: 0x1565c0, price: 3500, priceMul: 1.4,
    blurb: "Real race truck. More power and travel, wider stance.",
    base: { mass: 1800, power: 470000, maxDrive: 19500, rest: 0.9, bump: 0.82, k: 16500, damp: 2200, rebound: 3000, arb: 8800, grip: 1.07, assist: 1.25, lift: 0.62 },
  },
  {
    id: "apex", name: "Apex Unlimited", number: "1", livery: 0x15171b, price: 9000, priceMul: 2,
    blurb: "Top class. Huge power, huge travel, glued to the ground.",
    base: { mass: 1750, power: 580000, maxDrive: 22000, rest: 0.98, bump: 0.9, k: 17500, damp: 2500, rebound: 3300, arb: 10500, grip: 1.14, assist: 1.5, lift: 0.68, yawDamp: 1.15 },
  },
];

export type Levels = [number, number, number, number];

export function buildSpec(def: TruckDef, lv: Levels): Spec {
  const s: Spec = { ...SPEC, inertia: SPEC.inertia.clone(), ...def.base } as Spec;
  const [e, su, t, st] = lv;
  s.power *= 1 + 0.11 * e;
  s.maxDrive *= 1 + 0.07 * e;
  s.rest += 0.035 * su;
  s.bump += 0.035 * su;
  s.damp *= 1 + 0.09 * su;
  s.rebound *= 1 + 0.09 * su;
  s.k *= 1 + 0.03 * su;
  s.grip *= 1 + 0.045 * t;
  s.arb *= 1 + 0.14 * st;
  s.assist *= 1 + 0.22 * st;
  s.lift = Math.min(0.9, s.lift + 0.05 * st);
  s.yawDamp *= 1 + 0.08 * st;
  return s;
}

/** 0..100 ratings for the garage bars */
export function rate(s: Spec) {
  const pct = (v: number, a: number, b: number) => Math.round(Math.max(4, Math.min(100, ((v - a) / (b - a)) * 100)));
  return {
    power: pct(s.power / s.mass, 170, 520),
    susp: pct(s.bump + s.damp / 20000, 0.8, 1.25),
    grip: pct(s.grip, 0.95, 1.38),
    stab: pct(s.assist * 0.5 + (s.lift - 0.5) * 2 + s.arb / 30000, 0.85, 2.55),
  };
}

export const upgradePrice = (def: TruckDef, level: number) =>
  level >= MAX_LEVEL ? 0 : Math.round((LEVEL_PRICE[level] * def.priceMul) / 50) * 50;

/** cash paid out for a finished stage or race */
export function payout(medal: string, finished: boolean, airTime: number) {
  const base = medal === "gold" ? 700 : medal === "silver" ? 450 : medal === "bronze" ? 300 : finished ? 120 : 0;
  return base + Math.round(Math.min(airTime, 30) * 8);
}
