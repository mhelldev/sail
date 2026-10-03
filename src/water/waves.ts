// Gerstner waves shared by the water shader (GPU) and the boat (CPU).
// The GLSL in water.ts must stay in sync with `displace` below.

export const WAVE_COUNT = 8;

export interface Wave {
  dirX: number; // normalized travel direction (world X = east)
  dirZ: number; // normalized travel direction (world Z = south)
  steepness: number; // 0…1, sum over all waves should stay < 1
  length: number; // wavelength in metres
}

export interface WaveField {
  waves: Wave[];
  amplitude: number; // global multiplier on steepness, 0 = flat sea
  fadeStart: number; // metres from the centre where waves start to flatten (hides aliasing)
  fadeEnd: number;
  centerX: number;
  centerZ: number;
}

const G = 9.81;

/** Build a wave set travelling roughly downwind. */
export function createWaveField(windFromDeg: number): WaveField {
  // Wind from θ travels towards θ+180. Compass → world: east = +X, north = -Z.
  const travel = ((windFromDeg + 180) * Math.PI) / 180;
  const spec: Array<[offsetDeg: number, steepness: number, length: number]> = [
    [0, 0.16, 61],
    [23, 0.13, 43],
    [-31, 0.12, 32],
    [47, 0.1, 23],
    [-67, 0.08, 16.7],
    [11, 0.07, 11.3],
    [-14, 0.06, 7.9],
    [83, 0.05, 5.3],
  ];
  const waves = spec.map(([off, steepness, length]) => {
    const a = travel + (off * Math.PI) / 180;
    return { dirX: Math.sin(a), dirZ: -Math.cos(a), steepness, length };
  });
  return { waves, amplitude: 1, fadeStart: 1500, fadeEnd: 4000, centerX: 0, centerZ: 0 };
}

export interface Displacement {
  x: number;
  y: number;
  z: number;
}

function fade(f: WaveField, x: number, z: number): number {
  const d = Math.hypot(x - f.centerX, z - f.centerZ);
  const t = Math.min(1, Math.max(0, (d - f.fadeStart) / (f.fadeEnd - f.fadeStart)));
  return 1 - t * t * (3 - 2 * t);
}

/** Displacement of the undisturbed water point (x, z) at time t. */
export function displace(f: WaveField, x: number, z: number, t: number, out: Displacement): Displacement {
  out.x = out.y = out.z = 0;
  const amp = f.amplitude * fade(f, x, z);
  for (const w of f.waves) {
    const k = (2 * Math.PI) / w.length;
    const c = Math.sqrt(G / k);
    const phase = k * (w.dirX * x + w.dirZ * z - c * t);
    const a = (w.steepness * amp) / k;
    const cos = Math.cos(phase);
    out.x += w.dirX * a * cos;
    out.y += a * Math.sin(phase);
    out.z += w.dirZ * a * cos;
  }
  return out;
}

const tmp: Displacement = { x: 0, y: 0, z: 0 };

/**
 * Water surface height at world position (x, z). Gerstner waves move points
 * horizontally, so find the undisturbed point that ends up at (x, z) first.
 */
export function heightAt(f: WaveField, x: number, z: number, t: number): number {
  let px = x;
  let pz = z;
  for (let i = 0; i < 4; i++) {
    displace(f, px, pz, t, tmp);
    px = x - tmp.x;
    pz = z - tmp.z;
  }
  return displace(f, px, pz, t, tmp).y;
}

/** Largest possible crest height, used to normalise foam in the shader. */
export function maxHeight(f: WaveField): number {
  return f.waves.reduce((sum, w) => sum + (w.steepness * f.amplitude * w.length) / (2 * Math.PI), 0);
}
