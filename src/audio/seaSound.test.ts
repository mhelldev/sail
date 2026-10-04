import { describe, expect, it } from 'vitest';
import { seaGain } from './seaSound';

describe('seaGain', () => {
  it('is louder in rough weather', () => {
    expect(seaGain(1, 10, 1, false)).toBeGreaterThan(seaGain(0, 10, 1, false));
  });

  it('gets quieter from up high (top view), but not near the water', () => {
    expect(seaGain(0.5, 25, 1, false)).toBe(seaGain(0.5, 5, 1, false));
    expect(seaGain(0.5, 480, 1, false)).toBeLessThan(seaGain(0.5, 5, 1, false) * 0.3);
  });

  it('follows the volume setting and mutes completely', () => {
    expect(seaGain(0.5, 10, 2, false)).toBeCloseTo(seaGain(0.5, 10, 1, false) * 2);
    expect(seaGain(0.5, 10, 1, true)).toBe(0);
  });
});
