import alea from 'alea';
import { createNoise2D } from 'simplex-noise';

/** Randomly generated wind that drifts slowly over time. No weather API. */
export class Wind {
  /** Compass degrees the wind blows FROM. */
  direction: number;
  /** m/s */
  speed: number;
  /** Set from the debug GUI to pin the wind. */
  locked = false;

  private readonly baseDirection: number;
  private readonly baseSpeed: number;
  private readonly noise: (x: number, y: number) => number;

  constructor(seed: string | number = Date.now()) {
    const rng = alea(seed);
    this.noise = createNoise2D(rng);
    this.baseDirection = rng() * 360;
    this.baseSpeed = 5 + rng() * 7;
    this.direction = this.baseDirection;
    this.speed = this.baseSpeed;
  }

  update(time: number): void {
    if (this.locked) return;
    // Direction wanders ±40° over a few minutes, gusts change speed every few seconds.
    const dir = this.baseDirection + this.noise(time / 240, 0) * 40;
    this.direction = ((dir % 360) + 360) % 360;
    const gust = this.noise(time / 8, 100) * 0.15 + this.noise(time / 120, 200) * 0.3;
    this.speed = Math.max(1, this.baseSpeed * (1 + gust));
  }
}
