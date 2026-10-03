// Local equirectangular projection around an origin: 1 unit = 1 metre,
// +X = east, -Z = north. Accurate to well under 1 % within ~200 km of the origin,
// which is plenty for the area the player can see.

const EARTH_RADIUS = 6371008.8;
const DEG = Math.PI / 180;

export interface WorldXZ {
  x: number;
  z: number;
}

export interface LonLat {
  lon: number;
  lat: number;
}

export class LocalProjection {
  /** metres per degree of longitude / latitude at the origin */
  readonly kx: number;
  readonly kz: number;

  constructor(
    readonly originLat: number,
    readonly originLon: number,
  ) {
    this.kz = EARTH_RADIUS * DEG;
    this.kx = this.kz * Math.cos(originLat * DEG);
  }

  toWorld(lon: number, lat: number): WorldXZ {
    return { x: (lon - this.originLon) * this.kx, z: -(lat - this.originLat) * this.kz };
  }

  toGeo(x: number, z: number): LonLat {
    return { lon: this.originLon + x / this.kx, lat: this.originLat - z / this.kz };
  }
}
