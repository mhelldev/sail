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
  private readonly money: HTMLElement;
  private readonly bars: Record<'hunger' | 'thirst', HTMLElement>;
  private shown = { money: '', hunger: -1, thirst: -1, weak: -1 };
  private readonly weak: HTMLElement;
  private readonly subtitle: HTMLElement;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-help">
        <b>↑↓←→</b> or <b>WASD</b> walk · <b>Shift</b> run · <b>Space</b> jump / climb · mouse to look, <b>right button</b> zoom ·
        <b>click + drag</b> the wheel to steer · <b>click</b> door / chart plotter / engine key + START / fuel pump at a pier head · <b>drag</b> the throttle lever · <b>E</b> sail up/down · <b>T</b> turbo ·
        <b>click</b> goods in a supermarket to buy them, food on the pantry shelf in the cabin to eat it ·
        stand in front of people in the marinas to talk ·
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
      <div class="hud-weak" data-weak></div>
      <div class="hud-status" data-status>
        <div class="hud-money" data-money>€ 0.00</div>
        <div class="hud-bar" data-bar="hunger"><span class="hud-bar-label">Food</span><span class="hud-bar-track"><span class="hud-bar-fill"></span></span></div>
        <div class="hud-bar" data-bar="thirst"><span class="hud-bar-label">Drink</span><span class="hud-bar-track"><span class="hud-bar-fill"></span></span></div>
      </div>
      <div class="crosshair" data-crosshair></div>
      <div class="hud-note" data-note></div>
      <div class="hud-subtitle" data-subtitle></div>`;
    parent.appendChild(el);
    this.crosshair = el.querySelector('[data-crosshair]') as HTMLElement;
    this.note = el.querySelector('[data-note]') as HTMLElement;
    this.binoculars = el.querySelector('[data-binoculars]') as SVGSVGElement;
    this.bearing = el.querySelector('[data-bearing]') as SVGTextElement;
    this.money = el.querySelector('[data-money]') as HTMLElement;
    this.weak = el.querySelector('[data-weak]') as HTMLElement;
    this.subtitle = el.querySelector('[data-subtitle]') as HTMLElement;
    this.bars = {
      hunger: el.querySelector('[data-bar="hunger"]') as HTMLElement,
      thirst: el.querySelector('[data-bar="thirst"]') as HTMLElement,
    };
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

  /**
   * Money and how full you are (hunger / thirst 0 … 100). Called every frame: only touches the DOM
   * when what's shown changes (whole percents, cents).
   */
  setStatus(money: string, hunger: number, thirst: number, low: number): void {
    if (money !== this.shown.money) this.money.textContent = this.shown.money = money;
    for (const [key, value] of [['hunger', hunger], ['thirst', thirst]] as const) {
      const pct = Math.ceil(value);
      if (pct === this.shown[key]) continue;
      this.shown[key] = pct;
      const bar = this.bars[key];
      (bar.querySelector('.hud-bar-fill') as HTMLElement).style.width = `${pct}%`;
      bar.classList.toggle('hud-bar-low', pct <= low);
      bar.classList.toggle('hud-bar-empty', pct <= 0);
    }
  }

  /**
   * Weakness from hunger or thirst, 0 … 1: the edges of the view darken and close in, pulsing like a
   * heartbeat. A gradient overlay (no blur filter: that would cost a full-screen pass every frame).
   */
  setWeakness(amount: number): void {
    const v = Math.round(amount * 50) / 50;
    if (v === this.shown.weak) return;
    this.shown.weak = v;
    this.weak.style.setProperty('--weak', String(v));
    this.weak.classList.toggle('hud-weak-on', v > 0);
  }

  /** What somebody says to you (name: text), or nothing. */
  setSubtitle(text: string | undefined): void {
    if (text) this.subtitle.textContent = text;
    this.subtitle.classList.toggle('hud-subtitle-shown', !!text);
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
