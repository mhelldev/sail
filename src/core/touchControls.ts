// Touch input on the 3D view:
//   one finger  → grab the helm and drag sideways to turn it
//   two fingers → drag to orbit / look around, pinch to zoom
// Mouse and pen are left to the camera rig.

export interface CameraGestures {
  orbit(dxPx: number, dyPx: number): void;
  zoom(factor: number): void;
}

interface Pt {
  x: number;
  y: number;
}

export class TouchControls {
  /** Helm position requested by the finger, or null while nobody is steering. */
  steer: number | null = null;

  private readonly touches = new Map<number, Pt>();
  private steerStartX = 0;
  private steerStartHelm = 0;
  private steerId: number | null = null;
  private lastPair?: { mid: Pt; dist: number };

  /**
   * @param getHelm current helm position, so a new grab continues from where the wheel is
   */
  constructor(
    target: EventTarget,
    private readonly getHelm: () => number,
    private readonly camera: CameraGestures,
    private readonly fullLockPx = () => Math.min(window.innerWidth * 0.35, 180),
  ) {
    const opts = { passive: false } as AddEventListenerOptions;
    target.addEventListener('pointerdown', (e) => this.down(e as PointerEvent), opts);
    target.addEventListener('pointermove', (e) => this.move(e as PointerEvent), opts);
    target.addEventListener('pointerup', (e) => this.up(e as PointerEvent), opts);
    target.addEventListener('pointercancel', (e) => this.up(e as PointerEvent), opts);
  }

  private down(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    e.preventDefault?.();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 1) {
      this.steerId = e.pointerId;
      this.steerStartX = e.clientX;
      this.steerStartHelm = this.getHelm();
      this.steer = this.steerStartHelm;
    } else {
      // A second finger switches from steering to camera control.
      this.steerId = null;
      this.steer = null;
      this.lastPair = this.pair();
    }
  }

  private move(e: PointerEvent): void {
    if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
    e.preventDefault?.();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.steerId === e.pointerId) {
      const delta = (e.clientX - this.steerStartX) / this.fullLockPx();
      this.steer = Math.max(-1, Math.min(1, this.steerStartHelm + delta));
      return;
    }
    if (this.touches.size >= 2 && this.lastPair) {
      const now = this.pair()!;
      this.camera.orbit(now.mid.x - this.lastPair.mid.x, now.mid.y - this.lastPair.mid.y);
      if (this.lastPair.dist > 0 && now.dist > 0) this.camera.zoom(this.lastPair.dist / now.dist);
      this.lastPair = now;
    }
  }

  private up(e: PointerEvent): void {
    if (!this.touches.delete(e.pointerId)) return;
    if (e.pointerId === this.steerId) {
      this.steerId = null;
      this.steer = null; // the helm eases back to centre on its own
    }
    this.lastPair = this.touches.size >= 2 ? this.pair() : undefined;
  }

  private pair(): { mid: Pt; dist: number } | undefined {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return undefined;
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
}
