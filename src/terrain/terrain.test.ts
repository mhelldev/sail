import { describe, expect, it } from 'vitest';
import { Coastline } from '../geo/coastline';
import { buildChunk } from './buildChunk';
import { DEFAULT_TERRAIN, createTerrainSampler } from './height';

const sampler = createTerrainSampler(DEFAULT_TERRAIN);

/** 20 km square island centred on the origin. */
const island = new Coastline(
  new Float64Array([-10000, -10000, 10000, -10000, 10000, -10000, 10000, 10000, 10000, 10000, -10000, 10000, -10000, 10000, -10000, -10000]),
);

describe('terrain height', () => {
  it('is below sea level offshore and meets the sea at the coast', () => {
    expect(sampler.height(-50, 0, 0)).toBeLessThan(0);
    expect(sampler.height(-5000, 0, 0)).toBeLessThan(0);
    // A small bank: just under water on the sea side, just above on the land side.
    expect(sampler.height(0, 123, 456)).toBeLessThan(-0.5);
    expect(sampler.height(0.01, 123, 456)).toBeGreaterThan(0.5);
    expect(sampler.height(10, 123, 456)).toBeGreaterThan(1);
  });

  it('is deterministic for the same seed and differs for another', () => {
    const other = createTerrainSampler({ ...DEFAULT_TERRAIN, seed: 7 });
    expect(createTerrainSampler(DEFAULT_TERRAIN).height(3000, 1234, -987)).toBe(sampler.height(3000, 1234, -987));
    expect(other.height(3000, 1234, -987)).not.toBe(sampler.height(3000, 1234, -987));
  });

  it('produces real mountains inland', () => {
    let max = 0;
    let sum = 0;
    let count = 0;
    for (let x = -40000; x <= 40000; x += 500) {
      for (let z = -40000; z <= 40000; z += 500) {
        const h = sampler.height(5000, x, z);
        max = Math.max(max, h);
        sum += h;
        count++;
      }
    }
    expect(max).toBeGreaterThan(DEFAULT_TERRAIN.mountainHeight * 0.6);
    expect(max).toBeLessThan(DEFAULT_TERRAIN.mountainHeight + DEFAULT_TERRAIN.hillHeight + 5);
    expect(sum / count).toBeGreaterThan(80); // not mostly flat
  });
});

describe('buildChunk', () => {
  it('skips chunks with no land', () => {
    expect(buildChunk({ x0: 20000, z0: 0, size: 2000, res: 16 }, island, sampler).empty).toBe(true);
  });

  it('builds a grid plus skirts', () => {
    const res = 16;
    const n = res + 1;
    const chunk = buildChunk({ x0: 9000, z0: 0, size: 2000, res }, island, sampler);
    expect(chunk.empty).toBe(false);
    expect(chunk.positions.length).toBe((n * n + 4 * n) * 3);
    expect(chunk.indices.length).toBe(res * res * 6 + 4 * res * 12);
    for (const v of chunk.positions) expect(Number.isFinite(v)).toBe(true);
    for (const c of chunk.colors) expect(c).toBeGreaterThanOrEqual(0);
  });

  it('matches heights along a shared edge with its neighbour', () => {
    const res = 16;
    const n = res + 1;
    const west = buildChunk({ x0: 4000, z0: 2000, size: 2000, res }, island, sampler);
    const east = buildChunk({ x0: 6000, z0: 2000, size: 2000, res }, island, sampler);
    for (let row = 0; row < n; row++) {
      const westEdge = west.positions[(row * n + res) * 3 + 1];
      const eastEdge = east.positions[row * n * 3 + 1];
      expect(eastEdge).toBeCloseTo(westEdge, 4);
    }
  });

  it('has land above and sea below the waterline across the coast', () => {
    const res = 32;
    const n = res + 1;
    const chunk = buildChunk({ x0: 9000, z0: 0, size: 2000, res }, island, sampler);
    const step = 2000 / res;
    for (let col = 0; col < n; col++) {
      const x = 9000 + col * step;
      const h = chunk.positions[col * 3 + 1];
      if (x < 9990) expect(h).toBeGreaterThan(0);
      if (x > 10010) expect(h).toBeLessThan(0);
    }
  });
});
