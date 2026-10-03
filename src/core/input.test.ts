import { describe, expect, it } from 'vitest';
import { Input } from './input';

const key = (type: string, code: string, repeat = false) => Object.assign(new Event(type), { code, repeat });

describe('Input', () => {
  it('tracks held keys and one-shot presses', () => {
    const target = new EventTarget();
    const input = new Input(target as unknown as Window);

    target.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(input.isDown('ArrowLeft', 'KeyA')).toBe(true);
    expect(input.wasPressed('ArrowLeft')).toBe(true);

    input.endFrame();
    target.dispatchEvent(key('keydown', 'ArrowLeft', true)); // auto-repeat
    expect(input.isDown('ArrowLeft')).toBe(true);
    expect(input.wasPressed('ArrowLeft')).toBe(false);

    target.dispatchEvent(key('keyup', 'ArrowLeft'));
    expect(input.isDown('ArrowLeft')).toBe(false);
  });
});
