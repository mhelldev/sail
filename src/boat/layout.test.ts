import { describe, expect, it } from 'vitest';
import { PersonController, type WalkInput, type WalkWorld } from '../person/personController';
import { boatSurfaces, CABIN, COCKPIT, deckY, DOOR, halfWidth, HELM_STAND, RAIL, stationT } from './layout';

/** The boat lying still in calm water, in its own frame. */
const world = (doorOpen: boolean): WalkWorld => ({
  waterLevel: () => 0,
  surfacesAt: (x, z) => boatSurfaces(x, z, doorOpen).map((s) => ({ ...s, boat: true })),
});
const idle: WalkInput = { forward: 0, right: 0, jump: false, run: false };
const NORTH = 0; // camera yaw: forward walks towards -Z, the bow

function walk(p: PersonController, w: WalkWorld, seconds: number, input: WalkInput, yaw = NORTH) {
  for (let t = 0; t < seconds; t += 1 / 60) p.step(1 / 60, input, yaw, w);
}

describe('boat layout', () => {
  it('has a lowered cockpit, a cabin under a roof and a railing at the deck edge', () => {
    expect(boatSurfaces(HELM_STAND.x, HELM_STAND.z, false)[0].top).toBe(COCKPIT.floor);
    const cabin = boatSurfaces(0, -1.5, false);
    expect(cabin).toContainEqual({ top: CABIN.floor });
    expect(cabin).toContainEqual({ top: CABIN.roofTop, bottom: CABIN.roofBottom });
    const t = stationT(-4.5);
    const edge = boatSurfaces(halfWidth(t) - 0.05, -4.5, false);
    expect(Math.max(...edge.map((s) => s.top))).toBeCloseTo(deckY(t) + RAIL.height);
    expect(boatSurfaces(5, 0, false)).toEqual([]); // outside the hull
  });

  it('lets you walk from the helm down the steps into the cabin only with the door open', () => {
    for (const open of [false, true]) {
      const p = new PersonController();
      p.place(HELM_STAND.x + 0.0, COCKPIT.floor, 2.6, true); // in front of the wheel, between the benches
      walk(p, world(open), 4, { ...idle, forward: 1 });
      if (open) {
        expect(p.z).toBeLessThan(DOOR.hatchFront);
        expect(p.y).toBeCloseTo(CABIN.floor);
      } else {
        expect(p.z).toBeGreaterThan(CABIN.back);
        expect(p.y).toBeCloseTo(COCKPIT.floor);
      }
    }
  });

  it('keeps you inside the cabin under its roof: walls block, the head bumps the roof', () => {
    const p = new PersonController();
    p.place(0, CABIN.floor, -0.2, true);
    walk(p, world(true), 3, { ...idle, right: 1 }); // towards starboard: settee, then the hull side
    expect(p.x).toBeLessThan(CABIN.halfWidth);
    p.place(0, CABIN.floor, -0.2, true);
    let top = 0;
    p.step(1 / 60, { ...idle, jump: true }, NORTH, world(true));
    for (let i = 0; i < 60; i++) {
      p.step(1 / 60, idle, NORTH, world(true));
      top = Math.max(top, p.y);
    }
    expect(top).toBeLessThanOrEqual(CABIN.roofBottom - 1.7 + 1e-6);
    expect(p.y).toBeCloseTo(CABIN.floor);
  });

  it('stops you at the railing, but you can jump over it', () => {
    const z = -4.5;
    const t = stationT(z);
    const p = new PersonController();
    p.place(0, deckY(t), z, true);
    const EAST = Math.PI / 2;
    walk(p, world(false), 3, { ...idle, forward: 1 }, EAST);
    expect(p.mode).toBe('ground');
    expect(p.x).toBeLessThan(halfWidth(t) - RAIL.band);
    p.step(1 / 60, { ...idle, forward: 1, jump: true }, EAST, world(false));
    walk(p, world(false), 2, { ...idle, forward: 1 }, EAST);
    expect(p.mode).toBe('swim');
  });
});
