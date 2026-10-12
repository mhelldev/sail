import { describe, expect, it } from 'vitest';
import { PersonController, type WalkWorld } from '../person/personController';
import { SHOP, SHOP_DOOR, SHOP_FIXTURES, shopCoversGround, shopSurfaces } from './shop';

// The shop at the origin on flat ground 0.3 m above its base (the base is sunk, like in the village).
const GROUND = 0.3;
const world = (doorOpen: boolean): WalkWorld => ({
  waterLevel: () => -10,
  surfacesAt: (x, z) => [
    ...(shopCoversGround(x, z) ? [] : [{ top: GROUND, boat: false }]),
    ...shopSurfaces(x, z, doorOpen).map((s) => ({ ...s, boat: false })),
  ],
});

/** Walks from in front of the door straight in (towards -Z) for a few seconds. */
function walkIn(doorOpen: boolean, x = 0, seconds = 6): PersonController {
  const p = new PersonController();
  p.place(x, GROUND, SHOP.depth / 2 + 3, false);
  for (let i = 0; i < seconds * 60; i++) p.step(1 / 60, { forward: 1, right: 0, jump: false, run: false }, 0, world(doorOpen));
  return p;
}

describe('supermarket', () => {
  it('lets you in through the open door, onto the floor', () => {
    const p = walkIn(true);
    expect(p.z).toBeLessThan(SHOP.depth / 2 - 1);
    expect(p.y).toBeCloseTo(SHOP.floor);
  });

  it('keeps you out while the door is shut, and through the shop windows always', () => {
    expect(walkIn(false).z).toBeGreaterThan(SHOP.depth / 2);
    expect(walkIn(true, SHOP_DOOR.halfWidth + 1.5).z).toBeGreaterThan(SHOP.depth / 2);
  });

  it('has the middle shelf in the way when walking straight in', () => {
    const gondola = SHOP_FIXTURES.find((f) => f.name === 'gondola')!;
    expect(walkIn(true).z).toBeGreaterThan(gondola.z1);
  });

  it('keeps the furniture inside the walls and clear of the doorway', () => {
    for (const f of SHOP_FIXTURES) {
      expect(f.x0).toBeGreaterThanOrEqual(-SHOP.width / 2 + SHOP.wall);
      expect(f.x1).toBeLessThanOrEqual(SHOP.width / 2 - SHOP.wall);
      expect(f.z0).toBeGreaterThanOrEqual(-SHOP.depth / 2 + SHOP.wall);
      expect(f.z1).toBeLessThan(SHOP.depth / 2 - SHOP.wall - 0.8);
      expect(f.x1 < -SHOP_DOOR.halfWidth || f.x0 > SHOP_DOOR.halfWidth || f.z1 < 0, f.name).toBe(true);
      expect(f.top + SHOP.floor).toBeLessThan(SHOP.ceiling);
    }
  });
});
