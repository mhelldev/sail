// The player in first person: on the boat (deck, cockpit, down in the cabin), on piers and land,
// or swimming. The boat keeps sailing its course. Arrow keys / WASD walk, Shift runs, Space jumps,
// moving the mouse looks around, the right button zooms, F raises the binoculars (10×). Near the helm the wheel can be grabbed
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
/** Binoculars: 10× magnification, i.e. a tenth of the view's tangent. */
export const BINOCULAR_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / 10));
const GRAB_RADIUS = 0.6; // a little beyond the rim, so it's easy to hit
// The hand on the wheel moves faster than the mouse: ¾ turn each way would otherwise need very
// long drags (a finger on a touch screen holds the rim directly).
const MOUSE_HAND = 2.5;
/** px of finger travel for full walking speed (the on-screen stick's radius) */
export const JOYSTICK = 60;

/** Walkable things with rooms (floors, ceilings) beyond the boat and the plain village boxes. */
export interface ExtraWalkWorld {
  surfacesAt(x: number, z: number): Array<{ top: number; bottom?: number }>;
  /** has its own floor here: the terrain doesn't count */
  coversGround(x: number, z: number): boolean;
}

/** Something on the boat that reacts to a click or tap. */
export interface Clickable {
  object: THREE.Object3D;
  onClick: () => void;
  /** how far away it can be clicked (default CLICK_REACH) */
  reach?: number;
}

/** Something on the boat that is held and moved up/down (forward/back), like the throttle lever. */
export interface Draggable {
  object: THREE.Object3D;
  /** @param dy pointer movement in px since the last call; negative = up (pushing forward) */
  onDrag: (dy: number) => void;
  onRelease?: () => void;
}

export class WalkMode {
  /** door, chart plotter… (the wheel is handled separately: it's dragged) */
  readonly clickables: Clickable[] = [];
  /** throttle lever… */
  readonly draggables: Draggable[] = [];
  readonly person = new PersonController();
  /** helm position while the wheel is held by hand, otherwise null */
  steer: number | null = null;
  /** starving or parched: no running */
  exhausted = false;
  /** the wheel (or something clickable) is under the crosshair and within reach */
  canGrab = false;
  /** looking through the binoculars (F): 10× zoom, no grabbing or clicking */
  binoculars = false;

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
  private dragging: { pointer: number | 'mouse'; target: Draggable; y: number } | null = null;
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
    /** more things to walk on/into, e.g. the marina houses (with floors and ceilings) */
    more?: ExtraWalkWorld,
  ) {
    const tilt = boat.model.tilt;
    this.world = {
      waterLevel: (x, z) => heightAt(this.waves, x, z, this.time),
      surfacesAt: (x, z) => {
        const out: Surface[] = [];
        const ground = more?.coversGround(x, z) ? undefined : terrain.heightAt(x, z);
        if (ground !== undefined) out.push({ top: ground, boat: false });
        for (const top of harbors.surfacesAt(x, z)) out.push({ top, boat: false });
        if (more) for (const s of more.surfacesAt(x, z)) out.push({ ...s, boat: false });
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
      if (this.dragging?.pointer === 'mouse') {
        this.dragging.target.onDrag(e.movementY);
        return;
      }
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
        if (e.button === 0 && !this.binoculars && !this.tryGrab('mouse', 0, 0) && !this.tryDrag('mouse', 0, 0, e.clientY)) this.click(0, 0);
        return;
      }
      // Touch: the wheel first, then walking on the left half, looking on the right half.
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = -(e.clientY / window.innerHeight) * 2 + 1;
      // The stick's resting spot (bottom left) always walks, even with the wheel's rim behind it.
      const onStick = e.clientX < 24 + JOYSTICK * 2 + 40 && e.clientY > window.innerHeight - (28 + JOYSTICK * 2 + 40);
      if (!onStick && !this.binoculars && !this.grab && this.tryGrab(e.pointerId, x, y)) return;
      if (!onStick && !this.binoculars && !this.dragging && this.tryDrag(e.pointerId, x, y, e.clientY)) return;
      if (!onStick && !this.binoculars && this.click(x, y)) return;
      if (e.clientX < window.innerWidth / 2) {
        if (!this.joystick) this.joystick = { pointer: e.pointerId, x: e.clientX, y: e.clientY, forward: 0, right: 0 };
      } else if (!this.lookFinger) {
        this.lookFinger = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      if (this.dragging?.pointer === e.pointerId) {
        this.dragging.target.onDrag(e.clientY - this.dragging.y);
        this.dragging.y = e.clientY;
      } else if (this.grab?.pointer === e.pointerId) {
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
      if (this.dragging?.pointer === id) {
        this.dragging.target.onRelease?.();
        this.dragging = null;
      }
      if (this.joystick?.pointer === e.pointerId) this.joystick = null;
      if (this.lookFinger?.pointer === e.pointerId) this.lookFinger = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Compass bearing the player looks at, degrees (shown in the binoculars). */
  get bearing(): number {
    return (((this.yaw * 180) / Math.PI) % 360 + 360) % 360;
  }

  /** Holding the wheel or a lever (for the crosshair). */
  get holding(): boolean {
    return this.steer !== null || this.dragging !== null;
  }

  /** The walking stick while a finger holds it: where it was put down (px) and the deflection (-1…1). */
  get stick(): { x: number; y: number; right: number; forward: number } | null {
    return this.joystick;
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
    const run = !this.exhausted && (input.isDown('ShiftLeft', 'ShiftRight') || Math.hypot(j?.forward ?? 0, j?.right ?? 0) > 0.98);
    p.step(dt, { forward: clamp1(forward), right: clamp1(right), jump: input.wasPressed('Space'), run }, this.yaw, this.world);

    // Eyes: at head height, or just above the surface while swimming.
    const eyeY = p.mode === 'swim' ? this.world.waterLevel(p.x, p.z) + 0.25 : p.y + EYE;
    const eye = this.head.set(p.x, eyeY, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(eye);
    // Holding binoculars at 10× nobody keeps perfectly still: a slow sway plus a little tremor.
    const t = this.time;
    const shake = this.binoculars ? 1 : 0;
    const sway = shake * (0.0016 * Math.sin(t * 0.9) + 0.0007 * Math.sin(t * 2.7 + 1.3) + 0.0003 * Math.sin(t * 7.1));
    const bob = shake * (0.0012 * Math.sin(t * 1.1 + 0.5) + 0.0005 * Math.sin(t * 3.3) + 0.0003 * Math.sin(t * 8.3 + 2));
    const yaw = this.yaw + sway;
    const pitch = this.pitch + bob;
    this.camera.lookAt(
      eye.x + Math.sin(yaw) * Math.cos(pitch),
      eye.y - Math.sin(pitch),
      eye.z - Math.cos(yaw) * Math.cos(pitch),
    );
    // Binoculars (F): 10×. Right mouse button: a closer look (reading the instruments).
    const target = this.binoculars ? BINOCULAR_FOV : this.zoom ? ZOOM_FOV : FOV;
    // Raising or lowering the binoculars is instant; the right-button zoom eases in.
    const fov = this.binoculars || this.camera.fov < ZOOM_FOV - 1 ? target : THREE.MathUtils.lerp(this.camera.fov, target, 1 - Math.exp(-12 * dt));
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

  /** The clickable or draggable under a screen point (NDC), if within reach. */
  private pick<T extends { object: THREE.Object3D; reach?: number }>(list: T[], x: number, y: number): T | undefined {
    if (!list.length) return undefined;
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.far = Math.max(CLICK_REACH, ...list.map((c) => c.reach ?? 0));
    const hits = this.raycaster.intersectObjects(
      list.filter((c) => c.object.visible).map((c) => c.object),
      true,
    );
    this.raycaster.far = Infinity;
    if (!hits.length) return undefined;
    const target = list.find((c) => {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && o !== c.object) o = o.parent;
      return o === c.object;
    });
    return target && hits[0].distance <= (target.reach ?? CLICK_REACH) ? target : undefined;
  }

  private clickableAt(x: number, y: number): Clickable | undefined {
    return this.pick(this.clickables, x, y);
  }

  private tryDrag(pointer: number | 'mouse', x: number, y: number, clientY: number): boolean {
    if (this.person.mode === 'swim') return false;
    const target = this.pick(this.draggables, x, y);
    if (target) this.dragging = { pointer, target, y: clientY };
    return !!target;
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
    this.canGrab = !g && !this.dragging && !this.binoculars && this.person.mode !== 'swim' && (this.wheelAngleAt(this.ndc, true) !== null || !!this.clickableAt(0, 0) || !!this.pick(this.draggables, 0, 0));
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
