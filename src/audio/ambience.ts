// Sounds of a boat at sea, all synthesized (no recordings needed): sails flapping when they luff, rain, halyards clinking against the masts in a harbour, and gulls calling.
// Shares the audio context with the other sounds and is muted with them.

import { whenAudioReady } from './audioHub';

export interface AmbienceInput {
  windSpeed: number;
  /** listener's distance to the boat, metres (sail flapping is heard from there) */
  boatDistance: number;
  /** listener is inside the cabin (wind and flapping are muffled) */
  inside: boolean;
  /** 0 … 1 how much the sails flap */
  luff: number;
  /** distance to the nearest harbour with moored boats, metres */
  harbourDistance: number;
  /** 0 … 1 rain */
  rain: number;
  muted: boolean;
}

export class Ambience {
  /** 0…2 from the tuning panel */
  volume = 1;

  private ctx?: AudioContext;
  private out?: GainNode;
  private noise?: AudioBuffer;
  private flapping?: { gain: GainNode };
  private rainHiss?: GainNode;
  private nextPatter = 0;
  private nextClink = 0;
  private nextFlap = 0;

  constructor() {
    whenAudioReady((ctx) => {
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.connect(ctx.destination);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
      this.flapping = { gain: ctx.createGain() };
      this.flapping.gain.connect(this.out);
      this.rainHiss = this.startRain(ctx, this.out, buffer);
    });
  }

  update(a: AmbienceInput): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const now = ctx.currentTime;
    this.out.gain.setTargetAtTime(a.muted ? 0 : this.volume, now, 0.2);

    const near = 1 / (1 + Math.max(0, a.boatDistance - 6) / 25);

    // Sails flapping: a rapid series of dull slaps while they luff (more in more wind).
    const flapLevel = a.luff * Math.min(1, a.windSpeed / 10) * near * (a.inside ? 0.35 : 1);
    if (flapLevel > 0.05 && now >= this.nextFlap) {
      this.nextFlap = now + 0.11 + Math.random() * 0.12;
      this.burst(ctx, 0.05 + Math.random() * 0.05, 0.22 * flapLevel, 'lowpass', 500 + Math.random() * 400, (Math.random() - 0.5) * 0.4);
    }

    // Rain: a hiss on the water all around; inside, drops drum on the cabin roof.
    if (this.rainHiss) this.rainHiss.gain.setTargetAtTime(a.rain * (a.inside ? 0.025 : 0.07), now, 0.5);
    if (a.rain > 0.05 && now >= this.nextPatter) {
      this.nextPatter = now + (a.inside ? 0.02 : 0.05) + Math.random() * (0.1 / (0.2 + a.rain));
      const level = (a.inside ? 0.045 : 0.0125) * a.rain * (0.3 + Math.random() * 0.7);
      this.burst(ctx, 0.012 + Math.random() * 0.02, level, a.inside ? 'lowpass' : 'highpass', a.inside ? 900 + Math.random() * 600 : 3500, (Math.random() - 0.5) * 1.6);
    }

    // Halyards slapping against the masts of the moored boats.
    const harbour = Math.max(0, 1 - a.harbourDistance / 350) * Math.min(1, a.windSpeed / 6);
    if (harbour > 0.05 && now >= this.nextClink) {
      this.nextClink = now + (0.4 + Math.random() * 2.5) / (0.4 + harbour);
      this.clink(ctx, 0.05 * harbour * (0.4 + Math.random() * 0.6), (Math.random() - 0.5) * 1.6);
    }
  }

  /** The till in the supermarket: the drawer clunks open, then a bright "ka-ching". */
  till(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime + 0.02;
    this.noiseAt(t, 0.06, 0.12, 'lowpass', 900, 1);
    this.noiseAt(t + 0.08, 0.04, 0.1, 'bandpass', 2500, 2);
    for (const [ratio, amp] of [[1, 1], [2.76, 0.45], [5.4, 0.2]]) {
      this.toneAt(t + 0.1, 2100 * ratio, 2100 * ratio, 0.7, 0.05 * amp, 'sine');
      this.toneAt(t + 0.22, 2650 * ratio, 2650 * ratio, 0.9, 0.05 * amp, 'sine');
    }
  }

  /** Biting and chewing: a crisp bite, then a few dull crunches. */
  eat(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    let t = ctx.currentTime + 0.02;
    this.noiseAt(t, 0.07, 0.14, 'bandpass', 3200, 1.2);
    t += 0.25;
    for (let i = 0; i < 5; i++) {
      this.noiseAt(t, 0.05 + Math.random() * 0.04, 0.06 + Math.random() * 0.04, 'bandpass', 1200 + Math.random() * 1400, 1.5);
      t += 0.22 + Math.random() * 0.12;
    }
  }

  /** Drinking: three gulps (a falling, throaty "glk"). */
  drink(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      this.toneAt(t, 520 - i * 30, 180, 0.12, 0.12, 'sine');
      this.noiseAt(t + 0.02, 0.05, 0.03, 'lowpass', 700, 1);
      t += 0.42 + Math.random() * 0.08;
    }
    this.noiseAt(t, 0.12, 0.04, 'lowpass', 500, 1); // "ahh"
  }

  /**
   * A gull's call — a few falling "kyow"s.
   * @param pan -1 left … 1 right
   * @param level 0 … 1 (distance already applied)
   */
  gullCall(pan: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || level <= 0.01) return;
    const calls = 1 + Math.floor(Math.random() * 4);
    const pitch = 0.85 + Math.random() * 0.3;
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < calls; i++) {
      const length = 0.18 + Math.random() * 0.12;
      this.kyow(ctx, t, length, pitch * (1 - i * 0.03), pan, level * 0.16);
      t += length + 0.06 + Math.random() * 0.12;
    }
  }

  private kyow(ctx: AudioContext, t: number, length: number, pitch: number, pan: number, level: number): void {
    // A bright, nasal tone gliding up and down, shaped by a formant filter.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f = 1050 * pitch;
    osc.frequency.setValueAtTime(f * 0.8, t);
    osc.frequency.linearRampToValueAtTime(f * 1.35, t + length * 0.25);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + length);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 2300 * pitch;
    formant.Q.value = 2.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.03);
    gain.gain.setValueAtTime(level, t + length * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(formant).connect(gain).connect(panner).connect(this.out!);
    osc.start(t);
    osc.stop(t + length + 0.02);
    osc.onended = () => panner.disconnect();
  }

  /** A metallic "tink": a few inharmonic partials with a quick decay. */
  private clink(ctx: AudioContext, level: number, pan: number): void {
    const t = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.out!);
    const base = 1800 + Math.random() * 900;
    for (const [ratio, amp] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = base * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level * amp, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 / ratio + 0.05);
      osc.connect(gain).connect(panner);
      osc.start(t);
      osc.stop(t + 0.5);
    }
    window.setTimeout(() => panner.disconnect(), 700);
  }

  /** Filtered noise starting at `t` (seconds, context time). */
  private noiseAt(t: number, seconds: number, level: number, type: BiquadFilterType, freq: number, q: number): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise!;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.connect(filter).connect(gain).connect(this.out!);
    source.start(t, Math.random() * 2, seconds + 0.02);
    source.onended = () => gain.disconnect();
  }

  /** A tone gliding from `f0` to `f1` Hz, starting at `t`. */
  private toneAt(t: number, f0: number, f1: number, seconds: number, level: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(gain).connect(this.out!);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    osc.onended = () => gain.disconnect();
  }

  /** A filtered burst of noise (sail slaps). */
  private burst(ctx: AudioContext, seconds: number, level: number, type: BiquadFilterType, freq: number, pan: number): void {
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise!;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(filter).connect(gain).connect(panner).connect(this.flapping!.gain);
    this.flapping!.gain.gain.value = 1;
    source.start(t, Math.random() * 2, seconds + 0.02);
    source.onended = () => panner.disconnect();
  }

  private startRain(ctx: AudioContext, out: AudioNode, noise: AudioBuffer): GainNode {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    source.connect(hp).connect(lp).connect(gain);
    source.start();
    return gain;
  }

}
