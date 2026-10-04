import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HarborData, Lighthouse } from './harborData';
import { generateVillage, obstacleDistance, type Ground, type Obstacle, type PartType, type Village } from './village';

const ACTIVE_RADIUS = 8000; // villages and lighthouses within this distance are built
const DROP_RADIUS = 10000; // and dropped beyond this one (hysteresis)
const REPLAN_DISTANCE = 300;
const BUILD_INTERVAL = 0.08; // seconds between building two villages, to avoid frame hitches
const REAL_LIGHTHOUSE_NEAR = 1500; // a village gets its own lighthouse only without a real one this close

// ---- Unit geometries (base at y = 0, 1 × 1 × 1, scaled per instance) ---------------------------

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}

/** Gabled roof: ridge along local Z, eaves at y = 0, apex at y = 1. */
function gable(): THREE.BufferGeometry {
  const p = [
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0, 1, -0.5], // back gable
    [-0.5, 0, 0.5], [0, 1, 0.5], [0.5, 0, 0.5], // front gable
    [-0.5, 0, -0.5], [0, 1, -0.5], [0, 1, 0.5], [-0.5, 0, -0.5], [0, 1, 0.5], [-0.5, 0, 0.5], // left slope
    [0.5, 0, -0.5], [0.5, 0, 0.5], [0, 1, 0.5], [0.5, 0, -0.5], [0, 1, 0.5], [0, 1, -0.5], // right slope
  ].flat();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Breakwater: rock ridge with sloping sides. */
function ridge(): THREE.BufferGeometry {
  const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.22, 1), new THREE.Vector2(-0.22, 1)]);
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

/** Small boat hull seen from above: pointed bow at +Z, flat transom at -Z. */
function hull(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.38, -0.5);
  shape.lineTo(0.38, -0.5);
  shape.quadraticCurveTo(0.52, 0.05, 0, 0.5);
  shape.quadraticCurveTo(-0.52, 0.05, -0.38, -0.5);
  // Extruded upwards: shape lies in XY, so rotate it into XZ.
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 })
    .rotateX(-Math.PI / 2)
    .scale(1, 1, -1)
    .translate(0, -0.35, 0);
}

const GEOMETRY: Record<PartType, () => THREE.BufferGeometry> = {
  house: box,
  roof: gable,
  chimney: box,
  tower: box,
  spire: () => new THREE.ConeGeometry(0.71, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  deck: box,
  pile: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0),
  pontoon: box,
  breakwater: ridge,
  harbourLight: () => new THREE.CylinderGeometry(0.4, 0.5, 1, 8).translate(0, 0.5, 0),
  hull,
  mast: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 5).translate(0, 0.5, 0),
  cabin: box,
  crown: () => new THREE.IcosahedronGeometry(0.5, 0),
  conifer: () => new THREE.ConeGeometry(0.5, 1, 7).translate(0, 0.5, 0),
  trunk: () => new THREE.CylinderGeometry(0.5, 0.6, 1, 5).translate(0, 0.5, 0),
  flagpole: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 4).translate(0, 0.5, 0),
  flag: box,
  millTower: () => new THREE.CylinderGeometry(0.32, 0.5, 1, 8).translate(0, 0.5, 0),
  millCap: gable,
  rock: () => new THREE.DodecahedronGeometry(0.5, 0),
};

/** Wall types that get procedural windows. */
const WINDOWED = new Set<PartType>(['house', 'tower']);

/**
 * Building material: draws window panes on the walls procedurally from each instance's size,
 * so every house gets windows on every storey without any extra geometry.
 */
function buildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWallPos;\nvarying vec3 vWallNormal;\nvarying vec3 vWallSize;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vec3 wallScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vWallPos = position * wallScale; // metres in the building's own frame
        vWallNormal = normal;
        vWallSize = wallScale;
        `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWallPos;\nvarying vec3 vWallNormal;\nvarying vec3 vWallSize;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        if (abs(vWallNormal.y) < 0.5) {
          bool sideX = abs(vWallNormal.x) > 0.5;
          float along = sideX ? vWallPos.z : vWallPos.x;
          float width = sideX ? vWallSize.z : vWallSize.x;
          float cols = max(1.0, floor(width / 2.4));
          float fu = fract((along / width + 0.5) * cols);
          float fv = fract(vWallPos.y / 2.9);
          float inside = step(0.9, vWallPos.y) * step(vWallPos.y, vWallSize.y - 0.7);
          float pane = step(0.32, fu) * step(fu, 0.68) * step(0.3, fv) * step(fv, 0.8) * inside;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.07, 0.09), pane * 0.85);
        }
        `,
      );
  };
  return mat;
}

/** Lighthouse, 1 unit = 1 m: red/white banded tower, gallery, lamp room, red cap. Vertex colours. */
function lighthouseGeometry(): THREE.BufferGeometry {
  const paint = (geo: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo.toNonIndexed();
  };
  const parts: THREE.BufferGeometry[] = [];
  const bands = 5;
  const height = 24;
  for (let i = 0; i < bands; i++) {
    const y0 = (height / bands) * i;
    const r0 = 3.2 - (1.2 * i) / bands;
    const r1 = 3.2 - (1.2 * (i + 1)) / bands;
    parts.push(paint(new THREE.CylinderGeometry(r1, r0, height / bands, 12).translate(0, y0 + height / bands / 2, 0), i % 2 ? 0xc8102e : 0xf4f2ec));
  }
  parts.push(paint(new THREE.CylinderGeometry(2.8, 2.8, 0.6, 12).translate(0, height + 0.3, 0), 0x2b2b2b)); // gallery
  parts.push(paint(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 12).translate(0, height + 2.2, 0), 0xfff2c4)); // lamp room
  parts.push(paint(new THREE.ConeGeometry(2.1, 2.4, 12).translate(0, height + 5, 0), 0xc8102e)); // cap
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}
const LAMP_HEIGHT = 26.2;

/** Two faint light cones pointing in opposite directions, fading out towards their ends. */
function beamGeometry(): THREE.BufferGeometry {
  const LENGTH = 160;
  const one = new THREE.ConeGeometry(9, LENGTH, 12, 6, true).rotateZ(Math.PI / 2).translate(LENGTH / 2, 0, 0);
  const pos = one.attributes.position;
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const along = Math.min(1, Math.max(0, pos.getX(i) / LENGTH));
    colors.set([1, 1, 1, Math.pow(1 - along, 1.6)], i * 4);
  }
  one.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  const other = one.clone().rotateY(Math.PI);
  return mergeGeometries([one, other])!;
}

function millSailsGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    blades.push(new THREE.BoxGeometry(1.6, 7.5, 0.15).translate(0.5, 4.2, 0).rotateZ((i * Math.PI) / 2));
  }
  return mergeGeometries(blades)!;
}

// ---- Renderer ----------------------------------------------------------------------------------

interface Slot {
  mesh: THREE.InstancedMesh;
  capacity: number;
}

/**
 * Builds the villages and lighthouses near the boat and draws them with one InstancedMesh per
 * part type, so the number of draw calls stays the same however many villages are around.
 */
export class HarborRenderer {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  private readonly wallMaterial = buildingMaterial();
  private readonly slots = new Map<PartType, Slot>();
  private readonly villages = new Map<number, Village>();
  private readonly activeLighthouses = new Map<string, { x: number; y: number; z: number; phase: number }>();
  private readonly lighthouseMesh: THREE.InstancedMesh;
  private readonly lampMesh: THREE.InstancedMesh;
  private readonly beamMesh: THREE.InstancedMesh;
  private readonly sailsMesh: THREE.InstancedMesh;
  private readonly lastPlan = new THREE.Vector2(Infinity, Infinity);
  private pending: number[] = []; // harbour ids still to build, nearest first
  private sinceBuild = 0;
  private dirty = false;
  private nearbyObstacles: Obstacle[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly data: HarborData,
    private ground: Ground,
  ) {
    const max = 256;
    this.lighthouseMesh = new THREE.InstancedMesh(lighthouseGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true }), max);
    this.lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 10, 6), new THREE.MeshBasicMaterial({ color: 0xfff1b0 }), max);
    this.beamMesh = new THREE.InstancedMesh(
      beamGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xfff6d0, vertexColors: true, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      max,
    );
    this.sailsMesh = new THREE.InstancedMesh(millSailsGeometry(), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 }), max);
    for (const mesh of [this.lighthouseMesh, this.lampMesh, this.beamMesh, this.sailsMesh]) {
      mesh.count = 0;
      mesh.frustumCulled = false; // few instances, moving every frame
      this.group.add(mesh);
    }
    this.lighthouseMesh.receiveShadow = true;
  }

  /** New terrain (tuning panel): rebuild everything on the new ground. */
  setGround(ground: Ground): void {
    this.ground = ground;
    this.villages.clear();
    this.activeLighthouses.clear();
    this.lastPlan.set(Infinity, Infinity);
    this.dirty = true;
  }

  update(dt: number, time: number, boatX: number, boatZ: number): void {
    if (this.lastPlan.distanceTo(this.v.set(boatX, boatZ, 0) as unknown as THREE.Vector2) >= REPLAN_DISTANCE) {
      this.lastPlan.set(boatX, boatZ);
      this.plan(boatX, boatZ);
    }

    // Build at most one village per interval, nearest first.
    this.sinceBuild += dt;
    if (this.pending.length && this.sinceBuild >= BUILD_INTERVAL) {
      this.sinceBuild = 0;
      const id = this.pending.shift()!;
      const h = this.data.harbors.items[id];
      const hasRealLighthouse = this.data.lighthouses.near(h.x, h.z, REAL_LIGHTHOUSE_NEAR).length > 0;
      const village = generateVillage(h, this.ground, { hasRealLighthouse });
      this.villages.set(id, village);
      village.lighthouses.forEach((l, i) => this.addLighthouse(`v${id}:${i}`, l.x, l.z));
      this.dirty = true;
    }

    if (this.dirty) {
      this.dirty = false;
      this.rebuildInstances();
    }
    this.animate(time);
    this.nearbyObstacles = [];
    for (const v of this.villages.values()) {
      for (const o of v.obstacles) if (Math.abs(o.x - boatX) < 200 && Math.abs(o.z - boatZ) < 200) this.nearbyObstacles.push(o);
    }
  }

  /** Signed distance to the closest pier, pontoon, breakwater or moored boat (positive inside). */
  obstacleDistance(x: number, z: number): number {
    let best = -Infinity;
    for (const o of this.nearbyObstacles) best = Math.max(best, obstacleDistance(o, x, z));
    return best;
  }

  get villageCount(): number {
    return this.villages.size;
  }

  private plan(x: number, z: number): void {
    for (const id of [...this.villages.keys()]) {
      const h = this.data.harbors.items[id];
      if (Math.hypot(h.x - x, h.z - z) > DROP_RADIUS) {
        this.villages.delete(id);
        this.dirty = true;
      }
    }
    for (const [key, l] of this.activeLighthouses) {
      if (Math.hypot(l.x - x, l.z - z) > DROP_RADIUS) {
        this.activeLighthouses.delete(key);
        this.dirty = true;
      }
    }
    this.pending = this.data.harbors
      .near(x, z, ACTIVE_RADIUS)
      .filter((h) => !this.villages.has(h.id))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
      .map((h) => h.id);
    for (const l of this.data.lighthouses.near(x, z, ACTIVE_RADIUS)) this.addLighthouse(`r${l.id}`, l.x, l.z);
  }

  private addLighthouse(key: string, x: number, z: number): void {
    if (this.activeLighthouses.has(key)) return;
    this.activeLighthouses.set(key, { x, y: this.ground.height(x, z) - 0.5, z, phase: (x * 0.013 + z * 0.007) % (Math.PI * 2) });
    this.dirty = true;
  }

  private slot(type: PartType, count: number): THREE.InstancedMesh {
    let slot = this.slots.get(type);
    if (!slot || slot.capacity < count) {
      if (slot) {
        this.group.remove(slot.mesh);
        slot.mesh.dispose();
      }
      const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
      const geometry = slot?.mesh.geometry ?? GEOMETRY[type]();
      const mesh = new THREE.InstancedMesh(geometry, WINDOWED.has(type) ? this.wallMaterial : this.material, capacity);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      slot = { mesh, capacity };
      this.slots.set(type, slot);
    }
    return slot.mesh;
  }

  /** Writes every active village's parts into the per-type instance buffers. */
  private rebuildInstances(): void {
    const byType = new Map<PartType, Village['parts']>();
    for (const v of this.villages.values()) {
      for (const p of v.parts) {
        const list = byType.get(p.type);
        if (list) list.push(p);
        else byType.set(p.type, [p]);
      }
    }
    for (const type of new Set<PartType>([...byType.keys(), ...this.slots.keys()])) {
      const parts = byType.get(type) ?? [];
      const mesh = this.slot(type, parts.length);
      parts.forEach((p, i) => {
        this.q.setFromAxisAngle(this.up, p.rotY);
        this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(p.sx, p.sy, p.sz));
        mesh.setMatrixAt(i, this.m);
        mesh.setColorAt(i, this.c.setHex(p.color));
      });
      mesh.count = parts.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }

    let i = 0;
    for (const l of this.activeLighthouses.values()) {
      this.m.makeTranslation(l.x, l.y, l.z);
      this.lighthouseMesh.setMatrixAt(i, this.m);
      this.m.makeTranslation(l.x, l.y + LAMP_HEIGHT, l.z);
      this.lampMesh.setMatrixAt(i, this.m);
      if (++i >= this.lighthouseMesh.instanceMatrix.count) break;
    }
    this.lighthouseMesh.count = this.lampMesh.count = this.beamMesh.count = i;
    this.lighthouseMesh.instanceMatrix.needsUpdate = this.lampMesh.instanceMatrix.needsUpdate = true;
  }

  /** Per frame: turn the lighthouse beams and the windmill sails. */
  private animate(time: number): void {
    let i = 0;
    for (const l of this.activeLighthouses.values()) {
      this.q.setFromAxisAngle(this.up, time * 0.6 + l.phase);
      this.m.compose(this.v.set(l.x, l.y + LAMP_HEIGHT, l.z), this.q, this.s.set(1, 1, 1));
      this.beamMesh.setMatrixAt(i, this.m);
      if (++i >= this.beamMesh.count) break;
    }
    this.beamMesh.instanceMatrix.needsUpdate = true;

    let j = 0;
    const spin = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 0, 1);
    for (const v of this.villages.values()) {
      for (const mill of v.mills) {
        if (j >= 256) break;
        this.q.setFromAxisAngle(this.up, mill.rotY);
        spin.setFromAxisAngle(axis, time * 0.9 + mill.x * 0.01);
        this.q.multiply(spin);
        // Sails sit in front of the cap, on the side facing the sea.
        this.m.compose(
          this.v.set(mill.x + Math.sin(mill.rotY) * 3, mill.y, mill.z + Math.cos(mill.rotY) * 3),
          this.q,
          this.s.set(1, 1, 1),
        );
        this.sailsMesh.setMatrixAt(j++, this.m);
      }
    }
    this.sailsMesh.count = j;
    this.sailsMesh.instanceMatrix.needsUpdate = true;
  }
}

export type { Lighthouse };
