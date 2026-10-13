import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PRODUCTS, type ProductId } from './economy';
import { productGeometry } from './productModels';
import { Pantry } from '../boat/pantry';
import { PANTRY } from '../boat/layout';

describe('product models', () => {
  it('builds every product, small and standing on its base', () => {
    for (const id of Object.keys(PRODUCTS) as ProductId[]) {
      const g = productGeometry(id);
      expect(g, id).toBeTruthy();
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.min.y, id).toBeGreaterThanOrEqual(-0.001);
      expect(box.max.y, id).toBeLessThan(0.35);
      expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z), id).toBeLessThan(0.3);
      expect(g.getAttribute('color'), id).toBeTruthy();
    }
  });

  it('shows the pantry and makes only filled slots clickable', () => {
    const pantry = new Pantry(new THREE.Group());
    expect(pantry.targets).toHaveLength(PANTRY.boards.length * PANTRY.slots);
    const slots: Array<ProductId | null> = new Array(12).fill(null);
    slots[3] = 'bread';
    pantry.show(slots);
    expect(pantry.targets.map((t) => t.visible)).toEqual(slots.map((s) => !!s));
  });
});
