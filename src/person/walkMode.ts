// Walking in first person (scroll out for a view from behind): on the boat, on piers and land,
// or swimming. The boat keeps sailing its course. Arrow keys / WASD walk, Shift runs, Space jumps,
// the mouse looks around.

import * as THREE from 'three';
import type { Boat } from '../boat/boat';
import { deckHeightAt } from '../boat/model';
import type { Input } from '../core/input';
import type { HarborRenderer } from '../harbors/harborRenderer';
import type { TerrainManager } from '../terrain/terrainManager';
import { heightAt, type WaveField } from '../water/waves';
import { PersonController, type Surface, type WalkWorld } from './personController';
import { PersonModel } from './personModel';

const EYE = 1.55; // camera looks at the head
const SPAWN = { x: 0.3, z: 4.3 }; // behind the wheel, in the boat's frame

export class WalkMode {
  active = false;
  readonly person = new PersonController();
  readonly model = new PersonModel();

  private yaw = 0; // camera yaw, compass-style: looks along (sin, -cos)
  private pitch = 0; // positive = looking down
  /** 0 = first person (default); scrolling out shows the person from behind */
  private distance = 0;
  private dragging = false;
  private time = 0;
  private readonly prevBoat = new THREE.Matrix4();
  private readonly boatInverse = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private prevHeading = 0;
  private readonly world: WalkWorld;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly boat: Boat,
    private readonly waves: WaveField,
    terrain: TerrainManager,
    harbors: HarborRenderer,
  ) {
    const tilt = boat.model.tilt;
    this.world = {
      waterLevel: (x, z) => heightAt(this.waves, x, z, this.time),
      surfacesAt: (x, z) => {
        const out: Surface[] = [];
        const ground = terrain.heightAt(x, z);
        if (ground !== undefined) out.push({ top: ground, boat: false });
        for (const top of harbors.surfacesAt(x, z)) out.push({ top, boat: false });
        // The boat's deck and cabin roof, wherever the boat currently is.
        this.v.set(x, tilt.matrixWorld.elements[13] + 1, z).applyMatrix4(this.boatInverse);
        const deck = deckHeightAt(this.v.x, this.v.z);
        if (deck !== undefined) out.push({ top: this.v.set(this.v.x, deck, this.v.z).applyMatrix4(tilt.matrixWorld).y, boat: true });
        return out;
      },
    };

    // Mouse look: pointer lock after a click (Esc releases it), dragging works too.
    dom.addEventListener('click', () => {
      if (this.active && document.pointerLockElement !== dom) dom.requestPointerLock?.();
    });
    dom.addEventListener('pointerdown', (e) => {
      if (this.active && e.pointerType === 'mouse') this.dragging = true;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    document.addEventListener('mousemove', (e) => {
      if (!this.active || (document.pointerLockElement !== dom && !this.dragging)) return;
      this.yaw += e.movementX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.0025, -1.4, 1.4);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        // Scrolling out from first person switches to a view from behind; scrolling in returns.
        if (this.distance === 0) {
          if (e.deltaY > 0) this.distance = 2.5;
        } else {
          this.distance *= Math.exp(e.deltaY * 0.001);
          if (this.distance < 2) this.distance = 0;
          this.distance = Math.min(this.distance, 14);
        }
      },
      { passive: true },
    );
  }

  /** Puts the person behind the wheel and starts walking. */
  enter(): void {
    this.active = true;
    const tilt = this.boat.model.tilt;
    tilt.updateWorldMatrix(true, false);
    const deck = deckHeightAt(SPAWN.x, SPAWN.z)!;
    this.v.set(SPAWN.x, deck, SPAWN.z).applyMatrix4(tilt.matrixWorld);
    this.person.place(this.v.x, this.v.y, this.v.z, true);
    // Face forward like the helmsman, camera behind.
    const h = THREE.MathUtils.degToRad(this.boat.state.heading);
    this.person.facing = Math.atan2(Math.sin(h), -Math.cos(h));
    this.yaw = h;
    this.pitch = 0;
    this.distance = 0;
    this.prevBoat.copy(tilt.matrixWorld);
    this.prevHeading = this.boat.state.heading;
  }

  exit(): void {
    this.active = false;
    this.model.root.visible = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  update(dt: number, time: number, input: Input): void {
    if (!this.active) return;
    this.time = time;
    const tilt = this.boat.model.tilt;
    tilt.updateWorldMatrix(true, false);
    this.boatInverse.copy(tilt.matrixWorld).invert();

    // Standing on (or jumping off) the boat: move and turn with it.
    const p = this.person;
    if (p.onBoat && p.mode !== 'swim') {
      this.v.set(p.x, p.y, p.z).applyMatrix4(this.m.copy(this.prevBoat).invert()).applyMatrix4(tilt.matrixWorld);
      p.x = this.v.x;
      p.y = this.v.y;
      p.z = this.v.z;
      const turn = THREE.MathUtils.degToRad(this.boat.state.heading - this.prevHeading);
      p.facing -= turn;
      this.yaw += turn; // the view turns with the boat
    }
    this.prevBoat.copy(tilt.matrixWorld);
    this.prevHeading = this.boat.state.heading;

    const forward = (input.isDown('ArrowUp', 'KeyW') ? 1 : 0) - (input.isDown('ArrowDown', 'KeyS') ? 1 : 0);
    const right = (input.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (input.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
    // In first person you face where you look (that's also where you climb out of the water).
    if (this.distance === 0) p.facing = Math.atan2(Math.sin(this.yaw), -Math.cos(this.yaw));
    p.step(dt, { forward, right, jump: input.wasPressed('Space'), run: input.isDown('ShiftLeft', 'ShiftRight') }, this.yaw, this.world);
    this.model.update(dt, p.x, p.y, p.z, p.facing, p.speed, p.mode);

    // Eyes: at head height, or just above the surface while swimming.
    const eyeY = p.mode === 'swim' ? this.world.waterLevel(p.x, p.z) + 0.25 : p.y + EYE;
    const eye = this.head.set(p.x, eyeY, p.z);
    const dirX = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirY = -Math.sin(this.pitch);
    const dirZ = -Math.cos(this.yaw) * Math.cos(this.pitch);
    this.camera.up.set(0, 1, 0);
    if (this.distance === 0) {
      // First person: look out of the person's eyes; the body itself stays hidden.
      this.model.root.visible = false;
      this.camera.position.copy(eye);
      this.camera.lookAt(eye.x + dirX, eye.y + dirY, eye.z + dirZ);
      return;
    }
    // Scrolled out: behind and above the person, never under the water or the ground.
    this.model.root.visible = true;
    let cx = eye.x - dirX * this.distance;
    let cz = eye.z - dirZ * this.distance;
    let cy = eye.y - dirY * this.distance;
    cy = Math.max(cy, this.world.waterLevel(cx, cz) + 0.5);
    const groundUnderCamera = this.world.surfacesAt(cx, cz).reduce((m, s) => Math.max(m, s.top), -Infinity);
    cy = Math.max(cy, groundUnderCamera + 0.5);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(eye);
  }

  private readonly m = new THREE.Matrix4();
  /** own vector: `v` is reused by the surface queries */
  private readonly head = new THREE.Vector3();
}
