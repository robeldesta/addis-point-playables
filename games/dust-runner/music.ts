// Original phonk-style racing loop, synthesized live: pitched cowbell lead,
// distorted 808 bass with glides, punchy kick, clap and rolling hats.
// 16-bar song: a filtered intro, then the full beat, with a drop before it loops.

const BPM = 132;
const S16 = 60 / BPM / 4;

// F minor: semitone offsets from F
const F = (semi: number, oct: number) => 87.307 * Math.pow(2, semi / 12 + oct - 2); // F2 = 87.3 Hz

// cowbell lead: [step, semitone, octave]
const LEAD: [number, number, number][][] = [
  [[0, 0, 5], [3, 0, 5], [6, 3, 5], [8, 0, 5], [10, -2, 5], [11, 0, 5], [14, -5, 5]],
  [[0, 0, 5], [3, 0, 5], [6, 3, 5], [8, 5, 5], [10, 3, 5], [12, 2, 5], [14, 0, 5]],
  [[0, 0, 5], [3, 0, 5], [6, 3, 5], [8, 0, 5], [10, -2, 5], [11, 0, 5], [14, -5, 5]],
  [[0, 7, 5], [3, 5, 5], [6, 3, 5], [8, 2, 5], [10, 0, 5], [12, -2, 5], [14, -5, 5]],
];
// 808 roots per bar of the 4-bar phrase (Fm, Fm, Db, Eb) and the hit pattern
const ROOT = [0, 0, -4, -2];
const BASS: [number, number, number][] = [[0, 0, 6], [7, 0, 2], [10, 12, 3], [14, 0, 2]]; // step, +semi, length in 16ths
const KICK = [0, 7, 10];
const CLAP = [4, 12];

export class Music {
  on = true;
  private bus?: GainNode;
  private lp?: BiquadFilterNode;
  private noise?: AudioBuffer;
  private shaper?: WaveShaperNode;
  private step = 0;
  private next = 0;
  private timer = 0;
  private lastBass = 0;

  constructor(private get: () => { ctx: AudioContext; out: AudioNode } | null) {}

  private init() {
    const a = this.get();
    if (!a) return null;
    const { ctx, out } = a;
    if (!this.bus) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
      this.lp = ctx.createBiquadFilter(); this.lp.type = "lowpass"; this.lp.frequency.value = 18000; this.lp.Q.value = 0.9;
      this.bus = ctx.createGain(); this.bus.gain.value = this.on ? 0.5 : 0;
      this.bus.connect(this.lp).connect(comp).connect(out);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 4) * 0.8; }
      this.shaper = ctx.createWaveShaper(); this.shaper.curve = curve;
      const sg = ctx.createGain(); sg.gain.value = 0.7;
      this.shaper.connect(sg).connect(this.bus);
    }
    return ctx;
  }

  start() {
    const ctx = this.init();
    if (!ctx || this.timer) return;
    this.next = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.pump(), 25);
  }

  setOn(on: boolean) {
    this.on = on;
    if (this.bus) this.bus.gain.setTargetAtTime(on ? this.level : 0, this.bus.context.currentTime, 0.05);
  }

  private level = 0.5;
  /** quieter under the engine while driving; muffled in slow motion */
  mix(driving: boolean, slow: boolean) {
    if (!this.bus || !this.lp) return;
    const t = this.bus.context.currentTime;
    const lv = driving ? 0.42 : 0.55;
    if (lv !== this.level) { this.level = lv; if (this.on) this.bus.gain.setTargetAtTime(lv, t, 0.3); }
    this.lp.frequency.setTargetAtTime(slow ? 650 : 18000, t, 0.12);
  }

  private pump() {
    const a = this.get();
    if (!a || a.ctx.state !== "running") return;
    const ctx = a.ctx;
    if (this.next < ctx.currentTime - 0.2) this.next = ctx.currentTime + 0.05; // tab was asleep
    while (this.next < ctx.currentTime + 0.15) {
      this.play(this.step, this.next);
      this.next += S16;
      this.step = (this.step + 1) % (16 * 16);
    }
  }

  private play(step: number, t: number) {
    const bar = Math.floor(step / 16), s = step % 16, ph = bar % 4;
    const intro = bar < 4, drop = bar === 15 && s >= 8;
    // intro: lead and hats only, opening filter
    for (const [st, semi, oct] of LEAD[ph]) if (st === s) this.cowbell(t, F(semi, oct), intro ? 0.11 : 0.16);
    if (drop) { if (s === 8) this.cowbell(t, F(0, 6), 0.2); return; }
    if (s % 2 === 0 || (ph === 3 && s >= 12)) this.hat(t, s % 4 === 2 ? 0.07 : 0.045, s === 14 && ph % 2 === 1);
    if (intro) { if (bar === 3 && s >= 12) this.clap(t, 0.25 + (s - 12) * 0.1); return; }
    if (KICK.includes(s) || (ph === 3 && s === 13)) this.kick(t);
    if (CLAP.includes(s)) this.clap(t, 0.55);
    for (const [st, semi, len] of BASS) if (st === s) this.bass(t, F(ROOT[ph] + semi, 1), len * S16);
  }

  private env(t: number, peak: number, dec: number) {
    const g = this.bus!.context.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dec);
    return g;
  }

  private cowbell(t: number, f: number, vol: number) {
    const ctx = this.bus!.context as AudioContext;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 1.5; bp.Q.value = 1.2;
    const g = this.env(t, vol, 0.32);
    for (const m of [1, 1.505]) {
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f * m;
      o.connect(bp); o.start(t); o.stop(t + 0.35);
    }
    bp.connect(g).connect(this.bus!);
  }

  private kick(t: number) {
    const ctx = this.bus!.context as AudioContext;
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = this.env(t, 0.9, 0.3);
    o.connect(g).connect(this.shaper!); o.start(t); o.stop(t + 0.32);
  }

  private bass(t: number, f: number, dur: number) {
    const ctx = this.bus!.context as AudioContext;
    const o = ctx.createOscillator(); o.type = "sine";
    const from = this.lastBass && Math.abs(this.lastBass - f) > 1 ? this.lastBass : f;
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    this.lastBass = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.75, t + 0.01);
    g.gain.setValueAtTime(0.75, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
    o.connect(g).connect(lp).connect(this.shaper!); o.start(t); o.stop(t + dur + 0.08);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, q: number, g: GainNode, dur: number) {
    const ctx = this.bus!.context as AudioContext;
    const src = ctx.createBufferSource(); src.buffer = this.noise!;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(g).connect(this.bus!); src.start(t, Math.random() * 0.5); src.stop(t + dur);
  }

  private hat(t: number, vol: number, open: boolean) {
    const dec = open ? 0.22 : 0.045;
    this.noiseHit(t, "highpass", 7500, 0.7, this.env(t, vol, dec), dec + 0.02);
  }

  private clap(t: number, vol: number) {
    const ctx = this.bus!.context as AudioContext;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (const d of [0, 0.011, 0.022]) { g.gain.setValueAtTime(vol, t + d); g.gain.exponentialRampToValueAtTime(vol * 0.3, t + d + 0.009); }
    g.gain.setValueAtTime(vol, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    this.noiseHit(t, "bandpass", 1600, 0.9, g, 0.25);
  }
}
