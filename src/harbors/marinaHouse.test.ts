import { describe, expect, it } from 'vitest';
import { PersonController, type WalkWorld } from '../person/personController';
import { fitPicture, HOUSE_DOOR, MARINA_HOUSE, marinaHouseCoversGround, marinaHouseSurfaces, WALL_SLOTS } from './marinaHouse';

// The house at the origin on flat ground 0.3 m above its base (the base is sunk, like in the village).
let GROUND = 0.3;
const world = (doorOpen: boolean): WalkWorld => ({
  waterLevel: () => -10,
  surfacesAt: (x, z) => [
    ...(marinaHouseCoversGround(x, z) ? [] : [{ top: GROUND, boat: false }]),
    ...marinaHouseSurfaces(x, z, doorOpen).map((s) => ({ ...s, boat: false })),
  ],
});

/** Walks from in front of the door straight in (towards -Z) for a few seconds. */
function walkIn(doorOpen: boolean, x = 0, from = 1.5): PersonController {
  const p = new PersonController();
  p.place(x, GROUND, MARINA_HOUSE.depth / 2 + from, false);
  for (let i = 0; i < 360; i++) p.step(1 / 60, { forward: 1, right: 0, jump: false, run: false }, 0, world(doorOpen));
  return p;
}

describe('marina house', () => {
  it('lets you in through the open door, onto the floor and under the ceiling', () => {
    const p = walkIn(true);
    expect(p.z).toBeLessThan(MARINA_HOUSE.depth / 2 - 1);
    expect(p.y).toBeCloseTo(MARINA_HOUSE.floor);
  });

  it('has steps up to the door when the ground in front is lower (or higher) than the floor', () => {
    for (const ground of [-1.6, 0, 0.6]) {
      GROUND = ground;
      const p = walkIn(true, 0, 7);
      expect(p.z, `ground at ${ground}`).toBeLessThan(MARINA_HOUSE.depth / 2 - 1);
      expect(p.y).toBeCloseTo(MARINA_HOUSE.floor);
    }
    GROUND = 0.3;
  });

  it('keeps you out while the door is shut, and the walls always', () => {
    expect(walkIn(false).z).toBeGreaterThan(MARINA_HOUSE.depth / 2);
    expect(walkIn(true, HOUSE_DOOR.halfWidth + 1).z).toBeGreaterThan(MARINA_HOUSE.depth / 2);
  });

  it('has the back wall stop you inside, and the bench in the way', () => {
    const p = walkIn(true);
    expect(p.z).toBeGreaterThan(-MARINA_HOUSE.depth / 2 + MARINA_HOUSE.wall);
    // Walking straight in from the door you bump into the bench in the middle of the room.
    expect(p.z).toBeGreaterThan(0.6);
  });

  it('fits photos inside their slot keeping the aspect', () => {
    for (const slot of WALL_SLOTS) {
      for (const aspect of [0.5, 0.75, 1, 1.5]) {
        const { width, height } = fitPicture(slot, aspect);
        expect(width).toBeLessThanOrEqual(slot.maxWidth + 1e-9);
        expect(height).toBeLessThanOrEqual(slot.maxHeight + 1e-9);
        expect(height / width).toBeCloseTo(aspect);
      }
    }
    expect(WALL_SLOTS.filter((s) => s.kind === 'photo')).toHaveLength(6);
  });
});
