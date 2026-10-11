import { describe, expect, it } from 'vitest';
import { beaufort, cpa, directionWord16, spokenHarbor, VhfBrain, type RadioWorld } from './vhf';

const calm: RadioWorld = {
  wind: { direction: 225, speed: 7 },
  boat: { x: 0, z: 0, heading: 0, speed: 3, sailUp: true, grounded: false },
  coastDistance: -5000,
  vessels: [],
};

function run(brain: VhfBrain, world: RadioWorld, seconds: number) {
  const said = [];
  for (let t = 0; t < seconds; t += 0.5) said.push(...brain.update(0.5, world));
  return said;
}

describe('VHF', () => {
  it('knows its Beaufort and compass words', () => {
    expect(beaufort(0.1)).toBe(0);
    expect(beaufort(7)).toBe(4);
    expect(beaufort(30)).toBe(11);
    expect(directionWord16(225)).toBe('south-west');
    expect(spokenHarbor('WV Brouwershaven')).toBe('Brouwershaven');
  });

  it('computes the closest point of approach', () => {
    // A ship 1 km north heading south at 5 m/s, the yacht still: they meet in 200 s.
    const c = cpa({ x: 0, z: -1000, heading: 180, speed: 5 }, { x: 0, z: 0, heading: 0, speed: 0 });
    expect(c.time).toBeCloseTo(200);
    expect(c.distance).toBeCloseTo(0);
  });

  it('is quiet most of the time, then reads the weather', () => {
    const brain = new VhfBrain(() => 0.5);
    expect(run(brain, calm, 30)).toEqual([]);
    const said = run(brain, calm, 30);
    expect(said).toHaveLength(1);
    expect(said[0].speaker).toBe('coastguard');
    expect(said[0].text).toContain('Wind south-west, force 4');
  });

  it('a ship on a collision course calls the yacht once', () => {
    const brain = new VhfBrain(() => 0.5);
    run(brain, calm, 60); // weather first
    const world: RadioWorld = { ...calm, vessels: [{ id: 3, kind: 'cargo', x: 0, z: -1500, heading: 180, speed: 7 }] };
    const said = run(brain, world, 60);
    expect(said).toHaveLength(1);
    expect(said[0].speaker).toBe('ship');
    expect(said[0].text).toMatch(/^Sailing yacht on my (port|starboard) bow/);
    expect(run(brain, world, 120)).toEqual([]);
  });

  it('warns about the shore', () => {
    const brain = new VhfBrain(() => 0.5);
    const said = run(brain, { ...calm, coastDistance: -50 }, 2);
    expect(said[0].text).toContain('standing into danger');
  });

  it('speaks German when asked', () => {
    const brain = new VhfBrain(() => 0.5);
    brain.language = 'de';
    const said = run(brain, { ...calm, harbor: { name: 'WV Brouwershaven', distance: 3000, isHarbour: false } }, 60);
    expect(said[0].text).toContain('Seewetterbericht für das Gebiet Brouwershaven');
    expect(said[0].text).toContain('Wind Südwest 4');
    expect(said[0].text).toContain('See mäßig bewegt');
    expect(said[0].text).toMatch(/Ende\.$/);
    const ship = run(brain, { ...calm, vessels: [{ id: 3, kind: 'cargo', x: 0, z: -1500, heading: 180, speed: 7 }] }, 60);
    expect(ship[0].text).toMatch(/^Segelyacht an meinem (Steuerbord|Backbord)bug/);
    expect(ship[0].text).toContain('Seemeilen');
    expect(ship[0].text).toMatch(/Kommen\.$/);
  });
});
