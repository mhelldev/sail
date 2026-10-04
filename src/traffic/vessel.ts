// One generated vessel following a water route in real time. Pure (no three.js).
// Headings are compass degrees like the player's boat: forward = (sin h, -cos h) in world X/Z.

import { boomAngle, heelAngle, polarFactor, windAngle, wrapDeg } from '../boat/sailing';
import type { Point } from './waterPath';

export type VesselKind = 'yacht' | 'motor' | 'ferry' | 'cargo';

export interface VesselSpec {
  length: number;
  beam: number;
  /** cruising speed in m/s (yachts: speed when motoring) */
  cruise: number;
  /** maximum turn rate in degrees per second */
  turnRate: number;
}

export const SPECS: Record<VesselKind, () => VesselSpec> = {
  yacht: () => ({ length: rnd(8, 13), beam: 0, cruise: 3.2, turnRate: 12 }),
  motor: () => ({ length: rnd(7, 14), beam: 0, cruise: rnd(5, 9), turnRate: 15 }),
  ferry: () => ({ length: rnd(55, 90), beam: 0, cruise: rnd(6.5, 8.5), turnRate: 4 }),
  cargo: () => ({ length: rnd(130, 200), beam: 0, cruise: rnd(6.5, 9.5), turnRate: 1.5 }),
};
const BEAM_RATIO: Record<VesselKind, number> = { yacht: 0.33, motor: 0.35, ferry: 0.2, cargo: 0.15 };

function rnd(a: number, b: number): number {
  return a + (b - a) * Math.random();
}

/** Yachts motor instead of sailing closer to the wind than this (they don't tack). */
const NO_GO = 42;

export class Vessel {
  x: number;
  z: number;
  heading: number;
  speed = 0;
  sailUp = false;
  boom = 0;
  heel = 0;
  arrived = false;
  /** seconds since arrival (used to keep waiting boats around for a while) */
  waited = 0;
  private next = 1;

  constructor(
    readonly id: number,
    readonly kind: VesselKind,
    readonly spec: VesselSpec,
    public route: Point[],
    /** look and identity: colour index, picked once */
    readonly variant: number,
  ) {
    if (spec.beam === 0) spec.beam = spec.length * BEAM_RATIO[kind];
    this.x = route[0].x;
    this.z = route[0].z;
    this.heading = bearing(route[0], route[1] ?? route[0]);
  }

  /** Starts a new voyage from where the vessel is (ferries turning around). */
  setRoute(route: Point[]): void {
    this.route = route;
    this.next = 1;
    this.arrived = false;
    this.waited = 0;
  }

  /** Puts the vessel part-way along its route (for the first population, so not everyone starts in port). */
  advanceAlongRoute(fraction: number): void {
    const total = routeLength(this.route);
    let left = total * fraction;
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1];
      const b = this.route[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (left <= len) {
        const t = left / len;
        this.x = a.x + (b.x - a.x) * t;
        this.z = a.z + (b.z - a.z) * t;
        this.heading = bearing(a, b);
        this.next = i;
        this.speed = this.spec.cruise;
        return;
      }
      left -= len;
    }
  }

  step(dt: number, windFrom: number, windSpeed: number): void {
    if (this.arrived) {
      this.waited += dt;
      this.speed = approach(this.speed, 0, 0.5, dt);
      this.sailUp = false;
      this.boom = approach(this.boom, 0, 1, dt);
      this.heel = approach(this.heel, 0, 1, dt);
      this.move(dt);
      return;
    }

    // Aim at the next waypoint; switch to the one after once close enough.
    const target = this.route[this.next];
    const reach = Math.max(40, this.spec.length * 1.5);
    let dist = Math.hypot(target.x - this.x, target.z - this.z);
    if (dist < reach && this.next < this.route.length - 1) {
      this.next++;
      dist = Math.hypot(this.route[this.next].x - this.x, this.route[this.next].z - this.z);
    }
    const goal = this.route[this.next];
    const want = bearing({ x: this.x, z: this.z }, goal);
    const turn = Math.max(-this.spec.turnRate * dt, Math.min(this.spec.turnRate * dt, wrapDeg(want - this.heading)));
    this.heading = (this.heading + turn + 360) % 360;

    let target_speed = this.spec.cruise;
    if (this.kind === 'yacht') {
      const angle = windAngle(this.heading, windFrom);
      this.sailUp = angle >= NO_GO;
      target_speed = this.sailUp ? Math.min(7, Math.max(1.8, windSpeed * polarFactor(angle) * 0.7)) : this.spec.cruise;
      this.boom = approach(this.boom, this.sailUp ? boomAngle(this.heading, windFrom) : 0, 1.2, dt);
      this.heel = approach(this.heel, this.sailUp ? heelAngle(this.heading, windFrom, windSpeed) * 0.8 : 0, 0.8, dt);
    }
    // Slow down for the last stretch and for sharp turns.
    const last = this.next === this.route.length - 1;
    if (last) target_speed *= Math.min(1, Math.max(0.15, dist / (this.spec.length * 6 + 60)));
    target_speed *= 1 - Math.min(0.6, Math.abs(wrapDeg(want - this.heading)) / 150);
    this.speed = approach(this.speed, target_speed, this.kind === 'cargo' ? 0.08 : 0.4, dt);

    if (last && dist < Math.max(15, this.spec.length * 0.5)) this.arrived = true;
    this.move(dt);
  }

  private move(dt: number): void {
    const h = (this.heading * Math.PI) / 180;
    this.x += Math.sin(h) * this.speed * dt;
    this.z -= Math.cos(h) * this.speed * dt;
  }
}

export function bearing(a: Point, b: Point): number {
  return ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;
}

export function routeLength(route: Point[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  return total;
}

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
