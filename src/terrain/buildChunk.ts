// Builds the mesh arrays for one terrain chunk. Pure (no three.js) so it runs in a
// Web Worker and in unit tests.

import type { Coastline } from '../geo/coastline';
import type { TerrainSampler } from './height';

export interface ChunkRequest {
  /** world position of the chunk's north-west corner */
  x0: number;
  z0: number;
  /** edge length in metres */
  size: number;
  /** grid cells per edge */
  res: number;
}

export interface ChunkMesh {
  empty: boolean;
  /** vertex positions relative to (x0, 0, z0) */
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  minHeight: number;
  maxHeight: number;
}

const SKIRT_DEPTH = 40; // metres; hides cracks between chunks of different resolution

const EMPTY: ChunkMesh = {
  empty: true,
  positions: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
  minHeight: 0,
  maxHeight: 0,
};

export function buildChunk(req: ChunkRequest, coast: Coastline, sampler: TerrainSampler): ChunkMesh {
  const { x0, z0, size, res } = req;
  const n = res + 1;
  const step = size / res;
  // Distances beyond the coastal falloff don't change the height, so cap the search there.
  const maxDist = Math.max(sampler.params.coastFalloff, 200);
  const sd = coast.sampleGrid(x0, z0, step, n, maxDist);

  let anyLand = false;
  for (let i = 0; i < sd.length; i++) if (sd[i] > 0) anyLand = true;
  if (!anyLand) return EMPTY;

  const heights = new Float32Array(n * n);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const h = sampler.height(sd[i], x0 + col * step, z0 + row * step);
      heights[i] = h;
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);
    }
  }

  const skirtVerts = 4 * n;
  const positions = new Float32Array((n * n + skirtVerts) * 3);
  const colors = new Float32Array((n * n + skirtVerts) * 3);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const h = heights[i];
      positions[i * 3] = col * step;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = row * step;
      // Slope from central differences (clamped at the chunk border).
      const hl = heights[row * n + Math.max(0, col - 1)];
      const hr = heights[row * n + Math.min(res, col + 1)];
      const hu = heights[Math.max(0, row - 1) * n + col];
      const hd = heights[Math.min(res, row + 1) * n + col];
      const dx = (hr - hl) / (step * (col > 0 && col < res ? 2 : 1));
      const dz = (hd - hu) / (step * (row > 0 && row < res ? 2 : 1));
      const ny = 1 / Math.sqrt(dx * dx + dz * dz + 1);
      sampler.color(h, ny, x0 + col * step, z0 + row * step, colors, i * 3);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const a = row * n + col;
      // Winding gives +Y facing triangles (Z grows southwards, X eastwards).
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }

  // Skirts: a strip hanging below each edge. Emitted with both windings so they are
  // visible from either side regardless of edge direction.
  const edges: number[][] = [
    Array.from({ length: n }, (_, c) => c), // north
    Array.from({ length: n }, (_, c) => res * n + c), // south
    Array.from({ length: n }, (_, r) => r * n), // west
    Array.from({ length: n }, (_, r) => r * n + res), // east
  ];
  let next = n * n;
  for (const edge of edges) {
    const start = next;
    for (const v of edge) {
      positions[next * 3] = positions[v * 3];
      positions[next * 3 + 1] = positions[v * 3 + 1] - SKIRT_DEPTH;
      positions[next * 3 + 2] = positions[v * 3 + 2];
      colors.copyWithin(next * 3, v * 3, v * 3 + 3);
      next++;
    }
    for (let k = 0; k < edge.length - 1; k++) {
      const t0 = edge[k];
      const t1 = edge[k + 1];
      const b0 = start + k;
      const b1 = start + k + 1;
      indices.push(t0, b0, t1, t1, b0, b1);
      indices.push(t0, t1, b0, t1, b1, b0);
    }
  }

  return {
    empty: false,
    positions,
    colors,
    indices: new Uint32Array(indices),
    minHeight: minHeight - SKIRT_DEPTH,
    maxHeight,
  };
}
