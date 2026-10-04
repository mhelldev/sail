import * as THREE from 'three';
import { WAKE_POINTS, type WakeTrail } from './wake';

const SIZE = 400; // metres of water covered around the boat

/**
 * Draws the wake once per frame as a few hundred ribbon triangles into a small top-down
 * texture around the boat. The water shader then needs a single texture lookup per pixel,
 * instead of testing every pixel against every trail segment (which was ~2/3 of the frame).
 */
export class WakeMap {
  readonly target: THREE.WebGLRenderTarget;
  /** world position of the texture's corner (u = 0, v = 0) */
  x0 = 0;
  z0 = 0;
  readonly size = SIZE;

  private readonly scene = new THREE.Scene();
  // Required by the renderer, but the ribbon shader writes clip space itself and ignores it.
  private readonly camera = new THREE.OrthographicCamera();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions: Float32Array;
  private readonly shape: Float32Array; // across (-1…1), intensity
  private readonly origin = new THREE.Vector2();
  private readonly clearColor = new THREE.Color();

  constructor(resolution = 1024) {
    this.target = new THREE.WebGLRenderTarget(resolution, resolution, {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // Three ribbons (centre + two arms), two vertices per trail point.
    const verts = 3 * 2 * WAKE_POINTS;
    this.positions = new Float32Array(verts * 3);
    this.shape = new Float32Array(verts * 2);
    const index: number[] = [];
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < WAKE_POINTS - 1; i++) {
        const a = (r * WAKE_POINTS + i) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('shape', new THREE.BufferAttribute(this.shape, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(index);

    const material = new THREE.ShaderMaterial({
      uniforms: { uOrigin: { value: this.origin }, uSize: { value: SIZE } },
      vertexShader: /* glsl */ `
        uniform vec2 uOrigin;
        uniform float uSize;
        attribute vec2 shape;
        varying vec2 vShape;
        void main() {
          vShape = shape;
          // World x/z straight to clip space: u = (x - x0) / size, v = (z - z0) / size.
          gl_Position = vec4((position.xz - uOrigin) / uSize * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vShape;
        void main() {
          float v = vShape.y * exp(-3.5 * vShape.x * vShape.x);
          gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      // Overlapping ribbons keep the strongest foam instead of adding up.
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  render(renderer: THREE.WebGLRenderer, trail: WakeTrail, centerX: number, centerZ: number): void {
    // Snap to whole texels so the wake doesn't shimmer as the map follows the boat.
    const texel = SIZE / this.target.width;
    this.x0 = Math.round((centerX - SIZE / 2) / texel) * texel;
    this.z0 = Math.round((centerZ - SIZE / 2) / texel) * texel;
    this.origin.set(this.x0, this.z0);

    this.buildRibbons(trail);

    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColor);
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, previousAlpha);
  }

  /** Same shape the per-pixel version had: churned centre plus Kelvin arms at ~19.5°. */
  private buildRibbons(trail: WakeTrail): void {
    const pts = trail.points;
    const n = trail.count;
    const pos = this.positions;
    const shape = this.shape;
    pos.fill(0);
    shape.fill(0);
    if (n < 2) {
      this.markDirty();
      return;
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      // Direction of travel at this point, from its neighbours.
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let dx = a.x - b.x;
      let dz = a.y - b.y;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const nx = -dz; // perpendicular, to the left of travel
      const nz = dx;

      const along = trail.odometer - p.z;
      const fade = (lo: number, hi: number) => 1 - smoothstep(lo, hi, along);
      const strength = smoothstep(0.8, 4.0, p.w) * fade(15, 170);
      const coreHalf = 1.2 + along * 0.03;
      const armPos = 1.8 + along * 0.34; // tan(19.5°) ≈ 0.35
      const armHalf = 2 * (0.45 + along * 0.012);

      const ribbons: Array<[offset: number, half: number, intensity: number]> = [
        [0, coreHalf, strength * fade(0, 65) * 0.85],
        [armPos, armHalf, strength * fade(10, 110) * 0.4],
        [-armPos, armHalf, strength * fade(10, 110) * 0.4],
      ];
      ribbons.forEach(([offset, half, intensity], r) => {
        const v = (r * WAKE_POINTS + i) * 2;
        for (let side = 0; side < 2; side++) {
          const across = side === 0 ? -1 : 1;
          const o = offset + across * half;
          pos[(v + side) * 3] = p.x + nx * o;
          pos[(v + side) * 3 + 2] = p.y + nz * o;
          shape[(v + side) * 2] = across;
          shape[(v + side) * 2 + 1] = intensity;
        }
      });
    }
    // Unused trail slots collapse onto the last point so they draw nothing.
    for (let r = 0; r < 3; r++) {
      const last = (r * WAKE_POINTS + n - 1) * 2;
      for (let i = n; i < WAKE_POINTS; i++) {
        const v = (r * WAKE_POINTS + i) * 2;
        for (let side = 0; side < 2; side++) {
          pos.copyWithin((v + side) * 3, (last + side) * 3, (last + side) * 3 + 3);
          shape[(v + side) * 2 + 1] = 0;
        }
      }
    }
    this.markDirty();
  }

  private markDirty(): void {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.shape.needsUpdate = true;
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
