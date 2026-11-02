// A simple jointed person (hips, knees, shoulders) so workers visibly walk, bend, kneel, pour and rake.
import * as THREE from "three";
import type { Carry, Pose } from "./sim/staff";

const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c });
const box = (w: number, h: number, d: number, m: THREE.Material, y = -h / 2) => {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.position.y = y;
  g.castShadow = false;
  return g;
};

export interface Look {
  coat: number;
  trousers: number;
  hat: number; // 0 = bare head
  skin?: number;
}

export interface Person {
  root: THREE.Group;
  hips: THREE.Group;
  upper: THREE.Group;
  thighL: THREE.Group; kneeL: THREE.Group;
  thighR: THREE.Group; kneeR: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  items: Record<Exclude<Carry, "">, THREE.Object3D>;
  phase: number;
  lastX: number;
  lastZ: number;
  coatMat: THREE.MeshLambertMaterial;
}

export function makePerson(look: Look): Person {
  const skin = lam(look.skin ?? 0x6b4632);
  const coatMat = lam(look.coat);
  const trousers = lam(look.trousers);
  const boot = lam(0x1b1b1b);
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);
  hips.add(box(0.36, 0.16, 0.22, trousers, 0));

  const leg = (side: number) => {
    const thigh = new THREE.Group();
    thigh.position.set(side * 0.1, 0, 0);
    thigh.add(box(0.15, 0.46, 0.17, trousers));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    knee.add(box(0.14, 0.42, 0.15, trousers));
    const b = box(0.15, 0.1, 0.27, boot, -0.42);
    b.position.z = 0.05;
    knee.add(b);
    thigh.add(knee);
    hips.add(thigh);
    return [thigh, knee];
  };
  const [thighL, kneeL] = leg(-1);
  const [thighR, kneeR] = leg(1);

  const upper = new THREE.Group();
  upper.position.y = 0.06;
  hips.add(upper);
  upper.add(box(0.44, 0.6, 0.25, coatMat, 0.3));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
  head.position.y = 0.76;
  upper.add(head);
  if (look.hat) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(look.hat));
    cap.position.y = 0.79;
    const brim = box(0.2, 0.025, 0.14, lam(look.hat), 0.8);
    brim.position.z = 0.12;
    upper.add(cap, brim);
  }
  const arm = (side: number) => {
    const a = new THREE.Group();
    a.position.set(side * 0.29, 0.56, 0);
    a.add(box(0.12, 0.56, 0.13, coatMat));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin);
    hand.position.y = -0.6;
    a.add(hand);
    upper.add(a);
    return a;
  };
  const armL = arm(-1);
  const armR = arm(1);

  // Things a worker carries, all held in the right hand.
  const bucket = new THREE.Group();
  const pail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 14), lam(0xe0a800));
  pail.position.y = -0.2;
  const feed = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14).rotateX(-Math.PI / 2), lam(0xc49a5a));
  feed.position.y = -0.07;
  bucket.add(pail, feed);
  const tray = new THREE.Group();
  tray.add(box(0.42, 0.06, 0.32, lam(0x7a8f9c), 0));
  for (let i = 0; i < 12; i++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), lam(0xf3e2c3));
    e.position.set(-0.15 + (i % 4) * 0.1, 0.05, -0.1 + Math.floor(i / 4) * 0.1);
    tray.add(e);
  }
  tray.position.set(-0.29, -0.55, 0.22); // held in front with both hands
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), lam(0x222222));
  bag.scale.set(1, 1.3, 0.9);
  bag.position.y = -0.82;
  const rake = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.7, 6), lam(0x9c7a4c));
  pole.rotation.x = Math.PI / 2;
  pole.position.z = 0.55;
  const tine = box(0.55, 0.06, 0.06, lam(0x555555), 0);
  tine.position.z = 1.4;
  rake.add(pole, tine);
  rake.position.y = -0.6;
  armR.add(bucket, tray, bag, rake);
  bucket.position.y = -0.6;
  const items = { bucket, tray, bag, rake };
  for (const o of Object.values(items)) o.visible = false;

  return { root, hips, upper, thighL, kneeL, thighR, kneeR, armL, armR, items, phase: 0, lastX: 0, lastZ: 0, coatMat };
}

/** Put the person at (x, z) facing `heading` and animate the pose. `t` is real seconds. */
export function posePerson(p: Person, x: number, z: number, heading: number, pose: Pose, carry: Carry, t: number) {
  p.root.visible = pose !== "away";
  if (!p.root.visible) return;
  const moved = Math.hypot(x - p.lastX, z - p.lastZ);
  p.lastX = x; p.lastZ = z;
  if (moved < 3) p.phase += (moved / 1.3) * Math.PI * 2; // one full stride every 1.3 m
  p.root.position.set(x, 0, z);
  // Turn smoothly instead of snapping.
  let dh = heading - p.root.rotation.y;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  p.root.rotation.y += dh * Math.min(1, moved > 0 ? 0.35 : 0.15);

  let hipY = 0.92, lean = 0, tL = 0, tR = 0, kL = 0, kR = 0, aL = 0, aR = 0, azL = 0, azR = 0;
  const s = Math.sin(p.phase);
  switch (pose) {
    case "walk":
      tL = 0.5 * s; tR = -0.5 * s;
      kL = s < 0 ? -s * 0.7 : 0.05; kR = s > 0 ? s * 0.7 : 0.05;
      aL = -0.45 * s; aR = 0.45 * s;
      hipY = 0.92 + 0.025 * Math.abs(Math.cos(p.phase));
      lean = 0.05;
      break;
    case "stand":
      aL = 0.05 * Math.sin(t * 1.3); aR = -aL;
      azL = -0.06; azR = 0.06;
      break;
    case "pour":
      lean = 0.35;
      tL = -0.1; tR = 0.15;
      aR = -1.25 + 0.15 * Math.sin(t * 5); aL = -0.9;
      break;
    case "bend":
      lean = 1.05; hipY = 0.86;
      tL = -0.35; tR = -0.35; kL = 0.45; kR = 0.45;
      aL = -1.0 + 0.2 * Math.sin(t * 3); aR = -1.0 - 0.2 * Math.sin(t * 3);
      break;
    case "kneel":
      hipY = 0.55; lean = 0.45;
      tL = -1.45; kL = 1.5; // front leg: foot flat, knee up
      tR = 0.15; kR = 1.55; // back leg: knee on the litter
      aL = -1.1; aR = -1.25 + 0.25 * Math.sin(t * 2.5);
      break;
    case "rake": {
      const r = Math.sin(t * 3.5);
      lean = 0.3; tL = -0.25; tR = 0.2; kL = 0.2;
      aR = -0.75 + 0.35 * r; aL = -0.85 + 0.35 * r;
      azL = 0.25;
      p.root.position.x += Math.sin(p.root.rotation.y) * 0.12 * r;
      p.root.position.z += Math.cos(p.root.rotation.y) * 0.12 * r;
      break;
    }
  }
  p.hips.position.y = hipY;
  p.upper.rotation.x = lean;
  p.thighL.rotation.x = tL; p.thighR.rotation.x = tR;
  p.kneeL.rotation.x = kL; p.kneeR.rotation.x = kR;
  p.armL.rotation.x = aL; p.armR.rotation.x = aR;
  p.armL.rotation.z = azL; p.armR.rotation.z = azR;

  for (const [k, o] of Object.entries(p.items)) o.visible = k === carry;
  // The bucket hangs straight down while walking and tips over the feeder when pouring.
  const level = -(aR + lean); // keeps a held thing upright whatever the arm does
  p.items.bucket.rotation.x = pose === "pour" ? level + 1.7 : level;
  p.items.bag.rotation.x = level;
  p.items.tray.rotation.x = level;
  p.items.rake.rotation.x = 0.95;
}
