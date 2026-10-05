// Layout of the player's yacht, a ~12 m cruiser for a small crew: hull lines, deckhouse with a
// cabin below, a lowered cockpit with benches around the wheel, a companionway (door + sliding
// hatch) with three steps down, and a railing around the deck. Pure (no three.js): the 3D model
// and the walking physics both read it, so what you see is what you can stand on.
// Boat frame: forward = -Z, starboard = +X, up = +Y, waterline at y = 0.

export const LENGTH = 12;
export const HALF_BEAM = 2.1;

/** Hull half width at the deck edge; t = 0 at the bow, 1 at the stern. */
export const halfWidth = (t: number): number =>
  t < 0.55
    ? HALF_BEAM * Math.pow(Math.sin(((t / 0.55) * Math.PI) / 2), 0.75)
    : HALF_BEAM * (1 - 0.25 * ((t - 0.55) / 0.45) ** 2);
/** Deck height, with a little sheer towards the bow. */
export const deckY = (t: number): number => 1.25 + 0.3 * (1 - t) ** 2;
export const keelY = (t: number): number => {
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  if (t < 0.3) {
    const k = Math.min(1, Math.max(0, t / 0.3));
    return lerp(deckY(0) * 0.4, -0.8, k * k * (3 - 2 * k));
  }
  if (t > 0.75) return lerp(-0.8, -0.35, (t - 0.75) / 0.25);
  return -0.8;
};
export const stationZ = (t: number): number => -LENGTH / 2 + LENGTH * t;
export const stationT = (z: number): number => (z + LENGTH / 2) / LENGTH;

/** Deckhouse and the cabin under it. */
export const CABIN = { halfWidth: 1.3, front: -2.9, back: 1.3, floor: 0.1, roofBottom: 2.02, roofTop: 2.1 };
/** Windows in the deckhouse: along each side (z range), and two in the front wall (x range). */
export const SIDE_WINDOW = { z0: -2.45, z1: -0.45, y0: 1.5, y1: 1.88 };
export const FRONT_WINDOWS = [
  { x0: -1.0, x1: -0.4, y0: 1.6, y1: 1.88 },
  { x0: 0.4, x1: 1.0, y0: 1.6, y1: 1.88 },
];
/** Companionway: a door in the deckhouse's aft wall plus a sliding roof hatch above the steps. */
export const DOOR = { halfWidth: 0.4, hatchFront: 0.3, height: CABIN.roofTop - 0.75 };
/** Three steps down from the cockpit into the cabin (z ranges, going forward). */
export const STAIRS = [
  { z0: 1.0, z1: 1.3, top: 0.6 },
  { z0: 0.7, z1: 1.0, top: 0.45 },
  { z0: 0.4, z1: 0.7, top: 0.3 },
];
/** Settees along both sides of the saloon table. */
export const SETTEE = { inner: 0.75, outer: CABIN.halfWidth, z0: -2.7, z1: -0.3, top: 0.5 };
export const TABLE = { halfWidth: 0.35, z0: -2.3, z1: -0.9, top: 0.85 };

/** The cockpit well behind the deckhouse, lower than the deck. */
export const COCKPIT = { halfWidth: 1.15, front: CABIN.back, back: 5.6, floor: 0.75 };
export const BENCH = { inner: 0.7, outer: COCKPIT.halfWidth, z0: 1.5, z1: 3.4, top: 1.15 };
/** Steering wheel: faces aft, spins around an axle along Z. */
export const HELM = { z: 4.0, y: 1.55, radius: 0.5 };
/** Where the helmsman stands. */
export const HELM_STAND = { x: 0, z: COCKPIT.back - 0.3 }; // as far back as the body radius allows

/** Instrument panel on the deckhouse's aft wall, starboard of the door. */
export const PANEL = { x: 0.85, y: 1.72, width: 0.8, height: 0.56, z: CABIN.back + 0.065 };

export const MAST_Z = -3.4;
export const MAST_TOP = 15;
/** Railing: stanchions along the deck edge, open at the stern for boarding. */
export const RAIL = { height: 0.65, inset: 0.06, band: 0.15, gateHalfWidth: 0.45 };

export interface BoatSurface {
  top: number;
  /** underside of a roof or slab you can stand below; undefined = solid down to the hull */
  bottom?: number;
}

const inZ = (z: number, z0: number, z1: number) => z >= z0 && z < z1;

/**
 * Everything at (x, z) of the boat that can be stood on or bumped into. Empty outside the hull.
 * @param doorOpen companionway open: no door leaf and no hatch over the steps
 */
export function boatSurfaces(x: number, z: number, doorOpen: boolean): BoatSurface[] {
  const t = stationT(z);
  if (t < 0 || t > 1) return [];
  const w = halfWidth(t);
  const ax = Math.abs(x);
  if (ax > w) return [];
  const out: BoatSurface[] = [];

  if (ax <= CABIN.halfWidth && inZ(z, CABIN.front, CABIN.back)) {
    const companionway = ax <= DOOR.halfWidth && z >= DOOR.hatchFront;
    const step = companionway ? STAIRS.find((s) => inZ(z, s.z0, s.z1)) : undefined;
    out.push({ top: step ? step.top : CABIN.floor });
    if (!companionway || !doorOpen) out.push({ top: CABIN.roofTop, bottom: CABIN.roofBottom });
    if (ax >= SETTEE.inner && inZ(z, SETTEE.z0, SETTEE.z1)) out.push({ top: SETTEE.top });
    if (ax <= TABLE.halfWidth && inZ(z, TABLE.z0, TABLE.z1)) out.push({ top: TABLE.top });
    return out;
  }

  if (ax <= COCKPIT.halfWidth && inZ(z, COCKPIT.front, COCKPIT.back)) {
    const bench = ax >= BENCH.inner && inZ(z, BENCH.z0, BENCH.z1);
    out.push({ top: bench ? BENCH.top : COCKPIT.floor });
    // The closed door, and the wheel with its pedestal.
    if (!doorOpen && ax <= DOOR.halfWidth && z < COCKPIT.front + 0.08) out.push({ top: CABIN.roofTop });
    if (ax <= HELM.radius + 0.05 && inZ(z, HELM.z - 0.12, HELM.z + 0.1)) out.push({ top: HELM.y + HELM.radius });
    return out;
  }

  const deck = deckY(t);
  out.push({ top: deck });
  if (ax <= 0.12 && Math.abs(z - MAST_Z) <= 0.12) out.push({ top: MAST_TOP });
  // Railing along the deck edge and across the stern (with a gate in the middle).
  const atEdge = ax >= w - RAIL.band;
  const atStern = z >= LENGTH / 2 - RAIL.band && ax >= RAIL.gateHalfWidth;
  if (atEdge || atStern) out.push({ top: deck + RAIL.height });
  return out;
}
