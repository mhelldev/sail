import { describe, expect, it } from 'vitest';
import { bearing, SPECS, Vessel } from './vessel';

const run = (v: Vessel, seconds: number, windFrom = 270, windSpeed = 8) => {
  for (let t = 0; t < seconds; t += 0.1) v.step(0.1, windFrom, windSpeed);
};

describe('bearing', () => {
  it('uses compass degrees (north = -Z, east = +X)', () => {
    expect(bearing({ x: 0, z: 0 }, { x: 0, z: -10 })).toBeCloseTo(0);
    expect(bearing({ x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(90);
    expect(bearing({ x: 0, z: 0 }, { x: 0, z: 10 })).toBeCloseTo(180);
  });
});

describe('Vessel', () => {
  it('follows a route with a turn and arrives', () => {
    const route = [{ x: 0, z: 0 }, { x: 0, z: -800 }, { x: 800, z: -800 }];
    const v = new Vessel(1, 'motor', { ...SPECS.motor(), cruise: 6 }, route, 0);
    run(v, 400);
    expect(v.arrived).toBe(true);
    expect(Math.hypot(v.x - 800, v.z + 800)).toBeLessThan(40);
    expect(v.speed).toBeLessThan(1);
  });

  it('turns no faster than its turn rate', () => {
    const v = new Vessel(2, 'cargo', { ...SPECS.cargo(), turnRate: 2 }, [{ x: 0, z: 0 }, { x: 0, z: -5000 }], 0);
    v.heading = 90; // pointing east, route goes north
    v.step(1, 270, 8);
    expect(v.heading).toBeCloseTo(88);
  });

  it('sails off the wind and motors with the sails down when the route goes upwind', () => {
    // Wind from the west. Going north = beam reach; going west = straight into the wind.
    const reach = new Vessel(3, 'yacht', SPECS.yacht(), [{ x: 0, z: 0 }, { x: 0, z: -20000 }], 0);
    run(reach, 60);
    expect(reach.sailUp).toBe(true);
    expect(reach.speed).toBeGreaterThan(3.5);
    expect(Math.abs(reach.heel)).toBeGreaterThan(3);

    const upwind = new Vessel(4, 'yacht', SPECS.yacht(), [{ x: 0, z: 0 }, { x: -20000, z: 0 }], 0);
    run(upwind, 60);
    expect(upwind.sailUp).toBe(false);
    expect(upwind.speed).toBeCloseTo(upwind.spec.cruise, 0);
  });

  it('can start part-way along its route', () => {
    const v = new Vessel(5, 'ferry', SPECS.ferry(), [{ x: 0, z: 0 }, { x: 1000, z: 0 }], 0);
    v.advanceAlongRoute(0.5);
    expect(v.x).toBeCloseTo(500);
    expect(v.heading).toBeCloseTo(90);
  });
});
