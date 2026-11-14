import * as THREE from "three";
import type { Terrain } from "./terrain";
import { Truck, type Input } from "./truck";
import { Autopilot } from "./autopilot";

// Stadium racing: walls along the track, trucks bumping each other, and
// lap counting on a closed loop. Shared by the game and the headless sims.

const _f = new THREE.Vector3();

/** keeps a truck between the stadium walls; returns the impact speed */
export function wallCollide(tr: Truck, T: Terrain, hint: number): number {
  const near = T.nearest(tr.pos.x, tr.pos.z, hint);
  const lim = T.routeW + 0.6;
  if (near.d <= lim) return 0;
  const s = T.sample(near.k);
  let nx = tr.pos.x - s.x, nz = tr.pos.z - s.z;
  const d = Math.hypot(nx, nz) || 1;
  nx /= d; nz /= d;
  tr.pos.x -= nx * (d - lim); tr.pos.z -= nz * (d - lim);
  const vn = tr.vel.x * nx + tr.vel.z * nz;
  if (vn <= 0) return 0;
  tr.vel.x -= nx * vn * 1.35; tr.vel.z -= nz * vn * 1.35;
  // scrape along the wall and turn the nose away from it
  tr.vel.x *= 0.985; tr.vel.z *= 0.985;
  const fw = tr.forward(_f);
  const side = fw.x * nz - fw.z * nx; // >0: wall on the left of the nose
  tr.ang.y += Math.sign(side) * Math.min(1.2, vn * 0.12);
  return vn;
}

/** two circles per truck (front and rear); returns the closing speed of the hit */
export function truckCollide(a: Truck, b: Truck): number {
  if (Math.abs(a.pos.y - b.pos.y) > 1.8) return 0;
  const fa = a.forward(new THREE.Vector3()), fb = b.forward(new THREE.Vector3());
  let hit = 0;
  const R = 1.2;
  for (const oa of [1.3, -1.3]) for (const ob of [1.3, -1.3]) {
    const ax = a.pos.x + fa.x * oa, az = a.pos.z + fa.z * oa;
    const bx = b.pos.x + fb.x * ob, bz = b.pos.z + fb.z * ob;
    let nx = bx - ax, nz = bz - az;
    const d = Math.hypot(nx, nz);
    if (d >= 2 * R || d < 1e-4) continue;
    nx /= d; nz /= d;
    const push = (2 * R - d) / 2;
    a.pos.x -= nx * push; a.pos.z -= nz * push;
    b.pos.x += nx * push; b.pos.z += nz * push;
    const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
    if (rv < 0) {
      const j = -rv * 0.6; // equal masses, a little bounce
      a.vel.x -= nx * j; a.vel.z -= nz * j;
      b.vel.x += nx * j; b.vel.z += nz * j;
      // off-centre hits spin the trucks a little
      a.ang.y += (oa > 0 ? 1 : -1) * (fa.x * nz - fa.z * nx) * j * 0.06;
      b.ang.y -= (ob > 0 ? 1 : -1) * (fb.x * nz - fb.z * nx) * j * 0.06;
      hit = Math.max(hit, -rv);
    }
  }
  return hit;
}

/** lap progress on a loop, in route samples; jumps across the infield don't count */
export class LapCounter {
  prog = 0;
  lastK = 0;
  constructor(private T: Terrain, k0: number) { this.reset(k0); }
  reset(k0: number) {
    const n = this.T.count;
    this.lastK = ((k0 % n) + n) % n;
    this.prog = k0 > n / 2 ? k0 - n : k0;
  }
  update(k: number, d: number) {
    const n = this.T.count;
    if (d > 40) return;
    let dk = k - this.lastK;
    if (dk > n / 2) dk -= n; if (dk < -n / 2) dk += n;
    if (Math.abs(dk) < 60) this.prog += dk;
    this.lastK = k;
  }
  lap() { return Math.floor(this.prog / this.T.count); }
}

export interface Rival {
  truck: Truck;
  pilot: Autopilot;
  lap: LapCounter;
  input: Input;
  cap: number;      // top speed on the straights (m/s)
  laneT: number;    // drifts the line it takes so the pack spreads out
  flipT: number;
  stuckT: number;
  done: number;     // finish time, 0 while racing
  name: string;
  livery: number;
}

export function makeRival(T: Terrain, name: string, livery: number, cap: number, lat: number): Rival {
  const truck = new Truck();
  const pilot = new Autopilot(T, lat);
  return { truck, pilot, lap: new LapCounter(T, 0), input: { throttle: 0, brake: 0, steer: 0, handbrake: false }, cap, laneT: Math.random() * 10, flipT: 0, stuckT: 0, done: 0, name, livery };
}

/** puts a truck on the grid: row behind the line, lateral offset in metres */
export function gridPlace(tr: Truck, T: Terrain, k: number, lat: number) {
  const s = T.sample(k), s2 = T.sample(k + 4);
  tr.place(s.x + s.tz * lat, s.z - s.tx * lat, Math.atan2(s2.x - s.x, s2.z - s.z), T);
}

export function rivalStep(r: Rival, T: Terrain, dt: number, hold: boolean) {
  r.laneT += dt;
  r.pilot.lane = Math.sin(r.laneT * 0.23) * (T.routeW - 2.2);
  r.pilot.drive(r.truck, r.input, r.cap);
  if (hold) { r.input.throttle = 0; r.input.brake = 0; r.input.handbrake = true; }
  if (r.done) { r.input.throttle = 0; r.input.brake = 0.4; }
  r.truck.step(dt, r.input, T);
}

/** recovery for an AI truck that is upside down or stuck; call once per frame */
export function rivalRecover(r: Rival, T: Terrain, dt: number, racing: boolean) {
  r.flipT = r.truck.isUpsideDown() ? r.flipT + dt : 0;
  r.stuckT = racing && !r.done && Math.abs(r.truck.speed) < 1.5 ? r.stuckT + dt : 0;
  if (r.flipT > 2 || r.stuckT > 3.5) {
    const k = T.nearest(r.truck.pos.x, r.truck.pos.z, r.pilot.k).k - 10;
    gridPlace(r.truck, T, k, 0);
    r.pilot.k = ((k % T.count) + T.count) % T.count;
    r.flipT = r.stuckT = 0;
  }
}
