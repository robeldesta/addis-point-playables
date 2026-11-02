// Board geometry, scoring and the painted board texture.
// All sizes in metres. Board face sits in the z = 0 plane, y up.

export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export const R = {
  bull: 0.0075,
  outerBull: 0.017,
  tripleIn: 0.096,
  tripleOut: 0.107,
  doubleIn: 0.159,
  doubleOut: 0.17,
  numbers: 0.2255, // edge of the board (numbers ring)
};

export interface Hit {
  score: number;
  mult: 0 | 1 | 2 | 3;
  num: number; // 1..20, 25 for bull, 0 for miss
  label: string; // "T20", "D16", "25", "BULL", "7", "MISS"
  onBoard: boolean; // stuck in the board (vs. the wall)
}

export function scoreAt(x: number, y: number): Hit {
  const r = Math.hypot(x, y);
  if (r <= R.bull) return { score: 50, mult: 2, num: 25, label: "BULL", onBoard: true };
  if (r <= R.outerBull) return { score: 25, mult: 1, num: 25, label: "25", onBoard: true };
  if (r > R.doubleOut) return { score: 0, mult: 0, num: 0, label: "MISS", onBoard: r <= R.numbers };
  let deg = (Math.atan2(x, y) * 180) / Math.PI; // clockwise from top
  if (deg < 0) deg += 360;
  const num = ORDER[Math.floor((deg + 9) / 18) % 20];
  if (r >= R.doubleIn) return { score: num * 2, mult: 2, num, label: "D" + num, onBoard: true };
  if (r >= R.tripleIn && r <= R.tripleOut) return { score: num * 3, mult: 3, num, label: "T" + num, onBoard: true };
  return { score: num, mult: 1, num, label: String(num), onBoard: true };
}

/** Centre point of a bed, for aiming. mult 1 = the fat single area. */
export function spot(num: number, mult: 1 | 2 | 3): { x: number; y: number } {
  if (num === 25) return { x: 0, y: mult === 2 ? 0 : 0.012 };
  const i = ORDER.indexOf(num);
  const a = (i * 18 * Math.PI) / 180;
  const r = mult === 3 ? (R.tripleIn + R.tripleOut) / 2 : mult === 2 ? (R.doubleIn + R.doubleOut) / 2 : 0.135;
  return { x: Math.sin(a) * r, y: Math.cos(a) * r };
}

export function boardCanvas(size = 2048): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const k = size / 2 / R.numbers; // px per metre
  const cx = size / 2;
  g.translate(cx, cx);

  // numbers ring
  g.fillStyle = "#151515";
  g.beginPath();
  g.arc(0, 0, R.numbers * k, 0, Math.PI * 2);
  g.fill();

  const DARK = "#1c1a18", LIGHT = "#efe0bb", RED = "#d23a2c", GREEN = "#1e8c4e";
  const seg = (r0: number, r1: number, i: number, col: string) => {
    // canvas angles: 0 = +x, clockwise (y down). Our 0 = top, clockwise.
    const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180, a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
    g.fillStyle = col;
    g.beginPath();
    g.arc(0, 0, r1 * k, a0, a1);
    g.arc(0, 0, r0 * k, a1, a0, true);
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 20; i++) {
    const even = i % 2 === 0;
    seg(R.outerBull, R.doubleIn, i, even ? DARK : LIGHT);
    seg(R.doubleIn, R.doubleOut, i, even ? RED : GREEN);
    seg(R.tripleIn, R.tripleOut, i, even ? RED : GREEN);
  }
  g.fillStyle = GREEN;
  g.beginPath(); g.arc(0, 0, R.outerBull * k, 0, Math.PI * 2); g.fill();
  g.fillStyle = RED;
  g.beginPath(); g.arc(0, 0, R.bull * k, 0, Math.PI * 2); g.fill();

  // sisal grain
  for (let n = 0; n < 9000; n++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R.doubleOut * k;
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2, 2);
  }

  // wires
  g.strokeStyle = "#cfd4d8";
  g.lineWidth = size / 900;
  for (const r of [R.bull, R.outerBull, R.tripleIn, R.tripleOut, R.doubleIn, R.doubleOut]) {
    g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const a = ((i * 18 - 9 - 90) * Math.PI) / 180;
    g.beginPath();
    g.moveTo(Math.cos(a) * R.outerBull * k, Math.sin(a) * R.outerBull * k);
    g.lineTo(Math.cos(a) * R.doubleOut * k, Math.sin(a) * R.doubleOut * k);
    g.stroke();
  }

  // numbers
  g.fillStyle = "#f4f1ea";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold ${Math.round(size * 0.05)}px Arial, Helvetica, sans-serif`;
  for (let i = 0; i < 20; i++) {
    const a = ((i * 18 - 90) * Math.PI) / 180;
    const r = ((R.doubleOut + R.numbers) / 2) * k;
    g.save();
    g.translate(Math.cos(a) * r, Math.sin(a) * r);
    g.rotate(a + Math.PI / 2);
    g.fillText(String(ORDER[i]), 0, 0);
    g.restore();
  }
  return c;
}
