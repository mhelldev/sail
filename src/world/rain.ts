// Falling rain around the camera: a few thousand short streaks in a box that moves with the viewer.
// Positions are computed in the vertex shader from time and a per-drop seed (fall, wrap, slant with the
// wind), so the CPU only sets four uniforms per frame. One draw call; hidden when it doesn't rain.

import * as THREE from 'three';

const DROPS = 6000;
const BOX = 36; // metres, side of the box of rain around the camera
const HEIGHT = 24;

export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2() },
    uAmount: { value: 0 },
    uColor: { value: new THREE.Color(0xc8d2da) },
  };

  constructor() {
    // Each drop is a line segment: both ends share the seed; aEnd marks the lower end.
    const seeds = new Float32Array(DROPS * 2 * 3);
    const ends = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      seeds.set(s, i * 6);
      seeds.set(s, i * 6 + 3);
      ends[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec2 uWind;
        uniform float uAmount;
        varying float vAlpha;
        void main() {
          vec3 seed = position;
          // Only a share of the drops fall in light rain.
          float on = step(seed.z, uAmount);
          float speed = 8.0 + seed.y * 3.0;
          float fall = fract(seed.y * 7.13 - uTime * speed / ${HEIGHT.toFixed(1)});
          vec3 p;
          // Wrap the drop's x/z into the box around the camera, so rain is always all around.
          p.x = uCenter.x + (fract(seed.x - uCenter.x / ${BOX.toFixed(1)}) - 0.5) * ${BOX.toFixed(1)};
          p.z = uCenter.z + (fract(seed.z * 3.71 - uCenter.z / ${BOX.toFixed(1)}) - 0.5) * ${BOX.toFixed(1)};
          p.y = uCenter.y - 6.0 + fall * ${HEIGHT.toFixed(1)};
          // Slanting with the wind; the streak points along its motion.
          vec3 vel = vec3(uWind.x, -speed, uWind.y);
          p.xz += uWind * (fall - 0.5) * 1.2;
          p -= vel * aEnd * 0.035 * on;
          vAlpha = on * (0.5 + 0.3 * seed.x);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }`,
    });
    this.mesh = new THREE.LineSegments(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * @param amount 0 … 1 rain
   * @param windX, windZ wind velocity in world units (m/s), where the rain is blown to
   */
  update(time: number, camera: THREE.Camera, amount: number, windX: number, windZ: number, darkness: number): void {
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCenter.value.copy(camera.position);
    u.uWind.value.set(windX * 0.5, windZ * 0.5);
    u.uAmount.value = amount;
    u.uColor.value.setRGB(0.78, 0.82, 0.86).multiplyScalar(1 - 0.85 * darkness);
  }
}

/**
 * Raindrops running down a window: adds a uniform `uRain` (0 … 1) to a material and draws drops and
 * streaks over it. Used for the cabin windows.
 */
export function rainyGlass(material: THREE.MeshStandardMaterial, rain: { value: number }, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRain = rain;
    shader.uniforms.uRainTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRainPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRainPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRain;\nuniform float uRainTime;\nvarying vec3 vRainPos;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        if (uRain > 0.01) {
          // Pane coordinates (the panes are vertical: use the larger horizontal axis).
          vec2 uv = vec2(abs(vRainPos.x) > abs(vRainPos.z) ? vRainPos.x : vRainPos.z, vRainPos.y) * 18.0;
          vec2 cell = floor(uv);
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          // Drops sliding down at different speeds, leaving a faint trail.
          float y = fract(uv.y + uRainTime * (0.3 + h * 0.8) + h * 7.0);
          vec2 f = fract(uv) - vec2(0.5, 0.0);
          float drop = smoothstep(0.12, 0.0, length(vec2(f.x, (y - 0.15) * 0.8))) * step(1.0 - uRain * 0.8, h);
          float trail = smoothstep(0.05, 0.0, abs(f.x)) * smoothstep(0.15, 1.0, y) * 0.35 * step(1.0 - uRain * 0.8, h);
          float wet = max(drop, trail);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.86, 0.9), wet * 0.75);
          diffuseColor.a = max(diffuseColor.a, wet * 0.7 + uRain * 0.15);
        }`,
      );
  };
}
