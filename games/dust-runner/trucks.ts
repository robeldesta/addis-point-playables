import * as THREE from "three";
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
  accent: number;
  trim: number;
  price: number;
  priceMul: number; // upgrades cost more on better trucks
  base: Partial<Spec>;
}

export const TRUCKS: TruckDef[] = [
  {
    id: "rookie", name: "Rookie 11", number: "11", livery: 0xd32f2f, accent: 0xffffff, trim: 0x1e5bd8, price: 0, priceMul: 1,
    blurb: "Tired old truck. Soft, tippy, slow. Make it yours.",
    base: {},
  },
  {
    id: "sidewinder", name: "Sidewinder", number: "27", livery: 0x1a4fb4, accent: 0xffffff, trim: 0x1e8bff, price: 3500, priceMul: 1.4,
    blurb: "Real race truck. More power and travel, wider stance.",
    base: { mass: 1800, power: 470000, maxDrive: 19500, rest: 0.9, bump: 0.82, k: 14500, k3: 26000, damp: 2200, rebound: 4200, bypass: 2, hbump: 50000,
      arb: 8800, grip: 1.1, frontGrip: 1.04, rearGrip: 1.12, tc: 0.72, spin: 0.06, assist: 1.25, lift: 0.62, maxSteer: 0.68, steerFade: 400, steerRate: 3.1, inertia: new THREE.Vector3(4400, 4400, 1600) },
  },
  {
    id: "apex", name: "Apex Unlimited", number: "1", livery: 0x15171b, accent: 0xf2b705, trim: 0xf2b705, price: 9000, priceMul: 2,
    blurb: "Top class. Huge power, huge travel, glued to the ground.",
    base: { mass: 1750, power: 580000, maxDrive: 22000, rest: 0.98, bump: 0.9, k: 13000, k3: 10000, damp: 1900, rebound: 6000, bypass: 2.4, hbump: 90000,
      arb: 10500, grip: 1.2, frontGrip: 1.08, rearGrip: 1.18, tc: 0.7, spin: 0.03, assist: 1.5, lift: 0.68, yawDamp: 1.9, maxSteer: 0.74, steerFade: 520, steerRate: 3.6, inertia: new THREE.Vector3(5200, 4500, 1700) },
  },
];

export type Levels = [number, number, number, number];

export function buildSpec(def: TruckDef, lv: Levels): Spec {
  const s: Spec = { ...SPEC, ...def.base } as Spec;
  s.inertia = (def.base.inertia ?? SPEC.inertia).clone();
  const [e, su, t, st] = lv;
  s.power *= 1 + 0.11 * e;
  s.maxDrive *= 1 + 0.07 * e;
  s.tc -= 0.06 * e; // the engine package comes with smarter traction control
  s.spin *= 1 - 0.25 * e;
  s.rest += 0.035 * su;
  s.bump += 0.035 * su;
  // race shocks: more rebound control, bigger bypass zones, hydraulic bump
  // stops, and less of the pogo-stick progressive spring
  s.damp *= 1 + 0.06 * su;
  s.rebound += 900 * su;
  s.bypass += 0.6 * su;
  s.hbump += 15000 * su;
  s.k3 *= 1 - 0.18 * su;
  s.inertia.x *= 1 + 0.05 * su; // centralised mass: the body pitches less
  s.grip *= 1 + 0.06 * t;
  s.frontGrip += 0.02 * t;
  s.rearGrip += 0.03 * t; // rear grip grows faster than front: more grip never means more tail-out
  s.maxSteer += 0.02 * t;
  s.steerFade += 40 * t;
  s.arb *= 1 + 0.14 * st;
  s.assist *= 1 + 0.22 * st;
  s.lift = Math.min(0.9, s.lift + 0.05 * st);
  s.yawDamp += 0.15 * st;
  s.tc = Math.max(0.65, s.tc - 0.04 * st);
  s.spin *= 1 - 0.25 * st;
  return s;
}

/** 0..100 ratings for the garage bars */
export function rate(s: Spec) {
  const pct = (v: number, a: number, b: number) => Math.round(Math.max(4, Math.min(100, ((v - a) / (b - a)) * 100)));
  return {
    power: pct(s.power / s.mass, 170, 520),
    susp: pct(s.bump + s.rebound / 20000 + s.bypass / 20 - s.k3 / 200000, 0.45, 1.65),
    grip: pct(s.grip * (1 + (s.frontGrip - 1) * 0.5) + s.maxSteer * 0.3, 1.13, 1.85),
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
