// Plays VHF transmissions: a squelch click, static under the voice, the words via the browser's
// speech synthesis (one voice per station), another click. Out of earshot of the boat's speakers
// transmissions are simply missed, like on a real boat. Nothing happens without speech synthesis.

import type { RadioLanguage, Transmission } from '../radio/vhf';
import { whenAudioReady } from './audioHub';

const HISS_GAIN = 0.018; // static under the voice
const CLICK_GAIN = 0.08; // squelch opening
const TAIL_GAIN = 0.1; // the "kshh" when the transmission ends
const CRACKLE_GAIN = 0.04; // up to, per pop
const VOICE_GAIN = 0.7; // the speaker on a boat isn't a hi-fi
const CRACKLES_PER_SECOND = 2.5;
const EARSHOT = 60; // metres from the boat

/** How loud the boat's VHF speakers are at a distance (1 at the helm or in the cabin). */
export function vhfLevel(distance: number): number {
  if (distance > EARSHOT) return 0;
  return 1 / (1 + Math.max(0, distance - 4) / 10);
}

// macOS ships novelty voices that also claim to be English: some sing ("Good News", "Cellos"), some
// play bells or organs, and the old Eloquence voices sound robotic. Never use those on the radio.
// Their names are localized (a German Mac calls "Good News" "Gute Neuigkeiten"), so both are listed.
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|gute neuigkeiten|schlechte neuigkeiten|glocken|orgel|flüstern|seifenblasen|monster|katrin|trinoide|wackeln|hampelmann)\b/i;
// Voices that sound natural; "Premium"/"Enhanced"/"Natural" are the high-quality downloads.
const GOOD =
  /premium|enhanced|natural|google|daniel|samantha|karen|moira|tessa|serena|arthur|martha|oliver|kate|rishi|fiona|alex|aaron|nicky|catherine|gordon|libby|ryan|sonia|thomas|jenny|guy|anna|petra|markus|yannick|helena|viktor|martin|katja|conrad|amala|killian/i;

/** Voices worth hearing in a language, best first; empty until the browser has loaded its voice list. */
export function radioVoices(all: readonly Pick<SpeechSynthesisVoice, 'name' | 'lang'>[], language: RadioLanguage = 'en'): number[] {
  const lang = new RegExp(`^${language}[-_]`, 'i');
  const home = language === 'en' ? /^en[-_](gb|ie|au)/i : /^de[-_]de/i;
  const scored = all
    .map((v, i) => ({ i, v }))
    .filter(({ v }) => lang.test(v.lang) && !NOVELTY.test(v.name))
    .map(({ i, v }) => ({ i, score: (GOOD.test(v.name) ? 2 : 0) + (/premium|enhanced|natural/i.test(v.name) ? 2 : 0) + (home.test(v.lang) ? 0.5 : 0) }));
  scored.sort((a, b) => b.score - a.score);
  // Only the good ones if there are a few; otherwise whatever plain English voices there are.
  const good = scored.filter((s) => s.score >= 2);
  return (good.length >= 2 ? good : scored).map((s) => s.i);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class VhfSound {
  /** the set is switched on (it usually is) */
  power = true;
  /** 0…2 from the tuning panel */
  volume = 1;
  /** a transmission is coming in (for the display's RX light) */
  receiving = false;
  /** don't start a new transmission (somebody is talking to the player) */
  hold = false;
  /** amount of static, crackle and squelch noise, 0…2 (tuning panel) */
  staticLevel = 1;
  /** language of the voices (the brain speaks the same one) */
  private lang: RadioLanguage = 'en';
  private allVoices: SpeechSynthesisVoice[] = [];

  private readonly synth = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private queue: Transmission[] = [];
  private ctx?: AudioContext;
  private noise?: AudioBuffer;
  private hiss?: { source: AudioBufferSourceNode; gain: GainNode };
  private level = 1;
  private lastUpdate = 0;
  private flutterAt = 0;

  constructor() {
    if (this.synth) {
      const load = () => {
        this.allVoices = this.synth!.getVoices();
        this.pickVoices();
      };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
    whenAudioReady((ctx) => {
      this.ctx = ctx;
      // Two seconds of white noise, band-limited later like a radio's audio.
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
    });
  }

  get language(): RadioLanguage {
    return this.lang;
  }

  set language(lang: RadioLanguage) {
    if (lang === this.lang) return;
    this.lang = lang;
    this.stop(); // don't finish a message in the old language
    this.pickVoices();
  }

  private pickVoices(): void {
    this.voices = radioVoices(this.allVoices, this.lang).map((i) => this.allVoices[i]);
  }

  togglePower(): void {
    this.power = !this.power;
    if (!this.power) this.stop();
  }

  /** New transmissions from the radio brain. */
  receive(transmissions: Transmission[]): void {
    if (!this.power || !this.synth || this.level === 0) return;
    // Speech only works after the player has interacted with the page.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    this.queue.push(...transmissions);
  }

  /**
   * @param distance listener to the boat, metres
   */
  update(distance: number, muted: boolean): void {
    this.level = muted ? 0 : vhfLevel(distance) * this.volume;
    if (this.level === 0 && (this.receiving || this.queue.length)) this.stop();
    const ctx = this.ctx;
    if (this.hiss && ctx) {
      const now = ctx.currentTime;
      const dt = Math.min(0.1, now - this.lastUpdate);
      // A weak signal: the static swells and fades a few times per second.
      if (now >= this.flutterAt) {
        this.flutterAt = now + 0.08 + Math.random() * 0.25;
        const swell = 0.45 + Math.random() * 1.1;
        this.hiss.gain.gain.setTargetAtTime(HISS_GAIN * this.staticLevel * this.level * swell, now, 0.05);
      }
      // Crackle: random pops while somebody is talking.
      if (Math.random() < CRACKLES_PER_SECOND * dt) this.burst(CRACKLE_GAIN * (0.3 + Math.random() * 0.7), 0.01 + Math.random() * 0.05, 'crackle');
    }
    if (ctx) this.lastUpdate = ctx.currentTime;
    // Wait for the voice list: without a voice the browser would read English with its default
    // (e.g. German) voice.
    if (!this.receiving && !this.hold && this.queue.length && this.voices.length) this.transmit(this.queue.shift()!);
  }

  private transmit(t: Transmission): void {
    const synth = this.synth!;
    this.receiving = true;
    this.burst(CLICK_GAIN, 0.12, 'click');
    this.startHiss();
    let done = false;
    let watchdog = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(watchdog);
      this.burst(TAIL_GAIN, 0.28, 'tail');
      this.stopHiss();
      // A short pause before the other station answers.
      window.setTimeout(() => (this.receiving = false), 900);
    };
    // Sentence by sentence: some browsers cut off long utterances.
    const sentences = t.text.match(/[^.!?]+[.!?]+/g) ?? [t.text];
    const voice = this.voiceFor(t);
    const h = hash(t.station);
    sentences.forEach((sentence, i) => {
      const u = new SpeechSynthesisUtterance(sentence.trim());
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? (this.lang === 'de' ? 'de-DE' : 'en-GB');
      u.rate = 1.0 + ((h >> 3) % 15) / 100; // radio operators talk briskly
      u.pitch = 0.85 + ((h >> 7) % 30) / 100;
      u.volume = Math.min(1, this.level * VOICE_GAIN);
      if (i === sentences.length - 1) u.onend = u.onerror = finish;
      synth.speak(u);
    });
    // Some speech engines never report the end: don't let the set hang on one transmission.
    watchdog = window.setTimeout(finish, 5000 + t.text.length * 120);
  }

  /** The coast guard gets a British voice when there is one; every station keeps its voice. */
  private voiceFor(t: Transmission): SpeechSynthesisVoice | undefined {
    if (!this.voices.length) return undefined;
    if (t.speaker === 'coastguard') {
      const home = this.voices.find((v) => (this.lang === 'en' ? /^en[-_]gb/i : /^de[-_]de/i).test(v.lang));
      if (home) return home;
    }
    return this.voices[hash(t.station) % this.voices.length];
  }

  private stop(): void {
    this.queue = [];
    this.synth?.cancel();
    this.stopHiss();
    this.receiving = false;
  }

  /**
   * A burst of radio noise: the squelch opening ('click'), its tail when the carrier drops ('tail', a
   * longer "kshh") or a crackle (short, brighter pops).
   */
  private burst(gainValue: number, seconds: number, kind: 'click' | 'tail' | 'crackle'): void {
    const ctx = this.ctx;
    const level = gainValue * this.staticLevel * this.level;
    if (!ctx || !this.noise || level <= 0) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    const filter = this.bandpass(ctx);
    if (kind === 'crackle') {
      filter.frequency.value = 2500 + Math.random() * 2000;
      filter.Q.value = 1.5;
    }
    filter.connect(gain).connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.connect(filter);
    source.start(now, Math.random(), seconds + 0.03);
    source.onended = () => gain.disconnect();
  }

  private startHiss(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || this.hiss) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = this.bandpass(ctx);
    filter.connect(gain).connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.connect(filter);
    source.start();
    this.hiss = { source, gain };
  }

  private stopHiss(): void {
    const hiss = this.hiss;
    if (!hiss || !this.ctx) return;
    hiss.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    hiss.source.stop(this.ctx.currentTime + 0.2);
    hiss.source.onended = () => hiss.gain.disconnect();
    this.hiss = undefined;
  }

  /** Radio audio is narrow: roughly 300 Hz … 3 kHz. */
  private bandpass(ctx: AudioContext): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 0.7;
    return f;
  }
}
