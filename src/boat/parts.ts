import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Collects static parts per material and merges them into one mesh each (few draw calls). */
export class Parts {
  private readonly geos = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Axis-aligned box from (x0, y0, z0) to (x1, y1, z1). */
  box(mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(mat, g);
  }

  /** Box mirrored to both sides (x0, x1 on the starboard side). */
  pair(mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    this.box(mat, x0, x1, y0, y1, z0, z1);
    this.box(mat, -x1, -x0, y0, y1, z0, z1);
  }

  /**
   * A flat wall with rectangular openings (windows). `axis` is the wall's thickness direction: 'x' for a
   * side wall (u runs along Z), 'z' for a wall across the boat (u runs along X); v is always Y.
   */
  wall(mat: THREE.Material, axis: 'x' | 'z', t0: number, t1: number, u0: number, u1: number, v0: number, v1: number, holes: Rect[]): void {
    const cuts = [...new Set([u0, u1, ...holes.flatMap((h) => [h.u0, h.u1])])].filter((u) => u >= u0 && u <= u1).sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const [ua, ub] = [cuts[i], cuts[i + 1]];
      // Holes covering this column split it vertically.
      const covering = holes.filter((h) => h.u0 <= ua && h.u1 >= ub).sort((a, b) => a.v0 - b.v0);
      let v = v0;
      const piece = (va: number, vb: number) => {
        if (vb - va < 1e-4) return;
        if (axis === 'x') this.box(mat, t0, t1, va, vb, ua, ub);
        else this.box(mat, ua, ub, va, vb, t0, t1);
      };
      for (const h of covering) {
        piece(v, h.v0);
        v = h.v1;
      }
      piece(v, v1);
    }
  }

  /** Round bar from a to b. */
  rod(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
    const dir = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, dir.length(), 6, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.add(mat, g.toNonIndexed());
  }

  add(mat: THREE.Material, g: THREE.BufferGeometry): void {
    const list = this.geos.get(mat) ?? [];
    // mergeGeometries needs all indexed or all not; keep everything non-indexed with normals + uvs.
    list.push(g.index ? g.toNonIndexed() : g);
    this.geos.set(mat, list);
  }

  build(parent: THREE.Object3D): void {
    for (const [mat, list] of this.geos) {
      // Only what the material uses; vertex colours for vertex-coloured materials (e.g. book spines).
      const keep = ['position', 'normal', ...((mat as THREE.MeshStandardMaterial).vertexColors ? ['color'] : [])];
      for (const g of list) for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
      parent.add(new THREE.Mesh(mergeGeometries(list), mat));
    }
  }
}

/** A rectangle in a wall's plane: u along the wall, v up. */
export interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}
