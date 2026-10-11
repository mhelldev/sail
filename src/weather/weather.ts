// Weather that changes by itself (or is set from the tuning panel): cloud cover, rain, fog and gusts,
// each 0 … 1, drifting smoothly towards the current weather type. Pure; Environment, rain, wind and
// the VHF read it.

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm';
export type WeatherMode = 'auto' | WeatherType;

export interface WeatherState {
  clouds: number;
  rain: number;
  fog: number;
  gusts: number;
}

const TYPES: Record<WeatherType, WeatherState> = {
  clear: { clouds: 0.15, rain: 0, fog: 0, gusts: 0.15 },
  cloudy: { clouds: 0.75, rain: 0, fog: 0, gusts: 0.35 },
  rain: { clouds: 0.95, rain: 0.75, fog: 0.15, gusts: 0.5 },
  fog: { clouds: 0.55, rain: 0, fog: 1, gusts: 0 },
  storm: { clouds: 1, rain: 1, fog: 0.1, gusts: 1 },
};

export class Weather {
  /** 'auto' changes by itself every few minutes; otherwise fixed (from the tuning panel) */
  mode: WeatherMode = 'auto';
  /** the weather it is heading to */
  type: WeatherType = 'clear';
  readonly state: WeatherState = { ...TYPES.clear };
  private nextChange = 120;
  private time = 0;

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * @param windSpeed m/s: fog only comes with little wind, storms with a lot
   */
  update(dt: number, windSpeed: number): void {
    this.time += dt;
    if (this.mode !== 'auto') {
      this.type = this.mode;
    } else if (this.time >= this.nextChange) {
      this.type = this.pick(windSpeed);
      this.nextChange = this.time + 240 + this.random() * 360;
    }
    const target = TYPES[this.type];
    // Fronts take a minute or two to arrive (fog creeps in slower); picked by hand it changes quickly.
    const rate = this.mode === 'auto' ? 1 / 90 : 1 / 6;
    for (const key of Object.keys(target) as Array<keyof WeatherState>) {
      const k = key === 'fog' && this.mode === 'auto' ? rate * 0.6 : rate;
      this.state[key] += (target[key] - this.state[key]) * Math.min(1, dt * k * 3);
    }
  }

  /** How far you can see, metres. */
  get visibility(): number {
    const { fog, rain } = this.state;
    return Math.min(15000, 300 + 14700 * (1 - fog) ** 3) * (1 - 0.6 * rain);
  }

  /** Extra wind in squalls and storms (multiplier on the wind speed). */
  get windFactor(): number {
    return 1 + 0.7 * Math.max(0, (this.state.gusts - 0.5) / 0.5);
  }

  private pick(windSpeed: number): WeatherType {
    const weights: Array<[WeatherType, number]> = [
      ['clear', 0.35],
      ['cloudy', 0.3],
      ['rain', 0.2],
      ['fog', windSpeed < 7 ? 0.15 : 0],
      ['storm', windSpeed > 10 ? 0.08 : 0],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let r = this.random() * total;
    for (const [type, w] of weights) if ((r -= w) <= 0) return type;
    return 'clear';
  }
}
