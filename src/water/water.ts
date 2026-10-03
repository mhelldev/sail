import * as THREE from 'three';
import type { ShoreMap } from './shoreMap';
import { SHORE_RANGE, WAVE_COUNT, maxHeight, type WaveField } from './waves';

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

// Shore distance lookup, shared by vertex and fragment shader. Mirrors ShoreMap.sample.
const SHORE_GLSL = /* glsl */ `
uniform sampler2D uShore;
uniform vec4 uShoreRect; // x0, z0, step, res (res = 0 while no map is loaded)
uniform float uShoreRange;
uniform float uTime;

float shoreDistance(vec2 p) {
  vec2 f = (p - uShoreRect.xy) / uShoreRect.z;
  if (uShoreRect.w < 1.0 || any(lessThan(f, vec2(0.0))) || any(greaterThan(f, vec2(uShoreRect.w - 1.0)))) {
    return -uShoreRange;
  }
  vec2 uv = (f + 0.5) / uShoreRect.w;
  return textureLod(uShore, uv, 0.0).r * 2.0 * uShoreRange - uShoreRange;
}

// Mirrors shoreDamping in waves.ts.
float shoreDamping(float sd) {
  return 1.0 - 0.85 * smoothstep(-150.0, -5.0, sd);
}
`;

// Mirrors `displace` in waves.ts, plus analytic normals.
const WAVE_GLSL = /* glsl */ `
${SHORE_GLSL}
uniform float uAmplitude;
uniform float uMaxHeight;
uniform vec2 uCenter;
uniform vec2 uFade;
uniform vec4 uWaves[${WAVE_COUNT}]; // dirX, dirZ, steepness, length
varying float vCrest;
varying vec2 vWaterXZ;

void gerstner(vec2 p, out vec3 disp, out vec3 normal) {
  float d = length(p - uCenter);
  float amp = uAmplitude * (1.0 - smoothstep(uFade.x, uFade.y, d)) * shoreDamping(shoreDistance(p));
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
    uShore: { value: null as THREE.Texture | null },
    uShoreRect: { value: new THREE.Vector4() },
    uShoreRange: { value: SHORE_RANGE },
  };

  constructor(
    private readonly field: WaveField,
    private readonly shore?: ShoreMap,
  ) {
    this.uniforms.uShore.value = shore?.texture ?? null;
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
          vWaterXZ = waveWorld.xz + waveDisp.xz;
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(1.0, 0.0, 0.0);
          #endif
          `,
        )
        // The mesh is never rotated or scaled, so a world offset equals a local offset.
        .replace('#include <begin_vertex>', 'vec3 transformed = position + waveDisp;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vCrest;\nvarying vec2 vWaterXZ;\n${SHORE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          float sd = shoreDistance(vWaterXZ);
          // Crest foam out at sea, lighter turquoise in the shallows.
          float foam = smoothstep(0.6, 1.0, vCrest) * 0.4;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.36, 0.42), smoothstep(-0.1, 0.8, vCrest) * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.48, 0.47), smoothstep(-110.0, -5.0, sd) * 0.5);
          // Surf: a thin foam edge at the shoreline plus a few lines rolling in towards it.
          float lines = 0.5 + 0.5 * sin(sd * 0.3 - uTime * 1.4 + sin(vWaterXZ.x * 0.05 + vWaterXZ.y * 0.04) * 2.0);
          float edge = (1.0 - smoothstep(0.0, 7.0, -sd)) * (0.5 + 0.5 * lines);
          float rollers = (1.0 - smoothstep(6.0, 40.0, -sd)) * smoothstep(0.9, 0.99, lines) * 0.45;
          foam = max(foam, max(edge, rollers));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.92), foam * 0.8);
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
    const shore = this.shore;
    if (shore?.valid) u.uShoreRect.value.set(shore.x0, shore.z0, shore.step, shore.res);
    else u.uShoreRect.value.set(0, 0, 1, 0);
  }
}
