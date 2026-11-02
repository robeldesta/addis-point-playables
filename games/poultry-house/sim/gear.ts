// Cameras and sensors: where they go, what they see, and what to buy.
import { Layout, Rect, center, mountY, rectD, rectW } from "./layout";

export type Lens = "2.0" | "2.8" | "4.0";
// Typical 4MP (16:9) dome camera field of view, in degrees.
export const LENS: Record<Lens, { h: number; v: number; label: string }> = {
  "2.0": { h: 118, v: 62, label: "2.0mm extra wide" },
  "2.8": { h: 103, v: 55, label: "2.8mm wide" },
  "4.0": { h: 84, v: 45, label: "4mm" },
};

export type GearKind = "overhead" | "door" | "egg" | "sensor";
export interface Gear {
  id: number;
  kind: GearKind;
  x: number;
  z: number;
  lens: Lens;
  rot: 0 | 1; // 0 = wide side across the house, 1 = wide side along it
}

export const DOOR_RADIUS = 3.5; // a door camera sees people within this distance
export const EGG_RADIUS = 2.5; // an egg table camera sees the table within this distance
export const SENSOR_RADIUS = 5; // an ammonia sensor reads the air around it

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Floor area a ceiling camera sees, looking straight down. */
export function footprint(L: Layout, g: Pick<Gear, "x" | "z" | "lens" | "rot">): Rect {
  const h = mountY(L, g.x);
  const a = h * Math.tan(rad(LENS[g.lens].h / 2));
  const b = h * Math.tan(rad(LENS[g.lens].v / 2));
  const hx = g.rot === 0 ? a : b;
  const hz = g.rot === 0 ? b : a;
  return { x0: g.x - hx, x1: g.x + hx, z0: g.z - hz, z1: g.z + hz };
}

export class CoverMap {
  readonly step = 0.5;
  readonly cols: number;
  readonly rows: number;
  readonly mask: Uint8Array;
  readonly fps: Rect[];
  constructor(readonly L: Layout, gears: Gear[]) {
    this.cols = Math.ceil(L.dims.width / this.step);
    this.rows = Math.ceil(L.dims.length / this.step);
    this.mask = new Uint8Array(this.cols * this.rows);
    this.fps = gears.filter((g) => g.kind === "overhead").map((g) => footprint(L, g));
    for (let r = 0; r < this.rows; r++) {
      const z = -L.hl + (r + 0.5) * this.step;
      for (let c = 0; c < this.cols; c++) {
        const x = -L.hw + (c + 0.5) * this.step;
        for (const f of this.fps) {
          if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) {
            this.mask[r * this.cols + c] = 1;
            break;
          }
        }
      }
    }
  }
  covered(x: number, z: number): boolean {
    const c = Math.floor((x + this.L.hw) / this.step);
    const r = Math.floor((z + this.L.hl) / this.step);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.mask[r * this.cols + c] === 1;
  }
  /** Share of each pen's floor that some ceiling camera sees (0..1). */
  stats(): { total: number; perPen: number[] } {
    const L = this.L;
    const perPen: number[] = [];
    let all = 0;
    let seen = 0;
    for (const p of L.pens) {
      let n = 0;
      let s = 0;
      for (let r = 0; r < this.rows; r++) {
        const z = -L.hl + (r + 0.5) * this.step;
        if (z < p.z0 || z > p.z1) continue;
        for (let c = 0; c < this.cols; c++) {
          const x = -L.hw + (c + 0.5) * this.step;
          if (x < p.x0 || x > p.x1) continue;
          n++;
          s += this.mask[r * this.cols + c];
        }
      }
      perPen.push(n ? s / n : 0);
      if (p.active) {
        all += n;
        seen += s;
      }
    }
    return { total: all ? seen / all : 0, perPen };
  }
}

export const coversDoor = (L: Layout, gears: Gear[]) =>
  gears.some((g) => g.kind === "door" && Math.hypot(g.x - L.mainDoor.x, g.z - L.mainDoor.z) <= DOOR_RADIUS);
export const coversBackDoor = (L: Layout, gears: Gear[]) =>
  gears.some((g) => g.kind === "door" && Math.hypot(g.x - L.backDoor.x, g.z - L.backDoor.z) <= DOOR_RADIUS);
export const coversEggTable = (L: Layout, gears: Gear[]) => {
  const c = center(L.eggTable);
  return gears.some((g) => g.kind === "egg" && Math.hypot(g.x - c.x, g.z - c.z) <= EGG_RADIUS);
};
export const coversFeedStore = (L: Layout, gears: Gear[]) => {
  const c = center(L.feedStore);
  return gears.some((g) => g.kind === "door" && Math.hypot(g.x - c.x, g.z - c.z) <= DOOR_RADIUS + 1.5);
};

/** Fewest ceiling cameras that tile each pen, plus doors, egg table and sensors. */
export function autoPlace(L: Layout, lens: Lens): Gear[] {
  const out: Gear[] = [];
  let id = 1;
  for (const p of L.pens.filter((q) => q.active)) {
    let best: Gear[] | null = null;
    for (const rot of [0, 1] as const) {
      const w = rectW(p);
      const d = rectD(p);
      // Grow the grid until every tile fits inside its camera's view.
      for (let cols = 1; cols <= 12; cols++) {
        const xs = Array.from({ length: cols }, (_, i) => p.x0 + (w * (i + 0.5)) / cols);
        const fits = xs.every((x) => rectW(footprint(L, { x, z: 0, lens, rot })) >= w / cols - 1e-6);
        if (!fits) continue;
        const fd = Math.min(...xs.map((x) => rectD(footprint(L, { x, z: 0, lens, rot }))));
        const rows = Math.ceil(d / fd - 1e-6);
        const tiles: Gear[] = [];
        for (const x of xs)
          for (let r = 0; r < rows; r++)
            tiles.push({ id: 0, kind: "overhead", x: snap(x), z: snap(p.z0 + (d * (r + 0.5)) / rows), lens, rot });
        if (!best || tiles.length < best.length) best = tiles;
        break;
      }
    }
    for (const g of best ?? []) out.push({ ...g, id: id++ });
  }
  const et = center(L.eggTable);
  out.push({ id: id++, kind: "door", x: L.mainDoor.x, z: L.mainDoor.z - 1.5, lens: "2.8", rot: 0 });
  out.push({ id: id++, kind: "door", x: L.backDoor.x, z: L.backDoor.z + 1.5, lens: "2.8", rot: 0 });
  out.push({ id: id++, kind: "egg", x: et.x, z: et.z, lens: "4.0", rot: 0 });
  for (const p of L.pens.filter((q) => q.active)) {
    const c = center(p);
    out.push({ id: id++, kind: "sensor", x: snap(c.x), z: snap(c.z), lens: "2.8", rot: 0 });
  }
  return out;
}

const snap = (v: number) => Math.round(v * 2) / 2;

export interface ShopLine { item: string; qty: number; note?: string }

export function shopping(L: Layout, gears: Gear[]): ShopLine[] {
  const cams = gears.filter((g) => g.kind !== "sensor");
  const lines: ShopLine[] = [];
  for (const lens of Object.keys(LENS) as Lens[]) {
    const n = gears.filter((g) => g.kind === "overhead" && g.lens === lens).length;
    if (n) lines.push({ item: `4MP PoE dome camera, ${lens}mm (ceiling)`, qty: n, note: "IP67, IR, WDR, RTSP/ONVIF" });
  }
  const doors = gears.filter((g) => g.kind === "door").length;
  if (doors) lines.push({ item: "4MP PoE dome camera, 2.8mm (doors and aisle)", qty: doors });
  const egg = gears.filter((g) => g.kind === "egg").length;
  if (egg) lines.push({ item: "4MP PoE camera, 4mm (egg table)", qty: egg, note: "mount 1.5 m above the table" });
  if (cams.length) {
    const ports = cams.length + 2;
    const sw = ports <= 8 ? 8 : ports <= 16 ? 16 : ports <= 24 ? 24 : 48;
    lines.push({ item: `PoE switch, ${sw}-port`, qty: 1, note: `${cams.length} cameras + PC + spare` });
    let m = 0;
    for (const g of cams) m += Math.abs(g.x - L.pc.x) + Math.abs(g.z - L.pc.z) + mountY(L, g.x) + 3;
    m = Math.ceil(m / 10) * 10;
    lines.push({ item: "Cat6 outdoor cable, 305 m box", qty: Math.ceil(m / 305), note: `about ${m} m of runs` });
    lines.push({ item: "PVC conduit (rats chew cable)", qty: m, note: "metres" });
    const tb = Math.max(2, Math.ceil((cams.length * 27 * 30) / 1000 / 2) * 2);
    lines.push({ item: `Surveillance hard drive, ${tb} TB`, qty: 1, note: "about 30 days of recording" });
    lines.push({ item: "AI PC: Ryzen 9, RTX 3060 12GB, 32GB RAM", qty: 1 });
    lines.push({ item: "UPS, 1500VA", qty: 1 });
  }
  const sensors = gears.filter((g) => g.kind === "sensor").length;
  if (sensors) lines.push({ item: "Ammonia + temperature + humidity sensor", qty: sensors });
  return lines;
}
