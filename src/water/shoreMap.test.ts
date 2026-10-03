import { describe, expect, it } from 'vitest';
import { ShoreMap } from './shoreMap';
import { encodeShore, heightAt, createWaveField, SHORE_RANGE, shoreDamping } from './waves';

// Coast along x = 0, land to the east: signed distance is simply x.
const field = (x0: number, _z0: number, step: number, res: number) => {
  const sd = new Float32Array(res * res);
  for (let row = 0; row < res; row++) for (let col = 0; col < res; col++) sd[row * res + col] = x0 + col * step;
  return Promise.resolve(encodeShore(sd));
};

describe('ShoreMap', () => {
  it('decodes what the worker encoded (within byte precision)', async () => {
    const map = new ShoreMap(field, 1000, 64);
    expect(map.sample(0, 0)).toBe(-SHORE_RANGE); // nothing loaded yet
    map.update(0, 0);
    await Promise.resolve();
    await Promise.resolve();
    const tolerance = (2 * SHORE_RANGE) / 255;
    for (const x of [-200, -73.3, -5, 0, 12.5, 180]) expect(Math.abs(map.sample(x, 37) - x)).toBeLessThan(tolerance);
    expect(map.sample(5000, 0)).toBe(-SHORE_RANGE); // outside the map counts as open sea
  });
});

describe('shore damping', () => {
  it('calms waves near the shore but not out at sea', () => {
    expect(shoreDamping(-SHORE_RANGE)).toBe(1);
    expect(shoreDamping(-5)).toBeCloseTo(0.15);
    const open = createWaveField(270);
    const calm = { ...open, shore: () => -5 };
    let maxOpen = 0;
    let maxCalm = 0;
    for (let i = 0; i < 100; i++) {
      maxOpen = Math.max(maxOpen, Math.abs(heightAt(open, i * 3.7, i * -2.1, i * 0.21)));
      maxCalm = Math.max(maxCalm, Math.abs(heightAt(calm, i * 3.7, i * -2.1, i * 0.21)));
    }
    expect(maxCalm).toBeLessThan(maxOpen * 0.2);
  });
});
