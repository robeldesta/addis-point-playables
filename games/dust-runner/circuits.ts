import type { FeatureKind } from "./terrain";

// The ten circuits, easiest first. Routes are generated offline from these
// settings (tools: /games/dust-runner/bake-circuits.ts) and stored in
// circuits.json so the game loads instantly.

export interface CircuitDef {
  id: string;
  name: string;
  env: string;        // which look/ground shape it builds on
  blurb: string;
  length: number;     // target length (m)
  step: number;       // control point spacing: smaller = twistier
  turn: number;       // max bend per control point (rad)
  mix: Partial<Record<FeatureKind, number>>;
  gap: [number, number]; // metres of plain track between features
  routeW: number;
}

export const CIRCUITS: CircuitDef[] = [
  { id: "c1", name: "Dust Run", env: "flats", blurb: "Open desert. Learn the truck", length: 2500, step: 65, turn: 0.7,
    mix: { whoops: 3, rollers: 2, kicker: 1, table: 1 }, gap: [140, 260], routeW: 8 },
  { id: "c2", name: "Canyon Sprint", env: "canyon", blurb: "Rocky canyon. Corners and elevation", length: 3200, step: 55, turn: 0.95,
    mix: { whoops: 2, rocks: 2, kicker: 1, rollers: 1, gap: 1 }, gap: [120, 220], routeW: 7.5 },
  { id: "c3", name: "Redline Ridge", env: "ridge", blurb: "Desert hills. Jumps and landings", length: 3800, step: 60, turn: 0.8,
    mix: { kicker: 3, table: 3, crest: 2, gap: 1, rollers: 1 }, gap: [90, 170], routeW: 7.5 },
  { id: "c4", name: "Dry Riverbed", env: "wash", blurb: "Sunken riverbed. Uneven, rocky ground", length: 4200, step: 55, turn: 0.9,
    mix: { whoops: 3, bigwhoops: 3, rocks: 3, rollers: 1, gap: 1 }, gap: [80, 160], routeW: 8 },
  { id: "c5", name: "Sandstorm", env: "storm", blurb: "Open dunes in a storm. Low grip, low visibility", length: 4800, step: 65, turn: 0.8,
    mix: { crest: 3, rollers: 2, whoops: 2, bigwhoops: 1 }, gap: [110, 200], routeW: 8 },
  { id: "c6", name: "Broken Mesa", env: "mesa2", blurb: "Rocky plateau. Tight, technical, rock gardens", length: 5200, step: 45, turn: 1.15,
    mix: { rocks: 4, whoops: 2, kicker: 1, table: 1, gap: 1 }, gap: [70, 140], routeW: 7 },
  { id: "c7", name: "Serpent Pass", env: "pass", blurb: "Mountain pass. Fast sweepers, precision", length: 5800, step: 80, turn: 0.6,
    mix: { rollers: 3, crest: 1, kicker: 1, whoops: 1 }, gap: [200, 360], routeW: 8.5 },
  { id: "c8", name: "Wreckage Valley", env: "wreck", blurb: "Abandoned industrial zone. Narrow passages", length: 6200, step: 50, turn: 1.0,
    mix: { whoops: 2, rocks: 2, kicker: 2, table: 1, gap: 1 }, gap: [90, 170], routeW: 6.5 },
  { id: "c9", name: "Devil's Backbone", env: "backbone", blurb: "Extreme mountain desert. Everything at once", length: 7000, step: 50, turn: 1.05,
    mix: { bigwhoops: 2, rocks: 2, gap: 2, crest: 2, kicker: 2, table: 1, rollers: 1 }, gap: [70, 140], routeW: 7 },
  { id: "c10", name: "Last Stand", env: "grand", blurb: "Grand desert endurance. Full mastery", length: 8500, step: 60, turn: 0.85,
    mix: { whoops: 2, bigwhoops: 2, rollers: 2, kicker: 2, table: 2, crest: 2, gap: 1, rocks: 2 }, gap: [80, 170], routeW: 7.5 },
];

export const mapSize = (length: number) => Math.round(Math.sqrt(length * 125) + 110);
