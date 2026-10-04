// Baked marinas, harbours and lighthouses (public/data/harbors.json, see scripts/bake-harbors.ts),
// projected into world space with a coarse grid for "what is near the boat" queries.
// Plain data, so the terrain workers can load it as well.

import type { LocalProjection } from '../geo/projection';
import type { FlattenSite } from '../terrain/flatten';

export interface Harbor {
  id: number;
  name: string;
  /** shore point on our coastline */
  x: number;
  z: number;
  /** unit vector pointing out to sea */
  seaX: number;
  seaZ: number;
  /** commercial/fishing harbour (bigger village, breakwaters) rather than a marina */
  isHarbour: boolean;
}

export interface Lighthouse {
  id: number;
  name: string;
  x: number;
  z: number;
}

interface HarborFile {
  harbors: Array<[name: string, lat: number, lon: number, seaHeading: number, isHarbour: 0 | 1]>;
  lighthouses: Array<[name: string, lat: number, lon: number]>;
}

const CELL = 5000;
const cellKey = (cx: number, cz: number) => (cx + 1048576) * 2097152 + (cz + 1048576);

class Grid<T extends { x: number; z: number }> {
  private readonly cells = new Map<number, T[]>();

  constructor(readonly items: T[]) {
    for (const it of items) {
      const key = cellKey(Math.floor(it.x / CELL), Math.floor(it.z / CELL));
      const list = this.cells.get(key);
      if (list) list.push(it);
      else this.cells.set(key, [it]);
    }
  }

  near(x: number, z: number, radius: number): T[] {
    const out: T[] = [];
    for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
      for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++) {
        for (const it of this.cells.get(cellKey(cx, cz)) ?? []) {
          if (Math.hypot(it.x - x, it.z - z) <= radius) out.push(it);
        }
      }
    }
    return out;
  }
}

/** How much flat land a village gets, and how far the terrain takes to blend back. */
export const VILLAGE_FLAT = { radius: 450, blend: 500 };
const LIGHTHOUSE_FLAT = { radius: 60, blend: 120 };

export class HarborData {
  readonly harbors: Grid<Harbor>;
  readonly lighthouses: Grid<Lighthouse>;

  constructor(file: HarborFile, projection: LocalProjection) {
    this.harbors = new Grid(
      file.harbors.map(([name, lat, lon, heading, isHarbour], id) => {
        const p = projection.toWorld(lon, lat);
        const h = (heading * Math.PI) / 180; // compass → world: east = +X, north = -Z
        return { id, name, x: p.x, z: p.z, seaX: Math.sin(h), seaZ: -Math.cos(h), isHarbour: isHarbour === 1 };
      }),
    );
    this.lighthouses = new Grid(
      file.lighthouses.map(([name, lat, lon], id) => {
        const p = projection.toWorld(lon, lat);
        return { id, name, x: p.x, z: p.z };
      }),
    );
  }

  static async load(url: string, projection: LocalProjection): Promise<HarborData> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return new HarborData((await res.json()) as HarborFile, projection);
  }

  /** Flat ground for every village (centred a little inland of the shore point) and lighthouse. */
  flattenSites(): FlattenSite[] {
    return [
      ...this.harbors.items.map((h) => ({ x: h.x - h.seaX * 150, z: h.z - h.seaZ * 150, ...VILLAGE_FLAT })),
      ...this.lighthouses.items.map((l) => ({ x: l.x, z: l.z, ...LIGHTHOUSE_FLAT })),
    ];
  }

  nearestHarbor(x: number, z: number, radius: number): { harbor: Harbor; distance: number } | undefined {
    let best: { harbor: Harbor; distance: number } | undefined;
    for (const h of this.harbors.near(x, z, radius)) {
      const d = Math.hypot(h.x - x, h.z - z);
      if (!best || d < best.distance) best = { harbor: h, distance: d };
    }
    return best;
  }
}
