import * as THREE from 'three';
import { SHORE_RANGE } from './waves';

export type ShoreCompute = (x0: number, z0: number, step: number, res: number) => Promise<Uint8Array>;

/**
 * Signed distance to the coast on a grid around the boat, packed into bytes
 * (0 = SHORE_RANGE out at sea, 255 = SHORE_RANGE inland). The water shader samples it
 * as a texture and the boat samples the same bytes on the CPU, so both see the same shore.
 */
export class ShoreMap {
  readonly texture: THREE.DataTexture;
  /** world position of texel (0, 0) and spacing between texels */
  x0 = 0;
  z0 = 0;
  step: number;
  valid = false;

  private data: Uint8Array;
  private pending = false;

  constructor(
    private readonly compute: ShoreCompute,
    readonly size = 6000,
    readonly res = 384,
  ) {
    this.step = size / res;
    this.data = new Uint8Array(res * res);
    this.texture = new THREE.DataTexture(this.data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** Recentre on the boat once it has used up a fifth of the map. */
  update(x: number, z: number): void {
    if (this.pending) return;
    const cx = this.x0 + this.size / 2;
    const cz = this.z0 + this.size / 2;
    if (this.valid && Math.hypot(x - cx, z - cz) < this.size / 5) return;
    // Snap to whole texels so successive maps line up exactly.
    const x0 = Math.round((x - this.size / 2) / this.step) * this.step;
    const z0 = Math.round((z - this.size / 2) / this.step) * this.step;
    this.pending = true;
    this.compute(x0, z0, this.step, this.res).then((data) => {
      this.pending = false;
      this.data = data;
      this.texture.image.data = data;
      this.texture.needsUpdate = true;
      this.x0 = x0;
      this.z0 = z0;
      this.valid = true;
    });
  }

  /** Bilinear sample, identical to the GPU's linear filtering. Open sea outside the map. */
  sample(x: number, z: number): number {
    if (!this.valid) return -SHORE_RANGE;
    const fx = (x - this.x0) / this.step;
    const fz = (z - this.z0) / this.step;
    const max = this.res - 1;
    if (fx < 0 || fz < 0 || fx > max || fz > max) return -SHORE_RANGE;
    const i = Math.min(Math.floor(fx), max - 1);
    const j = Math.min(Math.floor(fz), max - 1);
    const tx = fx - i;
    const tz = fz - j;
    const d = this.data;
    const r = this.res;
    const top = d[j * r + i] * (1 - tx) + d[j * r + i + 1] * tx;
    const bottom = d[(j + 1) * r + i] * (1 - tx) + d[(j + 1) * r + i + 1] * tx;
    const v = (top * (1 - tz) + bottom * tz) / 255;
    return v * 2 * SHORE_RANGE - SHORE_RANGE;
  }

}
