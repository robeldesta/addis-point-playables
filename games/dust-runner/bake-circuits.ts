// @ts-nocheck  (node-only tool)
// Offline tool: generates every circuit's route and writes circuits.json.
// Run with: npx vite-node games/dust-runner/bake-circuits.ts
import { writeFileSync } from "node:fs";
import { CIRCUITS, mapSize } from "./circuits";
import { genRoute } from "./routegen";

const out: Record<string, { size: number; ctrl: [number, number][] }> = {};
CIRCUITS.forEach((c, i) => {
  let pts: [number, number][] | null = null;
  for (let grow = 0; !pts; grow++) {
    try { pts = genRoute({ seed: 1000 + i * 37, length: c.length, size: mapSize(c.length) * (1 + grow * 0.06), step: c.step, turn: c.turn, sep: 72 }); }
    catch { console.log(c.id, "retry larger map"); }
  }
  const size = Math.ceil(Math.max(...pts.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))))) * 2 + 100;
  out[c.id] = { size, ctrl: pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) };
  console.log(c.id, c.name, pts.length, "points, map", size);
});
writeFileSync(new URL("./circuits.json", import.meta.url), JSON.stringify(out));
