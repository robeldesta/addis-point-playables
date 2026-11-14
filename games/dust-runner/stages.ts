// Timed stages on the desert loop. Times are seconds; medal targets were set
// from simulated runs (about 48 s per lap for a clean, quick drive).
export interface Stage { id: string; name: string; blurb: string; start: number; laps: number; gold: number; silver: number; bronze: number }

const mk = (id: string, name: string, blurb: string, start: number, laps: number): Stage => {
  const ref = 2 + 48 * laps;
  const r = (v: number) => Math.round(v * 2) / 2;
  return { id, name, blurb, start, laps, gold: r(ref * 0.9), silver: r(ref * 1.05), bronze: r(ref * 1.35) };
};

export const STAGES: Stage[] = [
  mk("warmup", "Warm Up", "One lap from the start arch", 0, 1),
  mk("whoops", "Washboard", "Whoops, a kicker and a gap jump", 0.55, 1.2),
  mk("roller", "Rollercoaster", "Rollers, tabletop and a long run", 0.25, 1.4),
  mk("bigair", "Big Air Run", "Every jump, flat out", 0.7, 1.5),
  mk("endure", "Endurance", "Two full laps. Stay on the road", 0, 2),
];

export type Medal = "gold" | "silver" | "bronze" | "";
export const medalFor = (s: Stage, t: number): Medal =>
  !t ? "" : t <= s.gold ? "gold" : t <= s.silver ? "silver" : t <= s.bronze ? "bronze" : "";
export const MEDAL_ICON: Record<Medal, string> = { gold: "🥇", silver: "🥈", bronze: "🥉", "": "" };
