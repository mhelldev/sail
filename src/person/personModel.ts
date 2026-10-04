import * as THREE from 'three';
import type { PersonMode } from './personController';

/**
 * Low-poly sailor (~1.78 m): yellow sailing jacket, navy trousers and cap. Origin at the feet,
 * facing +Z. Limbs swing while walking; the body lies forward while swimming.
 */
export class PersonModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private phase = 0;

  constructor() {
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
    const jacket = mat(0xf2b705);
    const trousers = mat(0x1d2b4a);
    const skin = mat(0xe0b08a);
    const boots = mat(0x2a2a2a);
    const cap = mat(0x1d3557);

    this.root.add(this.body);
    // Hips at 0.9 m: legs hang from there so they can swing.
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.11, 0.9, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.82, 0.19).translate(0, -0.41, 0), trousers);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.3).translate(0, -0.84, 0.05), boots);
      leg.add(thigh, boot);
      this.legs.push(leg);
      this.body.add(leg);
    }
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.26).translate(0, 1.2, 0), jacket);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.22).translate(0, 1.52, 0), jacket);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1).translate(0, 1.66, 0), skin);
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.08, 10).translate(0, 1.77, 0), cap);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.1).translate(0, 1.74, 0.15), cap);
    this.body.add(torso, collar, head, capTop, visor);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.28, 1.46, 0);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.13).translate(0, -0.3, 0), jacket);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1).translate(0, -0.64, 0), skin);
      arm.add(sleeve, hand);
      this.arms.push(arm);
      this.body.add(arm);
    }
    this.root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.root.visible = false;
  }

  update(dt: number, x: number, y: number, z: number, facing: number, speed: number, mode: PersonMode): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;
    const swimming = mode === 'swim';
    // Lying forward in the water: the body pivots ~1 m up, so with the feet 1.3 m under the
    // surface the torso lies along it and the head stays just above.
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, swimming ? 1.25 : 0, 1 - Math.exp(-8 * dt));
    this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, swimming ? 1.05 : 0, 1 - Math.exp(-8 * dt));

    const pace = swimming ? 2.2 : Math.max(speed, 0.0);
    this.phase += dt * (swimming ? 3 : 2.6 + pace * 1.6);
    const swing = swimming ? 1 : Math.min(1, speed / 2.2) * (speed > 3 ? 1.25 : 0.85);
    const s = Math.sin(this.phase);
    if (mode === 'air') {
      this.legs[0].rotation.x = this.legs[1].rotation.x = -0.35;
      this.arms[0].rotation.x = this.arms[1].rotation.x = -0.6;
      this.arms[0].rotation.z = 0.4;
      this.arms[1].rotation.z = -0.4;
    } else if (swimming) {
      // Crawl: arms circle alternately, legs kick.
      this.arms[0].rotation.x = this.phase % (Math.PI * 2) - Math.PI;
      this.arms[1].rotation.x = ((this.phase + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.arms[0].rotation.z = this.arms[1].rotation.z = 0;
      this.legs[0].rotation.x = s * 0.35;
      this.legs[1].rotation.x = -s * 0.35;
    } else {
      this.legs[0].rotation.x = s * 0.6 * swing;
      this.legs[1].rotation.x = -s * 0.6 * swing;
      this.arms[0].rotation.x = -s * 0.5 * swing;
      this.arms[1].rotation.x = s * 0.5 * swing;
      this.arms[0].rotation.z = 0.08;
      this.arms[1].rotation.z = -0.08;
    }
  }
}
