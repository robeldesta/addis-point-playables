import Phaser from "phaser";
import { bootGame } from "../../src/platform/boot";
import { gameReady, loadSave, save, sendScore, onPause } from "../../src/platform/platform";
import { makeArt } from "./art";
import * as L from "./logic";

const GAME_ID = "market-garden";
const W = 720;
const FONT = "Arial, Helvetica, sans-serif";

const COL = {
  bg: 0x6fa84a,
  panel: 0x3e2a1f,
  panelLight: 0x5a3d2b,
  soil: 0x7a4e2d,
  soilDark: 0x5d3a20,
  gold: "#f5c542",
  text: "#fff8ec",
  muted: "#d7c8b0",
  good: 0x43a047,
  disabled: 0x6d5a4c,
};

const text = (s: Phaser.Scene, x: number, y: number, str: string, size: number, color = COL.text, bold = true) =>
  s.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: bold ? "bold" : "normal" });

// Field layout: 3 columns, up to 4 rows.
const PLOT_W = 196, PLOT_H = 148, GAP = 16, FIELD_X = (W - (3 * PLOT_W + 2 * GAP)) / 2, FIELD_Y = 150;
const plotPos = (i: number) => ({
  x: FIELD_X + (i % 3) * (PLOT_W + GAP) + PLOT_W / 2,
  y: FIELD_Y + Math.floor(i / 3) * (PLOT_H + GAP) + PLOT_H / 2,
});

interface PlotView {
  bg: Phaser.GameObjects.Rectangle;
  sprite: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Rectangle;
  barBg: Phaser.GameObjects.Rectangle;
  lastStage: string;
}

class MarketGarden extends Phaser.Scene {
  private s!: L.State;
  private plots: PlotView[] = [];
  private emptySlots: Phaser.GameObjects.Container[] = [];
  private coinText!: Phaser.GameObjects.Text;
  private totalText!: Phaser.GameObjects.Text;
  private cropButtons: { id: string; c: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; lock: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image }[] = [];
  private sellBtn!: { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text };
  private invText!: Phaser.GameObjects.Text;
  private orderGroup!: Phaser.GameObjects.Container;
  private orderText!: Phaser.GameObjects.Text;
  private orderIcon!: Phaser.GameObjects.Image;
  private orderBg!: Phaser.GameObjects.Rectangle;
  private upgradePanel!: Phaser.GameObjects.Container;
  private upgradeRows: { id: L.UpgradeId; desc: Phaser.GameObjects.Text; btn: Phaser.GameObjects.Rectangle; btnText: Phaser.GameObjects.Text; title: Phaser.GameObjects.Text }[] = [];
  private helperClock = 0;
  private orderClock = 0;
  private saveClock = 0;
  private bestSent = 0;
  private dragging = false;

  constructor() {
    super("market-garden");
  }

  async create() {
    makeArt(this);
    const now = Date.now();
    this.s = L.parseState(await loadSave(GAME_ID), now);
    const offline = L.offlineEarnings(this.s, now);
    if (offline > 0) L.earn(this.s, offline);
    this.s.lastSeen = now;

    this.add.rectangle(W / 2, 640, W, 1280, COL.bg);
    this.buildHeader();
    this.buildField();
    this.buildCropBar();
    this.buildMarket();
    this.buildUpgradeButton();
    this.buildUpgradePanel();

    this.input.on("pointerup", () => (this.dragging = false));
    onPause(() => this.persist());

    this.refreshAll();
    if (offline > 0) this.toast(`Welcome back! Your farmhand earned ${L.formatNum(offline)} coins`);
    else if (this.s.lifetime === 0) this.toast("Tap a plot to plant wheat");

    gameReady();
  }

  // ---------- building the screen ----------

  private buildHeader() {
    this.add.rectangle(W / 2, 60, W, 120, COL.panel);
    this.add.image(52, 48, "coin").setScale(1.1);
    this.coinText = text(this, 86, 26, "", 44, COL.gold);
    this.totalText = text(this, 86, 78, "", 22, COL.muted, false);
    text(this, W - 28, 32, "Market Garden", 30).setOrigin(1, 0);
  }

  private buildField() {
    for (let i = 0; i < L.MAX_PLOTS; i++) {
      const { x, y } = plotPos(i);
      const bg = this.add.rectangle(x, y, PLOT_W, PLOT_H, COL.soil).setStrokeStyle(4, COL.soilDark).setInteractive();
      const sprite = this.add.image(x, y - 6, "sprout").setVisible(false);
      const barBg = this.add.rectangle(x, y + PLOT_H / 2 - 16, PLOT_W - 40, 10, 0x000000, 0.35);
      const bar = this.add.rectangle(x - (PLOT_W - 40) / 2, y + PLOT_H / 2 - 16, 0, 10, 0x9ccc65).setOrigin(0, 0.5);
      const act = () => this.tapPlot(i);
      bg.on("pointerdown", () => { this.dragging = true; act(); });
      bg.on("pointerover", (p: Phaser.Input.Pointer) => { if (this.dragging && p.isDown) act(); });
      this.plots.push({ bg, sprite, bar, barBg, lastStage: "" });

      // "Buy plot" placeholder for slots you don't own yet.
      const slot = this.add.container(x, y);
      const sbg = this.add.rectangle(0, 0, PLOT_W, PLOT_H, 0x000000, 0.12).setStrokeStyle(3, 0xffffff, 0.35).setInteractive({ useHandCursor: true });
      const plus = text(this, 0, -14, "+", 56, "#ffffffaa").setOrigin(0.5);
      const cost = text(this, 0, 34, "", 22, "#ffffffcc").setOrigin(0.5);
      slot.add([sbg, plus, cost]);
      slot.setData("cost", cost);
      sbg.on("pointerdown", () => this.buy("plot"));
      this.emptySlots.push(slot);
    }
  }

  private buildCropBar() {
    const y = 840, bw = 94, gap = 5, x0 = (W - (L.CROPS.length * bw + (L.CROPS.length - 1) * gap)) / 2;
    this.add.rectangle(W / 2, y + 62, W, 140, COL.panel, 0.9);
    L.CROPS.forEach((crop, i) => {
      const x = x0 + i * (bw + gap) + bw / 2;
      const c = this.add.container(x, y + 62);
      const bg = this.add.rectangle(0, 0, bw, 124, COL.panelLight).setStrokeStyle(4, 0xffffff, 0).setInteractive({ useHandCursor: true });
      const icon = this.add.image(0, -18, `ripe-${crop.id}`).setScale(0.62);
      const lock = this.add.image(0, -20, "lock").setScale(0.8);
      const label = text(this, 0, 38, "", 18).setOrigin(0.5);
      c.add([bg, icon, lock, label]);
      bg.on("pointerdown", () => this.tapCrop(crop.id));
      this.cropButtons.push({ id: crop.id, c, bg, label, lock, icon });
    });
  }

  private buildMarket() {
    const y = 1072;
    this.add.rectangle(W / 2, y, W, 180, COL.panelLight);
    // Striped awning
    for (let i = 0; i < 12; i++) this.add.rectangle(30 + i * 60, 992, 60, 22, i % 2 ? 0xfff8ec : 0xc62828);

    this.orderGroup = this.add.container(0, 0);
    const cust = this.add.image(80, y + 4, "customer").setScale(0.9);
    this.orderBg = this.add.rectangle(270, y + 4, 250, 120, 0xfff8ec).setStrokeStyle(4, 0xffffff).setInteractive({ useHandCursor: true });
    this.orderIcon = this.add.image(196, y + 4, "ripe-wheat").setScale(0.6);
    this.orderText = this.add.text(236, y + 4, "", { fontFamily: FONT, fontSize: "24px", color: "#3e2a1f", fontStyle: "bold" }).setOrigin(0, 0.5);
    this.orderGroup.add([cust, this.orderBg, this.orderIcon, this.orderText]);
    this.orderBg.on("pointerdown", () => {
      const reward = L.fulfilOrder(this.s);
      if (reward > 0) {
        this.floatText(270, y - 40, `+${L.formatNum(reward)}`);
        this.orderClock = 0;
        this.refreshAll();
        this.persist();
      } else {
        this.tweens.add({ targets: this.orderBg, x: "+=8", duration: 50, yoyo: true, repeat: 2 });
      }
    });

    const bg = this.add.rectangle(560, y - 14, 260, 86, COL.good).setInteractive({ useHandCursor: true });
    const label = text(this, 560, y - 14, "", 28).setOrigin(0.5);
    this.invText = text(this, 560, y + 52, "", 20, COL.muted, false).setOrigin(0.5);
    bg.on("pointerdown", () => {
      const v = L.sellAll(this.s);
      if (v > 0) {
        this.floatText(560, y - 70, `+${L.formatNum(v)}`);
        this.refreshAll();
        this.persist();
      }
    });
    this.sellBtn = { bg, label };
  }

  private buildUpgradeButton() {
    const bg = this.add.rectangle(W / 2, 1218, W - 40, 88, 0xf5c542).setInteractive({ useHandCursor: true });
    text(this, W / 2, 1218, "Upgrades", 34, "#3e2a1f").setOrigin(0.5);
    bg.on("pointerdown", () => this.showUpgrades(true));
  }

  private buildUpgradePanel() {
    const p = this.add.container(0, 0).setDepth(10).setVisible(false);
    const shade = this.add.rectangle(W / 2, 640, W, 1280, 0x000000, 0.6).setInteractive();
    shade.on("pointerdown", () => this.showUpgrades(false));
    const box = this.add.rectangle(W / 2, 640, W - 40, 760, COL.panel).setStrokeStyle(4, 0xf5c542).setInteractive();
    const title = text(this, W / 2, 310, "Upgrades", 40, COL.gold).setOrigin(0.5);
    p.add([shade, box, title]);
    L.UPGRADES.forEach((u, i) => {
      const y = 420 + i * 140;
      const t = text(this, 50, y - 30, u.name, 30);
      const desc = text(this, 50, y + 12, "", 22, COL.muted, false);
      const btn = this.add.rectangle(W - 130, y, 180, 80, COL.good).setInteractive({ useHandCursor: true });
      const btnText = text(this, W - 130, y, "", 26).setOrigin(0.5);
      btn.on("pointerdown", () => this.buy(u.id));
      p.add([t, desc, btn, btnText]);
      this.upgradeRows.push({ id: u.id, desc, btn, btnText, title: t });
    });
    const close = this.add.rectangle(W / 2, 960, 260, 72, COL.panelLight).setInteractive({ useHandCursor: true });
    const closeT = text(this, W / 2, 960, "Close", 28).setOrigin(0.5);
    close.on("pointerdown", () => this.showUpgrades(false));
    p.add([close, closeT]);
    this.upgradePanel = p;
  }

  // ---------- actions ----------

  private tapPlot(i: number) {
    if (i >= this.s.plots.length) return;
    const now = Date.now();
    const p = this.s.plots[i];
    const { x, y } = plotPos(i);
    if (L.isRipe(this.s, p, now)) {
      const id = L.harvest(this.s, i, now)!;
      this.floatIcon(x, y, id);
      // Replant straight away if we can: keeps tapping snappy.
      L.plant(this.s, i, this.s.selected, now);
    } else if (!p.crop) {
      if (!L.plant(this.s, i, this.s.selected, now)) {
        if (!this.dragging || this.input.activePointer.getDuration() < 50) this.toast("Not enough coins for seeds. Sell your crops!");
      }
    }
    this.refreshAll();
  }

  private tapCrop(id: string) {
    if (this.s.unlocked.includes(id)) {
      this.s.selected = id;
    } else if (L.unlockCrop(this.s, id)) {
      this.toast(`${L.cropById(id).name} unlocked!`);
      this.persist();
    } else {
      const c = L.cropById(id);
      const idx = L.CROPS.indexOf(c);
      const prev = L.CROPS[idx - 1];
      this.toast(this.s.unlocked.includes(prev.id) ? `Unlock ${c.name} for ${L.formatNum(c.unlock)} coins` : `Unlock ${prev.name} first`);
    }
    this.refreshAll();
  }

  private buy(id: L.UpgradeId) {
    if (L.buyUpgrade(this.s, id)) {
      this.refreshAll();
      this.persist();
    }
  }

  private showUpgrades(on: boolean) {
    this.upgradePanel.setVisible(on);
    this.refreshAll();
  }

  // ---------- drawing state ----------

  private refreshAll() {
    const s = this.s;
    this.coinText.setText(L.formatNum(s.coins));
    this.totalText.setText(`Total earned: ${L.formatNum(s.lifetime)}`);

    this.plots.forEach((v, i) => {
      const owned = i < s.plots.length;
      v.bg.setVisible(owned);
      v.barBg.setVisible(owned && !!s.plots[i]?.crop);
      v.bar.setVisible(owned && !!s.plots[i]?.crop);
      if (!owned) v.sprite.setVisible(false);
      const slot = this.emptySlots[i];
      const nextSlot = i === s.plots.length;
      slot.setVisible(nextSlot);
      if (nextSlot) {
        const cost = L.upgradeCost(s, "plot");
        (slot.getData("cost") as Phaser.GameObjects.Text).setText(cost === null ? "" : `${L.formatNum(cost)} coins`);
        slot.setAlpha(cost !== null && s.coins >= cost ? 1 : 0.55);
      }
    });

    this.cropButtons.forEach((b) => {
      const crop = L.cropById(b.id);
      const unlocked = s.unlocked.includes(b.id);
      b.lock.setVisible(!unlocked);
      b.icon.setAlpha(unlocked ? 1 : 0.25);
      b.label.setText(unlocked ? `${crop.seed}` : L.formatNum(crop.unlock));
      b.label.setColor(unlocked ? COL.text : s.coins >= crop.unlock ? COL.gold : COL.muted);
      b.bg.setStrokeStyle(4, 0xf5c542, s.selected === b.id ? 1 : 0);
      b.bg.setFillStyle(s.selected === b.id ? 0x7a5238 : COL.panelLight);
    });

    const inv = L.inventoryValue(s);
    const count = Object.values(s.inventory).reduce((a, b) => a + b, 0);
    this.sellBtn.label.setText(inv > 0 ? `Sell ${L.formatNum(inv)}` : "Sell");
    this.sellBtn.bg.setFillStyle(inv > 0 ? COL.good : COL.disabled);
    this.invText.setText(count > 0 ? `${count} crops in your basket` : "Basket is empty");

    this.orderGroup.setVisible(!!s.order);
    if (s.order) {
      const have = Math.min(s.inventory[s.order.crop] ?? 0, s.order.qty);
      this.orderIcon.setTexture(`ripe-${s.order.crop}`);
      this.orderText.setText(`${have}/${s.order.qty}\nPays ${L.formatNum(s.order.reward)}`);
      this.orderBg.setStrokeStyle(5, L.canFulfil(s) ? 0x43a047 : 0xffffff);
    }

    if (this.upgradePanel.visible) {
      this.upgradeRows.forEach((r) => {
        const def = L.UPGRADES.find((u) => u.id === r.id)!;
        const lvl = s.levels[r.id];
        const cost = L.upgradeCost(s, r.id);
        r.title.setText(`${def.name}  ·  Lv ${lvl}`);
        r.desc.setText(def.describe(r.id === "helper" && lvl === 0 ? 0 : lvl));
        r.btnText.setText(cost === null ? "Max" : L.formatNum(cost));
        r.btn.setFillStyle(cost !== null && s.coins >= cost ? COL.good : COL.disabled);
      });
    }

    if (s.lifetime > this.bestSent) {
      this.bestSent = s.lifetime;
      sendScore(s.lifetime);
    }
  }

  update(_t: number, dt: number) {
    if (!this.s) return;
    const now = Date.now();
    const s = this.s;

    this.plots.forEach((v, i) => {
      const p = s.plots[i];
      if (!p) return;
      if (!p.crop) {
        if (v.lastStage !== "") { v.sprite.setVisible(false); v.lastStage = ""; }
        return;
      }
      const pr = L.progress(s, p, now);
      v.bar.width = (PLOT_W - 40) * pr;
      v.bar.setFillStyle(pr >= 1 ? 0xf5c542 : 0x9ccc65);
      const stage = pr >= 1 ? `ripe-${p.crop}` : pr >= 0.4 ? `grow-${p.crop}` : "sprout";
      if (stage !== v.lastStage) {
        v.lastStage = stage;
        v.sprite.setTexture(stage).setVisible(true).setScale(1.1);
        if (pr >= 1) this.tweens.add({ targets: v.sprite, scale: 1.3, duration: 120, yoyo: true });
      }
    });

    const helperEvery = L.helperInterval(s.levels.helper) * 1000;
    this.helperClock += dt;
    if (this.helperClock >= helperEvery) {
      this.helperClock = 0;
      if (L.helperTick(s, now) > 0) this.refreshAll();
    }

    // A new customer arrives a few seconds after the last one leaves.
    if (!s.order && s.lifetime >= 15) {
      this.orderClock += dt;
      if (this.orderClock > 4000) {
        s.order = L.newOrder(s);
        this.orderClock = 0;
        this.refreshAll();
      }
    }

    this.saveClock += dt;
    if (this.saveClock > 5000) {
      this.saveClock = 0;
      this.persist();
      this.refreshAll();
    }
  }

  private persist() {
    this.s.lastSeen = Date.now();
    save(GAME_ID, JSON.stringify(this.s));
  }

  // ---------- small effects ----------

  private floatText(x: number, y: number, str: string) {
    const t = text(this, x, y, str, 40, COL.gold).setOrigin(0.5).setStroke("#3e2a1f", 6).setDepth(5);
    this.tweens.add({ targets: t, y: y - 80, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  private floatIcon(x: number, y: number, cropId: string) {
    const img = this.add.image(x, y, `ripe-${cropId}`).setDepth(5);
    this.tweens.add({ targets: img, x: 560, y: 1060, scale: 0.4, duration: 450, ease: "Quad.easeIn", onComplete: () => img.destroy() });
  }

  private toastObj?: Phaser.GameObjects.Container;
  private toast(msg: string) {
    this.toastObj?.destroy();
    const t = text(this, 0, 0, msg, 26).setOrigin(0.5).setWordWrapWidth(W - 120).setAlign("center");
    const bg = this.add.rectangle(0, 0, Math.min(W - 60, t.width + 48), t.height + 32, 0x000000, 0.78);
    const c = this.add.container(W / 2, 150 + 4 * (PLOT_H + GAP) / 2, [bg, t]).setDepth(20);
    this.toastObj = c;
    this.tweens.add({ targets: c, alpha: 0, delay: 2200, duration: 400, onComplete: () => c.destroy() });
  }
}

bootGame([MarketGarden]);
