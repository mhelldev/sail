/**
 * What's left of the screen overlay now that the instruments live on the boat: the crosshair (a ring
 * when something can be grabbed or clicked), short notes, and the key help line.
 */
export class Hud {
  private readonly crosshair: HTMLElement;
  private readonly note: HTMLElement;
  private readonly binoculars: SVGSVGElement;
  private readonly bearing: SVGTextElement;
  private noteTimer = 0;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-help">
        <b>↑↓←→</b> or <b>WASD</b> walk · <b>Shift</b> run · <b>Space</b> jump / climb · mouse to look, <b>right button</b> zoom ·
        <b>click + drag</b> the wheel to steer · <b>click</b> door / chart plotter / engine key + START / fuel pump at a pier head · <b>drag</b> the throttle lever · <b>E</b> sail up/down · <b>T</b> turbo ·
        <b>F</b> binoculars ·
        <b>B</b> back aboard · <b>M</b> chart range · <b>V</b> sound · <b>N</b> night · <b>R</b> start · <b>G</b> tuning
      </div>
      <svg class="binoculars" data-binoculars viewBox="-160 -90 320 180" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <filter id="bino-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
          <mask id="bino-lenses" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000">
            <rect x="-5000" y="-5000" width="10000" height="10000" fill="white" />
            <g filter="url(#bino-soft)" fill="black">
              <circle cx="-38" cy="0" r="74" />
              <circle cx="38" cy="0" r="74" />
            </g>
          </mask>
        </defs>
        <rect x="-5000" y="-5000" width="10000" height="10000" fill="#020406" mask="url(#bino-lenses)" />
        <g class="binoculars-scale">
          <line x1="-60" y1="0" x2="60" y2="0" />
          <g data-ticks></g>
          <text x="0" y="62" data-bearing>000°</text>
        </g>
      </svg>
      <div class="crosshair" data-crosshair></div>
      <div class="hud-note" data-note></div>`;
    parent.appendChild(el);
    this.crosshair = el.querySelector('[data-crosshair]') as HTMLElement;
    this.note = el.querySelector('[data-note]') as HTMLElement;
    this.binoculars = el.querySelector('[data-binoculars]') as SVGSVGElement;
    this.bearing = el.querySelector('[data-bearing]') as SVGTextElement;
    // Mil-style reticle ticks along the horizontal line.
    const ticks = el.querySelector('[data-ticks]')!;
    for (let i = -6; i <= 6; i++) {
      if (i === 0) continue;
      const h = i % 2 === 0 ? 5 : 2.5;
      ticks.insertAdjacentHTML('beforeend', `<line x1="${i * 10}" y1="${-h}" x2="${i * 10}" y2="${h}" />`);
    }
  }

  /** The view through the binoculars: two round lenses, a reticle and the compass bearing. */
  setBinoculars(on: boolean, bearing: number): void {
    this.binoculars.classList.toggle('binoculars-on', on);
    document.body.classList.toggle('binoculars-up', on);
    if (!on) return;
    const text = `${Math.round(bearing) % 360}`.padStart(3, '0') + '°';
    if (this.bearing.textContent !== text) this.bearing.textContent = text;
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
