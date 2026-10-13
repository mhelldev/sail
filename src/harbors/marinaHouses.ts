// Every village's marina house and supermarket: walk surfaces for all of them (walls, the door, the floor
// and ceiling, furniture), the detailed models with doors, gallery and shop for the villages near the
// player, and the gallery photos fetched ahead while sailing in (so they are in the cache when you step
// through the door).

import * as THREE from 'three';
import type { Clickable } from '../person/walkMode';
import type { Harbor } from './harborData';
import type { HarborRenderer } from './harborRenderer';
import { HOUSE_DOOR, MARINA_HOUSE, marinaHouseCoversGround, marinaHouseSurfaces, type HouseSurface } from './marinaHouse';
import { MarinaHouseAssets, MarinaHouseModel } from './marinaHouseModel';
import type { MarinaInfoStore } from './marinaInfo';
import { SHOP, SHOP_DOOR, shopCoversGround, shopSurfaces } from './shop';
import { ShopAssets, ShopModel } from './shopModel';
import type { MarinaHouseSite } from './village';
import type { ProductId } from '../economy/economy';

const BUILD_RADIUS = 350; // detailed house within this distance
const DROP_RADIUS = 550;
const INSIDE_VISIBLE = 45; // the interior is drawn within this distance
const PREFETCH_RADIUS = 3000; // photos are downloaded within this distance
const NEAR_LIST = 120; // houses considered for walking

type Kind = 'office' | 'shop';

/** The two kinds of buildings: their walk surfaces, footprint and door. */
const KINDS = {
  office: { surfaces: marinaHouseSurfaces, covers: marinaHouseCoversGround, doorHalfWidth: HOUSE_DOOR.halfWidth, depth: MARINA_HOUSE.depth },
  shop: { surfaces: shopSurfaces, covers: shopCoversGround, doorHalfWidth: SHOP_DOOR.halfWidth, depth: SHOP.depth },
};

interface House {
  /** `${harbour id}:${kind}` */
  key: string;
  kind: Kind;
  harbor: Harbor;
  site: MarinaHouseSite;
  cos: number;
  sin: number;
}

interface Model {
  readonly group: THREE.Group;
  readonly door: THREE.Object3D;
  doorOpen: boolean;
  readonly passable: boolean;
  update(dt: number, near: boolean, night: number): void;
  dispose(): void;
  /** goods to buy (the shop) */
  readonly products?: Array<{ object: THREE.Object3D; product: ProductId }>;
}

export class MarinaHouses {
  readonly group = new THREE.Group();
  private readonly assets = new MarinaHouseAssets();
  private readonly shopAssets = new ShopAssets();
  private readonly models = new Map<string, Model>();
  /** door and goods of each building, as registered with the walker */
  private readonly clickables = new Map<string, Clickable[]>();
  /** door open per building (buildings without a model keep theirs) */
  private readonly doors = new Map<string, boolean>();
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
    /** a product in a shop was clicked */
    private readonly onBuy: (product: ProductId) => void = () => {},
  ) {
    // The shops' shared interior takes a few dozen ms to build: do it while the browser is idle.
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 3000));
    idle(() => void this.shopAssets.interior);
  }

  update(dt: number, x: number, z: number, night: number): void {
    // Which houses exist changes only when villages are built or dropped: look twice a second.
    this.sinceScan += dt;
    if (this.sinceScan > 0.5) {
      this.sinceScan = 0;
      this.houses = [];
      for (const { harbor, site, shop } of this.harbors.marinaHouseSites()) {
        for (const [kind, s] of [['office', site], ['shop', shop]] as const) {
          if (s) this.houses.push({ key: `${harbor.id}:${kind}`, kind, harbor, site: s, cos: Math.cos(s.rotY), sin: Math.sin(s.rotY) });
        }
      }
      this.plan(x, z);
    }
    this.near = this.houses.filter((h) => Math.abs(h.site.x - x) < NEAR_LIST && Math.abs(h.site.z - z) < NEAR_LIST);
    this.assets.setNight(night);
    this.shopAssets.setNight(night);
    for (const [id, model] of this.models) {
      const d = Math.hypot(model.group.position.x - x, model.group.position.z - z);
      model.update(dt, d < INSIDE_VISIBLE, night);
      this.doors.set(id, model.doorOpen);
    }
  }

  /** Walls, floor, ceiling, furniture, steps of the marina houses and shops at world (x, z). */
  surfacesAt(x: number, z: number): HouseSurface[] {
    const out: HouseSurface[] = [];
    for (const h of this.near) {
      const local = this.local(h, x, z);
      if (!local) continue;
      const [lx, lz] = local;
      const model = this.models.get(h.key);
      const open = model ? model.passable : (this.doors.get(h.key) ?? false);
      for (const s of KINDS[h.kind].surfaces(lx, lz, open)) out.push({ top: s.top + h.site.y, bottom: s.bottom === undefined ? undefined : s.bottom + h.site.y });
    }
    return out;
  }

  /** Inside a marina house or shop: its floor replaces the terrain. */
  coversGround(x: number, z: number): boolean {
    return this.near.some((h) => {
      const local = this.local(h, x, z);
      return !!local && KINDS[h.kind].covers(local[0], local[1]);
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
    const alive = new Set<string>();
    for (const h of this.houses) {
      const id = h.key;
      alive.add(id);
      const d = Math.hypot(h.site.x - x, h.site.z - z);
      if (h.kind === 'office' && d < PREFETCH_RADIUS && !this.prefetched.has(h.harbor.id)) {
        this.prefetched.add(h.harbor.id);
        void this.store.prefetch(h.harbor);
      }
      if (d < BUILD_RADIUS && !this.models.has(id)) this.build(h);
      else if (d > DROP_RADIUS && this.models.has(id)) this.drop(id);
    }
    for (const id of [...this.models.keys()]) if (!alive.has(id)) this.drop(id);
    this.harbors.setDetailedMarinaHouses(new Set(this.models.keys()));
  }

  private build(h: House): void {
    const id = h.key;
    const model: Model =
      h.kind === 'office'
        ? new MarinaHouseModel(h.site, h.harbor, this.assets, this.store, this.store.get(h.harbor))
        : new ShopModel(h.site, this.shopAssets, this.assets);
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
    const clicks = [click, ...(model.products ?? []).map((p) => ({ object: p.object, onClick: () => this.onBuy(p.product) }))];
    this.clickables.set(id, clicks);
    this.walkClickables.push(...clicks);
  }

  private drop(id: string): void {
    this.models.get(id)?.dispose();
    this.models.delete(id);
    for (const click of this.clickables.get(id) ?? []) {
      const i = this.walkClickables.indexOf(click);
      if (i >= 0) this.walkClickables.splice(i, 1);
    }
    this.clickables.delete(id);
  }

  private inDoorway(h: House): boolean {
    const p = this.person();
    const [lx, lz] = this.local(h, p.x, p.z) ?? [Infinity, Infinity];
    const k = KINDS[h.kind];
    return Math.abs(lx) < k.doorHalfWidth + 0.4 && Math.abs(lz - k.depth / 2) < 0.7;
  }
}
