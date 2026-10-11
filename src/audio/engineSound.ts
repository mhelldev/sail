// The engine's sounds: the ignition when the key is turned, and the running engine (a seamless loop)
// from the moment START is pressed. The engine gets louder and a little higher with the throttle, and
// quieter the further the listener is from the boat.

import { ENGINE, type Engine } from '../boat/engine';
import { loadBuffer, seamlessLoop, whenAudioReady } from './audioHub';

const IGNITION_GAIN = 0.5;
const IDLE_GAIN = 0.45; // the recording is quiet (about -35 dB RMS)
const FULL_GAIN = 1.6;
const FADE = 0.15; // seconds, time constant for volume and pitch changes

/**
 * Engine loudness: idle → full with the throttle, falling off with distance (1 at the helm).
 * @param throttle 0 … 1 (either direction)
 */
export function engineGain(throttle: number, distance: number, volume: number, muted: boolean): number {
  if (muted) return 0;
  const near = 1 / (1 + Math.max(0, distance - 3) / 12);
  return (IDLE_GAIN + (FULL_GAIN - IDLE_GAIN) * Math.min(1, Math.abs(throttle))) * near * volume;
}

export class EngineSound {
  /** 0…2 from the tuning panel. */
  volume = 1;

  private ctx?: AudioContext;
  private ignitionBuffer?: AudioBuffer;
  private engineBuffer?: AudioBuffer;
  private ignition?: { source: AudioBufferSourceNode; gain: GainNode };
  private loop?: { source: AudioBufferSourceNode; gain: GainNode };
  private wasIgnition = false;
  private wasCranking = false;

  constructor(urls: { ignition: string; engine: string }) {
    whenAudioReady(async (ctx) => {
      try {
        const [ignition, engine] = await Promise.all([loadBuffer(ctx, urls.ignition), loadBuffer(ctx, urls.engine)]);
        this.ignitionBuffer = ignition;
        this.engineBuffer = seamlessLoop(ctx, engine);
        this.ctx = ctx;
      } catch (err) {
        console.warn('engine sounds unavailable', err);
      }
    });
  }

  /**
   * @param distance from the listener to the boat, metres
   */
  update(engine: Engine, distance: number, muted: boolean): void {
    const keyTurnedOn = engine.ignition && !this.wasIgnition;
    const startPressed = engine.cranking > 0 && !this.wasCranking;
    this.wasIgnition = engine.ignition;
    this.wasCranking = engine.cranking > 0;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const near = 1 / (1 + Math.max(0, distance - 3) / 12);

    if (keyTurnedOn) this.playIgnition(ctx, muted ? 0 : IGNITION_GAIN * near * this.volume);
    // START: the ignition sound gives way to the engine.
    if (startPressed && this.ignition) this.fadeOut(this.ignition, 0.3);
    if (!engine.ignition && this.ignition) this.fadeOut(this.ignition, 0.1);

    const sounding = engine.running || engine.cranking > 0;
    if (sounding && !this.loop) this.startLoop(ctx);
    if (!sounding && this.loop) this.fadeOut(this.loop, 0.25);
    if (this.loop) {
      const throttle = Math.abs(engine.thrust);
      this.loop.gain.gain.setTargetAtTime(engineGain(throttle, distance, this.volume, muted), now, FADE);
      // A little higher with the revs; slower while cranking.
      const rate = engine.running ? 0.95 + 0.35 * ((engine.rpm - ENGINE.idleRpm) / (ENGINE.maxRpm - ENGINE.idleRpm)) : 0.8;
      this.loop.source.playbackRate.setTargetAtTime(Math.max(0.7, rate), now, FADE * 2);
    }
  }

  private playIgnition(ctx: AudioContext, gainValue: number): void {
    if (!this.ignitionBuffer) return;
    if (this.ignition) this.fadeOut(this.ignition, 0.05);
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = this.ignitionBuffer;
    source.connect(gain);
    source.start();
    const voice = { source, gain };
    this.ignition = voice;
    source.onended = () => {
      if (this.ignition === voice) this.ignition = undefined;
      gain.disconnect();
    };
  }

  private startLoop(ctx: AudioContext): void {
    if (!this.engineBuffer) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = this.engineBuffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.loop = { source, gain };
  }

  /** Fades a voice out and stops it; it is forgotten right away so a new one can start. */
  private fadeOut(voice: { source: AudioBufferSourceNode; gain: GainNode }, seconds: number): void {
    const ctx = this.ctx!;
    voice.gain.gain.setTargetAtTime(0, ctx.currentTime, seconds / 3);
    voice.source.stop(ctx.currentTime + seconds * 1.5);
    voice.source.onended = () => voice.gain.disconnect();
    if (this.ignition === voice) this.ignition = undefined;
    if (this.loop === voice) this.loop = undefined;
  }
}
