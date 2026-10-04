import type { Input } from '../core/input';
import { JOYSTICK } from '../person/walkMode';

/**
 * On-screen game pad for touch devices: a walking stick on the left (it moves to where the thumb
 * lands anywhere on the left half), a jump button on the right, and buttons for what the keyboard does
 * on desktop. The drags themselves are handled by WalkMode; this only draws them.
 * Shown once a touch screen is detected.
 */
export class TouchUi {
  private readonly root = document.createElement('div');
  private readonly sailButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;

  constructor(parent: HTMLElement, input: Input) {
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="touch-stick" data-stick><div class="touch-stick-knob" data-knob></div></div>
      <button type="button" class="touch-jump" data-jump>Jump</button>
      <div class="touch-buttons">
        <button type="button" data-sail-toggle>Sail down</button>
        <button type="button" data-aboard>Aboard</button>
        <button type="button" data-sound-toggle>Sound</button>
      </div>
      <div class="touch-hint">Left side: walk · right side: look · drag the wheel to steer · tap the door or the chart plotter</div>`;
    parent.appendChild(this.root);
    const button = (sel: string, key: string) => {
      const b = this.root.querySelector(sel) as HTMLButtonElement;
      b.addEventListener('click', () => input.trigger(key));
      return b;
    };
    // Jump on touch-down, not on click (which only fires when the finger lifts).
    this.root.querySelector('[data-jump]')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.trigger('Space');
    });
    this.stickBase = this.root.querySelector('[data-stick]') as HTMLElement;
    this.stickKnob = this.root.querySelector('[data-knob]') as HTMLElement;
    this.stickBase.style.setProperty('--r', `${JOYSTICK}px`);
    button('[data-aboard]', 'KeyB');
    this.sailButton = button('[data-sail-toggle]', 'KeyE');
    this.soundButton = button('[data-sound-toggle]', 'KeyV');
    this.hint = this.root.querySelector('.touch-hint') as HTMLElement;

    const enable = () => {
      if (document.body.classList.contains('touch')) return;
      document.body.classList.add('touch');
      window.setTimeout(() => this.hint.classList.add('touch-hint-hidden'), 9000);
    };
    if (window.matchMedia('(pointer: coarse)').matches) enable();
    // Hybrid devices (touch laptops): switch on at the first touch.
    window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && enable(), { capture: true });
  }

  /** @param stick the walking stick while a thumb holds it (WalkMode.stick) */
  update(sailUp: boolean, muted: boolean, stick: { x: number; y: number; right: number; forward: number } | null): void {
    // Resting at the bottom left; under the thumb while held.
    this.stickBase.classList.toggle('touch-stick-active', !!stick);
    this.stickBase.style.left = stick ? `${stick.x}px` : '';
    this.stickBase.style.top = stick ? `${stick.y}px` : '';
    const kx = (stick?.right ?? 0) * JOYSTICK;
    const ky = -(stick?.forward ?? 0) * JOYSTICK;
    this.stickKnob.style.transform = `translate(${kx}px, ${ky}px)`;

    this.soundButton.textContent = muted ? 'Sound off' : 'Sound on';
    this.sailButton.textContent = sailUp ? 'Sail down' : 'Sail up';
  }
}
