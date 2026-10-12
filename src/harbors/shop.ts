// The village supermarket next to the marina house: a single-storey shop you can walk into, with
// fruit and vegetables, a bread rack, water bottles, shelves of groceries and a checkout. Pure layout
// in the shop's own frame, like the marina house: origin at the centre of the footprint at its base,
// +Z = front (towards the sea). The model (shopModel.ts) and the walking physics both use this.

import type { HouseSurface } from './marinaHouse';

export const SHOP = {
  width: 10,
  depth: 7,
  height: 4.2, // eaves: a low roof sits on top
  wall: 0.25,
  floor: 0.32, // like the marina house: the base is sunk 0.3 m, the floor level with the ground
  ceiling: 3.3,
  color: 0xe9e3d3,
};

/** Glass door in the middle of the front, swinging inwards, hinged on its left (−X) side. */
export const SHOP_DOOR = { halfWidth: 0.7, height: 2.3 };

/** The two shop windows beside the door (x of their centres, size). */
export const SHOP_WINDOWS = { xs: [-2.8, 2.8], width: 2.8, bottom: SHOP.floor + 0.55, top: SHOP.floor + 2.45 };

/** "SUPERMARKET" board over the door and windows. */
export const SHOP_SIGN = { width: 6.4, height: 0.72, centreY: SHOP.floor + 3.32 };

/** Steps up to the door, as at the marina house (a ramp for walking). */
export const SHOP_STEPS = { halfWidth: 1.4, landing: 1.1, rise: 0.18, run: 0.3, count: 15 };

/** Furniture you bump into (and could stand on): boxes in shop coordinates, `top` above the floor. */
export interface Fixture {
  name: 'shelvesBack' | 'fruit' | 'bread' | 'gondola' | 'checkout' | 'water';
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

const HALF_W = SHOP.width / 2;
const HALF_D = SHOP.depth / 2;
const T = SHOP.wall;

export const SHOP_FIXTURES: Fixture[] = [
  // Groceries along the back wall.
  { name: 'shelvesBack', x0: -HALF_W + T, x1: HALF_W - T, z0: -HALF_D + T, z1: -HALF_D + T + 0.5, top: 1.95 },
  // Fruit and vegetables in tilted crates along the left wall (seen walking in).
  { name: 'fruit', x0: -HALF_W + T, x1: -HALF_W + T + 0.85, z0: -2.3, z1: 1.8, top: 1.0 },
  // Bread rack on the right wall.
  { name: 'bread', x0: HALF_W - T - 0.7, x1: HALF_W - T, z0: -2.3, z1: 0.6, top: 1.75 },
  // A double-sided shelf in the middle of the room.
  { name: 'gondola', x0: -2.1, x1: 2.1, z0: -1.05, z1: -0.35, top: 1.5 },
  // Stacked packs of water bottles near the entrance.
  { name: 'water', x0: -2.7, x1: -1.5, z0: 0.9, z1: 1.8, top: 0.95 },
  // Checkout counter right of the door.
  { name: 'checkout', x0: 1.7, x1: 3.5, z0: 1.75, z1: 2.4, top: 0.9 },
];

/** Inside the footprint the shop has its own floor: the terrain there is ignored. */
export function shopCoversGround(x: number, z: number): boolean {
  return Math.abs(x) <= HALF_W && Math.abs(z) <= HALF_D;
}

/** What can be stood on or bumped into at shop-local (x, z): walls, door, floor, ceiling, furniture, steps. */
export function shopSurfaces(x: number, z: number, doorOpen: boolean): HouseSurface[] {
  const { floor, ceiling, height } = SHOP;
  const ax = Math.abs(x);
  if (z > HALF_D && ax <= SHOP_STEPS.halfWidth) {
    const s = SHOP_STEPS;
    const t = z - HALF_D - s.landing;
    if (t > s.count * s.run) return [];
    return [{ top: floor - (Math.max(0, t) * s.rise) / s.run }];
  }
  if (ax > HALF_W || Math.abs(z) > HALF_D) return [];
  const inFrontWall = z > HALF_D - T;
  if (ax > HALF_W - T || z < -HALF_D + T || inFrontWall) {
    if (inFrontWall && ax <= SHOP_DOOR.halfWidth && doorOpen) {
      return [{ top: floor }, { top: height, bottom: floor + SHOP_DOOR.height }];
    }
    return [{ top: height }];
  }
  const out: HouseSurface[] = [{ top: floor }, { top: height, bottom: ceiling }];
  for (const f of SHOP_FIXTURES) {
    if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) out.push({ top: floor + f.top });
  }
  return out;
}
