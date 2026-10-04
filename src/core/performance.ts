// Keeps the frame rate steady without burning more battery than needed:
// a frame-rate cap (phones often refresh at 120 Hz) and adaptive resolution.

export interface PerformanceSettings {
  /** frames per second to render at most; 0 = every display refresh */
  fpsCap: number;
  /** upper limit for the canvas pixel ratio */
  maxPixelRatio: number;
  /** lower the pixel ratio when the frame rate drops, raise it again when there is headroom */
  adaptive: boolean;
}

const MIN_PIXEL_RATIO = 1;
const STEP = 0.25;
const LOW_FPS = 45;
const CHECK_INTERVAL = 2; // seconds per measurement window
const RAISE_AFTER = 5; // good windows in a row before trying a higher resolution

export class PerformanceGovernor {
  pixelRatio: number;
  private lastFrameTime = -Infinity;
  private windowFrames = 0;
  private windowTime = 0;
  private goodWindows = 0;

  constructor(
    readonly settings: PerformanceSettings,
    private readonly applyPixelRatio: (ratio: number) => void,
  ) {
    this.pixelRatio = settings.maxPixelRatio;
    applyPixelRatio(this.pixelRatio);
  }

  /** Whether to render this display refresh at all (timestamp in ms). */
  shouldRender(timestamp: number): boolean {
    const cap = this.settings.fpsCap;
    if (cap <= 0) return true;
    // A little slack so a 60 Hz display doesn't drop frames to timer jitter.
    if (timestamp - this.lastFrameTime < 1000 / cap - 2) return false;
    this.lastFrameTime = timestamp;
    return true;
  }

  /** Call once per rendered frame with the real frame time in seconds. */
  frame(dt: number): void {
    // A long gap is a pause (tab switched, app in background), not a slow frame: start over.
    if (dt > 0.25) {
      this.windowFrames = 0;
      this.windowTime = 0;
      return;
    }
    this.windowFrames++;
    this.windowTime += dt;
    if (this.windowTime < CHECK_INTERVAL) return;
    const fps = this.windowFrames / this.windowTime;
    this.windowFrames = 0;
    this.windowTime = 0;

    const max = this.settings.maxPixelRatio;
    if (this.pixelRatio > max) return this.set(max);
    if (!this.settings.adaptive) {
      if (this.pixelRatio !== max) this.set(max);
      return;
    }
    // Aim for the cap (or 60 when uncapped); "low" means clearly below what we asked for.
    const target = this.settings.fpsCap > 0 ? Math.min(this.settings.fpsCap, 60) : 60;
    if (fps < Math.min(LOW_FPS, target * 0.8)) {
      this.goodWindows = 0;
      if (this.pixelRatio > MIN_PIXEL_RATIO) this.set(Math.max(MIN_PIXEL_RATIO, this.pixelRatio - STEP));
    } else if (fps > target * 0.95 && this.pixelRatio < max) {
      if (++this.goodWindows >= RAISE_AFTER) {
        this.goodWindows = 0;
        this.set(Math.min(max, this.pixelRatio + STEP));
      }
    } else {
      this.goodWindows = 0;
    }
  }

  private set(ratio: number): void {
    if (ratio === this.pixelRatio) return;
    this.pixelRatio = ratio;
    this.applyPixelRatio(ratio);
  }
}
