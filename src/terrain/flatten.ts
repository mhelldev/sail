// Places where the terrain is pulled down to a low, gentle plain: harbour villages and
// lighthouses. Pure data + a coarse grid, so the terrain workers can use it too.

export interface FlattenSite {
  x: number;
  z: number;
  /** fully flat within this radius (metres) */
  radius: number;
  /** then blends back to the natural terrain over this distance */
  blend: number;
}

const CELL = 2000;

export class FlattenSites {
  private readonly cells = new Map<number, FlattenSite[]>();
  private reach = 0;

  constructor(sites: FlattenSite[] = []) {
    for (const s of sites) this.add(s);
  }

  add(site: FlattenSite): void {
    this.reach = Math.max(this.reach, site.radius + site.blend);
    const key = cellKey(Math.floor(site.x / CELL), Math.floor(site.z / CELL));
    const list = this.cells.get(key);
    if (list) list.push(site);
    else this.cells.set(key, [site]);
  }

  /** 1 inside a site, 0 outside every site's blend zone, smooth in between. */
  weight(x: number, z: number): number {
    if (this.reach === 0) return 0;
    const r = Math.ceil(this.reach / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let w = 0;
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        for (const s of this.cells.get(cellKey(i, j)) ?? []) {
          const d = Math.hypot(x - s.x, z - s.z);
          if (d >= s.radius + s.blend) continue;
          const t = Math.min(1, Math.max(0, (s.radius + s.blend - d) / s.blend));
          w = Math.max(w, t * t * (3 - 2 * t));
          if (w >= 1) return 1;
        }
      }
    }
    return w;
  }
}

const cellKey = (cx: number, cz: number) => (cx + 1048576) * 2097152 + (cz + 1048576);
