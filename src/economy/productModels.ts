// Small models of the groceries as they lie on the boat's pantry shelf: base at y = 0, real size,
// vertex-coloured, one cached geometry per product.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProductId } from './economy';

const cache = new Map<ProductId, THREE.BufferGeometry>();

function tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  flat.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const colors = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

const box = (w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex);
const cyl = (r: number, h: number, hex: number, y = 0, top = r, x = 0, z = 0) => tint(new THREE.CylinderGeometry(top, r, h, 12).translate(x, y + h / 2, z), hex);
const ball = (r: number, hex: number, sy = 1, x = 0, z = 0) => tint(new THREE.SphereGeometry(r, 12, 9).scale(1, sy, 1).translate(x, r * sy, z), hex);

function build(id: ProductId): THREE.BufferGeometry {
  switch (id) {
    case 'water':
      return mergeGeometries([cyl(0.045, 0.24, 0x9fd0ef), cyl(0.045, 0.06, 0x9fd0ef, 0.24, 0.016), cyl(0.017, 0.025, 0x2a63b8, 0.3), cyl(0.0455, 0.07, 0x2a63b8, 0.08)])!;
    case 'juice':
      return mergeGeometries([box(0.07, 0.2, 0.07, 0xf29a1f), box(0.072, 0.07, 0.072, 0x3a9d5d, 0, 0.07), box(0.05, 0.03, 0.05, 0xf29a1f, 0, 0.2), cyl(0.012, 0.02, 0xffffff, 0.23)])!;
    case 'milk':
      return mergeGeometries([box(0.07, 0.2, 0.07, 0xf6f6f2), box(0.072, 0.06, 0.072, 0x2f6fb5, 0, 0.05), box(0.05, 0.03, 0.05, 0xf6f6f2, 0, 0.2), cyl(0.012, 0.02, 0x2f6fb5, 0.23)])!;
    case 'apple':
      return mergeGeometries([ball(0.038, 0xc8231d, 0.92), cyl(0.003, 0.02, 0x4a3320, 0.068)])!;
    case 'orange':
      return ball(0.04, 0xf28c1c, 0.95);
    case 'pear':
      return mergeGeometries([ball(0.036, 0xc9b84a), ball(0.024, 0xc9b84a, 1.2, 0, 0).translate(0, 0.045, 0), cyl(0.003, 0.02, 0x4a3320, 0.1)])!;
    case 'banana': {
      // A bent finger: three segments.
      const parts = [-1, 0, 1].map((i) => tint(new THREE.CylinderGeometry(0.017, 0.017, 0.07, 8).rotateZ(Math.PI / 2 + i * 0.35).translate(i * 0.062, 0.02 + Math.abs(i) * 0.016, 0), 0xf2d235));
      return mergeGeometries(parts)!;
    }
    case 'bread':
      return tint(new THREE.SphereGeometry(0.1, 14, 10).scale(1.3, 0.6, 0.75).translate(0, 0.06, 0), 0xc08a4a);
    case 'rolls':
      return mergeGeometries([box(0.2, 0.004, 0.14, 0xe9e1cf), ...[-0.05, 0.05].flatMap((x) => [-0.035, 0.035].map((z) => ball(0.035, 0xd39a52, 0.8, x, z)))])!;
    case 'chocolate':
      return mergeGeometries([box(0.16, 0.015, 0.075, 0x6a2f8a), box(0.05, 0.016, 0.076, 0xf2f0e8)])!;
  }
}

export function productGeometry(id: ProductId): THREE.BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    g = build(id);
    cache.set(id, g);
  }
  return g;
}
