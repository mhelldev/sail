import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { NIGHT } from './night';

const SUN_ELEVATION = 32; // degrees, by day
const NIGHT_ELEVATION = -12; // the sun far enough below the horizon for a black sky
const SUN_AZIMUTH = 210; // compass degrees
const DAY_FOG = new THREE.Color(0xbfd4e0);
const NIGHT_FOG = new THREE.Color(0x03060b);
const TRANSITION = 3; // seconds from day to night

/**
 * Sky dome, sun (and moon) light with a shadow box following the boat, fog, environment
 * reflections, and a star field for night mode. Night is a smooth transition: the sun sets
 * below the horizon, so the sky shader itself goes dark.
 */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  /** Whether it should be night; the scene follows over a few seconds. */
  night = false;

  private readonly sunDir = new THREE.Vector3();
  private readonly sky = new Sky();
  private readonly moon = new THREE.DirectionalLight(0x8fa8ff, 0);
  private readonly hemi = new THREE.HemisphereLight(0xcfe6ff, 0x1d3a4a, 0.6);
  private readonly stars: THREE.Points;
  private readonly fog: THREE.Fog;
  private t = 0; // 0 = day … 1 = night
  private applied = -1;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    const u = this.sky.material.uniforms;
    this.sky.scale.setScalar(40000);
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    this.setSunElevation(SUN_ELEVATION);
    scene.add(this.sky);

    // Bake the day sky into an environment map so water and boat reflect it (dimmed at night).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(1000);
    skyCopy.material.uniforms = THREE.UniformsUtils.clone(u);
    skyScene.add(skyCopy);
    scene.environment = pmrem.fromScene(skyScene).texture;
    scene.environmentIntensity = 0.8;
    pmrem.dispose();

    this.fog = new THREE.Fog(DAY_FOG.clone(), 2500, 14000);
    scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -25;
    s.right = s.top = 25;
    s.near = 1;
    s.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    // Faint moonlight from high up in the opposite direction, so silhouettes stay readable.
    this.moon.position.set(-0.4, 1, 0.5).multiplyScalar(100);
    scene.add(this.sun, this.sun.target, this.moon, this.hemi);

    this.stars = createStars();
    scene.add(this.stars);
  }

  /** Smoothly follows `night`; call once per frame. */
  update(dt: number, camera: THREE.Camera): void {
    const target = this.night ? 1 : 0;
    // A single bad frame time must never leave the sky broken (NaN sun → black sky shader).
    if (!Number.isFinite(this.t)) this.t = target;
    if (Number.isFinite(dt) && dt > 0) {
      this.t += Math.sign(target - this.t) * Math.min(Math.abs(target - this.t), dt / TRANSITION);
    }
    // Stars sit far away around the camera (they must not move with the boat).
    this.stars.position.copy(camera.position);
    if (this.t === this.applied) return;
    this.applied = this.t;

    const n = this.t * this.t * (3 - 2 * this.t); // ease in and out
    NIGHT.value = n;
    this.setSunElevation(SUN_ELEVATION + (NIGHT_ELEVATION - SUN_ELEVATION) * n);
    const day = 1 - n;
    this.sun.intensity = 2.6 * Math.max(0, day * day);
    this.sun.color.setHSL(0.09, 0.5 + 0.5 * n, 0.92 - 0.25 * n); // warmer towards sunset
    this.hemi.intensity = 0.6 * day + 0.05 * n;
    this.moon.intensity = 0.14 * n;
    this.scene.environmentIntensity = 0.8 * day + 0.04 * n;
    this.fog.color.lerpColors(DAY_FOG, NIGHT_FOG, n);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, (n - 0.4) / 0.6);
    this.stars.visible = n > 0.4;
  }

  /** Keep the shadow camera centred on the boat. */
  follow(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 100);
    this.moon.target.position.copy(target);
    this.moon.position.set(target.x - 40, target.y + 100, target.z + 50);
  }

  private setSunElevation(deg: number): void {
    const phi = THREE.MathUtils.degToRad(90 - deg);
    const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    // Compass azimuth → world: east = +X, north = -Z.
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
  }
}

/** A few thousand stars of varying brightness, denser along a Milky Way band. */
function createStars(): THREE.Points {
  const count = 4500;
  const radius = 20000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const band = new THREE.Vector3(0.3, 0.55, -0.78).normalize(); // normal of the Milky Way plane
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere; a third of the stars pulled towards the band.
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    if (i % 3 === 0) v.addScaledVector(band, -v.dot(band) * 0.9).normalize();
    if (v.y < -0.05) v.y = -v.y; // keep (nearly) all above the horizon
    positions.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    const b = Math.pow(Math.random(), 3) * 0.9 + 0.1; // mostly faint, a few bright
    const tint = Math.random();
    colors.set([b * (tint < 0.15 ? 1 : 0.85), b * 0.9, b * (tint > 0.85 ? 1 : 0.85)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(geo, material);
  stars.frustumCulled = false;
  stars.visible = false;
  stars.renderOrder = -1;
  return stars;
}
