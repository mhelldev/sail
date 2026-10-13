// The groceries on the boat's pantry shelf (layout.PANTRY): one mesh per slot showing what lies
// there, and an invisible click target per slot (click = eat / drink it).

import * as THREE from 'three';
import type { ProductId } from '../economy/economy';
import { productGeometry } from '../economy/productModels';
import { PANTRY } from './layout';

/** Long things lie along the shelf. */
const ALONG = new Set<ProductId>(['bread', 'banana', 'chocolate', 'rolls']);

export class Pantry {
  /** click targets, index = pantry slot */
  readonly targets: THREE.Mesh[] = [];
  /** the goods' material (lit like the rest of the cabin) */
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x262019, emissiveIntensity: 1 });
  private readonly items: THREE.Mesh[] = [];
  private shown: Array<ProductId | null> = [];

  constructor(parent: THREE.Object3D) {
    const hit = new THREE.MeshBasicMaterial({ visible: false });
    const slotLength = (PANTRY.z1 - PANTRY.z0) / PANTRY.slots;
    const x = (PANTRY.inner + PANTRY.outer) / 2;
    for (const y of PANTRY.boards) {
      for (let j = 0; j < PANTRY.slots; j++) {
        const z = PANTRY.z0 + (j + 0.5) * slotLength;
        const item = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        item.position.set(x, y, z);
        item.visible = false;
        parent.add(item);
        this.items.push(item);
        const target = new THREE.Mesh(new THREE.BoxGeometry(PANTRY.outer - PANTRY.inner, 0.3, slotLength - 0.01).translate(0, 0.15, 0), hit);
        target.position.set(x, y, z);
        target.visible = false; // clickable only while something lies there (the material is invisible)
        parent.add(target);
        this.targets.push(target);
      }
    }
  }

  /** Shows what's in the pantry (only touches the meshes that changed). */
  show(pantry: Array<ProductId | null>): void {
    pantry.forEach((id, i) => {
      if (this.shown[i] === id || !this.items[i]) return;
      const item = this.items[i];
      item.visible = !!id;
      this.targets[i].visible = !!id;
      if (id) {
        item.geometry = productGeometry(id);
        item.rotation.y = ALONG.has(id) ? Math.PI / 2 : (i * 0.7) % 1;
      }
    });
    this.shown = [...pantry];
  }
}
