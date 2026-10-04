// Procedural vessel designs: every vessel is a handful of unit shapes placed in its own frame.
// Local frame: +Z = bow, +X = port, +Y = up, waterline at y = 0. Sizes in metres.

import alea from 'alea';
import type { VesselKind } from './vessel';

export type ShapeType = 'hull' | 'box' | 'deckhouse' | 'cyl' | 'sail' | 'cone';

export interface Shape {
  type: ShapeType;
  /** base centre in the vessel frame */
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** rotations (radians), applied in the order Y, X, Z; for raked or tilted parts */
  rx?: number;
  ry?: number;
  rz?: number;
  color: number;
  /** sails turn with the boom and are lowered when motoring */
  sail?: 'main' | 'jib' | 'mizzen';
}

const pick = <T>(rng: () => number, list: T[]) => list[Math.floor(rng() * list.length)];

export const YACHT_VARIANTS = 4;
export const MOTOR_VARIANTS = 3;
export const CARGO_VARIANTS = 3;

export function designVessel(kind: VesselKind, variant: number, length: number, beam: number, seed: number): Shape[] {
  const rng = alea(seed);
  switch (kind) {
    case 'yacht':
      return yacht(variant % YACHT_VARIANTS, length, beam, rng);
    case 'motor':
      return motorboat(variant % MOTOR_VARIANTS, length, beam, rng);
    case 'ferry':
      return ferry(length, beam, rng);
    case 'cargo':
      return cargo(variant % CARGO_VARIANTS, length, beam, rng);
  }
}

// ---- Sailboats ---------------------------------------------------------------------------------

function yacht(variant: number, L: number, B: number, rng: () => number): Shape[] {
  const s: Shape[] = [];
  const free = L * 0.12;
  const sailColor = variant === 1 ? pick(rng, [0xd9b48a, 0xc9874f, 0xb5523b]) : pick(rng, [0xf7f5ee, 0xf7f5ee, 0xefe8d6, 0xe8eef4]);
  if (variant === 3) {
    // Catamaran: two slim hulls, a trampoline between them, a low cabin across.
    const width = L * 0.55;
    for (const side of [-1, 1]) {
      s.push({ type: 'hull', x: side * width * 0.38, y: 0, z: 0, sx: width * 0.22, sy: free, sz: L, color: 0xf4f2ec });
    }
    s.push({ type: 'box', x: 0, y: free * 0.55, z: -L * 0.05, sx: width * 0.8, sy: 0.15, sz: L * 0.45, color: 0x3a3a3a });
    s.push({ type: 'deckhouse', x: 0, y: free * 0.6, z: -L * 0.12, sx: width * 0.75, sy: 1.1, sz: L * 0.3, color: 0xf4f2ec });
    mast(s, 0, L * 0.05, free, L * 1.25, L * 0.4, sailColor, true);
    return s;
  }
  const hulls = variant === 1 ? [0x1d3557, 0x22303c, 0x6b2b2b] : [0xf4f2ec, 0xf4f2ec, 0xe9edf0, 0x2a6f6b];
  s.push({ type: 'hull', x: 0, y: 0, z: 0, sx: B, sy: free, sz: L, color: pick(rng, hulls) });
  s.push({ type: 'box', x: 0, y: free * 0.63, z: -L * 0.05, sx: B * 0.82, sy: 0.08, sz: L * 0.75, color: 0xa47148 });
  s.push({ type: 'deckhouse', x: 0, y: free * 0.65, z: L * 0.02, sx: B * 0.55, sy: 0.75, sz: L * 0.3, color: variant === 1 ? 0xa47148 : 0xece9e1 });
  mast(s, 0, L * 0.12, free, L * 1.3, L * 0.42, sailColor, true);
  if (variant === 2) {
    // Ketch: a smaller mizzen mast aft.
    mast(s, 0, -L * 0.3, free, L * 0.85, L * 0.22, sailColor, false, 'mizzen');
  }
  return s;
}

function mast(s: Shape[], x: number, z: number, deck: number, height: number, foot: number, color: number, jib: boolean, sail: 'main' | 'mizzen' = 'main') {
  s.push({ type: 'cyl', x, y: deck * 0.6, z, sx: 0.18, sy: height, sz: 0.18, color: 0xd8dde2 });
  s.push({ type: 'sail', x, y: deck * 0.6 + 1.6, z, sx: 1, sy: height * 0.88, sz: foot, color, sail });
  if (jib) {
    // Jib from the masthead area down to the bow; its foot runs aft towards the mast.
    s.push({ type: 'sail', x, y: deck * 0.6 + 0.4, z: z + foot * 0.85, sx: 1, sy: height * 0.8, sz: foot * 0.75, color, sail: 'jib' });
  }
}

// ---- Motorboats --------------------------------------------------------------------------------

function motorboat(variant: number, L: number, B: number, rng: () => number): Shape[] {
  const s: Shape[] = [];
  const free = L * 0.12;
  if (variant === 0) {
    // Speedboat: sleek hull, cockpit, raked windscreen.
    s.push({ type: 'hull', x: 0, y: 0, z: 0, sx: B * 0.9, sy: free * 0.8, sz: L, color: pick(rng, [0xf4f2ec, 0xd62828, 0x1d3557, 0x111111]) });
    s.push({ type: 'box', x: 0, y: free * 0.5, z: -L * 0.12, sx: B * 0.7, sy: 0.08, sz: L * 0.45, color: 0xd9cbb0 });
    s.push({ type: 'box', x: 0, y: free * 0.5, z: L * 0.08, sx: B * 0.75, sy: 0.6, sz: 0.12, rx: -0.5, color: 0x1b2a35 });
    return s;
  }
  if (variant === 1) {
    // Cabin cruiser with a flybridge.
    s.push({ type: 'hull', x: 0, y: 0, z: 0, sx: B, sy: free, sz: L, color: 0xf4f2ec });
    s.push({ type: 'deckhouse', x: 0, y: free * 0.6, z: L * 0.02, sx: B * 0.8, sy: 1.8, sz: L * 0.45, color: 0xf4f2ec });
    s.push({ type: 'box', x: 0, y: free * 0.6 + 1.8, z: -L * 0.05, sx: B * 0.7, sy: 0.9, sz: L * 0.3, color: 0x2b3a44 });
    s.push({ type: 'cyl', x: 0, y: free * 0.6 + 2.7, z: L * 0.05, sx: 0.1, sy: 2.2, sz: 0.1, color: 0xd8dde2 });
    return s;
  }
  // Fishing trawler: tall bow, wheelhouse forward, gantry aft, outrigger booms.
  const hull = pick(rng, [0xa8322d, 0x1f4e79, 0x2a6f3b, 0x2b2b2b]);
  s.push({ type: 'hull', x: 0, y: 0, z: 0, sx: B * 1.05, sy: free * 1.25, sz: L, color: hull });
  s.push({ type: 'deckhouse', x: 0, y: free * 0.85, z: L * 0.15, sx: B * 0.6, sy: 2.4, sz: L * 0.25, color: 0xf2f0e8 });
  s.push({ type: 'box', x: 0, y: free * 0.85 + 2.4, z: L * 0.15, sx: B * 0.65, sy: 0.2, sz: L * 0.28, color: hull });
  for (const side of [-1, 1]) {
    s.push({ type: 'cyl', x: side * B * 0.4, y: free * 0.85, z: -L * 0.42, sx: 0.2, sy: 3.4, sz: 0.2, color: 0xe9c46a });
    // Outrigger booms, tilted outwards over the water.
    s.push({ type: 'cyl', x: side * B * 0.3, y: free * 0.85 + 0.3, z: -L * 0.05, sx: 0.12, sy: L * 0.55, sz: 0.12, rz: side * 0.9, color: 0xd8dde2 });
  }
  s.push({ type: 'box', x: 0, y: free * 0.85 + 3.3, z: -L * 0.42, sx: B * 0.9, sy: 0.25, sz: 0.25, color: 0xe9c46a });
  return s;
}

// ---- Ferries and ships ---------------------------------------------------------------------------

function ferry(L: number, B: number, rng: () => number): Shape[] {
  const s: Shape[] = [];
  const free = L * 0.1;
  const funnel = pick(rng, [0xd62828, 0x1d3557, 0xf2a900, 0x2a9d48]);
  s.push({ type: 'hull', x: 0, y: 0, z: 0, sx: B, sy: free, sz: L, color: pick(rng, [0x1d3557, 0x22303c, 0x6b2b2b]) });
  s.push({ type: 'box', x: 0, y: free * 0.62, z: -L * 0.02, sx: B * 0.98, sy: free * 0.5, sz: L * 0.88, color: 0xf4f2ec });
  const decks = 2 + Math.floor(rng() * 2);
  for (let d = 0; d < decks; d++) {
    s.push({ type: 'deckhouse', x: 0, y: free * 1.1 + d * 2.9, z: -L * 0.02 + d * L * 0.03, sx: B * (0.9 - d * 0.1), sy: 2.9, sz: L * (0.65 - d * 0.12), color: 0xf4f2ec });
  }
  const top = free * 1.1 + decks * 2.9;
  s.push({ type: 'cyl', x: 0, y: top, z: -L * 0.15, sx: B * 0.18, sy: 5, sz: B * 0.26, color: funnel });
  s.push({ type: 'cyl', x: 0, y: top + 5, z: -L * 0.15, sx: B * 0.185, sy: 0.9, sz: B * 0.265, color: 0x1a1a1a });
  return s;
}

function cargo(variant: number, L: number, B: number, rng: () => number): Shape[] {
  const s: Shape[] = [];
  const free = L * 0.075;
  const deckY = free * 0.62;
  const hull = pick(rng, [0x1d2b3a, 0x2b2b2b, 0x6b1f1f, 0x2f4a3a, 0x203a6b]);
  s.push({ type: 'hull', x: 0, y: 0, z: 0, sx: B, sy: free, sz: L, color: hull });
  // Bridge and funnel aft, as on most merchant ships.
  const bridgeZ = -L * 0.36;
  s.push({ type: 'deckhouse', x: 0, y: deckY, z: bridgeZ, sx: B * 0.9, sy: L * 0.11, sz: L * 0.08, color: 0xf2f0e8 });
  s.push({ type: 'box', x: 0, y: deckY + L * 0.11, z: bridgeZ, sx: B * 1.05, sy: 1, sz: L * 0.05, color: 0xf2f0e8 }); // bridge wings
  s.push({ type: 'cyl', x: 0, y: deckY + L * 0.07, z: bridgeZ - L * 0.06, sx: B * 0.2, sy: L * 0.07, sz: B * 0.28, color: pick(rng, [0xd62828, 0x1d3557, 0xf2a900, 0x2b2b2b]) });

  if (variant === 0) {
    // Container ship: bays of colourful stacks between the bow and the bridge.
    const colors = [0xc0392b, 0x2471a3, 0xd4ac0d, 0x1e8449, 0x7d3c98, 0xe67e22, 0x5d6d7e, 0xa04000, 0xecf0f1];
    const bayLen = 13;
    const from = bridgeZ + L * 0.06;
    const to = L * 0.36;
    for (let z = from + bayLen / 2; z < to; z += bayLen + 0.6) {
      // Rows of individual 40-foot containers (2.5 m wide, 2.6 m high), stacked to varying heights.
      const rows = Math.floor((B * 0.92) / 2.5);
      for (let r = 0; r < rows; r++) {
        const x = (r - (rows - 1) / 2) * 2.5;
        const tiers = 1 + Math.floor(rng() * 5);
        for (let t = 0; t < tiers; t++) {
          s.push({ type: 'box', x, y: deckY + t * 2.6, z, sx: 2.38, sy: 2.5, sz: bayLen - 0.4, color: pick(rng, colors) });
        }
      }
    }
  } else if (variant === 1) {
    // Tanker: flat deck, a pipeline along the middle, a manifold amidships.
    s.push({ type: 'box', x: 0, y: deckY, z: L * 0.02, sx: B * 0.92, sy: 0.4, sz: L * 0.72, color: 0x4f5b4a });
    // Cylinders stand on +Y; tipped forward by 90° they run along +Z from their base.
    s.push({ type: 'cyl', x: 0, y: deckY + 1.4, z: L * 0.02 - L * 0.35, sx: 1.4, sy: L * 0.7, sz: 1.4, rx: Math.PI / 2, color: 0xd8dde2 });
    s.push({ type: 'box', x: 0, y: deckY + 0.4, z: L * 0.02, sx: B * 0.5, sy: 2.5, sz: 4, color: 0xd8dde2 });
  } else {
    // Bulk carrier: hatch covers and deck cranes.
    for (let i = 0; i < 5; i++) {
      const z = bridgeZ + L * 0.12 + i * L * 0.13;
      s.push({ type: 'box', x: 0, y: deckY, z, sx: B * 0.7, sy: 2.2, sz: L * 0.09, color: pick(rng, [0x7f8c8d, 0x2471a3, 0xa04000]) });
      if (i < 4) {
        s.push({ type: 'cyl', x: B * 0.38, y: deckY, z: z + L * 0.065, sx: 1.4, sy: 14, sz: 1.4, color: 0xe9c46a });
        s.push({ type: 'box', x: B * 0.2, y: deckY + 12, z: z + L * 0.065, sx: 0.9, sy: 0.9, sz: 22, ry: 0.6, rx: -0.35, color: 0xe9c46a });
      }
    }
  }
  return s;
}
