// Looping sea ambience (sealoop from the Godot game). Web Audio rather than an <audio> element,
// because only a buffer source loops without a gap. Browsers only allow audio after a user
// gesture, so it starts on the first key press, click or tap — and is resumed on later gestures
// if the browser suspended it again (iOS does after calls or app switches).

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
  muted = false;

  private ctx?: AudioContext;
  private gain?: GainNode;
  private starting = false;

  constructor(private readonly urls: { ogg: string; m4a: string }) {
    const gesture = () => {
      if (!this.ctx) void this.start();
      else if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
    };
    window.addEventListener('keydown', gesture);
    window.addEventListener('pointerdown', gesture);
    // No sound (and no battery use) while the tab is in the background.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  toggleMute(): void {
    this.muted = !this.muted;
  }

  update(seaState: number, cameraHeight: number): void {
    if (!this.ctx || !this.gain) return;
    this.gain.gain.setTargetAtTime(seaGain(seaState, cameraHeight, this.volume, this.muted), this.ctx.currentTime, FADE);
  }

  private async start(): Promise<void> {
    if (this.ctx || this.starting) return;
    this.starting = true;
    try {
      // Created synchronously inside the gesture, which is what lets it play.
      const ctx = new AudioContext();
      // Safari (especially iOS) may not decode Ogg Vorbis: use the AAC copy there.
      const ogg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
      const data = await fetch(ogg ? this.urls.ogg : this.urls.m4a).then((r) => r.arrayBuffer());
      const buffer = await ctx.decodeAudioData(data);
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
    } finally {
      this.starting = false;
    }
  }
}
