/** Keyboard state: held keys plus one-shot presses consumed per frame. */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e: KeyboardEvent) => {
      // Don't steer while typing into a tuning field.
      if ((e.target as Element | null)?.tagName === 'INPUT') return;
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e: KeyboardEvent) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
  }
}
