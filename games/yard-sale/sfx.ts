// Synthesized sound, no audio files.
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private wind?: { g: GainNode; f: BiquadFilterNode };
  private carve?: { g: GainNode; f: BiquadFilterNode };
  private master?: GainNode;
  private lastThud = 0;

  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); return; }
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = (type: BiquadFilterType, freq: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master!); src.start();
      return { g, f };
    };
    this.wind = loop("lowpass", 400);
    this.carve = loop("bandpass", 2500);
  }
  setEnabled(on: boolean) { this.enabled = on; if (this.master) this.master.gain.value = on ? 1 : 0; }
  suspend() { this.ctx?.suspend().catch(() => {}); }
  resume() { this.ctx?.resume().catch(() => {}); }
  private ok() { return this.ctx && this.enabled && this.ctx.state === "running" ? this.ctx : null; }

  /** continuous: speed in m/s, skid 0.., airborne */
  ride(speed: number, skid: number, air: boolean, carve = 0) {
    const ctx = this.ctx; if (!ctx || !this.wind || !this.carve) return;
    const t = ctx.currentTime;
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, speed * speed * 0.0006), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + speed * 40, t, 0.1);
    const swoosh = carve * Math.min(1, speed / 12) * 0.3;
    this.carve.g.gain.setTargetAtTime(air ? 0 : Math.min(0.4, 0.02 + skid * 0.05 + swoosh) * Math.min(1, speed / 4), t, 0.05);
    this.carve.f.frequency.setTargetAtTime(1400 + skid * 300 + carve * 1200, t, 0.08);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.12, slide = 0, delay = 0) {
    const ctx = this.ok(); if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
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
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
  thud(power: number, vol = 1) {
    const now = performance.now();
    if (now - this.lastThud < 45) return;
    this.lastThud = now;
    const p = Math.min(1, power);
    this.burst(180 + Math.random() * 120, 0.8, 0.12 + p * 0.2, (0.2 + p * 0.6) * vol, "lowpass");
    this.tone(80 + Math.random() * 40, 0.15, "sine", 0.25 * p * vol, 0.5);
  }
  oof(pitch = 1) {
    this.tone(210 * pitch, 0.22, "sawtooth", 0.07, 0.6);
    this.tone(420 * pitch, 0.18, "triangle", 0.05, 0.55);
  }
  snap() { this.burst(3200, 3, 0.06, 0.4); this.tone(1400, 0.05, "square", 0.05, 0.4); }
  crashBig() { this.burst(400, 0.5, 0.6, 0.5, "lowpass"); this.burst(1500, 1, 0.3, 0.3); }
  beep(hi = false) { this.tone(hi ? 1046 : 523, hi ? 0.4 : 0.15, "square", 0.08); }
  trick() { [659, 880, 1175].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.1, 0, i * 0.06)); }
  land() { this.burst(600, 0.7, 0.18, 0.35, "lowpass"); }
  cheer() { for (let i = 0; i < 6; i++) this.burst(900 + Math.random() * 1500, 0.6, 0.8, 0.12, "bandpass", i * 0.12); }
  click() { this.tone(900, 0.04, "square", 0.04); }
  coin() { this.tone(988, 0.08, "square", 0.05); this.tone(1318, 0.15, "triangle", 0.06, 0, 0.06); }
  fail() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.1, 0, i * 0.15)); }
}
