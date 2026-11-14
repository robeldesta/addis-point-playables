import * as THREE from "three";
import { SPEC, type Truck } from "./truck";

// Low-poly trophy truck built in code: our own livery and shapes.

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, flatShading: true, ...extra });

function numberDecal(num: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111"; g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#d32f2f"; g.beginPath(); g.moveTo(0, 128); g.lineTo(256, 70); g.lineTo(256, 128); g.fill();
  g.fillStyle = "#ffffff";
  g.font = "900 92px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(num, 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.translate(0, len / 2, 0);
  g.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(a);
  mesh.lookAt(b);
  mesh.castShadow = true;
  return mesh;
}

function makeWheel(tyreM: THREE.Material, rimM: THREE.Material, side: number) {
  const g = new THREE.Group();
  const R = SPEC.radius, W = 0.44;
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 18, 1), tyreM);
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  // tread lugs
  const lug = new THREE.BoxGeometry(W * 0.48, 0.07, 0.12);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const m = new THREE.Mesh(lug, tyreM);
    m.position.set(((i % 2) - 0.5) * W * 0.5, Math.cos(a) * R, Math.sin(a) * R);
    m.rotation.x = -a;
    g.add(m);
  }
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.58, R * 0.58, W + 0.02, 10), rimM);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.6, 0.035, 5, 16), mat(0xd32f2f));
  ring.rotation.y = Math.PI / 2;
  for (const sx of [1, -1]) { const r2 = ring.clone(); r2.position.x = sx * (W / 2 + 0.012); g.add(r2); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.2, W + 0.06, 6), mat(0x2a2f36));
  hub.rotation.z = Math.PI / 2;
  hub.position.x = side * 0.01;
  g.add(hub);
  return g;
}

export class TruckView {
  root = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Group[] = [];
  spinners: THREE.Group[] = [];
  arms: { upper: THREE.Mesh; lower: THREE.Mesh; shock: THREE.Mesh }[] = [];
  private armMat = mat(0x8c96a3, { metalness: 0.5, roughness: 0.4 });
  private shockMat = mat(0x1e5bd8, { metalness: 0.4, roughness: 0.35 });
  brakeLights: THREE.MeshStandardMaterial;

  constructor(livery = 0xd32f2f) {
    const paint = mat(livery, { roughness: 0.45 });
    const white = mat(0xf4f1ea, { roughness: 0.5 });
    const dark = mat(0x15171b);
    const cage = mat(0x2b3442, { metalness: 0.4, roughness: 0.5 });
    const glass = mat(0x1b2a3a, { roughness: 0.15, metalness: 0.3 });
    this.brakeLights = mat(0x550000, { emissive: 0x000000 }) as THREE.MeshStandardMaterial;

    // side profile (z forward, y up), extruded across the width
    const s = new THREE.Shape();
    s.moveTo(2.55, -0.05);
    s.lineTo(2.5, 0.42);
    s.lineTo(1.25, 0.62);   // hood
    s.lineTo(0.55, 0.72);
    s.lineTo(0.0, 1.32);    // windscreen
    s.lineTo(-1.05, 1.34);  // roof
    s.lineTo(-1.3, 0.72);
    s.lineTo(-2.45, 0.62);  // bed rail
    s.lineTo(-2.6, 0.2);
    s.lineTo(-2.5, -0.05);
    s.lineTo(2.55, -0.05);
    const shell = new THREE.ExtrudeGeometry(s, { depth: 1.86, bevelEnabled: false });
    shell.translate(0, 0, -0.93);
    shell.rotateY(-Math.PI / 2); // shape x -> world z
    const shellM = new THREE.Mesh(shell, paint);
    shellM.castShadow = true;
    shellM.receiveShadow = true;
    this.body.add(shellM);

    // white lower stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 4.9), dark);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.06, 4.6), white); pin.position.set(0, 0.26, 0); this.body.add(pin);
    stripe.position.set(0, 0.12, 0);
    this.body.add(stripe);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 1.2), dark);
    hood.position.set(0, 0.66, 1.55); hood.rotation.x = 0.14; this.body.add(hood);
    // wide fenders
    for (const z of [1.72, -1.62]) for (const x of [1, -1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 1.5), paint);
      f.position.set(x * 1.12, 0.68, z);
      f.rotation.x = 0;
      f.castShadow = true;
      this.body.add(f);
      const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.12), paint);
      f2.position.set(x * 1.1, 0.38, z + (z > 0 ? 0.78 : -0.78));
      this.body.add(f2);
    }
    // windows
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.78), glass);
    ws.position.set(0, 1.03, 0.31);
    ws.rotation.x = -(Math.PI / 2 - Math.atan2(0.6, 0.55));
    this.body.add(ws);
    for (const x of [0.94, -0.94]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.42), glass);
      sw.position.set(x, 1.0, -0.45);
      sw.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.body.add(sw);
      const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: numberDecal("11") }));
      dec.position.set(x * 1.005, 0.36, 0.55);
      dec.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.body.add(dec);
    }
    // roof light bar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.2), dark);
    bar.position.set(0, 1.45, -0.2);
    this.body.add(bar);
    const lightM = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c4, emissiveIntensity: 0.8 });
    for (let i = 0; i < 10; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.04), lightM);
      l.position.set(-0.9 + i * 0.2, 1.45, -0.09);
      this.body.add(l);
    }
    // front grille + bumper tube
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.06), dark);
    grille.position.set(0, 0.25, 2.56);
    this.body.add(grille);
    for (const x of [-0.45, 0.45]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.05), lightM);
      hl.position.set(x, 0.34, 2.53);
      this.body.add(hl);
    }
    this.body.add(tube(new THREE.Vector3(-0.85, -0.05, 2.7), new THREE.Vector3(0.85, -0.05, 2.7), 0.05, cage));
    const fbar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.16), dark);
    fbar.position.set(0, 0.08, 2.66); this.body.add(fbar);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.04), lightM);
      l.position.set(-0.62 + i * 0.25, 0.08, 2.75); this.body.add(l);
    }
    // roll cage over the bed
    const cp = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (const x of [-0.8, 0.8]) {
      this.body.add(tube(cp(x, 1.3, -1.0), cp(x * 0.9, 0.62, -2.4), 0.05, cage));
      this.body.add(tube(cp(x, 1.3, -1.0), cp(x, 0.62, -1.4), 0.05, cage));
    }
    this.body.add(tube(cp(-0.75, 0.95, -2.0), cp(0.75, 0.95, -2.0), 0.05, cage));
    // spare tyres in the bed
    const spareM = mat(0x1a1a1a);
    for (const z of [-1.7, -2.15]) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), spareM);
      sp.position.set(0, 0.85, z);
      sp.rotation.x = 0.25;
      sp.castShadow = true;
      this.body.add(sp);
    }
    // tail lights
    for (const x of [-0.75, 0.75]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.05), this.brakeLights);
      tl.position.set(x, 0.42, -2.6);
      this.body.add(tl);
    }
    // chassis underside
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 4.4), dark);
    chassis.position.set(0, -0.15, 0);
    this.body.add(chassis);
    // body origin sits a little below the centre of mass
    this.body.position.set(0, 0, 0);
    for (const c of this.body.children) c.position.y -= 0.3;
    this.root.add(this.body);

    const tyreM = mat(0x22252a, { roughness: 0.95 });
    const rimM = mat(0x1c1f24, { metalness: 0.5, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const wheel = new THREE.Group();
      const spin = makeWheel(tyreM, rimM, side);
      wheel.add(spin);
      this.wheels.push(wheel);
      this.spinners.push(spin);
      this.root.add(wheel);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), this.armMat);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 5), this.armMat);
      const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 7), this.shockMat);
      for (const m of [upper, lower, shock]) {
        m.geometry.translate(0, 0.5, 0);
        m.geometry.rotateX(Math.PI / 2);
        m.castShadow = true;
        this.root.add(m);
      }
      this.arms.push({ upper, lower, shock });
    }
  }

  private _m = new THREE.Vector3();
  private _c = new THREE.Vector3();
  private _u = new THREE.Vector3();
  private _t = new THREE.Vector3();

  update(tr: Truck, braking: boolean) {
    this.body.position.copy(tr.pos);
    this.body.quaternion.copy(tr.q);
    const up = this._u.set(0, 1, 0).applyQuaternion(tr.q);
    for (let i = 0; i < 4; i++) {
      const w = tr.wheels[i];
      const view = this.wheels[i];
      const m = this._m.copy(w.mount).applyQuaternion(tr.q).add(tr.pos);
      const c = this._c.copy(m).addScaledVector(up, -w.length);
      // the wheel sits a little outboard of the mount
      const out = this._t.set(w.side * 0.08, 0, 0).applyQuaternion(tr.q);
      c.add(out);
      view.position.copy(c);
      view.quaternion.copy(tr.q);
      if (w.front) view.rotateY(-tr.steer);
      this.spinners[i].rotation.x = w.spin;
      // suspension links from inboard chassis points to the hub
      const a = this.arms[i];
      const inb = (x: number, y: number) => this._t.set(x, y, w.mount.z).applyQuaternion(tr.q).add(tr.pos);
      const hubIn = c.clone().addScaledVector(this._t.set(-w.side * 0.25, 0, 0).applyQuaternion(tr.q), 1);
      const p1 = inb(w.side * 0.35, -0.35).clone();
      a.lower.position.copy(p1);
      a.lower.scale.set(1, 1, p1.distanceTo(hubIn));
      a.lower.lookAt(hubIn);
      const p2 = inb(w.side * 0.4, 0.05).clone();
      const hubUp = hubIn.clone().addScaledVector(up, 0.22);
      a.upper.position.copy(p2);
      a.upper.scale.set(1, 1, p2.distanceTo(hubUp));
      a.upper.lookAt(hubUp);
      const p3 = inb(w.side * 0.55, 0.55).clone();
      a.shock.position.copy(p3);
      a.shock.scale.set(1, 1, p3.distanceTo(hubIn));
      a.shock.lookAt(hubIn);
    }
    this.brakeLights.emissive.setHex(braking ? 0xff2200 : 0x000000);
  }
}
