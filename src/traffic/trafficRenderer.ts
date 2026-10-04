import * as THREE from 'three';
import { buildingMaterial, hull } from '../harbors/harborRenderer';
import { heightAt, type WaveField } from '../water/waves';
import { lightPointsMaterial, NIGHT } from '../world/night';
import { designVessel, type Shape, type ShapeType } from './vesselDesigns';
import type { Vessel } from './vessel';

const DRAW_DISTANCE = 13000; // fog hides anything further

/** Triangular sail in the YZ plane: luff up the Y axis, foot along +Z. */
function sail(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  geo.computeVertexNormals();
  return geo;
}

const GEOMETRY: Record<ShapeType, () => THREE.BufferGeometry> = {
  hull,
  box: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  deckhouse: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0),
  sail,
  cone: () => new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0),
  light: () => new THREE.BufferGeometry(), // drawn as points, see navLights
};

interface Slot {
  mesh: THREE.InstancedMesh;
  capacity: number;
  count: number;
}

/**
 * Draws all generated vessels with one InstancedMesh per shape type. Every frame each vessel's
 * pose (heading, waves, heel) is combined with its parts' local placement; sails swing with the
 * boom and are lowered when motoring.
 */
export class TrafficRenderer {
  readonly group = new THREE.Group();
  private readonly slots = new Map<ShapeType, Slot>();
  private readonly designs = new Map<number, Shape[]>();
  private readonly furl = new Map<number, number>(); // 0 = sails down … 1 = up
  private readonly material = new THREE.MeshStandardMaterial({ roughness: 0.75, flatShading: true });
  private readonly sailMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  private readonly wallMaterial = buildingMaterial();
  private readonly world = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  /** Navigation lights of all vessels, rewritten every frame (they move). */
  private readonly navLights: THREE.Points;
  private navPositions = new Float32Array(3 * 256);
  private navColors = new Float32Array(3 * 256);
  private navCount = 0;

  constructor() {
    this.navLights = new THREE.Points(new THREE.BufferGeometry(), lightPointsMaterial(6));
    this.navLights.frustumCulled = false;
    this.group.add(this.navLights);
  }

  update(vessels: Vessel[], waves: WaveField, time: number, dt: number, px: number, pz: number): void {
    for (const slot of this.slots.values()) slot.count = 0;
    this.navCount = 0;
    const night = NIGHT.value;
    const alive = new Set<number>();

    for (const v of vessels) {
      alive.add(v.id);
      if (Math.hypot(v.x - px, v.z - pz) > DRAW_DISTANCE) continue;
      let shapes = this.designs.get(v.id);
      if (!shapes) {
        shapes = designVessel(v.kind, v.variant, v.spec.length, v.spec.beam, v.id);
        this.designs.set(v.id, shapes);
      }
      const furl = this.raiseSails(v, dt);
      this.pose(v, waves, time);
      for (const shape of shapes) {
        if (shape.type === 'light') {
          if (night > 0.01) this.addLight(shape);
        } else {
          this.place(shape, v, furl);
        }
      }
    }

    for (const id of this.designs.keys()) {
      if (!alive.has(id)) {
        this.designs.delete(id);
        this.furl.delete(id);
      }
    }
    // Reuse the GPU buffers; only recreate them when the arrays grew.
    const geo = this.navLights.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos || pos.array !== this.navPositions) {
      geo.setAttribute('position', new THREE.BufferAttribute(this.navPositions, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(this.navColors, 3).setUsage(THREE.DynamicDrawUsage));
    } else {
      pos.needsUpdate = true;
      geo.getAttribute('color').needsUpdate = true;
    }
    geo.setDrawRange(0, this.navCount);
    (this.navLights.material as THREE.PointsMaterial).opacity = night;
    this.navLights.visible = night > 0.01 && this.navCount > 0;

    for (const slot of this.slots.values()) {
      slot.mesh.count = slot.count;
      slot.mesh.instanceMatrix.needsUpdate = true;
      if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true;
    }
  }

  private addLight(shape: Shape): void {
    if (this.navCount * 3 >= this.navPositions.length) {
      const grow = (a: Float32Array) => {
        const b = new Float32Array(a.length * 2);
        b.set(a);
        return b;
      };
      this.navPositions = grow(this.navPositions);
      this.navColors = grow(this.navColors);
    }
    this.v.set(shape.x, shape.y, shape.z).applyMatrix4(this.world);
    this.navPositions.set([this.v.x, this.v.y, this.v.z], this.navCount * 3);
    this.c.setHex(shape.color);
    this.navColors.set([this.c.r, this.c.g, this.c.b], this.navCount * 3);
    this.navCount++;
  }

  private raiseSails(v: Vessel, dt: number): number {
    const current = this.furl.get(v.id) ?? (v.sailUp ? 1 : 0);
    const next = current + ((v.sailUp ? 1 : 0) - current) * (1 - Math.exp(-1.5 * dt));
    this.furl.set(v.id, next);
    return next;
  }

  /** Vessel frame in the world: heading, heave, pitch and roll on the waves, heel under sail. */
  private pose(v: Vessel, waves: WaveField, time: number): void {
    const h = (v.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const half = v.spec.length / 2;
    const side = v.spec.beam / 2;
    const heave = heightAt(waves, v.x, v.z, time);
    let pitch = 0;
    let roll = 0;
    // Small boats ride every wave; big ships barely notice them.
    if (v.spec.length < 40) {
      const bow = heightAt(waves, v.x + fx * half, v.z + fz * half, time);
      const stern = heightAt(waves, v.x - fx * half, v.z - fz * half, time);
      const port = heightAt(waves, v.x + fz * side, v.z - fx * side, time);
      const stbd = heightAt(waves, v.x - fz * side, v.z + fx * side, time);
      pitch = Math.atan2(bow - stern, v.spec.length);
      roll = Math.atan2(port - stbd, v.spec.beam);
    }
    // Local +Z is the bow, local +X is port. Bow up = negative X rotation; port up = positive Z rotation.
    this.e.set(-pitch, Math.PI - h, roll - (v.heel * Math.PI) / 180, 'YXZ');
    this.q.setFromEuler(this.e);
    this.world.compose(this.v.set(v.x, heave * (v.spec.length < 40 ? 1 : 0.4), v.z), this.q, this.s.set(1, 1, 1));
  }

  private place(shape: Shape, v: Vessel, furl: number): void {
    let { sy, sz } = shape;
    let ry = shape.ry ?? 0;
    if (shape.sail) {
      if (furl < 0.04) return; // lowered
      sy *= furl;
      sz *= Math.max(0.3, furl);
      // Sails trail aft from their luff (π) and swing out with the boom: a negative boom angle
      // means "to port", and rotating the aft-pointing foot by a negative angle moves it to +X = port.
      const boom = (v.boom * Math.PI) / 180;
      ry = Math.PI + (shape.sail === 'jib' ? boom * 0.7 : boom);
    }
    this.e.set(shape.rx ?? 0, ry, shape.rz ?? 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.local.compose(this.v.set(shape.x, shape.y, shape.z), this.q, this.s.set(shape.sx, sy, sz));
    this.m.multiplyMatrices(this.world, this.local);

    const slot = this.slot(shape.type);
    if (slot.count >= slot.capacity) this.grow(shape.type, slot);
    slot.mesh.setMatrixAt(slot.count, this.m);
    slot.mesh.setColorAt(slot.count, this.c.setHex(shape.color));
    slot.count++;
  }

  private slot(type: ShapeType): Slot {
    let slot = this.slots.get(type);
    if (!slot) {
      slot = { mesh: this.makeMesh(type, 128), capacity: 128, count: 0 };
      this.slots.set(type, slot);
    }
    return slot;
  }

  private grow(type: ShapeType, slot: Slot): void {
    const capacity = slot.capacity * 2;
    const mesh = this.makeMesh(type, capacity, slot.mesh.geometry);
    // Keep what was already written this frame.
    for (let i = 0; i < slot.count; i++) {
      slot.mesh.getMatrixAt(i, this.local);
      mesh.setMatrixAt(i, this.local);
      slot.mesh.getColorAt(i, this.c);
      mesh.setColorAt(i, this.c);
    }
    this.group.remove(slot.mesh);
    slot.mesh.dispose();
    slot.mesh = mesh;
    slot.capacity = capacity;
  }

  private makeMesh(type: ShapeType, capacity: number, geometry = GEOMETRY[type]()): THREE.InstancedMesh {
    const material = type === 'sail' ? this.sailMaterial : type === 'deckhouse' ? this.wallMaterial : this.material;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances move every frame
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }
}
