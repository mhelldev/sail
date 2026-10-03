import * as THREE from 'three';
import { WAVE_COUNT, maxHeight, type WaveField } from './waves';

const SIZE = 32000; // metres across, beyond the farthest terrain
const SEGMENTS = 360;
// Vertex spacing grows with distance: ~1.5 m near the boat, a few hundred metres at the horizon.
const CENTER_DENSITY = 0.017;

/** Grid whose vertices are packed densely at the centre and sparsely at the edges. */
function createWaterGeometry(): THREE.BufferGeometry {
  const warp = (u: number) => (SIZE / 2) * (CENTER_DENSITY * u + (1 - CENTER_DENSITY) * u * u * u);
  const n = SEGMENTS + 1;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3;
      positions[o] = warp((i / SEGMENTS) * 2 - 1);
      positions[o + 2] = warp((j / SEGMENTS) * 2 - 1);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * n + i;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Real normals are computed in the shader; this just satisfies the built-in attribute.
  const normals = new Float32Array(n * n * 3);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

// Mirrors `displace` in waves.ts, plus analytic normals.
const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uAmplitude;
uniform float uMaxHeight;
uniform vec2 uCenter;
uniform vec2 uFade;
uniform vec4 uWaves[${WAVE_COUNT}]; // dirX, dirZ, steepness, length
varying float vCrest;

void gerstner(vec2 p, out vec3 disp, out vec3 normal) {
  float d = length(p - uCenter);
  float amp = uAmplitude * (1.0 - smoothstep(uFade.x, uFade.y, d));
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  disp = vec3(0.0);
  for (int i = 0; i < ${WAVE_COUNT}; i++) {
    vec2 dir = uWaves[i].xy;
    float s = uWaves[i].z * amp;
    float k = 6.28318530718 / uWaves[i].w;
    float c = sqrt(9.81 / k);
    float f = k * (dot(dir, p) - c * uTime);
    float a = s / k;
    float cf = cos(f);
    float sf = sin(f);
    disp += vec3(dir.x * a * cf, a * sf, dir.y * a * cf);
    tangent += vec3(-dir.x * dir.x * s * sf, dir.x * s * cf, -dir.x * dir.y * s * sf);
    binormal += vec3(-dir.x * dir.y * s * sf, dir.y * s * cf, -dir.y * dir.y * s * sf);
  }
  normal = normalize(cross(binormal, tangent));
}
`;

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uTime: { value: 0 },
    uAmplitude: { value: 1 },
    uMaxHeight: { value: 1 },
    uCenter: { value: new THREE.Vector2() },
    uFade: { value: new THREE.Vector2() },
    uWaves: { value: Array.from({ length: WAVE_COUNT }, () => new THREE.Vector4()) },
  };

  constructor(private readonly field: WaveField) {
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x0b3a55,
      roughness: 0.22,
      metalness: 0.0,
      envMapIntensity: 0.45,
      specularIntensity: 0.35,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WAVE_GLSL}`)
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `
          vec3 waveWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 waveDisp;
          vec3 objectNormal;
          gerstner(waveWorld.xz, waveDisp, objectNormal);
          vCrest = waveDisp.y / max(uMaxHeight, 0.001);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(1.0, 0.0, 0.0);
          #endif
          `,
        )
        // The mesh is never rotated or scaled, so a world offset equals a local offset.
        .replace('#include <begin_vertex>', 'vec3 transformed = position + waveDisp;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCrest;')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          float foam = smoothstep(0.6, 1.0, vCrest);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.36, 0.42), smoothstep(-0.1, 0.8, vCrest) * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 0.98), foam * 0.4);
          `,
        );
    };

    this.mesh = new THREE.Mesh(createWaterGeometry(), material);
    this.mesh.frustumCulled = false; // vertices move in the shader
    this.mesh.receiveShadow = true;
  }

  update(time: number, followX: number, followZ: number): void {
    const f = this.field;
    this.mesh.position.set(followX, 0, followZ);
    f.centerX = followX;
    f.centerZ = followZ;
    const u = this.uniforms;
    u.uTime.value = time;
    u.uAmplitude.value = f.amplitude;
    u.uMaxHeight.value = maxHeight(f);
    u.uCenter.value.set(followX, followZ);
    u.uFade.value.set(f.fadeStart, f.fadeEnd);
    f.waves.forEach((w, i) => u.uWaves.value[i].set(w.dirX, w.dirZ, w.steepness, w.length));
  }
}
