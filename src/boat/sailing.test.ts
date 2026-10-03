import { describe, expect, it } from 'vitest';
import {
  boomAngle,
  createSailingState,
  heelAngle,
  polarFactor,
  relativeWind,
  stepSailing,
  windAngle,
  wrapDeg,
} from './sailing';

describe('angles', () => {
  it('wraps into (-180, 180]', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(180)).toBe(180);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(720)).toBe(0);
  });

  it('measures wind relative to the bow', () => {
    expect(relativeWind(0, 90)).toBe(90); // wind from the east while heading north → starboard
    expect(relativeWind(350, 10)).toBe(20);
    expect(windAngle(10, 350)).toBe(20);
    expect(windAngle(0, 180)).toBe(180);
  });
});

describe('polar', () => {
  it('interpolates the table', () => {
    expect(polarFactor(0)).toBe(0);
    expect(polarFactor(90)).toBeCloseTo(0.93);
    expect(polarFactor(35)).toBeCloseTo(0.43);
    expect(polarFactor(180)).toBeCloseTo(0.2);
  });
});

describe('boom and heel', () => {
  it('puts the boom and heel on the leeward side', () => {
    // Wind from starboard → boom to port (negative), heel to port (positive).
    expect(boomAngle(0, 90)).toBeLessThan(0);
    expect(heelAngle(0, 90, 12)).toBeGreaterThan(0);
    // Wind from port → mirrored.
    expect(boomAngle(0, 270)).toBeGreaterThan(0);
    expect(heelAngle(0, 270, 12)).toBeLessThan(0);
  });

  it('heels most on a beam reach', () => {
    expect(Math.abs(heelAngle(0, 90, 12))).toBeGreaterThan(Math.abs(heelAngle(0, 160, 12)));
  });
});

describe('stepSailing', () => {
  const run = (heading: number, sailUp: boolean, seconds: number) => {
    let s = createSailingState(heading);
    for (let t = 0; t < seconds; t += 1 / 60) s = stepSailing(s, { steer: 0, sailUp, turbo: false }, 90, 10, 1 / 60);
    return s;
  };

  it('accelerates on a beam reach and stays still head to wind', () => {
    expect(run(0, true, 30).speed).toBeGreaterThan(8);
    expect(run(90, true, 30).speed).toBeLessThan(0.01);
  });

  it('does not move with the sail down', () => {
    expect(run(0, false, 30).speed).toBe(0);
  });

  it('turns to starboard with positive steer', () => {
    let s = { ...createSailingState(0), speed: 5 };
    for (let i = 0; i < 120; i++) s = stepSailing(s, { steer: 1, sailUp: true, turbo: false }, 90, 10, 1 / 60);
    expect(s.heading).toBeGreaterThan(0);
    expect(s.heading).toBeLessThan(90);
  });
});
