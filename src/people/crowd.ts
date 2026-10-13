// The people in the villages near the player. Pure (no three.js): about ten per village, each with
// a persona, looks and a voice, spawned the same way every time (seeded by the village). They walk
// the village's walkways from point to point, now and then stop to look around, and stand still to
// talk when the player is in front of them.

import alea from 'alea';
import type { WalkGraph } from '../harbors/village';
import { makePersona, type Persona } from './talk';

export const CROWD = {
  perVillage: 10,
  /** the talker stops and turns this fast (rad/s) */
  turnRate: 4,
};

const SKIN = [0xf1c7a5, 0xe0ac86, 0xc68863, 0x8d5a3b, 0x5c3a24, 0xf5d3b8];
const HAIR = [0x2a1d14, 0x4a3221, 0x7a5532, 0xc9a165, 0xd8c9a8, 0x1a1a1a, 0x8e3b1f, 0xb0b0b0];
const SHIRTS = [0x1d3557, 0xc8231d, 0xf2f0e8, 0x2f7d47, 0xf2a33a, 0x6a2f8a, 0x3b8ec8, 0xe9c46a, 0x5b5f66, 0xd96c8a];
const PANTS = [0x22304a, 0x3b3b3b, 0x5a4a3a, 0x2c4e6e, 0xc9bfa8, 0x1a1a1a];

export interface Person {
  /** unique: village id × 100 + index */
  id: number;
  village: number;
  persona: Persona;
  colors: { shirt: number; pants: number; skin: number; hair: number };
  /** body size (kids are small) */
  scale: number;
  /** voice: which of the available voices, pitch, rate */
  voice: number;
  pitch: number;
  rate: number;
  x: number;
  z: number;
  /** facing, radians around Y (atan2(dx, dz)) */
  heading: number;
  speed: number;
  /** walking from node `from` to node `to` */
  from: number;
  to: number;
  /** seconds left standing still */
  pause: number;
  /** walking animation phase, and how much it walks (0 standing … 1 walking) */
  phase: number;
  walking: number;
  /** stands and faces this point (talking to the player) */
  listener?: { x: number; z: number };
  /** seconds before this person will talk again */
  cooldown: number;
  /** walks this far to the right of the walkway's centre line (so people pass instead of overlapping) */
  lane: number;
}

interface Group {
  graph: WalkGraph;
  people: Person[];
}

export class Crowd {
  private readonly groups = new Map<number, Group>();

  get people(): Person[] {
    const out: Person[] = [];
    for (const g of this.groups.values()) out.push(...g.people);
    return out;
  }

  /** Villages near the player: their people come, those of villages left behind go. */
  sync(villages: Array<{ id: number; walkways: WalkGraph }>): void {
    const ids = new Set(villages.map((v) => v.id));
    for (const id of [...this.groups.keys()]) if (!ids.has(id)) this.groups.delete(id);
    for (const v of villages) if (!this.groups.has(v.id)) this.groups.set(v.id, { graph: v.walkways, people: spawn(v.id, v.walkways) });
  }

  graphOf(person: Person): WalkGraph | undefined {
    return this.groups.get(person.village)?.graph;
  }

  update(dt: number): void {
    for (const g of this.groups.values()) for (const p of g.people) step(p, g.graph, dt);
  }
}

function spawn(village: number, graph: WalkGraph): Person[] {
  const rng = alea(`people:${village}`);
  const usable = graph.links.map((l, i) => (l.length ? i : -1)).filter((i) => i >= 0);
  if (usable.length < 4) return [];
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
  const count = Math.min(CROWD.perVillage, Math.floor(usable.length / 3));
  const people: Person[] = [];
  for (let i = 0; i < count; i++) {
    const persona = makePersona(rng);
    const from = pick(usable);
    const to = pick(graph.links[from]);
    const kid = persona.age === 'kid';
    const n = graph.nodes[from];
    people.push({
      id: village * 100 + i,
      village,
      persona,
      colors: { shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN), hair: persona.age === 'old' ? pick([0xb0b0b0, 0xd8d8d8, 0x8a8a8a]) : pick(HAIR) },
      scale: kid ? 0.62 + rng() * 0.1 : (persona.female ? 0.92 : 1) * (0.94 + rng() * 0.1),
      voice: Math.floor(rng() * 1000),
      pitch: kid ? 1.5 : persona.female ? 1.15 + rng() * 0.15 : persona.age === 'old' ? 0.8 + rng() * 0.1 : 0.9 + rng() * 0.12,
      rate: persona.age === 'old' ? 0.9 : 0.97 + rng() * 0.1,
      x: n.x,
      z: n.z,
      heading: rng() * Math.PI * 2,
      speed: kid ? 1.5 : persona.age === 'old' ? 0.8 : 1.05 + rng() * 0.35,
      from,
      to,
      pause: rng() * 3,
      phase: rng() * Math.PI * 2,
      walking: 0,
      cooldown: 0,
      lane: (rng() - 0.5) * 1.4,
    });
  }
  return people;
}

function step(p: Person, g: WalkGraph, dt: number): void {
  p.cooldown = Math.max(0, p.cooldown - dt);
  const turn = (want: number) => {
    let d = want - p.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.heading += Math.max(-CROWD.turnRate * dt, Math.min(CROWD.turnRate * dt, d));
    p.heading = Math.atan2(Math.sin(p.heading), Math.cos(p.heading));
  };
  if (p.listener) {
    // Talking: stand still, face the player.
    p.walking = Math.max(0, p.walking - dt * 4);
    turn(Math.atan2(p.listener.x - p.x, p.listener.z - p.z));
    return;
  }
  if (p.pause > 0) {
    p.pause -= dt;
    p.walking = Math.max(0, p.walking - dt * 4);
    return;
  }
  // Aim at the next point, shifted sideways onto this person's lane.
  const a = g.nodes[p.from];
  const b = g.nodes[p.to];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const tx = b.x + (-(b.z - a.z) / len) * p.lane;
  const tz = b.z + ((b.x - a.x) / len) * p.lane;
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) {
    // At a point: sometimes stop for a while, then on to a neighbour (not straight back, if possible).
    const options = g.links[p.to].filter((n) => n !== p.from);
    const next = (options.length ? options : g.links[p.to])[Math.floor(Math.random() * Math.max(1, (options.length ? options : g.links[p.to]).length))];
    p.from = p.to;
    if (next !== undefined) p.to = next;
    if (Math.random() < 0.12) p.pause = 2 + Math.random() * 6;
    return;
  }
  p.walking = Math.min(1, p.walking + dt * 3);
  const move = Math.min(d, p.speed * dt);
  p.x += (dx / d) * move;
  p.z += (dz / d) * move;
  p.phase += dt * p.speed * 4.2 / p.scale;
  turn(Math.atan2(dx, dz));
}

/** Where along its walk a person is: the two points and how far between them (for the height). */
export function segment(p: Person, g: WalkGraph): { a: WalkGraph['nodes'][number]; b: WalkGraph['nodes'][number]; t: number } {
  const a = g.nodes[p.from];
  const b = g.nodes[p.to];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { a, b, t: Math.min(1, Math.max(0, Math.hypot(p.x - a.x, p.z - a.z) / len)) };
}
