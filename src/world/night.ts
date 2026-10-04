import * as THREE from 'three';

/**
 * How dark it is: 0 = day, 1 = full night. Shared by shaders (as a uniform) and by code that
 * fades lights in and out. Driven by Environment.
 */
export const NIGHT = { value: 0 };

let glow: THREE.Texture | undefined;

/** Soft round dot for light points (navigation lights, lamps): bright core, fading halo. */
export function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glow = new THREE.CanvasTexture(canvas);
  return glow;
}

/**
 * Points that stay the same size on screen however far away they are, like real lights at
 * night. Additive, so overlapping lights add up; invisible by day.
 */
export function lightPointsMaterial(sizePx: number): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,
    map: glowTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}
