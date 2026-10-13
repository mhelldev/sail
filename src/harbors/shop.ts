// The village supermarket next to the marina house: a single-storey shop you can walk into, with
// fruit and vegetables, a bread rack, water bottles, shelves of groceries and a checkout. Pure layout
// in the shop's own frame, like the marina house: origin at the centre of the footprint at its base,
// +Z = front (towards the sea). The model (shopModel.ts) and the walking physics both use this.

import type { ProductId } from '../economy/economy';
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

// ---- What can be bought, and where ------------------------------------------------------------------

/** What fills the fruit crates (front tier = lower row by the aisle), see `crate` in shopModel.ts. */
export const FRUIT_FILLS = {
  front: [0, 2, 4, 8, 1, 5, 7, 6], // red apples, oranges, pears, bananas, green apples, tomatoes, plums, potatoes
  back: [3, 9, 5, 6, 0, 2, 7, 3], // lemons, melons, …
};
const FRONT_PRODUCTS: Array<ProductId | undefined> = ['apple', 'orange', 'pear', 'banana', 'apple'];

/** The back shelf's board at eye level starts with milk, then orange juice. */
export const DRINK_SHELF = { level: 0.95, milk: [0.06, 0.66], juice: [0.68, 1.28] };
export const BREAD_BOARDS = [0.25, 0.65, 1.05, 1.45];

export interface Display {
  product: ProductId;
  /** click box, shop coordinates (y from the base, like the model) */
  box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  /** the price tag: centre and the direction it faces (rotation around Y of a plane facing +Z) */
  tag: { x: number; y: number; z: number; rotY: number };
}

function displays(): Display[] {
  const F = SHOP.floor;
  const fx = (name: Fixture['name']) => SHOP_FIXTURES.find((f) => f.name === name)!;
  const out: Display[] = [];
  // Fruit: price tags on the front of the stand, under each crate of the lower row.
  const fruit = fx('fruit');
  const n = Math.floor((fruit.z1 - fruit.z0) / 0.5);
  const cw = (fruit.z1 - fruit.z0) / n;
  FRONT_PRODUCTS.forEach((product, i) => {
    if (!product) return;
    const z = fruit.z0 + cw * (i + 0.5);
    out.push({
      product,
      box: { x0: fruit.x1 - 0.5, x1: fruit.x1 + 0.02, y0: F + 0.6, y1: F + 0.98, z0: z - cw / 2 + 0.01, z1: z + cw / 2 - 0.01 },
      tag: { x: fruit.x1 + 0.004, y: F + 0.5, z, rotY: Math.PI / 2 },
    });
  });
  // Bread and rolls: tags on the lips of two rack boards.
  const bread = fx('bread');
  for (const [product, y] of [['bread', BREAD_BOARDS[1]], ['rolls', BREAD_BOARDS[2]]] as const) {
    out.push({
      product,
      box: { x0: bread.x0 - 0.02, x1: bread.x1, y0: F + y - 0.05, y1: F + y + 0.22, z0: bread.z0, z1: bread.z1 },
      tag: { x: bread.x0 - 0.012, y: F + y - 0.1, z: (bread.z0 + bread.z1) / 2, rotY: -Math.PI / 2 },
    });
  }
  // Water: the pallet, tag on the front of the stack.
  const water = fx('water');
  out.push({
    product: 'water',
    box: { x0: water.x0, x1: water.x1, y0: F, y1: F + water.top + 0.05, z0: water.z0, z1: water.z1 + 0.02 },
    tag: { x: (water.x0 + water.x1) / 2, y: F + 0.25, z: water.z1 + 0.004, rotY: 0 },
  });
  // Milk and juice: the back shelf at eye level, tags on its price rail.
  const back = fx('shelvesBack');
  for (const product of ['milk', 'juice'] as const) {
    const [a, b] = DRINK_SHELF[product];
    out.push({
      product,
      box: { x0: back.x0 + a, x1: back.x0 + b, y0: F + DRINK_SHELF.level, y1: F + DRINK_SHELF.level + 0.25, z0: back.z0, z1: back.z1 + 0.02 },
      tag: { x: back.x0 + (a + b) / 2, y: F + DRINK_SHELF.level - 0.04, z: back.z1 + 0.004, rotY: 0 },
    });
  }
  // Chocolate: the sweets rack on the front of the checkout, tag below it.
  const till = fx('checkout');
  out.push({
    product: 'chocolate',
    box: { x0: till.x0, x1: till.x1, y0: F + 0.15, y1: F + 0.85, z0: till.z0 - 0.12, z1: till.z0 },
    tag: { x: (till.x0 + till.x1) / 2, y: F + 0.1, z: till.z0 - 0.09, rotY: Math.PI },
  });
  return out;
}

export const SHOP_DISPLAYS: Display[] = displays();
