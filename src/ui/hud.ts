/**
 * What's left of the screen overlay now that the instruments live on the boat: the crosshair (a ring
 * when something can be grabbed or clicked), short notes, and the key help line.
 */
export class Hud {
  private readonly crosshair: HTMLElement;
  private readonly note: HTMLElement;
  private noteTimer = 0;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-help">
        <b>↑↓←→</b> or <b>WASD</b> walk · <b>Shift</b> run · <b>Space</b> jump / climb · mouse to look, <b>right button</b> zoom ·
        <b>click + drag</b> the wheel to steer · <b>click</b> door / chart plotter / engine key + START / fuel pump at a pier head · <b>drag</b> the throttle lever · <b>E</b> sail up/down · <b>T</b> turbo ·
        <b>B</b> back aboard · <b>M</b> chart range · <b>V</b> sound · <b>N</b> night · <b>R</b> start · <b>G</b> tuning
      </div>
      <div class="crosshair" data-crosshair></div>
      <div class="hud-note" data-note></div>`;
    parent.appendChild(el);
    this.crosshair = el.querySelector('[data-crosshair]') as HTMLElement;
    this.note = el.querySelector('[data-note]') as HTMLElement;
  }

  /** A short message in the middle of the screen (e.g. at the fuel pump); fades after a few seconds. */
  notify(text: string, seconds = 3): void {
    this.note.textContent = text;
    this.note.classList.add('hud-note-shown');
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => this.note.classList.remove('hud-note-shown'), seconds * 1000);
  }

  /** Crosshair state: something can be grabbed / the wheel is held. */
  setHand(state: 'none' | 'open' | 'grip'): void {
    // Called every frame: only touch the DOM when the state actually changes.
    if (this.crosshair.dataset.hand !== state) this.crosshair.dataset.hand = state;
  }
}
