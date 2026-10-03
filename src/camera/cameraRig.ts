import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Boat } from '../boat/boat';

export type CameraMode = 'chase' | 'deck' | 'top';

const MODE_KEYS: Record<string, CameraMode> = { Digit1: 'chase', Digit2: 'deck', Digit3: 'top' };

/**
 * 1: chase camera orbiting the boat (drag to orbit, wheel to zoom)
 * 2: on deck behind the wheel (drag to look around)
 * 3: top-down map view, north up (wheel to zoom)
 */
export class CameraRig {
  mode: CameraMode = 'chase';

  private yaw = 0; // radians, relative to the boat's stern
  private pitch = 0.22;
  private distance = 32;
  private lookYaw = 0;
  private lookPitch = -0.05;
  private topHeight = 400;
  private readonly smoothedTarget = new THREE.Vector3();
  private smoothedHeading = 0;
  private initialized = false;

  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    // Mouse / pen only: on touch screens one finger steers and TouchControls calls orbit/zoom.
    let dragging = false;
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      dragging = true;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      dom.releasePointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (dragging) this.orbit(e.movementX, e.movementY);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * 0.001));
      },
      { passive: false },
    );
  }

  /** Orbit (chase) or look around (deck) by a screen-space drag in pixels. */
  orbit(dxPx: number, dyPx: number): void {
    const dx = dxPx * 0.005;
    const dy = dyPx * 0.005;
    if (this.mode === 'chase') {
      this.yaw -= dx;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.05, 1.45);
    } else if (this.mode === 'deck') {
      this.lookYaw -= dx;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy, -1.2, 1.2);
    }
  }

  /** Zoom by a factor (> 1 = further away). */
  zoom(factor: number): void {
    if (this.mode === 'chase') this.distance = THREE.MathUtils.clamp(this.distance * factor, 8, 600);
    if (this.mode === 'top') this.topHeight = THREE.MathUtils.clamp(this.topHeight * factor, 40, 20000);
  }

  /** Key code of the next camera mode, for the touch "View" button. */
  nextModeKey(): string {
    const modes = Object.entries(MODE_KEYS);
    const i = modes.findIndex(([, m]) => m === this.mode);
    return modes[(i + 1) % modes.length][0];
  }

  update(dt: number, input: Input, boat: Boat): void {
    for (const [code, mode] of Object.entries(MODE_KEYS)) if (input.wasPressed(code)) this.mode = mode;

    const boatPos = boat.object.position;
    const heading = THREE.MathUtils.degToRad(boat.state.heading);
    if (!this.initialized) {
      this.smoothedTarget.copy(boatPos);
      this.smoothedHeading = heading;
      this.initialized = true;
    }
    // Follow position tightly, heading lazily so turns are visible.
    this.smoothedTarget.lerp(boatPos, 1 - Math.exp(-10 * dt));
    const dh = Math.atan2(Math.sin(heading - this.smoothedHeading), Math.cos(heading - this.smoothedHeading));
    this.smoothedHeading += dh * (1 - Math.exp(-2 * dt));

    const cam = this.camera;
    if (this.mode === 'chase') {
      const a = this.smoothedHeading + this.yaw;
      const horiz = Math.cos(this.pitch) * this.distance;
      // Behind the boat = opposite of its forward vector (sin h, 0, -cos h).
      cam.position.set(
        this.smoothedTarget.x - Math.sin(a) * horiz,
        Math.max(1.5, this.smoothedTarget.y + 3 + Math.sin(this.pitch) * this.distance),
        this.smoothedTarget.z + Math.cos(a) * horiz,
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(this.tmp.copy(this.smoothedTarget).setY(this.smoothedTarget.y + 3));
    } else if (this.mode === 'deck') {
      // Eye behind the wheel, moving and rolling with the hull.
      const tilt = boat.model.tilt;
      tilt.updateWorldMatrix(true, false);
      cam.position.set(0, 2.6, 4.7).applyMatrix4(tilt.matrixWorld);
      tilt.getWorldQuaternion(this.tmpQ);
      this.lookEuler.set(this.lookPitch, this.lookYaw, 0);
      cam.quaternion.copy(this.tmpQ).multiply(new THREE.Quaternion().setFromEuler(this.lookEuler));
    } else {
      cam.position.set(boatPos.x, this.topHeight, boatPos.z);
      cam.up.set(0, 0, -1); // north up
      cam.lookAt(boatPos.x, 0, boatPos.z);
    }
  }
}
