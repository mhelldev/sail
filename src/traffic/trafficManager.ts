// Keeps generated traffic around the player: yachts and motorboats out of real marinas, ferries
// between real harbours, cargo ships passing offshore. Routes go through water only.

import type { Coastline } from '../geo/coastline';
import type { Harbor, HarborData } from '../harbors/harborData';
import { obstacleDistance, type Obstacle } from '../harbors/village';
import { SPECS, Vessel, type VesselKind } from './vessel';
import { dilate, findWaterPath, type Point, type WaterGrid } from './waterPath';

const AREA = 12000; // vessels are kept within this distance of the player
const DESPAWN = 17000;
const SHIP_RING = 15000; // cargo ships enter and leave here, inside the fog
const SPAWN_INTERVAL = 0.4; // seconds between two route plannings (each is a few ms)
const MAX_GRID = 320; // cells per side for route planning
const TARGETS: Record<VesselKind, number> = { yacht: 10, motor: 6, ferry: 2, cargo: 3 };
/** Route planning: grid cell size and how many cells to stay off the coast. */
const ROUTING: Record<VesselKind, { step: number; margin: number }> = {
  yacht: { step: 120, margin: 1 },
  motor: { step: 120, margin: 1 },
  ferry: { step: 150, margin: 2 },
  cargo: { step: 300, margin: 3 },
};

const rand = (a: number, b: number) => a + (b - a) * Math.random();

export class TrafficManager {
  readonly vessels: Vessel[] = [];
  /** 0…2 from the tuning panel */
  density = 1;
  private nextId = 1;
  private sinceSpawn = SPAWN_INTERVAL;
  private elapsed = 0;
  private near: Obstacle[] = [];

  constructor(
    private readonly coast: Coastline,
    private readonly harbors: HarborData,
  ) {}

  update(dt: number, px: number, pz: number, windFrom: number, windSpeed: number): void {
    this.elapsed += dt;
    for (const v of this.vessels) {
      v.step(dt, windFrom, windSpeed);
      // Ferries turn around after a stop; yachts and motorboats wait at the harbour mouth.
      if (v.kind === 'ferry' && v.arrived && v.waited > 40) v.setRoute([...v.route].reverse());
    }

    // Leave the area, or go home once nobody is watching.
    for (let i = this.vessels.length - 1; i >= 0; i--) {
      const v = this.vessels[i];
      const d = Math.hypot(v.x - px, v.z - pz);
      const home = v.arrived && v.waited > 60 && d > 2500 && (v.kind === 'yacht' || v.kind === 'motor');
      if (d > DESPAWN || home || (v.kind === 'cargo' && v.arrived)) this.vessels.splice(i, 1);
    }

    this.sinceSpawn += dt;
    if (this.sinceSpawn >= SPAWN_INTERVAL) {
      this.sinceSpawn = 0;
      const kind = this.mostMissing();
      if (kind) this.spawn(kind, px, pz);
    }

    this.near = [];
    for (const v of this.vessels) {
      if (Math.abs(v.x - px) > 400 || Math.abs(v.z - pz) > 400) continue;
      const rotY = Math.PI - (v.heading * Math.PI) / 180;
      this.near.push({ x: v.x, z: v.z, halfW: v.spec.beam / 2, halfL: v.spec.length / 2, rotY });
    }
  }

  /** Signed distance to the nearest other vessel (positive inside), for the player's collision. */
  obstacleDistance(x: number, z: number): number {
    let best = -Infinity;
    for (const o of this.near) best = Math.max(best, obstacleDistance(o, x, z));
    return best;
  }

  private mostMissing(): VesselKind | undefined {
    let best: VesselKind | undefined;
    let bestGap = 0;
    for (const kind of Object.keys(TARGETS) as VesselKind[]) {
      const have = this.vessels.filter((v) => v.kind === kind).length;
      const gap = Math.round(TARGETS[kind] * this.density) - have;
      if (gap > bestGap) [best, bestGap] = [kind, gap];
    }
    return best;
  }

  private spawn(kind: VesselKind, px: number, pz: number): void {
    const route = kind === 'cargo' ? this.shipRoute(px, pz) : kind === 'ferry' ? this.ferryRoute(px, pz) : this.harbourTrip(kind, px, pz);
    if (!route || route.length < 2) return;
    const v = new Vessel(this.nextId++, kind, SPECS[kind](), route, Math.floor(Math.random() * 1000));
    // The first wave starts mid-voyage so the sea isn't empty; later yachts really leave port.
    // Ships always appear at the edge of the fog.
    if (this.elapsed < 15 || kind === 'ferry') v.advanceAlongRoute(rand(0.05, 0.9));
    this.vessels.push(v);
  }

  /** A yacht or motorboat leaving a real marina for a trip out and back (or to another marina). */
  private harbourTrip(kind: VesselKind, px: number, pz: number): Point[] | undefined {
    const candidates = this.harbors.harbors.near(px, pz, AREA - 2000);
    if (!candidates.length) return undefined;
    const home = candidates[Math.floor(Math.random() * candidates.length)];
    const start = this.mouth(home);
    if (!start) return undefined;

    if (kind === 'yacht' && Math.random() < 0.35) {
      const others = this.harbors.harbors.near(start.x, start.z, 15000).filter((h) => h !== home && Math.hypot(h.x - home.x, h.z - home.z) > 3000);
      const other = others[Math.floor(Math.random() * others.length)];
      const end = other && this.mouth(other);
      if (end) return this.route(kind, start, end);
    }
    const out = this.openWater(start, kind === 'yacht' ? 2500 : 2000, kind === 'yacht' ? 8000 : 6500, 300);
    if (!out) return undefined;
    const there = this.route(kind, start, out);
    if (!there) return undefined;
    return [...there, ...[...there].reverse().slice(1)];
  }

  private ferryRoute(px: number, pz: number): Point[] | undefined {
    const list = this.harbors.harbors.near(px, pz, AREA).sort((a, b) => Number(b.isHarbour) - Number(a.isHarbour));
    for (let attempt = 0; attempt < 20 && list.length > 1; attempt++) {
      const a = list[Math.floor(Math.random() * Math.min(list.length, 8))];
      const b = list[Math.floor(Math.random() * list.length)];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (a === b || d < 4000 || d > 25000) continue;
      const from = this.mouth(a);
      const to = this.mouth(b);
      if (!from || !to) continue;
      const route = this.route('ferry', from, to);
      if (route) return route;
    }
    return undefined;
  }

  /** A ship passing through: enters and leaves at the edge of the fog, through deep water. */
  private shipRoute(px: number, pz: number): Point[] | undefined {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const b = a + Math.PI + rand(-0.6, 0.6);
      const from = { x: px + Math.cos(a) * SHIP_RING, z: pz + Math.sin(a) * SHIP_RING };
      const to = { x: px + Math.cos(b) * SHIP_RING, z: pz + Math.sin(b) * SHIP_RING };
      if (this.coast.signedDistance(from.x, from.z, 1300) > -1200) continue;
      if (this.coast.signedDistance(to.x, to.z, 1300) > -1200) continue;
      const route = this.route('cargo', from, to);
      if (route) return route;
    }
    return undefined;
  }

  /** Water route between two points, planned on a grid covering both plus a margin. */
  private route(kind: VesselKind, from: Point, to: Point): Point[] | undefined {
    const { margin } = ROUTING[kind];
    const pad = 3000;
    const minX = Math.min(from.x, to.x) - pad;
    const minZ = Math.min(from.z, to.z) - pad;
    const size = Math.max(Math.abs(from.x - to.x), Math.abs(from.z - to.z)) + pad * 2;
    const step = Math.max(ROUTING[kind].step, size / MAX_GRID);
    const n = Math.ceil(size / step) + 1;
    const grid: WaterGrid = { x0: minX, z0: minZ, step, n, blocked: this.coast.sampleLandMask(minX, minZ, step, n) };
    return findWaterPath(dilate(grid, margin), from, to);
  }

  /** Open water just outside a harbour (past its breakwaters), if there is any. */
  private mouth(h: Harbor): Point | undefined {
    for (const d of [220, 320, 450, 600]) {
      const p = { x: h.x + h.seaX * d, z: h.z + h.seaZ * d };
      if (this.coast.signedDistance(p.x, p.z, 200) < -60) return p;
    }
    return undefined;
  }

  /** A random point in open water (at least `depth` metres from any coast) around `from`. */
  private openWater(from: Point, rMin: number, rMax: number, depth: number): Point | undefined {
    for (let i = 0; i < 15; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(rMin, rMax);
      const p = { x: from.x + Math.cos(a) * r, z: from.z + Math.sin(a) * r };
      if (this.coast.signedDistance(p.x, p.z, depth + 10) <= -depth) return p;
    }
    return undefined;
  }
}
