// Synthesized sounds. No audio files to download.
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastSplat = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; return; }
    const ctx = this.ctx;
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  suspend() { this.ctx?.suspend().catch(() => {}); }
  resume() { this.ctx?.resume().catch(() => {}); }
  private ok() { return this.ctx && this.enabled && this.ctx.state === "running" ? this.ctx : null; }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.12, slide = 0, delay = 0) {
    const ctx = this.ok(); if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = "bandpass", delay = 0) {
    const ctx = this.ok(); if (!ctx || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  splat(combo: number) {
    const now = performance.now();
    if (now - this.lastSplat < 40) return;
    this.lastSplat = now;
    this.burst(500 + Math.random() * 400, 1.2, 0.12, 0.35);
    this.tone(320 + Math.min(combo, 30) * 25, 0.08, "square", 0.05, 1.5);
  }
  crunch(big: number) {
    this.burst(200 + Math.random() * 200, 0.8, 0.35 + big * 0.3, 0.6, "lowpass");
    this.burst(2500, 2, 0.18, 0.25);
    this.tone(90, 0.3, "sine", 0.35, 0.5);
  }
  crash() {
    this.tone(140, 0.45, "sawtooth", 0.18, 0.4);
    this.burst(150, 0.7, 0.5, 0.7, "lowpass");
  }
  roar() {
    this.tone(180, 1.0, "sawtooth", 0.18, 0.45);
    this.tone(120, 1.1, "square", 0.08, 0.5);
    this.burst(400, 0.5, 1.0, 0.45, "lowpass");
  }
  stomp() { this.tone(70, 0.12, "sine", 0.15, 0.6); }
  levelUp() { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, "triangle", 0.13, 0, i * 0.07)); }
  levelDown() { [523, 415, 330].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.11, 0, i * 0.1)); }
  warn() { this.tone(880, 0.07, "square", 0.04); }
  over() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.12, 0, i * 0.15)); }
  click() { this.tone(900, 0.04, "square", 0.04); }
  jump() { this.tone(260, 0.22, "square", 0.07, 2.4); }
  land(big: number) { this.tone(90, 0.25, "sine", 0.35, 0.4); this.burst(180, 0.7, 0.25 + big * 0.2, 0.5, "lowpass"); }
  egg(n: number) { this.tone(988 + Math.min(n, 8) * 60, 0.09, "square", 0.05); this.tone(1318 + Math.min(n, 8) * 80, 0.12, "triangle", 0.06, 0, 0.05); }
  whistle() { this.tone(1500, 1.2, "sine", 0.05, 0.35); }
  boom() { this.burst(120, 0.6, 0.7, 0.8, "lowpass"); this.tone(60, 0.5, "sine", 0.35, 0.5); }
  turn() { this.burst(900, 0.8, 0.4, 0.2); }
}
