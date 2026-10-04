/** Small frame-rate readout: frames per second and average frame time, refreshed twice a second. */
export class FpsCounter {
  private readonly el = document.createElement('div');
  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  fps = 0;
  /** average frame time in ms over the last interval */
  frameMs = 0;

  constructor(parent: HTMLElement) {
    this.el.className = 'fps';
    parent.appendChild(this.el);
  }

  /**
   * @param dt real time since the previous frame, in seconds (unclamped)
   * @param pixelRatio current render resolution, shown so adaptive resolution is visible
   */
  frame(dt: number, pixelRatio?: number): void {
    this.frames++;
    this.elapsed += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.elapsed < 0.5) return;
    this.fps = this.frames / this.elapsed;
    this.frameMs = (this.elapsed / this.frames) * 1000;
    const res = pixelRatio === undefined ? '' : ` · ${pixelRatio}×`;
    this.el.textContent = `${Math.round(this.fps)} fps · ${this.frameMs.toFixed(1)} ms · worst ${(this.worst * 1000).toFixed(0)} ms${res}`;
    this.el.classList.toggle('fps-low', this.fps < 45);
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
  }
}
