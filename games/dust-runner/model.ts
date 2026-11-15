import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { SPEC, type Truck } from "./truck";
import hiUrl from "./truck-hi.glb?url";
import loUrl from "./truck-lo.glb?url";

// Body model: "Toyota Tacoma Baja Truck" by DRIVER-FIRE (sketchfab.com/DRIVER-FIRE), CC-BY-4.0,
// slimmed for phones, maker's grille lettering and original wheels removed, repainted in our livery.
const bodies: Record<string, Promise<THREE.Object3D>> = {};
function loadBody(url: string) {
  return (bodies[url] ??= new Promise((res, rej) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, (g) => {
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.computeVertexNormals(); });
      res(g.scene);
    }, undefined, rej);
  }));
}
const PAINT = new Set(["color_6383466"]);
const LIGHTS = new Set(["color_16768282"]);
function numberTex(num: string, accent: number) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 200;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.beginPath(); g.roundRect(6, 6, 244, 188, 26); g.fill();
  g.lineWidth = 10; g.strokeStyle = "#" + accent.toString(16).padStart(6, "0"); g.stroke();
  g.fillStyle = "#111"; g.font = "900 150px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(num, 128, 108);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Trophy truck built in code, our own design: fibreglass body over a tube
// chassis with the nose cut open, full roll cage, coilover + bypass shocks
// you can see working, knobby tyres on beadlock wheels, light bars, a spare
// in the bed and whip antennas.

export interface Look { livery: number; accent?: number; trim?: number; number?: string }

const std = (color: number, roughness = 0.6, metalness = 0.05, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** side livery: base colour, white swoosh, black slashes, number panel */
function liveryTex(look: Look, mirror: boolean): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 320;
  const g = c.getContext("2d")!;
  if (mirror) { g.translate(1024, 0); g.scale(-1, 1); }
  const base = hex(look.livery), acc = hex(look.accent ?? 0xffffff);
  // front of the truck is on the right (u grows towards the nose)
  const grd = g.createLinearGradient(0, 0, 0, 320);
  grd.addColorStop(0, base); grd.addColorStop(1, "#000000");
  g.fillStyle = base; g.fillRect(0, 0, 1024, 320);
  g.globalAlpha = 0.35; g.fillStyle = grd; g.fillRect(0, 160, 1024, 160); g.globalAlpha = 1;
  // white swoosh from the bed sweeping up over the door
  g.fillStyle = acc;
  g.beginPath(); g.moveTo(0, 150); g.bezierCurveTo(300, 120, 520, 40, 760, 0); g.lineTo(840, 0); g.bezierCurveTo(600, 70, 360, 170, 0, 205); g.closePath(); g.fill();
  // black slashes
  g.fillStyle = "#111318";
  for (let i = 0; i < 3; i++) {
    const x = 560 + i * 46;
    g.beginPath(); g.moveTo(x, 320); g.lineTo(x + 26, 320); g.lineTo(x + 150, 90); g.lineTo(x + 124, 90); g.closePath(); g.fill();
  }
  // lower rocker
  g.fillStyle = "#111318"; g.fillRect(0, 285, 1024, 35);
  g.fillStyle = acc; g.fillRect(0, 280, 1024, 5);
  // number panel on the door
  if (look.number) {
    g.save();
    if (mirror) { g.translate(1024, 0); g.scale(-1, 1); }
    const nx = mirror ? 1024 - 470 : 470;
    g.fillStyle = "#ffffff"; g.beginPath(); g.roundRect(nx - 85, 140, 170, 110, 14); g.fill();
    g.fillStyle = "#111318"; g.font = "900 96px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(look.number, nx, 198);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** tread texture for the tyre's rolling face */
function treadTex(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#15161a"; g.fillRect(0, 0, 128, 512);
  g.fillStyle = "#2c2e33";
  for (let r = 0; r < 24; r++) {
    const y = r * (512 / 24), off = r % 2 ? 0 : 20;
    for (const [x, w] of [[4 + off, 34], [48 + off * 0.5, 30], [86 - off * 0.3, 36]] as const) g.fillRect(x, y + 2, w, 512 / 24 - 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function sidewallTex(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1b1f"; g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  g.fillStyle = "#e9e4da"; g.font = "900 22px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  const word = "DUST RUNNER  ·  ALL TERRAIN  ·  ";
  for (let i = 0; i < word.length; i++) {
    g.save(); g.rotate((i / word.length) * Math.PI * 2); g.fillText(word[i], 0, -104); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shared: { tread: THREE.Texture; side: THREE.Texture } | null = null;

function tubeMesh(pts: THREE.Vector3[], r: number, m: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.01);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(2, pts.length * 4), r, 6, false), m);
  mesh.castShadow = true;
  return mesh;
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** a coil spring along +z, unit length (scaled to fit the shock) */
function springGeo(r: number, turns: number, wire: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= turns * 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(V(Math.cos(a) * r, Math.sin(a) * r, i / (turns * 12)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 12, wire, 4, false);
}

function makeWheel(look: Look, side: number) {
  shared ??= { tread: treadTex(), side: sidewallTex() };
  const g = new THREE.Group();
  const R = SPEC.radius, W = 0.46;
  // tyre: lathe profile with rounded shoulders
  const prof: THREE.Vector2[] = [];
  const rimR = R * 0.6;
  prof.push(new THREE.Vector2(rimR, -W / 2));
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    prof.push(new THREE.Vector2(R - 0.07 + Math.cos(a) * 0.07 + (Math.abs(a) < 1.2 ? 0 : 0), Math.sin(a) * (W / 2)));
  }
  prof.push(new THREE.Vector2(rimR, W / 2));
  const lathe = new THREE.LatheGeometry(prof, 28);
  lathe.rotateZ(Math.PI / 2);
  const tread = shared.tread.clone(); tread.needsUpdate = true; tread.repeat.set(1, 2);
  const tyre = new THREE.Mesh(lathe, std(0xffffff, 0.95, 0, { map: tread }));
  tyre.castShadow = true;
  g.add(tyre);
  // chunky shoulder lugs so the silhouette reads as knobby
  const lugG = new THREE.BoxGeometry(0.1, 0.06, 0.13);
  const lugs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    for (const sx of [-1, 1]) {
      const l = lugG.clone();
      l.rotateX(-a);
      l.translate(sx * (W / 2 - 0.05) + (i % 2 ? 0.02 : -0.02) * sx, Math.cos(a) * (R - 0.01), Math.sin(a) * (R - 0.01));
      lugs.push(l);
    }
  }
  const lugM = new THREE.Mesh(mergeGeometries(lugs)!, std(0x1c1d21, 0.95));
  lugM.castShadow = true;
  g.add(lugM);
  // sidewall lettering
  const sideM = std(0xffffff, 0.9, 0, { map: shared.side, transparent: false });
  for (const sx of [1, -1]) {
    const d = new THREE.Mesh(new THREE.RingGeometry(rimR, R - 0.05, 28), sideM);
    d.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    d.position.x = sx * (W / 2 + 0.002);
    // map the square texture onto the ring
    const uv = d.geometry.attributes.uv as THREE.BufferAttribute, p = d.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * R), 0.5 + p.getY(i) / (2 * R));
    g.add(d);
  }
  // wheel: dished rim, beadlock ring with bolts, hub
  const rimM = std(0x16181c, 0.35, 0.7);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, W - 0.04, 20, 1, true), rimM);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(rimR, 20), rimM);
  face.rotation.y = side * Math.PI / 2; face.position.x = side * 0.06;
  g.add(face);
  const beadM = std(look.trim ?? look.accent ?? 0x1e5bd8, 0.35, 0.6);
  const bead = new THREE.Mesh(new THREE.TorusGeometry(rimR + 0.01, 0.035, 6, 24), beadM);
  bead.rotation.y = Math.PI / 2; bead.position.x = side * (W / 2 - 0.005);
  g.add(bead);
  const boltG: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const b = new THREE.SphereGeometry(0.014, 4, 3);
    b.translate(side * (W / 2 + 0.03), Math.cos(a) * (rimR + 0.01), Math.sin(a) * (rimR + 0.01));
    boltG.push(b);
  }
  g.add(new THREE.Mesh(mergeGeometries(boltG)!, std(0xd8dde4, 0.3, 0.9)));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 8), std(0x9aa3ad, 0.3, 0.9));
  hub.rotation.z = Math.PI / 2; hub.position.x = side * 0.1;
  g.add(hub);
  return g;
}

export class TruckView {
  root = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Group[] = [];
  spinners: THREE.Group[] = [];
  arms: { upper: THREE.Mesh; lower: THREE.Mesh; shock: THREE.Group; spring: THREE.Mesh }[] = [];
  brakeLights: THREE.MeshStandardMaterial;
  private whips: THREE.Group[] = [];
  private whipV = 0;
  private whipA = 0;

  constructor(lookIn: Look | number = 0xd32f2f, lod: "hi" | "lo" = "hi") {
    const look: Look = typeof lookIn === "number" ? { livery: lookIn } : lookIn;
    const paint = std(look.livery, 0.32, 0.25);
    const dark = std(0x15171b, 0.55, 0.2);
    const carbon = std(0x22252b, 0.4, 0.3);
    const chrome = std(0xc9d0d8, 0.18, 0.95);
    const cage = std(0x3a4350, 0.35, 0.75);
    const glass = std(0x0e1620, 0.05, 0.6, { transparent: true, opacity: 0.55 });
    const accent = std(look.accent ?? 0xffffff, 0.4, 0.1);
    this.brakeLights = std(0x550000, 0.4, 0, { emissive: 0x000000 });
    const lightM = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c4, emissiveIntensity: 1.4, roughness: 0.2 });
    const add = (m: THREE.Object3D) => { m.castShadow = true; this.body.add(m); return m; };
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; return add(b);
    };

    // ---- fibreglass body: cab, bed sides and a short hood; the nose is cut open ----
    const side = new THREE.Shape();
    side.moveTo(1.15, 0.0);
    side.lineTo(1.1, 0.62);   // front edge of the cut-open nose
    side.lineTo(0.55, 0.74);
    side.lineTo(0.02, 1.34);  // windscreen
    side.lineTo(-1.1, 1.36);  // roof
    side.lineTo(-1.32, 0.76);
    side.lineTo(-2.5, 0.7);   // bed rail
    side.lineTo(-2.66, 0.25);
    side.lineTo(-2.56, 0.0);
    side.closePath();
    const shell = new THREE.ExtrudeGeometry(side, { depth: 1.84, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
    shell.translate(0, 0, -0.92);
    shell.rotateY(-Math.PI / 2);
    // livery UVs: u along the truck, v up the side
    {
      const p = shell.attributes.position as THREE.BufferAttribute, uv = shell.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getZ(i) + 2.7) / 3.9, p.getY(i) / 1.4);
    }
    const livL = std(0xffffff, 0.32, 0.25, { map: liveryTex(look, false) });
    const livR = std(0xffffff, 0.32, 0.25, { map: liveryTex(look, true) });
    // the two side caps get their own livery (the far one mirrored so the number reads right)
    const g0 = shell.groups[0], g1 = shell.groups[1];
    shell.clearGroups();
    shell.addGroup(g0.start, g0.count / 2, 0);
    shell.addGroup(g0.start + g0.count / 2, g0.count / 2, 1);
    shell.addGroup(g1.start, g1.count, 2);
    const shellM = new THREE.Mesh(shell, [livL, livR, paint]);
    shellM.receiveShadow = true;
    add(shellM);
    // windows (tinted, you can see the cage and driver through them)
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.74), glass);
    ws.position.set(0, 1.05, 0.29); ws.rotation.x = -(Math.PI / 2 - Math.atan2(0.6, 0.53)); add(ws);
    for (const x of [0.97, -0.97]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.44), glass);
      sw.position.set(x, 1.02, -0.47); sw.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2; add(sw);
    }
    // driver: helmet and shoulders
    box(0.5, 0.35, 0.35, std(0x222428), 0.4, 0.82, -0.45);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), std(look.accent ?? 0xffffff, 0.25, 0.3));
    helmet.position.set(0.4, 1.12, -0.42); add(helmet);
    // big flared fenders
    for (const [z, len] of [[1.72, 1.5], [-1.62, 1.55]] as const) for (const x of [1, -1]) {
      const fs = new THREE.Shape();
      fs.moveTo(-len / 2, 0); fs.quadraticCurveTo(-len / 2 + 0.1, 0.42, 0, 0.46); fs.quadraticCurveTo(len / 2 - 0.1, 0.42, len / 2, 0);
      fs.lineTo(len / 2 - 0.06, 0); fs.quadraticCurveTo(len / 2 - 0.14, 0.34, 0, 0.38); fs.quadraticCurveTo(-len / 2 + 0.14, 0.34, -len / 2 + 0.06, 0); fs.closePath();
      const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.46, bevelEnabled: false });
      fg.rotateY(Math.PI / 2);
      const f = new THREE.Mesh(fg, z > 0 ? carbon : paint);
      f.position.set(x > 0 ? 0.9 : -1.36, 0.36, z);
      add(f);
    }
    // bed floor, tailgate, rear bumper
    box(1.7, 0.06, 1.2, carbon, 0, 0.42, -1.95);
    box(1.84, 0.4, 0.08, paint, 0, 0.45, -2.62);
    box(1.9, 0.14, 0.18, dark, 0, 0.08, -2.72);
    for (const x of [-0.72, 0.72]) box(0.3, 0.1, 0.04, this.brakeLights, x, 0.55, -2.67);

    // ---- tube chassis showing through the open nose ----
    const tubes: [THREE.Vector3[], number][] = [];
    for (const x of [-0.62, 0.62]) {
      tubes.push([[V(x, 0.0, 1.1), V(x, 0.05, 2.1), V(x * 0.9, 0.12, 2.6)], 0.045]);         // lower frame rails
      tubes.push([[V(x, 0.62, 1.1), V(x * 0.9, 0.6, 1.9), V(x * 0.8, 0.3, 2.6)], 0.04]);     // upper rails
      tubes.push([[V(x, 0.05, 1.7), V(x, 0.62, 1.55)], 0.035]);                               // uprights
      tubes.push([[V(x, 0.05, 2.3), V(x * 0.95, 0.5, 2.05)], 0.035]);
    }
    tubes.push([[V(-0.62, 0.62, 1.12), V(0.62, 0.62, 1.12)], 0.04]);
    tubes.push([[V(-0.75, 0.3, 2.6), V(0.75, 0.3, 2.6)], 0.04]);
    // front bumper hoop
    tubes.push([[V(-0.95, 0.05, 2.55), V(-0.9, 0.55, 2.62), V(0, 0.62, 2.7), V(0.9, 0.55, 2.62), V(0.95, 0.05, 2.55)], 0.045]);
    // ---- roll cage: A pillars, roof hoop, B pillars, X brace, bed cage to the rear ----
    for (const x of [-0.8, 0.8]) {
      tubes.push([[V(x, 0.6, 0.62), V(x * 0.98, 1.3, 0.0), V(x, 1.32, -1.05), V(x, 0.7, -1.3)], 0.045]);
      tubes.push([[V(x, 1.3, -1.0), V(x * 0.85, 0.85, -2.1), V(x * 0.85, 0.7, -2.55)], 0.04]);
      tubes.push([[V(x, 0.82, -1.3), V(x * 0.85, 0.82, -2.5)], 0.035]);
    }
    tubes.push([[V(-0.8, 1.31, -0.05), V(0.8, 1.31, -0.05)], 0.04]);
    tubes.push([[V(-0.8, 1.32, -1.0), V(0.8, 1.32, -1.0)], 0.045]);
    tubes.push([[V(-0.8, 1.3, -1.0), V(0.8, 0.75, -1.3)], 0.035]);
    tubes.push([[V(0.8, 1.3, -1.0), V(-0.8, 0.75, -1.3)], 0.035]);
    tubes.push([[V(-0.72, 0.85, -2.1), V(0.72, 0.85, -2.1)], 0.035]);
    for (const [pts, r] of tubes) add(tubeMesh(pts, r, cage));
    // engine: block, headers, intake
    box(0.62, 0.42, 0.75, std(0x30343a, 0.45, 0.6), 0, 0.32, 1.5);
    box(0.5, 0.12, 0.5, std(0xb02a2a, 0.4, 0.3), 0, 0.6, 1.5);
    for (const x of [-0.36, 0.36]) for (let i = 0; i < 3; i++)
      add(tubeMesh([V(x, 0.36, 1.25 + i * 0.2), V(x * 1.4, 0.2, 1.3 + i * 0.2), V(x * 1.5, -0.02, 0.6)], 0.035, std(0x9a7a5a, 0.35, 0.8)));
    // radiator behind the bumper
    box(1.0, 0.45, 0.1, std(0x5a6068, 0.5, 0.6), 0, 0.32, 2.35);
    // ---- lights ----
    box(1.7, 0.16, 0.16, dark, 0, 1.47, -0.15);               // roof bar
    for (let i = 0; i < 12; i++) box(0.12, 0.1, 0.03, lightM, -0.77 + i * 0.14, 1.47, -0.06);
    box(1.3, 0.15, 0.12, dark, 0, 0.42, 2.66);                 // bumper bars, two rows
    box(1.3, 0.15, 0.12, dark, 0, 0.24, 2.66);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 9; i++) box(0.12, 0.1, 0.03, lightM, -0.56 + i * 0.14, r ? 0.24 : 0.42, 2.73);
    for (const x of [-0.85, 0.85]) {                           // big round pods
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.12, 12), dark);
      pod.rotation.x = Math.PI / 2; pod.position.set(x, 0.42, 2.66); add(pod);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), lightM);
      lens.position.set(x, 0.42, 2.73); add(lens);
    }
    // skid plate
    box(1.4, 0.06, 1.0, std(0x6a7078, 0.4, 0.7), 0, -0.05, 2.25, 0.25);
    // ---- spare tyre standing in the bed, exhaust, fuel cell, whips ----
    const spare = makeWheel(look, 1);
    spare.rotation.set(0.35, Math.PI / 2, 0);
    spare.position.set(0, 0.88, -1.95);
    this.body.add(spare);
    add(tubeMesh([V(0.55, 0.5, -1.4), V(0.6, 1.0, -1.4), V(0.6, 1.2, -1.5)], 0.06, std(0xb08850, 0.3, 0.9)));
    box(0.7, 0.3, 0.4, std(0x202226, 0.6, 0.2), -0.45, 0.6, -1.5);
    for (const x of [-0.7, 0.7]) {
      const w = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 1.6, 4), std(0x111111));
      rod.position.y = 0.8; w.add(rod);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), std(look.accent ?? 0xff7a00, 0.6, 0, { side: THREE.DoubleSide, emissive: 0x331100 }));
      flag.position.set(0, 1.5, -0.11); flag.rotation.y = Math.PI / 2; w.add(flag);
      w.position.set(x, 1.36, -1.08);
      this.whips.push(w);
      this.body.add(w);
    }
    // mirrors
    for (const x of [-1, 1]) box(0.06, 0.12, 0.18, dark, x * 1.02, 1.0, 0.25);

    // body origin sits a little below the centre of mass
    for (const c of this.body.children) c.position.y -= 0.3;
    this.root.add(this.body);
    loadBody(lod === "hi" ? hiUrl : loUrl).then((scene) => this.useModel(scene, look)).catch(() => { /* keep the built-in body */ });

    // ---- wheels and suspension ----
    const armM = std(0x9aa4b0, 0.3, 0.85);
    const shockBodyM = std(0xd6dbe2, 0.2, 0.95);
    const springM = std(look.trim ?? look.accent ?? 0x1e5bd8, 0.35, 0.5);
    const springG = springGeo(0.095, 7, 0.016);
    for (let i = 0; i < 4; i++) {
      const sideX = i % 2 === 0 ? 1 : -1;
      const wheel = new THREE.Group();
      const spin = makeWheel(look, sideX);
      wheel.add(spin);
      this.wheels.push(wheel);
      this.spinners.push(spin);
      this.root.add(wheel);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), armM);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 1), armM);
      for (const m of [upper, lower]) {
        if (m.geometry.type === "CylinderGeometry") { m.geometry.translate(0, 0.5, 0); m.geometry.rotateX(Math.PI / 2); }
        else m.geometry.translate(0, 0, 0.5);
        m.castShadow = true;
        this.root.add(m);
      }
      // coilover: fixed shock body at the top, polished shaft, coil spring stretched over it
      const shock = new THREE.Group();
      const bodyG = new THREE.CylinderGeometry(0.055, 0.055, 0.42, 10); bodyG.translate(0, 0.21, 0); bodyG.rotateX(Math.PI / 2);
      shock.add(new THREE.Mesh(bodyG, shockBodyM));
      const res = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 8), shockBodyM);
      res.rotation.x = Math.PI / 2; res.position.set(0.08, 0, 0.16); shock.add(res);
      const spring = new THREE.Mesh(springG, springM);
      spring.castShadow = true;
      this.root.add(shock, spring);
      this.arms.push({ upper, lower, shock, spring });
      shock.traverse((o) => { o.castShadow = true; });
      // the shock shaft
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 6), std(0xeef2f6, 0.1, 1));
      shaft.geometry.translate(0, 0.5, 0); shaft.geometry.rotateX(Math.PI / 2);
      shaft.name = "shaft";
      this.root.add(shaft);
      (this.arms[i] as any).shaft = shaft;
    }
  }

  /** swap the built-in body for the detailed model, repainted in this truck's livery */
  private useModel(scene: THREE.Object3D, look: Look) {
    for (const c of this.body.children) c.visible = false;
    for (const w of this.whips) w.visible = true;
    const m = scene.clone(true);
    m.position.y = -0.6;
    const paint = std(look.livery, 0.3, 0.3);
    const mats = new Map<string, THREE.Material>();
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      let mat = mats.get(src.name);
      if (!mat) {
        if (PAINT.has(src.name)) mat = paint;
        else if (LIGHTS.has(src.name)) mat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 1.2, roughness: 0.3 });
        else {
          const sm = src.clone();
          sm.roughness = src.transparent ? 0.05 : 0.45; sm.metalness = src.transparent ? 0.6 : 0.35;
          mat = sm;
        }
        mats.set(src.name, mat);
      }
      mesh.material = mat;
      mesh.castShadow = !(mat as THREE.Material).transparent;
    });
    // our own grille where the maker's one was cut out
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.42, 0.14), std(0x16181c, 0.5, 0.4));
    grille.position.set(0.02, 0.64, 2.3); m.add(grille);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.05, 0.02), std(look.accent ?? 0xffffff, 0.4, 0.2));
    bar.position.set(0.02, 0.64, 2.38); m.add(bar);
    this.body.add(m);
    // race numbers on both doors, stuck to wherever the door surface is
    m.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const numMat = new THREE.MeshStandardMaterial({ map: numberTex(look.number ?? "11", look.accent ?? 0xffffff), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    for (const sx of [1, -1]) {
      const from = new THREE.Vector3(sx * 3, 0.66, -0.05).applyMatrix4(m.matrixWorld);
      ray.set(from, new THREE.Vector3(-sx, 0, 0).transformDirection(m.matrixWorld));
      const hit = ray.intersectObject(m, true).find((h) => h.object !== grille && (h.object as THREE.Mesh).material === paint);
      const p = hit ? hit.point.applyMatrix4(inv) : new THREE.Vector3(sx * 1.05, 0.66, -0.05);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), numMat);
      plate.position.copy(p).add(new THREE.Vector3(sx * 0.012, 0, 0));
      plate.rotation.y = sx * Math.PI / 2;
      m.add(plate);
    }
  }

  private _m = new THREE.Vector3();
  private _c = new THREE.Vector3();
  private _u = new THREE.Vector3();
  private _t = new THREE.Vector3();
  private _prevVel = new THREE.Vector3();

  update(tr: Truck, braking: boolean) {
    this.body.position.copy(tr.pos);
    this.body.quaternion.copy(tr.q);
    const up = this._u.set(0, 1, 0).applyQuaternion(tr.q);
    for (let i = 0; i < 4; i++) {
      const w = tr.wheels[i];
      const view = this.wheels[i];
      const m = this._m.copy(w.mount).applyQuaternion(tr.q).add(tr.pos);
      const c = this._c.copy(m).addScaledVector(up, -w.length);
      const out = this._t.set(w.side * 0.08, 0, 0).applyQuaternion(tr.q);
      c.add(out);
      view.position.copy(c);
      view.quaternion.copy(tr.q);
      if (w.front) view.rotateY(-tr.steer);
      this.spinners[i].rotation.x = w.spin;
      const a = this.arms[i] as typeof this.arms[number] & { shaft: THREE.Mesh };
      const inb = (x: number, y: number, dz = 0) => this._t.set(x, y, w.mount.z + dz).applyQuaternion(tr.q).add(tr.pos);
      const hubIn = c.clone().addScaledVector(this._t.set(-w.side * 0.22, 0, 0).applyQuaternion(tr.q), 1);
      // lower arm (wide plate), upper link
      const p1 = inb(w.side * 0.3, -0.33).clone();
      a.lower.position.copy(p1);
      a.lower.scale.set(1, 1, p1.distanceTo(hubIn));
      a.lower.lookAt(hubIn);
      const p2 = inb(w.side * 0.38, 0.08).clone();
      const hubUp = hubIn.clone().addScaledVector(up, 0.24);
      a.upper.position.copy(p2);
      a.upper.scale.set(1, 1, p2.distanceTo(hubUp));
      a.upper.lookAt(hubUp);
      // coilover from the cage down to the lower arm, compressing as the wheel rises
      const top = inb(w.side * 0.6, 0.62, w.front ? -0.1 : 0.12).clone();
      const bot = hubIn.clone().addScaledVector(up, 0.05);
      const len = top.distanceTo(bot);
      a.shock.position.copy(top); a.shock.lookAt(bot);
      a.spring.position.copy(top); a.spring.lookAt(bot);
      a.spring.scale.set(1, 1, len * 0.85);
      a.shaft.position.copy(top); a.shaft.lookAt(bot);
      a.shaft.scale.set(1, 1, len);
    }
    // whip antennas sway with the truck's motion
    const acc = this._t.subVectors(tr.vel, this._prevVel).dot(this._m.set(0, 0, 1).applyQuaternion(tr.q));
    this._prevVel.copy(tr.vel);
    this.whipV += (-this.whipA * 60 - this.whipV * 4 - acc * 4) * (1 / 60);
    this.whipA = Math.max(-0.5, Math.min(0.5, this.whipA + this.whipV * (1 / 60)));
    for (const wp of this.whips) wp.rotation.x = this.whipA;
    this.brakeLights.emissive.setHex(braking ? 0xff2200 : 0x000000);
  }
}
