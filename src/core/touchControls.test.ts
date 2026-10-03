import { describe, expect, it } from 'vitest';
import { TouchControls } from './touchControls';

const pointer = (type: string, pointerId: number, clientX: number, clientY = 300, pointerType = 'touch') =>
  Object.assign(new Event(type), { pointerId, clientX, clientY, pointerType });

function setup(helm = 0) {
  const target = new EventTarget();
  const camera = { orbits: [] as number[][], zooms: [] as number[] };
  const touch = new TouchControls(
    target,
    () => helm,
    { orbit: (dx, dy) => camera.orbits.push([dx, dy]), zoom: (f) => camera.zooms.push(f) },
    () => 100, // 100 px drag = full lock
  );
  return { target, touch, camera };
}

describe('TouchControls', () => {
  it('turns the helm with a one-finger drag and lets go on release', () => {
    const { target, touch } = setup();
    target.dispatchEvent(pointer('pointerdown', 1, 200));
    target.dispatchEvent(pointer('pointermove', 1, 250));
    expect(touch.steer).toBeCloseTo(0.5);
    target.dispatchEvent(pointer('pointermove', 1, 50));
    expect(touch.steer).toBe(-1); // clamped at full lock
    target.dispatchEvent(pointer('pointerup', 1, 50));
    expect(touch.steer).toBeNull();
  });

  it('continues from where the wheel currently is', () => {
    const { target, touch } = setup(0.6);
    target.dispatchEvent(pointer('pointerdown', 1, 200));
    expect(touch.steer).toBeCloseTo(0.6);
    target.dispatchEvent(pointer('pointermove', 1, 180));
    expect(touch.steer).toBeCloseTo(0.4);
  });

  it('uses two fingers for the camera instead of steering', () => {
    const { target, touch, camera } = setup();
    target.dispatchEvent(pointer('pointerdown', 1, 100, 300));
    target.dispatchEvent(pointer('pointerdown', 2, 300, 300));
    expect(touch.steer).toBeNull();
    // Both fingers move right by 20 px, and spread apart (pinch out = zoom in).
    target.dispatchEvent(pointer('pointermove', 1, 100, 300));
    target.dispatchEvent(pointer('pointermove', 2, 340, 300));
    const [dx] = camera.orbits.at(-1)!;
    expect(dx).toBeCloseTo(20);
    expect(camera.zooms.at(-1)!).toBeLessThan(1);
    expect(touch.steer).toBeNull();
  });

  it('ignores mouse pointers', () => {
    const { target, touch } = setup();
    target.dispatchEvent(pointer('pointerdown', 1, 200, 300, 'mouse'));
    target.dispatchEvent(pointer('pointermove', 1, 260, 300, 'mouse'));
    expect(touch.steer).toBeNull();
  });
});
