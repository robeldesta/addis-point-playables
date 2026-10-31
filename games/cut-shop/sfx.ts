// Synthesized sounds, no audio files.
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; }
  }
  suspend() { this.ctx?.suspend().catch(() => {}); }
  resume() { this.ctx?.resume().catch(() => {}); }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.1, slide = 0, delay = 0) {
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
    o.connect(g).connect(this.ctx!.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click() { this.tone(660, 0.05, "triangle", 0.06, 1.3); }
  zap() { this.tone(1800, 0.12, "sawtooth", 0.035, 0.4); }
  day() { this.tone(420, 0.08, "square", 0.04, 1.5); }
  coin() { this.tone(1320, 0.08, "triangle", 0.08); this.tone(1760, 0.12, "triangle", 0.08, 0, 0.07); }
  bad() { this.tone(220, 0.25, "sawtooth", 0.06, 0.6); }
  build() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.09, 0, i * 0.08)); }
}
