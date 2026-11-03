// Game-mode rules that don't need the 3D scene: checkouts and cricket.
import { Hit } from "./board";

export type GameId = "x501" | "x301" | "cricket" | "english" | "nine" | "attack";

export const GAMES: Record<GameId, { name: string; short: string; rules: string; vs: boolean }> = {
  x501: { name: "501", short: "501", vs: true, rules: "Count down from 501. Finish on a double or the bull." },
  x301: { name: "301", short: "301", vs: true, rules: "Count down from 301. Finish on a double or the bull." },
  cricket: { name: "Cricket", short: "Cricket", vs: true,
    rules: "Close 15 to 20 and the bull with 3 marks each. Score on numbers your rival hasn't closed." },
  english: { name: "English Cricket", short: "English", vs: true,
    rules: "Batter scores runs for every point over 40 in a turn. Bowler takes wickets on the bull. 10 wickets or 8 overs per innings." },
  nine: { name: "Nine-Dart Finish", short: "9 Darts", vs: false, rules: "Clear 501 in nine darts, finishing on a double." },
  attack: { name: "Score Attack", short: "Attack", vs: false, rules: "30 darts. Score as much as you can." },
};

// ----- X01 checkouts -----------------------------------------------------
export interface Bed { num: number; mult: 1 | 2 | 3; score: number; label: string }
const bed = (num: number, mult: 1 | 2 | 3): Bed => ({
  num, mult, score: num * mult,
  label: num === 25 ? (mult === 2 ? "BULL" : "25") : (mult === 3 ? "T" : mult === 2 ? "D" : "") + num,
});
const ALL: Bed[] = [];
for (let n = 1; n <= 20; n++) ALL.push(bed(n, 1), bed(n, 2), bed(n, 3));
ALL.push(bed(25, 1), bed(25, 2));
const DOUBLES = ALL.filter((b) => b.mult === 2);

function setupCost(b: Bed) {
  if (b.num === 25) return b.mult === 2 ? 7 : 5;
  if (b.mult === 3) return 3 + (20 - b.num) / 4;
  if (b.mult === 2) return 8;
  return b.num >= 16 ? 0 : 1;
}
function finishCost(b: Bed) {
  if (b.num === 25) return 4;
  if (b.num === 20 || b.num === 16) return 0;
  if ([8, 10, 12, 18, 4].includes(b.num)) return 1;
  return 2;
}

const memo = new Map<string, Bed[] | null>();
/** Cheapest way to finish `r` in at most `n` darts, last dart a double. */
export function checkout(r: number, n: number): Bed[] | null {
  if (r < 2 || r > 170 || n < 1) return null;
  const key = r + ":" + n;
  if (memo.has(key)) return memo.get(key)!;
  let best: Bed[] | null = null, bestCost = Infinity;
  const consider = (route: Bed[]) => {
    const c = route.length * 100 + route.slice(0, -1).reduce((a, b) => a + setupCost(b), 0) + finishCost(route[route.length - 1]);
    if (c < bestCost) { bestCost = c; best = route; }
  };
  for (const d of DOUBLES) if (d.score === r) consider([d]);
  if (!best && n >= 2)
    for (const a of ALL) for (const d of DOUBLES) if (a.score + d.score === r) consider([a, d]);
  if (!best && n >= 3)
    for (const a of ALL) for (const b of ALL) {
      if (b.score > a.score) continue; // biggest first
      const rest = r - a.score - b.score;
      for (const d of DOUBLES) if (d.score === rest) consider([a, b, d]);
    }
  memo.set(key, best);
  return best;
}

/** Where to throw next in X01 with double out. */
export function x01Target(r: number, dartsLeft: number): Bed {
  const route = checkout(r, dartsLeft);
  if (route) return route[0];
  if (r > 170) return bed(20, 3);
  // Can't finish this turn: set up a good double for next turn.
  for (const want of [32, 40, 16, 24, 36, 20, 8]) {
    const need = r - want;
    if (need <= 0) continue;
    for (const b of [bed(20, 3), bed(19, 3), ...ALL.filter((x) => x.mult === 1)])
      if (b.score === need) return b;
  }
  return r > 60 ? bed(20, 3) : bed(Math.min(20, Math.max(1, r - 32)), 1);
}

export const isBust = (left: number, hit: Hit) => left < 0 || left === 1 || (left === 0 && hit.mult !== 2);

// ----- Cricket -------------------------------------------------------------
export const CRICKET_NUMS = [20, 19, 18, 17, 16, 15, 25];
export const cricketIdx = (h: Hit) => CRICKET_NUMS.indexOf(h.num);
export const markSym = (m: number) => (m <= 0 ? "" : m === 1 ? "/" : m === 2 ? "X" : "Ⓧ");
