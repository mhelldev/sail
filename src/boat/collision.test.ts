import { describe, expect, it } from 'vitest';
import { depenetrate, findOpenWater, hullDistance, resolveMotion, type HullShape } from './collision';

// Land is everything east of x = 0: signed distance is simply x.
const shoreAtZero = (x: number) => x;
const hull: HullShape = { halfLength: 5, halfBeam: 1.6, clearance: 1 };

describe('hullDistance', () => {
  it('uses the most landward probe', () => {
    // Heading east (90°): the bow points at the land.
    expect(hullDistance(-20, 0, 90, hull, shoreAtZero).value).toBeCloseTo(-15);
    // Heading north: the starboard side faces the land.
    expect(hullDistance(-20, 0, 0, hull, shoreAtZero).value).toBeCloseTo(-18.4);
  });
});

describe('resolveMotion', () => {
  it('leaves motion in open water alone', () => {
    const r = resolveMotion(-100, 0, 90, 2, 0, hull, shoreAtZero);
    expect(r).toEqual({ dx: 2, dz: 0, grounded: false });
  });

  it('stops a boat sailing straight at the shore', () => {
    // Bow is 0.5 m from the clearance limit; a 2 m step would put it on land.
    const r = resolveMotion(-6.5, 0, 90, 2, 0, hull, shoreAtZero);
    expect(r.grounded).toBe(true);
    expect(r.dx).toBeCloseTo(0);
  });

  it('slides along the shore when hitting it at an angle', () => {
    // Heading north-east, motion has an along-shore (north, -z) component.
    const r = resolveMotion(-4.6, 0, 45, 1.4, -1.4, hull, shoreAtZero);
    expect(r.grounded).toBe(true);
    expect(r.dx).toBeCloseTo(0);
    expect(r.dz).toBeCloseTo(-1.4);
  });

  it('lets a grounded boat back away from land', () => {
    const r = resolveMotion(-5, 0, 270, -2, 0, hull, shoreAtZero);
    expect(r.dx).toBe(-2);
  });

  it('never ends a step deeper in land than it started', () => {
    const steps: Array<[number, number, number, number, number]> = [
      [-6, 0, 90, 3, 0],
      [-6, 3, 60, 2, -1],
      [-5.9, -2, 120, 2.5, 1.5],
      [-3, 0, 0, 0.5, -2],
    ];
    for (const [x, z, h, dx, dz] of steps) {
      const before = hullDistance(x, z, h, hull, shoreAtZero).value;
      const r = resolveMotion(x, z, h, dx, dz, hull, shoreAtZero);
      const after = hullDistance(x + r.dx, z + r.dz, h, hull, shoreAtZero).value;
      expect(after).toBeLessThanOrEqual(Math.max(before, -hull.clearance) + 1e-9);
    }
  });
});

describe('findOpenWater', () => {
  it('keeps a position that is already in open water', () => {
    expect(findOpenWater(-100, 7, hull, shoreAtZero)).toEqual({ x: -100, z: 7 });
  });

  it('moves a boat off the land', () => {
    const p = findOpenWater(200, 0, hull, shoreAtZero);
    expect(hullDistance(p.x, p.z, 0, hull, shoreAtZero).value).toBeLessThanOrEqual(-hull.clearance * 4);
  });
});

describe('depenetrate', () => {
  it('pushes a hull that turned into the shore back out', () => {
    // Bow pointing at the shore with only 0.5 m left instead of the 1 m clearance.
    const p = depenetrate(-5.5, 3, 90, hull, shoreAtZero);
    expect(hullDistance(p.x, p.z, 90, hull, shoreAtZero).value).toBeLessThanOrEqual(-hull.clearance + 1e-6);
    expect(p.z).toBeCloseTo(3); // pushed straight away from the shore, not along it
  });

  it('leaves a hull with enough water alone', () => {
    expect(depenetrate(-50, 3, 90, hull, shoreAtZero)).toEqual({ x: -50, z: 3 });
  });
});
