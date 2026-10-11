import { describe, expect, it } from 'vitest';
import { engineGain } from './engineSound';

describe('engineGain', () => {
  it('gets louder with the throttle (ahead or astern) and quieter with distance', () => {
    const idle = engineGain(0, 1, 1, false);
    expect(engineGain(0.5, 1, 1, false)).toBeGreaterThan(idle);
    expect(engineGain(1, 1, 1, false)).toBeGreaterThan(engineGain(0.5, 1, 1, false));
    expect(engineGain(-1, 1, 1, false)).toBe(engineGain(1, 1, 1, false));
    expect(engineGain(1, 40, 1, false)).toBeLessThan(engineGain(1, 1, 1, false) / 3);
    expect(engineGain(1, 1, 1, true)).toBe(0);
  });
});
