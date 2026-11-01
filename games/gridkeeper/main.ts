// Lights On (code name Gridkeeper), prototype step 1.
// A city grid you can watch, break, manipulate and stabilise.
// The simulation lives in ./sim and never imports Phaser; this file only draws it and wires taps.
import Phaser from "phaser";
import * as G from "./sim/grid";
import type { State, GNode, GLine } from "./sim/grid";
import { initPlatform, firstFrameReady, gameReady, onPause, onResume, loadSave, save, sendScore } from "../../src/platform/platform";

const GAME_ID = "gridkeeper";
const TICKS_PER_SEC = 2; // game minutes per real second at 1×  (a 8-hour shift ≈ 4 min at 1×, 1 min at 4×)

let s: State = G.newCity();
let speed = 1;
let paused = false; // platform pause
let acc = 0;
let sel: { kind: "line" | "node"; id: string } | null = null;
let preview: number[] | null = null;
let seenEvents = 0;
let slowUntil = 0; // real ms: auto slow-motion after the first trip
let firstTripSeen = false;
let best = { stars: 0, served: 0 };
let started = false;

const $ = (id: string) => document.getElementById(id)!;
const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

// ---------------------------------------------------------------------------
// World → screen fit

const WB = { x0: 15, x1: 730, y0: 110, y1: 950 };
let fit = { k: 1, ox: 0, oy: 0 };
function computeFit(w: number, h: number) {
  const top = 96, bottom = 70;
  const wide = w / h >= 5 / 4;
  const right = wide && sel ? 360 : 0;
  const aw = w - right - 16, ah = h - top - bottom;
  const k = Math.min(aw / (WB.x1 - WB.x0), ah / (WB.y1 - WB.y0));
  fit = { k, ox: 8 + (aw - (WB.x1 - WB.x0) * k) / 2 - WB.x0 * k, oy: top + (ah - (WB.y1 - WB.y0) * k) / 2 - WB.y0 * k };
}
const sx = (x: number) => fit.ox + x * fit.k;
const sy = (y: number) => fit.oy + y * fit.k;

// ---------------------------------------------------------------------------
// Colours

const C = { cool: 0x4fc3f7, warm: 0xffb300, hot: 0xff4d4d, dead: 0x3a4560, lamp: 0xffd76a, good: 0x5be38f, dark: 0x1a2236, text: "#e8eefc", dim: "#8b98b5" };
function loadColour(L: number): number {
  if (L < 0.7) return C.cool;
  if (L <= 1) return C.warm;
  return C.hot;
}
const ICON: Record<string, string> = { hydro: "💧", gas: "🔥", battery: "🔋", sub: "◆", homes: "🏠", commerce: "🏢", market: "🛒", flat: "✈️" };
function iconFor(n: GNode) {
  if (n.id === "hosp") return "🏥";
  if (n.kind === "district") return ICON[n.profile];
  return ICON[n.kind];
}

// ---------------------------------------------------------------------------
// Scene

class GridScene extends Phaser.Scene {
  g!: Phaser.GameObjects.Graphics;
  labels = new Map<string, Phaser.GameObjects.Text>();
  icons = new Map<string, Phaser.GameObjects.Text>();
  pct = new Map<string, Phaser.GameObjects.Text>();
  t = 0;

  constructor() { super("grid"); }

  create() {
    this.g = this.add.graphics();
    for (const n of s.nodes) {
      this.icons.set(n.id, this.add.text(0, 0, iconFor(n), { fontSize: "20px" }).setOrigin(0.5).setDepth(3));
      this.labels.set(n.id, this.add.text(0, 0, n.name, { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: C.text, stroke: "#070b14", strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(3));
    }
    for (const l of s.lines) this.pct.set(l.id, this.add.text(0, 0, "", { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px", color: C.text, stroke: "#070b14", strokeThickness: 3, fontStyle: "bold" }).setOrigin(0.5).setDepth(4));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => onTap(p.x, p.y));
    this.scale.on("resize", () => computeFit(this.scale.width, this.scale.height));
    computeFit(this.scale.width, this.scale.height);
    firstFrameReady();
  }

  update(_time: number, dtMs: number) {
    const dt = Math.min(dtMs, 100) / 1000;
    this.t += dt;
    if (started && !paused && !s.over) {
      let sp = speed;
      if (performance.now() < slowUntil && s.lines.some((l) => G.lineLoad(l) > 1)) sp = Math.min(sp, 0.1); // slow motion while the first crisis is live
      acc += dt * TICKS_PER_SEC * sp;
      let n = 0;
      while (acc >= 1 && n < 12 && !s.over) { acc -= 1; G.tick(s); n++; handleEvents(); }
      if (n) { if (sel?.kind === "line") preview = previewFor(sel.id); renderHud(); renderSheet(false); }
      if (s.over) endOfDay();
    }
    this.draw();
  }

  draw() {
    const g = this.g;
    g.clear();
    const k = fit.k;
    const storm = s.storm && s.minute >= s.storm.start && s.minute <= s.storm.end;

    // storm cloud over the target line
    if (s.storm) {
      const l = s.lines.find((x) => x.id === s.storm!.target)!;
      const A = s.nodes[l.a], B = s.nodes[l.b];
      const cx = sx((A.x + B.x) / 2), cy = sy((A.y + B.y) / 2);
      const until = s.storm.start - s.minute;
      if (storm || (until > 0 && until <= 90)) {
        const a = storm ? 0.22 + 0.06 * Math.sin(this.t * 3) : 0.08;
        g.fillStyle(0x6f86c9, a);
        g.fillCircle(cx, cy, 120 * k);
        g.fillCircle(cx + 70 * k, cy - 30 * k, 80 * k);
        if (storm && Math.sin(this.t * 7.3) > 0.985) { g.fillStyle(0xffffff, 0.25); g.fillCircle(cx, cy, 160 * k); }
      }
    }

    // lines
    s.lines.forEach((l, i) => {
      const A = s.nodes[l.a], B = s.nodes[l.b];
      const x1 = sx(A.x), y1 = sy(A.y), x2 = sx(B.x), y2 = sy(B.y);
      const L = G.lineLoad(l);
      const w = Math.max(2, (2 + l.limit / 40) * k * 1.4);
      const selected = sel?.kind === "line" && sel.id === l.id;
      if (selected) { g.lineStyle(w + 10, 0xffffff, 0.12); g.lineBetween(x1, y1, x2, y2); }
      const t = this.pct.get(l.id)!;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (l.tripped) {
        dashed(g, x1, y1, x2, y2, w * 0.7, C.dead, 0.9, 6, 6);
        g.lineStyle(3, C.hot, 1);
        g.lineBetween(mx - 7, my - 7, mx + 7, my + 7); g.lineBetween(mx - 7, my + 7, mx + 7, my - 7);
        t.setText(l.repair > 0 ? `🔧${l.repair}m` : "DOWN").setPosition(mx, my - 16).setColor(l.repair > 0 ? "#ffb300" : "#ff4d4d").setVisible(true);
        return;
      }
      if (!l.closed) {
        dashed(g, x1, y1, x2, y2, w * 0.6, 0x55607a, 0.8, 4, 8);
        g.fillStyle(0x070b14, 1); g.fillCircle(mx, my, 7); g.lineStyle(2, 0x8b98b5, 1); g.strokeCircle(mx, my, 7);
        t.setText("open").setPosition(mx, my - 16).setColor(C.dim).setVisible(true);
        return;
      }
      const col = loadColour(L);
      const pulse = L > 1 ? 0.6 + 0.4 * Math.sin(this.t * 10) : 1;
      g.lineStyle(w + 6, col, 0.12 * pulse); g.lineBetween(x1, y1, x2, y2);
      g.lineStyle(w, col, 0.85 * pulse); g.lineBetween(x1, y1, x2, y2);
      // flow dots
      const len = Math.hypot(x2 - x1, y2 - y1);
      const dir = l.flow >= 0 ? 1 : -1;
      if (Math.abs(l.flow) > 0.5) {
        const gap = 26;
        const ph = (this.t * (30 + 90 * Math.min(L, 1.6))) % gap;
        g.fillStyle(0xffffff, 0.85);
        for (let d = dir > 0 ? ph : gap - ph; d < len; d += gap) {
          const f = d / len;
          const px = x1 + (x2 - x1) * f, py = y1 + (y2 - y1) * f;
          g.fillCircle(px, py, Math.max(1.5, w * 0.28));
        }
      }
      // heat fuse at midpoint
      if (l.heat > 0.5) {
        const bw = 34, bh = 5;
        g.fillStyle(0x070b14, 0.9); g.fillRect(mx - bw / 2 - 1, my + 8, bw + 2, bh + 2);
        g.fillStyle(l.heat > 66 ? C.hot : C.warm, 1); g.fillRect(mx - bw / 2, my + 9, (bw * l.heat) / 100, bh);
      }
      // label: percentage, and the preview if a breaker toggle is being considered
      let txt = "", colour = C.text;
      if (preview && sel?.kind === "line") {
        const p = preview[i];
        if (Math.abs(p - L) > 0.03 || l.id === sel.id) { txt = `${Math.round(L * 100)}→${Math.round(p * 100)}%`; colour = p > 1 ? "#ff4d4d" : p >= 0.7 ? "#ffb300" : "#4fc3f7"; }
      } else if (L >= 0.7 || selected) { txt = `${Math.round(L * 100)}%`; colour = L > 1 ? "#ff4d4d" : "#ffb300"; }
      t.setText(txt).setPosition(mx, my - 12).setColor(colour).setVisible(!!txt);
    });

    // nodes
    for (const n of s.nodes) {
      const x = sx(n.x), y = sy(n.y);
      const selected = sel?.kind === "node" && sel.id === n.id;
      const ic = this.icons.get(n.id)!, lb = this.labels.get(n.id)!;
      const r = (n.kind === "sub" ? 14 : n.kind === "district" ? 24 : 26) * Math.max(0.75, k * 1.15);
      if (selected) { g.lineStyle(3, 0xffffff, 0.6); g.strokeCircle(x, y, r + 7); }
      if (n.kind === "district") {
        if (n.served) {
          g.fillStyle(C.lamp, 0.10 + 0.03 * Math.sin(this.t * 2 + n.x)); g.fillCircle(x, y, r * 1.9);
          g.fillStyle(C.lamp, 0.22); g.fillCircle(x, y, r * 1.3);
          g.fillStyle(0x2a2a18, 1); g.fillCircle(x, y, r);
          g.lineStyle(2, C.lamp, 0.9); g.strokeCircle(x, y, r);
        } else {
          g.fillStyle(0x0b0f19, 1); g.fillCircle(x, y, r);
          g.lineStyle(2, n.critical ? C.hot : C.dead, n.critical ? 0.6 + 0.4 * Math.sin(this.t * 8) : 1); g.strokeCircle(x, y, r);
        }
        if (n.critical) { g.lineStyle(2, C.hot, 0.5); g.strokeCircle(x, y, r + 4); }
        ic.setAlpha(n.served ? 1 : 0.35);
        lb.setText(`${n.name}${n.served ? "" : " · dark"}\n${Math.round(n.demand)} MW`).setColor(n.served ? C.text : "#ff8a8a");
      } else if (n.kind === "sub") {
        g.fillStyle(0x16203a, 1); g.lineStyle(2, 0x8fa3c9, 1);
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fillPath(); g.strokePath();
        ic.setVisible(false);
        lb.setText(n.name).setColor(C.dim);
      } else {
        // plant: ring gauge of output vs capacity
        g.fillStyle(0x10182b, 1); g.fillCircle(x, y, r);
        g.lineStyle(4, 0x23304d, 1); g.strokeCircle(x, y, r);
        const frac = n.kind === "battery" ? Math.abs(n.out) / n.cap : n.out / n.cap;
        const col = n.kind === "battery" && n.out < 0 ? C.good : C.cool;
        if (frac > 0.005) { g.lineStyle(4, col, 1); g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac)); g.strokePath(); }
        if (n.kind === "battery") { g.fillStyle(C.good, 0.9); g.fillRect(x - r, y + r + 2, (2 * r * n.soc) / n.socMax, 3); }
        const mode = n.kind === "battery" ? (n.out < -0.5 ? "charging" : n.out > 0.5 ? "discharging" : n.auto ? "auto" : "idle") : n.auto ? "auto" : "manual";
        lb.setText(`${n.name}\n${Math.round(n.out)}/${n.cap} MW · ${mode}`).setColor(C.text);
      }
      ic.setPosition(x, y).setFontSize(Math.round(r * 0.85));
      lb.setPosition(x, y + r + (n.kind === "battery" ? 7 : 4)).setFontSize(Math.max(10, Math.round(12 * Math.min(1.2, k * 1.4))));
    }
  }
}

function dashed(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, w: number, col: number, a: number, on: number, off: number) {
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  g.lineStyle(w, col, a);
  for (let d = 0; d < len; d += on + off) {
    const e = Math.min(len, d + on);
    g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
  }
}

// ---------------------------------------------------------------------------
// Taps

function onTap(px: number, py: number) {
  if (!started) return;
  let bestNode: GNode | null = null, bd = 34;
  for (const n of s.nodes) { const d = Math.hypot(sx(n.x) - px, sy(n.y) - py); if (d < bd) { bd = d; bestNode = n; } }
  if (bestNode) return select({ kind: "node", id: bestNode.id });
  let bestLine: GLine | null = null; bd = 22;
  for (const l of s.lines) {
    const A = s.nodes[l.a], B = s.nodes[l.b];
    const d = segDist(px, py, sx(A.x), sy(A.y), sx(B.x), sy(B.y));
    if (d < bd) { bd = d; bestLine = l; }
  }
  if (bestLine) return select({ kind: "line", id: bestLine.id });
  select(null);
}
function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

function select(next: typeof sel) {
  sel = next;
  preview = sel?.kind === "line" ? previewFor(sel.id) : null;
  const sc = game.scene.getScene("grid") as GridScene;
  computeFit(sc.scale.width, sc.scale.height);
  renderSheet(true);
}
function previewFor(id: string): number[] | null {
  const l = s.lines.find((x) => x.id === id);
  return l && !l.tripped ? G.previewToggle(s, id) : null;
}

// ---------------------------------------------------------------------------
// Bottom sheet (DOM)

function renderSheet(force: boolean) {
  const el = $("sheet");
  if (!sel) { el.classList.remove("on"); return; }
  // don't rebuild while a finger is on a button (keeps taps reliable); refresh numbers only
  if (!force && el.matches(":active")) return;
  el.classList.add("on");
  if (sel.kind === "line") el.innerHTML = lineSheet(s.lines.find((l) => l.id === sel!.id)!);
  else el.innerHTML = nodeSheet(s.nodes.find((n) => n.id === sel!.id)!);
}

function head(icon: string, title: string, sub: string) {
  return `<div class="sh-h"><span class="ic">${icon}</span><div><b>${esc(title)}</b><small>${sub}</small></div><button class="x" data-act="close" aria-label="Close">✕</button></div>`;
}

function lineSheet(l: GLine): string {
  const A = s.nodes[l.a].name, B = s.nodes[l.b].name, L = G.lineLoad(l);
  const status = l.tripped ? (l.repair > 0 ? `Crew repairing, ${l.repair} min left` : "Tripped, needs a crew") : l.closed ? "In service" : "Breaker open (you)";
  const fuse = l.heat > 0.5 && G.isLive(l) ? (L > 1 ? `trips in about ${Math.max(1, Math.round((100 - l.heat) / (G.HEAT_RATE * (L * L - 1))))} min` : "cooling") : "cool";
  let html = head("⚡", `${A} – ${B}`, status) + `<div class="kv">
    <div><span>Load</span><b style="color:${L > 1 ? "var(--hot)" : L >= 0.7 ? "var(--warm)" : "var(--text)"}">${Math.round(L * 100)}%</b></div>
    <div><span>Flow</span><b>${Math.round(Math.abs(l.flow))} MW</b></div>
    <div><span>Limit</span><b>${l.limit} MW</b></div></div>
    <div class="hint">Heat <b>${Math.round(l.heat)}/100</b>, ${fuse}</div><div class="bar"><i style="width:${l.heat}%;background:${l.heat > 66 ? "var(--hot)" : "var(--warm)"}"></i></div>`;
  if (l.tripped) {
    html += `<div class="row">${l.repair > 0 ? `<span class="hint">Crew on the way. Meanwhile, move power off its neighbours.</span>` : `<button class="btn pri" data-act="repair">🔧 Send repair crew (${G.REPAIR_MIN} min)</button>`}</div>`;
  } else {
    const worst = preview ? Math.max(...preview) : 0;
    const darkAfter = preview ? previewDarkens(l.id) : [];
    const verdict = !preview ? "" : darkAfter.length ? `<b style="color:var(--hot)">Would black out ${esc(darkAfter.join(", "))}.</b>` : worst > 1 ? `Worst line would be <b style="color:var(--hot)">${Math.round(worst * 100)}%</b>.` : `Worst line would be <b>${Math.round(worst * 100)}%</b>.`;
    html += `<div class="hint">Preview on map: ${l.closed ? "opening" : "closing"} this breaker. ${verdict}</div>
      <div class="row"><button class="btn ${l.closed ? "" : "pri"}" data-act="breaker">${l.closed ? "Open breaker" : "Close breaker"}</button>
      ${l.closed ? `<button class="btn ghost" data-act="cut">Cut it (test)</button>` : ""}</div>`;
  }
  return html;
}

function previewDarkens(id: string): string[] {
  const clone: State = JSON.parse(JSON.stringify(s));
  const l = clone.lines.find((x) => x.id === id)!;
  l.closed = !l.closed;
  G.balanceAndSolve(clone, false);
  return clone.nodes.filter((n, i) => n.kind === "district" && s.nodes[i].served && !n.served).map((n) => n.name);
}

function nodeSheet(n: GNode): string {
  if (G.isPlant(n)) {
    const sub = n.kind === "hydro" ? "Cheap, fast to ramp, limited water" : n.kind === "gas" ? "Pricier, ramps slowly" : "Stores energy, instant response";
    let html = head(iconFor(n), n.name, sub) + `<div class="kv">
      <div><span>Output</span><b>${Math.round(n.out)} MW</b></div>
      <div><span>Target</span><b>${Math.round(n.set)} MW</b></div>
      <div><span>${n.kind === "battery" ? "Charge" : "Max"}</span><b>${n.kind === "battery" ? Math.round((100 * n.soc) / n.socMax) + "%" : n.cap + " MW"}</b></div></div>`;
    html += `<div class="row"><div class="step"><button data-act="dn10" aria-label="Lower">−</button><b>${Math.round(n.set)} MW</b><button data-act="up10" aria-label="Raise">+</button></div>
      <button class="toggle ${n.auto ? "on" : ""}" data-act="auto"><i></i>Auto follow demand</button></div>
      <div class="hint">${n.auto ? "On auto it follows city demand. Lower or raise it to take manual control, e.g. to keep a line from overloading." : `Manual: holds ${Math.round(n.set)} MW, ramping ${n.ramp} MW/min. Turn Auto back on when the danger passes.`}</div>`;
    return html;
  }
  if (n.kind === "sub") return head("◆", n.name, "Substation: power passes through here") + `<div class="hint">Substations join lines. Tap a line to see its load and breaker.</div>`;
  const why: Record<string, string> = { auto: "the grid shed it automatically to save frequency", player: "you switched it off", island: "it was cut off from every power plant", capacity: "there was not enough power" };
  let html = head(iconFor(n), n.name, `${n.profile === "homes" ? "Homes" : n.profile === "commerce" ? "Offices and shops" : n.profile === "market" ? "Market" : n.critical ? "Critical: never let it go dark" : "Round-the-clock load"}`) +
    `<div class="kv"><div><span>Demand</span><b>${Math.round(n.demand)} MW</b></div><div><span>Status</span><b style="color:${n.served ? "var(--lamp)" : "var(--hot)"}">${n.served ? "Lit" : "Dark"}</b></div><div><span>Priority</span><b>${n.critical ? "Top" : n.priority}</b></div></div>`;
  if (!n.served && n.shedBy) html += `<div class="hint">Dark because ${why[n.shedBy] ?? "of a fault"}.${n.shedBy !== "player" ? " It comes back by itself once there is room." : ""}</div>`;
  html += `<div class="row"><button class="btn ${n.served ? "hot" : "pri"}" data-act="district">${n.served ? "Switch off (rolling blackout)" : "Switch back on"}</button></div>`;
  if (n.served) html += `<div class="hint">Switching a small district off on purpose can save a line from tripping and taking out more.</div>`;
  return html;
}

$("sheet").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
  if (!b || !sel) return;
  const act = b.dataset.act!;
  const id = sel.id;
  if (act === "close") return select(null);
  if (act === "breaker") G.toggleBreaker(s, id);
  if (act === "cut") G.cutLine(s, id);
  if (act === "repair") G.repairLine(s, id);
  if (act === "district") G.toggleDistrict(s, id);
  const n = s.nodes.find((x) => x.id === id);
  if (n && (act === "up10" || act === "dn10")) G.setPlant(s, id, n.set + (act === "up10" ? 25 : -25));
  if (n && act === "auto") G.setAuto(s, id, !n.auto);
  handleEvents();
  preview = sel?.kind === "line" ? previewFor(id) : null;
  renderHud();
  renderSheet(true);
});

// ---------------------------------------------------------------------------
// HUD, toasts and coaching

let toastTimer = 0;
function toast(text: string, kind: "" | "info" | "good" = "", ms = 4200) {
  const t = $("toast");
  t.className = "on " + kind;
  t.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("on"), ms);
}

function handleEvents() {
  while (seenEvents < s.events.length) {
    const ev = s.events[seenEvents++];
    if (ev.kind === "trip") {
      const l = s.lines.find((x) => x.id === ev.line)!;
      toast(ev.text, "", 5000);
      if (!firstTripSeen) {
        firstTripSeen = true;
        slowUntil = performance.now() + 25000; // slow motion until the player acts (or 25 s)
        coachAfterTrip(l);
      }
    } else if (ev.kind === "storm") toast("⛈ " + ev.text, "info");
    else if (ev.kind === "shed") toast("🌑 " + ev.text, "", 5000);
    else if (ev.kind === "restore") toast("💡 " + ev.text, "good", 2600);
  }
}

function coachAfterTrip(down: GLine) {
  const hottest = [...s.lines].filter(G.isLive).sort((a, b) => G.lineLoad(b) - G.lineLoad(a))[0];
  if (!hottest || G.lineLoad(hottest) < 0.9) { toast(`Power rerouted itself. Tap the broken line to send a crew.`, "info", 6000); return; }
  const A = s.nodes[hottest.a], B = s.nodes[hottest.b];
  const feeder = G.isPlant(A) ? A : G.isPlant(B) ? B : null;
  const from = `${s.nodes[down.a].name} – ${s.nodes[down.b].name}`;
  toast(feeder
    ? `${from} is down, so its power crowds onto ${A.name} – ${B.name}. Tap ${feeder.name} and lower its output, then tap the broken line to send a crew.`
    : `${from} is down, so ${A.name} – ${B.name} is overloaded. Ease it before its fuse runs out.`, "info", 12000);
  $("toast").textContent = "🐢 Slow motion. " + $("toast").textContent;
}

function renderHud() {
  $("time").textContent = G.fmtTime(s.minute);
  const tot = G.totals(s);
  const hz = tot.hz;
  $("hz").textContent = hz.toFixed(2) + " Hz";
  const box = $("hzbox");
  box.classList.toggle("bad", hz < 49.5 || hz > 50.5);
  box.classList.toggle("warn", (hz < 49.85 || hz > 50.15) && !(hz < 49.5 || hz > 50.5));
  $("hzbar").style.left = `calc(${Math.max(0, Math.min(100, 50 + (hz - 50) * 50))}% - 1.5px)`;
  ($("hzbar") as HTMLElement).style.background = hz < 49.5 || hz > 50.5 ? "var(--hot)" : hz < 49.85 || hz > 50.15 ? "var(--warm)" : "var(--good)";
  const pct = G.servedPct(s) * 100;
  $("served").textContent = (pct >= 99.95 ? "100" : pct.toFixed(1)) + "%";
  const dark = s.nodes.filter((n) => n.kind === "district" && !n.served).length;
  $("sub").textContent = dark ? `${dark} district${dark > 1 ? "s" : ""} dark` : s.over ? "Shift over" : "Evening shift";

  // forecast strip
  let peakAt = s.minute, peak = 0;
  for (let m = s.minute; m <= Math.min(s.end, s.minute + 180); m += 10) { const d = G.forecastDemand(s, m); if (d > peak) { peak = d; peakAt = m; } }
  const st = s.storm;
  let stormTxt = "";
  if (st && !s.over) {
    if (s.minute < st.start) stormTxt = ` · <span class="storm">⛈ storm ${G.fmtTime(st.start)}, near ${s.nodes[s.lines.find((l) => l.id === st.target)!.a].name}</span>`;
    else if (s.minute <= st.end) stormTxt = ` · <span class="storm">⛈ storm until ${G.fmtTime(st.end)}</span>`;
  }
  $("forecast").innerHTML = `Demand <b>${Math.round(tot.served)} MW</b> · peak <b>${Math.round(peak)} MW</b> at ${G.fmtTime(peakAt)} · plants <b>${Math.round(tot.capacity)} MW</b>${stormTxt}`;

  // alert pill: hottest live line
  const hot = [...s.lines].filter((l) => G.isLive(l) && (G.lineLoad(l) > 1 || l.heat > 30)).sort((a, b) => b.heat - a.heat)[0];
  const alert = $("alert");
  if (hot) {
    const L = G.lineLoad(hot);
    const mins = L > 1 ? Math.max(1, Math.round((100 - hot.heat) / (G.HEAT_RATE * (L * L - 1)))) : 0;
    $("alertText").textContent = `${s.nodes[hot.a].name} – ${s.nodes[hot.b].name} ${Math.round(L * 100)}%${mins ? `, trips in ~${mins} min` : ", cooling"}`;
    alert.dataset.line = hot.id;
    alert.classList.remove("hidden");
  } else alert.classList.add("hidden");
}
$("alert").addEventListener("click", () => { const id = $("alert").dataset.line; if (id) select({ kind: "line", id }); });

document.querySelectorAll<HTMLButtonElement>("#speed button").forEach((b) =>
  b.addEventListener("click", () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll("#speed button").forEach((x) => x.classList.toggle("on", x === b));
  }),
);

// ---------------------------------------------------------------------------
// Intro and end of day

function intro() {
  const m = $("modal");
  m.className = "on";
  m.innerHTML = `<div class="card">
    <h1>Lights <i>On</i></h1>
    <p>You run the power grid of a hill city. Tonight's shift: <b style="color:var(--text)">16:00 to midnight</b>. A storm rolls in at 18:30.</p>
    <ul>
      <li><b>Lines glow</b> blue when calm, amber when busy, <b style="color:var(--hot)">red</b> when overloaded. An overloaded line heats up and trips.</li>
      <li>When one line trips, its power <b>shifts onto the others</b>. That is how blackouts spread.</li>
      <li><b>Tap a line</b> to open its breaker (the map previews the result). <b>Tap a plant</b> to raise or lower it.</li>
      <li>Keep the <b>Hospital</b> lit and the grid near <b>50 Hz</b>.</li>
    </ul>
    ${best.stars ? `<p>Your best: ${"★".repeat(best.stars)}${"☆".repeat(3 - best.stars)} (${best.served.toFixed(1)}% lit)</p>` : ""}
    <button class="btn pri" data-act="start">Start the shift</button></div>`;
  m.querySelector("[data-act=start]")!.addEventListener("click", () => {
    m.className = "";
    started = true;
    toast("Calm for now. Watch the line near the River Dam when the storm arrives.", "info", 6000);
  });
}

function endOfDay() {
  if ($("modal").classList.contains("on")) return;
  const served = G.servedPct(s) * 100;
  const hospDark = s.events.some((e) => e.kind === "shed" && e.node === "hosp");
  const stars = [served >= 99, !hospDark && s.stats.worstChain <= 3, s.stats.minF >= G.UFLS_HZ];
  const n = stars.filter(Boolean).length;
  if (n > best.stars || (n === best.stars && served > best.served)) { best = { stars: n, served }; void save(GAME_ID, JSON.stringify(best)); sendScore(n * 1000 + Math.round(served * 10)); }
  const m = $("modal");
  m.className = "on";
  const log = s.events.filter((e) => e.kind !== "info").slice(-30).reverse().map((e) => `<div><b>${G.fmtTime(e.minute)}</b> ${esc(e.text)}</div>`).join("");
  m.innerHTML = `<div class="card">
    <h2>Shift over</h2>
    <div class="stars">${stars.map((ok) => `<span class="${ok ? "" : "off"}">⭐</span>`).join("")}</div>
    <ul>
      <li>${stars[0] ? "⭐" : "☆"} <b>Lights on ${served.toFixed(1)}%</b> of the energy the city wanted (need 99%)</li>
      <li>${stars[1] ? "⭐" : "☆"} <b>Safety:</b> hospital ${hospDark ? "went dark" : "stayed lit"}, worst chain of trips ${s.stats.worstChain} (need ≤ 3)</li>
      <li>${stars[2] ? "⭐" : "☆"} <b>Frequency</b> lowest ${s.stats.minF.toFixed(2)} Hz (need ≥ ${G.UFLS_HZ})</li>
    </ul>
    <p>${n === 3 ? "A perfect shift. The city never noticed you were there." : "Tip: when a line trips, find the line that turned red and take power off it, by lowering the plant that feeds it or opening a breaker."}</p>
    <div class="log">${log || "<div>A quiet night.</div>"}</div>
    <button class="btn pri" data-act="retry">Play the shift again</button></div>`;
  m.querySelector("[data-act=retry]")!.addEventListener("click", () => {
    s = G.newCity();
    seenEvents = 0; firstTripSeen = false; sel = null; preview = null; acc = 0;
    m.className = "";
    renderSheet(true);
    renderHud();
    toast("Same city, same storm. Try to beat it.", "info");
  });
}

// ---------------------------------------------------------------------------
// Boot

initPlatform();
onPause(() => { paused = true; });
onResume(() => { paused = false; });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#070b14",
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [GridScene],
  render: { antialias: true },
  audio: { noAudio: true },
});

renderHud();
loadSave(GAME_ID).then((raw) => {
  try { const b = JSON.parse(raw); if (b && typeof b.stars === "number") best = b; } catch { /* no save */ }
  intro();
  gameReady();
});

// test hook: ?debug exposes the state
if (location.search.includes("debug")) (window as unknown as { gk: unknown }).gk = { get s() { return s; }, G, setSpeed: (v: number) => (speed = v) };
