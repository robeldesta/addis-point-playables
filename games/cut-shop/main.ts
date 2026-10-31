import * as S from "./sim";
import { SEG, SEGS, MAT, MATS, MACH, TIERS, UPG, fmt, type State, type SegId, type MachineKind, type UpgradeId, type Report } from "./sim";
import { Sfx } from "./sfx";
import { initPlatform, firstFrameReady, gameReady, onPause, onResume, onAudioChange, isAudioEnabled, loadSave, save, sendScore } from "../../src/platform/platform";

const GAME_ID = "cut-shop";
type Tab = "market" | "shop" | "supply" | "money" | "rivals";

let s: State;
let tab: Tab = "market";
let playing = false;
let paused = false;
let readySent = false;
let rivalSeg: SegId = "stands";
const sfx = new Sfx();

const $ = (id: string) => document.getElementById(id)!;
const money = (n: number) => (n < 0 ? "−$" : "$") + fmt(Math.abs(n));
const money2 = (n: number) => "$" + n.toFixed(2);
const pct = (x: number) => Math.round(x * 100) + "%";
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------------------
// Save / load

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => save(GAME_ID, JSON.stringify(s)), 300);
}

// ---------------------------------------------------------------------------
// Rendering

function render() {
  renderTop();
  renderTabs();
  renderPanel();
  renderGo();
}

function renderTop() {
  const worth = S.netWorth(s);
  const w = ((s.week - 1) % 52) + 1;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Math.min(11, Math.floor((w - 1) / 4.34))];
  $("top").innerHTML = `
    <div class="wk">Week ${s.week}<small>${s.week <= S.WEEKS ? `${month} · ${S.WEEKS - s.week + 1} weeks left` : `${month} · bonus year`}</small></div>
    <div class="stat"><span>Cash</span><b class="${s.cash < 0 ? "neg" : ""}">${money(s.cash)}</b></div>
    <div class="stat"><span>Net worth</span><b>${money(worth)}</b></div>`;
}

function renderTabs() {
  const hasContract = s.contracts.some((c) => c.status === "open");
  const lowMat = MATS.some((m) => s.inv[m] < weeklyUse(m) * 0.5 && weeklyUse(m) > 0);
  const broken = s.machines.some((m) => m.cond < 45);
  const tabs: [Tab, string, boolean][] = [
    ["market", "Market", hasContract],
    ["shop", "Shop", broken],
    ["supply", "Supply", lowMat],
    ["money", "Money", s.cash < 1500],
    ["rivals", "Rivals", false],
  ];
  $("tabs").innerHTML = tabs.map(([id, label, dot]) => `<button data-a="tab" data-k="${id}" class="${tab === id ? "on" : ""}">${label}${dot ? '<span class="dot"></span>' : ""}</button>`).join("");
}

function renderPanel() {
  const p = $("panel");
  const top = p.scrollTop;
  p.innerHTML = tab === "market" ? marketTab() : tab === "shop" ? shopTab() : tab === "supply" ? supplyTab() : tab === "money" ? moneyTab() : rivalsTab();
  p.scrollTop = top;
}

function totals() {
  let units = 0, contribution = 0;
  const co2 = { need: 0, cap: 0 }, fib = { need: 0, cap: 0 };
  for (const k of SEGS) {
    if (!s.open[k] || !S.segPossible(s, k)) continue;
    const f = S.forecast(s, k);
    units += f.units; contribution += f.contribution;
    (SEG[k].fiber ? fib : co2).need += f.minutes;
  }
  // queued work also needs laser time
  for (const j of s.jobs) (SEG[j.seg].fiber ? fib : co2).need += j.units * S.unitMinutes(s, j.seg);
  co2.cap = s.machines.some((m) => m.kind !== "fiber") ? S.capacityFor(s, "stands") : 0;
  fib.cap = s.machines.some((m) => m.kind === "fiber") ? S.capacityFor(s, "parts") : 0;
  const realCap = (seg: SegId) => { // speed-adjusted minutes -> real minutes
    let t = 0; for (const m of s.machines) if (S.canMake(s, seg, m.kind)) t += 80 * 60 * (m.down > 0 ? 0.5 : 1);
    return Math.min(t, S.staffHours(s) * 60);
  };
  const load = Math.max(co2.cap ? co2.need / realCap("stands") : 0, fib.cap ? fib.need / realCap("parts") : 0);
  return { units, contribution, load, profit: contribution - S.fixedWeekly(s) };
}

function renderGo() {
  const t = totals();
  const fc = playing ? `<span>Running the week…</span>` :
    `Forecast <b>~${fmt(t.units)}</b> orders · laser load <b class="${t.load > 1.05 ? "neg" : ""}">${pct(t.load)}</b><br>Est. profit <b class="${t.profit < 0 ? "neg" : "pos"}">${money(t.profit)}</b> <span class="tiny">(fixed ${money(S.fixedWeekly(s))}/wk)</span>`;
  $("go").innerHTML = `<div class="fc">${fc}</div><button class="run" data-a="run" ${playing || s.over ? "disabled" : ""}>Run week ▶</button>`;
}

function coachTip(): string {
  const tips: Record<number, string> = {
    1: "<b>Your move.</b> Customers compare <b>price</b>, <b>wait time</b> and <b>reputation</b> across every shop in town. Nudge prices and watch the forecast change, then hit Run week.",
    2: "<b>Laser time is your bottleneck.</b> Look at <b>$/laser-hr</b>: a cheap product that cuts fast can beat an expensive slow one.",
    3: "<b>Rivals react.</b> Zap Bros undercuts whoever is cheapest. Mirror Lasers copies your prices, up <i>and</i> down. A price war hurts everyone. Check the Rivals tab.",
    4: "<b>Fixed vs variable.</b> A second operator lets the laser run a second shift. Wages are fixed: you pay them even in a slow week.",
    5: "<b>Buy low.</b> Material prices move. Stock up in bulk when they dip. Running out means rush orders at +35%.",
    6: "<b>Contracts are sealed bids.</b> Bid too low and you win a job that loses money. Bid too high and a rival takes it. Mind your laser hours.",
  };
  return tips[s.week] ? `<div class="coach">${tips[s.week]}</div>` : "";
}

// --- Market -----------------------------------------------------------------

function stepFor(ref: number) { return ref <= 20 ? 0.25 : ref <= 50 ? 0.5 : ref <= 120 ? 1 : 5; }

function marketTab(): string {
  let h = coachTip();
  const open = s.contracts.filter((c) => c.status === "open");
  const active = s.contracts.filter((c) => c.status === "won" || c.status === "late");
  if (open.length || active.length) {
    h += `<h3>Contracts <span class="r">sealed bids, decided when the week runs</span></h3>`;
    for (const c of open) h += contractCard(c);
    for (const c of active) h += `<div class="card"><div class="row"><span class="ico">${SEG[c.seg].icon}</span><div class="grow"><div class="title">${esc(c.client)}</div><div class="sub">${c.delivered}/${c.qty} delivered · due end of week ${Math.floor((c.due ?? 0) / 5) + 1}</div></div><span class="pill ${c.status === "late" ? "bad" : "good"}">${c.status === "late" ? "LATE" : "IN WORK"}</span></div><div class="row"><div class="bar"><i style="width:${pct(c.delivered / c.qty)}"></i></div></div></div>`;
  }
  h += `<h3>Products <span class="r">your price vs town</span></h3>`;
  for (const k of SEGS) h += segCard(k);

  h += `<h3>Marketing</h3><div class="card"><div class="row"><div class="grow"><div class="title">Weekly ad spend</div><div class="sub">Awareness ${Math.round(s.aw)}/100. It fades ~10%/week without ads.</div></div>
    <div class="step"><button data-a="mkt" data-k="-50">−</button><div class="v">${money(s.marketing)}</div><button data-a="mkt" data-k="50">+</button></div></div>
    <div class="row"><div class="bar"><i style="width:${s.aw}%;background:var(--you)"></i></div></div></div>`;

  h += `<h3>Job order <span class="r">what the lasers cut first</span></h3><div class="card"><div class="seg">
    ${(["fifo", "margin", "due"] as const).map((p) => `<button data-a="prio" data-k="${p}" class="${s.priority === p ? "on" : ""}">${p === "fifo" ? "First come" : p === "margin" ? "Best margin" : "Nearest deadline"}</button>`).join("")}
  </div><div class="sub" style="margin-top:8px">${s.priority === "fifo" ? "Fair and simple. Big jobs can block quick ones." : s.priority === "margin" ? "Most $ per laser-minute first, contracts always first. Cheap orders may wait too long and walk." : "Whatever is due soonest. Fewest late orders, ignores profit."}</div></div>`;
  return h;
}

function segCard(k: SegId): string {
  const d = SEG[k];
  const possible = S.segPossible(s, k);
  if (!possible) {
    const why = d.fiber ? "Needs a fiber laser (Shop tab)." : "Needs a precise laser: Pro CO₂ or better (Shop tab).";
    return `<div class="card off"><div class="row"><span class="ico">${d.icon}</span><div class="grow"><div class="title">${d.name}</div><div class="sub">${why}</div></div><span class="pill">LOCKED</span></div>
      <div class="tiny" style="margin-top:6px">${d.blurb} Ref price ${money2(S.refPrice(s, k))}.</div></div>`;
  }
  const on = s.open[k];
  const f = S.forecast(s, k);
  const rivals = s.rivals.filter((r) => !r.bust && r.on[k]);
  const cheapest = Math.min(...rivals.map((r) => r.price[k]), Infinity);
  const st = s.last?.seg[k];
  const repCls = s.rep[k] >= 65 ? "good" : s.rep[k] < 40 ? "bad" : "";
  const leadCls = f.lead > d.promise ? "bad" : f.lead > d.promise * 0.6 ? "warn" : "good";
  return `<div class="card ${on ? "" : "off"}">
    <div class="row"><span class="ico">${d.icon}</span><div class="grow"><div class="title">${d.name}</div><div class="sub">Ref ${money2(S.refPrice(s, k))} · demand ×${S.potential(s, k).toFixed(0) === "0" ? "0" : (S.potential(s, k) / d.potential).toFixed(2)}</div></div>
      <span class="pill ${repCls}">★ ${Math.round(s.rep[k])}</span><button class="toggle ${on ? "on" : ""}" data-a="open" data-k="${k}" aria-label="Sell ${d.name}"></button></div>
    ${on ? `
    <div class="row"><div class="step"><button data-a="price" data-k="${k}" data-v="-5">«</button><button data-a="price" data-k="${k}" data-v="-1">‹</button><div class="v">${money2(s.price[k])}</div><button data-a="price" data-k="${k}" data-v="1">›</button><button data-a="price" data-k="${k}" data-v="5">»</button></div>
      <div class="grow" style="text-align:right"><div class="sub">${s.price[k] < cheapest ? '<span class="pos">cheapest in town</span>' : rivals.length ? `${pct(s.price[k] / cheapest - 1)} over cheapest` : "no rivals"}</div></div></div>
    <div class="kv">
      <div><span>Orders/wk</span><b>${fmt(f.lo)}–${fmt(f.hi)}</b></div>
      <div><span>Margin/unit</span><b class="${f.margin < 0 ? "neg" : ""}">${money2(f.margin)}</b></div>
      <div><span>$/laser-hr</span><b class="${f.perHour < 0 ? "neg" : ""}">${money(f.perHour)}</b></div>
      <div><span>Share</span><b>${pct(f.share)}</b></div>
      <div><span>Laser time</span><b>${(f.minutes / 60).toFixed(1)}h</b></div>
      <div><span>Wait</span><b class="${leadCls === "bad" ? "neg" : leadCls === "good" ? "pos" : ""}">${f.lead.toFixed(1)}d / ${d.promise}d</b></div>
    </div>` : `<div class="tiny" style="margin-top:6px">${d.blurb}</div>`}
    <div class="chips">${rivals.map((r) => `<span class="chip"><i style="background:${r.color}"></i>${esc(r.name.split(" ")[0])} ${money2(r.price[k])}</span>`).join("") || '<span class="tiny">No rivals sell this.</span>'}
      ${st && (st.done || st.lost) ? `<span class="chip">last wk: ${st.done} made${st.lost ? `, <span class="neg">${st.lost} walked</span>` : ""}</span>` : ""}</div>
  </div>`;
}

function contractCard(c: S.Contract): string {
  const d = SEG[c.seg];
  const possible = S.segPossible(s, c.seg);
  const hours = (c.qty * S.unitMinutes(s, c.seg)) / 60;
  const vc = S.unitVarCost(s, c.seg);
  const bid = c.bid || 0;
  const profit = bid ? (bid - vc) * c.qty : 0;
  return `<div class="card ${c.bid ? "hl" : ""}">
    <div class="row"><span class="ico">${d.icon}</span><div class="grow"><div class="title">${esc(c.client)}</div><div class="sub">${c.qty} × ${d.name.toLowerCase()} · due in ${c.weeks} weeks · budget ≤ ${money2(c.maxPrice)}/unit</div></div></div>
    ${possible ? `
    <div class="row"><div class="step"><button data-a="bid" data-k="${c.id}" data-v="-5">«</button><button data-a="bid" data-k="${c.id}" data-v="-1">‹</button><div class="v">${bid ? money2(bid) : "no bid"}</div><button data-a="bid" data-k="${c.id}" data-v="1">›</button><button data-a="bid" data-k="${c.id}" data-v="5">»</button></div>
      <div class="grow" style="text-align:right">${bid ? `<button class="btn sm ghost" data-a="nobid" data-k="${c.id}">Withdraw</button>` : ""}</div></div>
    <div class="kv"><div><span>Laser time</span><b>${hours.toFixed(1)}h</b></div><div><span>Your cost/unit</span><b>${money2(vc)}</b></div><div><span>Job profit</span><b class="${profit < 0 ? "neg" : ""}">${bid ? money(profit) : "—"}</b></div></div>
    ${s.upg.crm ? `<div class="tiny" style="margin-top:6px">Quoting software: rivals will likely bid ${money2(vc * 1.1)}–${money2(vc * 1.8)}.</div>` : ""}`
    : `<div class="sub" style="margin-top:6px">You can't make these yet. ${d.fiber ? "Needs a fiber laser." : "Needs a Pro laser."} Buy one this week and you could still bid.</div>`}
  </div>`;
}

// --- Shop -------------------------------------------------------------------

function shopTab(): string {
  const tier = TIERS[s.tier];
  let h = `<h3>Workshop</h3><div class="card"><div class="row"><span class="ico">🏭</span><div class="grow"><div class="title">${tier.name}</div><div class="sub">Rent ${money(tier.rent * s.rentMult)}/wk · ${s.machines.length}/${tier.slots} laser slots · storage ${tier.storage} sheets</div></div></div>
    <div class="btns" style="margin-top:10px">${TIERS.map((t, i) => i === s.tier ? "" : `<button class="btn sm ${i > s.tier ? "" : "ghost"}" data-a="tier" data-k="${i}">${i > s.tier ? "Move up" : "Downsize"}: ${t.name} (${money(t.rent)}/wk, ${t.slots} slots)</button>`).join("")}</div>
    <div class="tiny" style="margin-top:6px">Moving costs ${money(S.MOVE_COST)} once. Rent is a fixed cost: it doesn't care how busy you are.</div></div>`;

  const staffH = S.staffHours(s);
  const machH = s.machines.length * 80;
  h += `<h3>Lasers <span class="r">${staffH.toFixed(0)}h staff / ${machH}h machine per week</span></h3>`;
  for (const m of s.machines) {
    const d = MACH[m.kind];
    const cc = m.cond < 45 ? "var(--bad)" : m.cond < 70 ? "var(--warn)" : "var(--good)";
    h += `<div class="card"><div class="row"><span class="ico">${m.kind === "fiber" ? "🔷" : m.kind === "pro" ? "🔶" : "🟠"}</span><div class="grow"><div class="title">${d.name}${m.leased ? ' <span class="pill">LEASED</span>' : ""}</div>
      <div class="sub">Speed ×${d.speed} · precision ${pct(d.precision)} · defects ${pct(S.defectRate(s, m.kind))}</div></div>
      ${m.down > 0 && !m.service ? `<span class="pill bad">DOWN ${m.down}d</span>` : m.service ? '<span class="pill warn">SERVICE MON</span>' : ""}</div>
      <div class="row"><span class="tiny" style="width:72px">Condition</span><div class="bar"><i style="width:${m.cond}%;background:${cc}"></i></div><span class="num tiny">${Math.round(m.cond)}%</span></div>
      <div class="btns" style="margin-top:10px">
        <button class="btn sm" data-a="service" data-k="${m.id}">${m.service ? "Cancel service" : `Service ${money(d.service)} (1 day off)`}</button>
        <button class="btn sm ghost" data-a="sell" data-k="${m.id}">${m.leased ? `Return (${money(d.lease * 2)} fee)` : `Sell ${money(S.resale(m))}`}</button>
      </div></div>`;
  }
  h += `<h3>Buy or lease <span class="r">${S.slotsFree(s)} slot${S.slotsFree(s) === 1 ? "" : "s"} free</span></h3>`;
  for (const kind of ["hobby", "pro", "fiber"] as MachineKind[]) {
    const d = MACH[kind];
    h += `<div class="card"><div class="row"><div class="grow"><div class="title">${d.name}</div><div class="sub">${d.blurb} Power ${money2(d.power)}/h.</div></div></div>
      <div class="btns" style="margin-top:8px"><button class="btn sm pri" data-a="buy" data-k="${kind}">Buy ${money(d.buy)}</button>
      ${d.lease ? `<button class="btn sm" data-a="lease" data-k="${kind}">Lease ${money(d.lease)}/wk</button>` : ""}</div>
      ${d.lease ? `<div class="tiny" style="margin-top:6px">Buying ties up cash but you keep the resale value. Leasing is a fixed weekly cost (2 weeks' deposit).</div>` : ""}</div>`;
  }

  h += `<h3>Team <span class="r">8h shifts · a laser can run 2 shifts</span></h3>`;
  for (const w of s.workers) {
    h += `<div class="card"><div class="row"><span class="ico">${w.owner ? "🧑‍🔧" : w.intern ? "🎓" : "👷"}</span><div class="grow"><div class="title">${esc(w.name)}${w.owner ? ' <span class="pill">OWNER</span>' : ""}</div>
      <div class="sub">${w.owner ? "Unpaid, but you need $500/wk to live." : w.intern ? `Intern, ${w.intern} weeks left` : `${money(w.wage)}/wk${w.weeks < 1 ? " · training (half speed)" : ""}`}</div></div></div>
      <div class="row"><span class="tiny" style="width:52px">Skill</span><div class="bar"><i style="width:${w.skill * 100}%"></i></div>
      ${w.owner ? "" : `<span class="tiny" style="width:52px;text-align:right">Morale</span><div class="bar"><i style="width:${w.morale}%;background:${w.morale < 40 ? "var(--bad)" : w.morale < 60 ? "var(--warn)" : "var(--good)"}"></i></div>`}</div>
      ${w.owner || w.intern ? "" : `<div class="btns" style="margin-top:10px"><button class="btn sm" data-a="raise" data-k="${w.id}">Raise +$75/wk</button><button class="btn sm ghost" data-a="fire" data-k="${w.id}">Let go (${money(w.wage * 2)})</button></div>`}
      </div>`;
  }
  h += `<div class="card"><div class="row"><div class="grow"><div class="title">Hire an operator</div><div class="sub">${money(S.WAGE)}/wk + ${money(S.HIRE_FEE)} fee. Half speed the first week.</div></div><button class="btn pri" data-a="hire">Hire</button></div></div>`;
  h += `<div class="card"><div class="row"><div class="grow"><div class="title">Overtime</div><div class="sub">+30% hours at 1.5× pay. Morale drops each week, defects +30%.</div></div><button class="toggle ${s.overtime ? "on" : ""}" data-a="ot"></button></div></div>`;

  h += `<h3>Upgrades</h3>`;
  for (const u of Object.keys(UPG) as UpgradeId[]) {
    const d = UPG[u];
    h += `<div class="card ${s.upg[u] ? "off" : ""}"><div class="row"><div class="grow"><div class="title">${d.name}</div><div class="sub">${d.blurb}</div></div>
      ${s.upg[u] ? '<span class="pill good">OWNED</span>' : `<button class="btn sm pri" data-a="upg" data-k="${u}">${money(d.cost)}</button>`}</div></div>`;
  }
  return h;
}

// --- Supply -----------------------------------------------------------------

function weeklyUse(m: S.MatId): number {
  if (!s.last) return 0;
  let u = 0;
  for (const k of SEGS) if (SEG[k].mat === m) u += s.last.seg[k].done * SEG[k].sheets * (1 + S.scrapRate(s));
  return u;
}

function spark(vals: number[], color: string, h = 34, w = 120): string {
  if (vals.length < 2) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - lo) / Math.max(1e-6, hi - lo)) * (h - 6)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg>`;
}

function supplyTab(): string {
  const used = S.storageUsed(s), cap = TIERS[s.tier].storage;
  let h = `<h3>Storage <span class="r">${Math.round(used)}/${cap} sheets</span></h3><div class="card"><div class="row"><div class="bar"><i style="width:${pct(used / cap)};background:var(--you)"></i></div></div>
    <div class="tiny" style="margin-top:6px">Stock costs ${pct(S.HOLDING)} of its value per week to store and insure. If you run out mid-week, rush delivery costs +35%.</div></div>`;
  h += `<h3>Materials</h3>`;
  for (const m of MATS) {
    const d = MAT[m];
    const price = S.matPrice(s, m);
    const hist = s.matHist[m];
    const trend = hist.length > 1 ? hist[hist.length - 1] - hist[hist.length - 2] : 0;
    const use = weeklyUse(m);
    const cover = use > 0 ? s.inv[m] / use : Infinity;
    h += `<div class="card"><div class="row"><span class="ico">${d.icon}</span><div class="grow"><div class="title">${d.name}</div>
      <div class="sub"><span class="num">${money2(price)}</span>/sheet · base ${money2(d.base)} <span class="${trend > 0 ? "neg" : trend < 0 ? "pos" : ""}">${trend > 0.005 ? "▲" : trend < -0.005 ? "▼" : "■"}</span></div></div>${spark(hist, price > d.base ? "#f87171" : "#4ade80")}</div>
      <div class="kv"><div><span>In stock</span><b>${s.inv[m].toFixed(1)}</b></div><div><span>Used last wk</span><b>${use.toFixed(1)}</b></div><div><span>Weeks cover</span><b class="${cover < 1 ? "neg" : ""}">${cover === Infinity ? "—" : cover.toFixed(1)}</b></div></div>
      <div class="btns" style="margin-top:10px">${[10, 40, 100].map((q) => `<button class="btn sm ${q === 100 ? "pri" : ""}" data-a="mat" data-k="${m}" data-v="${q}">+${q} · ${money(S.matOrderCost(s, m, q))}${S.bulkDiscount(q) ? ` <span class="tiny">−${pct(S.bulkDiscount(q))}</span>` : ""}</button>`).join("")}</div></div>`;
  }
  const scrap = S.scrapRate(s);
  h += `<div class="tiny" style="padding:0 4px">Scrap rate ${pct(scrap)}${s.upg.nesting ? " (nesting software)" : ". Nesting software cuts this to 6%."}</div>`;
  return h;
}

// --- Money ------------------------------------------------------------------

function chart(): string {
  const H = s.hist;
  if (H.length < 2) return `<div class="tiny">Run a few weeks to see your chart.</div>`;
  const w = 320, h = 120;
  const vals = H.flatMap((x) => [x.cash, x.worth]);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals, 1);
  const X = (i: number) => (i / (H.length - 1)) * w;
  const Y = (v: number) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const line = (f: (x: (typeof H)[0]) => number, c: string) => `<polyline fill="none" stroke="${c}" stroke-width="2.2" points="${H.map((x, i) => `${X(i)},${Y(f(x))}`).join(" ")}"/>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" stroke="#352c26"/>${line((x) => x.worth, "#ffb020")}${line((x) => x.cash, "#4ade80")}</svg>
    <div class="chips"><span class="chip"><i style="background:#ffb020"></i>Net worth</span><span class="chip"><i style="background:#4ade80"></i>Cash</span></div>`;
}

function moneyTab(): string {
  let h = `<h3>Year goal <span class="r">grade on week ${S.WEEKS} net worth</span></h3><div class="card">${chart()}
    <div class="chips">${[["S", 400000], ["A", 200000], ["B", 100000], ["C", 50000], ["D", 15000]].map(([g, v]) => `<span class="chip">${g} ≥ ${money(v as number)}</span>`).join("")}</div></div>`;

  const r = s.last;
  if (r) {
    h += `<h3>Last week (week ${r.week}) <span class="r">profit &amp; loss</span></h3><div class="card"><table>
      ${SEGS.filter((k) => r.seg[k].revenue > 0).map((k) => `<tr><td>${SEG[k].icon} ${SEG[k].name}</td><td class="num">${money(r.seg[k].revenue)}</td></tr>`).join("")}
      <tr class="tot"><td>Revenue</td><td class="num pos">${money(r.revenue)}</td></tr>
      ${r.costs.map((c) => `<tr><td class="sub">${c.label}</td><td class="num">−${money(c.amount)}</td></tr>`).join("")}
      <tr class="tot"><td>Profit</td><td class="num ${r.profit < 0 ? "neg" : "pos"}">${money(r.profit)}</td></tr></table></div>`;
  }

  const fixed = S.fixedWeekly(s);
  let cm = 0, rev = 0;
  for (const k of SEGS) if (s.open[k] && S.segPossible(s, k)) { const f = S.forecast(s, k); cm += f.contribution; rev += f.units * s.price[k]; }
  const cmr = rev > 0 ? cm / rev : 0;
  h += `<h3>Break-even</h3><div class="card"><div class="kv">
      <div><span>Fixed/wk</span><b>${money(fixed)}</b></div>
      <div><span>Contrib. margin</span><b>${pct(cmr)}</b></div>
      <div><span>Break-even rev</span><b>${cmr > 0 ? money(fixed / cmr) : "—"}</b></div></div>
      <div class="tiny" style="margin-top:8px">Every $1 of sales leaves ${money2(cmr)} after materials and power. You need ${cmr > 0 ? money(fixed / cmr) : "—"} of sales a week just to cover rent, wages, leases, ads and interest.</div></div>`;

  const lim = S.creditLimit(s);
  h += `<h3>Bank <span class="r">${pct(S.interestRate(s))}/week interest</span></h3><div class="card"><div class="kv">
      <div><span>Debt</span><b class="${s.debt ? "neg" : ""}">${money(s.debt)}</b></div><div><span>Credit limit</span><b>${money(lim)}</b></div><div><span>Interest/wk</span><b>${money(s.debt * S.interestRate(s))}</b></div></div>
      <div class="btns" style="margin-top:10px"><button class="btn sm" data-a="borrow" data-k="2000">Borrow $2k</button><button class="btn sm" data-a="borrow" data-k="10000">Borrow $10k</button>
      <button class="btn sm ghost" data-a="repay" data-k="2000" ${s.debt ? "" : "disabled"}>Repay $2k</button><button class="btn sm ghost" data-a="repay" data-k="999999" ${s.debt ? "" : "disabled"}>Repay all</button></div>
      <div class="tiny" style="margin-top:6px">If cash goes negative the bank lends automatically, up to your limit. Past it, you're bankrupt.</div></div>`;
  return h;
}

// --- Rivals -----------------------------------------------------------------

const PERSONA: Record<S.Persona, string> = {
  cutter: "Price cutter. Undercuts the cheapest shop. Can't survive a long war.",
  premium: "Premium. High prices, strong reputation. Ignores price wars.",
  copycat: "Copycat. Matches your prices next week, up or down. Copies your best products.",
};

function rivalsTab(): string {
  const live = s.rivals.filter((r) => !r.bust);
  let h = `<h3>Price board <span class="r">this week</span></h3><div class="card scroll-x"><table><tr><th></th><th style="color:var(--you)">You</th>${live.map((r) => `<th style="color:${r.color}">${esc(r.name.split(" ")[0])}</th>`).join("")}</tr>`;
  for (const k of SEGS) {
    const cells = [s.open[k] && S.segPossible(s, k) ? s.price[k] : null, ...live.map((r) => (r.on[k] ? r.price[k] : null))];
    const min = Math.min(...cells.filter((x): x is number => x !== null));
    h += `<tr><td>${SEG[k].icon}</td>${cells.map((c) => `<td class="num ${c !== null && c === min ? "low" : ""}">${c === null ? '<span class="tiny">—</span>' : c.toFixed(2)}</td>`).join("")}</tr>`;
  }
  h += `</table></div>`;

  // price history for one product: the game-theory view
  h += `<h3>Price history</h3><div class="card"><div class="seg">${SEGS.map((k) => `<button data-a="rseg" data-k="${k}" class="${rivalSeg === k ? "on" : ""}">${SEG[k].icon}</button>`).join("")}</div>${priceChart(rivalSeg)}</div>`;

  h += `<h3>Shops in town</h3>`;
  for (const r of s.rivals) {
    const health = r.bust ? ["bad", "CLOSED"] : r.cash > 60000 ? ["good", "THRIVING"] : r.cash > 15000 ? ["", "STEADY"] : r.cash > 0 ? ["warn", "STRUGGLING"] : ["bad", "IN DEBT"];
    const units = SEGS.reduce((a, k) => a + (r.on[k] ? r.units[k] : 0), 0);
    h += `<div class="card ${r.bust ? "off" : ""}"><div class="row"><span class="ico" style="color:${r.color}">●</span><div class="grow"><div class="title" style="color:${r.color}">${esc(r.name)}</div><div class="sub">${PERSONA[r.persona]}</div></div><span class="pill ${health[0]}">${health[1]}</span></div>
      ${r.bust ? "" : `<div class="kv"><div><span>Reputation</span><b>★ ${Math.round(SEGS.filter((k) => r.on[k]).reduce((a, k) => a + r.rep[k], 0) / Math.max(1, SEGS.filter((k) => r.on[k]).length))}</b></div><div><span>Sold last wk</span><b>~${fmt(units)}</b></div><div><span>Busy</span><b>${pct(Math.min(1, r.util))}</b></div></div>
      <div class="chips">${SEGS.filter((k) => r.on[k]).map((k) => `<span class="chip">${SEG[k].icon} ${money2(r.price[k])}</span>`).join("")}</div>`}</div>`;
  }
  if (s.last?.rivalMoves.length) h += `<h3>Last week's moves</h3><div class="card"><ul class="notes" style="margin:0">${s.last.rivalMoves.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>`;
  return h;
}

function priceChart(k: SegId): string {
  const H = s.priceHist;
  if (H.length < 2) return `<div class="tiny" style="margin-top:8px">Run a few weeks to see who follows whom.</div>`;
  const w = 320, h = 120;
  const series: { c: string; v: (number | null)[] }[] = [{ c: "#ffb020", v: H.map((x) => x.you[k]) }];
  for (const r of s.rivals) series.push({ c: r.color, v: H.map((x) => (x.rivals[r.name] && r.on[k] ? x.rivals[r.name][k] : null)) });
  const all = series.flatMap((x) => x.v.filter((v): v is number => v !== null));
  const lo = Math.min(...all) * 0.95, hi = Math.max(...all) * 1.05;
  const X = (i: number) => (i / (H.length - 1)) * w;
  const Y = (v: number) => h - 4 - ((v - lo) / Math.max(1e-6, hi - lo)) * (h - 8);
  const lines = series.map((sr) => {
    const pts = sr.v.map((v, i) => (v === null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(" ");
    return pts ? `<polyline fill="none" stroke="${sr.c}" stroke-width="2" points="${pts}"/>` : "";
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="margin-top:8px">${lines}</svg><div class="tiny">${money2(lo / 0.95)} – ${money2(hi / 1.05)} over the last ${H.length} weeks. Ref price ${money2(S.refPrice(s, k))}.</div>`;
}

// ---------------------------------------------------------------------------
// Modals

function modal(html: string) { $("modal").innerHTML = `<div class="sheet">${html}</div>`; $("modal").classList.add("on"); }
function closeModal() { $("modal").classList.remove("on"); $("modal").innerHTML = ""; }

function introModal(resume: boolean) {
  modal(`<div class="logo">CUT<i>/</i>SHOP</div>
    <p>You just opened a laser-cutting shop with one old hobby laser and $9,000. Three rival shops already work this town.</p>
    <ul class="notes">
      <li>💲 <b>Set prices.</b> Customers weigh price, wait time and reputation. Rivals react to every move.</li>
      <li>⏱️ <b>Laser hours are scarce.</b> Spend them on what earns the most per hour.</li>
      <li>🏗️ <b>Grow carefully.</b> Machines, staff and rent are fixed costs. They don't stop when orders do.</li>
      <li>🏆 <b>Goal:</b> highest net worth after ${S.WEEKS} weeks. Don't go bankrupt.</li>
    </ul>
    <button class="btn pri" style="width:100%;min-height:48px" data-a="start">${resume ? `Continue week ${s.week}` : "Open the shop"}</button>
    ${resume ? `<button class="btn ghost" style="width:100%;margin-top:8px" data-a="newgame">Start a new year</button>` : ""}`);
}

function reportModal(r: Report) {
  const good = r.profit >= 0;
  const rows = SEGS.filter((k) => r.seg[k].orders || r.seg[k].done || r.seg[k].lost);
  modal(`<div class="sub">Week ${r.week} results</div>
    <div class="big ${good ? "pos" : "neg"}">${good ? "+" : ""}${money(r.profit)}</div>
    <div class="sub">Revenue ${money(r.revenue)} · costs ${money(r.revenue - r.profit)} · lasers ${pct(Math.min(1, r.util))} busy</div>
    ${rows.length ? `<table style="margin-top:12px"><tr><th></th><th>Orders</th><th>Made</th><th>Walked</th><th>Revenue</th></tr>
      ${rows.map((k) => `<tr><td>${SEG[k].icon}</td><td class="num">${r.seg[k].orders}</td><td class="num">${r.seg[k].done}</td><td class="num ${r.seg[k].lost ? "neg" : ""}">${r.seg[k].lost}</td><td class="num">${money(r.seg[k].revenue)}</td></tr>`).join("")}</table>` : ""}
    ${r.notes.length ? `<ul class="notes">${r.notes.slice(0, 7).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${r.rivalMoves.length ? `<div class="sub" style="margin-top:10px"><b>Rivals</b></div><ul class="notes">${r.rivalMoves.slice(0, 5).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <button class="btn pri" style="width:100%;min-height:48px;margin-top:8px" data-a="after">Plan week ${s.week}</button>`);
}

function eventModal() {
  const e = s.event!;
  modal(`<div class="sub">Decision</div><h2>${esc(e.title)}</h2><p>${esc(e.text)}</p>
    ${e.choices.map((c, i) => `<button class="choice" data-a="choose" data-k="${i}"><b>${esc(c.label)}</b>${c.hint ? `<span>${esc(c.hint)}</span>` : ""}</button>`).join("")}`);
}

function endModal() {
  const worth = S.netWorth(s);
  if (s.over === "bankrupt") {
    modal(`<div class="sub">Week ${s.week - 1}</div><h2>The bank closed your shop</h2>
      <p>Cash ran out past your credit limit. Fixed costs kept coming when the orders didn't.</p>
      <div class="kv"><div><span>Best net worth</span><b>${money(s.best)}</b></div><div><span>Weeks</span><b>${s.week - 1}</b></div><div><span>All-time best</span><b>${money(s.bestEver)}</b></div></div>
      <button class="btn pri" style="width:100%;min-height:48px;margin-top:14px" data-a="newgame">Try again</button>`);
    return;
  }
  const g = S.grade(worth);
  modal(`<div class="sub">End of year one</div><div class="row" style="gap:16px;margin:8px 0"><div class="grade">${g.letter}</div><div><h2 style="margin:0">${g.title}</h2><div class="big">${money(worth)}</div></div></div>
    ${chart()}
    <div class="kv"><div><span>Revenue (yr)</span><b>${money(s.hist.reduce((a, x) => a + x.revenue, 0))}</b></div><div><span>Lasers</span><b>${s.machines.length}</b></div><div><span>All-time best</span><b>${money(s.bestEver)}</b></div></div>
    <button class="btn pri" style="width:100%;min-height:48px;margin-top:14px" data-a="newgame">New year, new town</button>
    <button class="btn ghost" style="width:100%;margin-top:8px" data-a="endless">Keep running this shop</button>`);
}

// ---------------------------------------------------------------------------
// Shop floor canvas

const cv = $("cv") as unknown as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;
let running: number[] = [];
let t0 = performance.now();
const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

function resize() {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawFloor(now: number) {
  const W = cv.clientWidth, H = cv.clientHeight;
  const t = (now - t0) / 1000;
  ctx.fillStyle = "#0d0b0a";
  ctx.fillRect(0, 0, W, H);
  // floor tiles
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const slots = TIERS[s.tier].slots;
  const cols = Math.min(slots, W > H * 1.6 ? 4 : slots <= 2 ? 2 : W > 500 ? 4 : 3);
  const rows = Math.ceil(slots / cols);
  const pad = 12;
  const areaH = H - 40;
  const cw = (W - pad * 2) / cols, ch = Math.min(areaH / rows, cw * 0.75);
  const offY = 8 + (areaH - ch * rows) / 2;
  for (let i = 0; i < slots; i++) {
    const cx = pad + (i % cols) * cw, cy = offY + Math.floor(i / cols) * ch;
    const m = s.machines[i];
    const bx = cx + 6, by = cy + 6, bw = cw - 12, bh = ch - 12;
    if (!m) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.strokeRect(bx, by, bw, bh); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.font = "600 11px system-ui"; ctx.textAlign = "center"; ctx.fillText("empty slot", bx + bw / 2, by + bh / 2 + 4);
      continue;
    }
    const body = m.kind === "fiber" ? "#24364a" : m.kind === "pro" ? "#3d2c22" : "#2c2723";
    ctx.fillStyle = body; roundRect(bx, by, bw, bh, 8); ctx.fill();
    ctx.strokeStyle = m.kind === "fiber" ? "#4b88c7" : m.kind === "pro" ? "#c77a3b" : "#5d544c"; ctx.lineWidth = 2; roundRect(bx, by, bw, bh, 8); ctx.stroke();
    // bed
    const ix = bx + 10, iy = by + 18, iw = bw - 20, ih = bh - 30;
    ctx.fillStyle = "#15110e"; ctx.fillRect(ix, iy, iw, ih);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let gx = ix; gx < ix + iw; gx += 8) { ctx.beginPath(); ctx.moveTo(gx, iy); ctx.lineTo(gx, iy + ih); ctx.stroke(); }
    // sheet on bed
    const mat = m.kind === "fiber" ? "#8c98a3" : (i % 2 ? "#3f7fbf" : "#b88a57");
    ctx.fillStyle = mat; ctx.globalAlpha = 0.55; ctx.fillRect(ix + 4, iy + 4, iw - 8, ih - 8); ctx.globalAlpha = 1;
    const busy = playing ? (running[i] ?? 0) > 0.02 : s.jobs.length > 0 || i === 0;
    const down = m.down > 0 && playing;
    // gantry + head
    const sp = MACH[m.kind].speed;
    const hx = ix + 6 + (iw - 12) * (0.5 + 0.5 * Math.sin(t * 1.3 * sp + i * 2));
    const hy = iy + 6 + (ih - 12) * (0.5 + 0.5 * Math.sin(t * 2.1 * sp + i));
    ctx.fillStyle = "#6b625a"; ctx.fillRect(ix, hy - 2, iw, 4);
    ctx.fillStyle = "#d8d0c8"; ctx.fillRect(hx - 4, hy - 4, 8, 8);
    if (busy && !down && !paused) {
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
      g.addColorStop(0, m.kind === "fiber" ? "rgba(140,200,255,0.95)" : "rgba(255,120,40,0.95)");
      g.addColorStop(1, "rgba(255,90,31,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fill();
      if (Math.random() < 0.5) sparks.push({ x: hx, y: hy, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.4 });
    }
    // label + condition
    ctx.fillStyle = "#f4ede5"; ctx.font = "700 10.5px system-ui"; ctx.textAlign = "left";
    ctx.fillText(m.kind === "fiber" ? "FIBER" : m.kind === "pro" ? "PRO CO₂" : "HOBBY CO₂", bx + 8, by + 13);
    ctx.fillStyle = m.cond < 45 ? "#f87171" : m.cond < 70 ? "#fbbf24" : "#4ade80";
    ctx.fillRect(bx + bw - 38, by + 8, 30 * (m.cond / 100), 4);
    if (down) { ctx.fillStyle = "rgba(127,29,29,0.75)"; ctx.fillRect(bx, by + bh / 2 - 10, bw, 20); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(m.service ? "SERVICE" : "BROKEN", bx + bw / 2, by + bh / 2 + 4); }
  }
  // sparks
  const dt = 1 / 60;
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(255,${150 + Math.floor(p.life * 200)},60,${p.life * 2.2})`;
    ctx.fillRect(p.x, p.y, 2, 2);
  }
  // bottom strip: staff + queue
  ctx.textAlign = "left"; ctx.font = "600 11px system-ui"; ctx.fillStyle = "#a89c90";
  const queued = s.jobs.reduce((a, j) => a + j.units, 0);
  ctx.fillText(`👷 ${s.workers.length}   📦 ${fmt(queued)} queued   ${TIERS[s.tier].name}`, 12, H - 12);
}
function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function loop(now: number) {
  if (!paused) drawFloor(now);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Week playback

const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const wait = (ms: number) => new Promise<void>((r) => {
  const step = () => (paused ? setTimeout(step, 100) : r());
  setTimeout(step, ms);
});

async function runWeek() {
  if (playing || s.over) return;
  sfx.unlock();
  playing = true;
  const startCash = s.cash;
  const r = S.runWeek(s);
  persist();
  const end = s.cash;
  renderGo();
  for (let d = 0; d < 5; d++) {
    const snap = r.days[d];
    running = snap.running;
    $("play").innerHTML = `${snap.note ? `<div class="flash">${esc(snap.note)}</div>` : ""}
      <div class="days">${DAYS.map((x, i) => `<i class="${i === d ? "on" : i < d ? "done" : ""}">${x}</i>`).join("")}</div>
      <div class="ticker"><span>📥 <b class="num">${snap.orders}</b> orders</span><span>✂️ <b class="num">${snap.done}</b> made</span><span class="num ${snap.cash - startCash < 0 ? "neg" : "pos"}">${money(snap.cash - startCash)}</span></div>`;
    if (snap.note) sfx.bad(); else sfx.day();
    if (snap.running.some((x) => x > 0)) sfx.zap();
    await wait(snap.note ? 1300 : 750);
  }
  void end;
  $("play").innerHTML = "";
  running = [];
  playing = false;
  if (r.profit > 0) sfx.coin(); else sfx.bad();
  if (s.week > S.WEEKS || s.over) {
    s.bestEver = Math.max(s.bestEver, S.netWorth(s));
    sendScore(s.bestEver);
    persist();
  }
  render();
  reportModal(r);
}

function afterReport() {
  closeModal();
  if (s.over) { endModal(); return; }
  if (s.event) { eventModal(); return; }
  render();
}

// ---------------------------------------------------------------------------
// Input

let toastTimer = 0;
function toast(msg: string) {
  if (!msg) return;
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("on"), 2400);
  sfx.bad();
}

function act(a: string, k: string, v: string) {
  let err = "";
  switch (a) {
    case "tab": tab = k as Tab; $("panel").scrollTop = 0; break;
    case "run": void runWeek(); return;
    case "start": closeModal(); if (!readySent) { readySent = true; gameReady(); } if (s.event) eventModal(); break;
    case "newgame": { const best = Math.max(s.bestEver, s.over === "done" ? S.netWorth(s) : 0); s = S.newGame(); s.bestEver = best; tab = "market"; closeModal(); persist(); if (!readySent) { readySent = true; gameReady(); } break; }
    case "endless": s.over = null; s.event = null; closeModal(); persist(); break;
    case "after": afterReport(); return;
    case "choose": {
      const c = s.event?.choices[+k];
      if (c) { err = S.applyChoice(s, c.fx); closeModal(); sfx.click(); }
      break;
    }
    case "open": s.open[k as SegId] = !s.open[k as SegId]; break;
    case "price": {
      const seg = k as SegId;
      const step = stepFor(S.refPrice(s, seg));
      const n = +v;
      let p = Math.abs(n) === 5 ? s.price[seg] * (1 + Math.sign(n) * 0.1) : s.price[seg] + n * step;
      p = Math.round(p / step) * step;
      s.price[seg] = S.round2(clamp(p, step, S.refPrice(s, seg) * 4));
      break;
    }
    case "bid": {
      const c = s.contracts.find((x) => x.id === +k);
      if (!c) break;
      const step = stepFor(c.maxPrice);
      if (!c.bid) c.bid = S.round2(Math.round((c.maxPrice * 0.9) / step) * step);
      else {
        const n = +v;
        let p = Math.abs(n) === 5 ? c.bid * (1 + Math.sign(n) * 0.1) : c.bid + n * step;
        c.bid = S.round2(clamp(Math.round(p / step) * step, step, c.maxPrice * 2));
      }
      break;
    }
    case "nobid": { const c = s.contracts.find((x) => x.id === +k); if (c) c.bid = 0; break; }
    case "mkt": s.marketing = clamp(s.marketing + +k, 0, 1500); break;
    case "prio": s.priority = k as S.Priority; break;
    case "tier": err = S.moveTier(s, +k); if (!err) sfx.build(); break;
    case "service": { const m = s.machines.find((x) => x.id === +k); if (m) m.service = !m.service; break; }
    case "sell": err = S.sellMachine(s, +k); break;
    case "buy": err = S.buyMachine(s, k as MachineKind, false); if (!err) sfx.build(); break;
    case "lease": err = S.buyMachine(s, k as MachineKind, true); if (!err) sfx.build(); break;
    case "hire": err = S.hire(s); break;
    case "fire": err = S.fire(s, +k); break;
    case "raise": err = S.giveRaise(s, +k); break;
    case "ot": s.overtime = !s.overtime; break;
    case "upg": err = S.buyUpgrade(s, k as UpgradeId); if (!err) sfx.build(); break;
    case "mat": err = S.buyMat(s, k as S.MatId, +v); if (!err) sfx.coin(); break;
    case "borrow": err = S.borrow(s, +k); break;
    case "repay": err = S.repay(s, Math.min(+k, s.debt)); break;
    case "rseg": rivalSeg = k as SegId; break;
  }
  if (err) toast(err); else if (a !== "tab") sfx.click();
  persist();
  render();
}

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
  if (!el) return;
  sfx.unlock();
  act(el.dataset.a!, el.dataset.k ?? "", el.dataset.v ?? "");
});

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  initPlatform();
  sfx.enabled = isAudioEnabled();
  onAudioChange((on) => (sfx.enabled = on));
  onPause(() => { paused = true; sfx.suspend(); });
  onResume(() => { paused = false; sfx.resume(); });

  const raw = await loadSave(GAME_ID);
  let resumed = false;
  s = S.newGame();
  if (raw) {
    try {
      const loaded = JSON.parse(raw) as State;
      if (loaded && loaded.v === 1) { s = loaded; resumed = !s.over && s.week > 1; }
      if (loaded.over) { const best = loaded.bestEver; s = S.newGame(); s.bestEver = best; }
    } catch { /* bad save: start fresh */ }
  }
  resize();
  window.addEventListener("resize", () => { resize(); });
  new ResizeObserver(resize).observe($("floor"));
  render();
  requestAnimationFrame(loop);
  firstFrameReady();
  introModal(resumed);
  readySent = true;
  gameReady();

  // debug hook for automated playtests
  if (location.search.includes("debug")) (window as any).cs = { get s() { return s; }, S, act, render };
}

void boot();
