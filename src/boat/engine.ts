// The auxiliary diesel, like on most cruising yachts: turn the key to ON (oil and battery lights
// come on), press START (it cranks for a moment, then runs), key to OFF stops it. A single lever sets
// gear and throttle: forward = ahead, upright = neutral, back = astern. It only starts in neutral,
// burns fuel while running (more with more throttle) and dies when the tank runs dry. Pure.

/** Litres. */
export const FUEL_CAPACITY = 60;

export const ENGINE = {
  crankTime: 1.2, // s of cranking before it catches
  idleRpm: 850,
  maxRpm: 3000,
  /** litres per second at idle and at full throttle: game time, a full tank lasts ~20 min flat out */
  idleBurn: 0.006,
  fullBurn: 0.05,
  /** lever travel around upright that is still neutral */
  neutral: 0.1,
};

export class Engine {
  ignition = false;
  running = false;
  /** seconds left cranking (0 = not cranking) */
  cranking = 0;
  fuel = FUEL_CAPACITY;
  /** lever: -1 full astern … 0 neutral … 1 full ahead */
  lever = 0;
  rpm = 0;

  /** The lever is in its neutral detent. */
  get inNeutral(): boolean {
    return Math.abs(this.lever) < ENGINE.neutral;
  }

  /** Throttle with the gear engaged, -1 … 1 (0 in neutral or with the engine off). */
  get thrust(): number {
    if (!this.running || this.inNeutral) return 0;
    const s = Math.sign(this.lever);
    return s * ((Math.abs(this.lever) - ENGINE.neutral) / (1 - ENGINE.neutral));
  }

  /** Oil pressure / charge warning lights: ignition on but not running. */
  get warnings(): boolean {
    return this.ignition && !this.running;
  }

  toggleKey(): void {
    this.ignition = !this.ignition;
    if (!this.ignition) {
      this.running = false;
      this.cranking = 0;
    }
  }

  /** Press START: cranks if the key is on, the lever in neutral and the engine not already running. */
  pressStart(): boolean {
    if (!this.ignition || this.running || this.cranking > 0 || !this.inNeutral) return false;
    this.cranking = ENGINE.crankTime;
    return true;
  }

  setLever(v: number): void {
    this.lever = Math.max(-1, Math.min(1, v));
  }

  update(dt: number): void {
    if (this.cranking > 0) {
      this.cranking = Math.max(0, this.cranking - dt);
      // Catches only with fuel in the tank; otherwise it just cranks and stops.
      if (this.cranking === 0 && this.fuel > 0 && this.ignition) this.running = true;
    }
    if (this.running) {
      const t = Math.abs(this.thrust);
      this.fuel = Math.max(0, this.fuel - (ENGINE.idleBurn + (ENGINE.fullBurn - ENGINE.idleBurn) * t) * dt);
      if (this.fuel === 0) this.running = false; // ran dry
    }
    const target = this.running
      ? ENGINE.idleRpm + (ENGINE.maxRpm - ENGINE.idleRpm) * Math.abs(this.thrust)
      : this.cranking > 0
        ? 220
        : 0;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-(this.running ? 2.5 : 4) * dt));
  }

  refuel(): void {
    this.fuel = FUEL_CAPACITY;
  }
}
