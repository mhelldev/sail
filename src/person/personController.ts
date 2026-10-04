// A person walking around in third person: on the boat's deck, on piers and land, or
// swimming. Pure: the world is only asked "what can I stand on here?" and "where is the water?".

export interface Surface {
  /** top height in metres (world Y) */
  top: number;
  /** belongs to the player's boat (a moving platform) */
  boat: boolean;
}

export interface WalkWorld {
  /** Everything at a point that can be stood on or bumped into, by its top height. */
  surfacesAt(x: number, z: number): Surface[];
  waterLevel(x: number, z: number): number;
}

export interface WalkInput {
  /** -1 … 1, away from the camera */
  forward: number;
  /** -1 … 1, to the camera's right */
  right: number;
  jump: boolean;
  run: boolean;
}

export type PersonMode = 'ground' | 'air' | 'swim';

export const PERSON = {
  walk: 2.0, // m/s
  run: 4.6,
  swim: 1.1,
  jump: 5.6, // take-off speed, ~0.85 m high
  gravity: 18,
  step: 0.4, // highest ledge you can walk up without jumping
  maxSlope: 1.1, // rise per metre you can still walk up
  swimDepth: 1.3, // feet below the surface while swimming
  climbReach: 2.4, // how high above the water you can pull yourself up
};

export class PersonController {
  x = 0;
  y = 0;
  z = 0;
  vy = 0;
  /** direction the person faces: forward = (sin facing, cos facing) in world X/Z */
  facing = 0;
  mode: PersonMode = 'ground';
  /** standing on (or jumped off) the boat: carried along with it */
  onBoat = false;
  /** horizontal speed this frame, for the walk animation */
  speed = 0;
  /** true for the frame the person drops into the water */
  splashed = false;

  place(x: number, y: number, z: number, onBoat: boolean): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vy = 0;
    this.mode = 'ground';
    this.onBoat = onBoat;
  }

  /**
   * @param cameraYaw compass-style yaw of the camera: it looks along (sin yaw, -cos yaw)
   */
  step(dt: number, input: WalkInput, cameraYaw: number, world: WalkWorld): void {
    this.splashed = false;
    const swimming = this.mode === 'swim';

    // Move relative to the camera; turn to face the way we're going.
    const fx = Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    let dx = fx * input.forward + -fz * input.right;
    let dz = fz * input.forward + fx * input.right;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    const speed = swimming ? PERSON.swim : input.run ? PERSON.run : PERSON.walk;
    if (len > 0.01) {
      const target = Math.atan2(dx, dz);
      const diff = Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing));
      this.facing += diff * Math.min(1, dt * 12);
    }
    const startX = this.x;
    const startZ = this.z;
    this.tryMove(this.x + dx * speed * dt, this.z, world);
    this.tryMove(this.x, this.z + dz * speed * dt, world);
    this.speed = Math.hypot(this.x - startX, this.z - startZ) / Math.max(dt, 1e-6);

    const water = world.waterLevel(this.x, this.z);
    const support = this.ground(this.x, this.z, world);
    const ground = support?.top ?? -Infinity;

    if (swimming) {
      this.y = water - PERSON.swimDepth;
      this.vy = 0;
      if (ground >= this.y - 0.05) {
        // Shallow enough to stand (a beach): walk out of the water.
        this.mode = 'ground';
        this.y = ground;
        this.onBoat = support!.boat;
      } else if (input.jump) {
        this.climb(water, world);
      }
      return;
    }

    if (this.mode === 'ground' && input.jump) {
      this.vy = PERSON.jump;
      this.mode = 'air';
    }
    this.vy -= PERSON.gravity * dt;
    this.y += this.vy * dt;

    if (support && this.y <= ground + (this.mode === 'ground' ? PERSON.step : 0)) {
      // Landed, or still walking on it (following slopes and the moving deck downwards).
      this.y = ground;
      this.vy = 0;
      this.mode = 'ground';
      this.onBoat = support.boat;
    } else if (this.mode === 'ground') {
      this.mode = 'air'; // walked off an edge
    }

    if (this.mode === 'air' && this.y < water - PERSON.swimDepth * 0.5 && ground < water - 0.5) {
      this.mode = 'swim';
      this.onBoat = false;
      this.vy = 0;
      this.splashed = true;
    }
  }

  /** Highest surface you can stand on at (x, z) from the current height. */
  private ground(x: number, z: number, world: WalkWorld): Surface | undefined {
    let best: Surface | undefined;
    for (const s of world.surfacesAt(x, z)) {
      if (s.top <= this.y + PERSON.step + 1e-6 && (!best || s.top > best.top)) best = s;
    }
    return best;
  }

  /** Moves unless something too high (a wall, a too steep slope) is in the way. */
  private tryMove(nx: number, nz: number, world: WalkWorld): void {
    const dist = Math.hypot(nx - this.x, nz - this.z);
    if (dist === 0) return;
    for (const s of world.surfacesAt(nx, nz)) {
      const rise = s.top - this.y;
      if (rise <= 0) continue;
      if (rise > PERSON.step) return; // wall, hull side, house…
      if (this.mode === 'ground' && rise > PERSON.maxSlope * dist && rise > 0.05) return; // too steep
    }
    this.x = nx;
    this.z = nz;
  }

  /** Pulls the swimmer up onto a pier, pontoon, boat or rocks right in front of them. */
  private climb(water: number, world: WalkWorld): void {
    const ax = this.x + Math.sin(this.facing) * 0.9;
    const az = this.z + Math.cos(this.facing) * 0.9;
    let best: Surface | undefined;
    for (const s of world.surfacesAt(ax, az)) {
      if (s.top > water - 0.2 && s.top <= water + PERSON.climbReach && (!best || s.top > best.top)) best = s;
    }
    if (!best) return;
    this.x = ax;
    this.z = az;
    this.y = best.top;
    this.vy = 0;
    this.mode = 'ground';
    this.onBoat = best.boat;
  }
}
