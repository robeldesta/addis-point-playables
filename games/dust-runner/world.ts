import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Terrain, N, CELL, HALF } from "./terrain";
import type { Biome } from "./biomes";

// Builds everything you see for one stage: ground, far mountains, plants,
// rocks, barriers, gates and arches. Returns colliders for the game loop.

export interface Boulder { x: number; z: number; r: number; top: number }
export interface Knock { x: number; z: number; r: number; tilt: number; tiltV: number; ax: number; az: number; down: boolean; slow: number; apply: (q: THREE.Quaternion) => void }

export interface World {
  group: THREE.Group;
  terrain: Terrain;
  boulders: Boulder[];
  knocks: Knock[];
  startK: number;
  finishK: number;
  gates: number[]; // route sample index of each checkpoint gate
  dispose(): void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const checkerTex = () => canvasTex(256, 64, (g) => {
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? "#111" : "#fff"; g.fillRect(i * 16, j * 16, 16, 16); }
});
const bannerTex = (text: string, bg: string) => canvasTex(512, 64, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, 512, 64);
  g.fillStyle = "#111"; for (let i = 0; i < 8; i++) { g.fillRect(i * 16, (i % 2) * 16, 16, 16); g.fillRect(496 - i * 16, (i % 2) * 16, 16, 16); }
  g.fillStyle = "#fff"; g.font = "900 40px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 34);
});

export function buildWorld(biome: Biome, seed0 = 1): World {
  let seed = 1234567 + seed0 * 7919;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const terrain = new Terrain(biome);
  const group = new THREE.Group();
  const boulders: Boulder[] = [];
  const knocks: Knock[] = [];
  const dummy = new THREE.Object3D();
  const W = terrain.routeW;
  const cnt = terrain.count;
  const startK = 24, finishK = cnt - 30;

  // ---------------- ground ----------------
  {
    const R = N + 1;
    const pos = new Float32Array(R * R * 3);
    const col = new Float32Array(R * R * 3);
    let mn = 1e9, mx = -1e9;
    for (const v of terrain.h) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const g0 = new THREE.Color(biome.ground[0]), g1 = new THREE.Color(biome.ground[1]), crest = new THREE.Color(biome.crest);
    const rock = new THREE.Color(biome.rock), track = new THREE.Color(biome.track), rut = new THREE.Color(biome.rut);
    const bands = (biome.bandColors ?? []).map((c) => new THREE.Color(c));
    const c = new THREE.Color(), tc = new THREE.Color();
    const nrm = { x: 0, y: 1, z: 0 };
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const idx = j * R + i;
      const x = i * CELL - HALF, z = j * CELL - HALF, y = terrain.h[idx];
      pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = z;
      const n1 = Math.sin(x * 0.09 + z * 0.06) * Math.cos(z * 0.11 - x * 0.04);
      const n2 = Math.sin(x * 0.53 + z * 0.41) * 0.5 + Math.sin(x * 1.7 - z * 1.3) * 0.5;
      c.copy(g0).lerp(g1, 0.5 + 0.5 * n1);
      c.lerp(crest, clamp(((y - mn) / Math.max(1, mx - mn) - 0.45) * 1.6, 0, 0.6));
      terrain.normal(x, z, nrm);
      if (bands.length && nrm.y < 0.9) {
        const b = bands[((Math.floor((y + n1 * 0.8) / 2.6) % bands.length) + bands.length) % bands.length];
        c.lerp(b, clamp((0.9 - nrm.y) * 5, 0, 1));
      } else if (nrm.y < 0.86) c.lerp(rock, clamp((0.86 - nrm.y) * 4, 0, 0.85));
      const d = terrain.dist[idx];
      if (d < W + 4) {
        tc.copy(track);
        const rr = Math.min(Math.abs(d - 1.15), Math.abs(d - 3.4), Math.abs(d - 5.6));
        if (rr < 0.6) tc.lerp(rut, (1 - rr / 0.6) * (d < 4 ? 0.65 : 0.35));
        c.lerp(tc, clamp((W + 4 - d) / 4, 0, 0.92));
      }
      const sh = 1 + n2 * 0.04;
      col[idx * 3] = c.r * sh; col[idx * 3 + 1] = c.g * sh; col[idx * 3 + 2] = c.b * sh;
    }
    const index = new Uint32Array(N * N * 6);
    let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * R + i, b = a + 1, cc = a + R + 1, d = a + R;
      index[q++] = a; index[q++] = cc; index[q++] = b; index[q++] = a; index[q++] = d; index[q++] = cc;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    group.add(m);
    // far floor up to the horizon, at the height of the map edge
    let edge = 0;
    for (let i = 0; i <= N; i += 8) edge += terrain.h[i] + terrain.h[N * R + i] + terrain.h[i * R] + terrain.h[i * R + N];
    edge /= (N / 8 + 1) * 4;
    const outer = new THREE.Mesh(new THREE.RingGeometry(HALF - 2, 1400, 48, 1), new THREE.MeshLambertMaterial({ color: biome.ground[1] }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = edge - 1.5;
    group.add(outer);
    // distant mesas / mountains
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rnd() * 0.2;
      const r = HALF + 90 + rnd() * 260;
      const w = 30 + rnd() * 60, h = biome.farH[0] + rnd() * (biome.farH[1] - biome.farH[0]);
      const grp = new THREE.Group();
      const layers = 3;
      let y = 0;
      for (let l = 0; l < layers; l++) {
        const lh = h / layers;
        const mm = new THREE.Mesh(new THREE.CylinderGeometry(w * (1 - l * 0.14) * 0.84, w * (1 - l * 0.14), lh, 7), flat(biome.far[l % biome.far.length]));
        mm.position.y = y + lh / 2;
        y += lh;
        grp.add(mm);
      }
      grp.position.set(Math.cos(a) * r, edge - 3, Math.sin(a) * r);
      grp.rotation.y = rnd() * 6;
      grp.scale.z = 0.5 + rnd() * 0.8;
      group.add(grp);
    }
  }

  const lim = HALF - 32;
  function freeSpot(minDist: number): [number, number] | null {
    for (let t = 0; t < 30; t++) {
      const x = (rnd() * 2 - 1) * lim, z = (rnd() * 2 - 1) * lim;
      const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
      if (terrain.dist[j * (N + 1) + i] > minDist) return [x, z];
    }
    return null;
  }

  // ---------------- plants and pebbles ----------------
  {
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 0), flat(biome.bushColor), Math.max(1, biome.bush));
    const pebble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.4, 0), flat(biome.boulderColor), Math.max(1, biome.pebble));
    let nb = 0, np = 0;
    for (let i = 0; i < biome.bush; i++) {
      const p = freeSpot(W + 2); if (!p) continue;
      const s = 0.5 + rnd() * 1.1;
      dummy.position.set(p[0], terrain.height(p[0], p[1]) + 0.12 * s, p[1]);
      dummy.scale.set(s, s * 0.6, s); dummy.rotation.set(0, rnd() * 6, 0); dummy.updateMatrix();
      bush.setMatrixAt(nb++, dummy.matrix);
    }
    for (let i = 0; i < biome.pebble; i++) {
      const p = freeSpot(1.5); if (!p) continue;
      const s = 0.3 + rnd() * 0.8;
      dummy.position.set(p[0], terrain.height(p[0], p[1]), p[1]);
      dummy.scale.set(s, s * 0.6, s); dummy.rotation.set(rnd(), rnd() * 6, rnd()); dummy.updateMatrix();
      pebble.setMatrixAt(np++, dummy.matrix);
    }
    bush.count = nb; pebble.count = np;
    bush.castShadow = pebble.castShadow = true;
    group.add(bush, pebble);
  }

  // ---------------- boulders: scattered + rock gardens on the route ----------------
  {
    const spots: [number, number, number][] = [];
    for (let i = 0; i < biome.boulder; i++) {
      const p = freeSpot(W + 8); if (p) spots.push([p[0], p[1], 1.2 + rnd() * 2]);
    }
    for (const f of terrain.features) {
      if (f.kind !== "rocks") continue;
      for (let i = 0; i < 9; i++) {
        const k = Math.round((f.at + rnd() * f.len) / terrain.step);
        const s = terrain.sample(k);
        const lat = (rnd() * 2 - 1) * (W + 1);
        spots.push([s.x + s.tz * lat, s.z - s.tx * lat, 0.7 + rnd() * 0.8]);
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), flat(biome.boulderColor), Math.max(1, spots.length));
    spots.forEach(([x, z, r], i) => {
      const y = terrain.height(x, z);
      dummy.position.set(x, y + r * 0.3, z);
      dummy.scale.set(r, r * 0.75, r * (0.8 + rnd() * 0.4));
      dummy.rotation.set(rnd() * 0.5, rnd() * 6, rnd() * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      boulders.push({ x, z, r: r * 0.95, top: y + r });
    });
    mesh.count = spots.length;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------- knockable instanced things ----------------
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _o = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  function knockable(mesh: THREE.InstancedMesh, idx: number, x: number, y: number, z: number, yaw: number, scale: number, r: number, slow: number) {
    const base = new THREE.Vector3(x, y, z);
    const yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const sc = new THREE.Vector3(scale, scale, scale);
    const apply = (tq: THREE.Quaternion) => {
      _q.copy(tq).multiply(yq);
      _m.compose(base, _q, sc);
      mesh.setMatrixAt(idx, _m);
      mesh.instanceMatrix.needsUpdate = true;
    };
    apply(new THREE.Quaternion());
    knocks.push({ x, z, r, tilt: 0, tiltV: 0, ax: 1, az: 0, down: false, slow, apply });
  }
  void _o; void one;

  // cacti
  if (biome.cactus > 0) {
    const parts: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.28, 0.33, 3.2, 7); trunk.translate(0, 1.6, 0); parts.push(trunk);
    const top = new THREE.SphereGeometry(0.28, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2); top.translate(0, 3.2, 0); parts.push(top);
    for (const [sx, h, len] of [[1, 1.4, 1.1], [-1, 1.9, 0.9]] as const) {
      const arm = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 6); arm.rotateZ(Math.PI / 2); arm.translate(sx * 0.55, h, 0); parts.push(arm);
      const up = new THREE.CylinderGeometry(0.18, 0.2, len, 6); up.translate(sx * 0.85, h + len / 2, 0); parts.push(up);
      const cap = new THREE.SphereGeometry(0.18, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(sx * 0.85, h + len, 0); parts.push(cap);
    }
    const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
    const mesh = new THREE.InstancedMesh(g, flat(0x5f8a3e), biome.cactus);
    let n = 0;
    for (let i = 0; i < biome.cactus; i++) {
      const p = freeSpot(W + 3); if (!p) continue;
      knockable(mesh, n++, p[0], terrain.height(p[0], p[1]) - 0.1, p[1], rnd() * 6, 0.8 + rnd() * 0.6, 2.4, 0.93);
    }
    mesh.count = n;
    mesh.castShadow = true;
    group.add(mesh);
  }

  // red & white barriers on the outside of the sharper bends
  {
    const blockG = new THREE.BoxGeometry(2.0, 0.8, 0.35); blockG.translate(0, 0.4, 0);
    const spots: [number, number, number, number][] = []; // x, z, yaw, colour index
    const span = 16;
    let last = -999;
    for (let k = span + 40; k < cnt - span - 40; k += 4) {
      const a = terrain.sample(k - span), b = terrain.sample(k + span);
      let d = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz);
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const curv = d / (2 * span * terrain.step);
      if (Math.abs(curv) < 0.018 || k - last < 4) continue;
      last = k;
      const s = terrain.sample(k);
      const side = curv > 0 ? -1 : 1; // outside of the bend
      const off = W + 4.5;
      const x = s.x + s.tz * side * off, z = s.z - s.tx * side * off;
      spots.push([x, z, Math.atan2(s.tx, s.tz) + Math.PI / 2, Math.floor(k / 4) % 2]);
    }
    for (const kk of [startK, finishK]) for (let i = -6; i <= 6; i++) for (const side of [1, -1]) {
      const s = terrain.sample(kk + i * 4);
      const x = s.x + s.tz * side * (W + 1.5), z = s.z - s.tx * side * (W + 1.5);
      spots.push([x, z, Math.atan2(s.tx, s.tz) + Math.PI / 2, (i + 99) % 2]);
    }
    const red = new THREE.InstancedMesh(blockG, flat(0xd32f2f), Math.max(1, spots.length));
    const white = new THREE.InstancedMesh(blockG, flat(0xf5f5f5), Math.max(1, spots.length));
    let nr = 0, nw = 0;
    for (const [x, z, yaw, c] of spots) {
      const mesh = c ? red : white;
      knockable(mesh, c ? nr++ : nw++, x, terrain.height(x, z) - 0.05, z, yaw, 1, 1.9, 0.95);
    }
    red.count = nr; white.count = nw;
    red.castShadow = white.castShadow = true;
    group.add(red, white);
  }

  // marker flags every ~30 m, both sides, red/white alternating
  {
    const poleG = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5); poleG.translate(0, 1.1, 0);
    const flagG = new THREE.PlaneGeometry(0.6, 0.4); flagG.translate(0.3, 1.95, 0);
    const g = mergeGeometries([poleG.toNonIndexed(), flagG.toNonIndexed()])!;
    const every = Math.round(30 / terrain.step);
    const n = (Math.ceil(cnt / every) + 2) * 2;
    const red = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xe53935, side: THREE.DoubleSide }), n);
    const white = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), n);
    let nr = 0, nw = 0;
    for (let k = startK + every; k < finishK - every / 2; k += every) {
      const s = terrain.sample(k);
      for (const side of [1, -1]) {
        const x = s.x + s.tz * side * (W + 2.8), z = s.z - s.tx * side * (W + 2.8);
        const r = side > 0;
        knockable(r ? red : white, r ? nr++ : nw++, x, terrain.height(x, z), z, Math.atan2(s.tx, s.tz) + Math.PI / 2, 1, 1.6, 0.98);
      }
    }
    red.count = nr; white.count = nw;
    group.add(red, white);
  }

  // chevron boards before each jump
  {
    const chev = canvasTex(128, 128, (g) => {
      g.fillStyle = "#ffb300"; g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#111"; g.beginPath(); g.moveTo(64, 14); g.lineTo(114, 80); g.lineTo(88, 80); g.lineTo(64, 48); g.lineTo(40, 80); g.lineTo(14, 80); g.closePath(); g.fill();
      g.fillRect(14, 96, 100, 14);
    });
    const pm = flat(0x1d2430);
    const boardM = new THREE.MeshLambertMaterial({ map: chev });
    for (const f of terrain.features) {
      if (f.kind !== "gap" && f.kind !== "kicker" && f.kind !== "table" && f.kind !== "crest") continue;
      const ss = terrain.sample(Math.round((f.at - 14) / terrain.step));
      for (const side of [1, -1]) {
        const x = ss.x + ss.tz * side * (W + 4), z = ss.z - ss.tx * side * (W + 4);
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 5), pm); pole.position.y = 1; g.add(pole);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), boardM); b.position.y = 2.2; g.add(b);
        const back = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), pm); back.position.y = 2.2; back.rotation.y = Math.PI; g.add(back);
        g.position.set(x, terrain.height(x, z), z);
        g.rotation.y = Math.atan2(ss.tx, ss.tz) + Math.PI;
        group.add(g);
        const yq = g.quaternion.clone();
        knocks.push({ x, z, r: 1.9, tilt: 0, tiltV: 0, ax: 1, az: 0, down: false, slow: 0.97, apply: (tq) => { g.quaternion.copy(tq).multiply(yq); } });
      }
    }
  }

  // ---------------- arches: start, checkpoints, finish ----------------
  const pm = flat(0x1d2430);
  const check = new THREE.MeshBasicMaterial({ map: checkerTex() });
  function arch(k: number, label: string, color: string, height = 6) {
    const s = terrain.sample(k);
    const span = W + 2.5;
    const a = new THREE.Group();
    const y0 = Math.min(terrain.height(s.x + s.tz * span, s.z - s.tx * span), terrain.height(s.x - s.tz * span, s.z + s.tx * span));
    for (const side of [1, -1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, height + 2, 0.7), pm);
      p.position.set(side * span, (height + 2) / 2 - 2, 0);
      p.castShadow = true;
      a.add(p);
      boulders.push({ x: s.x + s.tz * side * span, z: s.z - s.tx * side * span, r: 0.45, top: y0 + height + 1 });
    }
    const bm = new THREE.MeshBasicMaterial({ map: bannerTex(label, color) });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.7, 1.3, 0.3), [pm, pm, check, check, bm, bm]);
    banner.position.y = height;
    banner.castShadow = true;
    a.add(banner);
    a.position.set(s.x, y0, s.z);
    a.rotation.y = Math.atan2(s.tx, s.tz);
    group.add(a);
  }
  arch(startK, "START", "#d32f2f");
  arch(finishK, "FINISH", "#d32f2f", 7);
  const gates: number[] = [];
  const gateEvery = Math.round(230 / terrain.step);
  for (let k = startK + gateEvery; k < finishK - gateEvery * 0.6; k += gateEvery) {
    gates.push(k);
    arch(k, `CHECKPOINT ${gates.length}`, "#1e3a5f", 5);
  }
  // checkered flags at the finish
  {
    const poleG = new THREE.CylinderGeometry(0.06, 0.06, 3.6, 5); poleG.translate(0, 1.8, 0);
    const pole = new THREE.InstancedMesh(poleG, pm, 16);
    const flagG = new THREE.PlaneGeometry(1.1, 0.7); flagG.translate(0.55, 3.2, 0);
    const flag = new THREE.InstancedMesh(flagG, new THREE.MeshBasicMaterial({ map: checkerTex(), side: THREE.DoubleSide }), 16);
    let n = 0;
    for (const kk of [startK, finishK]) for (let i = -3; i <= 4; i += 2) for (const side of [1, -1]) {
      if (n >= 16) break;
      const s = terrain.sample(kk + i * 6);
      const x = s.x + s.tz * side * (W + 3.6), z = s.z - s.tx * side * (W + 3.6);
      const yaw = Math.atan2(s.tx, s.tz) + Math.PI / 2;
      const y = terrain.height(x, z);
      const idx = n++;
      knockable(pole, idx, x, y, z, yaw, 1, 1.6, 0.98);
      const kn = knocks[knocks.length - 1];
      const prev = kn.apply;
      const base = new THREE.Vector3(x, y, z), yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), q = new THREE.Quaternion(), m4 = new THREE.Matrix4();
      kn.apply = (tq) => { prev(tq); q.copy(tq).multiply(yq); m4.compose(base, q, new THREE.Vector3(1, 1, 1)); flag.setMatrixAt(idx, m4); flag.instanceMatrix.needsUpdate = true; };
      kn.apply(new THREE.Quaternion());
    }
    pole.count = flag.count = n;
    group.add(pole, flag);
  }

  return {
    group, terrain, boulders, knocks, startK, finishK, gates,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mt of mats) { const mm = mt as THREE.MeshBasicMaterial; mm.map?.dispose(); mm.dispose(); }
      });
    },
  };
}
