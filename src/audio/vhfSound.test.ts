import { describe, expect, it } from 'vitest';
import { radioVoices } from './vhfSound';

const voice = (name: string, lang: string) => ({ name, lang });

describe('radioVoices', () => {
  it('never picks singing or robotic novelty voices, and prefers good English ones', () => {
    const all = [
      voice('Anna', 'de-DE'),
      voice('Good News', 'en-US'),
      voice('Cellos', 'en-US'),
      voice('Gute Neuigkeiten', 'en-US'),
      voice('Eddy (Englisch (Vereinigtes Königreich))', 'en-GB'),
      voice('Daniel', 'en-GB'),
      voice('Samantha', 'en-US'),
      voice('Google UK English Male', 'en-GB'),
    ];
    const names = radioVoices(all).map((i) => all[i].name);
    expect(names).toEqual(expect.arrayContaining(['Daniel', 'Samantha', 'Google UK English Male']));
    expect(names).not.toContain('Good News');
    expect(names).not.toContain('Cellos');
    expect(names).not.toContain('Gute Neuigkeiten');
    expect(names).not.toContain('Anna');
    expect(names.some((n) => n.startsWith('Eddy'))).toBe(false);
  });

  it('is empty until voices are loaded', () => {
    expect(radioVoices([])).toEqual([]);
  });

  it('picks German voices for German', () => {
    const all = [voice('Daniel', 'en-GB'), voice('Anna', 'de-DE'), voice('Eddy (Deutsch (Deutschland))', 'de-DE'), voice('Google Deutsch', 'de-DE')];
    const names = radioVoices(all, 'de').map((i) => all[i].name);
    expect(names).toEqual(['Anna', 'Google Deutsch']);
  });
});
