import { describe, expect, it } from 'vitest';
import alea from 'alea';
import { conversation, factSentences, makePersona, placeName, type TalkContext } from './talk';

const context: TalkContext = {
  place: 'Brouwershaven',
  others: [{ name: 'Zierikzee', km: 6.2, direction: 'south' }, { name: 'Scharendijke', km: 9, direction: 'north-east' }],
  wind: { direction: 'south-west', force: 4 },
  rain: 0,
  fog: 0,
  facts: ['Brouwershaven is a small city in the Dutch province of Zeeland.'],
  boatNear: true,
  hungry: false,
  thirsty: false,
};

describe('people talk', () => {
  it('greets, talks about three things, says goodbye — a fact first if there is one', () => {
    const rng = alea('talk');
    for (let i = 0; i < 50; i++) {
      const p = makePersona(rng);
      const lines = conversation(p, context, rng);
      expect(lines).toHaveLength(5);
      expect(lines[0]).toContain(p.name);
      expect(lines.some((l) => l.includes('province of Zeeland'))).toBe(true);
      for (const l of lines) expect(l).not.toMatch(/undefined|NaN|\$\{/);
    }
  });

  it('tips a real nearby marina and knows the weather', () => {
    const rng = alea('tips');
    const all = Array.from({ length: 200 }, () => conversation(makePersona(rng), { ...context, facts: [] }, rng).join(' ')).join(' ');
    expect(all).toMatch(/Zierikzee|Scharendijke/);
    expect(all).toMatch(/force 4/);
    expect(all).toMatch(/once upon|grandfather|seal|storm|hat|whale|lighthouse|cheese|ferry/i);
  });

  it('notices when you look hungry', () => {
    const rng = alea('hungry');
    const all = Array.from({ length: 100 }, () => conversation(makePersona(rng), { ...context, boatNear: false, hungry: true }, rng).join(' ')).join(' ');
    expect(all).toMatch(/hungry|eaten/);
  });

  it('says place names without the club, and picks speakable sentences', () => {
    expect(placeName('Jachthaven Scharendijke')).toBe('Scharendijke');
    expect(placeName('WV Brouwershaven')).toBe('Brouwershaven');
    expect(placeName('Watersportvereniging Noord-Beveland')).toBe('Noord-Beveland');
    expect(placeName('Haven')).toBe('Haven');
    const facts = factSentences('Zierikzee (Dutch pronunciation: [ˈziːrɪkzeː]) is a small city in the municipality of Schouwen-Duiveland. It has about 11,000 inhabitants. Short. Population: 11,000; area: 34 km2.');
    expect(facts).toEqual(['Zierikzee is a small city in the municipality of Schouwen-Duiveland.', 'It has about 11,000 inhabitants.'].filter((s) => s.length >= 40));
  });
});
