/**
 * Sound effects synthesised live with the Web Audio API: no recordings and no
 * downloads. Sounds are panned left or right to match the two islands.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('tidebound-muted') === '1';
    } catch {
      /* storage may be blocked */
    }
    // Browsers only allow audio after a user gesture.
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem('tidebound-muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbience();
    return ctx;
  }

  /** An output with stereo position (-1 left .. 1 right). */
  private out(pan: number): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return null;
    if (typeof ctx.createStereoPanner !== 'function') return this.master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  /** A burst of filtered noise with an exponential decay. */
  private hiss(dest: AudioNode, opts: { type: BiquadFilterType; f0: number; f1: number; q?: number; gain: number; attack?: number; length: number; delay?: number }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.Q.value = opts.q ?? 0.7;
    f.frequency.setValueAtTime(opts.f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(opts.f1, 20), t + opts.length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.length);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.length + 0.05);
  }

  /** A pitched tone sweeping from f0 to f1. */
  private tone(dest: AudioNode, opts: { type: OscillatorType; f0: number; f1: number; gain: number; attack?: number; length: number; delay?: number }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(opts.f1, 20), t + opts.length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.length);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + opts.length + 0.05);
  }

  cannon(pan: number): void {
    const d = this.out(pan);
    if (!d) return;
    this.tone(d, { type: 'sine', f0: 110, f1: 38, gain: 0.9, length: 0.45 });
    this.hiss(d, { type: 'lowpass', f0: 2600, f1: 180, gain: 0.7, length: 0.6 });
    this.hiss(d, { type: 'highpass', f0: 3000, f1: 1500, gain: 0.25, length: 0.08 });
  }

  /** The falling whistle of a shell in flight. */
  whistle(duration: number, pan: number): void {
    const d = this.out(pan);
    if (!d) return;
    this.tone(d, { type: 'sine', f0: 1500, f1: 520, gain: 0.05, attack: duration * 0.4, length: duration, delay: 0.15 });
  }

  splash(pan: number): void {
    const d = this.out(pan);
    if (!d) return;
    this.tone(d, { type: 'sine', f0: 320, f1: 90, gain: 0.35, length: 0.25 });
    this.hiss(d, { type: 'bandpass', f0: 1800, f1: 500, q: 0.9, gain: 0.6, attack: 0.02, length: 1.1 });
    this.hiss(d, { type: 'highpass', f0: 4000, f1: 2500, gain: 0.12, attack: 0.1, length: 1.4, delay: 0.15 });
  }

  explosion(big: boolean, pan: number): void {
    const d = this.out(pan);
    if (!d) return;
    const k = big ? 1.4 : 1;
    this.tone(d, { type: 'sine', f0: 90, f1: 28, gain: 1, length: 0.9 * k });
    this.hiss(d, { type: 'lowpass', f0: 1800, f1: 90, gain: 0.9, length: 1.5 * k });
    this.hiss(d, { type: 'bandpass', f0: 900, f1: 200, q: 1.2, gain: 0.35, length: 0.9 * k, delay: 0.08 });
    if (big) this.hiss(d, { type: 'lowpass', f0: 600, f1: 60, gain: 0.6, attack: 0.1, length: 2.2, delay: 0.35 });
  }

  /** Bubbles and a deep groan as a ship goes down. */
  sink(pan: number): void {
    const d = this.out(pan);
    if (!d) return;
    this.tone(d, { type: 'sawtooth', f0: 70, f1: 40, gain: 0.08, attack: 0.3, length: 2.2, delay: 0.4 });
    for (let i = 0; i < 14; i++) {
      const f = 220 + Math.random() * 380;
      this.tone(d, { type: 'sine', f0: f, f1: f * 1.8, gain: 0.08, length: 0.09, delay: 0.5 + i * 0.12 + Math.random() * 0.08 });
    }
  }

  click(): void {
    const d = this.out(0);
    if (!d) return;
    this.tone(d, { type: 'triangle', f0: 1300, f1: 900, gain: 0.12, length: 0.06 });
  }

  aim(pan: number, on: boolean): void {
    const d = this.out(pan);
    if (!d) return;
    this.tone(d, { type: 'square', f0: on ? 660 : 520, f1: on ? 660 : 520, gain: 0.04, length: 0.07 });
    this.tone(d, { type: 'square', f0: on ? 990 : 390, f1: on ? 990 : 390, gain: 0.04, length: 0.09, delay: 0.07 });
  }

  move(pan: number): void {
    const d = this.out(pan);
    if (!d) return;
    for (let i = 0; i < 3; i++) this.tone(d, { type: 'triangle', f0: 120, f1: 80, gain: 0.12, length: 0.12, delay: i * 0.11 });
  }

  denied(): void {
    const d = this.out(0);
    if (!d) return;
    this.tone(d, { type: 'square', f0: 180, f1: 140, gain: 0.05, length: 0.18 });
  }

  /** A short bell at the start of each round. */
  roundStart(): void {
    const d = this.out(0);
    if (!d) return;
    this.tone(d, { type: 'sine', f0: 880, f1: 880, gain: 0.09, length: 0.9 });
    this.tone(d, { type: 'sine', f0: 1320, f1: 1320, gain: 0.04, length: 0.6 });
  }

  fanfare(win: boolean): void {
    const d = this.out(0);
    if (!d) return;
    const notes = win ? [523, 659, 784, 1046] : [392, 370, 330, 262];
    notes.forEach((f, i) =>
      this.tone(d, { type: 'triangle', f0: f, f1: f, gain: 0.18, attack: 0.02, length: i === 3 ? 1.2 : 0.35, delay: i * 0.18 }),
    );
  }

  /** Soft wind and distant waterfalls, always on under everything else. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.connect(this.master!);
    const wind = this.noiseSource();
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 380;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(wf.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.22;
    wind.connect(wf).connect(wg).connect(g);
    const water = this.noiseSource();
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 1400;
    bf.Q.value = 0.5;
    const bg = ctx.createGain();
    bg.gain.value = 0.05;
    water.connect(bf).connect(bg).connect(g);
    wind.start();
    water.start(0, 0.7);
    lfo.start();
    g.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5);
  }
}
