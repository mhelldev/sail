import { describe, expect, it } from 'vitest';
import { Weather } from './weather';

describe('Weather', () => {
  it('moves smoothly to the chosen weather', () => {
    const w = new Weather();
    w.mode = 'fog';
    expect(w.visibility).toBeGreaterThan(10000);
    for (let i = 0; i < 600; i++) w.update(0.1, 3);
    expect(w.state.fog).toBeGreaterThan(0.95);
    expect(w.visibility).toBeLessThan(500);
    w.mode = 'storm';
    for (let i = 0; i < 600; i++) w.update(0.1, 15);
    expect(w.state.rain).toBeGreaterThan(0.95);
    expect(w.windFactor).toBeGreaterThan(1.6);
  });

  it('changes by itself in auto mode, but no fog in a strong wind', () => {
    const w = new Weather(() => 0.99); // always the last possible type
    for (let i = 0; i < 20000; i++) w.update(0.1, 12);
    expect(w.type).toBe('storm');
    const calm = new Weather(() => 0.9);
    for (let i = 0; i < 2000; i++) calm.update(0.1, 4);
    expect(calm.type).toBe('fog');
  });
});
