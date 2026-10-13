// The people's voices: the browser's speech synthesis with the same voice choice as the radio
// (English, no novelty voices). Needs a user gesture before the first word (the game has had one
// by the time you walk up to somebody).

import { radioVoices } from '../audio/vhfSound';

export class Speech {
  private readonly synth?: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private watchdog = 0;

  constructor() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.synth = window.speechSynthesis;
    const load = () => {
      const all = this.synth!.getVoices();
      this.voices = radioVoices(all, 'en').map((i) => all[i]);
    };
    load();
    this.synth.addEventListener('voiceschanged', load);
  }

  get available(): boolean {
    return !!this.synth && this.voices.length > 0;
  }

  /** Says a line; `onEnd` runs once when it's over (or stuck). */
  speak(text: string, voice: number, pitch: number, rate: number, volume: number, onEnd: () => void): void {
    const synth = this.synth;
    if (!synth || !this.voices.length) {
      onEnd();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(this.watchdog);
      onEnd();
    };
    const v = this.voices[voice % this.voices.length];
    // Sentence by sentence: some browsers cut off long utterances.
    const sentences = text.match(/[^.!?…]+[.!?…]+/g) ?? [text];
    sentences.forEach((s, i) => {
      const u = new SpeechSynthesisUtterance(s.trim());
      u.voice = v;
      u.lang = v.lang;
      u.pitch = pitch;
      u.rate = rate;
      u.volume = volume;
      if (i === sentences.length - 1) u.onend = u.onerror = finish;
      synth.speak(u);
    });
    // Some engines never report the end.
    window.clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(finish, 4000 + text.length * 110);
  }

  cancel(): void {
    window.clearTimeout(this.watchdog);
    this.synth?.cancel();
  }
}
