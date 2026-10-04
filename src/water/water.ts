import * as THREE from 'three';
import type { ShoreMap } from './shoreMap';
import type { WakeMap } from './wakeMap';
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

// Fragment-only detail: small ripples fixed in world space (the visual cue that the boat is
// moving through the water) and the boat's wake.
const DETAIL_GLSL = /* glsl */ `
uniform sampler2D uWakeTex;
uniform vec3 uWakeRect; // x0, z0, size
uniform vec4 uBoat; // x, z, forward x, forward z
uniform float uBoatSpeed;
uniform float uRipple;

// Short ripples: (direction angle offset, wavelength, drift speed). Height and slope.
vec3 ripples(vec2 p, float t) {
  const vec3 R[6] = vec3[6](
    vec3(0.0, 4.7, 0.5), vec3(0.9, 3.1, 0.4), vec3(-0.7, 2.3, 0.35),
    vec3(1.9, 1.7, 0.3), vec3(-1.6, 1.3, 0.25), vec3(2.6, 0.9, 0.2)
  );
  float base = atan(uWaves[0].y, uWaves[0].x);
  vec3 r = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float a = base + R[i].x;
    vec2 d = vec2(cos(a), sin(a));
    float k = 6.28318530718 / R[i].y;
    float ph = k * (dot(d, p) - R[i].z * t);
    float amp = 0.05 / k; // equal slope per component
    r.x += amp * sin(ph);
    r.yz += d * amp * k * cos(ph);
  }
  return r;
}

// Foam left behind the stern, pre-drawn into a top-down texture around the boat (see WakeMap).
float wakeFoam(vec2 p) {
  vec2 uv = (p - uWakeRect.xy) / uWakeRect.z;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return texture2D(uWakeTex, uv).r;
}

// Water pushed aside along the hull, strongest at the bow.
float hullFoam(vec2 p) {
  vec2 rel = p - uBoat.xy;
  vec2 fwd = uBoat.zw;
  float along = dot(rel, fwd);
  float lat = dot(rel, vec2(-fwd.y, fwd.x));
  float e = length(vec2(along / 5.3, lat / 1.95));
  float ring = 1.0 - smoothstep(0.0, 0.3, abs(e - 1.08));
  return ring * smoothstep(0.5, 5.0, uBoatSpeed) * (0.55 + 0.45 * smoothstep(-2.0, 4.0, along));
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
    uWakeTex: { value: null as THREE.Texture | null },
    uWakeRect: { value: new THREE.Vector3(0, 0, 1) },
    uBoat: { value: new THREE.Vector4() },
    uBoatSpeed: { value: 0 },
    uRipple: { value: 0.05 },
  };
  /** Strength of the small world-fixed ripples (debug panel). */
  readonly detail = { ripples: 0.05 };

  constructor(
    private readonly field: WaveField,
    private readonly shore?: ShoreMap,
    private readonly wake?: WakeMap,
  ) {
    this.uniforms.uShore.value = shore?.texture ?? null;
    this.uniforms.uWakeTex.value = wake?.texture ?? null;
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
        .replace('#include <common>', `#include <common>\nvarying float vCrest;\nvarying vec2 vWaterXZ;\nuniform vec4 uWaves[${WAVE_COUNT}];\n${SHORE_GLSL}\n${DETAIL_GLSL}`)
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
          // Wake and bow wave, broken up by the ripples so they don't look painted on.
          // Ripples only matter close to the camera (they fade out by 260 m), so skip them beyond that.
          float rippleFade = (1.0 - smoothstep(25.0, 260.0, length(vViewPosition))) * uRipple;
          vec3 rip = rippleFade > 0.001 ? ripples(vWaterXZ, uTime) : vec3(0.0);
          float churn = 0.7 + 5.0 * rip.x;
          foam = max(foam, clamp(max(wakeFoam(vWaterXZ), hullFoam(vWaterXZ)) * churn, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.92), foam * 0.8);
          `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          // Tilt the normal by the ripple slope; fade out before the ripples get smaller than a pixel.
          normal = normalize(normal + (viewMatrix * vec4(-rip.y, 0.0, -rip.z, 0.0)).xyz * rippleFade);
          `,
        );
    };

    this.mesh = new THREE.Mesh(createWaterGeometry(), material);
    this.mesh.frustumCulled = false; // vertices move in the shader
    this.mesh.receiveShadow = true;
  }

  /** Boat pose for the hull foam: position, heading in compass degrees, speed in m/s. */
  setBoat(x: number, z: number, headingDeg: number, speed: number): void {
    const h = (headingDeg * Math.PI) / 180;
    this.uniforms.uBoat.value.set(x, z, Math.sin(h), -Math.cos(h));
    this.uniforms.uBoatSpeed.value = speed;
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
    // Off the map (or without a wake) the lookup returns 0.
    if (this.wake) u.uWakeRect.value.set(this.wake.x0, this.wake.z0, this.wake.size);
    else u.uWakeRect.value.set(-1e9, -1e9, 1);
    u.uRipple.value = this.detail.ripples;
    const shore = this.shore;
    if (shore?.valid) u.uShoreRect.value.set(shore.x0, shore.z0, shore.step, shore.res);
    else u.uShoreRect.value.set(0, 0, 1, 0);
  }
}
