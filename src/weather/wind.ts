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
  /** 0 … 1 from the weather: how often and how hard gusts come */
  gustiness = 0.2;
  /** multiplier from the weather (squalls, storms) */
  weatherFactor = 1;
  /** 0 … 1 the current gust (for sounds and the instruments) */
  gust = 0;
  private gustAt = -Infinity;
  private gustLength = 1;
  private gustPeak = 0;
  private lastTime = 0;

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
    const dt = Math.min(0.5, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    // Gusts: a squall rises over a couple of seconds, holds and dies away; more and harder in bad weather.
    if (time - this.gustAt > this.gustLength && Math.random() < dt * (0.01 + 0.08 * this.gustiness)) {
      this.gustAt = time;
      this.gustLength = 4 + Math.random() * 9;
      this.gustPeak = 0.2 + 0.5 * this.gustiness * (0.5 + Math.random() * 0.5);
    }
    const k = (time - this.gustAt) / this.gustLength;
    this.gust = k >= 0 && k <= 1 ? Math.sin(Math.PI * k) ** 0.6 : 0;
    if (this.locked) return;
    // Direction wanders ±40° over a few minutes, speed changes every few seconds.
    const dir = this.baseDirection + this.noise(time / 240, 0) * 40;
    this.direction = ((dir % 360) + 360) % 360;
    const drift = this.noise(time / 8, 100) * 0.15 + this.noise(time / 120, 200) * 0.3;
    this.speed = Math.max(1, this.baseSpeed * (1 + drift) * this.weatherFactor * (1 + this.gust * this.gustPeak));
  }
}
