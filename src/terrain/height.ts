// Terrain height and colour as pure functions of world position and signed distance
// to the coast. Deterministic for a given seed, so neighbouring chunks always match.

import alea from 'alea';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { FlattenSites } from './flatten';

export interface TerrainParams {
  seed: number;
  /** metres inland over which mountains rise from the shore */
  coastFalloff: number;
  /** rise per metre at the shoreline (beach steepness) */
  beachSlope: number;
  /** peak height of mountains in metres */
  mountainHeight: number;
  /** height of rolling hills in metres */
  hillHeight: number;
  /** wavelength of the main ridges in metres */
  ridgeScale: number;
  /** domain warp distance in metres (bends ridges) */
  warp: number;
  /** size of mountainous vs. hilly regions in metres */
  regionScale: number;
  /** 0…1, share of land that is mountainous */
  mountainCoverage: number;
  /** height in metres above which snow appears */
  snowLine: number;
}

export const DEFAULT_TERRAIN: TerrainParams = {
  seed: 42,
  coastFalloff: 900,
  beachSlope: 0.04,
  mountainHeight: 650,
  hillHeight: 60,
  ridgeScale: 2600,
  warp: 900,
  regionScale: 30000,
  mountainCoverage: 0.65,
  snowLine: 480,
};

/** Seabed depth reached just offshore; the water is opaque so it only needs to sit well below the waves. */
const SEABED = -25;
/** Low bank at the shoreline so the land edge reads clearly instead of being washed over by every wave. */
const SHORE_BANK = 1.2;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export interface TerrainSampler {
  readonly params: TerrainParams;
  /** Height in metres for a point with signed coast distance `sd` (positive on land). */
  height(sd: number, x: number, z: number): number;
  /** Writes an RGB colour (0…1) for a vertex with height `h` and normal y-component `ny`. */
  color(h: number, ny: number, x: number, z: number, out: Float32Array, offset: number): void;
}

/**
 * @param flatten harbour villages and lighthouses: hills and mountains are pulled down to a low
 *   plain there, so buildings stand on flat ground
 */
export function createTerrainSampler(params: TerrainParams, flatten = new FlattenSites()): TerrainSampler {
  const rng = alea(params.seed);
  const ridgeNoise = createNoise2D(rng);
  const warpNoiseX = createNoise2D(rng);
  const warpNoiseZ = createNoise2D(rng);
  const hillNoise = createNoise2D(rng);
  const regionNoise = createNoise2D(rng);
  const detailNoise = createNoise2D(rng);

  const fbm = (noise: NoiseFunction2D, x: number, z: number, octaves: number) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm; // -1…1
  };

  /** Ridged multifractal: sharp crests where the noise crosses zero, detail concentrated on ridges. */
  const ridged = (x: number, z: number) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let weight = 1;
    let norm = 0;
    for (let i = 0; i < 6; i++) {
      let n = 1 - Math.abs(ridgeNoise(x * freq, z * freq));
      n *= n * weight;
      weight = Math.min(1, n * 2);
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm; // 0…~1
  };

  const {
    coastFalloff,
    beachSlope,
    mountainHeight,
    hillHeight,
    ridgeScale,
    warp,
    regionScale,
    mountainCoverage,
    snowLine,
  } = params;

  return {
    params,

    height(sd, x, z) {
      if (sd <= 0) return Math.max(SEABED, -SHORE_BANK + sd * beachSlope * 2);

      // Domain warping bends the ridges so they don't look grid-aligned.
      const wx = x + fbm(warpNoiseX, x / (ridgeScale * 2), z / (ridgeScale * 2), 3) * warp;
      const wz = z + fbm(warpNoiseZ, x / (ridgeScale * 2), z / (ridgeScale * 2), 3) * warp;

      const region = smoothstep(
        0.6 - mountainCoverage,
        1.1 - mountainCoverage,
        fbm(regionNoise, x / regionScale, z / regionScale, 2) * 0.5 + 0.5,
      );
      const mountains = ridged(wx / ridgeScale, wz / ridgeScale) * mountainHeight * region;
      const hills = (fbm(hillNoise, x / (ridgeScale * 0.5), z / (ridgeScale * 0.5), 4) * 0.5 + 0.5) * hillHeight;

      const beach = SHORE_BANK + Math.min(sd * beachSlope, 3);
      const inland = smoothstep(0, coastFalloff, sd);
      const relief = inland * (hills + mountains);
      const flat = flatten.weight(x, z);
      if (flat === 0) return beach + relief;
      // Around villages: a low plain with a little undulation instead of hills and mountains.
      const plain = inland * (detailNoise(x / 400, z / 400) * 0.5 + 0.5) * 2;
      return beach + relief * (1 - flat) + plain * flat;
    },

    color(h, ny, x, z, out, o) {
      const n = detailNoise(x / 180, z / 180); // breaks up colour bands
      let r: number;
      let g: number;
      let b: number;
      if (h < 0.5) {
        [r, g, b] = [0.55, 0.5, 0.36]; // wet sand / seabed
      } else if (h < 3.5 + n) {
        [r, g, b] = [0.84, 0.76, 0.55]; // beach
      } else {
        // Grass → forest with height and noise.
        const forest = smoothstep(20, 140, h + n * 40);
        r = 0.3 + (0.1 - 0.3) * forest;
        g = 0.5 + (0.27 - 0.5) * forest;
        b = 0.17 + (0.1 - 0.17) * forest;
        // Rock on steep slopes and high up.
        const rock = Math.max(smoothstep(0.82, 0.68, ny), smoothstep(snowLine * 0.55, snowLine * 0.85, h + n * 30));
        r += (0.36 - r) * rock;
        g += (0.33 - g) * rock;
        b += (0.29 - b) * rock;
        // Snow on the flatter parts above the snow line.
        const snow = smoothstep(snowLine, snowLine + 60, h + n * 50) * smoothstep(0.55, 0.75, ny);
        r += (0.95 - r) * snow;
        g += (0.96 - g) * snow;
        b += (0.98 - b) * snow;
      }
      // Colours above are picked in sRGB; vertex colours are linear.
      out[o] = srgbToLinear(r);
      out[o + 1] = srgbToLinear(g);
      out[o + 2] = srgbToLinear(b);
    },
  };
}
