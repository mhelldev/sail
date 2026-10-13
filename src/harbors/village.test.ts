import { describe, expect, it } from 'vitest';
import type { Harbor } from './harborData';
import { generateVillage, obstacleDistance, type Ground } from './village';

// Straight coast along x = 0: land to the west (x < 0), sea to the east. Flat land 3 m high.
const ground: Ground = {
  sd: (x) => -x,
  height: (x) => (x < 0 ? 3 : -5),
};
const harbor = (id: number, isHarbour: boolean): Harbor => ({ id, name: `Test ${id}`, lat: 0, lon: 0, x: 0, z: 0, seaX: 1, seaZ: 0, isHarbour });

const LAND = new Set(['house', 'marinaHouse', 'shop', 'roof', 'chimney', 'tower', 'spire', 'trunk', 'crown', 'conifer', 'flagpole', 'flag', 'millTower', 'millCap', 'lampPost']);
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

  it('has walkways for people: never through a house, on land or on the pier deck, linked both ways', () => {
    for (let id = 0; id < 20; id++) {
      const v = generateVillage(harbor(id, id % 2 === 0), ground, { hasRealLighthouse: false });
      const { nodes, links } = v.walkways;
      const houses = v.parts.filter((p) => p.type === 'house' || p.type === 'marinaHouse' || p.type === 'shop');
      let linked = 0;
      nodes.forEach((n, i) => {
        if (!links[i].length) return;
        linked++;
        for (const j of links[i]) expect(links[j]).toContain(i);
        if (n.y !== undefined) return; // on the pier
        expect(ground.sd(n.x, n.z), `village ${id}`).toBeGreaterThan(1.5);
        for (const h of houses) {
          const box = { x: h.x, z: h.z, halfW: h.sx / 2, halfL: h.sz / 2, rotY: h.rotY };
          expect(obstacleDistance(box, n.x, n.z), `village ${id} point ${i} in a ${h.type}`).toBeLessThan(0);
        }
      });
      expect(linked, `village ${id}`).toBeGreaterThan(20);
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

describe('marina house', () => {
  it('stands at the root of the pier, facing the sea, with its own walls part', () => {
    let found = 0;
    for (let id = 0; id < 20; id++) {
      const v = generateVillage(harbor(id, id % 2 === 0), ground, { hasRealLighthouse: true });
      if (!v.marinaHouse) continue;
      found++;
      const shell = v.parts.filter((p) => p.type === 'marinaHouse');
      expect(shell).toHaveLength(1);
      expect(shell[0]).toMatchObject({ x: v.marinaHouse.x, z: v.marinaHouse.z, rotY: v.marinaHouse.rotY });
      // Front (local +Z) points out to sea (+X here).
      expect(Math.sin(v.marinaHouse.rotY)).toBeCloseTo(1);
      expect(ground.sd(v.marinaHouse.x, v.marinaHouse.z)).toBeGreaterThan(5);
    }
    expect(found).toBe(20);
  });

  it('has a supermarket next to it, facing the sea, not overlapping', () => {
    let found = 0;
    for (let id = 0; id < 20; id++) {
      const v = generateVillage(harbor(id, id % 2 === 0), ground, { hasRealLighthouse: true });
      if (!v.shop) continue;
      found++;
      expect(v.parts.filter((p) => p.type === 'shop')).toHaveLength(1);
      expect(Math.sin(v.shop.rotY)).toBeCloseTo(1);
      if (v.marinaHouse) expect(Math.hypot(v.shop.x - v.marinaHouse.x, v.shop.z - v.marinaHouse.z)).toBeGreaterThan(12);
    }
    expect(found).toBe(20);
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
