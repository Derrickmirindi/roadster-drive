/**
 * Synthesised audio (Web Audio API). No sound files are used, so there is
 * nothing to license. The AudioContext is only created after a user gesture.
 */

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private tyreGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.5;
  private muted = false;
  private enabled = true;
  private running = false;

  get isStarted(): boolean {
    return this.ctx !== null;
  }

  configure(enabled: boolean, volume: number, muted: boolean): void {
    this.enabled = enabled;
    this.volume = volume;
    this.muted = muted;
    this.applyMaster();
  }

  /** Must be called from a user gesture (click / key press / touch). */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 700;
    this.filter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter.connect(this.engineGain).connect(this.master);

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.osc1.start();
    this.osc2.start();

    // Looping white noise for tyre squeal / scrub.
    const len = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500;
    band.Q.value = 3;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    noise.connect(band).connect(this.tyreGain).connect(this.master);
    noise.start();
    this.running = true;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (!this.master || !this.ctx) return;
    const v = !this.enabled || this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.05);
  }

  /** Engine and tyre sound from the simulated state. */
  update(speed: number, throttle: number, slip: number, active: boolean): void {
    if (!this.ctx || !this.running || !this.osc1 || !this.osc2) return;
    const t = this.ctx.currentTime;
    // Virtual 6-speed gearbox for pitch only.
    const gearTop = [0, 12, 22, 32, 44, 58, 80];
    let gear = 1;
    while (gear < 6 && speed > gearTop[gear]) gear++;
    const lo = gearTop[gear - 1];
    const hi = gearTop[gear];
    const rpm = 0.18 + 0.82 * Math.min(1, Math.max(0, (speed - lo) / (hi - lo)));
    const base = 38 + rpm * 110;
    this.osc1.frequency.setTargetAtTime(base, t, 0.04);
    this.osc2.frequency.setTargetAtTime(base * 2.01, t, 0.04);
    this.filter!.frequency.setTargetAtTime(500 + rpm * 1400 + throttle * 600, t, 0.05);
    const engine = active ? 0.12 + throttle * 0.22 + rpm * 0.08 : 0;
    this.engineGain!.gain.setTargetAtTime(engine, t, 0.08);
    const squeal = active ? Math.min(0.25, Math.max(0, slip - 1.2) * 0.06) : 0;
    this.tyreGain!.gain.setTargetAtTime(squeal, t, 0.06);
  }

  impact(strength: number): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.muted || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.8, strength * 0.12), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    src.connect(lp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + 0.4);
  }

  /** Silence while paused/hidden without tearing down the graph. */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && this.enabled) void this.ctx.resume();
  }
}
