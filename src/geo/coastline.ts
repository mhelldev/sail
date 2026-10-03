// Coastline segments in world space with spatial indexes for two questions:
//   - is a point on land?   → count crossings of a ray towards +X (coast loops are closed)
//   - how far to the coast? → nearest segment, searched in a uniform grid
// Plain data and loops only, so it can also run inside a Web Worker.

import type { LocalProjection } from './projection';

const CELL = 2000; // metres, grid cell for distance queries
const BAND = 1000; // metres, row band height for crossing queries

export interface CoastData {
  lines: number[][]; // flat [lon, lat, lon, lat, ...] polylines
}

export class Coastline {
  /** x0, z0, x1, z1 per segment */
  readonly segments: Float64Array;
  private readonly cells = new Map<string, number[]>();
  private readonly bands = new Map<number, number[]>();

  constructor(segments: Float64Array) {
    this.segments = segments;
    const s = segments;
    for (let i = 0; i < s.length / 4; i++) {
      const o = i * 4;
      const [x0, z0, x1, z1] = [s[o], s[o + 1], s[o + 2], s[o + 3]];
      for (let cx = Math.floor(Math.min(x0, x1) / CELL); cx <= Math.floor(Math.max(x0, x1) / CELL); cx++) {
        for (let cz = Math.floor(Math.min(z0, z1) / CELL); cz <= Math.floor(Math.max(z0, z1) / CELL); cz++) {
          push(this.cells, `${cx},${cz}`, i);
        }
      }
      if (z0 === z1) continue; // horizontal segments never cross a horizontal ray
      for (let b = Math.floor(Math.min(z0, z1) / BAND); b <= Math.floor(Math.max(z0, z1) / BAND); b++) {
        push(this.bands, b, i);
      }
    }
  }

  static fromData(data: CoastData, projection: LocalProjection): Coastline {
    const count = data.lines.reduce((n, l) => n + l.length / 2 - 1, 0);
    const segments = new Float64Array(count * 4);
    let o = 0;
    for (const line of data.lines) {
      let prev = projection.toWorld(line[0], line[1]);
      for (let i = 2; i < line.length; i += 2) {
        const cur = projection.toWorld(line[i], line[i + 1]);
        segments.set([prev.x, prev.z, cur.x, cur.z], o);
        o += 4;
        prev = cur;
      }
    }
    return new Coastline(segments);
  }

  get segmentCount(): number {
    return this.segments.length / 4;
  }

  isLand(x: number, z: number): boolean {
    const s = this.segments;
    let inside = false;
    for (const i of this.bands.get(Math.floor(z / BAND)) ?? []) {
      const o = i * 4;
      const z0 = s[o + 1];
      const z1 = s[o + 3];
      // Half-open test so a ray through a shared vertex is counted exactly once.
      if (z0 > z !== z1 > z) {
        const xCross = s[o] + ((z - z0) / (z1 - z0)) * (s[o + 2] - s[o]);
        if (xCross > x) inside = !inside;
      }
    }
    return inside;
  }

  /** Distance to the nearest coast segment, capped at `maxDist`. */
  distanceToCoast(x: number, z: number, maxDist: number): number {
    let best = maxDist * maxDist;
    for (const i of this.segmentsNear(x - maxDist, z - maxDist, x + maxDist, z + maxDist)) {
      best = Math.min(best, segmentDistSq(this.segments, i, x, z));
    }
    return Math.sqrt(best);
  }

  /** Distance to the coast, positive on land and negative at sea, clamped to ±maxDist. */
  signedDistance(x: number, z: number, maxDist: number): number {
    const d = this.distanceToCoast(x, z, maxDist);
    return this.isLand(x, z) ? d : -d;
  }

  /**
   * Signed distances on an n×n grid starting at (x0, z0) with spacing `step`, row by row
   * (index = row * n + col, rows along +Z). Uses one scanline per row for the sign,
   * which is much faster than testing every point separately.
   */
  sampleGrid(x0: number, z0: number, step: number, n: number, maxDist: number): Float32Array {
    const out = new Float32Array(n * n);
    const span = step * (n - 1);
    const candidates = this.segmentsNear(x0 - maxDist, z0 - maxDist, x0 + span + maxDist, z0 + span + maxDist);
    const s = this.segments;
    const maxSq = maxDist * maxDist;
    const crossings: number[] = [];

    for (let row = 0; row < n; row++) {
      const z = z0 + row * step;
      // Sign: collect crossings of this row, then sweep left to right.
      crossings.length = 0;
      for (const i of this.bands.get(Math.floor(z / BAND)) ?? []) {
        const o = i * 4;
        const za = s[o + 1];
        const zb = s[o + 3];
        if (za > z !== zb > z) crossings.push(s[o] + ((z - za) / (zb - za)) * (s[o + 2] - s[o]));
      }
      crossings.sort((a, b) => a - b);

      for (let col = 0; col < n; col++) {
        const x = x0 + col * step;
        let best = maxSq;
        for (const i of candidates) {
          const d = segmentDistSq(s, i, x, z);
          if (d < best) best = d;
        }
        // Number of crossings strictly to the right of x decides inside/outside.
        const right = crossings.length - upperBound(crossings, x);
        const dist = Math.sqrt(best);
        out[row * n + col] = right % 2 === 1 ? dist : -dist;
      }
    }
    return out;
  }

  /** Land (1) / water (0) on an n×n grid, laid out like `sampleGrid`. Sign only, so it is cheap. */
  sampleLandMask(x0: number, z0: number, step: number, n: number): Uint8Array {
    const out = new Uint8Array(n * n);
    const s = this.segments;
    const crossings: number[] = [];
    for (let row = 0; row < n; row++) {
      const z = z0 + row * step;
      crossings.length = 0;
      for (const i of this.bands.get(Math.floor(z / BAND)) ?? []) {
        const o = i * 4;
        const za = s[o + 1];
        const zb = s[o + 3];
        if (za > z !== zb > z) crossings.push(s[o] + ((z - za) / (zb - za)) * (s[o + 2] - s[o]));
      }
      crossings.sort((a, b) => a - b);
      // Sweep left to right, flipping at each crossing.
      let next = upperBound(crossings, x0 - step);
      let inside = (crossings.length - next) % 2 === 1;
      for (let col = 0; col < n; col++) {
        const x = x0 + col * step;
        while (next < crossings.length && crossings[next] <= x) {
          inside = !inside;
          next++;
        }
        out[row * n + col] = inside ? 1 : 0;
      }
    }
    return out;
  }

  /** Segment indices (deduplicated) whose grid cells overlap the rectangle. */
  segmentsNear(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const found = new Set<number>();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        for (const i of this.cells.get(`${cx},${cz}`) ?? []) found.add(i);
      }
    }
    return [...found];
  }
}

function push<K>(map: Map<K, number[]>, key: K, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function segmentDistSq(s: Float64Array, i: number, x: number, z: number): number {
  const o = i * 4;
  const ax = s[o];
  const az = s[o + 1];
  const dx = s[o + 2] - ax;
  const dz = s[o + 3] - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + t * dx - x;
  const pz = az + t * dz - z;
  return px * px + pz * pz;
}

/** Index of the first element greater than `v` in a sorted array. */
function upperBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
