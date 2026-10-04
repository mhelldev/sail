import { describe, expect, it } from 'vitest';
import { dilate, findWaterPath, lineOfSight, type WaterGrid } from './waterPath';

/** 40 × 40 grid of 10 m cells with a wall at col 20 from row 0 to 34 (gap at the bottom). */
function wallGrid(): WaterGrid {
  const n = 40;
  const blocked = new Uint8Array(n * n);
  for (let row = 0; row < 35; row++) blocked[row * n + 20] = 1;
  return { x0: 0, z0: 0, step: 10, n, blocked };
}

const crossesWall = (path: Array<{ x: number; z: number }>, g: WaterGrid) => {
  for (let i = 1; i < path.length; i++) {
    const a = { col: Math.round(path[i - 1].x / g.step), row: Math.round(path[i - 1].z / g.step) };
    const b = { col: Math.round(path[i].x / g.step), row: Math.round(path[i].z / g.step) };
    if (!lineOfSight(g, a, b)) return true;
  }
  return false;
};

describe('findWaterPath', () => {
  it('goes straight when nothing is in the way', () => {
    const g = wallGrid();
    const path = findWaterPath(g, { x: 20, z: 20 }, { x: 150, z: 300 })!;
    expect(path).toEqual([{ x: 20, z: 20 }, { x: 150, z: 300 }]);
  });

  it('routes around a wall through the gap, with only a few corners', () => {
    const g = wallGrid();
    const path = findWaterPath(g, { x: 50, z: 50 }, { x: 350, z: 50 })!;
    expect(path).toBeDefined();
    expect(path[0]).toEqual({ x: 50, z: 50 });
    expect(path.at(-1)).toEqual({ x: 350, z: 50 });
    expect(path.length).toBeLessThanOrEqual(5);
    expect(path.some((p) => p.z >= 350)).toBe(true); // through the gap at the bottom
    expect(crossesWall(path, g)).toBe(false);
  });

  it('gives up when there is no water connection', () => {
    const g = wallGrid();
    for (let col = 0; col < 40; col++) g.blocked[37 * 40 + col] = 1;
    for (let row = 35; row < 40; row++) g.blocked[row * 40 + 20] = 1;
    expect(findWaterPath(g, { x: 50, z: 50 }, { x: 350, z: 50 })).toBeUndefined();
  });

  it('keeps a margin from land when dilated', () => {
    const g = dilate(wallGrid(), 2);
    expect(g.blocked[10 * 40 + 18]).toBe(1);
    expect(g.blocked[10 * 40 + 17]).toBe(0);
    const path = findWaterPath(g, { x: 50, z: 50 }, { x: 350, z: 50 })!;
    expect(crossesWall(path, g)).toBe(false);
  });
});
