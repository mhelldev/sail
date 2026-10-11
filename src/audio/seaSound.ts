// Looping sea ambience (sealoop from the Godot game). Web Audio rather than an <audio> element,
// because only a buffer source loops without a gap. Starts once audio is allowed (see audioHub).

import { loadBuffer, whenAudioReady } from './audioHub';

const BASE_GAIN = 0.12; // about -18 dB
const FADE = 0.6; // seconds, time constant for volume changes

/**
 * Loudness of the sea.
 * @param seaState 0 (calm) … 1 (rough): louder in more wind
 * @param cameraHeight metres above the water: the sea gets quieter from up high
 */
export function seaGain(seaState: number, cameraHeight: number, volume: number, muted: boolean): number {
  if (muted) return 0;
  const distance = 1 / (1 + Math.max(0, cameraHeight - 30) / 150);
  return BASE_GAIN * volume * (0.55 + 0.45 * Math.min(1, Math.max(0, seaState))) * distance;
}

export class SeaSound {
  /** 0…2 from the tuning panel. */
  volume = 1;
  /** mutes all game sounds (V) */
  muted = false;

  private ctx?: AudioContext;
  private gain?: GainNode;

  constructor(urls: { ogg: string; m4a: string }) {
    whenAudioReady(async (ctx) => {
      try {
        // Safari (especially iOS) may not decode Ogg Vorbis: use the AAC copy there.
        const ogg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
        const buffer = await loadBuffer(ctx, ogg ? urls.ogg : urls.m4a);
        const gain = ctx.createGain();
        gain.gain.value = 0; // fades in through update()
        gain.connect(ctx.destination);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain);
        source.start();
        this.ctx = ctx;
        this.gain = gain;
      } catch (err) {
        console.warn('sea sound unavailable', err);
      }
    });
  }

  toggleMute(): void {
    this.muted = !this.muted;
  }

  update(seaState: number, cameraHeight: number): void {
    if (!this.ctx || !this.gain) return;
    this.gain.gain.setTargetAtTime(seaGain(seaState, cameraHeight, this.volume, this.muted), this.ctx.currentTime, FADE);
  }
}
