// The marina house: a single-storey harbour office you can walk into, a little gallery inside —
// photos of the place on the walls and a poster about it. Pure layout in the house's own frame:
// origin at the centre of the footprint at its base (`MarinaHouseSite.y`), +Z = front (towards
// the sea), +X = to your right as you walk in through the door. The model
// (marinaHouseModel.ts) and the walking physics both use this, so change them together here.

/** Outer size (metres), walls, floor and ceiling heights above the base. */
export const MARINA_HOUSE = {
  width: 11,
  depth: 8,
  height: 6.5, // eaves: the roof sits on top
  wall: 0.25,
  floor: 0.32, // the base is sunk 0.3 m into the ground: the floor is level with it (steps > 5 cm need a jump)
  ceiling: 3.9,
  color: 0xf3f1ea,
};

/** The front door, in the middle of the front wall; it swings inwards, hinged on its left (−X) side. */
export const HOUSE_DOOR = { halfWidth: 0.6, height: 2.3 };

/** Gallery bench in the middle of the room, facing the back wall. */
export const GALLERY_BENCH = { halfWidth: 1.1, halfDepth: 0.25, z: 0.6, top: 0.45 };

/**
 * Stone steps up to the door: a landing level with the floor, then stairs down. The rendered terrain
 * near the shore can be a metre or more below the house's base; where it is higher, it wins.
 * For walking they are a ramp along the step nosings (the walker can't climb > 5 cm ledges).
 */
export const HOUSE_STEPS = { halfWidth: 1.3, landing: 1.1, rise: 0.18, run: 0.3, count: 15 };

/** Name board over the door, outside. */
export const HOUSE_SIGN = { width: 4.4, height: 0.8, centreY: MARINA_HOUSE.floor + 2.95 };

export interface HouseSurface {
  top: number;
  /** underside of something you can walk below (ceiling, door lintel) */
  bottom?: number;
}

const HALF_W = MARINA_HOUSE.width / 2;
const HALF_D = MARINA_HOUSE.depth / 2;
const T = MARINA_HOUSE.wall;

/** Inside the footprint the house has its own floor: the terrain there is ignored. */
export function marinaHouseCoversGround(x: number, z: number): boolean {
  return Math.abs(x) <= HALF_W && Math.abs(z) <= HALF_D;
}

/** What can be stood on or bumped into at house-local (x, z): walls, floor, ceiling, bench, steps. */
export function marinaHouseSurfaces(x: number, z: number, doorOpen: boolean): HouseSurface[] {
  const { floor, ceiling, height } = MARINA_HOUSE;
  const ax = Math.abs(x);
  if (z > HALF_D && ax <= HOUSE_STEPS.halfWidth) {
    const s = HOUSE_STEPS;
    const t = z - HALF_D - s.landing; // along the stairs
    if (t > s.count * s.run) return [];
    return [{ top: floor - (Math.max(0, t) * s.rise) / s.run }];
  }
  if (ax > HALF_W || Math.abs(z) > HALF_D) return [];
  const inFrontWall = z > HALF_D - T;
  const inWall = ax > HALF_W - T || z < -HALF_D + T || inFrontWall;
  if (inWall) {
    if (inFrontWall && ax <= HOUSE_DOOR.halfWidth && doorOpen && z <= HALF_D + 1e-9) {
      return [{ top: floor }, { top: height, bottom: floor + HOUSE_DOOR.height }];
    }
    return [{ top: height }];
  }
  const out: HouseSurface[] = [{ top: floor }, { top: height, bottom: ceiling }];
  if (ax <= GALLERY_BENCH.halfWidth && Math.abs(z - GALLERY_BENCH.z) <= GALLERY_BENCH.halfDepth) {
    out.push({ top: floor + GALLERY_BENCH.top });
  }
  return out;
}

/** A place on an inside wall for a framed photo or the poster. */
export interface WallSlot {
  kind: 'photo' | 'poster';
  /** centre of the wall face, house-local */
  x: number;
  y: number;
  z: number;
  /** rotation around Y that turns local +Z into the wall's inward normal */
  rotY: number;
  /** largest picture that fits (metres) */
  maxWidth: number;
  maxHeight: number;
}

const EYE = MARINA_HOUSE.floor + 1.65;
const back = (x: number): WallSlot => ({ kind: 'photo', x, y: EYE, z: -HALF_D + T, rotY: 0, maxWidth: 2.3, maxHeight: 1.6 });
const left = (z: number): WallSlot => ({ kind: 'photo', x: -HALF_W + T, y: EYE, z, rotY: Math.PI / 2, maxWidth: 2.2, maxHeight: 1.5 });
const right = (z: number, kind: WallSlot['kind'] = 'photo'): WallSlot =>
  kind === 'poster'
    ? { kind, x: HALF_W - T, y: MARINA_HOUSE.floor + 1.6, z, rotY: -Math.PI / 2, maxWidth: 1.35, maxHeight: 1.9 }
    : { kind, x: HALF_W - T, y: EYE, z, rotY: -Math.PI / 2, maxWidth: 2.2, maxHeight: 1.5 };

/** Six photos (back wall first: that's what you see coming in), and the poster on the right wall. */
export const WALL_SLOTS: WallSlot[] = [back(0), back(-3.5), back(3.5), left(-1.6), left(1.9), right(-1.6), right(1.9, 'poster')];

/** Framed size for a photo with the given height/width ratio in a slot. */
export function fitPicture(slot: WallSlot, aspect: number): { width: number; height: number } {
  let width = slot.maxWidth;
  let height = width * aspect;
  if (height > slot.maxHeight) {
    height = slot.maxHeight;
    width = height / aspect;
  }
  return { width, height };
}
