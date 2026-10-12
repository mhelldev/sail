import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { WeatherState } from '../weather/weather';
import { NIGHT } from './night';

const DAY_FOG = new THREE.Color(0xbfd4e0);
const GREY_FOG = new THREE.Color(0x9ea7ad); // overcast, rain, fog
const DUSK_FOG = new THREE.Color(0xd9a27c);
const NIGHT_FOG = new THREE.Color(0x03060b);
const NIGHT_SKY = new THREE.Color(0x050b16);
const REBAKE_INTERVAL = 4; // seconds: the reflected sky follows the clouds
const SUN_ELEVATION = 32; // degrees, by day
const SUN_AZIMUTH = 210; // compass degrees
const TRANSITION = 3; // seconds from day to night

export interface SkyInput {
  weather: WeatherState;
  /** metres, from the weather */
  visibility: number;
  /** seconds, drives the clouds */
  time: number;
  /** wind direction (compass, from) and speed, so the clouds drift with it */
  wind: { direction: number; speed: number };
}

/**
 * Sky dome with drifting clouds, sun (and moon) light with a shadow box following the player, fog,
 * environment reflections and stars. Day by default; night mode (`night`, N) fades in over a few
 * seconds. The weather shows in it: cloud cover dims the sun and greys the sky, fog closes in.
 */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  /** Whether it should be night; the scene follows over a few seconds. */
  night = false;
  private t = 0; // 0 = day … 1 = night

  private readonly sunDir = new THREE.Vector3();
  private readonly sky = new Sky();
  private readonly skyCopy = new Sky();
  private readonly skyScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private envMap?: THREE.Texture;
  private sinceBake = Infinity;
  private baked = { elevation: Infinity, clouds: Infinity };
  private readonly moon = new THREE.DirectionalLight(0x8fa8ff, 0);
  private readonly hemi = new THREE.HemisphereLight(0xcfe6ff, 0x1d3a4a, 0.6);
  private readonly stars: THREE.Points;
  private readonly fog: THREE.Fog;
  /** in thick fog the sky itself disappears into grey */
  private readonly fogDome: THREE.Mesh;
  private cloudTime = 0;

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
    scene.add(this.sky);

    // The reflected sky: a copy of the sky in its own scene, baked into an environment map now and then.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.skyCopy.scale.setScalar(1000);
    this.skyCopy.material.uniforms = u; // shares the live uniforms
    this.skyScene.add(this.skyCopy);
    scene.environmentIntensity = 0.8;

    this.fog = new THREE.Fog(DAY_FOG.clone(), 2500, 14000);
    scene.fog = this.fog;
    this.fogDome = new THREE.Mesh(
      new THREE.SphereGeometry(30000, 24, 12),
      new THREE.MeshBasicMaterial({ color: DAY_FOG, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.fogDome.renderOrder = -2; // before the stars, after the sky
    this.fogDome.frustumCulled = false;
    scene.add(this.fogDome);

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

  /** Call once per frame. */
  update(dt: number, camera: THREE.Camera, input: SkyInput): void {
    // Sky, stars and the fog dome sit around the camera (they must not move with the boat). The sky box
    // too: left at the origin, its far side falls behind the far plane once you are ~30 km out.
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.fogDome.position.copy(camera.position);
    const { clouds, fog, rain } = input.weather;
    const target = this.night ? 1 : 0;
    // A single bad frame time must never leave the sky broken (NaN sun → black sky shader).
    if (!Number.isFinite(this.t)) this.t = target;
    if (Number.isFinite(dt) && dt > 0) this.t += Math.sign(target - this.t) * Math.min(Math.abs(target - this.t), dt / TRANSITION);
    const n = this.t * this.t * (3 - 2 * this.t); // ease in and out
    NIGHT.value = n;
    // At night the sun sinks just below the horizon (afterglow); the dome does the darkness.
    const elevation = SUN_ELEVATION + (-1.2 - SUN_ELEVATION) * n;
    this.setSun(elevation, SUN_AZIMUTH);
    const day = 1 - n;
    const overcast = Math.max(clouds, fog * 0.8);

    // Clouds drift downwind, thicker and lower in bad weather.
    const u = this.sky.material.uniforms;
    this.cloudTime += dt * (0.4 + input.wind.speed * 0.08);
    u.time.value = this.cloudTime;
    u.cloudCoverage.value = 0.15 + 0.8 * clouds;
    u.cloudDensity.value = 0.35 + 0.6 * clouds;
    u.turbidity.value = 4 + 8 * overcast;
    u.rayleigh.value = 1.2 - 0.7 * overcast;
    u.mieCoefficient.value = 0.004 + 0.01 * fog;

    // Low sun: warmer, weaker light. Overcast: little direct sun, flatter light from the sky.
    const low = Math.min(1, Math.max(0, elevation / 20));
    this.sun.intensity = 2.6 * Math.max(0, day * day) * (1 - 0.8 * overcast) * (0.35 + 0.65 * low);
    this.sun.color.setHSL(0.08 + 0.02 * low, 0.9 - 0.4 * low, 0.6 + 0.32 * low);
    this.hemi.intensity = (0.6 - 0.15 * overcast) * day + 0.05 * n;
    this.hemi.color.set(0xcfe6ff).lerp(GREY_FOG, overcast * 0.6);
    this.moon.intensity = 0.14 * n * (1 - 0.7 * clouds);
    this.scene.environmentIntensity = (0.8 - 0.35 * overcast) * day + 0.04 * n;

    // Fog: as far as you can see; grey in bad weather, orange at dusk, black at night.
    const dusk = Math.max(0, 1 - Math.abs(elevation - 1) / 8) * (1 - overcast);
    this.fog.color.copy(DAY_FOG).lerp(GREY_FOG, overcast).lerp(DUSK_FOG, dusk * 0.6).lerp(NIGHT_FOG, n);
    this.fog.far = Math.max(250, input.visibility);
    this.fog.near = Math.min(2500, input.visibility * 0.12);
    // The dome over the sky: grey in fog and rain, deep blue as night falls (the sky shader itself
    // only knows day and black, so dusk is this dome fading in over a sky lit from just below the horizon).
    const dome = this.fogDome.material as THREE.MeshBasicMaterial;
    const fogDome = Math.min(1, Math.max(fog, rain * 0.5) * 1.15);
    const nightDome = Math.pow(n, 0.8);
    dome.opacity = Math.max(fogDome, nightDome);
    dome.color.copy(this.fog.color).lerp(NIGHT_SKY, nightDome / Math.max(dome.opacity, 1e-3));
    this.fogDome.visible = dome.opacity > 0.01;

    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, (n - 0.4) / 0.6) * (1 - clouds) * (1 - fog);
    this.stars.visible = n > 0.4 && clouds < 0.95;

    // Re-bake the reflected sky when day/night or the clouds have changed noticeably.
    this.sinceBake += dt;
    if (
      this.sinceBake > REBAKE_INTERVAL &&
      (Math.abs(elevation - this.baked.elevation) > 1.5 || Math.abs(clouds - this.baked.clouds) > 0.08)
    ) {
      this.bake();
      this.baked = { elevation, clouds };
    }
  }

  /** Keep the shadow camera centred on the player. */
  follow(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 100);
    this.moon.target.position.copy(target);
    this.moon.position.set(target.x - 40, target.y + 100, target.z + 50);
  }

  private bake(): void {
    this.sinceBake = 0;
    const map = this.pmrem.fromScene(this.skyScene, 0, 0.1, 2000, { size: 128 }).texture;
    this.envMap?.dispose();
    this.envMap = map;
    this.scene.environment = map;
  }

  private setSun(elevation: number, azimuth: number): void {
    // The sky shader goes black as soon as the sun is below the horizon, so it never sees it lower than
    // just below (the afterglow); night is the dome fading in. The shadow-casting light stays above.
    const phi = THREE.MathUtils.degToRad(90 - Math.max(elevation, -1.2));
    const theta = THREE.MathUtils.degToRad(azimuth);
    // Compass azimuth → world: east = +X, north = -Z.
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    if (this.sunDir.y < 0.05) this.sunDir.y = 0.05; // light from just above the horizon, not from below
    this.sunDir.normalize();
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
