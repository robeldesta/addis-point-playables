import type { FeatureKind } from "./terrain";

// Each stage is its own place: a desert sub-biome with its own ground shape,
// colours, light, plants and route.

export interface Biome {
  id: string;
  name: string;
  blurb: string;
  route: [number, number][];
  base: (x: number, z: number) => number;
  follow: number;   // metres of smoothing: small = the route rides every dune
  sink: number;     // how far the route is cut below the ground (wash, canyon)
  wall: number;     // width of the bank/wall blending the route back into the ground
  routeW: number;   // half width of the driven line
  features: [FeatureKind, number, number][]; // kind, fraction along route, length m
  ground: [number, number]; crest: number; rock: number; track: number; rut: number; bandColors?: number[];
  sky: [string, string, string, string]; fog: number; fogNear: number; fogFar: number;
  sun: number; sunI: number; sunDir: [number, number, number]; hemiSky: number; hemiGround: number; hemiI: number;
  far: number[]; farH: [number, number]; // distant mesas/mountains
  cactus: number; bush: number; bushColor: number; boulder: number; boulderColor: number; pebble: number;
  gold: number; silver: number; bronze: number;
  loop?: boolean; stadium?: boolean; laps?: number;
}

const S = Math.sin, C = Math.cos;

export const BIOMES: Biome[] = [
  {
    id: "flats", name: "Creosote Flats", blurb: "Wide open scrubland. Flat out, big whoops",
    route: [[-160, -150], [-60, -165], [40, -125], [125, -150], [160, -70], [100, 0], [-20, -25], [-120, 5], [-160, 90], [-90, 150], [30, 120], [150, 160]],
    base: (x, z) => 1.4 * S(x * 0.017 + 0.5) * C(z * 0.021) + 0.7 * S((x - z) * 0.045) + 0.25 * S(x * 0.13) * C(z * 0.11),
    follow: 30, sink: 0, wall: 14, routeW: 7,
    features: [["whoops", 0.06, 80], ["kicker", 0.17, 50], ["bigwhoops", 0.27, 110], ["rollers", 0.42, 110], ["table", 0.56, 62], ["whoops", 0.66, 90], ["kicker", 0.8, 50], ["bigwhoops", 0.88, 90]],
    ground: [0xd9b98a, 0xc9a574], crest: 0xe6cfa6, rock: 0xa98564, track: 0xb48a5c, rut: 0x8e6a45,
    sky: ["#2f7fd8", "#7fb6ea", "#ecdcc0", "#e7cfa6"], fog: 0xe8d8bb, fogNear: 110, fogFar: 420,
    sun: 0xfff3dc, sunI: 2.7, sunDir: [0.3, 0.9, 0.3], hemiSky: 0xdbeaff, hemiGround: 0xb59670, hemiI: 1.35,
    far: [0xa98a6c, 0x9c8166], farH: [12, 30],
    cactus: 30, bush: 650, bushColor: 0x7d8a3e, boulder: 25, boulderColor: 0x9a7b5c, pebble: 260,
    gold: 65, silver: 74.5, bronze: 92,
  },
  {
    id: "dunes", name: "Silver Dunes", blurb: "Ride the dune crests. Lots of air",
    route: [[-160, 160], [-165, 70], [-110, -10], [-150, -100], [-70, -160], [5, -95], [-25, 0], [45, 70], [125, 110], [160, 30], [110, -60], [160, -150]],
    base: (x, z) => {
      const u = x * 0.024 + z * 0.011 + S(z * 0.012) * 1.6;
      const ridge = 1 - Math.abs(C(u));
      return 7 * ridge ** 1.6 + 2.2 * S(z * 0.019 + x * 0.007) + 0.6 * S(x * 0.08 + z * 0.05);
    },
    follow: 7, sink: -0.2, wall: 9, routeW: 7.5,
    features: [["crest", 0.12, 55], ["rollers", 0.3, 90], ["crest", 0.47, 55], ["whoops", 0.6, 70], ["crest", 0.74, 55], ["rollers", 0.86, 80]],
    ground: [0xf2dcb2, 0xe8c895], crest: 0xfff0d2, rock: 0xd9b98a, track: 0xd6b383, rut: 0xb8946a,
    sky: ["#4a8fe0", "#a8cff2", "#fbe9cf", "#f5dcb6"], fog: 0xf8e6c8, fogNear: 100, fogFar: 380,
    sun: 0xfff0d0, sunI: 2.9, sunDir: [-0.6, 0.55, 0.4], hemiSky: 0xe3f0ff, hemiGround: 0xe0c090, hemiI: 1.3,
    far: [0xe6c79a, 0xdcb98a], farH: [8, 20],
    cactus: 0, bush: 110, bushColor: 0x9a9a55, boulder: 0, boulderColor: 0xc9a67c, pebble: 40,
    gold: 66, silver: 75, bronze: 93,
  },
  {
    id: "wash", name: "Dry Wash", blurb: "A sunken riverbed full of rocks and whoops",
    route: [[-170, -40], [-120, -95], [-60, -65], [-15, -125], [45, -150], [105, -100], [80, -30], [20, 20], [55, 90], [130, 60], [160, 125], [90, 165]],
    base: (x, z) => 2.5 * S(x * 0.013 + 1) * C(z * 0.017) + 1.2 * S((x + z) * 0.03) + 0.4 * S(x * 0.11 - z * 0.09),
    follow: 25, sink: 4.2, wall: 12, routeW: 8,
    features: [["whoops", 0.05, 70], ["rocks", 0.15, 60], ["bigwhoops", 0.25, 90], ["gap", 0.38, 46], ["rocks", 0.47, 70], ["rollers", 0.56, 90], ["bigwhoops", 0.7, 100], ["rocks", 0.82, 60], ["kicker", 0.9, 50]],
    ground: [0xc8b394, 0xb59d7c], crest: 0xd8c6a6, rock: 0x8f7a62, track: 0xd8cbb5, rut: 0xa8977d,
    sky: ["#3a78c8", "#88b3e0", "#f0d6b0", "#e6c49a"], fog: 0xe9d2b0, fogNear: 90, fogFar: 360,
    sun: 0xffe2b0, sunI: 2.6, sunDir: [0.7, 0.45, -0.3], hemiSky: 0xd6e6ff, hemiGround: 0xa08860, hemiI: 1.3,
    far: [0x8f7a66, 0x7d6a58], farH: [20, 45],
    cactus: 25, bush: 420, bushColor: 0x6f7d3a, boulder: 55, boulderColor: 0x8d7f73, pebble: 500,
    gold: 63, silver: 72, bronze: 89,
  },
  {
    id: "canyon", name: "Red Rock Canyon", blurb: "Sheer red walls, a gap jump and rock gardens",
    route: [[-150, 155], [-145, 75], [-90, 35], [-125, -40], [-80, -110], [-10, -90], [30, -150], [110, -130], [140, -60], [80, -10], [100, 70], [160, 110]],
    base: (x, z) => {
      const h = 24 + 3 * S(x * 0.03) * C(z * 0.025) + 1.5 * S((x - z) * 0.07);
      return h + 2 * S(x * 0.2 + z * 0.15) * 0.3;
    },
    follow: 30, sink: 20, wall: 16, routeW: 8,
    features: [["whoops", 0.06, 70], ["kicker", 0.17, 50], ["rocks", 0.26, 60], ["gap", 0.36, 46], ["bigwhoops", 0.46, 90], ["table", 0.6, 62], ["rocks", 0.7, 60], ["rollers", 0.78, 80], ["kicker", 0.9, 50]],
    ground: [0xc9774a, 0xb8653d], crest: 0xd98d5c, rock: 0xa0522d, track: 0xd49a6a, rut: 0xa86f45, bandColors: [0xb85c34, 0xd98a58, 0xa04a2a, 0xe0a070],
    sky: ["#2a5fb0", "#e89a6a", "#f8c48a", "#f0a870"], fog: 0xf0b888, fogNear: 80, fogFar: 340,
    sun: 0xffc890, sunI: 2.5, sunDir: [-0.75, 0.4, 0.25], hemiSky: 0xffd8c0, hemiGround: 0x9a5030, hemiI: 1.3,
    far: [0xb8653d, 0xa0522d], farH: [40, 70],
    cactus: 20, bush: 160, bushColor: 0x7a7a3a, boulder: 30, boulderColor: 0x9c4a28, pebble: 300,
    gold: 62.5, silver: 71.5, bronze: 88.5,
  },
  {
    id: "mesa", name: "Mesa Top", blurb: "Mountain desert. Long climbs, fast descents",
    route: [[160, -160], [90, -140], [20, -160], [-60, -125], [-40, -50], [-120, -20], [-160, 60], [-90, 110], [0, 80], [60, 140], [140, 90], [150, 10]],
    base: (x, z) => 16 * S(x * 0.012 + 1) * C(z * 0.0105) + 7 * S((x - z) * 0.019) + 1.5 * S(x * 0.06 + z * 0.04),
    follow: 22, sink: 0, wall: 16, routeW: 7.5,
    features: [["whoops", 0.07, 70], ["kicker", 0.19, 50], ["rollers", 0.3, 90], ["crest", 0.44, 55], ["bigwhoops", 0.55, 90], ["table", 0.68, 62], ["kicker", 0.8, 50], ["whoops", 0.88, 70]],
    ground: [0xa8977d, 0x968569], crest: 0xc4b498, rock: 0x7c6e60, track: 0xbfa880, rut: 0x93805f,
    sky: ["#1f5fb5", "#79aee6", "#d8e2e8", "#c9c2b0"], fog: 0xcfd6d8, fogNear: 110, fogFar: 460,
    sun: 0xfff6e8, sunI: 2.6, sunDir: [0.4, 0.75, -0.5], hemiSky: 0xd0e4ff, hemiGround: 0x8a7a62, hemiI: 1.4,
    far: [0x7f8a96, 0x6f7a86], farH: [60, 110],
    cactus: 15, bush: 380, bushColor: 0x6a7440, boulder: 45, boulderColor: 0x7c7068, pebble: 380,
    gold: 63, silver: 72, bronze: 89,
  },
  {
    id: "stadium", name: "Thunder Bowl", blurb: "Stadium race under the lights. 3 laps, 3 rivals, big jumps",
    route: [[-72, -38], [-20, -50], [40, -44], [80, -30], [88, 4], [62, 30], [28, 14], [0, 22], [-12, 46], [-52, 48], [-84, 22], [-90, -12]],
    base: (x, z) => 0.08 * Math.sin(x * 0.7) * Math.cos(z * 0.6),
    follow: 6, sink: 0, wall: 3, routeW: 6.5,
    features: [["table", 0.07, 62], ["whoops", 0.2, 54], ["kicker", 0.33, 46], ["bigwhoops", 0.45, 52], ["gap", 0.57, 46], ["rollers", 0.7, 70], ["kicker", 0.86, 46]],
    ground: [0x5d4a3a, 0x54443a], crest: 0x6a5644, rock: 0x4a3c30, track: 0x8b5e3c, rut: 0x6a4428,
    sky: ["#070b1f", "#18224a", "#3a3558", "#1c1a26"], fog: 0x1a1c2a, fogNear: 160, fogFar: 520,
    sun: 0xf4f6ff, sunI: 2.6, sunDir: [0.25, 1, 0.35], hemiSky: 0xa8b4dc, hemiGround: 0x6a5240, hemiI: 1.5,
    far: [0x22242e], farH: [0, 0],
    cactus: 0, bush: 0, bushColor: 0x555555, boulder: 0, boulderColor: 0x6a5a4a, pebble: 0,
    gold: 0, silver: 0, bronze: 0,
    loop: true, stadium: true, laps: 3,
  },
];

export type Medal = "gold" | "silver" | "bronze" | "";
export const medalFor = (b: Biome, t: number): Medal =>
  !t ? "" : t <= b.gold ? "gold" : t <= b.silver ? "silver" : t <= b.bronze ? "bronze" : "";
export const MEDAL_ICON: Record<Medal, string> = { gold: "🥇", silver: "🥈", bronze: "🥉", "": "" };
