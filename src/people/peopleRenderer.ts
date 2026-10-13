// Draws the people: one InstancedMesh for everybody (a single draw call). The body is made of boxes
// tagged with what they are (shirt, trousers, skin, hair, shoes) and which limb they belong to; the
// vertex shader colours them per person and swings legs and arms while walking (the right arm
// gestures while talking). Local frame: +Z forward, feet at y = 0, 1.75 m tall at scale 1.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Person } from './crowd';

const MAX = 80;
const HIP = 0.9;
const SHOULDER = 1.43;

const enum Part {
  Shirt = 0,
  Pants = 1,
  Skin = 2,
  Hair = 3,
  Shoes = 4,
}
const enum Limb {
  None = 0,
  LeftLeg = 1,
  RightLeg = 2,
  LeftArm = 3,
  RightArm = 4,
}

function piece(g: THREE.BufferGeometry, part: Part, limb: Limb): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  flat.deleteAttribute('uv');
  const n = flat.attributes.position.count;
  flat.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  flat.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  flat.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return flat;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

function bodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [side, limb] of [[-1, Limb.LeftLeg], [1, Limb.RightLeg]] as const) {
    parts.push(piece(box(0.15, 0.82, 0.17, side * 0.1, 0.08, 0), Part.Pants, limb));
    parts.push(piece(box(0.16, 0.08, 0.26, side * 0.1, 0, 0.04), Part.Shoes, limb));
  }
  parts.push(piece(box(0.4, 0.56, 0.23, 0, HIP - 0.04, 0), Part.Shirt, Limb.None));
  for (const [side, limb] of [[-1, Limb.LeftArm], [1, Limb.RightArm]] as const) {
    parts.push(piece(box(0.11, 0.52, 0.13, side * 0.26, SHOULDER - 0.52, 0), Part.Shirt, limb));
    parts.push(piece(box(0.09, 0.1, 0.1, side * 0.26, SHOULDER - 0.62, 0), Part.Skin, limb));
  }
  parts.push(piece(box(0.1, 0.08, 0.1, 0, SHOULDER - 0.02, 0), Part.Skin, Limb.None)); // neck
  parts.push(piece(new THREE.SphereGeometry(0.12, 12, 10).scale(1, 1.12, 1.05).translate(0, 1.6, 0), Part.Skin, Limb.None));
  parts.push(piece(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.1, 1.08).translate(0, 1.615, -0.012), Part.Hair, Limb.None));
  // Nose, so you can tell which way they look.
  parts.push(piece(box(0.035, 0.05, 0.04, 0, 1.56, 0.13), Part.Skin, Limb.None));
  return mergeGeometries(parts)!;
}

export class PeopleRenderer {
  readonly mesh: THREE.InstancedMesh;
  private readonly shirt: THREE.InstancedBufferAttribute;
  private readonly pants: THREE.InstancedBufferAttribute;
  private readonly skin: THREE.InstancedBufferAttribute;
  private readonly hair: THREE.InstancedBufferAttribute;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly uTime = { value: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor() {
    const geo = bodyGeometry();
    const attr = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.shirt = attr(3);
    this.pants = attr(3);
    this.skin = attr(3);
    this.hair = attr(3);
    this.anim = attr(3); // phase, walking 0…1, talking 0/1
    geo.setAttribute('aShirt', this.shirt);
    geo.setAttribute('aPants', this.pants);
    geo.setAttribute('aSkin', this.skin);
    geo.setAttribute('aHair', this.hair);
    geo.setAttribute('aAnim', this.anim);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aPart;
          attribute float aLimb;
          attribute vec3 aShirt;
          attribute vec3 aPants;
          attribute vec3 aSkin;
          attribute vec3 aHair;
          attribute vec3 aAnim;
          uniform float uTime;
          float limbAngle() {
            float swing = sin(aAnim.x) * 0.55 * aAnim.y;
            if (aLimb < 0.5) return 0.0;
            if (aLimb < 1.5) return swing;
            if (aLimb < 2.5) return -swing;
            if (aLimb < 3.5) return -swing * 0.8;
            // Right arm: swings when walking, raised and waving a little while talking.
            return swing * 0.8 - aAnim.z * (0.75 + 0.3 * sin(uTime * 2.6 + aAnim.x));
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float a = limbAngle();
            float pivot = aLimb > 2.5 ? ${SHOULDER.toFixed(2)} : ${HIP.toFixed(2)};
            float c = cos(a);
            float s = sin(a);
            float y = transformed.y - pivot;
            float z = transformed.z;
            transformed.y = pivot + y * c - z * s;
            transformed.z = y * s + z * c;
          }`,
        )
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
          vColor.rgb = aPart < 0.5 ? aShirt : aPart < 1.5 ? aPants : aPart < 2.5 ? aSkin : aPart < 3.5 ? aHair : vec3(0.05);`,
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  /** @param heightOf where the person's feet are */
  update(people: Person[], time: number, heightOf: (p: Person) => number, talking: (p: Person) => boolean): void {
    this.uTime.value = time;
    let n = 0;
    for (const person of people) {
      if (n >= MAX) break;
      this.q.setFromAxisAngle(this.up, person.heading);
      this.m.compose(this.p.set(person.x, heightOf(person), person.z), this.q, this.s.setScalar(person.scale));
      this.mesh.setMatrixAt(n, this.m);
      const set = (a: THREE.InstancedBufferAttribute, hex: number) => {
        this.c.setHex(hex);
        a.setXYZ(n, this.c.r, this.c.g, this.c.b);
      };
      set(this.shirt, person.colors.shirt);
      set(this.pants, person.colors.pants);
      set(this.skin, person.colors.skin);
      set(this.hair, person.colors.hair);
      this.anim.setXYZ(n, person.phase, person.walking, talking(person) ? 1 : 0);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of [this.shirt, this.pants, this.skin, this.hair, this.anim]) a.needsUpdate = true;
  }
}
