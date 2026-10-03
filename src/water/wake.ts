import * as THREE from 'three';

export const WAKE_POINTS = 48;
const SPACING = 4; // metres travelled between trail points → ~190 m of wake

/**
 * Recent stern positions, handed to the water shader to draw the wake.
 * Each point stores (x, z, odometer at that point, boat speed at that point).
 */
export class WakeTrail {
  readonly points = Array.from({ length: WAKE_POINTS }, () => new THREE.Vector4());
  count = 0;
  /** total distance travelled, in metres */
  odometer = 0;
  private lastX = NaN;
  private lastZ = NaN;

  update(sternX: number, sternZ: number, speed: number): void {
    if (Number.isNaN(this.lastX)) {
      this.reset(sternX, sternZ, speed);
      return;
    }
    const step = Math.hypot(sternX - this.lastX, sternZ - this.lastZ);
    // A jump (reset to start, restored position) breaks the trail instead of drawing a long line.
    if (step > 50) {
      this.reset(sternX, sternZ, speed);
      return;
    }
    this.odometer += step;
    this.lastX = sternX;
    this.lastZ = sternZ;

    // Point 0 always follows the stern; a new point is laid down every SPACING metres.
    const head = this.points[0];
    if (this.count > 1 && this.odometer - this.points[1].z >= SPACING) {
      for (let i = Math.min(this.count, WAKE_POINTS - 1); i > 0; i--) this.points[i].copy(this.points[i - 1]);
      this.count = Math.min(this.count + 1, WAKE_POINTS);
    }
    head.set(sternX, sternZ, this.odometer, speed);
    if (this.count === 1) {
      this.points[1].copy(head);
      this.count = 2;
    }
  }

  private reset(x: number, z: number, speed: number): void {
    this.lastX = x;
    this.lastZ = z;
    this.points[0].set(x, z, this.odometer, speed);
    this.count = 1;
  }
}
