/**
 * What's left of the screen overlay now that the instruments live on the boat: the crosshair (a ring
 * when something can be grabbed or clicked) and the key help line.
 */
export class Hud {
  private readonly crosshair: HTMLElement;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-help">
        <b>↑↓←→</b> or <b>WASD</b> walk · <b>Shift</b> run · <b>Space</b> jump / climb · mouse to look, <b>right button</b> zoom ·
        <b>click + drag</b> the wheel to steer · <b>click</b> door / chart plotter · <b>E</b> sail up/down · <b>T</b> turbo ·
        <b>B</b> back aboard · <b>M</b> chart range · <b>V</b> sound · <b>N</b> night · <b>R</b> start · <b>G</b> tuning
      </div>
      <div class="crosshair" data-crosshair></div>`;
    parent.appendChild(el);
    this.crosshair = el.querySelector('[data-crosshair]') as HTMLElement;
  }

  /** Crosshair state: something can be grabbed / the wheel is held. */
  setHand(state: 'none' | 'open' | 'grip'): void {
    this.crosshair.dataset.hand = state;
  }
}
