import { describe, expect, it } from 'vitest';
import { createWaveField, displace, heightAt, maxHeight } from './waves';

describe('waves', () => {
  const field = createWaveField(270);

  it('is flat with zero amplitude', () => {
    expect(heightAt({ ...field, amplitude: 0 }, 12, 34, 5)).toBe(0);
  });

  it('heightAt matches the displaced surface', () => {
    const d = { x: 0, y: 0, z: 0 };
    for (const [x, z, t] of [[0, 0, 0], [13, -7, 2.5], [100, 40, 9]]) {
      displace(field, x, z, t, d);
      expect(heightAt(field, x + d.x, z + d.z, t)).toBeCloseTo(d.y, 2);
    }
  });

  it('stays within the theoretical maximum', () => {
    const max = maxHeight(field);
    for (let i = 0; i < 200; i++) expect(Math.abs(heightAt(field, i * 3.1, i * -1.7, i * 0.13))).toBeLessThanOrEqual(max);
  });

  it('flattens beyond the fade distance', () => {
    expect(heightAt(field, field.fadeEnd + 10, 0, 3)).toBe(0);
  });
});
