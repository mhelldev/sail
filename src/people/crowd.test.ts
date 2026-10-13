import { describe, expect, it } from 'vitest';
import type { Harbor } from '../harbors/harborData';
import { generateVillage, type Ground } from '../harbors/village';
import { Crowd } from './crowd';

const ground: Ground = { sd: (x) => -x, height: (x) => (x < 0 ? 3 : -5) };
const harbor = (id: number): Harbor => ({ id, name: `Test ${id}`, lat: 0, lon: 0, x: 0, z: 0, seaX: 1, seaZ: 0, isHarbour: true });

describe('crowd', () => {
  const village = generateVillage(harbor(3), ground, { hasRealLighthouse: true });

  it('puts about ten people in a village, the same ones every time', () => {
    const a = new Crowd();
    a.sync([{ id: 3, walkways: village.walkways }]);
    const b = new Crowd();
    b.sync([{ id: 3, walkways: village.walkways }]);
    expect(a.people.length).toBe(10);
    expect(a.people.map((p) => p.persona.name)).toEqual(b.people.map((p) => p.persona.name));
    a.sync([]);
    expect(a.people).toHaveLength(0);
  });

  it('walks along the walkways (always near a linked segment, on land or the pier)', () => {
    const crowd = new Crowd();
    crowd.sync([{ id: 3, walkways: village.walkways }]);
    const start = crowd.people.map((p) => [p.x, p.z]);
    const { nodes } = village.walkways;
    for (let i = 0; i < 1200; i++) {
      crowd.update(0.05);
      for (const p of crowd.people) {
        const a = nodes[p.from];
        const b = nodes[p.to];
        // On the segment from a to b.
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const cross = Math.abs((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / len;
        expect(cross).toBeLessThan(1.6); // its lane is up to 0.7 m off the centre line (more while turning a corner)
      }
    }
    expect(crowd.people.filter((p, i) => Math.hypot(p.x - start[i][0], p.z - start[i][1]) > 5).length).toBeGreaterThan(5);
  });

  it('stands still and turns to face whoever talks to them', () => {
    const crowd = new Crowd();
    crowd.sync([{ id: 3, walkways: village.walkways }]);
    const p = crowd.people[0];
    p.listener = { x: p.x + 2, z: p.z };
    const at = [p.x, p.z];
    for (let i = 0; i < 40; i++) crowd.update(0.05);
    expect([p.x, p.z]).toEqual(at);
    expect(p.heading).toBeCloseTo(Math.PI / 2, 2);
    expect(p.walking).toBe(0);
  });
});
