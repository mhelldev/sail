// People in the marinas: who is around (villages within a few hundred metres), drawing them, and
// talking — stand in front of somebody and look at them, and they stop, turn to you and talk: a
// greeting, three things (a fact about the place, the weather, a tip, a story…), goodbye, with voice
// and subtitles. Walk off or look away and they go on their way. The radio waits while they talk.

import alea from 'alea';
import type { HarborData } from '../harbors/harborData';
import type { HarborRenderer } from '../harbors/harborRenderer';
import type { MarinaInfoStore } from '../harbors/marinaInfo';
import { beaufort, directionWord16 } from '../radio/vhf';
import { Crowd, segment, type Person } from './crowd';
import { PeopleRenderer } from './peopleRenderer';
import { Speech } from './speech';
import { conversation, factSentences, placeName, type TalkContext } from './talk';

const NEAR = 450; // villages within this distance have their people out
const TALK_DISTANCE = 3.2;
const TALK_ANGLE = 0.42; // radians either side of where you look
const LEAVE_DISTANCE = 5;
const LOOK_AWAY = 1.5; // seconds looking elsewhere before they give up

/** What's going on, for what people say. */
export interface Situation {
  windDirection: number;
  windSpeed: number;
  rain: number;
  fog: number;
  boatDistance: number;
  hunger: number;
  thirst: number;
}

interface Chat {
  person: Person;
  lines: string[];
  index: number;
  state: 'waiting' | 'speaking' | 'pause';
  timer: number;
  lookingAway: number;
}

export class People {
  readonly crowd = new Crowd();
  readonly renderer = new PeopleRenderer();
  /** volume of their voices 0…1, and whether sound is muted */
  volume = 1;
  muted = false;
  private readonly speech = new Speech();
  private readonly facts = new Map<number, string[]>();
  private chat?: Chat;
  private sinceSync = Infinity;

  constructor(
    private readonly harbors: HarborRenderer,
    private readonly data: HarborData,
    private readonly info: MarinaInfoStore,
    /** ground height (rendered terrain) at a point */
    private readonly ground: (x: number, z: number) => number,
    private readonly situation: () => Situation,
    /** show / hide the subtitle line */
    private readonly subtitle: (text: string | undefined) => void,
    /** the radio: is it talking, and hold it while somebody talks to you */
    private readonly radio: { busy: () => boolean; hold: (on: boolean) => void },
  ) {}

  /** Somebody is talking to you. */
  get talking(): boolean {
    return !!this.chat;
  }

  /**
   * @param me where the player stands (feet) and the horizontal direction they look (unit vector)
   * @param onFoot the player walks (not swimming)
   */
  update(dt: number, time: number, me: { x: number; z: number }, look: { x: number; z: number }, onFoot: boolean): void {
    this.sinceSync += dt;
    if (this.sinceSync > 1) {
      this.sinceSync = 0;
      const villages = this.harbors.villagesNear(me.x, me.z, NEAR);
      this.crowd.sync(villages);
      for (const v of villages) this.loadFacts(v.id);
    }
    this.crowd.update(dt);
    this.converse(dt, me, look, onFoot);
    this.renderer.update(this.crowd.people, time, (p) => this.heightOf(p), (p) => this.chat?.person === p && this.chat.state === 'speaking');
  }

  private heightOf(p: Person): number {
    const g = this.crowd.graphOf(p);
    if (!g) return this.ground(p.x, p.z);
    const { a, b, t } = segment(p, g);
    if (a.y === undefined && b.y === undefined) return this.ground(p.x, p.z);
    const ya = a.y ?? this.ground(a.x, a.z);
    const yb = b.y ?? this.ground(b.x, b.z);
    return ya + (yb - ya) * t;
  }

  private converse(dt: number, me: { x: number; z: number }, look: { x: number; z: number }, onFoot: boolean): void {
    const chat = this.chat;
    if (!chat) {
      if (!onFoot) return;
      const p = this.inFront(me, look);
      if (p) this.start(p);
      return;
    }
    const p = chat.person;
    p.listener = { x: me.x, z: me.z };
    const dx = p.x - me.x;
    const dz = p.z - me.z;
    const d = Math.hypot(dx, dz);
    const facing = d > 0 ? (dx * look.x + dz * look.z) / d : 1;
    chat.lookingAway = facing < Math.cos(1) ? chat.lookingAway + dt : 0;
    if (d > LEAVE_DISTANCE || chat.lookingAway > LOOK_AWAY || !onFoot) {
      this.end(30);
      return;
    }
    chat.timer -= dt;
    if (chat.state === 'waiting') {
      // Let them turn round, and the radio finish what it's saying.
      if (chat.timer <= 0 && !this.radio.busy()) this.say(chat);
    } else if (chat.state === 'pause' && chat.timer <= 0) {
      if (chat.index >= chat.lines.length) this.end(120);
      else this.say(chat);
    } else if (chat.state === 'speaking' && this.muted && chat.timer <= 0) {
      this.spoken(chat);
    }
  }

  /** The person you're looking at, close in front of you, if any. */
  private inFront(me: { x: number; z: number }, look: { x: number; z: number }): Person | undefined {
    let best: Person | undefined;
    let bestD = TALK_DISTANCE;
    for (const p of this.crowd.people) {
      if (p.cooldown > 0) continue;
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD || d < 0.3) continue;
      if ((dx * look.x + dz * look.z) / d < Math.cos(TALK_ANGLE)) continue;
      best = p;
      bestD = d;
    }
    return best;
  }

  private start(p: Person): void {
    const rng = alea(`${p.id}:${Date.now()}`);
    this.chat = { person: p, lines: conversation(p.persona, this.context(p), rng), index: 0, state: 'waiting', timer: 0.5, lookingAway: 0 };
    this.radio.hold(true);
  }

  private say(chat: Chat): void {
    const line = chat.lines[chat.index++];
    const p = chat.person;
    chat.state = 'speaking';
    this.subtitle(`${p.persona.name}: ${line}`);
    if (this.muted || !this.speech.available) {
      // Read it yourself: the subtitle stays as long as it would take to say.
      chat.timer = 1.5 + line.length * 0.06;
      return;
    }
    this.speech.speak(line, p.voice, p.pitch, p.rate, Math.min(1, this.volume), () => {
      if (this.chat === chat) this.spoken(chat);
    });
  }

  private spoken(chat: Chat): void {
    chat.state = 'pause';
    chat.timer = 0.9;
  }

  /** The conversation is over (or you walked off): they carry on, and won't talk again for a while. */
  private end(cooldown: number): void {
    const chat = this.chat!;
    this.chat = undefined;
    this.speech.cancel();
    chat.person.listener = undefined;
    chat.person.cooldown = cooldown;
    chat.person.pause = 0.5;
    this.subtitle(undefined);
    this.radio.hold(false);
  }

  private context(p: Person): TalkContext {
    const h = this.data.harbors.items[p.village];
    const s = this.situation();
    const others = this.data.harbors
      .near(h.x, h.z, 25000)
      .filter((o) => o.id !== h.id)
      .map((o) => ({ o, d: Math.hypot(o.x - h.x, o.z - h.z) }))
      .filter(({ d }) => d > 500)
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .map(({ o, d }) => ({
        name: placeName(o.name),
        km: d / 1000,
        direction: directionWord16(((Math.atan2(o.x - h.x, -(o.z - h.z)) * 180) / Math.PI + 360) % 360),
      }))
      .filter((o) => o.name !== placeName(h.name));
    return {
      place: placeName(h.name),
      others,
      wind: { direction: directionWord16(s.windDirection), force: beaufort(s.windSpeed) },
      rain: s.rain,
      fog: s.fog,
      facts: this.facts.get(p.village) ?? [],
      boatNear: s.boatDistance < 150,
      hungry: s.hunger < 40,
      thirsty: s.thirst < 40,
    };
  }

  private loadFacts(id: number): void {
    if (this.facts.has(id)) return;
    this.facts.set(id, []);
    void this.info.get(this.data.harbors.items[id]).then((info) => this.facts.set(id, factSentences(info?.article?.text)));
  }
}
