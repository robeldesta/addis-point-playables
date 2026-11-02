// Synthesized bowling sounds. No audio files to download.
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private rollGain: GainNode | null = null;
  private lastHit = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    const len = ctx.sampleRate * 1;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Continuous rolling rumble, volume driven by setRoll().
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    src.connect(lp).connect(this.rollGain).connect(ctx.destination);
    src.start();
  }
  suspend() { this.ctx?.suspend().catch(() => {}); }
  resume() { this.ctx?.resume().catch(() => {}); }

  private ok() {
    return this.ctx && this.enabled && this.ctx.state === "running" ? this.ctx : null;
  }

  setRoll(level: number) {
    if (!this.ctx || !this.rollGain) return;
    const v = this.enabled ? Math.min(0.5, level) : 0;
    this.rollGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.12, slide = 0, delay = 0) {
    const ctx = this.ok();
    if (!ctx) return;
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

  private burst(freq: number, q: number, dur: number, vol: number) {
    const ctx = this.ok();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Pin clatter. strength 0..1 */
  hit(strength: number) {
    const now = performance.now();
    if (now - this.lastHit < 25) return;
    this.lastHit = now;
    const s = Math.min(1, strength);
    this.burst(1400 + Math.random() * 1600, 3, 0.09 + s * 0.08, 0.25 + s * 0.5);
    this.tone(700 + Math.random() * 500, 0.06, "triangle", 0.05 + s * 0.08, 0.6);
  }
  thud() { this.tone(110, 0.25, "sine", 0.3, 0.5); }
  swoosh() { this.burst(600, 0.7, 0.35, 0.18); }
  strike() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.13, 0, i * 0.07));
  }
  spare() {
    [659, 784, 988].forEach((f, i) => this.tone(f, 0.2, "triangle", 0.12, 0, i * 0.08));
  }
  sad() { this.tone(330, 0.35, "triangle", 0.1, 0.6); }
  click() { this.tone(900, 0.04, "square", 0.04); }
}
