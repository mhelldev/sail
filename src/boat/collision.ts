// Keeps the hull in the water. Pure: land is described only by a signed distance
// function (positive on land), so this is testable without the real coastline.

export type SignedDistanceFn = (x: number, z: number) => number;

export interface HullShape {
  /** distance from the centre to the bow / stern probes in metres */
  halfLength: number;
  /** distance from the centre to the side probes in metres */
  halfBeam: number;
  /** water the hull needs between itself and the shoreline, in metres */
  clearance: number;
}

export interface MotionResult {
  dx: number;
  dz: number;
  /** true when the hull touched land this step */
  grounded: boolean;
}

/** Signed distance of the hull: the worst (most landward) probe. */
export function hullDistance(
  x: number,
  z: number,
  headingDeg: number,
  hull: HullShape,
  sd: SignedDistanceFn,
): { value: number; px: number; pz: number } {
  const h = (headingDeg * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const probes: Array<[number, number]> = [
    [x + fx * hull.halfLength, z + fz * hull.halfLength], // bow
    [x - fx * hull.halfLength, z - fz * hull.halfLength], // stern
    [x - fz * hull.halfBeam, z + fx * hull.halfBeam], // starboard
    [x + fz * hull.halfBeam, z - fx * hull.halfBeam], // port
  ];
  let worst = { value: -Infinity, px: x, pz: z };
  for (const [px, pz] of probes) {
    const v = sd(px, pz);
    if (v > worst.value) worst = { value: v, px, pz };
  }
  return worst;
}

/**
 * Takes the motion the boat wants to make this step and returns what it may make.
 * Moving into land is blocked; the part of the motion along the shore is kept so the
 * boat slides along the coast instead of sticking to it. Moving away from land is
 * always allowed, so a grounded boat can turn and sail off.
 */
export function resolveMotion(
  x: number,
  z: number,
  headingDeg: number,
  dx: number,
  dz: number,
  hull: HullShape,
  sd: SignedDistanceFn,
): MotionResult {
  const limit = -hull.clearance;
  const now = hullDistance(x, z, headingDeg, hull, sd).value;
  const next = hullDistance(x + dx, z + dz, headingDeg, hull, sd);
  if (next.value <= limit) return { dx, dz, grounded: false };
  // Already touching but this step backs away from the shore: allow it.
  if (next.value < now) return { dx, dz, grounded: true };

  // Direction towards land at the offending probe (gradient of the distance field).
  const [gx, gz] = landward(next.px, next.pz, sd);
  if (gx !== 0 || gz !== 0) {
    const into = dx * gx + dz * gz;
    if (into > 0) {
      const sx = dx - gx * into;
      const sz = dz - gz * into;
      const slid = hullDistance(x + sx, z + sz, headingDeg, hull, sd).value;
      if (slid <= Math.max(limit, now)) return { dx: sx, dz: sz, grounded: true };
    }
  }
  return { dx: 0, dz: 0, grounded: true };
}

/** Direction of steepest increase of the distance field (i.e. towards land), normalized. */
function landward(px: number, pz: number, sd: SignedDistanceFn): [number, number] {
  const e = 5;
  const gx = sd(px + e, pz) - sd(px - e, pz);
  const gz = sd(px, pz + e) - sd(px, pz - e);
  const len = Math.hypot(gx, gz);
  return len > 1e-6 ? [gx / len, gz / len] : [0, 0];
}

/**
 * Pushes the hull out of the shore if it overlaps the clearance zone, e.g. after the
 * boat turned on the spot next to land. Returns the corrected centre position.
 */
export function depenetrate(
  x: number,
  z: number,
  headingDeg: number,
  hull: HullShape,
  sd: SignedDistanceFn,
): { x: number; z: number } {
  for (let i = 0; i < 4; i++) {
    const worst = hullDistance(x, z, headingDeg, hull, sd);
    const overlap = worst.value + hull.clearance;
    if (overlap <= 1e-3) break;
    const [gx, gz] = landward(worst.px, worst.pz, sd);
    if (gx === 0 && gz === 0) break;
    x -= gx * (overlap + 0.01);
    z -= gz * (overlap + 0.01);
  }
  return { x, z };
}

/** Nearest point at least `clearance` metres from land, searching outwards in rings. */
export function findOpenWater(
  x: number,
  z: number,
  hull: HullShape,
  sd: SignedDistanceFn,
  maxRadius = 20000,
): { x: number; z: number } {
  const ok = (px: number, pz: number) => hullDistance(px, pz, 0, hull, sd).value <= -hull.clearance * 4;
  if (ok(x, z)) return { x, z };
  for (let r = 50; r <= maxRadius; r += 50) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / 50));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}
