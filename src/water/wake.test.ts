import { describe, expect, it } from 'vitest';
import { WAKE_POINTS, WakeTrail } from './wake';

describe('WakeTrail', () => {
  it('lays down points behind a moving boat, newest first', () => {
    const wake = new WakeTrail();
    for (let x = 0; x <= 40; x += 0.5) wake.update(x, 0, 6);
    expect(wake.odometer).toBeCloseTo(40);
    expect(wake.points[0].x).toBeCloseTo(40); // head follows the stern
    expect(wake.count).toBeGreaterThan(8);
    for (let i = 1; i < wake.count; i++) expect(wake.points[i].x).toBeLessThan(wake.points[i - 1].x);
  });

  it('keeps at most WAKE_POINTS points', () => {
    const wake = new WakeTrail();
    for (let x = 0; x <= 2000; x += 1) wake.update(x, 0, 6);
    expect(wake.count).toBe(WAKE_POINTS);
  });

  it('starts a new trail after a teleport', () => {
    const wake = new WakeTrail();
    for (let x = 0; x <= 40; x += 1) wake.update(x, 0, 6);
    wake.update(5000, 5000, 0);
    expect(wake.count).toBe(1);
    expect(wake.points[0].x).toBe(5000);
  });
});
