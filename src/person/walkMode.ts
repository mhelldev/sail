// The player in first person: on the boat (deck, cockpit, down in the cabin), on piers and land,
// or swimming. The boat keeps sailing its course. Arrow keys / WASD walk, Shift runs, Space jumps,
// moving the mouse looks around, the right button zooms. Near the helm the wheel can be grabbed
// (click or touch) and turned by dragging; the door and the chart plotter react to a click.

import * as THREE from 'three';
import type { Boat } from '../boat/boat';
import { WHEEL_LOCK } from '../boat/helm';
import { boatSurfaces, HELM_STAND } from '../boat/layout';
import type { Input } from '../core/input';
import type { HarborRenderer } from '../harbors/harborRenderer';
import type { TerrainManager } from '../terrain/terrainManager';
import { heightAt, type WaveField } from '../water/waves';
import { PersonController, type Surface, type WalkWorld } from './personController';

const EYE = 1.55;
const LOOK = 0.0025; // radians per pixel of mouse movement
const TOUCH_LOOK = 0.005; // radians per pixel of finger movement
const EDGE = 0.04; // outer part of the screen (fraction of its width) that keeps turning the view
const EDGE_TURN = 1.4; // radians per second at the very edge
const REACH = 2.6; // how far away the wheel can be grabbed (from the eyes)
const CLICK_REACH = 3.8; // door, chart plotter
const FOV = 55;
const ZOOM_FOV = 20;
const GRAB_RADIUS = 0.6; // a little beyond the rim, so it's easy to hit
// The hand on the wheel moves faster than the mouse: ¾ turn each way would otherwise need very
// long drags (a finger on a touch screen holds the rim directly).
const MOUSE_HAND = 2.5;
const JOYSTICK = 60; // px of finger travel for full walking speed

/** Something on the boat that reacts to a click or tap. */
export interface Clickable {
  object: THREE.Object3D;
  onClick: () => void;
}

export class WalkMode {
  /** door, chart plotter… (the wheel is handled separately: it's dragged) */
  readonly clickables: Clickable[] = [];
  readonly person = new PersonController();
  /** helm position while the wheel is held by hand, otherwise null */
  steer: number | null = null;
  /** the wheel (or something clickable) is under the crosshair and within reach */
  canGrab = false;

  private yaw = 0; // compass-style: looks along (sin, -cos)
  private pitch = 0; // positive = looking down
  private time = 0;
  private mouseX = -1; // last cursor position (px), -1 while outside the window
  private zoom = false; // right mouse button held
  private readonly prevBoat = new THREE.Matrix4();
  private readonly boatInverse = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  /** own vector: `v` is reused by the surface queries */
  private readonly head = new THREE.Vector3();
  private prevHeading = 0;
  private readonly world: WalkWorld;

  // Wheel grab: the hand (crosshair or finger) as a screen point, the rim angle it holds and
  // the helm position at that moment.
  private grab: { pointer: number | 'mouse'; ndc: THREE.Vector2; angle: number; turned: number; helm: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  // Touch: a finger on the left half walks (virtual joystick), one on the right half looks.
  private joystick: { pointer: number; x: number; y: number; forward: number; right: number } | null = null;
  private lookFinger: { pointer: number; x: number; y: number } | null = null;

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
        // The boat: deck, cockpit, cabin (floor, steps, roof overhead), railing — wherever it is.
        this.v.set(x, this.person.y + 1, z).applyMatrix4(this.boatInverse);
        const [lx, lz] = [this.v.x, this.v.z];
        const m = tilt.matrixWorld;
        for (const s of boatSurfaces(lx, lz, boat.model.companionwayOpen)) {
          const top = this.v.set(lx, s.top, lz).applyMatrix4(m).y;
          const bottom = s.bottom === undefined ? undefined : this.v.set(lx, s.bottom, lz).applyMatrix4(m).y;
          out.push({ top, bottom, boat: true });
        }
        return out;
      },
    };

    // Mouse: moving it looks around right away. The first click also locks the pointer (browsers
    // only allow that after a click), so the view can then turn without ever hitting the screen
    // edge; Esc releases it. Clicking with the wheel under the crosshair grabs it.
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      if (this.grab?.pointer === 'mouse') {
        this.grab.ndc.x += (e.movementX / window.innerWidth) * 2 * MOUSE_HAND;
        this.grab.ndc.y -= (e.movementY / window.innerHeight) * 2 * MOUSE_HAND;
        return;
      }
      if (document.pointerLockElement !== dom && e.target !== dom) return; // over the HUD or the tuning panel
      this.look(e.movementX * LOOK, e.movementY * LOOK);
    });
    document.documentElement.addEventListener('mouseleave', () => (this.mouseX = -1));
    window.addEventListener('blur', () => (this.mouseX = -1));
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        if (document.pointerLockElement !== dom) dom.requestPointerLock?.()?.catch?.(() => {});
        if (e.button === 2) this.zoom = true;
        if (e.button === 0 && !this.tryGrab('mouse', 0, 0)) this.click(0, 0);
        return;
      }
      // Touch: the wheel first, then walking on the left half, looking on the right half.
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (!this.grab && this.tryGrab(e.pointerId, x, y)) return;
      if (this.click(x, y)) return;
      if (e.clientX < window.innerWidth / 2) {
        if (!this.joystick) this.joystick = { pointer: e.pointerId, x: e.clientX, y: e.clientY, forward: 0, right: 0 };
      } else if (!this.lookFinger) {
        this.lookFinger = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      if (this.grab?.pointer === e.pointerId) {
        this.grab.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      } else if (this.joystick?.pointer === e.pointerId) {
        const j = this.joystick;
        j.right = THREE.MathUtils.clamp((e.clientX - j.x) / JOYSTICK, -1, 1);
        j.forward = THREE.MathUtils.clamp(-(e.clientY - j.y) / JOYSTICK, -1, 1);
      } else if (this.lookFinger?.pointer === e.pointerId) {
        this.look((e.clientX - this.lookFinger.x) * TOUCH_LOOK, (e.clientY - this.lookFinger.y) * TOUCH_LOOK);
        this.lookFinger.x = e.clientX;
        this.lookFinger.y = e.clientY;
      }
    });
    const release = (e: PointerEvent) => {
      const id = e.pointerType === 'mouse' ? 'mouse' : e.pointerId;
      if (e.pointerType === 'mouse' && e.button === 2) this.zoom = false;
      if (this.grab?.pointer === id) this.grab = null;
      if (this.joystick?.pointer === e.pointerId) this.joystick = null;
      if (this.lookFinger?.pointer === e.pointerId) this.lookFinger = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Puts the person behind the wheel, facing forward like the helmsman. */
  enter(): void {
    const tilt = this.boat.model.tilt;
    tilt.updateWorldMatrix(true, false);
    const floor = boatSurfaces(HELM_STAND.x, HELM_STAND.z, false)[0].top;
    this.v.set(HELM_STAND.x, floor, HELM_STAND.z).applyMatrix4(tilt.matrixWorld);
    this.person.place(this.v.x, this.v.y, this.v.z, true);
    const h = THREE.MathUtils.degToRad(this.boat.state.heading);
    this.person.facing = Math.atan2(Math.sin(h), -Math.cos(h));
    this.yaw = h;
    this.pitch = 0.15; // a glance down at the wheel and the instruments
    this.grab = null;
    this.prevBoat.copy(tilt.matrixWorld);
    this.prevHeading = this.boat.state.heading;
  }

  /** Where the eyes are (the world follows this, not the boat). */
  get position(): THREE.Vector3 {
    return this.head;
  }

  update(dt: number, time: number, input: Input): void {
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
      this.yaw += turn; // the view turns with the boat
    }
    this.prevBoat.copy(tilt.matrixWorld);
    this.prevHeading = this.boat.state.heading;

    // Cursor resting at the left or right edge of the window (pointer not locked yet): keep turning.
    if (this.mouseX >= 0 && !this.grab && document.pointerLockElement !== this.dom) {
      const w = window.innerWidth;
      const edge = Math.max(0, 1 - this.mouseX / (w * EDGE)) - Math.max(0, 1 - (w - 1 - this.mouseX) / (w * EDGE));
      this.yaw -= edge * EDGE_TURN * dt;
    }

    const j = this.joystick;
    const forward = (input.isDown('ArrowUp', 'KeyW') ? 1 : 0) - (input.isDown('ArrowDown', 'KeyS') ? 1 : 0) + (j?.forward ?? 0);
    const right = (input.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (input.isDown('ArrowLeft', 'KeyA') ? 1 : 0) + (j?.right ?? 0);
    // You face where you look (that's also where you climb out of the water).
    p.facing = Math.atan2(Math.sin(this.yaw), -Math.cos(this.yaw));
    const run = input.isDown('ShiftLeft', 'ShiftRight') || Math.hypot(j?.forward ?? 0, j?.right ?? 0) > 0.98;
    p.step(dt, { forward: clamp1(forward), right: clamp1(right), jump: input.wasPressed('Space'), run }, this.yaw, this.world);

    // Eyes: at head height, or just above the surface while swimming.
    const eyeY = p.mode === 'swim' ? this.world.waterLevel(p.x, p.z) + 0.25 : p.y + EYE;
    const eye = this.head.set(p.x, eyeY, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(eye);
    this.camera.lookAt(
      eye.x + Math.sin(this.yaw) * Math.cos(this.pitch),
      eye.y - Math.sin(this.pitch),
      eye.z - Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // Right mouse button: a closer look (reading the instruments, spotting a harbour).
    const fov = THREE.MathUtils.lerp(this.camera.fov, this.zoom ? ZOOM_FOV : FOV, 1 - Math.exp(-12 * dt));
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    this.updateWheel();
  }

  private look(dYaw: number, dPitch: number): void {
    const slow = this.camera.fov / FOV; // finer aim while zoomed in
    dYaw *= slow;
    dPitch *= slow;
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -1.4, 1.4);
  }

  /**
   * Where a screen point (NDC) hits the wheel's plane, as an angle around the axle in the boat's
   * frame (seen from behind the wheel, counter-clockwise), or null if it's off the wheel/out of reach.
   */
  private wheelAngleAt(ndc: THREE.Vector2, onlyRim: boolean): number | null {
    const wheel = this.boat.model.wheel;
    this.raycaster.setFromCamera(ndc, this.camera);
    // The ray in the boat's frame, where the wheel turns around an axle along Z.
    const ray = this.raycaster.ray.applyMatrix4(this.boatInverse);
    if (Math.abs(ray.direction.z) < 1e-4) return null;
    const t = (wheel.position.z - ray.origin.z) / ray.direction.z;
    if (t <= 0 || (onlyRim && t > REACH)) return null;
    const dx = ray.origin.x + ray.direction.x * t - wheel.position.x;
    const dy = ray.origin.y + ray.direction.y * t - wheel.position.y;
    if (onlyRim && Math.hypot(dx, dy) > GRAB_RADIUS) return null;
    return Math.atan2(dy, dx);
  }

  /** The clickable under a screen point (NDC), if within reach. */
  private clickableAt(x: number, y: number): Clickable | undefined {
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.far = CLICK_REACH;
    const hits = this.raycaster.intersectObjects(this.clickables.map((c) => c.object), true);
    this.raycaster.far = Infinity;
    if (!hits.length) return undefined;
    return this.clickables.find((c) => {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && o !== c.object) o = o.parent;
      return o === c.object;
    });
  }

  private click(x: number, y: number): boolean {
    const target = this.clickableAt(x, y);
    target?.onClick();
    return !!target;
  }

  private tryGrab(pointer: number | 'mouse', x: number, y: number): boolean {
    if (this.person.mode === 'swim') return false;
    this.ndc.set(x, y);
    const angle = this.wheelAngleAt(this.ndc, true);
    if (angle === null) return false;
    this.grab = { pointer, ndc: this.ndc.clone(), angle, turned: 0, helm: this.boat.helm.position };
    return true;
  }

  /** Turns the wheel with the hand holding it, and checks whether it can be grabbed. */
  private updateWheel(): void {
    const g = this.grab;
    if (g) {
      const angle = this.wheelAngleAt(g.ndc, false);
      if (angle !== null) {
        // Unwrapped, so the wheel can go round more than half a turn in one go.
        g.turned += Math.atan2(Math.sin(angle - g.angle), Math.cos(angle - g.angle));
        g.angle = angle;
      }
      // Counter-clockwise (seen by the helmsman) = to port = negative helm.
      this.steer = THREE.MathUtils.clamp(g.helm - g.turned / WHEEL_LOCK, -1, 1);
      // At the stop the hand slips on the rim: turning back moves the wheel again at once.
      g.turned = (g.helm - this.steer) * WHEEL_LOCK;
    } else {
      this.steer = null;
    }
    this.ndc.set(0, 0);
    this.canGrab = !g && this.person.mode !== 'swim' && (this.wheelAngleAt(this.ndc, true) !== null || !!this.clickableAt(0, 0));
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
