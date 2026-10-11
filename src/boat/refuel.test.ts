import { describe, expect, it } from 'vitest';
import { Engine, FUEL_CAPACITY } from './engine';
import { Refuelling } from './refuel';

const alongside = { distance: 6, speed: 0 };

describe('Refuelling', () => {
  it('fills the tank alongside with the engine off', () => {
    const engine = new Engine();
    engine.fuel = 10;
    const r = new Refuelling();
    expect(r.toggle(engine, alongside)).toBeUndefined();
    let result;
    for (let i = 0; i < 200 && !result; i++) result = r.update(0.1, engine, alongside);
    expect(result).toBe('done');
    expect(engine.fuel).toBe(FUEL_CAPACITY);
    expect(r.active).toBe(false);
  });

  it('refuses with the engine on, too far away or moving, and stops when the boat drifts off', () => {
    const engine = new Engine();
    engine.fuel = 10;
    const r = new Refuelling();
    expect(r.toggle(engine, { distance: 40, speed: 0 })).toBe('too far');
    expect(r.toggle(engine, { distance: 5, speed: 2 })).toBe('moving');
    engine.toggleKey();
    expect(r.toggle(engine, alongside)).toBe('engine running');
    engine.toggleKey();
    expect(r.toggle(engine, alongside)).toBeUndefined();
    expect(r.update(0.1, engine, { distance: 30, speed: 0.3 })).toBe('too far');
    expect(r.active).toBe(false);
  });
});
