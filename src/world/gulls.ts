// Gulls: flocks circling over the nearby harbours, a few following the boat, some floating on the water
// in the harbour — only a few. One InstancedMesh; the wing beat is done in the vertex shader from a per-gull phase
// and a "flap" amount (0 gliding … 1 flapping, -1 wings folded while floating), so the CPU only moves
// a handful of matrices per frame.

import * as THREE from 'three';
import { heightAt, type WaveField } from '../water/waves';

const MAX = 5;
const FOLLOWERS = 1; // gulls around the boat
const PER_HARBOUR = 2; // circling + floating
const FLOATING = 1; // of those, on the water

type Mode = 'fly' | 'float';

export interface HarbourAnchor {
  id: number;
  x: number;
  z: number;
  seaX: number;
  seaZ: number;
}

interface Gull {
  mode: Mode;
  /** which anchor it belongs to: -1 = the boat, otherwise a harbour id */
  anchor: number;
  /** offset of its circle's centre from the anchor */
  ox: number;
  oz: number;
  radius: number;
  height: number;
  /** angular speed (rad/s), negative = clockwise */
  speed: number;
  angle: number;
  phase: number;
  flap: number;
  /** current position (for calls) */
  x: number;
  y: number;
  z: number;
}

/** A gull from simple shapes: body along +Z (forward), wings along ±X, grey back, black wing tips. */
function gullGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const color = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex).convertSRGBToLinear();
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => c.toArray()).flat(), 3));
    return g;
  };
  parts.push(color(new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.9, 2.6).toNonIndexed(), 0xf4f4f2)); // body
  parts.push(color(new THREE.SphereGeometry(0.075, 8, 6).translate(0, 0.04, 0.27).toNonIndexed(), 0xf8f8f6)); // head
  parts.push(color(new THREE.ConeGeometry(0.018, 0.08, 5).rotateX(Math.PI / 2).translate(0, 0.03, 0.37).toNonIndexed(), 0xf2b705)); // beak
  parts.push(color(new THREE.BoxGeometry(0.12, 0.015, 0.14).translate(0, 0, -0.27).toNonIndexed(), 0xe8e8e6)); // tail
  for (const side of [-1, 1]) {
    // Inner wing (grey) and the black tip, flat; the shader bends them.
    parts.push(color(new THREE.BoxGeometry(0.42, 0.012, 0.2).translate(side * 0.29, 0.02, 0.02).toNonIndexed(), 0xb7bec4));
    parts.push(color(new THREE.BoxGeometry(0.24, 0.012, 0.13).translate(side * 0.62, 0.02, -0.01).toNonIndexed(), 0x1f2326));
  }
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arrays = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) (out.set(a, o), (o += a.length));
    geo.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  return geo;
}

export class Gulls {
  readonly mesh: THREE.InstancedMesh;
  private readonly gulls: Gull[] = [];
  private readonly phase: THREE.InstancedBufferAttribute;
  private readonly flap: THREE.InstancedBufferAttribute;
  private readonly uTime = { value: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor() {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aPhase;\nattribute float aFlap;\nuniform float uTime;',
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          float span = abs(transformed.x);
          if (span > 0.1) {
            if (aFlap < 0.0) {
              // Floating: wings folded along the body.
              transformed.x *= 0.3;
              transformed.y += 0.03;
            } else {
              // Wing beat (or a gentle flex while gliding); the tips move most.
              float beat = sin(uTime * 7.0 + aPhase) * (0.12 + 0.88 * aFlap);
              transformed.y += beat * (span - 0.1) * 0.9 + span * 0.12;
            }
          }`,
        );
    };
    this.mesh = new THREE.InstancedMesh(gullGeometry(), material, MAX);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aPhase', this.phase);
    this.mesh.geometry.setAttribute('aFlap', this.flap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = true;
  }

  /**
   * @param harbours nearby harbours (id, shore point, unit vector out to sea), nearest first
   */
  update(dt: number, time: number, boat: { x: number; z: number }, harbours: HarbourAnchor[], waves: WaveField): void {
    this.uTime.value = time;
    this.populate(harbours);
    const anchorOf = (g: Gull) => (g.anchor === -1 ? boat : harbours.find((h) => h.id === g.anchor));
    let n = 0;
    for (const g of this.gulls) {
      const a = anchorOf(g);
      if (!a) continue;
      if (g.mode === 'fly') {
        g.angle += g.speed * dt;
        const cx = a.x + g.ox;
        const cz = a.z + g.oz;
        g.x = cx + Math.cos(g.angle) * g.radius;
        g.z = cz + Math.sin(g.angle) * g.radius;
        g.y = g.height + Math.sin(time * 0.3 + g.phase) * 3;
        // Mostly gliding, now and then a few wing beats.
        const flapping = Math.sin(time * 0.6 + g.phase * 3) > 0.55 ? 1 : 0;
        g.flap += (flapping - g.flap) * (1 - Math.exp(-3 * dt));
        // Facing along the circle, banked into the turn.
        const dir = g.speed > 0 ? 1 : -1;
        const heading = Math.atan2(-Math.sin(g.angle) * dir, Math.cos(g.angle) * dir);
        this.e.set(0, heading, -dir * 0.35);
      } else {
        // Floating: drift slowly, bob on the waves.
        g.angle += g.speed * 0.05 * dt;
        g.x = a.x + g.ox + Math.cos(g.angle) * g.radius;
        g.z = a.z + g.oz + Math.sin(g.angle) * g.radius;
        g.y = heightAt(waves, g.x, g.z, time) + 0.06;
        g.flap = -1;
        this.e.set(0, g.phase, 0);
      }
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(g.x, g.y, g.z), this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.phase.setX(n, g.phase);
      this.flap.setX(n, g.flap);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
    this.phase.needsUpdate = true;
  }

  /** Flying gulls near a point (for their calls). */
  near(x: number, z: number, radius: number): Gull[] {
    return this.gulls.filter((g) => g.mode === 'fly' && Math.hypot(g.x - x, g.z - z) < radius);
  }

  /** Keeps the boat's followers and a flock per nearby harbour; drops flocks of harbours left behind. */
  private populate(harbours: HarbourAnchor[]): void {
    const ids = new Set(harbours.map((h) => h.id));
    for (let i = this.gulls.length - 1; i >= 0; i--) {
      const a = this.gulls[i].anchor;
      if (a !== -1 && !ids.has(a)) this.gulls.splice(i, 1);
    }
    const count = (anchor: number) => this.gulls.filter((g) => g.anchor === anchor).length;
    for (let i = count(-1); i < FOLLOWERS; i++) this.gulls.push(this.spawn(-1, 'fly'));
    for (const h of harbours) {
      if (this.gulls.length >= MAX) break;
      if (count(h.id) > 0) continue;
      for (let i = 0; i < PER_HARBOUR && this.gulls.length < MAX; i++) this.gulls.push(this.spawn(h.id, i < FLOATING ? 'float' : 'fly', h));
    }
  }

  private spawn(anchor: number, mode: Mode, harbour?: HarbourAnchor): Gull {
    const r = Math.random;
    const follower = anchor === -1;
    // Harbour flocks circle over the basin, a little out to sea; floating ones sit on the water there.
    const out = harbour ? (mode === 'float' ? 45 + r() * 50 : 20 + r() * 80) : 0;
    const across = (r() - 0.5) * (mode === 'float' ? 50 : 140);
    const [sx, sz] = harbour ? [harbour.seaX, harbour.seaZ] : [0, 0];
    return {
      mode,
      anchor,
      ox: follower ? (r() - 0.5) * 30 : sx * out - sz * across,
      oz: follower ? (r() - 0.5) * 30 : sz * out + sx * across,
      radius: mode === 'float' ? 3 + r() * 25 : follower ? 12 + r() * 25 : 15 + r() * 50,
      height: follower ? 14 + r() * 12 : 10 + r() * 30,
      speed: (r() < 0.5 ? -1 : 1) * (mode === 'float' ? 0.2 : 0.18 + r() * 0.25),
      angle: r() * Math.PI * 2,
      phase: r() * Math.PI * 2,
      flap: 0,
      x: 0,
      y: 0,
      z: 0,
    };
  }
}
