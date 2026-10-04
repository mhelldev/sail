import { describe, expect, it } from 'vitest';
import { PersonController, type Surface, type WalkInput, type WalkWorld } from './personController';

const idle: WalkInput = { forward: 0, right: 0, jump: false, run: false };
const fwd: WalkInput = { ...idle, forward: 1 };

/**
 * Test world: water at 0. A pier (top 1.7) for x < 0, a 3 m wall at 5 < x < 6 (z < 0 only),
 * open water elsewhere (seabed at -10).
 */
const world: WalkWorld = {
  waterLevel: () => 0,
  surfacesAt(x, z) {
    const s: Surface[] = [{ top: -10, boat: false }];
    if (x < 0) s.push({ top: 1.7, boat: false });
    if (x > 5 && x < 6 && z < 0) s.push({ top: 3, boat: false });
    return s;
  },
};
// Camera yaw π/2 looks east (+X), so "forward" walks along +X.
const EAST = Math.PI / 2;

function run(p: PersonController, seconds: number, input: WalkInput, yaw = EAST) {
  for (let t = 0; t < seconds; t += 1 / 60) p.step(1 / 60, input, yaw, world);
}

describe('PersonController', () => {
  it('walks relative to the camera and faces where it goes', () => {
    const p = new PersonController();
    p.place(-20, 1.7, 0, false);
    run(p, 1, fwd);
    expect(p.x).toBeCloseTo(-18, 1);
    expect(p.facing).toBeCloseTo(Math.PI / 2, 1);
    expect(p.mode).toBe('ground');
  });

  it('jumps and lands again', () => {
    const p = new PersonController();
    p.place(-5, 1.7, 0, false);
    p.step(1 / 60, { ...idle, jump: true }, EAST, world);
    let top = 0;
    for (let i = 0; i < 60; i++) {
      p.step(1 / 60, idle, EAST, world);
      top = Math.max(top, p.y);
    }
    expect(top).toBeGreaterThan(1.7 + 0.6);
    expect(p.y).toBeCloseTo(1.7);
    expect(p.mode).toBe('ground');
  });

  it('falls off the end of the pier into the water and swims', () => {
    const p = new PersonController();
    p.place(-1, 1.7, 0, false);
    run(p, 2, fwd);
    expect(p.mode).toBe('swim');
    expect(p.y).toBeCloseTo(-1.3);
  });

  it('cannot swim through a wall but can climb back onto the pier', () => {
    const p = new PersonController();
    p.place(3, -1.3, -2, false);
    p.mode = 'swim';
    run(p, 5, fwd);
    expect(p.x).toBeLessThan(5); // the 3 m wall blocks
    // Swim back west to the pier and pull up.
    const WEST = -Math.PI / 2;
    run(p, 4, fwd, WEST);
    expect(p.mode).toBe('swim');
    p.step(1 / 60, { ...idle, jump: true }, WEST, world);
    expect(p.mode).toBe('ground');
    expect(p.y).toBeCloseTo(1.7);
  });

  it('knows when it stands on the boat', () => {
    const boatWorld: WalkWorld = { waterLevel: () => 0, surfacesAt: () => [{ top: 1.1, boat: true }] };
    const p = new PersonController();
    p.place(0, 1.3, 0, false);
    for (let i = 0; i < 30; i++) p.step(1 / 60, idle, 0, boatWorld);
    expect(p.onBoat).toBe(true);
    expect(p.y).toBeCloseTo(1.1);
  });
});
