// Routes through water: A* on a coarse grid (blocked = land plus a safety margin), then the
// path is pulled tight into a few straight legs. Pure, so it is easy to test.

export interface Point {
  x: number;
  z: number;
}

/** n × n cells starting at (x0, z0); cell (col, row) covers x0 + col·step … (row along +Z). */
export interface WaterGrid {
  x0: number;
  z0: number;
  step: number;
  n: number;
  /** 1 = blocked */
  blocked: Uint8Array;
}

/** Marks every cell within `cells` of a blocked cell as blocked too (keeps routes off the coast). */
export function dilate(grid: WaterGrid, cells: number): WaterGrid {
  if (cells <= 0) return grid;
  const { n } = grid;
  let src = grid.blocked;
  // Repeated 4-neighbour growth: cheap and good enough for a coarse margin.
  for (let k = 0; k < cells; k++) {
    const out = src.slice();
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!src[row * n + col]) continue;
        if (col > 0) out[row * n + col - 1] = 1;
        if (col < n - 1) out[row * n + col + 1] = 1;
        if (row > 0) out[(row - 1) * n + col] = 1;
        if (row < n - 1) out[(row + 1) * n + col] = 1;
      }
    }
    src = out;
  }
  return { ...grid, blocked: src };
}

const cellOf = (g: WaterGrid, p: Point) => ({
  col: Math.round((p.x - g.x0) / g.step),
  row: Math.round((p.z - g.z0) / g.step),
});
const inside = (g: WaterGrid, col: number, row: number) => col >= 0 && row >= 0 && col < g.n && row < g.n;
const free = (g: WaterGrid, col: number, row: number) => inside(g, col, row) && !g.blocked[row * g.n + col];

/** Nearest free cell to a point, searching outwards up to `maxRing` cells. */
function nearestFree(g: WaterGrid, p: Point, maxRing = 12): { col: number; row: number } | undefined {
  const c = cellOf(g, p);
  for (let r = 0; r <= maxRing; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        if (free(g, c.col + dc, c.row + dr)) return { col: c.col + dc, row: c.row + dr };
      }
    }
  }
  return undefined;
}

/** Straight line between two cells stays in free cells (supercover-ish sampling). */
export function lineOfSight(g: WaterGrid, a: { col: number; row: number }, b: { col: number; row: number }): boolean {
  const steps = Math.ceil(Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row)) * 2) + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = Math.round(a.col + (b.col - a.col) * t);
    const row = Math.round(a.row + (b.row - a.row) * t);
    if (!free(g, col, row)) return false;
  }
  return true;
}

/**
 * Shortest water route from `from` to `to` as a polyline (first and last point are the given
 * ones), or undefined when they aren't connected by water within the grid.
 */
export function findWaterPath(g: WaterGrid, from: Point, to: Point): Point[] | undefined {
  const start = nearestFree(g, from);
  const goal = nearestFree(g, to);
  if (!start || !goal) return undefined;
  const n = g.n;
  const startId = start.row * n + start.col;
  const goalId = goal.row * n + goal.col;

  const gScore = new Float32Array(n * n).fill(Infinity);
  const cameFrom = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = new MinHeap();
  const h = (id: number) => {
    const dc = Math.abs((id % n) - goal.col);
    const dr = Math.abs(Math.floor(id / n) - goal.row);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr); // octile distance
  };
  gScore[startId] = 0;
  heap.push(startId, h(startId));

  const DIRS: Array<[number, number, number]> = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];
  let found = false;
  while (heap.size) {
    const id = heap.pop();
    if (id === goalId) {
      found = true;
      break;
    }
    if (closed[id]) continue;
    closed[id] = 1;
    const col = id % n;
    const row = Math.floor(id / n);
    for (const [dc, dr, cost] of DIRS) {
      const c = col + dc;
      const r = row + dr;
      if (!free(g, c, r)) continue;
      // No cutting corners diagonally past land.
      if (dc && dr && (!free(g, col + dc, row) || !free(g, col, row + dr))) continue;
      const nid = r * n + c;
      if (closed[nid]) continue;
      const tentative = gScore[id] + cost;
      if (tentative < gScore[nid]) {
        gScore[nid] = tentative;
        cameFrom[nid] = id;
        heap.push(nid, tentative + h(nid));
      }
    }
  }
  if (!found && startId !== goalId) return undefined;

  // Walk back, then keep only the corners needed to stay in water.
  const cells: Array<{ col: number; row: number }> = [];
  for (let id = goalId; id !== -1; id = id === startId ? -1 : cameFrom[id]) cells.push({ col: id % n, row: Math.floor(id / n) });
  cells.reverse();
  const corners = [cells[0]];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!lineOfSight(g, cells[anchor], cells[i])) {
      corners.push(cells[i - 1]);
      anchor = i - 1;
    }
  }
  if (cells.length > 1) corners.push(cells[cells.length - 1]);
  const toPoint = (c: { col: number; row: number }) => ({ x: g.x0 + c.col * g.step, z: g.z0 + c.row * g.step });
  return [from, ...corners.slice(1, -1).map(toPoint), to];
}

/** Binary min-heap of (id, priority). */
class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, priority: number): void {
    this.ids.push(id);
    this.pri.push(priority);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.pri[p] <= this.pri[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastPri = this.pri.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.pri[0] = lastPri;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.ids.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}
