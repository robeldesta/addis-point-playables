// Network solver: DC power flow, plus island detection.
// Pure functions, no game state, so they can be tested on textbook circuits.

export interface FlowLine { a: number; b: number; x: number; closed: boolean }

/** Group node indices into islands connected by closed lines. */
export function islands(nNodes: number, lines: FlowLine[]): number[][] {
  const adj: number[][] = Array.from({ length: nNodes }, () => []);
  for (const l of lines) if (l.closed) { adj[l.a].push(l.b); adj[l.b].push(l.a); }
  const seen = new Array<boolean>(nNodes).fill(false);
  const out: number[][] = [];
  for (let s = 0; s < nNodes; s++) {
    if (seen[s]) continue;
    const group: number[] = [];
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const v = stack.pop()!;
      group.push(v);
      for (const w of adj[v]) if (!seen[w]) { seen[w] = true; stack.push(w); }
    }
    out.push(group.sort((a, b) => a - b));
  }
  return out;
}

/**
 * Solve B·θ = P on one island and return the flow on every line (MW, positive a→b).
 * `inject` is net injection per node (generation − load); it must sum to ~0 over the island.
 * Lines outside the island, or open, get 0.
 */
export function solveIsland(island: number[], lines: FlowLine[], inject: number[], flows: number[]): void {
  const n = island.length;
  if (n < 2) return;
  const idx = new Map<number, number>();
  island.forEach((v, i) => idx.set(v, i));
  // reduced system: drop island[0] as the angle reference
  const m = n - 1;
  const B: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const P: number[] = new Array<number>(m).fill(0);
  for (let i = 1; i < n; i++) P[i - 1] = inject[island[i]];
  for (const l of lines) {
    if (!l.closed) continue;
    const i = idx.get(l.a), j = idx.get(l.b);
    if (i === undefined || j === undefined) continue;
    const b = 1 / l.x;
    if (i > 0) B[i - 1][i - 1] += b;
    if (j > 0) B[j - 1][j - 1] += b;
    if (i > 0 && j > 0) { B[i - 1][j - 1] -= b; B[j - 1][i - 1] -= b; }
  }
  const th = gauss(B, P);
  const theta = (v: number) => { const i = idx.get(v)!; return i === 0 ? 0 : th[i - 1]; };
  lines.forEach((l, k) => {
    if (!l.closed || !idx.has(l.a) || !idx.has(l.b)) return;
    flows[k] = (theta(l.a) - theta(l.b)) / l.x;
  });
}

/** Gaussian elimination with partial pivoting. Small dense systems only. */
export function gauss(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) continue; // singular (shouldn't happen on a connected island)
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = Math.abs(M[r][r]) < 1e-12 ? 0 : s / M[r][r];
  }
  return x;
}
