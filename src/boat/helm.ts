// The helm (steering wheel) position, shared by keyboard and touch steering.
// -1 = hard to port, 0 = centred, 1 = hard to starboard. The rudder follows it directly.

/** Wheel rotation at full lock, in radians (¾ turn each way). */
export const WHEEL_LOCK = Math.PI * 1.5;

const KEY_RATE = 2.2; // helm travel per second while a steering key is held
const RETURN_RATE = 1.6; // travel per second back to centre once let go

export class Helm {
  position = 0;

  /**
   * @param keys -1 / 0 / 1 from the keyboard
   * @param touch absolute helm position while a finger holds the wheel, otherwise null
   */
  update(dt: number, keys: number, touch: number | null): void {
    if (touch !== null) {
      this.position = clamp(touch);
    } else if (keys !== 0) {
      this.position = clamp(this.position + keys * KEY_RATE * dt);
    } else {
      // Let go: the wheel eases back to centre.
      const step = RETURN_RATE * dt;
      this.position = Math.abs(this.position) <= step ? 0 : this.position - Math.sign(this.position) * step;
    }
  }

  /** Wheel rotation as seen by the helmsman: positive = clockwise (turning to starboard). */
  get wheelAngle(): number {
    return this.position * WHEEL_LOCK;
  }
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
