// Filling up at a fuel berth: the boat lies alongside the pump (close and nearly stopped) with the
// engine off, then fuel flows until the tank is full — or until the boat drifts off or the key is
// turned. Pure: returns what happened, the caller shows it.

import { FUEL_CAPACITY, type Engine } from './engine';

export const REFUEL = {
  rate: 4, // litres per second
  maxDistance: 15, // metres from the pump to the boat's centre
  maxSpeed: 0.6, // m/s: "alongside"
};

export type RefuelProblem = 'too far' | 'moving' | 'engine running' | 'full';

export interface BoatAtBerth {
  distance: number;
  speed: number;
}

/** Why the boat can't be refuelled right now, if it can't. */
export function refuelProblem(engine: Engine, boat: BoatAtBerth): RefuelProblem | undefined {
  if (boat.distance > REFUEL.maxDistance) return 'too far';
  if (Math.abs(boat.speed) > REFUEL.maxSpeed) return 'moving';
  if (engine.ignition) return 'engine running';
  if (engine.fuel >= FUEL_CAPACITY - 0.05) return 'full';
  return undefined;
}

export class Refuelling {
  active = false;

  /** The pump was clicked: start (or stop) filling. Returns the problem if it can't start. */
  toggle(engine: Engine, boat: BoatAtBerth): RefuelProblem | undefined {
    if (this.active) {
      this.active = false;
      return undefined;
    }
    const problem = refuelProblem(engine, boat);
    if (!problem) this.active = true;
    return problem;
  }

  /** Returns 'done' when the tank is full, the problem if filling had to stop, else undefined. */
  update(dt: number, engine: Engine, boat: BoatAtBerth): RefuelProblem | 'done' | undefined {
    if (!this.active) return undefined;
    const problem = refuelProblem(engine, boat);
    if (problem && problem !== 'full') {
      this.active = false;
      return problem;
    }
    engine.fuel = Math.min(FUEL_CAPACITY, engine.fuel + REFUEL.rate * dt);
    if (engine.fuel >= FUEL_CAPACITY) {
      this.active = false;
      return 'done';
    }
    return undefined;
  }
}
