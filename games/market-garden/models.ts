import * as THREE from "three";

// Low-poly models built from primitives, so there are no model files to download.

const matCache = new Map<number, THREE.MeshLambertMaterial>();
export const mat = (color: number) => {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    matCache.set(color, m);
  }
  return m;
};

export function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const sphere = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));

export const COLORS = {
  grass: 0x7cc35a,
  grassDark: 0x6ab04c,
  dirt: 0x9a6b43,
  dirtDark: 0x7d5434,
  path: 0xd9c08e,
  wood: 0x9c6b3e,
  woodDark: 0x6e4524,
  roofRed: 0xd2483f,
  roofBlue: 0x3f7fd2,
  white: 0xf4efe6,
  stone: 0xa7a39a,
  water: 0x4fb3e8,
  wheat: 0xf0c94a,
  flour: 0xf7f3ea,
  bread: 0xc98a3c,
  coin: 0xf7c531,
  skin: 0xe0ac7e,
};

export type ItemKind = "seed" | "wheat" | "flour" | "bread" | "egg" | "milk" | "cheese";

/** One carried item (sized to stack neatly). */
export function itemMesh(kind: ItemKind): THREE.Object3D {
  const g = new THREE.Group();
  if (kind === "seed") {
    const sack = mesh(sphere(0.24, 7), 0xb08a5a, 0, 0.14, 0);
    sack.scale.set(1.15, 0.6, 0.9);
    g.add(sack);
    g.add(mesh(cyl(0.06, 0.09, 0.1, 6), 0x8a6a40, 0, 0.3, 0, false));
    g.add(mesh(box(0.2, 0.05, 0.02), 0x5a8a2a, 0, 0.16, 0.21, false));
  } else if (kind === "wheat") {
    g.add(mesh(box(0.62, 0.22, 0.42), COLORS.wheat, 0, 0.11, 0));
    g.add(mesh(box(0.12, 0.24, 0.46), 0xc9932a, 0, 0.11, 0));
  } else if (kind === "flour") {
    g.add(mesh(box(0.56, 0.26, 0.42), COLORS.flour, 0, 0.13, 0));
    g.add(mesh(box(0.2, 0.08, 0.2), 0x6aa0d8, 0, 0.27, 0, false));
  } else if (kind === "egg") {
    // a small cardboard tray of eggs
    g.add(mesh(box(0.56, 0.08, 0.4), 0xc9a77a, 0, 0.04, 0));
    for (const [x, z] of [[-0.17, -0.09], [0, -0.09], [0.17, -0.09], [-0.17, 0.09], [0, 0.09], [0.17, 0.09]]) {
      const e = mesh(sphere(0.075, 6), 0xfff6e6, x, 0.13, z, false);
      e.scale.y = 1.3;
      g.add(e);
    }
  } else if (kind === "milk") {
    // a blue crate of milk bottles
    g.add(mesh(box(0.56, 0.16, 0.4), 0x2f7fd0, 0, 0.08, 0));
    for (const [x, z] of [[-0.14, -0.09], [0.14, -0.09], [-0.14, 0.09], [0.14, 0.09]]) {
      g.add(mesh(cyl(0.07, 0.08, 0.14, 6), 0xffffff, x, 0.21, z, false));
    }
  } else if (kind === "cheese") {
    const w = mesh(cyl(0.27, 0.27, 0.2, 10), 0xffc928, 0, 0.1, 0);
    g.add(w);
    g.add(mesh(cyl(0.28, 0.28, 0.06, 10), 0xe08a1e, 0, 0.1, 0, false));
  } else {
    const loaf = mesh(sphere(0.3, 7), COLORS.bread, 0, 0.13, 0);
    loaf.scale.set(1.1, 0.5, 0.75);
    g.add(loaf);
  }
  return g;
}

export function coinMesh(): THREE.Mesh {
  const m = mesh(cyl(0.22, 0.22, 0.07, 10), COLORS.coin, 0, 0, 0, false);
  return m;
}

export function farmer(): { root: THREE.Group; body: THREE.Group; legL: THREE.Object3D; legR: THREE.Object3D; back: THREE.Group; arms: [THREE.Object3D, THREE.Object3D] } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const legL = mesh(box(0.22, 0.5, 0.24), 0x355c9c, -0.15, 0.25, 0);
  const legR = mesh(box(0.22, 0.5, 0.24), 0x355c9c, 0.15, 0.25, 0);
  legL.geometry.translate(0, -0.2, 0);
  legR.geometry.translate(0, -0.2, 0);
  legL.position.y = 0.48;
  legR.position.y = 0.48;
  body.add(legL, legR);
  body.add(mesh(box(0.62, 0.62, 0.38), 0x4a90d9, 0, 0.8, 0)); // overalls
  body.add(mesh(box(0.64, 0.3, 0.4), 0xe05b4b, 0, 1.0, 0)); // shirt
  body.add(mesh(sphere(0.3, 8), COLORS.skin, 0, 1.42, 0)); // head
  body.add(mesh(cyl(0.55, 0.55, 0.06, 10), 0xe8c26a, 0, 1.62, 0)); // hat brim
  body.add(mesh(cyl(0.28, 0.32, 0.26, 8), 0xe8c26a, 0, 1.76, 0)); // hat top
  body.add(mesh(box(0.08, 0.08, 0.04), 0x222222, -0.1, 1.46, 0.28, false));
  body.add(mesh(box(0.08, 0.08, 0.04), 0x222222, 0.1, 1.46, 0.28, false));
  const back = new THREE.Group();
  back.position.set(0, 0.62, -0.42);
  body.add(back);
  const arms = addArms(body, 0xe05b4b, 1.1, 0.4);
  return { root, body, legL, legR, back, arms };
}

export function person(shirt: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(0.2, 0.5, 0.22), 0x3d3d4a, -0.13, 0.25, 0));
  g.add(mesh(box(0.2, 0.5, 0.22), 0x3d3d4a, 0.13, 0.25, 0));
  g.add(mesh(box(0.56, 0.6, 0.34), shirt, 0, 0.8, 0));
  const skins = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0x6b4423];
  g.add(mesh(sphere(0.27, 8), skins[Math.floor(Math.random() * skins.length)], 0, 1.3, 0));
  const hair = [0x2b1b10, 0x111111, 0x7a4b25, 0xd8b56a];
  const h = mesh(sphere(0.28, 8), hair[Math.floor(Math.random() * hair.length)], 0, 1.4, -0.04);
  h.scale.set(1, 0.6, 1);
  g.add(h);
  addArms(g, shirt, 1.05, 0.36);
  return g;
}

export function wheatPlant(): THREE.Group {
  const g = new THREE.Group();
  const offsets = [[-0.3, -0.3], [0.05, -0.32], [0.32, -0.25], [-0.15, 0], [0.18, 0.02], [-0.32, 0.3], [0.02, 0.3], [0.3, 0.32]];
  for (const [x, z] of offsets) {
    const h = 0.6 + Math.random() * 0.25;
    g.add(mesh(cyl(0.025, 0.035, h, 4), 0xc8a63e, x, h / 2, z, false));
    g.add(mesh(cone(0.085, 0.34, 5), Math.random() < 0.5 ? COLORS.wheat : 0xf5d76e, x, h + 0.12, z, false));
  }
  return g;
}

export function fieldTile(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(1.34, 0.12, 1.34), COLORS.dirtDark, 0, 0, 0, false));
  for (let i = -1; i <= 1; i++) g.add(mesh(box(1.2, 0.1, 0.3), COLORS.dirt, 0, 0.08, i * 0.42, false));
  return g;
}

export function stall(awning: number = COLORS.roofRed): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(3.2, 0.9, 1.2), COLORS.wood, 0, 0.45, 0));
  g.add(mesh(box(3.3, 0.08, 1.3), COLORS.woodDark, 0, 0.92, 0));
  for (const x of [-1.5, 1.5]) g.add(mesh(box(0.12, 2.2, 0.12), COLORS.woodDark, x, 1.1, 0.5));
  // striped awning
  for (let i = 0; i < 6; i++) {
    const a = mesh(box(0.56, 0.08, 1.6), i % 2 ? COLORS.white : awning, -1.4 + i * 0.56, 2.25, 0.25);
    a.rotation.x = -0.25;
    g.add(a);
  }
  return g;
}

export function windmill(): { root: THREE.Group; blades: THREE.Group } {
  const root = new THREE.Group();
  root.add(mesh(cyl(1.0, 1.5, 3.6, 8), COLORS.white, 0, 1.8, 0));
  root.add(mesh(cone(1.25, 1.3, 8), COLORS.roofRed, 0, 4.25, 0));
  root.add(mesh(box(0.6, 1.0, 0.1), COLORS.woodDark, 0, 0.5, 1.42));
  const blades = new THREE.Group();
  blades.position.set(0, 3.4, 1.15);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(mesh(box(0.12, 2.2, 0.06), COLORS.woodDark, 0, 1.1, 0));
    arm.add(mesh(box(0.55, 1.6, 0.04), 0xf2e6c9, 0.32, 1.3, 0));
    blades.add(arm);
  }
  blades.add(mesh(sphere(0.2, 6), COLORS.woodDark));
  root.add(blades);
  return { root, blades };
}

export function bakery(): { root: THREE.Group; smoke: THREE.Group } {
  const root = new THREE.Group();
  root.add(mesh(box(3.2, 2.0, 2.6), 0xe9b97a, 0, 1.0, 0));
  const roof = mesh(cone(2.6, 1.4, 4), COLORS.roofBlue, 0, 2.7, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.8);
  root.add(roof);
  root.add(mesh(box(0.8, 1.2, 0.1), COLORS.woodDark, 0, 0.6, 1.31));
  root.add(mesh(box(0.7, 0.6, 0.1), 0xbfe3ff, -1.0, 1.2, 1.31));
  root.add(mesh(box(0.7, 0.6, 0.1), 0xbfe3ff, 1.0, 1.2, 1.31));
  root.add(mesh(box(0.5, 1.4, 0.5), COLORS.stone, 1.0, 3.0, -0.5));
  const smoke = new THREE.Group();
  smoke.position.set(1.0, 3.9, -0.5);
  for (let i = 0; i < 3; i++) {
    const p = mesh(sphere(0.22, 6), 0xdddddd, 0, i * 0.45, 0, false);
    smoke.add(p);
  }
  root.add(smoke);
  return { root, smoke };
}

export function well(): { root: THREE.Group; bucket: THREE.Object3D } {
  const root = new THREE.Group();
  root.add(mesh(cyl(0.9, 0.95, 0.8, 10), COLORS.stone, 0, 0.4, 0));
  root.add(mesh(cyl(0.72, 0.72, 0.05, 10), COLORS.water, 0, 0.78, 0, false));
  root.add(mesh(box(0.14, 1.6, 0.14), COLORS.woodDark, -0.8, 1.2, 0));
  root.add(mesh(box(0.14, 1.6, 0.14), COLORS.woodDark, 0.8, 1.2, 0));
  const r = mesh(cone(1.3, 0.7, 4), COLORS.roofRed, 0, 2.3, 0);
  r.rotation.y = Math.PI / 4;
  root.add(r);
  const bucket = mesh(cyl(0.18, 0.14, 0.26, 8), COLORS.wood, 0, 1.4, 0);
  root.add(bucket);
  return { root, bucket };
}

export function tractor(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(1.0, 0.6, 1.8), 0xd8392b, 0, 0.75, 0.1));
  g.add(mesh(box(0.9, 0.8, 0.8), 0xd8392b, 0, 1.3, -0.4));
  g.add(mesh(box(0.8, 0.5, 0.82), 0xbfe3ff, 0, 1.35, -0.4));
  g.add(mesh(cyl(0.08, 0.08, 0.6), 0x333333, 0.3, 1.5, 0.6));
  for (const x of [-0.6, 0.6]) {
    const big = mesh(cyl(0.55, 0.55, 0.35, 10), 0x222222, x, 0.55, -0.45);
    big.rotation.z = Math.PI / 2;
    g.add(big);
    const small = mesh(cyl(0.33, 0.33, 0.28, 10), 0x222222, x, 0.33, 0.75);
    small.rotation.z = Math.PI / 2;
    g.add(small);
  }
  const trailer = new THREE.Group();
  trailer.name = "load";
  trailer.position.set(0, 1.1, 0.5);
  g.add(trailer);
  return g;
}

export function harvester(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(1.4, 1.1, 2.2), 0x3a9a3e, 0, 1.0, 0));
  g.add(mesh(box(1.0, 0.9, 0.9), 0x3a9a3e, 0, 1.9, -0.4));
  g.add(mesh(box(0.9, 0.6, 0.92), 0xbfe3ff, 0, 1.95, -0.4));
  g.add(mesh(box(2.2, 0.4, 0.5), 0xf0c94a, 0, 0.45, 1.4)); // header
  for (const x of [-0.75, 0.75]) {
    const w = mesh(cyl(0.5, 0.5, 0.3, 10), 0x222222, x, 0.5, -0.5);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  const load = new THREE.Group();
  load.name = "load";
  load.position.set(0, 1.6, 0.4);
  g.add(load);
  return g;
}

export function van(stripe = 0xf28c28): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(1.1, 1.0, 2.0), 0xf2f2f2, 0, 0.85, 0.1));
  g.add(mesh(box(1.1, 0.7, 0.7), 0xf2f2f2, 0, 0.7, -1.2));
  g.add(mesh(box(1.0, 0.4, 0.05), 0xbfe3ff, 0, 0.95, -1.56));
  g.add(mesh(box(1.12, 0.25, 1.4), stripe, 0, 1.0, 0.2, false));
  for (const [x, z] of [[-0.55, -1.0], [0.55, -1.0], [-0.55, 0.7], [0.55, 0.7]]) {
    const w = mesh(cyl(0.28, 0.28, 0.2, 10), 0x222222, x, 0.3, z);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  const load = new THREE.Group();
  load.name = "load";
  load.position.set(0, 1.4, 0.2);
  g.add(load);
  return g;
}

export function dam(): { root: THREE.Group; turbines: THREE.Object3D[] } {
  const root = new THREE.Group();
  root.add(mesh(box(7, 2.4, 1.6), COLORS.stone, 0, 1.2, 0));
  root.add(mesh(box(7.2, 0.3, 1.8), 0x8e8a82, 0, 2.5, 0));
  const turbines: THREE.Object3D[] = [];
  for (const x of [-2.2, 0, 2.2]) {
    root.add(mesh(box(1.0, 1.4, 0.2), 0x7fc8f0, x, 0.7, 0.85, false));
    const t = mesh(cyl(0.35, 0.35, 0.3, 6), 0xffd54f, x, 2.95, 0);
    turbines.push(t);
    root.add(t);
  }
  // power line pole
  root.add(mesh(box(0.15, 3.5, 0.15), COLORS.woodDark, 4.2, 1.75, 0.8));
  root.add(mesh(box(1.2, 0.12, 0.12), COLORS.woodDark, 4.2, 3.3, 0.8));
  return { root, turbines };
}

export function tree(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.15, 0.22, 1.0, 6), COLORS.woodDark, 0, 0.5, 0));
  const s = 0.8 + Math.random() * 0.5;
  g.add(mesh(cone(0.9 * s, 1.6 * s, 7), 0x3f9a4a, 0, 1.4 * s + 0.4, 0));
  g.add(mesh(cone(0.7 * s, 1.2 * s, 7), 0x4fb35a, 0, 2.1 * s + 0.4, 0));
  return g;
}

export function fence(len: number): THREE.Group {
  const g = new THREE.Group();
  for (let x = 0; x <= len; x += 1.2) g.add(mesh(box(0.12, 0.7, 0.12), COLORS.wood, x, 0.35, 0));
  g.add(mesh(box(len, 0.08, 0.06), COLORS.wood, len / 2, 0.5, 0));
  g.add(mesh(box(len, 0.08, 0.06), COLORS.wood, len / 2, 0.25, 0));
  return g;
}

/** Text drawn on a canvas, shown as a sprite that always faces the camera. */
export class Label {
  sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private last = "";
  constructor(width = 256, height = 96, scale = 2.2) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    this.ctx = c.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }));
    this.sprite.scale.set(scale, (scale * height) / width, 1);
    this.sprite.renderOrder = 10;
  }
  set(text: string, sub = "", bg = "rgba(40,28,20,0.85)") {
    const key = text + "|" + sub + "|" + bg;
    if (key === this.last) return;
    this.last = key;
    const { ctx } = this;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    const r = 24;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, r);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (sub) {
      ctx.font = "bold 26px Arial, sans-serif";
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(sub, w / 2, h * 0.3);
      ctx.font = "bold 40px Arial, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.fillText(text, w / 2, h * 0.68);
    } else {
      ctx.font = "bold 44px Arial, sans-serif";
      ctx.fillText(text, w / 2, h / 2 + 2);
    }
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------
// Extra scenery and life
// ---------------------------------------------------------------

/** A small bundle of dollar bills. */
export function cashMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(0.56, 0.1, 0.28), 0x5dbb63, 0, 0.05, 0, false));
  g.add(mesh(box(0.2, 0.11, 0.29), 0xe9f7e1, 0, 0.05, 0, false));
  return g;
}

export function barn(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(4.4, 2.6, 3.4), 0xc0392b, 0, 1.3, 0));
  const roofL = mesh(box(2.6, 0.18, 3.7), 0x5d4037, -1.05, 3.1, 0);
  roofL.rotation.z = 0.6;
  const roofR = mesh(box(2.6, 0.18, 3.7), 0x5d4037, 1.05, 3.1, 0);
  roofR.rotation.z = -0.6;
  g.add(roofL, roofR);
  g.add(mesh(box(1.6, 1.8, 0.1), 0xf4efe6, 0, 0.9, 1.72));
  g.add(mesh(box(1.4, 1.6, 0.12), 0x8e2a1f, 0, 0.9, 1.74));
  g.add(mesh(box(0.12, 1.9, 0.14), 0xf4efe6, 0, 0.9, 1.78));
  return g;
}

export function silo(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(cyl(1.0, 1.0, 4.2, 12), 0xdfe6e9, 0, 2.1, 0));
  g.add(mesh(sphere(1.0, 12), 0x95a5a6, 0, 4.2, 0));
  for (let y = 0.8; y < 4; y += 0.8) g.add(mesh(cyl(1.03, 1.03, 0.08, 12), 0xb2bec3, 0, y, 0, false));
  return g;
}

export function house(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(4, 2.2, 3), 0xf6e7c8, 0, 1.1, 0));
  const roof = mesh(cone(3.2, 1.6, 4), 0x2d6a4f, 0, 3.0, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.8);
  g.add(roof);
  g.add(mesh(box(0.8, 1.3, 0.1), 0x6e4524, 0, 0.65, 1.52));
  g.add(mesh(box(0.7, 0.6, 0.1), 0xbfe3ff, -1.2, 1.3, 1.52));
  g.add(mesh(box(0.7, 0.6, 0.1), 0xbfe3ff, 1.2, 1.3, 1.52));
  g.add(mesh(box(0.5, 1.2, 0.5), 0xa7a39a, 1.2, 3.1, -0.4));
  return g;
}

export function chicken(): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(sphere(0.22, 7), 0xffffff, 0, 0.3, 0);
  body.scale.set(1, 0.9, 1.25);
  g.add(body);
  g.add(mesh(cone(0.12, 0.2, 4), 0xffffff, 0, 0.42, -0.25));
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.46, 0.18);
  head.add(mesh(sphere(0.12, 6), 0xffffff, 0, 0.06, 0.04));
  head.add(mesh(cone(0.04, 0.1, 4), 0xffa000, 0, 0.05, 0.18, false).rotateX(Math.PI / 2));
  head.add(mesh(box(0.04, 0.1, 0.1), 0xe53935, 0, 0.2, 0.04, false));
  g.add(head);
  g.add(mesh(box(0.03, 0.18, 0.03), 0xffa000, -0.08, 0.09, 0, false));
  g.add(mesh(box(0.03, 0.18, 0.03), 0xffa000, 0.08, 0.09, 0, false));
  return g;
}

export function cow(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(0.9, 0.8, 1.6), 0xffffff, 0, 1.0, 0));
  g.add(mesh(box(0.92, 0.5, 0.6), 0x2d2d2d, 0, 1.15, -0.3, false));
  g.add(mesh(box(0.5, 0.4, 0.5), 0x2d2d2d, 0.2, 1.1, 0.5, false));
  for (const [x, z] of [[-0.3, -0.6], [0.3, -0.6], [-0.3, 0.6], [0.3, 0.6]]) g.add(mesh(box(0.18, 0.6, 0.18), 0xffffff, x, 0.3, z));
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 1.2, 0.9);
  head.add(mesh(box(0.5, 0.5, 0.55), 0xffffff, 0, 0, 0.1));
  head.add(mesh(box(0.42, 0.24, 0.2), 0xf3a6b5, 0, -0.12, 0.42));
  head.add(mesh(box(0.08, 0.2, 0.08), 0xe8dcc0, -0.2, 0.32, 0));
  head.add(mesh(box(0.08, 0.2, 0.08), 0xe8dcc0, 0.2, 0.32, 0));
  g.add(head);
  g.scale.setScalar(0.9);
  return g;
}

export function cloud(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + Math.random() * 0.8, 0), m);
    s.position.set(i * 1.1 - n * 0.5, Math.random() * 0.5, Math.random() * 0.8);
    s.castShadow = true;
    g.add(s);
  }
  return g;
}

export function butterfly(color: number): THREE.Group {
  const g = new THREE.Group();
  const wing = new THREE.PlaneGeometry(0.18, 0.14);
  const wm = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const l = new THREE.Group();
  const lw = new THREE.Mesh(wing, wm);
  lw.position.x = -0.09;
  lw.rotation.x = -Math.PI / 2;
  l.add(lw);
  const r = new THREE.Group();
  const rw = new THREE.Mesh(wing, wm);
  rw.position.x = 0.09;
  rw.rotation.x = -Math.PI / 2;
  r.add(rw);
  g.add(l, r);
  return g;
}

/** Arms that swing when walking. Adds two pivots to a body group. */
export function addArms(body: THREE.Object3D, color: number, y: number, x: number): [THREE.Object3D, THREE.Object3D] {
  const make = (side: number) => {
    const pivot = new THREE.Group();
    pivot.name = "arm";
    pivot.position.set(side * x, y, 0);
    const arm = mesh(box(0.16, 0.5, 0.18), color, 0, -0.22, 0);
    pivot.add(arm);
    pivot.add(mesh(sphere(0.1, 6), COLORS.skin, 0, -0.5, 0));
    body.add(pivot);
    return pivot;
  };
  return [make(-1), make(1)];
}

export function seedCrate(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(1.3, 0.7, 0.9), 0x9c6b3e, 0, 0.35, 0));
  for (const y of [0.15, 0.55]) g.add(mesh(box(1.34, 0.08, 0.94), 0x6e4524, 0, y, 0, false));
  for (let i = 0; i < 4; i++) {
    const s = mesh(sphere(0.24, 7), 0xb08a5a, -0.4 + (i % 2) * 0.5 + (i > 1 ? 0.25 : 0), 0.8 + (i > 1 ? 0.18 : 0), (i % 2) * 0.15 - 0.05);
    s.scale.set(1.1, 0.65, 0.9);
    g.add(s);
  }
  return g;
}

// ---------------------------------------------------------------
// Animal farm buildings
// ---------------------------------------------------------------

/** Hen house on stilts with a ramp. `spin` bobs while hens are laying. */
export function coop(): { root: THREE.Group; hen: THREE.Object3D } {
  const root = new THREE.Group();
  for (const [x, z] of [[-1.1, -0.9], [1.1, -0.9], [-1.1, 0.9], [1.1, 0.9]]) root.add(mesh(box(0.16, 0.7, 0.16), COLORS.woodDark, x, 0.35, z));
  root.add(mesh(box(2.6, 1.5, 2.2), 0xc0703a, 0, 1.45, 0));
  for (let y = 0.9; y < 2.2; y += 0.3) root.add(mesh(box(2.64, 0.05, 2.24), 0xa35a2b, 0, y, 0, false));
  const roofL = mesh(box(1.6, 0.14, 2.6), COLORS.roofRed, -0.65, 2.5, 0);
  roofL.rotation.z = 0.55;
  const roofR = mesh(box(1.6, 0.14, 2.6), COLORS.roofRed, 0.65, 2.5, 0);
  roofR.rotation.z = -0.55;
  root.add(roofL, roofR);
  root.add(mesh(box(0.6, 0.6, 0.08), 0x3a2414, 0, 1.2, 1.12));
  const ramp = mesh(box(0.55, 0.06, 1.3), COLORS.wood, 0, 0.45, 1.6);
  ramp.rotation.x = 0.55;
  root.add(ramp);
  const hen = chicken();
  hen.position.set(0, 0.95, 1.05);
  hen.scale.setScalar(0.9);
  root.add(hen);
  return { root, hen };
}

/** Small open cow shed with a hay rack. */
export function cowshed(): { root: THREE.Group; cow: THREE.Group } {
  const root = new THREE.Group();
  root.add(mesh(box(2.8, 0.1, 2.6), 0x8c7a5a, 0, 0.05, 0, false));
  root.add(mesh(box(2.8, 2.0, 0.2), 0xb5452f, 0, 1.0, -1.2));
  root.add(mesh(box(0.2, 2.0, 2.6), 0xb5452f, -1.3, 1.0, 0));
  root.add(mesh(box(0.2, 2.0, 2.6), 0xb5452f, 1.3, 1.0, 0));
  for (const x of [-1.3, 1.3]) root.add(mesh(box(0.22, 2.1, 0.22), COLORS.white, x, 1.05, 1.2));
  const roof = mesh(box(3.2, 0.16, 3.2), 0x5d4037, 0, 2.25, 0);
  roof.rotation.x = -0.18;
  root.add(roof);
  root.add(mesh(box(1.8, 0.5, 0.4), COLORS.wood, 0, 0.6, -0.85));
  root.add(mesh(box(1.7, 0.2, 0.34), COLORS.wheat, 0, 0.9, -0.85, false));
  const c = cow();
  c.position.set(0, 0, 0.1);
  c.rotation.y = Math.PI;
  root.add(c);
  return { root, cow: c };
}

/** White dairy with a blue roof and a churn that spins while working. */
export function creamery(): { root: THREE.Group; churn: THREE.Object3D } {
  const root = new THREE.Group();
  root.add(mesh(box(3.0, 2.0, 2.4), 0xf4f1ea, 0, 1.0, 0));
  const roof = mesh(cone(2.5, 1.2, 4), 0x2f7fd0, 0, 2.6, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.8);
  root.add(roof);
  root.add(mesh(box(0.8, 1.2, 0.1), 0x2f7fd0, 0, 0.6, 1.21));
  root.add(mesh(box(0.6, 0.5, 0.1), 0xbfe3ff, -0.95, 1.25, 1.21));
  root.add(mesh(box(0.6, 0.5, 0.1), 0xbfe3ff, 0.95, 1.25, 1.21));
  const churn = new THREE.Group();
  churn.position.set(1.0, 3.0, 0);
  churn.add(mesh(cyl(0.3, 0.35, 0.7, 8), 0xc9ced3, 0, 0, 0));
  churn.add(mesh(box(0.7, 0.08, 0.08), COLORS.woodDark, 0, 0.42, 0, false));
  root.add(churn);
  return { root, churn };
}
