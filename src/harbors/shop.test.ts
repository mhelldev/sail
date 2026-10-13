import { describe, expect, it } from 'vitest';
import { PersonController, type WalkWorld } from '../person/personController';
import { SHOP, SHOP_DISPLAYS, SHOP_DOOR, SHOP_FIXTURES, shopCoversGround, shopSurfaces } from './shop';

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

  it('has a price tag under every product you can buy, inside the shop', () => {
    const products = new Set(SHOP_DISPLAYS.map((d) => d.product));
    expect(products).toEqual(new Set(['apple', 'orange', 'pear', 'banana', 'bread', 'rolls', 'water', 'milk', 'juice', 'chocolate']));
    for (const d of SHOP_DISPLAYS) {
      expect(d.tag.y, d.product).toBeLessThan(d.box.y1);
      expect(d.tag.y).toBeGreaterThan(SHOP.floor);
      expect(Math.abs(d.tag.x)).toBeLessThan(SHOP.width / 2 - SHOP.wall);
      expect(Math.abs(d.tag.z)).toBeLessThan(SHOP.depth / 2 - SHOP.wall);
      // The tag is at the box's edge on the side it faces (where you stand).
      const nx = Math.round(Math.sin(d.tag.rotY));
      const nz = Math.round(Math.cos(d.tag.rotY));
      const centre = { x: (d.box.x0 + d.box.x1) / 2, z: (d.box.z0 + d.box.z1) / 2 };
      expect((d.tag.x - centre.x) * nx + (d.tag.z - centre.z) * nz).toBeGreaterThan(0);
    }
  });
});
