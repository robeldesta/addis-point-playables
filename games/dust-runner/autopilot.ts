import type { Terrain } from "./terrain";
import type { Truck, Input } from "./truck";

// Drives the truck around the loop: used for the title-screen attract mode.
export class Autopilot {
  k = 0;
  lane = 0; // metres right of the centre line
  private curv: Float32Array;
  constructor(private T: Terrain, private lat = 4) {
    const n = T.count;
    this.curv = new Float32Array(n);
    const span = 16;
    for (let k = 0; k < n; k++) {
      const a = T.sample(k - span), b = T.sample(k + span);
      const da = Math.atan2(a.tx, a.tz), db = Math.atan2(b.tx, b.tz);
      let d = db - da; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.curv[k] = Math.abs(d) / (2 * span * T.step);
    }
  }
  drive(tr: Truck, out: Input, maxSpeed = 30): Input {
    const T = this.T;
    this.k = T.nearest(tr.pos.x, tr.pos.z, this.k).k;
    const look = T.sample(this.k + Math.round((9 + Math.abs(tr.speed) * 0.7) / T.step));
    const fw = tr.forward();
    const lx = look.x + look.tz * this.lane, lz = look.z - look.tx * this.lane;
    let e = Math.atan2(lx - tr.pos.x, lz - tr.pos.z) - Math.atan2(fw.x, fw.z);
    while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    // slow down for the sharpest bend in the next ~60 m
    let c = 0;
    for (let j = 0; j < 120; j += 4) c = Math.max(c, this.curv[T.loop ? (this.k + j) % T.count : Math.min(T.count - 1, this.k + j)]);
    const vmax = Math.min(maxSpeed, Math.sqrt(this.lat / Math.max(c, 1e-4)));
    out.steer = tr.grounded === 4 ? Math.max(-1, Math.min(1, -e * 1.6)) : 0;
    out.throttle = tr.speed < vmax ? 1 : 0;
    out.brake = tr.speed > vmax + 3 ? 1 : 0;
    out.handbrake = false;
    return out;
  }
}
