// One AudioContext for all game sounds. Browsers only allow audio after a user gesture, so it is
// created on the first key press, click or tap — and resumed on later gestures if the browser
// suspended it again (iOS does after calls or app switches). Nothing plays while the tab is hidden.

type Ready = (ctx: AudioContext) => void;

let ctx: AudioContext | undefined;
const waiting: Ready[] = [];
let listening = false;

/** Runs `cb` once audio is allowed (right away if it already is). */
export function whenAudioReady(cb: Ready): void {
  listen();
  if (ctx) cb(ctx);
  else waiting.push(cb);
}

function gesture(): void {
  if (!ctx) {
    // Created synchronously inside the gesture, which is what lets it play.
    ctx = new AudioContext();
    for (const cb of waiting.splice(0)) cb(ctx);
  } else if (ctx.state === 'suspended' && !document.hidden) {
    void ctx.resume();
  }
}

/** Registered on first use, so importing this module (e.g. in tests) has no side effects. */
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', gesture);
  window.addEventListener('pointerdown', gesture);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}

export async function loadBuffer(audio: AudioContext, url: string): Promise<AudioBuffer> {
  const data = await fetch(url).then((r) => r.arrayBuffer());
  return audio.decodeAudioData(data);
}

/**
 * A copy of `buffer` that loops without a click: the last `fade` seconds are cross-faded into the
 * beginning (this also hides the encoder's silent priming samples at the start of AAC files).
 */
export function seamlessLoop(audio: AudioContext, buffer: AudioBuffer, fade = 0.25): AudioBuffer {
  const f = Math.min(Math.floor(fade * buffer.sampleRate), Math.floor(buffer.length / 3));
  const n = buffer.length - f;
  const out = audio.createBuffer(buffer.numberOfChannels, n, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, n));
    for (let i = 0; i < f; i++) {
      const k = i / f; // equal-power cross-fade from the tail into the head
      dst[i] = src[i] * Math.sin((k * Math.PI) / 2) + src[n + i] * Math.cos((k * Math.PI) / 2);
    }
  }
  return out;
}
