import * as THREE from 'three';
import type { Coastline } from './coastline';

const RADIUS = 30000; // metres of coastline drawn around the boat
const REBUILD_DISTANCE = 8000;

/** Debug overlay: the raw coastline drawn as lines on the water around the boat. */
export class CoastLines {
  readonly object: THREE.LineSegments;
  private readonly center = new THREE.Vector2(Infinity, Infinity);

  constructor(private readonly coast: Coastline) {
    this.object = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd166, fog: false }),
    );
    this.object.position.y = 1.5;
    this.object.renderOrder = 1;
    this.object.frustumCulled = false;
  }

  update(x: number, z: number): void {
    if (this.center.distanceTo(new THREE.Vector2(x, z)) < REBUILD_DISTANCE) return;
    this.center.set(x, z);
    const ids = this.coast.segmentsNear(x - RADIUS, z - RADIUS, x + RADIUS, z + RADIUS);
    const s = this.coast.segments;
    const positions = new Float32Array(ids.length * 6);
    ids.forEach((id, i) => {
      positions.set([s[id * 4], 0, s[id * 4 + 1], s[id * 4 + 2], 0, s[id * 4 + 3]], i * 6);
    });
    this.object.geometry.dispose();
    this.object.geometry = new THREE.BufferGeometry();
    this.object.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  }
}
