import { describe, expect, it } from 'vitest';
import { Engine, ENGINE, FUEL_CAPACITY } from './engine';

function run(e: Engine, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) e.update(0.05);
}

describe('Engine', () => {
  it('starts with key on and START in neutral, and stops with the key', () => {
    const e = new Engine();
    expect(e.pressStart()).toBe(false); // key off
    e.toggleKey();
    e.setLever(0.5);
    expect(e.pressStart()).toBe(false); // in gear
    e.setLever(0);
    expect(e.warnings).toBe(true);
    expect(e.pressStart()).toBe(true);
    run(e, ENGINE.crankTime + 0.2);
    expect(e.running).toBe(true);
    expect(e.warnings).toBe(false);
    e.toggleKey();
    expect(e.running).toBe(false);
  });

  it('gives thrust only in gear: ahead, astern, nothing in neutral', () => {
    const e = new Engine();
    e.toggleKey();
    e.pressStart();
    run(e, 2);
    e.setLever(0.05);
    expect(e.thrust).toBe(0);
    e.setLever(1);
    expect(e.thrust).toBe(1);
    e.setLever(-1);
    expect(e.thrust).toBe(-1);
  });

  it('burns more fuel at full throttle, dies when dry and will not start again', () => {
    const idle = new Engine();
    const full = new Engine();
    for (const e of [idle, full]) {
      e.toggleKey();
      e.pressStart();
      run(e, 2);
    }
    full.setLever(1);
    run(idle, 10);
    run(full, 10);
    expect(FUEL_CAPACITY - full.fuel).toBeGreaterThan((FUEL_CAPACITY - idle.fuel) * 4);

    full.fuel = 0.01;
    run(full, 1);
    expect(full.fuel).toBe(0);
    expect(full.running).toBe(false);
    full.setLever(0);
    expect(full.pressStart()).toBe(true); // it cranks…
    run(full, 3);
    expect(full.running).toBe(false); // …but doesn't catch
  });
});
