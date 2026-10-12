// Every village's marina house: walk surfaces for all of them (walls, the door, the floor and ceiling),
// the detailed model with door and gallery for the ones near the player, and the photos fetched ahead
// while sailing in (so they are in the cache when you step through the door).

import * as THREE from 'three';
import type { Clickable } from '../person/walkMode';
import type { Harbor } from './harborData';
import type { HarborRenderer } from './harborRenderer';
import { HOUSE_DOOR, MARINA_HOUSE, marinaHouseCoversGround, marinaHouseSurfaces, type HouseSurface } from './marinaHouse';
import { MarinaHouseAssets, MarinaHouseModel } from './marinaHouseModel';
import type { MarinaInfoStore } from './marinaInfo';
import type { MarinaHouseSite } from './village';

const BUILD_RADIUS = 350; // detailed house within this distance
const DROP_RADIUS = 550;
const INSIDE_VISIBLE = 45; // the interior is drawn within this distance
const PREFETCH_RADIUS = 3000; // photos are downloaded within this distance
const NEAR_LIST = 120; // houses considered for walking

interface House {
  harbor: Harbor;
  site: MarinaHouseSite;
  cos: number;
  sin: number;
}

export class MarinaHouses {
  readonly group = new THREE.Group();
  private readonly assets = new MarinaHouseAssets();
  private readonly models = new Map<number, MarinaHouseModel>();
  private readonly clickables = new Map<number, Clickable>();
  /** door open per harbour (houses without a model keep theirs) */
  private readonly doors = new Map<number, boolean>();
  private readonly prefetched = new Set<number>();
  private houses: House[] = [];
  private near: House[] = [];
  private sinceScan = Infinity;

  constructor(
    private readonly harbors: HarborRenderer,
    private readonly store: MarinaInfoStore,
    private readonly walkClickables: Clickable[],
    /** door sound; `opening` tells which half to play */
    private readonly onDoor: (opening: boolean) => void,
    /** where the person stands (feet), so the door isn't shut on them */
    private readonly person: () => { x: number; z: number },
  ) {}

  update(dt: number, x: number, z: number, night: number): void {
    // Which houses exist changes only when villages are built or dropped: look twice a second.
    this.sinceScan += dt;
    if (this.sinceScan > 0.5) {
      this.sinceScan = 0;
      this.houses = this.harbors.marinaHouseSites().map(({ harbor, site }) => ({ harbor, site, cos: Math.cos(site.rotY), sin: Math.sin(site.rotY) }));
      this.plan(x, z);
    }
    this.near = this.houses.filter((h) => Math.abs(h.site.x - x) < NEAR_LIST && Math.abs(h.site.z - z) < NEAR_LIST);
    this.assets.setNight(night);
    for (const [id, model] of this.models) {
      const d = Math.hypot(model.group.position.x - x, model.group.position.z - z);
      model.update(dt, d < INSIDE_VISIBLE, night);
      this.doors.set(id, model.doorOpen);
    }
  }

  /** Walls, floor, ceiling, bench, steps of the marina houses at world (x, z). */
  surfacesAt(x: number, z: number): HouseSurface[] {
    const out: HouseSurface[] = [];
    for (const h of this.near) {
      const local = this.local(h, x, z);
      if (!local) continue;
      const [lx, lz] = local;
      const model = this.models.get(h.harbor.id);
      const open = model ? model.passable : (this.doors.get(h.harbor.id) ?? false);
      for (const s of marinaHouseSurfaces(lx, lz, open)) out.push({ top: s.top + h.site.y, bottom: s.bottom === undefined ? undefined : s.bottom + h.site.y });
    }
    return out;
  }

  /** Inside a marina house: its floor replaces the terrain. */
  coversGround(x: number, z: number): boolean {
    return this.near.some((h) => {
      const local = this.local(h, x, z);
      return !!local && marinaHouseCoversGround(local[0], local[1]);
    });
  }

  /** World → house frame (inverse of the Y rotation); undefined when clearly not near it. */
  private local(h: House, x: number, z: number): [number, number] | undefined {
    const dx = x - h.site.x;
    const dz = z - h.site.z;
    if (Math.abs(dx) > 12 || Math.abs(dz) > 12) return undefined;
    return [dx * h.cos - dz * h.sin, dx * h.sin + dz * h.cos];
  }

  get detailedCount(): number {
    return this.models.size;
  }

  private plan(x: number, z: number): void {
    const alive = new Set<number>();
    for (const h of this.houses) {
      const id = h.harbor.id;
      alive.add(id);
      const d = Math.hypot(h.site.x - x, h.site.z - z);
      if (d < PREFETCH_RADIUS && !this.prefetched.has(id)) {
        this.prefetched.add(id);
        void this.store.prefetch(h.harbor);
      }
      if (d < BUILD_RADIUS && !this.models.has(id)) this.build(h);
      else if (d > DROP_RADIUS && this.models.has(id)) this.drop(id);
    }
    for (const id of [...this.models.keys()]) if (!alive.has(id)) this.drop(id);
    this.harbors.setDetailedMarinaHouses(new Set(this.models.keys()));
  }

  private build(h: House): void {
    const id = h.harbor.id;
    const model = new MarinaHouseModel(h.site, h.harbor, this.assets, this.store, this.store.get(h.harbor));
    model.doorOpen = this.doors.get(id) ?? false;
    model.update(10, false, 0); // door already where it was
    this.group.add(model.group);
    this.models.set(id, model);
    const click: Clickable = {
      object: model.door,
      onClick: () => {
        if (model.doorOpen && this.inDoorway(h)) return; // don't shut it on yourself
        model.doorOpen = !model.doorOpen;
        this.onDoor(model.doorOpen);
      },
    };
    this.clickables.set(id, click);
    this.walkClickables.push(click);
  }

  private drop(id: number): void {
    this.models.get(id)?.dispose();
    this.models.delete(id);
    const click = this.clickables.get(id);
    const i = click ? this.walkClickables.indexOf(click) : -1;
    if (i >= 0) this.walkClickables.splice(i, 1);
    this.clickables.delete(id);
  }

  private inDoorway(h: House): boolean {
    const p = this.person();
    const [lx, lz] = this.local(h, p.x, p.z) ?? [Infinity, Infinity];
    return Math.abs(lx) < HOUSE_DOOR.halfWidth + 0.4 && Math.abs(lz - MARINA_HOUSE.depth / 2) < 0.7;
  }
}
