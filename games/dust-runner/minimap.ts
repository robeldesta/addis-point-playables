import * as THREE from "three";
import type { Terrain } from "./terrain";

// Corner map: the whole route drawn once, north up, with the player arrow,
// rivals, checkpoints and the stretch already driven.

export interface MapDot { x: number; z: number; color: string }

const _f = new THREE.Vector3();

export class MiniMap {
  private base = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private sc = 1; private ox = 0; private oz = 0;
  private T!: Terrain;
  private k0 = 0; private k1 = 0;
  private gates: number[] = [];
  private acc = 1;

  constructor(private cv: HTMLCanvasElement) { this.ctx = cv.getContext("2d")!; }

  private px(x: number) { return (x - this.ox) * this.sc; }
  private pz(z: number) { return (z - this.oz) * this.sc; }

  build(T: Terrain, k0: number, k1: number, gates: number[]) {
    this.T = T; this.k0 = k0; this.k1 = k1; this.gates = gates;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.cv.clientWidth * dpr) || 240, H = Math.round(this.cv.clientHeight * dpr) || 240;
    this.cv.width = W; this.cv.height = H;
    this.base.width = W; this.base.height = H;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = k0; k <= k1; k++) { const p = T.sample(k); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const pad = 12 * dpr;
    this.sc = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, z1 - z0));
    this.ox = (x0 + x1) / 2 - W / 2 / this.sc; this.oz = (z0 + z1) / 2 - H / 2 / this.sc;
    const c = this.base.getContext("2d")!;
    c.clearRect(0, 0, W, H);
    c.lineCap = c.lineJoin = "round";
    this.path(c, k0, k1); c.strokeStyle = "rgba(0,0,0,.55)"; c.lineWidth = 7 * dpr; c.stroke();
    this.path(c, k0, k1); c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 3.5 * dpr; c.stroke();
    for (const g of gates) this.tick(c, g, "#ffd54f", 4 * dpr);
    if (!T.loop) this.tick(c, k0, "#36d07a", 5 * dpr);
    this.tick(c, k1, "#ffffff", 5 * dpr, true);
    this.acc = 1;
  }

  private path(c: CanvasRenderingContext2D, a: number, b: number) {
    c.beginPath();
    for (let k = a; k <= b; k += 2) { const p = this.T.sample(k); k === a ? c.moveTo(this.px(p.x), this.pz(p.z)) : c.lineTo(this.px(p.x), this.pz(p.z)); }
    const p = this.T.sample(b); c.lineTo(this.px(p.x), this.pz(p.z));
  }

  private tick(c: CanvasRenderingContext2D, k: number, col: string, r: number, chequer = false) {
    const p = this.T.sample(k);
    c.beginPath(); c.arc(this.px(p.x), this.pz(p.z), r, 0, Math.PI * 2);
    c.fillStyle = chequer ? "#111" : col; c.fill();
    c.lineWidth = r * 0.45; c.strokeStyle = chequer ? "#fff" : "rgba(0,0,0,.6)"; c.stroke();
  }

  /** prog = route sample the player has reached (for the driven stretch), or -1 */
  draw(dt: number, me: { pos: THREE.Vector3; q: THREE.Quaternion }, prog: number, others: MapDot[]) {
    this.acc += dt;
    if (this.acc < 1 / 20) return;
    this.acc = 0;
    const c = this.ctx, W = this.cv.width, dpr = W / (this.cv.clientWidth || W);
    c.clearRect(0, 0, W, this.cv.height);
    c.drawImage(this.base, 0, 0);
    if (prog > this.k0 && !this.T.loop) {
      c.lineCap = c.lineJoin = "round";
      this.path(c, this.k0, Math.min(this.k1, Math.floor(prog)));
      c.strokeStyle = "#ff7a2f"; c.lineWidth = 3.5 * dpr; c.stroke();
    }
    for (const o of others) {
      c.beginPath(); c.arc(this.px(o.x), this.pz(o.z), 4 * dpr, 0, Math.PI * 2);
      c.fillStyle = o.color; c.fill(); c.lineWidth = 1.5 * dpr; c.strokeStyle = "#fff"; c.stroke();
    }
    _f.set(0, 0, 1).applyQuaternion(me.q);
    const a = Math.atan2(_f.z, _f.x), x = this.px(me.pos.x), z = this.pz(me.pos.z), r = 8 * dpr;
    c.save(); c.translate(x, z); c.rotate(a);
    c.beginPath(); c.moveTo(r, 0); c.lineTo(-r * 0.7, r * 0.65); c.lineTo(-r * 0.35, 0); c.lineTo(-r * 0.7, -r * 0.65); c.closePath();
    c.fillStyle = "#ff3b30"; c.fill(); c.lineWidth = 2 * dpr; c.strokeStyle = "#fff"; c.stroke();
    c.restore();
  }
}
