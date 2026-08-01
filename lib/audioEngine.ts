// ——————————————————————————————————————————————
// Audio engine for UltraTouch.
// Every sound carries real information — this is the accessibility backbone.
// Users who can't see the screen clearly should still know exactly what
// happened from sound alone.
// ——————————————————————————————————————————————

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private muted = false;
  private initialized = false;

  /**
   * Must be called after a user gesture (click/keypress) to satisfy
   * browser autoplay policies.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.ctx.destination);

    // Ambient sonification oscillator — very quiet, always running
    this.ambientOsc = this.ctx.createOscillator();
    this.ambientOsc.type = "sine";
    this.ambientOsc.frequency.value = 220;
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.02;
    this.ambientOsc.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    this.ambientOsc.start();

    this.initialized = true;
  }

  /** Short high blip — something is under focus */
  playHover(): void {
    this.playTone({ freq: 800, duration: 0.05, type: "sine", volume: 0.15 });
  }

  /** Rising two-tone — an item has been selected */
  playSelect(): void {
    this.playTone({ freq: 400, endFreq: 800, duration: 0.15, type: "sine", volume: 0.25 });
  }

  /** Warm chord — action confirmed successfully */
  playConfirm(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 0.3;
    for (const f of [400, 500, 600]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + dur);
    }
  }

  /** Dissonant buzz — something went wrong */
  playError(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 0.2;
    for (const f of [200, 250]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + dur);
    }
  }

  /** Descending tone — cancel/back */
  playCancel(): void {
    this.playTone({ freq: 600, endFreq: 300, duration: 0.15, type: "sine", volume: 0.2 });
  }

  /** Quick ascending ping — device toggled on */
  playToggleOn(): void {
    this.playTone({ freq: 500, endFreq: 900, duration: 0.1, type: "triangle", volume: 0.25 });
  }

  /** Quick descending ping — device toggled off */
  playToggleOff(): void {
    this.playTone({ freq: 700, endFreq: 350, duration: 0.1, type: "triangle", volume: 0.25 });
  }

  /** Subtle navigation tick — moving between items */
  playNavigate(): void {
    this.playTone({ freq: 1200, duration: 0.03, type: "sine", volume: 0.08 });
  }

  /**
   * Set the ambient sonification value (0–1).
   * Maps linearly to pitch (180–600 Hz) and subtly to volume.
   * A rising metric raises the pitch so the user hears the trend.
   */
  setAmbientValue(normalized: number): void {
    if (!this.ambientOsc || !this.ambientGain || !this.ctx) return;
    const clamped = Math.max(0, Math.min(1, normalized));
    const freq = 180 + clamped * 420; // 180 Hz → 600 Hz
    const vol = 0.01 + clamped * 0.03; // very subtle
    const now = this.ctx.currentTime;
    this.ambientOsc.frequency.exponentialRampToValueAtTime(
      Math.max(freq, 1),
      now + 0.5,
    );
    this.ambientGain.gain.linearRampToValueAtTime(
      this.muted ? 0 : vol,
      now + 0.5,
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.linearRampToValueAtTime(
        muted ? 0 : 0.3,
        now + 0.1,
      );
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    this.ambientOsc?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.ambientOsc = null;
    this.ambientGain = null;
    this.initialized = false;
  }

  // ——— Internal helpers ———

  private playTone(opts: {
    freq: number;
    endFreq?: number;
    duration: number;
    type: OscillatorType;
    volume: number;
  }): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.endFreq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(opts.endFreq, 1),
        now + opts.duration,
      );
    }
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + opts.duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + opts.duration + 0.05);
  }
}
