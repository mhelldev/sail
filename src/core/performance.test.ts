import { describe, expect, it } from 'vitest';
import { PerformanceGovernor } from './performance';

function governor(fpsCap = 60, maxPixelRatio = 2, adaptive = true) {
  const applied: number[] = [];
  const g = new PerformanceGovernor({ fpsCap, maxPixelRatio, adaptive }, (r) => applied.push(r));
  return { g, applied };
}

/** Feeds `seconds` worth of frames at a steady frame rate. */
const run = (g: PerformanceGovernor, fps: number, seconds: number) => {
  for (let i = 0; i < fps * seconds; i++) g.frame(1 / fps);
};

describe('PerformanceGovernor', () => {
  it('caps the frame rate on fast displays', () => {
    const { g } = governor(60);
    let rendered = 0;
    for (let i = 0; i < 120; i++) if (g.shouldRender(i * (1000 / 120))) rendered++; // one second at 120 Hz
    expect(rendered).toBeGreaterThanOrEqual(59);
    expect(rendered).toBeLessThanOrEqual(61);
  });

  it('renders every refresh when uncapped', () => {
    const { g } = governor(0);
    let rendered = 0;
    for (let i = 0; i < 120; i++) if (g.shouldRender(i * (1000 / 120))) rendered++;
    expect(rendered).toBe(120);
  });

  it('lowers the resolution while slow, down to 1', () => {
    const { g, applied } = governor();
    run(g, 30, 30);
    expect(g.pixelRatio).toBe(1);
    expect(applied).toEqual([2, 1.75, 1.5, 1.25, 1]);
  });

  it('raises it again after a while of smooth frames', () => {
    const { g } = governor();
    run(g, 30, 4.1);
    expect(g.pixelRatio).toBe(1.5);
    run(g, 60, 9);
    expect(g.pixelRatio).toBe(1.5); // not yet: needs several good windows in a row
    run(g, 60, 3);
    expect(g.pixelRatio).toBe(1.75);
  });

  it('ignores pauses such as switching tabs', () => {
    const { g } = governor();
    for (let i = 0; i < 10; i++) {
      g.frame(3); // tab was hidden for 3 s
      run(g, 60, 0.5);
    }
    expect(g.pixelRatio).toBe(2);
  });

  it('stays at the maximum when adaptive is off', () => {
    const { g } = governor(60, 1.5, false);
    run(g, 20, 20);
    expect(g.pixelRatio).toBe(1.5);
  });
});
