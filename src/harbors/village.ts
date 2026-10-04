// Procedural harbour village: pier, pontoons, moored boats, breakwaters with harbour lights,
// quayside houses, lanes of gabled houses, a church, sometimes a windmill, trees.
// Pure and deterministic per harbour: it only returns where things go; rendering is separate.

import alea from 'alea';
import type { Harbor } from './harborData';

export type PartType =
  | 'house'
  | 'roof'
  | 'chimney'
  | 'tower'
  | 'spire'
  | 'deck'
  | 'pile'
  | 'pontoon'
  | 'breakwater'
  | 'harbourLight'
  | 'hull'
  | 'mast'
  | 'cabin'
  | 'crown'
  | 'conifer'
  | 'trunk'
  | 'flagpole'
  | 'flag'
  | 'millTower'
  | 'millCap'
  | 'rock'
  | 'lampPost';

/** One instance of a unit mesh: position of its base, rotation around Y, size, colour (sRGB hex). */
export interface Part {
  type: PartType;
  x: number;
  y: number;
  z: number;
  rotY: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
}

/** Oriented box in the water the boat must not sail through (local X = width, local Z = length). */
export interface Obstacle {
  x: number;
  z: number;
  halfW: number;
  halfL: number;
  rotY: number;
}

export interface Village {
  harborId: number;
  parts: Part[];
  obstacles: Obstacle[];
  /** windmills: their sails turn */
  mills: Array<{ x: number; y: number; z: number; rotY: number }>;
  /** lighthouses the village wants (when there is no real one nearby) */
  lighthouses: Array<{ x: number; z: number }>;
  /** lamps that glow at night: harbour lights, street lamps */
  lights: Array<{ x: number; y: number; z: number; color: number }>;
}

export interface Ground {
  /** signed distance to the coast in metres, positive on land */
  sd(x: number, z: number): number;
  /** terrain height in metres */
  height(x: number, z: number): number;
}

const WALLS = [0x8e3b2e, 0x7a3326, 0xa2492f, 0xeae6dc, 0xf1ece0, 0xe7d8b4, 0xd9c59a, 0xb9c4c9, 0x9aa9a0];
const ROOFS = [0x3d3f46, 0x2e3035, 0x9c3b25, 0x8a3420, 0x4a4038, 0x5b5f66];
const HULLS = [0xf4f2ec, 0xf4f2ec, 0xf4f2ec, 0x1d3557, 0x8c2f2a, 0x2a6f6b, 0xe9c46a];
const ROCK = 0x3b3833;
const ROCKS = [0x5f5a52, 0x6d6860, 0x4d4a45, 0x7a746a];
const WOOD = 0x8a6a46;
const PONTOON = 0xc9c4b8;

/** World position for local (u along the shore, v out to sea) around the harbour's shore point. */
function frame(h: Harbor) {
  const tx = -h.seaZ; // along the shore
  const tz = h.seaX;
  return {
    at: (u: number, v: number) => ({ x: h.x + tx * u + h.seaX * v, z: h.z + tz * u + h.seaZ * v }),
    /** rotation that turns a part's local +Z towards local (du, dv) */
    rot: (du: number, dv: number) => Math.atan2(tx * du + h.seaX * dv, tz * du + h.seaZ * dv),
  };
}

export function generateVillage(h: Harbor, ground: Ground, options: { hasRealLighthouse: boolean }): Village {
  const rng = alea(`${h.id}:${h.name}`);
  const rand = (a: number, b: number) => a + (b - a) * rng();
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
  const { at, rot } = frame(h);
  const parts: Part[] = [];
  const obstacles: Obstacle[] = [];
  const mills: Village['mills'] = [];
  const lighthouses: Village['lighthouses'] = [];
  const lights: Village['lights'] = [];
  const add = (p: Part) => parts.push(p);
  const big = h.isHarbour;

  // ---- Water side -----------------------------------------------------------------------------
  const seaward = rot(0, 1);
  const alongShore = rot(1, 0);

  // Pier: as long as there is open water ahead (the coast is coarse; channels can be narrow).
  let pierLen = big ? rand(80, 130) : rand(55, 100);
  for (let v = 10; v <= pierLen; v += 10) {
    const p = at(0, v);
    if (ground.sd(p.x, p.z) > -4) {
      pierLen = v - 10;
      break;
    }
  }
  const hasPier = pierLen >= 30;
  let reach = 0; // how far the pontoons stick out sideways
  if (hasPier) {
    const mid = at(0, (pierLen - 4) / 2);
    add({ type: 'deck', x: mid.x, y: 1.2, z: mid.z, rotY: seaward, sx: 3.6, sy: 0.5, sz: pierLen + 4, color: WOOD });
    obstacles.push({ x: mid.x, z: mid.z, halfW: 2.3, halfL: (pierLen + 4) / 2, rotY: seaward });
    for (let v = 4; v <= pierLen; v += 9) {
      for (const u of [-1.6, 1.6]) {
        const p = at(u, v);
        add({ type: 'pile', x: p.x, y: -3, z: p.z, rotY: 0, sx: 0.5, sy: 4.6, sz: 0.5, color: 0x4b3a2a });
      }
    }

    // Pontoon fingers with moored boats on both sides.
    const fingers = big ? Math.floor(rand(4, 7)) : Math.floor(rand(2, 5));
    const spacing = rand(15, 19);
    for (let i = 0; i < fingers; i++) {
      const v = 16 + i * spacing;
      if (v > pierLen - 6) break;
      for (const side of [-1, 1]) {
        if (rng() < 0.15) continue;
        const len = rand(14, 26);
        const end = at(side * (2 + len), v);
        if (ground.sd(end.x, end.z) > -4) continue;
        reach = Math.max(reach, 2 + len);
        const c = at(side * (2 + len / 2), v);
        add({ type: 'pontoon', x: c.x, y: 0.25, z: c.z, rotY: alongShore, sx: 1.8, sy: 0.45, sz: len, color: PONTOON });
        obstacles.push({ x: c.x, z: c.z, halfW: 1.4, halfL: len / 2, rotY: alongShore });
        // Boats lie alongside the finger, bows pointing along it.
        for (let s = 6; s < len - 2; s += rand(9.5, 12)) {
          for (const off of [-1, 1]) {
            if (rng() < 0.25) continue;
            const length = rand(7, 11);
            const beam = length * rand(0.3, 0.36);
            const b = at(side * (2 + s), v + off * (beam / 2 + 1.4));
            const facing = side > 0 ? alongShore : alongShore + Math.PI;
            addBoat(b.x, b.z, facing, length, beam);
          }
        }
      }
    }
  }

  function addBoat(x: number, z: number, rotY: number, length: number, beam: number) {
    const freeboard = length * 0.16;
    add({ type: 'hull', x, y: 0, z, rotY, sx: beam, sy: freeboard, sz: length, color: pick(HULLS) });
    const deckY = freeboard * 0.65;
    if (rng() < 0.75) {
      // Sailboat: low coachroof and a mast.
      add({ type: 'cabin', x, y: deckY, z, rotY, sx: beam * 0.55, sy: 0.6, sz: length * 0.35, color: 0xece9e1 });
      add({ type: 'mast', x, y: deckY, z, rotY, sx: 0.16, sy: length * 1.25, sz: 0.16, color: 0xd8dde2 });
    } else {
      // Motorboat: taller wheelhouse.
      add({ type: 'cabin', x, y: deckY, z, rotY, sx: beam * 0.75, sy: 1.5, sz: length * 0.4, color: 0xf1f1ee });
    }
    obstacles.push({ x, z, halfW: beam / 2, halfL: length / 2, rotY });
  }

  // Breakwaters: two rock arms around the basin, harbour lights at the mouth.
  if (hasPier && (big || rng() < 0.5)) {
    const width = Math.max(reach, 25) + 18;
    const depth = pierLen + 18;
    const mouth = 14;
    const arms: Array<{ side: number; light: number }> = [
      { side: -1, light: 0xd62828 },
      { side: 1, light: 0x2a9d48 },
    ];
    for (const { side, light } of arms) {
      const segments: Array<[number, number, number, number]> = [
        [side * width, 0, side * width, depth], // out to sea
        [side * width, depth, side * mouth, depth], // back towards the mouth
      ];
      const inWater = segments.every(([u0, v0, u1, v1]) => {
        const m = at((u0 + u1) / 2, (v0 + v1) / 2);
        const e = at(u1, v1);
        return ground.sd(m.x, m.z) < -3 && ground.sd(e.x, e.z) < -3;
      });
      if (!inWater) continue;
      for (const [u0, v0, u1, v1] of segments) {
        const m = at((u0 + u1) / 2, (v0 + v1) / 2);
        const len = Math.hypot(u1 - u0, v1 - v0) + 7;
        const r = rot(u1 - u0, v1 - v0);
        add({ type: 'breakwater', x: m.x, y: -2.5, z: m.z, rotY: r, sx: 7, sy: 3.9, sz: len, color: ROCK });
        // Two rows of boulders on top, so it reads as a rubble mound rather than concrete.
        const steps = Math.floor(len / 1.7);
        for (let k = 0; k <= steps * 2; k++) {
          const f = (k >> 1) / steps;
          const across = (k & 1 ? 1 : -1) * rand(0.4, 2.4);
          const b = at(u0 + (u1 - u0) * f, v0 + (v1 - v0) * f);
          const bx = b.x + Math.cos(r) * across;
          const bz = b.z - Math.sin(r) * across;
          const size = rand(1.8, 3.2);
          add({ type: 'rock', x: bx, y: 1.2 + rand(-0.3, 0.3), z: bz, rotY: rng() * Math.PI * 2, sx: size, sy: size * rand(0.6, 0.9), sz: size * rand(0.9, 1.3), color: pick(ROCKS) });
        }
        obstacles.push({ x: m.x, z: m.z, halfW: 3.5, halfL: len / 2, rotY: r });
      }
      const tip = at(side * mouth, depth);
      add({ type: 'harbourLight', x: tip.x, y: 2, z: tip.z, rotY: 0, sx: 1.6, sy: 6, sz: 1.6, color: light });
      lights.push({ x: tip.x, y: 8.4, z: tip.z, color: light });
    }
    if (big && !options.hasRealLighthouse && rng() < 0.6) {
      const p = at(-width - 25, -10);
      if (ground.sd(p.x, p.z) > 4) lighthouses.push(p);
    }
  }

  // ---- Land side --------------------------------------------------------------------------------
  const occupied: Array<{ x: number; z: number; r: number }> = [];
  const free = (x: number, z: number, r: number) => occupied.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r);
  const centre = at(0, -120);
  const baseHeight = Math.max(1, ground.height(centre.x, centre.z));

  /** Ground is buildable: dry, well away from the water and not on a slope. */
  const buildable = (x: number, z: number, r: number, minSd = 12) =>
    ground.sd(x, z) > minSd && ground.height(x, z) < baseHeight + 6 && free(x, z, r);

  function addHouse(u: number, v: number, front: number, scale = 1): boolean {
    const p = at(u, v);
    const width = rand(5.5, 8) * scale;
    const depth = rand(8, 12) * scale;
    const r = Math.max(width, depth) / 2 + 1.5;
    if (!buildable(p.x, p.z, r)) return false;
    occupied.push({ x: p.x, z: p.z, r });
    const y = ground.height(p.x, p.z) - 0.3;
    const walls = rand(3.5, 6.8) * scale;
    // Dutch style: most gables face the street (ridge runs front to back).
    const ridgeAlongDepth = rng() < 0.65;
    const roofRot = ridgeAlongDepth ? front : front + Math.PI / 2;
    const [rw, rd] = ridgeAlongDepth ? [width, depth] : [depth, width];
    add({ type: 'house', x: p.x, y, z: p.z, rotY: front, sx: width, sy: walls, sz: depth, color: pick(WALLS) });
    add({ type: 'roof', x: p.x, y: y + walls, z: p.z, rotY: roofRot, sx: rw + 0.6, sy: rw * rand(0.5, 0.75), sz: rd + 0.4, color: pick(ROOFS) });
    if (rng() < 0.5) {
      const c = at(u + rand(-1, 1), v + rand(-1, 1));
      add({ type: 'chimney', x: c.x, y: y + walls, z: c.z, rotY: front, sx: 0.8, sy: rw * 0.55 + 1.2, sz: 0.8, color: 0x6b3d32 });
    }
    return true;
  }

  // Harbourmaster's office at the root of the pier, with a flag.
  {
    const p = at(10, -14);
    if (buildable(p.x, p.z, 7, 5)) {
      occupied.push({ x: p.x, z: p.z, r: 7 });
      const y = ground.height(p.x, p.z) - 0.3;
      add({ type: 'house', x: p.x, y, z: p.z, rotY: seaward, sx: 11, sy: 6.5, sz: 8, color: 0xf3f1ea });
      add({ type: 'roof', x: p.x, y: y + 6.5, z: p.z, rotY: alongShore, sx: 8.6, sy: 3, sz: 11.6, color: 0x2e3035 });
      const f = at(3, -9.5);
      add({ type: 'flagpole', x: f.x, y, z: f.z, rotY: 0, sx: 0.15, sy: 11, sz: 0.15, color: 0xeeeeee });
      add({ type: 'flag', x: f.x, y: y + 9.4, z: f.z, rotY: alongShore, sx: 0.05, sy: 1.2, sz: 1.8, color: pick([0xae1c28, 0x21468b, 0xf2a900]) });
    }
  }

  // Landmarks first, so the house rows don't take their lots.
  const quay = big ? rand(80, 150) : rand(45, 90);
  const street = big ? rand(220, 380) : rand(110, 220);
  // Church with a spire, set back from the main street.
  {
    const side = rng() < 0.5 ? -1 : 1;
    const v = -street * rand(0.35, 0.65);
    const p = at(side * 30, v);
    if (buildable(p.x, p.z, 14)) {
      occupied.push({ x: p.x, z: p.z, r: 14 });
      const y = ground.height(p.x, p.z) - 0.3;
      const walls = rng() < 0.5 ? 0xe9e4d8 : 0x8e3b2e;
      add({ type: 'house', x: p.x, y, z: p.z, rotY: seaward, sx: 10, sy: 9, sz: 22, color: walls });
      add({ type: 'roof', x: p.x, y: y + 9, z: p.z, rotY: seaward, sx: 10.8, sy: 7, sz: 22.4, color: 0x3d3f46 });
      const t = at(side * 30, v + 13);
      add({ type: 'tower', x: t.x, y, z: t.z, rotY: seaward, sx: 6, sy: 22, sz: 6, color: walls });
      add({ type: 'spire', x: t.x, y: y + 22, z: t.z, rotY: seaward, sx: 6.4, sy: 14, sz: 6.4, color: 0x2e4a3e });
    }
  }

  // Windmill at the edge of the village.
  if (rng() < 0.4) {
    const side = rng() < 0.5 ? -1 : 1;
    const p = at(side * (quay + rand(40, 90)), -rand(60, 160));
    if (buildable(p.x, p.z, 10, 20)) {
      occupied.push({ x: p.x, z: p.z, r: 10 });
      const y = ground.height(p.x, p.z) - 0.3;
      add({ type: 'millTower', x: p.x, y, z: p.z, rotY: 0, sx: 7, sy: 14, sz: 7, color: pick([0x5a5048, 0xe9e4d8, 0x7a3326]) });
      add({ type: 'millCap', x: p.x, y: y + 14, z: p.z, rotY: seaward, sx: 5, sy: 3.5, sz: 5, color: 0x3a3a3a });
      mills.push({ x: p.x, y: y + 15, z: p.z, rotY: seaward });
    }
  }

  // Street lamps along the quay.
  for (let u = -quay; u <= quay; u += 24) {
    const p = at(u, -13);
    if (ground.sd(p.x, p.z) < 6 || !free(p.x, p.z, 0.5)) continue;
    const y = ground.height(p.x, p.z);
    add({ type: 'lampPost', x: p.x, y, z: p.z, rotY: 0, sx: 0.22, sy: 5, sz: 0.22, color: 0x2b2f33 });
    lights.push({ x: p.x, y: y + 5.2, z: p.z, color: 0xffc070 });
  }

  // Quayside row facing the water.
  for (let u = -quay; u <= quay; u += rand(9.5, 13)) addHouse(u, -24, seaward);

  // Main street inland, side streets branching off it.
  const inland = rot(0, -1);
  for (let v = -40; v >= -street; v -= rand(10.5, 13.5)) {
    addHouse(-11, v, alongShore); // front faces the street
    addHouse(11, v, alongShore + Math.PI);
  }
  const sideStreets = big ? Math.floor(rand(2, 4)) : Math.floor(rand(1, 3));
  for (let i = 0; i < sideStreets; i++) {
    const v0 = -60 - rng() * (street - 60);
    const dir = rng() < 0.5 ? -1 : 1;
    const len = rand(50, big ? 150 : 100);
    for (let s = 24; s < len; s += rand(10.5, 13.5)) {
      addHouse(dir * s, v0 - 11, seaward);
      addHouse(dir * s, v0 + 11, inland);
    }
  }

  // Trees scattered around the village.
  const trees = big ? Math.floor(rand(60, 110)) : Math.floor(rand(35, 70));
  for (let i = 0, tries = 0; i < trees && tries < trees * 4; tries++) {
    const a = rng() * Math.PI * 2;
    const d = rand(30, 420);
    const p = { x: centre.x + Math.cos(a) * d, z: centre.z + Math.sin(a) * d };
    if (ground.sd(p.x, p.z) < 8 || ground.height(p.x, p.z) > baseHeight + 25 || !free(p.x, p.z, 3.5)) continue;
    occupied.push({ x: p.x, z: p.z, r: 3.5 });
    const y = ground.height(p.x, p.z) - 0.2;
    if (rng() < 0.7) {
      const s = rand(3.2, 5.5);
      add({ type: 'trunk', x: p.x, y, z: p.z, rotY: 0, sx: 0.5, sy: s * 0.8, sz: 0.5, color: 0x5a4330 });
      add({ type: 'crown', x: p.x, y: y + s * 0.8 + s * 0.7, z: p.z, rotY: rng() * Math.PI, sx: s, sy: s * rand(0.85, 1.15), sz: s, color: pick([0x3f6b2a, 0x4d7a2f, 0x355e26, 0x5d8a35]) });
    } else {
      const s = rand(7, 12);
      add({ type: 'trunk', x: p.x, y, z: p.z, rotY: 0, sx: 0.45, sy: 1.6, sz: 0.45, color: 0x5a4330 });
      add({ type: 'conifer', x: p.x, y: y + 1.2, z: p.z, rotY: 0, sx: s * 0.42, sy: s, sz: s * 0.42, color: pick([0x2b4a2a, 0x24412a, 0x30552f]) });
    }
    i++;
  }

  return { harborId: h.id, parts, obstacles, mills, lighthouses, lights };
}

/** Signed distance to an obstacle box: positive inside (like land), negative outside. */
export function obstacleDistance(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x;
  const dz = z - o.z;
  const c = Math.cos(o.rotY);
  const s = Math.sin(o.rotY);
  // World → local for a Y rotation: local X axis = (cos, -sin), local Z axis = (sin, cos).
  const lx = Math.abs(dx * c - dz * s) - o.halfW;
  const lz = Math.abs(dx * s + dz * c) - o.halfL;
  const outside = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
  const inside = Math.min(Math.max(lx, lz), 0);
  return -(outside + inside);
}
