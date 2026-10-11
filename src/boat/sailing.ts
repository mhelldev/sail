// Pure sailing model — no three.js, so it can be unit tested.
//
// Conventions (used throughout the project):
//   heading / wind direction are compass degrees, clockwise from north.
//   Wind direction is where the wind blows FROM (meteorological convention).

/** Fraction of wind speed the boat reaches, by angle between heading and wind (0 = head to wind). */
const POLAR: ReadonlyArray<readonly [deg: number, factor: number]> = [
  [0, 0.0],
  [30, 0.33],
  [40, 0.53],
  [50, 0.66],
  [60, 0.73],
  [70, 0.8],
  [80, 0.86],
  [90, 0.93],
  [100, 0.86],
  [110, 0.8],
  [120, 0.73],
  [130, 0.66],
  [140, 0.53],
  [150, 0.4],
  [160, 0.33],
  [170, 0.26],
  [180, 0.2],
];

export const SAILING = {
  /** Game-feel multiplier on sailing speed (1 = realistic). The Godot game was effectively ~7×. */
  speedMultiplier: 1,
  maxSpeed: 12, // m/s, cap under sail
  turboSpeed: 60, // m/s, exploration mode
  speedResponse: 0.25, // 1/s, how quickly speed follows target
  turnRate: 0.35, // rad/s at full rudder
  turnResponse: 1.5, // 1/s, how quickly rudder input builds up
  maxHeel: 18, // degrees
  heelResponse: 0.8, // 1/s
  boomResponse: 1.5, // 1/s
  motorSpeed: 3.4, // m/s (~6.6 kn) at full ahead
  motorAstern: 1.8, // m/s at full astern
  motorResponse: 0.35, // 1/s
};

/** Wrap degrees into (-180, 180]. */
export function wrapDeg(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Signed angle of the wind relative to the bow. Positive = wind from starboard (right). */
export function relativeWind(headingDeg: number, windFromDeg: number): number {
  return wrapDeg(windFromDeg - headingDeg);
}

/** Unsigned angle between bow and wind, 0 (head to wind) … 180 (dead downwind). */
export function windAngle(headingDeg: number, windFromDeg: number): number {
  return Math.abs(relativeWind(headingDeg, windFromDeg));
}

export function polarFactor(angleDeg: number): number {
  const a = Math.min(180, Math.max(0, angleDeg));
  for (let i = 0; i < POLAR.length - 1; i++) {
    const [d0, f0] = POLAR[i];
    const [d1, f1] = POLAR[i + 1];
    if (a <= d1) return f0 + ((a - d0) / (d1 - d0)) * (f1 - f0);
  }
  return POLAR[POLAR.length - 1][1];
}

/**
 * Boom angle in degrees around the mast (positive = boom swung to starboard).
 * The boom always sits on the leeward side; the further off the wind, the further out.
 */
export function boomAngle(headingDeg: number, windFromDeg: number): number {
  const rel = relativeWind(headingDeg, windFromDeg);
  const out = Math.min(80, Math.max(8, Math.abs(rel) * 0.45));
  return rel >= 0 ? -out : out;
}

/**
 * Heel in degrees (positive = heeling to port). Strongest on a beam reach,
 * away from the wind, growing with wind strength.
 */
export function heelAngle(headingDeg: number, windFromDeg: number, windSpeed: number): number {
  const rel = relativeWind(headingDeg, windFromDeg);
  const strength = Math.min(1, windSpeed / 12);
  return Math.sign(rel) * Math.sin((Math.abs(rel) * Math.PI) / 180) * strength * SAILING.maxHeel;
}

export interface SailingInput {
  steer: number; // -1 (port) … 1 (starboard)
  sailUp: boolean;
  turbo: boolean;
  /** engine thrust, -1 (full astern) … 1 (full ahead); 0 or omitted without the engine */
  motor?: number;
}

export interface SailingState {
  heading: number; // degrees
  speed: number; // m/s
  turnSpeed: number; // rad/s, positive = turning to starboard
  heel: number; // degrees
  boom: number; // degrees
}

export function createSailingState(heading = 0): SailingState {
  return { heading, speed: 0, turnSpeed: 0, heel: 0, boom: 0 };
}

/** Frame-rate independent approach of `current` to `target`. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function stepSailing(
  s: SailingState,
  input: SailingInput,
  windFromDeg: number,
  windSpeed: number,
  dt: number,
): SailingState {
  const motor = input.motor ?? 0;
  // Steering: the rudder needs water flow, so turning is sluggish when slow — unless the propeller
  // blows water past it. Going astern, the stern goes where the rudder points: the bow swings the other way.
  const flow = Math.abs(s.speed) + Math.max(0, motor) * 2;
  const grip = 0.3 + 0.7 * Math.min(1, flow / 3);
  const astern = s.speed < -0.2 ? -1 : 1;
  const turnSpeed = approach(s.turnSpeed, astern * input.steer * SAILING.turnRate * grip, SAILING.turnResponse, dt);
  const heading = (((s.heading + (turnSpeed * dt * 180) / Math.PI) % 360) + 360) % 360;

  let targetSpeed = 0;
  if (input.turbo) targetSpeed = SAILING.turboSpeed;
  else if (input.sailUp)
    targetSpeed =
      Math.min(SAILING.maxSpeed, windSpeed * polarFactor(windAngle(heading, windFromDeg))) * SAILING.speedMultiplier;
  // The engine: ahead it adds to the sails (the faster of the two, plus a little); astern it fights them.
  if (!input.turbo && motor > 0) {
    const m = motor * SAILING.motorSpeed;
    targetSpeed = Math.max(targetSpeed, m) + 0.25 * Math.min(targetSpeed, m);
  } else if (!input.turbo && motor < 0) {
    targetSpeed = targetSpeed * 0.4 + motor * SAILING.motorAstern;
  }
  const speedRate = input.turbo ? 1 : motor !== 0 ? Math.max(SAILING.speedResponse, SAILING.motorResponse) : SAILING.speedResponse;
  const speed = approach(s.speed, targetSpeed, speedRate, dt);

  const targetHeel = input.sailUp && !input.turbo ? heelAngle(heading, windFromDeg, windSpeed) : 0;
  const heel = approach(s.heel, targetHeel, SAILING.heelResponse, dt);

  const targetBoom = input.sailUp ? boomAngle(heading, windFromDeg) : 0;
  const boom = approach(s.boom, targetBoom, SAILING.boomResponse, dt);

  return { heading, speed, turnSpeed, heel, boom };
}
