import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Coastline, type CoastData } from './coastline';
import { LocalProjection } from './projection';

describe('LocalProjection', () => {
  const p = new LocalProjection(51.7478, 3.90804);

  it('puts the origin at 0,0 and north at -Z', () => {
    const o = p.toWorld(3.90804, 51.7478);
    expect(o.x).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(0);
    expect(p.toWorld(3.90804, 51.8478).z).toBeCloseTo(-11119.5, 0); // 0.1° north ≈ 11.1 km
    expect(p.toWorld(4.00804, 51.7478).x).toBeCloseTo(6882, -1); // 0.1° east at 51.7° ≈ 6.9 km
  });

  it('round-trips', () => {
    const { x, z } = p.toWorld(4.5, 52.3);
    const g = p.toGeo(x, z);
    expect(g.lon).toBeCloseTo(4.5, 9);
    expect(g.lat).toBeCloseTo(52.3, 9);
  });
});

/** 10 km square island centred on the origin, with a 2 km square lake (a hole) in the middle. */
function islandWithLake(): Coastline {
  const loop = (h: number) => [-h, -h, h, -h, h, -h, h, h, h, h, -h, h, -h, h, -h, -h];
  return new Coastline(new Float64Array([...loop(5000), ...loop(1000)]));
}

describe('Coastline', () => {
  const coast = islandWithLake();

  it('tells land from water, including lakes', () => {
    expect(coast.isLand(3000, 2500)).toBe(true);
    expect(coast.isLand(8000, 0)).toBe(false);
    expect(coast.isLand(0, 0)).toBe(false); // lake
    expect(coast.isLand(-4999, 4999)).toBe(true);
  });

  it('measures signed distance to the nearest coast', () => {
    expect(coast.signedDistance(3000, 0, 5000)).toBeCloseTo(2000); // 2 km to both the shore and the lake
    expect(coast.signedDistance(4000, 0, 5000)).toBeCloseTo(1000);
    expect(coast.signedDistance(6500, 0, 5000)).toBeCloseTo(-1500);
    expect(coast.signedDistance(0, 0, 5000)).toBeCloseTo(-1000);
    expect(coast.signedDistance(20000, 0, 3000)).toBe(-3000); // clamped
  });

  it('sampleLandMask matches isLand', () => {
    const n = 23;
    const mask = coast.sampleLandMask(-6100, -5900, 550, n);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        expect(mask[row * n + col]).toBe(coast.isLand(-6100 + col * 550, -5900 + row * 550) ? 1 : 0);
      }
    }
  });

  it('sampleGrid matches point queries', () => {
    const n = 17;
    const step = 900;
    const x0 = -7000;
    const z0 = -6800;
    const grid = coast.sampleGrid(x0, z0, step, n, 3000);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const expected = coast.signedDistance(x0 + col * step, z0 + row * step, 3000);
        expect(grid[row * n + col]).toBeCloseTo(expected, 3);
      }
    }
  });
});

describe('real coastline data', () => {
  const data = JSON.parse(readFileSync('public/data/coast.json', 'utf8')) as CoastData;
  const p = new LocalProjection(51.7478, 3.90804);
  const coast = Coastline.fromData(data, p);
  const land = (lon: number, lat: number) => {
    const { x, z } = p.toWorld(lon, lat);
    return coast.isLand(x, z);
  };

  it('knows some land and sea points', () => {
    expect(land(4.9, 52.37)).toBe(true); // Amsterdam
    expect(land(2.35, 48.86)).toBe(true); // Paris (France was duplicated in the source)
    expect(land(13.4, 52.52)).toBe(true); // Berlin
    expect(land(3.0, 52.5)).toBe(false); // North Sea
    expect(land(-3.0, 46.0)).toBe(false); // Bay of Biscay
    expect(land(5.0, 43.0)).toBe(false); // Mediterranean off Marseille
  });

  it('has no fake coast along inland country borders', () => {
    // Points on the DE/NL, FR/DE and FR/ES borders must be far from any coastline.
    const far = (lon: number, lat: number, km: number) => {
      const { x, z } = p.toWorld(lon, lat);
      return coast.distanceToCoast(x, z, km * 1000) >= km * 1000;
    };
    expect(far(6.03, 51.85, 20)).toBe(true); // DE/NL border near Emmerich
    expect(far(7.6, 47.6, 20)).toBe(true); // FR/DE/CH near Basel
    expect(far(0.7, 42.7, 20)).toBe(true); // Pyrenees
  });
});
