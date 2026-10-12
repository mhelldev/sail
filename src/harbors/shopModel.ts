// The village supermarket up close: walls with big shop windows under striped awnings, a glass door,
// the "SUPERMARKET" board, and inside shelves full of groceries — fruit and vegetables in crates, a
// bread rack, packs of water bottles, a checkout. Built only near the player (`MarinaHouses`); from
// afar the village draws a plain box. Layout: shop.ts.
//
// Like the marina gallery the inside is unlit (MeshBasicMaterial with shading baked into vertex
// colours): all furniture and goods are one merged mesh, so the whole interior is a handful of draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import alea from 'alea';
import { canvasTexture, slab, wallFace, type MarinaHouseAssets } from './marinaHouseModel';
import { SHOP, SHOP_DOOR, SHOP_FIXTURES, SHOP_SIGN, SHOP_STEPS, SHOP_WINDOWS, type Fixture } from './shop';
import type { MarinaHouseSite } from './village';

const W = SHOP.width;
const D = SHOP.depth;
const H = SHOP.height;
const T = SHOP.wall;
const FLOOR = SHOP.floor;
const CEIL = SHOP.ceiling;
const DOOR_SWING = 0.6; // seconds, matches DoorSound
const AWNING = { depth: 1.1, drop: 0.45 };

// ---- Canvases -------------------------------------------------------------------------------------

function signCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * SHOP_SIGN.height) / SHOP_SIGN.width);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f6b3a';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f2a33a';
  g.fillRect(0, c.height - 12, c.width, 12);
  // A shopping basket on the left.
  const bx = 70;
  const by = c.height / 2 + 4;
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(bx, by - 8, 22, Math.PI, 0);
  g.stroke();
  g.beginPath();
  g.moveTo(bx - 36, by - 8);
  g.lineTo(bx + 36, by - 8);
  g.lineTo(bx + 26, by + 26);
  g.lineTo(bx - 26, by + 26);
  g.closePath();
  g.fill();
  g.fillStyle = '#1f6b3a';
  for (const dx of [-14, 0, 14]) g.fillRect(bx + dx - 3, by, 6, 18);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 76px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  g.letterSpacing = '10px';
  g.fillText('SUPERMARKET', c.width / 2 + 40, c.height / 2 - 2);
  return c;
}

/** Green and white awning stripes. */
function awningCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f4f1e6' : '#2f7d47';
    g.fillRect(i * 16, 0, 16, 8);
  }
  return c;
}

/** Light grey floor tiles. */
function tileCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rng = alea('tiles');
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const l = 205 + Math.round(rng() * 18);
      g.fillStyle = `rgb(${l},${l - 2},${l - 8})`;
      g.fillRect(i * 32, j * 32, 32, 32);
    }
  }
  g.fillStyle = 'rgba(120,115,105,0.6)';
  for (let k = 0; k <= 4; k++) {
    g.fillRect(k * 32 - 1, 0, 2, 128);
    g.fillRect(0, k * 32 - 1, 128, 2);
  }
  return c;
}

/** Small price/aisle card: white with a coloured header. */
function cardCanvas(text: string, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 44px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  return c;
}

// ---- Goods: one merged, vertex-coloured mesh ---------------------------------------------------------

// Low-poly on purpose: there are thousands of items (the whole interior is ~80k vertices). Cylinders
// have no bottom (they stand on something), balls are coarse.
const PROTOS = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  ball: new THREE.SphereGeometry(0.5, 7, 5),
  roughBall: new THREE.IcosahedronGeometry(0.5, 0),
  can: cylinder(1, 6),
  thin: cylinder(1, 5),
  cone: cylinder(0.4, 6),
};

/** Unit cylinder standing on y = 0 with a top cap but no bottom; `top` = top radius / bottom radius. */
function cylinder(top: number, segments: number): THREE.BufferGeometry {
  const side = new THREE.CylinderGeometry(0.5 * top, 0.5, 1, segments, 1, true).translate(0, 0.5, 0);
  const cap = new THREE.CircleGeometry(0.5 * top, segments).rotateX(-Math.PI / 2).translate(0, 1, 0);
  return mergeGeometries([side.toNonIndexed(), cap.toNonIndexed()])!;
}

/**
 * Collects shapes with a colour each and bakes simple lighting into vertex colours (top bright,
 * undersides dark, front faces a little brighter): looks lit without any light in the scene.
 */
class Goods {
  private pos = new Float32Array(1 << 16);
  private col = new Float32Array(1 << 16);
  private n = 0; // floats written
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private readonly m = new THREE.Matrix4();
  private readonly nm = new THREE.Matrix3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  /** Runs `fn` with a local frame (position, rotation) on top of the current one. */
  frame(x: number, y: number, z: number, rx: number, ry: number, rz: number, fn: () => void): void {
    this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(1, 1, 1));
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(this.m));
    fn();
    this.stack.pop();
  }

  /** A prototype scaled to (sx, sy, sz), placed at (x, y, z) (its base for boxes and cylinders). */
  add(proto: keyof typeof PROTOS, hex: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0): void {
    const p = PROTO_DATA[proto];
    this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(sx, sy, sz));
    this.m.premultiply(this.stack[this.stack.length - 1]);
    this.nm.getNormalMatrix(this.m);
    const e = this.m.elements;
    const ne = this.nm.elements;
    this.c.setHex(hex);
    const count = p.pos.length;
    if (this.n + count > this.pos.length) {
      const grow = (a: Float32Array) => {
        const b = new Float32Array(Math.max(a.length * 2, this.n + count));
        b.set(a);
        return b;
      };
      this.pos = grow(this.pos);
      this.col = grow(this.col);
    }
    for (let i = 0; i < count; i += 3) {
      const px = p.pos[i];
      const py = p.pos[i + 1];
      const pz = p.pos[i + 2];
      this.pos[this.n + i] = e[0] * px + e[4] * py + e[8] * pz + e[12];
      this.pos[this.n + i + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13];
      this.pos[this.n + i + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
      // Baked light from the (transformed) normal.
      const nx0 = p.normal[i];
      const ny0 = p.normal[i + 1];
      const nz0 = p.normal[i + 2];
      let nx = ne[0] * nx0 + ne[3] * ny0 + ne[6] * nz0;
      let ny = ne[1] * nx0 + ne[4] * ny0 + ne[7] * nz0;
      let nz = ne[2] * nx0 + ne[5] * ny0 + ne[8] * nz0;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; // (Math.hypot is slow)
      nx /= l;
      ny /= l;
      nz /= l;
      const shade = 0.68 + 0.27 * ny + 0.06 * Math.abs(nx) + 0.1 * Math.abs(nz);
      this.col[this.n + i] = this.c.r * shade;
      this.col[this.n + i + 1] = this.c.g * shade;
      this.col[this.n + i + 2] = this.c.b * shade;
    }
    this.n += count;
  }

  /** A box from corner to corner (shop coordinates). */
  slab(hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    this.add('box', hex, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.n), 3));
    geo.computeBoundingSphere();
    return geo;
  }
}

/** The prototypes as plain non-indexed position/normal arrays. */
const PROTO_DATA = Object.fromEntries(
  Object.entries(PROTOS).map(([k, g]) => {
    const flat = g.index ? g.toNonIndexed() : g;
    return [k, { pos: flat.getAttribute('position').array as Float32Array, normal: flat.getAttribute('normal').array as Float32Array }];
  }),
) as Record<keyof typeof PROTOS, { pos: Float32Array; normal: Float32Array }>;

const PACKAGING = [0xd6372e, 0xf0b429, 0x2f6fb5, 0x3a9d5d, 0xf2f0e8, 0x8a4fb0, 0xe8742c, 0x1f2b48, 0xc9a26b];
const WOOD = 0x9a7048;
const DARK_WOOD = 0x6b4a2f;
const SHELF_METAL = 0xe4e6e8;
const WATER_BLUE = 0x8fc3e6;

/** Fills `length` metres of a shelf board (along local +X, front at local +Z) with one kind of product. */
function stockRun(g: Goods, rng: () => number, kind: number, length: number, depth: number, room: number): void {
  const color = PACKAGING[Math.floor(rng() * PACKAGING.length)];
  const alt = PACKAGING[Math.floor(rng() * PACKAGING.length)];
  // Boxes stand two deep; round things only in the front row (the back row would hardly be seen).
  const rows = depth > 0.3 ? 2 : 1;
  const rowZ = (r: number) => depth / 2 - 0.08 - r * (depth / 2 - 0.02);
  switch (kind) {
    case 0: // cereal boxes standing upright
      for (let x = 0.12; x < length - 0.1; x += 0.23) for (let r = 0; r < rows; r++) g.add('box', r ? alt : color, x, 0, rowZ(r), 0.2, Math.min(0.3, room), 0.07);
      break;
    case 1: // cans, two layers
      for (let x = 0.06; x < length - 0.05; x += 0.09) {
        {
          const r = 0;
          g.add('can', color, x, 0, rowZ(r), 0.075, 0.11, 0.075);
          if (room > 0.3) g.add('can', color, x, 0.11, rowZ(r), 0.075, 0.11, 0.075);
        }
      }
      break;
    case 2: // jars with lids
      for (let x = 0.07; x < length - 0.06; x += 0.11) {
        {
          const r = 0;
          g.add('can', rng() < 0.5 ? 0xb8362c : 0xd88b2a, x, 0, rowZ(r), 0.085, 0.12, 0.085);
          g.add('can', 0xd8c25a, x, 0.12, rowZ(r), 0.08, 0.02, 0.08);
        }
      }
      break;
    case 3: // water bottles
      for (let x = 0.05; x < length - 0.05; x += 0.09) {
        {
          const r = 0;
          g.add('can', WATER_BLUE, x, 0, rowZ(r), 0.075, 0.22, 0.075);
          g.add('cone', WATER_BLUE, x, 0.22, rowZ(r), 0.075, 0.07, 0.075);
          g.add('box', 0x2a63b8, x, 0.29, rowZ(r), 0.03, 0.02, 0.03);
        }
      }
      break;
    case 4: // milk and juice cartons
      for (let x = 0.05; x < length - 0.05; x += 0.085) {
        for (let r = 0; r < rows; r++) {
          const c = rng() < 0.5 ? 0xf4f4f0 : 0xf2a33a;
          g.add('box', c, x, 0, rowZ(r), 0.07, 0.19, 0.07);
          g.add('box', c === 0xf4f4f0 ? 0x2f6fb5 : 0x3a9d5d, x, 0.06, rowZ(r) + 0.031, 0.072, 0.05, 0.01);
        }
      }
      break;
    default: // bags of pasta / coffee lying flat, a few high
      for (let x = 0.08; x < length - 0.08; x += 0.15) {
        const stack = 1 + Math.floor(rng() * Math.min(3, room / 0.07));
        for (let s = 0; s < stack; s++) g.add('box', s % 2 ? color : alt, x, s * 0.065, rowZ(0) - 0.05, 0.13, 0.06, 0.24, 0, (rng() - 0.5) * 0.15, 0);
      }
  }
}

/** A shelf unit along local +X with its back at local z = 0, front towards +Z; boards at `levels`. */
function shelfUnit(g: Goods, rng: () => number, length: number, depth: number, levels: number[], top: number, back = true): void {
  if (back) g.slab(SHELF_METAL, 0, length, 0, top, 0, 0.03);
  for (const x of [0.02, length - 0.02]) g.slab(0x9aa0a6, x - 0.02, x + 0.02, 0, top, 0, depth);
  g.slab(0x5a5f66, 0, length, 0, levels[0] - 0.02, 0.02, depth); // kick plate
  for (const [i, y] of levels.entries()) {
    g.slab(SHELF_METAL, 0.02, length - 0.02, y - 0.025, y, 0.02, depth);
    g.slab(0xf2c230, 0.04, length - 0.04, y - 0.06, y - 0.02, depth - 0.005, depth); // price rail
    const room = (levels[i + 1] ?? top) - y - 0.05;
    let x = 0.06;
    while (x < length - 0.3) {
      const run = Math.min(length - 0.06 - x, 0.5 + rng() * 0.8);
      g.frame(x, y, 0.03, 0, 0, 0, () => stockRun(g, rng, Math.floor(rng() * 6), run, depth - 0.03, room));
      x += run + 0.02;
    }
  }
}

/** Open wooden crate (local origin at its bottom centre) filled with fruit or vegetables. */
function crate(g: Goods, rng: () => number, w: number, d: number, fill: number): void {
  const h = 0.16;
  g.slab(WOOD, -w / 2, w / 2, 0, 0.02, -d / 2, d / 2);
  g.slab(WOOD, -w / 2, w / 2, 0, h, -d / 2, -d / 2 + 0.015);
  g.slab(WOOD, -w / 2, w / 2, 0, h * 0.6, d / 2 - 0.015, d / 2);
  g.slab(WOOD, -w / 2, -w / 2 + 0.015, 0, h, -d / 2, d / 2);
  g.slab(WOOD, w / 2 - 0.015, w / 2, 0, h, -d / 2, d / 2);
  const kinds: Array<{ color: number[]; r: number; sy?: number; sz?: number; proto?: 'ball' | 'roughBall' }> = [
    { color: [0xc8231d, 0xb01e1a, 0xd8402a], r: 0.075 }, // red apples
    { color: [0x9cc23a, 0x8fb530], r: 0.075 }, // green apples
    { color: [0xf28c1c, 0xf59a2a], r: 0.08, proto: 'roughBall' }, // oranges
    { color: [0xf4d93a], r: 0.065, sz: 1.35 }, // lemons
    { color: [0xc9b84a, 0xb7a640], r: 0.07, sy: 1.3 }, // pears
    { color: [0xd42a1e], r: 0.06 }, // tomatoes
    { color: [0xb08a5a, 0xa07a4a], r: 0.07, proto: 'roughBall' }, // potatoes
    { color: [0x6f2a6a], r: 0.045 }, // plums
  ];
  if (fill === 8) {
    // Bananas: bunches of bent fingers.
    for (let b = 0; b < 5; b++) {
      const bx = (rng() - 0.5) * (w - 0.18);
      const bz = (rng() - 0.5) * (d - 0.15);
      const ry = rng() * Math.PI;
      g.frame(bx, 0.05, bz, 0, ry, 0, () => {
        for (let f = 0; f < 4; f++) {
          g.add('thin', 0xf2d235, -0.07 + f * 0.035, 0.02 + (f % 2) * 0.01, 0, 0.035, 0.11, 0.035, 0, 0, Math.PI / 2 - 0.5);
          g.add('thin', 0xe8c62c, -0.07 + f * 0.035, 0.02 + (f % 2) * 0.01, 0, 0.033, 0.11, 0.033, 0, 0, Math.PI / 2 + 0.5);
        }
      });
    }
    return;
  }
  if (fill === 9) {
    // Melons.
    for (const [x, z] of [[-0.12, -0.08], [0.13, -0.06], [0, 0.12]]) g.add('ball', rng() < 0.5 ? 0x5e8a2e : 0xd9c66a, x * w * 2.2, 0.13, z * d * 2, 0.26, 0.22, 0.24);
    return;
  }
  const k = kinds[fill % kinds.length];
  const step = k.r * 1.85;
  // One heaped layer on a bed of the same colour (looks full without a second layer of fruit).
  g.slab(k.color[0], -w / 2 + 0.02, w / 2 - 0.02, 0.02, 0.02 + k.r, -d / 2 + 0.02, d / 2 - 0.02);
  for (let x = -w / 2 + k.r + 0.02; x < w / 2 - k.r; x += step) {
    for (let z = -d / 2 + k.r + 0.02; z < d / 2 - k.r; z += step) {
      const color = k.color[Math.floor(rng() * k.color.length)];
      const s = k.r * 2 * (0.9 + rng() * 0.2);
      g.add(k.proto ?? 'ball', color, x + (rng() - 0.5) * 0.02, 0.02 + k.r * 1.6, z + (rng() - 0.5) * 0.02, s, s * (k.sy ?? 1), s * (k.sz ?? 1), rng() * 3, rng() * 3, 0);
    }
  }
}

/** Everything inside: shelves and their goods, crates, bread, water, the checkout, baskets. */
function interior(seed: string): THREE.BufferGeometry {
  const rng = alea(seed);
  const g = new Goods();
  const fx = (name: Fixture['name']) => SHOP_FIXTURES.find((f) => f.name === name)!;

  // Back wall shelves: their back against the wall, front (+Z) into the room.
  {
    const f = fx('shelvesBack');
    g.frame(f.x0, FLOOR, f.z0, 0, 0, 0, () => shelfUnit(g, rng, f.x1 - f.x0, f.z1 - f.z0, [0.15, 0.55, 0.95, 1.35], f.top));
  }

  // The middle shelf, stocked on both sides.
  {
    const f = fx('gondola');
    const mid = (f.z0 + f.z1) / 2;
    const half = (f.z1 - f.z0) / 2;
    g.frame(f.x0, FLOOR, mid, 0, 0, 0, () => shelfUnit(g, rng, f.x1 - f.x0, half, [0.15, 0.55, 0.95], f.top));
    g.frame(f.x1, FLOOR, mid, 0, Math.PI, 0, () => shelfUnit(g, rng, f.x1 - f.x0, half, [0.15, 0.55, 0.95], f.top, false));
  }

  // Fruit and vegetables: two tiers of tilted crates on a wooden stand along the left wall, facing +X.
  {
    const f = fx('fruit');
    const len = f.z1 - f.z0;
    g.slab(DARK_WOOD, f.x0, f.x1, FLOOR, FLOOR + 0.62, f.z0, f.z1);
    g.slab(DARK_WOOD, f.x0, f.x0 + 0.35, FLOOR + 0.62, FLOOR + 0.85, f.z0, f.z1);
    const n = Math.floor(len / 0.5);
    const cw = len / n;
    let fill = Math.floor(rng() * 10);
    for (let i = 0; i < n; i++) {
      const z = f.z0 + cw * (i + 0.5);
      // Front tier (lower, tilted towards the room) and back tier (higher).
      g.frame(f.x1 - 0.24, FLOOR + 0.66, z, 0, Math.PI / 2, -0.25, () => crate(g, rng, cw - 0.04, 0.44, fill++ % 10));
      g.frame(f.x0 + 0.2, FLOOR + 0.88, z, 0, Math.PI / 2, -0.3, () => crate(g, rng, cw - 0.04, 0.36, fill++ % 10));
    }
  }

  // Bread rack on the right wall: slanted wooden shelves with loaves, rolls and a basket of baguettes.
  {
    const f = fx('bread');
    const len = f.z1 - f.z0;
    g.slab(DARK_WOOD, f.x1 - 0.03, f.x1, FLOOR, FLOOR + f.top, f.z0, f.z1);
    for (const z of [f.z0, f.z1 - 0.03]) g.slab(DARK_WOOD, f.x0, f.x1, FLOOR, FLOOR + f.top, z, z + 0.03);
    for (const [i, y] of [0.25, 0.65, 1.05, 1.45].entries()) {
      // Each board tilts down towards the room (−X).
      g.frame((f.x0 + f.x1) / 2, FLOOR + y, (f.z0 + f.z1) / 2, 0, 0, 0.18, () => {
        g.slab(WOOD, -0.35, 0.35, -0.02, 0, -len / 2 + 0.03, len / 2 - 0.03);
        g.slab(WOOD, -0.35, -0.33, 0, 0.06, -len / 2 + 0.03, len / 2 - 0.03); // lip
        for (let z = -len / 2 + 0.16; z < len / 2 - 0.12; z += i % 2 ? 0.27 : 0.14) {
          if (i % 2) {
            // Loaves, a few darker rye.
            const c = rng() < 0.3 ? 0x6e4527 : rng() < 0.5 ? 0xc68a46 : 0xb5773a;
            for (const x of [-0.17, 0.12]) g.add('ball', c, x, 0.07, z, 0.24, 0.13, 0.2, 0, rng() * 0.3, 0);
          } else {
            // Rolls.
            for (const x of [-0.2, 0, 0.2]) g.add('ball', 0xd39a52, x + (rng() - 0.5) * 0.04, 0.045, z, 0.11, 0.08, 0.11, 0, rng() * 3, 0);
          }
        }
      });
    }
    // Basket of baguettes on the floor in front of the rack.
    const bx = f.x0 - 0.3;
    const bz = f.z1 - 0.3;
    g.add('can', 0x8c6239, bx, FLOOR, bz, 0.4, 0.35, 0.4);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.add('thin', 0xd9a35c, bx + Math.cos(a) * 0.09, FLOOR + 0.15, bz + Math.sin(a) * 0.09, 0.055, 0.65, 0.055, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    }
  }

  // Water: shrink-wrapped six-packs stacked on a pallet, the top layer showing its bottles.
  {
    const f = fx('water');
    g.slab(0xb08d5e, f.x0, f.x1, FLOOR, FLOOR + 0.12, f.z0, f.z1);
    const packW = 0.27;
    const packD = 0.18;
    const nx = Math.floor((f.x1 - f.x0) / packW);
    const nz = Math.floor((f.z1 - f.z0) / packD);
    const layers = 3;
    const h = (f.top - 0.12) / layers;
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const x = f.x0 + (i + 0.5) * ((f.x1 - f.x0) / nx);
          const z = f.z0 + (j + 0.5) * ((f.z1 - f.z0) / nz);
          const y = FLOOR + 0.12 + l * h;
          if (l < layers - 1) {
            g.add('box', WATER_BLUE, x, y, z, packW - 0.01, h - 0.005, packD - 0.01);
            g.add('box', 0x2a63b8, x, y + h * 0.35, z, packW - 0.005, 0.06, packD - 0.005); // label band
          } else {
            for (let a = 0; a < 3; a++) {
              for (let b = 0; b < 2; b++) {
                const bx = x + (a - 1) * 0.085;
                const bz = z + (b - 0.5) * 0.085;
                g.add('can', WATER_BLUE, bx, y, bz, 0.08, h * 0.72, 0.08);
                g.add('cone', WATER_BLUE, bx, y + h * 0.72, bz, 0.08, h * 0.2, 0.08);
                g.add('box', 0x2a63b8, bx, y + h * 0.92, bz, 0.03, 0.02, 0.03);
              }
            }
          }
        }
      }
    }
  }

  // Checkout: counter, belt, till, card terminal and a little rack of sweets facing the queue.
  {
    const f = fx('checkout');
    g.slab(0x2f3a45, f.x0, f.x1, FLOOR, FLOOR + f.top - 0.04, f.z0, f.z1);
    g.slab(0xd8d4cc, f.x0 - 0.02, f.x1 + 0.02, FLOOR + f.top - 0.04, FLOOR + f.top, f.z0 - 0.02, f.z1 + 0.02);
    g.slab(0x1a1a1a, f.x0 + 0.05, f.x1 - 0.7, FLOOR + f.top, FLOOR + f.top + 0.015, f.z0 + 0.1, f.z1 - 0.15);
    g.frame(f.x1 - 0.35, FLOOR + f.top, (f.z0 + f.z1) / 2, 0, -Math.PI / 2, 0, () => {
      g.slab(0x2b2b2b, -0.22, 0.22, 0, 0.12, -0.18, 0.18); // till drawer
      g.add('box', 0x1c1c1c, 0, 0.12, -0.05, 0.06, 0.15, 0.06);
      g.add('box', 0x13202c, 0, 0.27, -0.05, 0.32, 0.22, 0.03, -0.3); // screen
      g.add('box', 0x303030, 0.32, 0, 0.1, 0.09, 0.05, 0.17, 0.25); // card terminal
    });
    // Sweets rack on the front (queue) side.
    for (let y = 0.2; y < 0.8; y += 0.2) {
      for (let x = f.x0 + 0.1; x < f.x1 - 0.1; x += 0.11) g.add('box', PACKAGING[Math.floor(rng() * PACKAGING.length)], x, FLOOR + y, f.z0 - 0.06, 0.09, 0.14, 0.05);
    }
  }

  // A stack of red shopping baskets by the door.
  for (let i = 0; i < 5; i++) {
    const x = -1.25;
    const z = 2.75;
    const y = FLOOR + i * 0.07;
    g.slab(0xc8231d, x - 0.25, x + 0.25, y, y + 0.02, z - 0.17, z + 0.17);
    for (const s of [-1, 1]) g.slab(0xc8231d, x - 0.25, x + 0.25, y, y + 0.2, z + s * 0.17 - 0.01, z + s * 0.17 + 0.01);
    for (const s of [-1, 1]) g.slab(0xc8231d, x + s * 0.25 - 0.01, x + s * 0.25 + 0.01, y, y + 0.2, z - 0.17, z + 0.17);
  }

  // Ceiling light panels.
  for (const x of [-3, 0, 3]) for (const z of [-1.8, 1.0]) g.slab(0xffffff, x - 0.6, x + 0.6, CEIL - 0.03, CEIL, z - 0.3, z + 0.3);

  return g.build();
}

// ---- The shop ----------------------------------------------------------------------------------------

/** Materials all shops share (built once). */
export class ShopAssets {
  readonly outside = new THREE.MeshStandardMaterial({ color: new THREE.Color(SHOP.color), roughness: 0.85, flatShading: true });
  readonly aluminium = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xb8bcc0), roughness: 0.4, metalness: 0.6 });
  readonly awning: THREE.MeshStandardMaterial;
  readonly walls = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f2ec), vertexColors: true });
  readonly ceiling = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeeece6) });
  readonly floor: THREE.MeshBasicMaterial;
  readonly goods = new THREE.MeshBasicMaterial({ vertexColors: true });
  readonly sign: THREE.MeshStandardMaterial;
  readonly cards: THREE.MeshBasicMaterial[];
  private goodsGeometry?: THREE.BufferGeometry;

  /** Furniture and goods: the same in every shop, built on first use (~10 ms), then shared. */
  get interior(): THREE.BufferGeometry {
    return (this.goodsGeometry ??= interior('village shop'));
  }

  constructor() {
    const stripes = canvasTexture(awningCanvas());
    stripes.wrapS = THREE.RepeatWrapping;
    stripes.repeat.set(SHOP_WINDOWS.width / 1.6, 1);
    this.awning = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.9, side: THREE.DoubleSide });
    const tiles = canvasTexture(tileCanvas());
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    tiles.repeat.set(W / 1.2, D / 1.2);
    this.floor = new THREE.MeshBasicMaterial({ map: tiles });
    const sign = canvasTexture(signCanvas());
    this.sign = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.12 });
    this.cards = [
      ['FRUIT & VEG', '#2f7d47'],
      ['BAKERY', '#b5773a'],
      ['WATER', '#2a63b8'],
    ].map(([text, color]) => new THREE.MeshBasicMaterial({ map: canvasTexture(cardCanvas(text, color)) }));
  }

  setNight(night: number): void {
    this.sign.emissiveIntensity = 0.12 + 0.6 * night;
  }
}

export class ShopModel {
  readonly group = new THREE.Group();
  /** the glass door (click to open/close); rotates around its hinge */
  readonly door = new THREE.Group();
  doorOpen = false;
  private readonly inside = new THREE.Group();
  private readonly glass: THREE.MeshStandardMaterial;
  private doorAmount = 0;
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor(
    site: MarinaHouseSite,
    private readonly assets: ShopAssets,
    house: MarinaHouseAssets,
  ) {
    this.group.position.set(site.x, site.y, site.z);
    this.group.rotation.y = site.rotY;
    // Shop windows you can see into while the interior is drawn; dark glass otherwise.
    this.glass = new THREE.MeshStandardMaterial({ color: 0x9fb6c4, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.25, depthWrite: false });
    this.owned.push(this.glass);
    this.buildShell(house);
    this.buildInside();
    this.group.add(this.inside);
  }

  get passable(): boolean {
    return this.doorOpen && this.doorAmount > 0.8;
  }

  update(dt: number, near: boolean, night: number): void {
    this.inside.visible = near;
    this.glass.opacity = near ? 0.22 : 0.85;
    this.glass.emissive.setRGB(1, 0.85, 0.6).multiplyScalar(near ? 0 : night * 0.5);
    this.doorAmount = THREE.MathUtils.clamp(this.doorAmount + (this.doorOpen ? dt : -dt) / DOOR_SWING, 0, 1);
    this.door.rotation.y = THREE.MathUtils.smoothstep(this.doorAmount, 0, 1) * Math.PI * 0.5;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.group): THREE.Mesh {
    this.owned.push(geo);
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  private buildShell(house: MarinaHouseAssets): void {
    const a = this.assets;
    const hw = W / 2;
    const hd = D / 2;
    const dh = SHOP_DOOR.halfWidth;
    const win = SHOP_WINDOWS;
    const walls: THREE.BufferGeometry[] = [
      slab(-hw, hw, 0, H, -hd, -hd + T),
      slab(-hw, -hw + T, 0, H, -hd + T, hd - T),
      slab(hw - T, hw, 0, H, -hd + T, hd - T),
      slab(-hw + T, hw - T, 0, FLOOR, -hd + T, hd - T), // floor slab
      slab(-hw + T, hw - T, CEIL, CEIL + 0.05, -hd + T, hd - T), // ceiling slab (the roof is the village's)
    ];
    // Front: piers between door and windows, below and above the windows, over the door.
    const [l0, l1] = [win.xs[0] - win.width / 2, win.xs[0] + win.width / 2];
    const [r0, r1] = [win.xs[1] - win.width / 2, win.xs[1] + win.width / 2];
    const front = (x0: number, x1: number, y0: number, y1: number) => walls.push(slab(x0, x1, y0, y1, hd - T, hd));
    front(-hw, l0, 0, H);
    front(l0, l1, 0, win.bottom);
    front(l1, -dh, 0, H);
    front(dh, r0, 0, H);
    front(r0, r1, 0, win.bottom);
    front(r1, hw, 0, H);
    front(l0, r1, Math.max(win.top, FLOOR + SHOP_DOOR.height), H); // one lintel over windows and door
    const shell = this.mesh(mergeGeometries(walls)!, a.outside);
    shell.castShadow = shell.receiveShadow = true;

    // Stone plinth and steps (as at the marina house).
    const deep = -3;
    const st = SHOP_STEPS;
    const stones = [slab(-hw - 0.04, hw + 0.04, deep, FLOOR - 0.01, -hd - 0.04, hd + 0.04), slab(-st.halfWidth, st.halfWidth, deep, FLOOR - 0.005, hd, hd + st.landing)];
    for (let i = 1; i <= st.count; i++) {
      const z0 = hd + st.landing + (i - 1) * st.run;
      stones.push(slab(-st.halfWidth, st.halfWidth, deep - i * st.rise, FLOOR - (i - 0.5) * st.rise, z0, z0 + st.run));
    }
    this.mesh(mergeGeometries(stones)!, house.stone).receiveShadow = true;

    // Window glass and aluminium frames.
    const panes: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    for (const x of win.xs) {
      const [x0, x1] = [x - win.width / 2, x + win.width / 2];
      panes.push(slab(x0, x1, win.bottom, win.top, hd - T / 2 - 0.01, hd - T / 2 + 0.01));
      frames.push(
        slab(x0, x1, win.bottom - 0.05, win.bottom, hd - T / 2 - 0.04, hd + 0.02),
        slab(x0, x1, win.top, win.top + 0.05, hd - T / 2 - 0.04, hd + 0.02),
        slab(x - 0.025, x + 0.025, win.bottom, win.top, hd - T / 2 - 0.04, hd - T / 2 + 0.04),
      );
    }
    frames.push(
      slab(-dh - 0.06, -dh, 0, FLOOR + SHOP_DOOR.height + 0.06, hd - T, hd + 0.02),
      slab(dh, dh + 0.06, 0, FLOOR + SHOP_DOOR.height + 0.06, hd - T, hd + 0.02),
      slab(-dh - 0.06, dh + 0.06, FLOOR + SHOP_DOOR.height, FLOOR + SHOP_DOOR.height + 0.06, hd - T, hd + 0.02),
    );
    this.mesh(mergeGeometries(panes)!, this.glass).renderOrder = 1;
    this.mesh(mergeGeometries(frames)!, a.aluminium);

    // Striped awnings over the windows, sloping out and down, with a short valance.
    for (const x of win.xs) {
      const len = Math.hypot(AWNING.depth, AWNING.drop);
      const tilt = Math.atan2(AWNING.drop, AWNING.depth);
      const top = win.top + 0.35;
      const awning = this.mesh(new THREE.PlaneGeometry(win.width + 0.2, len).rotateX(-Math.PI / 2 + tilt).translate(x, top - AWNING.drop / 2, hd + AWNING.depth / 2), a.awning);
      awning.castShadow = true;
      this.mesh(new THREE.PlaneGeometry(win.width + 0.2, 0.18).translate(x, top - AWNING.drop - 0.09, hd + AWNING.depth), a.awning);
    }

    // Sign board over the door.
    const s = SHOP_SIGN;
    this.mesh(new THREE.BoxGeometry(s.width + 0.12, s.height + 0.12, 0.06).translate(0, s.centreY, hd + 0.03), house.trim);
    this.mesh(new THREE.PlaneGeometry(s.width, s.height).translate(0, s.centreY, hd + 0.062), a.sign);

    // Glass door: aluminium frame, a pane, a push bar; hinged on the left post.
    this.door.position.set(-dh, FLOOR, hd - T / 2);
    this.group.add(this.door);
    const lw = dh * 2 - 0.02;
    const lh = SHOP_DOOR.height - 0.02;
    const leaf = [
      slab(0.01, 0.08, 0, lh, -0.03, 0.03),
      slab(lw - 0.06, lw, 0, lh, -0.03, 0.03),
      slab(0.01, lw, 0, 0.14, -0.03, 0.03),
      slab(0.01, lw, lh - 0.08, lh, -0.03, 0.03),
      slab(0.12, lw - 0.1, 1.0, 1.04, 0.03, 0.07), // push bar outside
      slab(0.12, lw - 0.1, 1.0, 1.04, -0.07, -0.03), // and inside
    ];
    this.mesh(mergeGeometries(leaf)!, a.aluminium, this.door).castShadow = true;
    this.mesh(slab(0.08, lw - 0.06, 0.14, lh - 0.08, -0.008, 0.008), this.glass, this.door).renderOrder = 1;
  }

  private buildInside(): void {
    const a = this.assets;
    const x0 = -W / 2 + T + 0.01;
    const x1 = W / 2 - T - 0.01;
    const z0 = -D / 2 + T + 0.01;
    const z1 = D / 2 - T - 0.01;
    const win = SHOP_WINDOWS;
    const dh = SHOP_DOOR.halfWidth;
    const [l0, l1] = [win.xs[0] - win.width / 2, win.xs[0] + win.width / 2];
    const [r0, r1] = [win.xs[1] - win.width / 2, win.xs[1] + win.width / 2];
    // Front wall from inside (looking +Z, +X is on the left: faces run from +X to −X).
    const face = (xa: number, xb: number, y0: number, y1: number) => wallFace(xb, z1, xa, z1, y0, y1, 0.9);
    const lintel = Math.max(win.top, FLOOR + SHOP_DOOR.height);
    this.mesh(
      mergeGeometries([
        wallFace(x0, z0, x1, z0, FLOOR, CEIL, 1),
        wallFace(x0, z1, x0, z0, FLOOR, CEIL, 0.94),
        wallFace(x1, z0, x1, z1, FLOOR, CEIL, 0.94),
        face(x0, l0, FLOOR, CEIL),
        face(l0, l1, FLOOR, win.bottom),
        face(l1, -dh, FLOOR, CEIL),
        face(dh, r0, FLOOR, CEIL),
        face(r0, r1, FLOOR, win.bottom),
        face(r1, x1, FLOOR, CEIL),
        face(l0, r1, lintel, CEIL),
      ])!,
      a.walls,
      this.inside,
    );
    this.mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate(0, FLOOR + 0.002, 0), a.floor, this.inside);
    this.mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(Math.PI / 2).translate(0, CEIL - 0.001, 0), a.ceiling, this.inside);
    this.inside.add(new THREE.Mesh(a.interior, a.goods)); // shared: not disposed with the shop

    // Department cards hanging over the fruit, the bread and the water.
    const card = (m: THREE.Material, x: number, z: number, rotY: number) => {
      // Readable from both sides: two planes back to back.
      for (const r of [rotY, rotY + Math.PI]) this.mesh(new THREE.PlaneGeometry(0.75, 0.28).rotateY(r).translate(x, CEIL - 0.45, z), m, this.inside);
    };
    const fruit = SHOP_FIXTURES.find((f) => f.name === 'fruit')!;
    const bread = SHOP_FIXTURES.find((f) => f.name === 'bread')!;
    const water = SHOP_FIXTURES.find((f) => f.name === 'water')!;
    card(a.cards[0], fruit.x1 + 0.2, (fruit.z0 + fruit.z1) / 2, Math.PI / 2);
    card(a.cards[1], bread.x0 - 0.2, (bread.z0 + bread.z1) / 2, -Math.PI / 2);
    card(a.cards[2], (water.x0 + water.x1) / 2, water.z0 - 0.1, 0);
  }
}
