import type { Input } from '../core/input';

/**
 * On-screen buttons for touch devices, for what the keyboard does on desktop. Walking, looking
 * and steering are finger drags on the scene (see WalkMode). Shown once a touch screen is detected.
 */
export class TouchUi {
  private readonly root = document.createElement('div');
  private readonly sailButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly soundButton: HTMLButtonElement;

  constructor(parent: HTMLElement, input: Input) {
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="touch-buttons">
        <button type="button" data-jump>Jump</button>
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
    button('[data-jump]', 'Space');
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

  update(sailUp: boolean, muted = false): void {
    this.soundButton.textContent = muted ? 'Sound off' : 'Sound on';
    this.sailButton.textContent = sailUp ? 'Sail down' : 'Sail up';
  }
}
