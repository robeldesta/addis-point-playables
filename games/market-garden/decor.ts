import * as THREE from "three";
import * as M from "./models";

// Scenery and ambient life: everything that makes the farm feel alive
// but doesn't affect the rules. setupDecor returns a per-frame updater.

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Areas kept clear of grass, flowers and rocks (fields, paths, buildings). */
const CLEAR: [number, number, number, number][] = [
  [1, 7, -13, 1.6], // fields
  [-1.8, 0.6, -15, 10], // main path
  [-11, 11, 7, 9.4], // road
  [-9.6, -2.6, 2.4, 8], // stall area
  [-7, -1, -14, -1], // windmill and bakery
  [-11, -7, -3, 1], // van garage
  [7, 10.5, -12, 0], // tractor and harvester garages
  [-4, 4, -17, -13.5], // dam
];
const isClear = (x: number, z: number) => CLEAR.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);

export interface Decor {
  update: (dt: number, t: number, player: THREE.Vector3, moving: boolean) => void;
  floatText: (text: string, at: THREE.Vector3, color?: string) => void;
  burst: (at: THREE.Vector3, color: number, n?: number) => void;
}

export function setupDecor(scene: THREE.Scene): Decor {
  // ---- sky gradient ----
  const sky = document.createElement("canvas");
  sky.width = 4;
  sky.height = 256;
  const sg = sky.getContext("2d")!;
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#5fb8f0");
  grad.addColorStop(1, "#cdeefc");
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xbfe6f7, 34, 70);

  // ---- ground with soft colour variation ----
  const gg = new THREE.PlaneGeometry(160, 160, 80, 80);
  const colors: number[] = [];
  const c = new THREE.Color();
  const pos = gg.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const n = Math.sin(x * 0.21) * Math.cos(y * 0.17) * 0.5 + Math.sin(x * 0.07 + y * 0.11) * 0.5;
    c.setHSL(0.27 + n * 0.02, 0.6, 0.4 + n * 0.05 + rand(-0.015, 0.015));
    colors.push(c.r, c.g, c.b);
  }
  gg.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- paths with rounded edges ----
  const pathMat = new THREE.MeshLambertMaterial({ color: M.COLORS.path });
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xc9ad78 });
  const path = (w: number, d: number, x: number, z: number) => {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, d + 0.3), edgeMat);
    e.rotation.x = -Math.PI / 2;
    e.position.set(x, 0.008, z);
    e.receiveShadow = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    scene.add(e, m);
  };
  path(2.2, 24, -0.6, -2);
  path(30, 2.0, 0, 8.2);
  path(5, 1.6, -3.2, -6.8);
  path(1.8, 9, -8.2, 4.2);
  path(4, 1.4, 7, -2);
  path(4, 1.4, 7, -9.6);

  // ---- river with moving ripples ----
  const riverGeo = new THREE.PlaneGeometry(160, 4, 80, 4);
  const river = new THREE.Mesh(riverGeo, new THREE.MeshLambertMaterial({ color: 0x47b0ec, transparent: true, opacity: 0.95 }));
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.03, -19.8);
  scene.add(river);
  const bank = new THREE.Mesh(new THREE.PlaneGeometry(160, 0.5), new THREE.MeshLambertMaterial({ color: 0xd9c08e }));
  bank.rotation.x = -Math.PI / 2;
  bank.position.set(0, 0.02, -17.6);
  scene.add(bank);
  const ripples: THREE.Mesh[] = [];
  const rippleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 26; i++) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.8, 2), 0.08), rippleMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(rand(-40, 40), 0.06, rand(-21.4, -18.2));
    scene.add(r);
    ripples.push(r);
  }

  // ---- grass tufts and flowers (instanced, cheap) ----
  const tuftGeo = new THREE.ConeGeometry(0.07, 0.38, 3);
  tuftGeo.translate(0, 0.19, 0);
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ color: 0x5aa83c }), 2400);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  let n = 0;
  while (n < 800) {
    const x = rand(-30, 30), z = rand(-17, 22);
    if (isClear(x, z)) continue;
    for (let k = 0; k < 3; k++) {
      e.set(rand(-0.35, 0.35), rand(0, 6), rand(-0.35, 0.35));
      q.setFromEuler(e);
      const sc = rand(0.7, 1.3);
      s.set(sc, sc, sc);
      p.set(x + rand(-0.12, 0.12), 0, z + rand(-0.12, 0.12));
      tufts.setMatrixAt(n * 3 + k, m4.compose(p, q, s));
    }
    n++;
  }
  scene.add(tufts);

  const flowerGeo = new THREE.IcosahedronGeometry(0.1, 0);
  const flowerCols = [0xffffff, 0xffe066, 0xff8fb1, 0xc39bff, 0xff6b6b];
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 360);
  for (let i = 0; i < 360; ) {
    const x = rand(-28, 28), z = rand(-17, 22);
    if (isClear(x, z)) continue;
    p.set(x, 0.22, z);
    s.set(1, 1, 1);
    q.identity();
    flowers.setMatrixAt(i, m4.compose(p, q, s));
    flowers.setColorAt(i, new THREE.Color(flowerCols[i % flowerCols.length]));
    i++;
  }
  scene.add(flowers);

  // ---- rocks and bushes ----
  for (let i = 0; i < 40; ) {
    const x = rand(-26, 26), z = rand(-17, 22);
    if (isClear(x, z) || (Math.abs(x) < 11.5 && z > -16 && z < 11)) continue;
    const r = M.mesh(new THREE.DodecahedronGeometry(rand(0.25, 0.6), 0), i % 3 ? 0xa9a59c : 0x8f8a80, x, 0.15, z);
    r.scale.y = 0.6;
    r.rotation.y = rand(0, 6);
    scene.add(r);
    i++;
  }
  for (let i = 0; i < 26; ) {
    const x = rand(-24, 24), z = rand(-17, 22);
    if (isClear(x, z) || (Math.abs(x) < 11.5 && z > -16 && z < 11)) continue;
    const b = new THREE.Group();
    for (let k = 0; k < 3; k++) b.add(M.mesh(new THREE.IcosahedronGeometry(rand(0.35, 0.55), 0), 0x4c9f3d, rand(-0.35, 0.35), 0.35, rand(-0.3, 0.3)));
    b.position.set(x, 0, z);
    scene.add(b);
    i++;
  }

  // ---- trees (they sway) ----
  const trees: THREE.Group[] = [];
  const addTree = (x: number, z: number) => {
    const t = M.tree();
    t.position.set(x, 0, z);
    t.rotation.y = rand(0, 6);
    scene.add(t);
    trees.push(t);
  };
  for (let i = 0; i < 70; ) {
    const x = rand(-30, 30), z = rand(-26, 24);
    if (Math.abs(x) < 12.5 && z > -17 && z < 12) continue;
    if (z > -22 && z < -17.4) continue; // river
    addTree(x, z);
    i++;
  }

  // ---- fences along the road ----
  for (const x0 of [-14.5, 1.5]) {
    const f = M.fence(13);
    f.position.set(x0, 0, 9.6);
    scene.add(f);
  }

  // ---- barn and silo (decor, behind the road) ----
  const barn = M.barn();
  barn.position.set(9.5, 0, 13.5);
  barn.rotation.y = Math.PI;
  scene.add(barn);
  const silo = M.silo();
  silo.position.set(13.2, 0, 13.2);
  scene.add(silo);
  const house = M.house();
  house.position.set(-10, 0, 13.8);
  house.rotation.y = Math.PI;
  scene.add(house);

  // ---- animals ----
  interface Critter { obj: THREE.Group; target: THREE.Vector3; wait: number; speed: number; area: [number, number, number, number]; peck: number }
  const critters: Critter[] = [];
  const addCritter = (obj: THREE.Group, area: [number, number, number, number], speed: number) => {
    obj.position.set(rand(area[0], area[1]), 0, rand(area[2], area[3]));
    scene.add(obj);
    critters.push({ obj, target: obj.position.clone(), wait: rand(0, 3), speed, area, peck: 0 });
  };
  for (let i = 0; i < 6; i++) addCritter(M.chicken(), [5, 11, 2.4, 6.8], 1.4);
  for (let i = 0; i < 3; i++) addCritter(M.cow(), [12.5, 18, -6, 4], 0.6);
  // small pen for the cows
  const pen = M.fence(6.5);
  pen.position.set(12, 0, 4.6);
  scene.add(pen);

  // ---- clouds (drift, and cast soft moving shadows) ----
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const cl = M.cloud();
    cl.position.set(rand(-40, 40), rand(9, 12), rand(-30, 10));
    scene.add(cl);
    clouds.push(cl);
  }

  // ---- butterflies ----
  const butterflies: { obj: THREE.Group; base: THREE.Vector3; ph: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const b = M.butterfly([0xffffff, 0xffd54f, 0xff8fb1][i % 3]);
    const base = new THREE.Vector3(rand(-10, 10), 0.9, rand(-14, 10));
    scene.add(b);
    butterflies.push({ obj: b, base, ph: rand(0, 6) });
  }

  // ---- short-lived effects ----
  interface Puff { m: THREE.Mesh; life: number; max: number; v: THREE.Vector3; grow: number }
  const puffs: Puff[] = [];
  const puffGeo = new THREE.IcosahedronGeometry(0.16, 0);
  const addPuff = (at: THREE.Vector3, color: number, v: THREE.Vector3, life: number, grow: number) => {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.9 }));
    m.position.copy(at);
    scene.add(m);
    puffs.push({ m, life, max: life, v, grow });
  };
  let dustTimer = 0;

  interface Floater { sprite: THREE.Sprite; life: number }
  const floaters: Floater[] = [];

  return {
    floatText(text, at, color = "#7CFC7C") {
      const cv = document.createElement("canvas");
      cv.width = 256;
      cv.height = 96;
      const g = cv.getContext("2d")!;
      g.font = "900 64px Arial, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 12;
      g.strokeStyle = "rgba(20,40,10,0.85)";
      g.strokeText(text, 128, 50);
      g.fillStyle = color;
      g.fillText(text, 128, 50);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.scale.set(2.4, 0.9, 1);
      sp.position.copy(at);
      sp.renderOrder = 20;
      scene.add(sp);
      floaters.push({ sprite: sp, life: 1.1 });
    },
    burst(at, color, count = 8) {
      for (let i = 0; i < count; i++) {
        addPuff(at, color, new THREE.Vector3(rand(-2, 2), rand(2, 4), rand(-2, 2)), 0.5, -0.8);
      }
    },
    update(dt, t, player, moving) {
      for (const r of ripples) {
        r.position.x += dt * 1.2;
        if (r.position.x > 40) r.position.x = -40;
      }
      const rp = riverGeo.attributes.position;
      for (let i = 0; i < rp.count; i++) rp.setZ(i, Math.sin(rp.getX(i) * 0.5 + t * 2) * 0.05);
      rp.needsUpdate = true;

      trees.forEach((tr, i) => (tr.rotation.z = Math.sin(t * 1.3 + i) * 0.025));

      for (const cr of critters) {
        if (cr.wait > 0) {
          cr.wait -= dt;
          cr.peck += dt * 9;
          const head = cr.obj.getObjectByName("head");
          if (head) head.rotation.x = Math.max(0, Math.sin(cr.peck)) * 0.6;
          if (cr.wait <= 0) cr.target.set(rand(cr.area[0], cr.area[1]), 0, rand(cr.area[2], cr.area[3]));
          continue;
        }
        const d = new THREE.Vector3(cr.target.x - cr.obj.position.x, 0, cr.target.z - cr.obj.position.z);
        const dist = d.length();
        if (dist < 0.1) {
          cr.wait = rand(1, 4);
          continue;
        }
        d.normalize();
        cr.obj.position.addScaledVector(d, Math.min(dist, cr.speed * dt));
        cr.obj.rotation.y = Math.atan2(d.x, d.z);
        cr.obj.position.y = Math.abs(Math.sin(t * 14 + cr.obj.id)) * 0.05;
      }
      // chickens scatter from the farmer
      for (const cr of critters) {
        if (cr.speed < 1) continue;
        const dx = cr.obj.position.x - player.x, dz = cr.obj.position.z - player.z;
        if (dx * dx + dz * dz < 2.2) {
          cr.wait = 0;
          cr.target.set(THREE.MathUtils.clamp(cr.obj.position.x + dx * 2, cr.area[0], cr.area[1]), 0, THREE.MathUtils.clamp(cr.obj.position.z + dz * 2, cr.area[2], cr.area[3]));
        }
      }

      for (const cl of clouds) {
        cl.position.x += dt * 0.6;
        if (cl.position.x > 45) cl.position.x = -45;
      }

      for (const b of butterflies) {
        const k = t * 0.7 + b.ph;
        b.obj.position.set(b.base.x + Math.sin(k) * 2.5, b.base.y + Math.sin(k * 3.1) * 0.3, b.base.z + Math.cos(k * 0.8) * 2.5);
        b.obj.rotation.y = k;
        const flap = Math.sin(t * 22 + b.ph) * 0.9;
        b.obj.children[0].rotation.z = flap;
        b.obj.children[1].rotation.z = -flap;
      }

      dustTimer -= dt;
      if (moving && dustTimer <= 0) {
        dustTimer = 0.11;
        addPuff(player.clone().setY(0.1).add(new THREE.Vector3(rand(-0.2, 0.2), 0, rand(-0.2, 0.2))), 0xeee3c8, new THREE.Vector3(0, 0.6, 0), 0.45, 1.6);
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const pf = puffs[i];
        pf.life -= dt;
        pf.v.y -= pf.grow < 0 ? 9 * dt : 0;
        pf.m.position.addScaledVector(pf.v, dt);
        pf.m.scale.multiplyScalar(1 + pf.grow * dt);
        (pf.m.material as THREE.MeshLambertMaterial).opacity = Math.max(0, pf.life / pf.max) * 0.9;
        if (pf.life <= 0) {
          scene.remove(pf.m);
          (pf.m.material as THREE.Material).dispose();
          puffs.splice(i, 1);
        }
      }

      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.life -= dt;
        f.sprite.position.y += dt * 1.6;
        f.sprite.material.opacity = Math.min(1, f.life * 2.5);
        if (f.life <= 0) {
          scene.remove(f.sprite);
          f.sprite.material.map?.dispose();
          f.sprite.material.dispose();
          floaters.splice(i, 1);
        }
      }
    },
  };
}
