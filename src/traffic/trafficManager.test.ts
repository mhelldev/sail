import { describe, expect, it } from 'vitest';
import { Coastline } from '../geo/coastline';
import { LocalProjection } from '../geo/projection';
import { HarborData } from '../harbors/harborData';
import { TrafficManager } from './trafficManager';

const projection = new LocalProjection(52, 4);

/** 20 km square island with its east shore at x = 0; open sea everywhere else. */
const island = new Coastline(
  new Float64Array([-20000, -10000, 0, -10000, 0, -10000, 0, 10000, 0, 10000, -20000, 10000, -20000, 10000, -20000, -10000]),
);

/** Harbours along the east shore, facing east (compass 90°). */
function harbours(): HarborData {
  const harbors = [-6000, -2000, 2000, 6000].map((z, i) => {
    const g = projection.toGeo(0, z);
    return [`Harbour ${i}`, g.lat, g.lon, 90, i % 2] as [string, number, number, number, 0 | 1];
  });
  return new HarborData({ harbors, lighthouses: [] }, projection);
}

describe('TrafficManager', () => {
  it('fills the sea up to the targets with vessels on water-only routes', () => {
    const traffic = new TrafficManager(island, harbours());
    for (let t = 0; t < 40; t += 0.1) traffic.update(0.1, 6000, 0, 270, 8);

    const counts: Record<string, number> = {};
    for (const v of traffic.vessels) counts[v.kind] = (counts[v.kind] ?? 0) + 1;
    expect(counts.yacht).toBeGreaterThan(3);
    expect(counts.motor).toBeGreaterThan(2);
    expect(counts.cargo).toBeGreaterThan(0);
    expect(traffic.vessels.length).toBeLessThanOrEqual(10 + 6 + 2 + 3);

    for (const v of traffic.vessels) {
      for (let i = 1; i < v.route.length; i++) {
        const a = v.route[i - 1];
        const b = v.route[i];
        for (let s = 0; s <= 20; s++) {
          const x = a.x + ((b.x - a.x) * s) / 20;
          const z = a.z + ((b.z - a.z) * s) / 20;
          expect(island.isLand(x, z), `${v.kind} route crosses land`).toBe(false);
        }
      }
    }
  });

  it('makes other vessels solid for the player', () => {
    const traffic = new TrafficManager(island, harbours());
    for (let t = 0; t < 20; t += 0.1) traffic.update(0.1, 6000, 0, 270, 8);
    const v = traffic.vessels[0];
    traffic.update(0.01, v.x, v.z, 270, 8); // player right next to it: obstacle list refreshes
    expect(traffic.obstacleDistance(traffic.vessels[0].x, traffic.vessels[0].z)).toBeGreaterThan(0);
  });
});
