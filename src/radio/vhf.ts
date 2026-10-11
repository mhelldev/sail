// Marine VHF traffic on channel 16, generated from what happens around the boat. Pure: given a
// snapshot of the world each frame, it decides when somebody transmits and what they say.
//
// Like a real set with the squelch closed it is silent most of the time, and speaks up when:
//   - the coast guard reads the weather (every ~10 min, and when the wind has changed noticeably),
//   - a ship on a collision course calls the yacht on its bow,
//   - near a harbour, yachts and the marina talk (berths, opening times),
//   - the yacht gets too close to the shore,
//   - now and then somebody asks for a radio check.

import { wrapDeg } from '../boat/sailing';

export type Speaker = 'coastguard' | 'ship' | 'marina' | 'yacht';

export interface Transmission {
  speaker: Speaker;
  /** the same station keeps the same voice */
  station: string;
  text: string;
}

export interface RadioVessel {
  id: number;
  kind: 'yacht' | 'motor' | 'ferry' | 'cargo';
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export interface RadioWorld {
  wind: { direction: number; speed: number };
  boat: { x: number; z: number; heading: number; speed: number; sailUp: boolean; grounded: boolean };
  /** signed distance to the coast, metres (positive on land) */
  coastDistance: number;
  harbor?: { name: string; distance: number; isHarbour: boolean };
  vessels: readonly RadioVessel[];
}

const COMPASS16 = [
  'north', 'north north-east', 'north-east', 'east north-east', 'east', 'east south-east', 'south-east', 'south south-east',
  'south', 'south south-west', 'south-west', 'west south-west', 'west', 'west north-west', 'north-west', 'north north-west',
];
const COMPASS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const KOMPASS16 = [
  'Nord', 'Nordnordost', 'Nordost', 'Ostnordost', 'Ost', 'Ostsüdost', 'Südost', 'Südsüdost',
  'Süd', 'Südsüdwest', 'Südwest', 'Westsüdwest', 'West', 'Westnordwest', 'Nordwest', 'Nordnordwest',
];
/** "1.2 miles north-east of you" / "1,2 Seemeilen nordöstlich von Ihnen" */
const KOMPASS8_ADJ = ['nördlich', 'nordöstlich', 'östlich', 'südöstlich', 'südlich', 'südwestlich', 'westlich', 'nordwestlich'];

const idx = (deg: number, n: number) => Math.round((((deg % 360) + 360) % 360) / (360 / n)) % n;
export const directionWord = (deg: number): string => COMPASS8[idx(deg, 8)];
export const directionWord16 = (deg: number): string => COMPASS16[idx(deg, 16)];

export type RadioLanguage = 'en' | 'de';

/** Beaufort force from wind speed in m/s. */
export function beaufort(ms: number): number {
  const limits = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const i = limits.findIndex((l) => ms < l);
  return i === -1 ? 12 : i;
}

/** Sea state from Beaufort: 0 calm … 6 high. */
function seaIndex(force: number): number {
  if (force <= 1) return 0;
  if (force <= 2) return 1;
  if (force <= 3) return 2;
  if (force <= 4) return 3;
  if (force <= 5) return 4;
  if (force <= 7) return 5;
  return 6;
}

const YACHTS = [
  'Seabird', 'Windrose', 'Albatross', 'Blue Horizon', 'Northern Star', 'Zeemeeuw', 'Sea Breeze', 'Wanderer', 'Pelikaan',
  'Morning Glory', 'Silver Tern', 'Odyssey', 'Kittiwake', 'Free Spirit', 'Avocet', 'Waterhoen', 'Calypso', 'Gannet',
];
const SHIPS: Record<'ferry' | 'cargo' | 'motor', string[]> = {
  ferry: ['Zeeland Express', 'Prinses Amalia', 'Westerschelde', 'Island Link', 'Noordster', 'Channel Spirit'],
  cargo: ['Atlantic Trader', 'Baltic Carrier', 'Nordic Pioneer', 'Hanse Spirit', 'Ocean Meridian', 'North Sea Bridge', 'Celtic Venture'],
  motor: ['Speedwell', 'Zeehond', 'Sea Otter', 'Blue Marlin', 'Stormvogel'],
};

/** A vessel's name, the same every time for the same vessel. */
export function vesselName(v: Pick<RadioVessel, 'id' | 'kind'>): string {
  const list = v.kind === 'yacht' ? YACHTS : SHIPS[v.kind];
  return list[(v.id * 7 + 3) % list.length];
}

/** Harbour names as you'd say them on the radio: no club abbreviations. */
export function spokenHarbor(name: string): string {
  return name.replace(/^(WV|WSV|ZV|YC|KZV)\s+/i, '').replace(/\s+/g, ' ').trim();
}

/** Closest point of approach of two vessels moving straight on: distance (m) and time (s). */
export function cpa(
  a: { x: number; z: number; heading: number; speed: number },
  b: { x: number; z: number; heading: number; speed: number },
): { distance: number; time: number } {
  const vel = (h: number, s: number) => [Math.sin((h * Math.PI) / 180) * s, -Math.cos((h * Math.PI) / 180) * s];
  const [ax, az] = vel(a.heading, a.speed);
  const [bx, bz] = vel(b.heading, b.speed);
  const px = b.x - a.x;
  const pz = b.z - a.z;
  const vx = bx - ax;
  const vz = bz - az;
  const v2 = vx * vx + vz * vz;
  const t = v2 < 1e-6 ? 0 : Math.max(0, -(px * vx + pz * vz) / v2);
  return { distance: Math.hypot(px + vx * t, pz + vz * t), time: t };
}

const thrice = (n: string) => `${n}, ${n}, ${n}`;

// ---- What is said, per language. The brain decides *when* and with which facts. ----

interface WeatherFacts {
  area?: string;
  direction: number;
  force: number;
  stronger: boolean;
  weaker: boolean;
  /** turned clockwise (veering) or anticlockwise (backing) */
  turn: 'veering' | 'backing' | null;
  poorVisibility: boolean;
}

interface ShipFacts {
  name: string;
  cargo: boolean;
  /** where the yacht is from the ship's bridge */
  starboard: boolean;
  bow: boolean;
  miles: number;
  /** compass direction from the yacht to the ship */
  from: number;
  sailing: boolean;
}

interface Phrasebook {
  coastguard: string;
  weather(f: WeatherFacts): string;
  ship(f: ShipFacts): string;
  marinaStation(place: string, isHarbour: boolean): string;
  berthRequest(station: string, yacht: string, length: number): string;
  berthReply(station: string, yacht: string, pontoon: string, berth: number, starboard: boolean): string;
  harbourNotice(station: string): string;
  danger(near: string | undefined, grounded: boolean): string;
  radioCheck(yacht: string): string;
  radioCheckReply(yacht: string): string;
}

const SEA_EN = ['calm', 'smooth', 'slight', 'moderate', 'rough', 'very rough', 'high'];
const SEA_DE = ['ruhig', 'glatt', 'leicht bewegt', 'mäßig bewegt', 'grob', 'sehr grob', 'hoch'];

const EN: Phrasebook = {
  coastguard: 'Coast Guard',
  weather(f) {
    const trend = [f.stronger && 'increasing', f.weaker && 'decreasing', f.turn].filter(Boolean).join(' and ');
    return (
      `${thrice('Securité')}. ${thrice('All stations')}. This is Coast Guard. Weather ${f.area ? `for the area of ${f.area}` : 'for the coastal waters'}. ` +
      `Wind ${directionWord16(f.direction)}, force ${f.force}${trend ? `, ${trend}` : ''}. Sea ${SEA_EN[seaIndex(f.force)]}. ` +
      `Visibility ${f.poorVisibility ? 'moderate, occasionally poor in rain' : 'good'}. This is Coast Guard. Out.`
    );
  },
  ship(f) {
    const yacht = f.sailing ? 'Sailing yacht' : 'Motor yacht';
    const where = `${f.starboard ? 'starboard' : 'port'} ${f.bow ? 'bow' : 'quarter'}`;
    const ask = f.cargo
      ? 'I am restricted by my draught in the fairway. Please keep clear and pass astern of me.'
      : `Please confirm your intentions. I suggest we pass ${f.starboard ? 'port to port' : 'starboard to starboard'}.`;
    return `${yacht} on my ${where}, ${yacht.toLowerCase()} on my ${where}. This is ${f.name}, ${f.name}, ${f.cargo ? 'the cargo vessel' : 'the ferry'} ${f.miles} miles ${directionWord(f.from)} of you. ${ask} Over.`;
  },
  marinaStation: (place, isHarbour) => `${place} ${isHarbour ? 'harbour' : 'marina'}`,
  berthRequest: (station, yacht, length) => `${station}, ${station}, this is sailing yacht ${yacht}. Request a berth for one night, ${length} metres, one metre eighty draught. Over.`,
  berthReply: (station, yacht, pontoon, berth, starboard) =>
    `${yacht}, this is ${station}. Welcome. Pontoon ${pontoon}, berth ${berth}, ${starboard ? 'starboard' : 'port'} side to. Switch to channel 31 for further assistance. Out.`,
  harbourNotice: (station) =>
    `${thrice('All stations')}. This is ${station}. The harbour office is open until twenty hundred. Fuel berth available. Please keep a sharp lookout for traffic in the entrance. Out.`,
  danger: (near, grounded) =>
    grounded
      ? `Yacht aground${near ? ` near ${near}` : ''}, this is Coast Guard. Do you require assistance? Over.`
      : `Yacht close to the shore${near ? ` near ${near}` : ''}, this is Coast Guard. You are standing into danger. Check your position and alter course. Over.`,
  radioCheck: (yacht) => `Coast Guard, Coast Guard, this is sailing yacht ${yacht}. Radio check, over.`,
  radioCheckReply: (yacht) => `${yacht}, this is Coast Guard. Loud and clear. Please use a working channel for radio checks. Out.`,
};

const DE: Phrasebook = {
  coastguard: 'Küstenwache',
  weather(f) {
    const trend = [f.stronger && 'zunehmend', f.weaker && 'abnehmend', f.turn === 'veering' ? 'rechtsdrehend' : f.turn === 'backing' ? 'rückdrehend' : null]
      .filter(Boolean)
      .join(' und ');
    return (
      `${thrice('Sécurité')}. ${thrice('An alle Funkstellen')}. Hier ist Küstenwache mit dem Seewetterbericht ${f.area ? `für das Gebiet ${f.area}` : 'für die Küstengewässer'}. ` +
      `Wind ${KOMPASS16[idx(f.direction, 16)]} ${f.force}${trend ? `, ${trend}` : ''}. See ${SEA_DE[seaIndex(f.force)]}. ` +
      `Sicht ${f.poorVisibility ? 'mäßig, zeitweise schlecht in Regen' : 'gut'}. Hier ist Küstenwache. Ende.`
    );
  },
  ship(f) {
    const yacht = f.sailing ? 'Segelyacht' : 'Motoryacht';
    const side = f.starboard ? 'Steuerbord' : 'Backbord';
    const where = f.bow ? `an meinem ${side}bug` : `achterlich an ${side}`;
    const miles = String(f.miles).replace('.', ',');
    const ask = f.cargo
      ? 'Ich bin tiefgangbehindert im Fahrwasser. Bitte halten Sie sich frei und passieren Sie hinter meinem Heck.'
      : `Bitte bestätigen Sie Ihre Absicht. Ich schlage vor, wir passieren ${f.starboard ? 'Backbord an Backbord' : 'Steuerbord an Steuerbord'}.`;
    return `${yacht} ${where}, ${yacht} ${where}. Hier ist ${f.name}, ${f.name}, ${f.cargo ? 'das Frachtschiff' : 'die Fähre'}, ${miles} Seemeilen ${KOMPASS8_ADJ[idx(f.from, 8)]} von Ihnen. ${ask} Kommen.`;
  },
  marinaStation: (place, isHarbour) => `${isHarbour ? 'Hafen' : 'Marina'} ${place}`,
  berthRequest: (station, yacht, length) =>
    `${station}, ${station}, hier ist Segelyacht ${yacht}. Ich bitte um einen Liegeplatz für eine Nacht, ${length} Meter, ein Meter achtzig Tiefgang. Kommen.`,
  berthReply: (station, yacht, pontoon, berth, starboard) =>
    `${yacht}, hier ist ${station}. Herzlich willkommen. Steg ${pontoon}, Liegeplatz ${berth}, ${starboard ? 'Steuerbord' : 'Backbord'} längsseits. Bitte wechseln Sie auf Kanal 31. Ende.`,
  harbourNotice: (station) =>
    `${thrice('An alle Funkstellen')}. Hier ist ${station}. Das Hafenbüro ist bis zwanzig Uhr geöffnet, die Tankstelle ist besetzt. Bitte achten Sie in der Hafeneinfahrt auf den Verkehr. Ende.`,
  danger: (near, grounded) =>
    grounded
      ? `Festgekommene Yacht${near ? ` bei ${near}` : ''}, hier ist Küstenwache. Benötigen Sie Hilfe? Kommen.`
      : `Yacht in Landnähe${near ? ` bei ${near}` : ''}, hier ist Küstenwache. Sie laufen in Gefahr. Prüfen Sie Ihre Position und ändern Sie den Kurs. Kommen.`,
  radioCheck: (yacht) => `Küstenwache, Küstenwache, hier ist Segelyacht ${yacht}. Bitte um Funkprobe. Kommen.`,
  radioCheckReply: (yacht) => `${yacht}, hier ist Küstenwache. Laut und deutlich. Bitte nutzen Sie für Funkproben einen Arbeitskanal. Ende.`,
};

const PHRASES: Record<RadioLanguage, Phrasebook> = { en: EN, de: DE };

/** Decides who says what on channel 16. Call `update` regularly; it returns new transmissions. */
export class VhfBrain {
  /** language of everything said on the radio */
  language: RadioLanguage = 'en';
  private time = 0;
  private lastAny = -Infinity;
  private nextWeather = 45; // the first report soon after setting off
  private lastWeather?: { direction: number; force: number; at: number };
  private nextHarborChat = 90;
  private nextRadioCheck: number;
  private lastDanger = -Infinity;
  private readonly calledBy = new Set<number>();

  constructor(private readonly random: () => number = Math.random) {
    this.nextRadioCheck = 240 + random() * 300;
  }

  private get p(): Phrasebook {
    return PHRASES[this.language];
  }

  update(dt: number, w: RadioWorld): Transmission[] {
    this.time += dt;
    const out: Transmission[] = [];
    // One conversation at a time, with some quiet in between (the set is busy speaking anyway).
    if (this.time - this.lastAny < 25) return out;
    const msgs = this.danger(w) ?? this.ship(w) ?? this.weather(w) ?? this.harborChat(w) ?? this.radioCheck();
    if (msgs) {
      this.lastAny = this.time;
      out.push(...msgs);
    }
    return out;
  }

  private weather(w: RadioWorld): Transmission[] | undefined {
    const force = beaufort(w.wind.speed);
    const prev = this.lastWeather;
    const changed =
      !!prev &&
      this.time - prev.at > 120 &&
      (Math.abs(wrapDeg(w.wind.direction - prev.direction)) > 35 || Math.abs(force - prev.force) >= 2);
    if (this.time < this.nextWeather && !changed) return undefined;
    this.nextWeather = this.time + 540 + this.random() * 180;
    const turn = prev ? wrapDeg(w.wind.direction - prev.direction) : 0;
    this.lastWeather = { direction: w.wind.direction, force, at: this.time };
    const text = this.p.weather({
      area: w.harbor && spokenHarbor(w.harbor.name),
      direction: w.wind.direction,
      force,
      stronger: !!prev && force > prev.force,
      weaker: !!prev && force < prev.force,
      turn: Math.abs(turn) > 20 ? (turn > 0 ? 'veering' : 'backing') : null,
      poorVisibility: force >= 7,
    });
    return [{ speaker: 'coastguard', station: 'coastguard', text }];
  }

  /** A big ship (or ferry) on a collision course calls the yacht on its bow — once per ship. */
  private ship(w: RadioWorld): Transmission[] | undefined {
    for (const v of w.vessels) {
      if ((v.kind !== 'cargo' && v.kind !== 'ferry') || this.calledBy.has(v.id)) continue;
      const d = Math.hypot(v.x - w.boat.x, v.z - w.boat.z);
      if (d > 2500) continue;
      const c = cpa(v, w.boat);
      if (c.distance > 300 || c.time <= 0 || c.time > 420) continue;
      this.calledBy.add(v.id);
      const name = vesselName(v);
      // Where the yacht is, seen from the ship's bridge.
      const bearing = (Math.atan2(w.boat.x - v.x, -(w.boat.z - v.z)) * 180) / Math.PI;
      const rel = wrapDeg(bearing - v.heading);
      const text = this.p.ship({
        name,
        cargo: v.kind === 'cargo',
        starboard: rel >= 0,
        bow: Math.abs(rel) < 100,
        miles: Math.round(d / 185.2) / 10,
        from: bearing + 180,
        sailing: w.boat.sailUp,
      });
      return [{ speaker: 'ship', station: name, text }];
    }
    // Forget ships that have gone far away, so the set doesn't grow forever.
    for (const id of this.calledBy) if (!w.vessels.some((v) => v.id === id)) this.calledBy.delete(id);
    return undefined;
  }

  /** Near a harbour: yachts ask the marina for a berth, the harbour master answers. */
  private harborChat(w: RadioWorld): Transmission[] | undefined {
    if (!w.harbor || w.harbor.distance > 6000 || this.time < this.nextHarborChat) return undefined;
    this.nextHarborChat = this.time + 150 + this.random() * 200;
    const station = this.p.marinaStation(spokenHarbor(w.harbor.name), w.harbor.isHarbour);
    const yacht = YACHTS[Math.floor(this.random() * YACHTS.length)];
    const length = 9 + Math.floor(this.random() * 6);
    const pontoon = 'ABCDE'[Math.floor(this.random() * 5)];
    const berth = 10 + Math.floor(this.random() * 40);
    if (this.random() < 0.7) {
      return [
        { speaker: 'yacht', station: yacht, text: this.p.berthRequest(station, yacht, length) },
        { speaker: 'marina', station, text: this.p.berthReply(station, yacht, pontoon, berth, this.random() < 0.5) },
      ];
    }
    return [{ speaker: 'marina', station, text: this.p.harbourNotice(station) }];
  }

  /** The coast guard warns the yacht standing into danger near the shore. */
  private danger(w: RadioWorld): Transmission[] | undefined {
    const close = w.boat.grounded || (w.coastDistance > -120 && w.boat.speed > 1.5);
    if (!close || this.time - this.lastDanger < 240) return undefined;
    this.lastDanger = this.time;
    const text = this.p.danger(w.harbor && spokenHarbor(w.harbor.name), w.boat.grounded);
    return [{ speaker: 'coastguard', station: 'coastguard', text }];
  }

  private radioCheck(): Transmission[] | undefined {
    if (this.time < this.nextRadioCheck) return undefined;
    this.nextRadioCheck = this.time + 420 + this.random() * 480;
    const yacht = YACHTS[Math.floor(this.random() * YACHTS.length)];
    return [
      { speaker: 'yacht', station: yacht, text: this.p.radioCheck(yacht) },
      { speaker: 'coastguard', station: 'coastguard', text: this.p.radioCheckReply(yacht) },
    ];
  }
}
