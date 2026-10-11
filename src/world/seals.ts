// Seals hauled out on low beaches near the waterline, as on Zeeland's shores and sandbanks. Colonies are
// placed per 500 m grid cell from a hash of the cell, so they are always in the same spots; only cells
// near the player are searched (once each) and drawn. One InstancedMesh for bodies, one for heads,
// which now and then lift and look around.

import * as THREE from 'three';
import type { Ground } from '../harbors/village';

const CELL = 500;
const RANGE = 1600; // metres around the player
const MAX = 60;

interface Seal {
  x: number;
  y: number;
  z: number;
  /** facing (radians around Y): towards the water */
  rotY: number;
  size: number;
  phase: number;
  /** grey seal (darker, bigger) or harbour seal */
  grey: boolean;
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  return (Math.imul(h, 0x2c1b3c6d) >>> 0) / 4294967296;
}

function rng(seed: number): () => number {
  let s = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where on a low, gently sloping beach a seal can lie (just above the waterline), or undefined. */
function beachSpot(ground: Ground, x: number, z: number): { y: number; rotY: number } | undefined {
  const sd = ground.sd(x, z);
  if (sd < 0.5 || sd > 20) return undefined;
  const y = ground.height(x, z);
  if (y < 0.1 || y > 3) return undefined;
  // Face the water: down the slope of the signed distance.
  const gx = ground.sd(x + 2, z) - ground.sd(x - 2, z);
  const gz = ground.sd(x, z + 2) - ground.sd(x, z - 2);
  return { y, rotY: Math.atan2(-gx, -gz) };
}

export class Seals {
  readonly group = new THREE.Group();
  private readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly cells = new Map<string, Seal[]>();
  private shown: Seal[] = [];
  private lastPlan = { x: Infinity, z: Infinity };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(private ground: Ground) {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
    // Body: a plump spindle along +Z (head end), lying on its belly; the head is separate.
    const body = new THREE.SphereGeometry(0.5, 12, 8).scale(0.55, 0.42, 1.5).translate(0, 0.2, 0);
    const flippers = new THREE.ConeGeometry(0.18, 0.4, 6).rotateX(Math.PI / 2).scale(1.6, 0.4, 1).translate(0, 0.12, -0.85);
    this.bodies = new THREE.InstancedMesh(merge(body, flippers), material, MAX);
    const head = new THREE.SphereGeometry(0.2, 10, 8).scale(1, 0.95, 1.25);
    const snout = new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.8, 1).translate(0, -0.03, 0.2);
    this.heads = new THREE.InstancedMesh(merge(head, snout), material, MAX);
    for (const mesh of [this.bodies, this.heads]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  setGround(ground: Ground): void {
    this.ground = ground;
    this.cells.clear();
    this.lastPlan = { x: Infinity, z: Infinity };
  }

  update(time: number, x: number, z: number): void {
    if (Math.hypot(x - this.lastPlan.x, z - this.lastPlan.z) > 150) this.plan(x, z);
    let n = 0;
    for (const seal of this.shown) {
      // Lying still, breathing; the head lifts and turns now and then.
      const breath = 1 + Math.sin(time * 1.3 + seal.phase) * 0.02;
      this.e.set(0, seal.rotY, 0);
      this.q.setFromEuler(this.e);
      this.s.set(seal.size, seal.size * breath, seal.size);
      this.m.compose(this.p.set(seal.x, seal.y, seal.z), this.q, this.s);
      this.bodies.setMatrixAt(n, this.m);
      const up = Math.max(0, Math.sin(time * 0.25 + seal.phase * 5)) ** 2; // 0 resting … 1 head up
      const look = Math.sin(time * 0.5 + seal.phase) * 0.6 * up;
      this.e.set(-0.5 * up, seal.rotY + look, 0);
      this.q.setFromEuler(this.e);
      const fwd = 0.75 * seal.size;
      this.p.set(seal.x + Math.sin(seal.rotY) * fwd, seal.y + (0.25 + 0.25 * up) * seal.size, seal.z + Math.cos(seal.rotY) * fwd);
      this.s.setScalar(seal.size);
      this.m.compose(this.p, this.q, this.s);
      this.heads.setMatrixAt(n, this.m);
      this.c.setHex(seal.grey ? 0x5d5a55 : 0x8a7f6e);
      this.bodies.setColorAt(n, this.c);
      this.heads.setColorAt(n, this.c);
      n++;
    }
    for (const mesh of [this.bodies, this.heads]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private plan(x: number, z: number): void {
    this.lastPlan = { x, z };
    const shown: Seal[] = [];
    const r = Math.ceil(RANGE / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const key = `${cx + i},${cz + j}`;
        let colony = this.cells.get(key);
        if (!colony) {
          colony = this.colony(cx + i, cz + j);
          this.cells.set(key, colony);
        }
        for (const seal of colony) if (Math.hypot(seal.x - x, seal.z - z) < RANGE && shown.length < MAX) shown.push(seal);
      }
    }
    this.shown = shown;
    if (this.cells.size > 400) this.cells.clear(); // far voyages: forget old cells
  }

  /** A colony in about 60 % of the cells that have a suitable beach. */
  private colony(i: number, j: number): Seal[] {
    if (hash(i, j) > 0.6) return [];
    const rand = rng(hash(j * 7 + 1, i * 13 + 5));
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = (i + rand()) * CELL;
      const z = (j + rand()) * CELL;
      const spot = beachSpot(this.ground, x, z);
      if (!spot) continue;
      const seals: Seal[] = [];
      const count = 2 + Math.floor(rand() * 6);
      for (let k = 0; k < count * 3 && seals.length < count; k++) {
        const sx = x + (rand() - 0.5) * 30;
        const sz = z + (rand() - 0.5) * 30;
        const s = beachSpot(this.ground, sx, sz);
        if (!s || seals.some((o) => Math.hypot(o.x - sx, o.z - sz) < 2.5)) continue;
        const grey = rand() < 0.3;
        seals.push({ x: sx, y: s.y, z: sz, rotY: s.rotY + (rand() - 0.5) * 1.2, size: (grey ? 1.4 : 1.15) * (0.85 + rand() * 0.3), phase: rand() * 10, grey });
      }
      return seals;
    }
    return [];
  }
}

function merge(...geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => g.toNonIndexed());
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const arrays = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const data = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) (data.set(a, o), (o += a.length));
    out.setAttribute(name, new THREE.BufferAttribute(data, 3));
  }
  return out;
}
