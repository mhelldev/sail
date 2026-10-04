import { describe, expect, it } from 'vitest';
import { Helm, WHEEL_LOCK } from './helm';

describe('Helm', () => {
  it('turns while a key is held and stops at full lock', () => {
    const helm = new Helm();
    helm.update(0.1, 1, null);
    expect(helm.position).toBeCloseTo(0.22);
    for (let i = 0; i < 20; i++) helm.update(0.1, 1, null);
    expect(helm.position).toBe(1);
    expect(helm.wheelAngle).toBeCloseTo(WHEEL_LOCK);
  });

  it('eases back to centre when let go, without overshooting', () => {
    const helm = new Helm();
    helm.position = -0.5;
    helm.update(0.1, 0, null);
    expect(helm.position).toBeCloseTo(-0.34);
    for (let i = 0; i < 10; i++) helm.update(0.1, 0, null);
    expect(helm.position).toBe(0);
  });

  it('follows the finger directly, clamped to the lock', () => {
    const helm = new Helm();
    helm.update(0.016, 0, 0.4);
    expect(helm.position).toBe(0.4);
    helm.update(0.016, -1, 3); // touch wins over keys
    expect(helm.position).toBe(1);
  });

  it('stays where it was left when steered by hand', () => {
    const helm = new Helm();
    helm.update(0.1, 0, 0.5, false);
    for (let i = 0; i < 20; i++) helm.update(0.1, 0, null, false);
    expect(helm.position).toBe(0.5);
  });
});
