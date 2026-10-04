import type { Input } from '../core/input';

const SPOKES = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return `<line x1="${(c * 9).toFixed(1)}" y1="${(s * 9).toFixed(1)}" x2="${(c * 46).toFixed(1)}" y2="${(s * 46).toFixed(1)}" />
    <circle class="touch-helm-handle" cx="${(c * 47).toFixed(1)}" cy="${(s * 47).toFixed(1)}" r="4.5" />`;
}).join('');

/**
 * On-screen controls for touch devices: a helm that mirrors the steering wheel, and
 * buttons for what the keyboard does on desktop. Shown once a touch screen is detected.
 */
export class TouchUi {
  private readonly root = document.createElement('div');
  private readonly helm: SVGSVGElement;
  private readonly wheel: SVGGElement;
  private readonly sailButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly soundButton: HTMLButtonElement;

  constructor(parent: HTMLElement, input: Input, nextViewKey: () => string) {
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <svg class="touch-helm" viewBox="-56 -56 112 112" aria-hidden="true">
        <g data-wheel>
          <circle class="touch-helm-rim" r="38" />
          ${SPOKES}
          <circle class="touch-helm-hub" r="8" />
          <circle class="touch-helm-top" cx="0" cy="-47" r="5.5" />
        </g>
      </svg>
      <div class="touch-buttons">
        <button type="button" data-sail-toggle>Sail down</button>
        <button type="button" data-view-toggle>View</button>
        <button type="button" data-sound-toggle>Sound</button>
      </div>
      <div class="touch-hint">Drag to steer · two fingers move the camera · tap the map to zoom</div>`;
    parent.appendChild(this.root);
    this.helm = this.root.querySelector('.touch-helm') as SVGSVGElement;
    this.wheel = this.root.querySelector('[data-wheel]') as SVGGElement;
    this.sailButton = this.root.querySelector('[data-sail-toggle]') as HTMLButtonElement;
    this.hint = this.root.querySelector('.touch-hint') as HTMLElement;
    this.sailButton.addEventListener('click', () => input.trigger('KeyS'));
    this.root.querySelector('[data-view-toggle]')!.addEventListener('click', () => input.trigger(nextViewKey()));
    this.soundButton = this.root.querySelector('[data-sound-toggle]') as HTMLButtonElement;
    this.soundButton.addEventListener('click', () => input.trigger('KeyV'));

    const enable = () => {
      if (document.body.classList.contains('touch')) return;
      document.body.classList.add('touch');
      window.setTimeout(() => this.hint.classList.add('touch-hint-hidden'), 7000);
    };
    if (window.matchMedia('(pointer: coarse)').matches) enable();
    // Hybrid devices (touch laptops): switch on at the first touch.
    window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && enable(), { capture: true });
  }

  /** @param showHelm false in the deck view, where the real wheel is right in front of the camera */
  update(wheelAngle: number, sailUp: boolean, showHelm: boolean, muted = false): void {
    this.soundButton.textContent = muted ? 'Sound off' : 'Sound on';
    this.helm.style.visibility = showHelm ? 'visible' : 'hidden';
    this.wheel.style.transform = `rotate(${(wheelAngle * 180) / Math.PI}deg)`;
    this.sailButton.textContent = sailUp ? 'Sail down' : 'Sail up';
  }
}
