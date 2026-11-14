import * as THREE from "three";
import type { Terrain } from "./terrain";

// Truck dynamics: one rigid body, four raycast long-travel suspension
// corners, slip-based tyres with a friction circle, rear-wheel drive,
// anti-roll bars, body-vs-ground contacts and a little air control.
// Body frame: +z forward, +y up, -x is the driver's right.

export interface Input { throttle: number; brake: number; steer: number; handbrake: boolean }

export const SPEC = {
  mass: 1900,
  inertia: new THREE.Vector3(3600, 4300, 1500), // pitch (x), yaw (y), roll (z)
  gravity: 11,
  radius: 0.52,
  rest: 0.82,         // max droop length from mount to wheel centre
  bump: 0.74,         // compression where the bump stop starts
  k: 15500,
  k3: 52000,
  damp: 1900,
  rebound: 2700,
  arb: 7000,
  power: 330000,
  maxDrive: 15000,
  brake: 9000,
  drag: 3.4,
  maxSteer: 0.6,
};

const MOUNTS: [number, number, number, boolean][] = [
  [1.12, -0.05, 1.72, true],
  [-1.12, -0.05, 1.72, true],
  [1.12, -0.05, -1.62, false],
  [-1.12, -0.05, -1.62, false],
];

// points of the body that can scrape the ground (local)
const HULL: [number, number, number][] = [
  [0.95, -0.38, 2.45], [-0.95, -0.38, 2.45], [0.95, -0.38, -2.45], [-0.95, -0.38, -2.45],
  [0.85, 1.05, 0.0], [-0.85, 1.05, 0.0], [0.85, 1.05, -0.8], [-0.85, 1.05, -0.8], [0.9, 0.35, -2.3], [-0.9, 0.35, -2.3],
  [0, 1.15, -0.4], [0, -0.4, 0], [1.0, 0.25, 2.2], [-1.0, 0.25, 2.2],
];

export class Wheel {
  mount: THREE.Vector3;
  front: boolean;
  comp = 0;
  prevComp = 0;
  grounded = false;
  length = SPEC.rest;     // visual suspension length
  contact = new THREE.Vector3();
  spin = 0;
  spinVel = 0;
  load = 0;
  slip = 0;               // m/s of sliding
  side = 1;
  constructor(m: [number, number, number, boolean]) {
    this.mount = new THREE.Vector3(m[0], m[1], m[2]);
    this.front = m[3];
    this.side = m[0] > 0 ? 1 : -1;
  }
}

const _a = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
const _n = { x: 0, y: 1, z: 0 }, _nv = new THREE.Vector3();
const _f = new THREE.Vector3(), _s = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3();
const _p = new THREE.Vector3(), _tmp = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();

export class Truck {
  pos = new THREE.Vector3();
  q = new THREE.Quaternion();
  vel = new THREE.Vector3();
  ang = new THREE.Vector3();
  wheels = MOUNTS.map((m) => new Wheel(m));
  steer = 0;
  grounded = 0;
  airTime = 0;
  speed = 0;          // forward m/s
  rpm = 900;
  gear = 1;
  wheelspin = 0;
  /** strongest impact this step (m/s into the ground), for sound and shake */
  impact = 0;
  bottomOut = 0;
  private force = new THREE.Vector3();
  private torque = new THREE.Vector3();

  place(x: number, z: number, heading: number, terrain: Terrain) {
    this.pos.set(x, terrain.height(x, z) + 1.25, z);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    this.steer = 0;
    this.airTime = 0;
    for (const w of this.wheels) { w.comp = w.prevComp = 0; w.spinVel = 0; w.length = SPEC.rest * 0.6; }
  }

  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.q); }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.q); }

  private addForceAt(F: THREE.Vector3, p: THREE.Vector3) {
    this.force.add(F);
    _tmp.subVectors(p, this.pos).cross(F);
    this.torque.add(_tmp);
  }

  step(dt: number, inp: Input, T: Terrain) {
    const S = SPEC;
    const up = _up.set(0, 1, 0).applyQuaternion(this.q);
    const fw = _fw.set(0, 0, 1).applyQuaternion(this.q);
    const rt = _rt.set(-1, 0, 0).applyQuaternion(this.q);
    this.force.set(0, -S.gravity * S.mass, 0);
    this.torque.set(0, 0, 0);
    this.impact = 0;
    this.bottomOut = 0;

    const speed = this.vel.dot(fw);
    this.speed = speed;
    const aspd = Math.abs(speed);

    // steering: less lock at speed, finite steering rate
    const lock = S.maxSteer * (0.28 + 0.72 / (1 + aspd * aspd / 260));
    const target = inp.steer * lock;
    const rate = Math.abs(target) < Math.abs(this.steer) ? 3.2 : 2.2;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));

    // drive
    let drive = 0, brake = 0;
    if (inp.throttle > 0) {
      if (speed < -0.8) brake = inp.throttle;
      else drive = inp.throttle * Math.min(S.maxDrive, S.power / Math.max(aspd, 1));
    }
    if (inp.brake > 0) {
      if (speed > 0.8) brake = Math.max(brake, inp.brake);
      else if (inp.throttle <= 0) drive = speed > -10 ? -inp.brake * 6500 : 0;
    }
    const hold = inp.throttle <= 0 && inp.brake <= 0 && aspd < 1.2;

    // suspension + tyres
    let grounded = 0, spin = 0;
    const comps: number[] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const a = _a.copy(w.mount).applyQuaternion(this.q).add(this.pos);
      const maxT = S.rest + S.radius;
      const t = T.raycast(a.x, a.y, a.z, -up.x, -up.y, -up.z, maxT);
      w.prevComp = w.comp;
      if (t < 0) {
        w.grounded = false; w.comp = 0; w.load = 0; w.slip = 0;
        w.length += (S.rest - w.length) * Math.min(1, dt * 10);
        continue;
      }
      w.grounded = true;
      grounded++;
      const L = Math.max(0, t - S.radius);
      w.comp = S.rest - L;
      w.length = Math.max(S.rest - S.bump - 0.04, L);
      comps[i] = w.comp;
      w.contact.copy(a).addScaledVector(up, -t);
    }
    // anti-roll bar
    const arbF = S.arb * (comps[0] - comps[1]), arbR = S.arb * (comps[2] - comps[3]);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.grounded) continue;
      const c = w.comp;
      let cv = (c - w.prevComp) / dt;
      if (!(w.prevComp > 0)) cv = Math.min(cv, 6);
      cv = Math.max(-8, Math.min(8, cv));
      let N = S.k * c + S.k3 * c * c * c + (cv > 0 ? S.damp : S.rebound) * cv;
      if (c > S.bump) { N += 260000 * (c - S.bump) + 16000 * Math.max(0, cv); this.bottomOut = Math.max(this.bottomOut, cv); }
      N += (i === 0 ? arbF : i === 1 ? -arbF : i === 2 ? arbR : -arbR);
      N = Math.max(0, N);
      w.load = N;
      const a = _a.copy(w.mount).applyQuaternion(this.q).add(this.pos);
      _p.copy(up).multiplyScalar(N);
      this.addForceAt(_p, a);

      // tyre frame on the ground plane
      T.normal(w.contact.x, w.contact.z, _n);
      _nv.set(_n.x, _n.y, _n.z);
      const st = w.front ? this.steer : 0;
      _f.set(-Math.sin(st), 0, Math.cos(st)).applyQuaternion(this.q);
      _f.addScaledVector(_nv, -_f.dot(_nv)).normalize();
      _s.crossVectors(_nv, _f).normalize();
      _r.subVectors(w.contact, this.pos);
      _v.crossVectors(this.ang, _r).add(this.vel);
      const vl = _v.dot(_f), vs = _v.dot(_s);
      const onRoad = T.nearest(w.contact.x, w.contact.z).d < 8;
      const mu = onRoad ? 1.12 : 0.92;
      const maxF = mu * Math.min(N, 11000);

      let Fl = 0;
      // 30/70 torque split, traction control keeps wheelspin mild
      const share = drive * (w.front ? 0.15 : 0.35);
      Fl += Math.sign(share) * Math.min(Math.abs(share), 0.9 * maxF);
      if (!w.front && Math.abs(share) > 0.9 * maxF) Fl += Math.sign(share) * 0.25 * maxF;
      if (brake > 0) { const bf = S.brake * brake * (w.front ? 0.6 : 0.4); Fl -= Math.max(-bf, Math.min(bf, vl * 6000)); }
      if (hold) Fl -= Math.max(-maxF, Math.min(maxF, vl * 5000));
      Fl -= vl * (onRoad ? 12 : 45);
      let latScale = 1;
      if (inp.handbrake && !w.front) {
        Fl = -Math.max(-0.75 * maxF, Math.min(0.75 * maxF, vl * 5000));
        latScale = 0.42;
      }
      let ws = 0;
      if (Math.abs(Fl) > maxF) { ws = (Math.abs(Fl) - maxF) / Math.max(1, maxF); Fl = Math.sign(Fl) * maxF; }
      latScale *= Math.max(0.72, Math.sqrt(Math.max(0, 1 - (Fl / Math.max(1, maxF)) ** 2)));
      const alpha = Math.atan2(vs, Math.max(Math.abs(vl), 2.5));
      const Fs = -maxF * latScale * Math.sin(1.45 * Math.atan(7 * alpha));
      w.slip = Math.abs(vs) * 0.5 + ws * 6 + (inp.handbrake && !w.front ? Math.abs(vl) * 0.3 : 0);
      if (!w.front) spin += ws;

      // apply tyre force partway up towards the centre of mass (stability assist)
      const lift = _tmp.subVectors(this.pos, w.contact).dot(up) * 0.55;
      _p.copy(w.contact).addScaledVector(up, lift);
      _a.copy(_f).multiplyScalar(Fl).addScaledVector(_s, Fs);
      this.addForceAt(_a, _p);

      w.spinVel = vl / S.radius + (w.front ? 0 : ws * 25 * Math.sign(drive || 1));
    }
    this.wheelspin = spin;
    for (const w of this.wheels) {
      if (!w.grounded) {
        const target = w.front ? w.spinVel * 0.99 : (inp.throttle * 45 - inp.brake * 20);
        w.spinVel += (target - w.spinVel) * Math.min(1, dt * (w.front ? 0.5 : 3));
      }
      w.spin += w.spinVel * dt;
    }
    this.grounded = grounded;

    // body scraping the ground / rolling over
    for (const h of HULL) {
      const p = _p.set(h[0], h[1], h[2]).applyQuaternion(this.q).add(this.pos);
      const g = T.height(p.x, p.z);
      const pen = g - p.y;
      if (pen <= 0) continue;
      T.normal(p.x, p.z, _n);
      _nv.set(_n.x, _n.y, _n.z);
      _r.subVectors(p, this.pos);
      _v.crossVectors(this.ang, _r).add(this.vel);
      const vn = _v.dot(_nv);
      this.impact = Math.max(this.impact, -vn);
      const Fn = Math.max(0, 140000 * Math.min(pen, 0.5) - 9000 * vn);
      _s.copy(_v).addScaledVector(_nv, -vn);
      const vt = _s.length();
      const Ft = Math.min(0.65 * Fn, vt * 9000);
      _a.copy(_nv).multiplyScalar(Fn);
      if (vt > 1e-3) _a.addScaledVector(_s, -Ft / vt);
      this.addForceAt(_a, p);
    }

    // drag
    this.force.addScaledVector(this.vel, -S.drag * this.vel.length());

    // air control: gas/brake pitch, steer rolls and yaws a little
    if (grounded === 0) {
      this.airTime += dt;
      _a.crossVectors(fw, up).multiplyScalar((inp.throttle - inp.brake) * 2.6 * dt);
      _a.addScaledVector(fw, inp.steer * 2.4 * dt);
      _a.addScaledVector(up, -inp.steer * 0.9 * dt);
      // assist: nose follows the flight path, wings level (weak, the player can override)
      if (this.vel.lengthSq() > 25) {
        // target attitude: a softened version of the flight path, so landings are rear-first, not nose-first
        const hv = Math.hypot(this.vel.x, this.vel.z) || 1;
        const pathPitch = Math.atan2(this.vel.y, hv);
        const want = Math.max(-0.3, Math.min(0.3, pathPitch * 0.4));
        const have = Math.asin(Math.max(-1, Math.min(1, fw.y)));
        _p.crossVectors(fw, up).normalize();
        _a.addScaledVector(_p, (want - have) * 3.4 * dt);
      }
      _a.addScaledVector(fw, rt.y * 3.0 * dt);
      this.ang.add(_a);
      this.ang.multiplyScalar(1 - 0.9 * dt);
    } else {
      this.airTime = 0;
      // gentle yaw damping keeps slides catchable
      const yawRate = this.ang.dot(up);
      this.torque.addScaledVector(up, -yawRate * (grounded === 4 ? 3200 : 9000));
    }

    // integrate
    this.vel.addScaledVector(this.force, dt / S.mass);
    _qi.copy(this.q).invert();
    const tb = _tmp.copy(this.torque).applyQuaternion(_qi);
    const wb = _a.copy(this.ang).applyQuaternion(_qi);
    wb.x += (tb.x / S.inertia.x) * dt;
    wb.y += (tb.y / S.inertia.y) * dt;
    wb.z += (tb.z / S.inertia.z) * dt;
    this.ang.copy(wb.applyQuaternion(this.q));
    const am = this.ang.length();
    if (am > 12) this.ang.multiplyScalar(12 / am);
    this.pos.addScaledVector(this.vel, dt);
    const w = this.ang.length();
    if (w > 1e-6) {
      _q.setFromAxisAngle(_tmp.copy(this.ang).divideScalar(w), w * dt);
      this.q.premultiply(_q).normalize();
    }
    // never fall through the world
    const gy = T.height(this.pos.x, this.pos.z);
    if (this.pos.y < gy - 0.2) { this.pos.y = gy + 0.3; if (this.vel.y < 0) this.vel.y = 0; }

    // fake automatic gearbox for the engine sound
    const tops = [0, 10, 18, 27, 36, 46, 99];
    let g = 1;
    while (g < 6 && aspd > tops[g]) g++;
    this.gear = g;
    const lo = tops[g - 1], hi = tops[g];
    let rpm = 1100 + 5400 * Math.min(1, (aspd - lo) / (hi - lo));
    if (grounded === 0 || spin > 0.2) rpm = Math.max(rpm, 1500 + inp.throttle * 5600);
    if (inp.throttle <= 0 && inp.brake <= 0) rpm = Math.min(rpm, 900 + aspd * 90);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 9);
  }

  isUpsideDown() { return this.up(_tmp).y < 0.25; }
}
