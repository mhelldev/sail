import * as THREE from 'three';
import type { Input } from '../core/input';
import { heightAt, type WaveField } from '../water/waves';
import type { Wind } from '../weather/wind';
import { depenetrate, findOpenWater, resolveMotion, type HullShape, type SignedDistanceFn } from './collision';
import { Helm } from './helm';
import { BoatModel, PROBES } from './model';
import { createSailingState, relativeWind, stepSailing, type SailingState } from './sailing';

const HULL: HullShape = { halfLength: 5, halfBeam: 1.6, clearance: 1.5 };

export class Boat {
  readonly model = new BoatModel();
  state: SailingState;
  sailUp = true;
  turbo = false;
  /** True while the hull is touching land. */
  grounded = false;
  /** Signed distance to land (positive on land); without it the boat sails anywhere. */
  landDistance?: SignedDistanceFn;
  /** World position on the water plane (y is driven by the waves). */
  readonly position = new THREE.Vector3();
  /** Steering wheel; the rudder follows it. */
  readonly helm = new Helm();
  private pitch = 0;
  private roll = 0;
  private heave = 0;

  constructor(heading = 0) {
    this.state = createSailingState(heading);
  }

  get object(): THREE.Object3D {
    return this.model.root;
  }

  /** Unit vector the bow points to, in world XZ. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const h = THREE.MathUtils.degToRad(this.state.heading);
    return out.set(Math.sin(h), 0, -Math.cos(h));
  }

  /**
   * @param touchSteer helm position held by a finger (touch screens), or null
   */
  update(dt: number, time: number, input: Input, wind: Wind, waves: WaveField, touchSteer: number | null = null): void {
    if (input.wasPressed('KeyS')) this.sailUp = !this.sailUp;
    if (input.wasPressed('KeyT')) this.turbo = !this.turbo;

    let keys = 0;
    if (input.isDown('ArrowLeft', 'KeyA')) keys -= 1;
    if (input.isDown('ArrowRight', 'KeyD')) keys += 1;
    this.helm.update(dt, keys, touchSteer);

    this.state = stepSailing(
      this.state,
      { steer: this.helm.position, sailUp: this.sailUp, turbo: this.turbo },
      wind.direction,
      wind.speed,
      dt,
    );

    const fwd = this.forward();
    const sd = this.landDistance;
    if (sd) {
      // A turn next to the shore may swing the bow or stern into it: push the hull back out.
      const { x, z } = depenetrate(this.position.x, this.position.z, this.state.heading, HULL, sd);
      this.position.x = x;
      this.position.z = z;
      const move = resolveMotion(x, z, this.state.heading, fwd.x * this.state.speed * dt, fwd.z * this.state.speed * dt, HULL, sd);
      if (move.grounded && !this.grounded && this.state.speed > 1.5) {
        // Impact: the bow rides up a little.
        this.pitch += Math.min(0.12, this.state.speed * 0.02);
      }
      this.grounded = move.grounded;
      if (move.grounded) {
        // Scraping along the shore: speed follows what the hull actually manages to move.
        const moved = Math.hypot(move.dx, move.dz) / Math.max(dt, 1e-6);
        this.state = { ...this.state, speed: Math.min(this.state.speed, moved) };
      }
      this.position.x += move.dx;
      this.position.z += move.dz;
    } else {
      this.position.addScaledVector(fwd, this.state.speed * dt);
    }

    this.followWaves(dt, time, waves, fwd);

    const root = this.model.root;
    root.position.set(this.position.x, this.heave, this.position.z);
    root.rotation.y = -THREE.MathUtils.degToRad(this.state.heading);
    this.model.tilt.rotation.set(this.pitch, 0, this.roll + THREE.MathUtils.degToRad(this.state.heel), 'ZXY');

    this.model.update(
      this.state.boom,
      relativeWind(this.state.heading, wind.direction),
      // The wheel faces aft; clockwise for the helmsman is a negative turn around +Z.
      -this.helm.wheelAngle,
      this.sailUp,
      dt,
    );
  }

  /** Moves the boat to the nearest open water if it starts on (or too close to) land. */
  placeInWater(): void {
    if (!this.landDistance) return;
    const p = findOpenWater(this.position.x, this.position.z, HULL, this.landDistance);
    this.position.set(p.x, 0, p.z);
  }

  /** Heave, pitch and roll from the water height under bow, stern and both sides. */
  private followWaves(dt: number, time: number, waves: WaveField, fwd: THREE.Vector3): void {
    const { x, z } = this.position;
    const rx = -fwd.z; // starboard direction
    const rz = fwd.x;
    const bow = heightAt(waves, x + fwd.x * -PROBES.bow, z + fwd.z * -PROBES.bow, time);
    const stern = heightAt(waves, x - fwd.x * PROBES.stern, z - fwd.z * PROBES.stern, time);
    const port = heightAt(waves, x - rx * PROBES.beam, z - rz * PROBES.beam, time);
    const stbd = heightAt(waves, x + rx * PROBES.beam, z + rz * PROBES.beam, time);

    const targetHeave = (bow + stern + port + stbd) / 4;
    const targetPitch = Math.atan2(bow - stern, PROBES.stern - PROBES.bow);
    // Positive roll lowers the port side, so a higher starboard side gives positive roll.
    const targetRoll = Math.atan2(stbd - port, PROBES.beam * 2);

    // A little damping so the hull feels heavy rather than glued to the surface.
    const k = 1 - Math.exp(-6 * dt);
    this.heave += (targetHeave - this.heave) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
  }
}
