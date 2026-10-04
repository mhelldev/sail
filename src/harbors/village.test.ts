import { describe, expect, it } from 'vitest';
import type { Harbor } from './harborData';
import { generateVillage, obstacleDistance, type Ground } from './village';

// Straight coast along x = 0: land to the west (x < 0), sea to the east. Flat land 3 m high.
const ground: Ground = {
  sd: (x) => -x,
  height: (x) => (x < 0 ? 3 : -5),
};
const harbor = (id: number, isHarbour: boolean): Harbor => ({ id, name: `Test ${id}`, x: 0, z: 0, seaX: 1, seaZ: 0, isHarbour });

const LAND = new Set(['house', 'roof', 'chimney', 'tower', 'spire', 'trunk', 'crown', 'conifer', 'flagpole', 'flag', 'millTower', 'millCap']);
const WATER = new Set(['deck', 'pile', 'pontoon', 'breakwater', 'rock', 'hull', 'mast', 'cabin', 'harbourLight']);

describe('generateVillage', () => {
  it('is deterministic per harbour and differs between harbours', () => {
    const a = generateVillage(harbor(7, true), ground, { hasRealLighthouse: false });
    const b = generateVillage(harbor(7, true), ground, { hasRealLighthouse: false });
    const c = generateVillage(harbor(8, true), ground, { hasRealLighthouse: false });
    expect(b).toEqual(a);
    expect(c.parts.length).not.toBe(a.parts.length);
  });

  it('builds on land and moors in the water', () => {
    for (let id = 0; id < 30; id++) {
      const v = generateVillage(harbor(id, id % 2 === 0), ground, { hasRealLighthouse: false });
      for (const p of v.parts) {
        // Pier and breakwaters are rooted on the shore; everything else is clearly on one side.
        const rooted = p.type === 'deck' || p.type === 'breakwater' || p.type === 'rock';
        if (LAND.has(p.type)) expect(ground.sd(p.x, p.z), `${p.type} of village ${id}`).toBeGreaterThan(8);
        if (WATER.has(p.type)) expect(ground.sd(p.x, p.z), `${p.type} of village ${id}`).toBeLessThan(rooted ? 3 : 0);
      }
    }
  });

  it('makes harbours bigger than marinas and gives them obstacles to sail around', () => {
    let harbourHouses = 0;
    let marinaHouses = 0;
    for (let id = 0; id < 20; id++) {
      harbourHouses += generateVillage(harbor(id, true), ground, { hasRealLighthouse: true }).parts.filter((p) => p.type === 'house').length;
      const marina = generateVillage(harbor(id, false), ground, { hasRealLighthouse: true });
      marinaHouses += marina.parts.filter((p) => p.type === 'house').length;
      expect(marina.obstacles.length).toBeGreaterThan(0);
    }
    expect(harbourHouses).toBeGreaterThan(marinaHouses);
    expect(marinaHouses / 20).toBeGreaterThan(15); // a real village, not a handful of sheds
  });
});

describe('obstacleDistance', () => {
  it('is positive inside, negative outside, with the box rotated', () => {
    // 2 m wide, 20 m long box along the X axis (rotated 90°).
    const box = { x: 0, z: 0, halfW: 1, halfL: 10, rotY: Math.PI / 2 };
    expect(obstacleDistance(box, 0, 0)).toBeCloseTo(1);
    expect(obstacleDistance(box, 9, 0)).toBeCloseTo(1);
    expect(obstacleDistance(box, 12, 0)).toBeCloseTo(-2);
    expect(obstacleDistance(box, 0, 3)).toBeCloseTo(-2);
  });
});
