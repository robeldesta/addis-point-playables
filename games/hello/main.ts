import Phaser from "phaser";
import { bootGame } from "../../src/platform/boot";
import { gameReady, loadSave, save, sendScore } from "../../src/platform/platform";

// A tiny tap counter that proves the whole pipeline works:
// scaling, saving, score reporting and the Playables lifecycle.
const GAME_ID = "hello";

class HelloScene extends Phaser.Scene {
  private taps = 0;
  private best = 0;

  constructor() {
    super("hello");
  }

  async create() {
    const raw = await loadSave(GAME_ID);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        this.taps = s.taps ?? 0;
        this.best = s.best ?? 0;
      } catch { /* ignore bad saves */ }
    }

    const { width, height } = this.scale.gameSize;
    this.add.text(width / 2, 260, "Addis Point", { fontSize: "64px", color: "#f5c542", fontStyle: "bold" }).setOrigin(0.5);
    const label = this.add.text(width / 2, height / 2 - 220, "", { fontSize: "48px", color: "#ffffff", align: "center" }).setOrigin(0.5);

    const button = this.add.circle(width / 2, height / 2 + 120, 180, 0x2e7d32).setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height / 2 + 120, "TAP", { fontSize: "72px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5);

    const render = () => label.setText(`Taps: ${this.taps}\nBest: ${this.best}`);
    render();

    button.on("pointerdown", () => {
      this.taps++;
      if (this.taps > this.best) {
        this.best = this.taps;
        sendScore(this.best);
      }
      this.tweens.add({ targets: button, scale: 0.92, duration: 60, yoyo: true });
      render();
      save(GAME_ID, JSON.stringify({ taps: this.taps, best: this.best }));
    });

    // Player can interact now: tell YouTube exactly once.
    gameReady();
  }
}

bootGame([HelloScene]);
