// Synthesized engine, gravel and impacts. No audio files.
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private eng?: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  private gravel?: { g: GainNode; f: BiquadFilterNode };
  private wind?: { g: GainNode; f: BiquadFilterNode };
  private lastHit = 0;

  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); return; }
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 600; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const o1 = ctx.createOscillator(); o1.type = "sawtooth";
    const o2 = ctx.createOscillator(); o2.type = "square";
    const o3 = ctx.createOscillator(); o3.type = "sawtooth";
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o1.connect(f); o2.connect(g2).connect(f); o3.connect(f);
    f.connect(g).connect(this.master);
    o1.start(); o2.start(); o3.start();
    this.eng = { o1, o2, o3, f, g };
    const loop = (type: BiquadFilterType, freq: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise!; src.loop = true;
      const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = freq; bf.Q.value = 0.8;
      const bg = ctx.createGain(); bg.gain.value = 0;
      src.connect(bf).connect(bg).connect(this.master!); src.start();
      return { g: bg, f: bf };
    };
    this.gravel = loop("bandpass", 900);
    this.wind = loop("lowpass", 500);
  }
  setEnabled(on: boolean) { this.enabled = on; if (this.master) this.master.gain.value = on ? 0.8 : 0; }
  suspend() { this.ctx?.suspend().catch(() => {}); }
  resume() { this.ctx?.resume().catch(() => {}); }

  /** rpm, throttle 0..1, ground speed m/s, wheels on the ground 0..4, slip */
  drive(rpm: number, throttle: number, speed: number, grounded: number, slip: number) {
    const ctx = this.ctx; if (!ctx || !this.eng || !this.gravel || !this.wind) return;
    const t = ctx.currentTime;
    const fr = (rpm / 60) * 2; // V8-ish firing pulses / 2
    this.eng.o1.frequency.setTargetAtTime(fr, t, 0.03);
    this.eng.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.03);
    this.eng.o3.frequency.setTargetAtTime(fr * 1.012, t, 0.03);
    this.eng.f.frequency.setTargetAtTime(300 + rpm * 0.18 + throttle * 700, t, 0.05);
    this.eng.g.gain.setTargetAtTime(0.07 + throttle * 0.11, t, 0.05);
    const on = grounded / 4;
    this.gravel.g.gain.setTargetAtTime(Math.min(0.35, (speed * 0.012 + slip * 0.03) * on), t, 0.05);
    this.gravel.f.frequency.setTargetAtTime(600 + speed * 25, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.3, speed * speed * 0.00018), t, 0.1);
  }
  mute() { const ctx = this.ctx; if (!ctx || !this.eng) return; const t = ctx.currentTime; this.eng.g.gain.setTargetAtTime(0, t, 0.05); this.gravel!.g.gain.setTargetAtTime(0, t, 0.05); this.wind!.g.gain.setTargetAtTime(0, t, 0.05); }

  thud(strength: number) {
    const ctx = this.ctx; if (!ctx || !this.enabled || ctx.state !== "running" || !this.noise) return;
    const t = ctx.currentTime;
    if (t - this.lastHit < 0.12) return;
    this.lastHit = t;
    const v = Math.min(1, strength);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.master!); o.start(t); o.stop(t + 0.32);
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.35 * v, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    s.connect(f).connect(g2).connect(this.master!); s.start(t, Math.random()); s.stop(t + 0.3);
  }
  beep(go: boolean) {
    const ctx = this.ctx; if (!ctx || !this.enabled || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = go ? 880 : 440;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + (go ? 0.5 : 0.2));
    o.connect(g).connect(this.master!); o.start(t); o.stop(t + 0.55);
  }
  ding() {
    const ctx = this.ctx; if (!ctx || !this.enabled || ctx.state !== "running") return;
    const t = ctx.currentTime;
    [660, 990].forEach((fq, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = fq;
      g.gain.setValueAtTime(0.0001, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.35);
      o.connect(g).connect(this.master!); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.4);
    });
  }
}
