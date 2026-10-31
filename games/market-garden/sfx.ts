// Tiny synthesized sound effects. No audio files to download.
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private lastTick = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }
  suspend() { this.ctx?.suspend().catch(() => {}); }
  resume() { this.ctx?.resume().catch(() => {}); }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.12, slide = 0, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  pop() { this.tone(520 + Math.random() * 260, 0.08, "triangle", 0.1, 1.6); }
  tick() {
    const now = performance.now();
    if (now - this.lastTick < 45) return;
    this.lastTick = now;
    this.tone(880 + Math.random() * 120, 0.05, "square", 0.04);
  }
  coin() {
    this.tone(1320, 0.08, "triangle", 0.1);
    this.tone(1760, 0.12, "triangle", 0.1, 0, 0.07);
  }
  build() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.12, 0, i * 0.08));
  }
}
