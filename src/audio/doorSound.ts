// The companionway door: one recording with the door opening at the start and closing at the end.
// Each click plays its half; the close is delayed so the slam lands when the door shuts (~0.6 s).

import { loadBuffer, whenAudioReady } from './audioHub';

/** Parts of door.mp3, in seconds. */
const OPEN = { from: 0.1, to: 1.95 };
const CLOSE = { from: 2.05, to: Infinity, slamAt: 0.2 };
const DOOR_SWING = 0.6; // seconds, matches the door animation in BoatModel
const GAIN = 0.8;

export class DoorSound {
  /** 0…2 from the tuning panel. */
  volume = 1;

  private ctx?: AudioContext;
  private buffer?: AudioBuffer;
  private playing?: AudioBufferSourceNode;

  constructor(url: string) {
    whenAudioReady(async (ctx) => {
      try {
        this.buffer = await loadBuffer(ctx, url);
        this.ctx = ctx;
      } catch (err) {
        console.warn('door sound unavailable', err);
      }
    });
  }

  play(opening: boolean, muted: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || muted) return;
    this.playing?.stop(); // clicked again before it finished
    const part = opening ? OPEN : CLOSE;
    const end = Math.min(part.to, this.buffer.duration);
    const gain = ctx.createGain();
    gain.gain.value = GAIN * this.volume;
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(gain);
    const delay = opening ? 0 : Math.max(0, DOOR_SWING - CLOSE.slamAt);
    source.start(ctx.currentTime + delay, part.from, end - part.from);
    source.onended = () => {
      gain.disconnect();
      if (this.playing === source) this.playing = undefined;
    };
    this.playing = source;
  }
}
