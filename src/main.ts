import * as THREE from 'three';
import GUI from 'lil-gui';
import { SeaSound } from './audio/seaSound';
import { Boat } from './boat/boat';
import { SAILING } from './boat/sailing';
import { CameraRig } from './camera/cameraRig';
import { Input } from './core/input';
import { PerformanceGovernor } from './core/performance';
import { TouchControls } from './core/touchControls';
import { clearSavedBoat, loadBoat, saveBoat } from './core/save';
import { CoastLines } from './geo/coastLines';
import { Coastline, type CoastData } from './geo/coastline';
import { HarborData } from './harbors/harborData';
import { HarborRenderer } from './harbors/harborRenderer';
import { TrafficManager } from './traffic/trafficManager';
import { TrafficRenderer } from './traffic/trafficRenderer';
import type { Ground } from './harbors/village';
import { FlattenSites } from './terrain/flatten';
import { LocalProjection } from './geo/projection';
import { createTerrainSampler, DEFAULT_TERRAIN, type TerrainParams } from './terrain/height';
import { TerrainManager } from './terrain/terrainManager';
import { FpsCounter } from './ui/fps';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { TouchUi } from './ui/touchUi';
import { ShoreMap } from './water/shoreMap';
import { WakeTrail } from './water/wake';
import { WakeMap } from './water/wakeMap';
import { Water } from './water/water';
import { createWaveField } from './water/waves';
import { Wind } from './weather/wind';
import { Environment } from './world/environment';

// Start where the Godot game started: off Schouwen-Duiveland, Zeeland (NL).
// The world origin is fixed here; 1 unit = 1 m, +X east, -Z north.
const START = { lat: 51.7478, lon: 3.90804 };
const COAST_QUERY_RANGE = 5000;

const app = document.getElementById('app')!;
const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'Loading coastline…';
app.appendChild(loading);

const projection = new LocalProjection(START.lat, START.lon);
const COAST_URL = `${import.meta.env.BASE_URL}data/coast.json`;
const HARBORS_URL = `${import.meta.env.BASE_URL}data/harbors.json`;
const [coastData, harborData] = await Promise.all([
  fetch(COAST_URL).then((r) => r.json()) as Promise<CoastData>,
  HarborData.load(HARBORS_URL, projection),
]);
const coastline = Coastline.fromData(coastData, projection);
const flattenSites = new FlattenSites(harborData.flattenSites());
loading.remove();

// Reversed depth keeps precision at long range (water vs. seabed 10 km away). Fall back to a
// logarithmic depth buffer where EXT_clip_control is missing.
let renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true });
if (!renderer.capabilities.reversedDepthBuffer) {
  renderer.dispose();
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
}
renderer.setSize(window.innerWidth, window.innerHeight);
// Phones: 60 fps cap (many refresh at 120 Hz) and a lower pixel ratio keep them from heating up.
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
const governor = new PerformanceGovernor(
  { fpsCap: 60, maxPixelRatio: Math.min(window.devicePixelRatio, isTouchDevice ? 1.5 : 2), adaptive: true },
  (ratio) => renderer.setPixelRatio(ratio),
);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 50000);

const environment = new Environment(scene, renderer);
const input = new Input();
const wind = new Wind();

const terrainParams = { ...DEFAULT_TERRAIN };
const terrain = new TerrainManager(
  new URL(COAST_URL, location.href).href,
  new URL(HARBORS_URL, location.href).href,
  START,
  terrainParams,
);

/** The same ground the terrain workers build, for placing village houses on it. */
function groundFor(params: TerrainParams): Ground {
  const sampler = createTerrainSampler(params, flattenSites);
  const reach = Math.max(params.coastFalloff, 200);
  return {
    sd: (x, z) => coastline.signedDistance(x, z, 500),
    height: (x, z) => sampler.height(coastline.signedDistance(x, z, reach), x, z),
  };
}
const harbors = new HarborRenderer(harborData, groundFor(terrainParams));
scene.add(harbors.group);
const traffic = new TrafficManager(coastline, harborData);
const trafficRenderer = new TrafficRenderer();
scene.add(trafficRenderer.group);
scene.add(terrain.group);

// Distance-to-coast texture around the boat: calms the waves in the shallows and draws surf.
const shoreMap = new ShoreMap((x0, z0, step, res) => terrain.computeShore(x0, z0, step, res));
const waves = createWaveField(wind.direction);
waves.shore = (x, z) => shoreMap.sample(x, z);
const wake = new WakeTrail();
const wakeMap = new WakeMap();
const water = new Water(waves, shoreMap, wakeMap);
scene.add(water.mesh);

const boat = new Boat();
// Land, plus piers, pontoons, breakwaters and moored boats of nearby harbours.
boat.landDistance = (x, z) =>
  Math.max(coastline.signedDistance(x, z, 100), harbors.obstacleDistance(x, z), traffic.obstacleDistance(x, z));
scene.add(boat.object);

/** Back to the Godot start position, on a beam reach so the boat gets going right away. */
function resetBoat(): void {
  boat.position.set(0, 0, 0);
  boat.state = { ...boat.state, heading: (wind.direction + 90) % 360, speed: 0, turnSpeed: 0 };
  boat.sailUp = true;
  boat.placeInWater();
}

const saved = loadBoat();
if (saved) {
  const p = projection.toWorld(saved.lon, saved.lat);
  boat.position.set(p.x, 0, p.z);
  boat.state = { ...boat.state, heading: saved.heading };
  boat.sailUp = saved.sailUp;
  boat.placeInWater();
} else {
  resetBoat();
}

const persist = () => {
  const g = projection.toGeo(boat.position.x, boat.position.z);
  saveBoat({ lat: g.lat, lon: g.lon, heading: boat.state.heading, sailUp: boat.sailUp });
};
window.setInterval(persist, 5000);
window.addEventListener('pagehide', persist);

const coastLines = new CoastLines(coastline);
coastLines.object.visible = false;
scene.add(coastLines.object);

const rig = new CameraRig(camera, renderer.domElement);
const hud = new Hud(app);
const minimap = new Minimap(app, coastline, harborData, () => traffic.vessels);
const fps = new FpsCounter(app);
const touch = new TouchControls(renderer.domElement, () => boat.helm.position, rig);
const touchUi = new TouchUi(app, input, () => rig.nextModeKey());
const BASE = import.meta.env.BASE_URL;
const seaSound = new SeaSound({ ogg: `${BASE}sounds/sealoop.ogg`, m4a: `${BASE}sounds/sealoop.m4a` });

// Debug / tuning panel (press G to toggle).
const gui = new GUI({ title: 'Tuning' });
gui.close();
let guiVisible = true;
const windFolder = gui.addFolder('Wind');
windFolder.add(wind, 'locked').name('lock wind');
windFolder.add(wind, 'direction', 0, 360, 1).listen();
windFolder.add(wind, 'speed', 0, 25, 0.1).listen();
const waveFolder = gui.addFolder('Waves');
const waveTuning = { scale: 0.6 };
waves.amplitude = waveTuning.scale * THREE.MathUtils.clamp(wind.speed / 15, 0.15, 1);
waveFolder.add(waveTuning, 'scale', 0, 2, 0.01).name('wave scale');
waveFolder.add(water.detail, 'ripples', 0, 3, 0.05);
const boatFolder = gui.addFolder('Boat');
boatFolder.add(SAILING, 'speedMultiplier', 1, 8, 0.1).name('speed multiplier');
boatFolder.add(SAILING, 'maxSpeed', 2, 40, 0.5);
boatFolder.add(SAILING, 'turnRate', 0.05, 1.5, 0.01);
boatFolder.add(SAILING, 'maxHeel', 0, 40, 1);
const terrainFolder = gui.addFolder('Terrain');
const regenerate = () => {
  terrain.setParams({ ...terrainParams });
  harbors.setGround(groundFor({ ...terrainParams }));
};
terrainFolder.add(terrainParams, 'seed', 1, 1000, 1).onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'mountainHeight', 0, 1500, 10).name('mountain height').onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'mountainCoverage', 0, 1, 0.01).name('mountain coverage').onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'hillHeight', 0, 200, 1).name('hill height').onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'coastFalloff', 100, 3000, 10).name('coast falloff').onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'ridgeScale', 500, 8000, 50).name('ridge scale').onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'warp', 0, 3000, 10).onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'regionScale', 5000, 100000, 1000).name('region scale').onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'beachSlope', 0.005, 0.2, 0.005).name('beach slope').onFinishChange(regenerate);
terrainFolder.add(terrainParams, 'snowLine', 100, 1500, 10).name('snow line').onFinishChange(regenerate);
terrainFolder.add(terrain.material, 'wireframe');
terrainFolder.add(terrain.stats, 'meshes').listen().disable();
terrainFolder.add(terrain.stats, 'queued').listen().disable();
terrainFolder.add(terrain.stats, 'lastBuildMs').name('last build ms').listen().disable();
const perfFolder = gui.addFolder('Performance');
perfFolder.add(governor.settings, 'fpsCap', { unlimited: 0, '30 fps': 30, '60 fps': 60 }).name('fps cap');
perfFolder.add(governor.settings, 'maxPixelRatio', 0.75, 3, 0.25).name('max pixel ratio');
perfFolder.add(governor.settings, 'adaptive').name('adaptive resolution');
perfFolder.add(governor, 'pixelRatio').name('pixel ratio now').listen().disable();
const trafficFolder = gui.addFolder('Traffic');
trafficFolder.add(traffic, 'density', 0, 3, 0.1);
trafficFolder.add({ get vessels() { return traffic.vessels.length; } }, 'vessels').listen().disable();
const soundFolder = gui.addFolder('Sound');
soundFolder.add(seaSound, 'volume', 0, 2, 0.05);
soundFolder.add(seaSound, 'muted').name('muted (V)').listen();
const debugFolder = gui.addFolder('Debug');
debugFolder.add(coastLines.object, 'visible').name('coastline lines (C)').listen();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((timestamp) => {
  if (!governor.shouldRender(timestamp)) return;
  timer.update(timestamp);
  governor.frame(timer.getDelta());
  fps.frame(timer.getDelta(), governor.pixelRatio);
  const dt = Math.min(timer.getDelta(), 0.1);
  const time = timer.getElapsed();

  if (input.wasPressed('KeyG')) gui.show((guiVisible = !guiVisible));
  if (input.wasPressed('KeyC')) coastLines.object.visible = !coastLines.object.visible;
  if (input.wasPressed('KeyM')) minimap.zoom();
  if (input.wasPressed('KeyV')) seaSound.toggleMute();
  if (input.wasPressed('KeyR')) {
    clearSavedBoat();
    resetBoat();
  }

  wind.update(time);
  // Sea state follows the wind: calm below ~3 m/s, fully developed around 15 m/s.
  const seaState = THREE.MathUtils.clamp(wind.speed / 15, 0.15, 1);
  waves.amplitude += (waveTuning.scale * seaState - waves.amplitude) * (1 - Math.exp(-0.2 * dt));
  seaSound.update(seaState, camera.position.y);
  boat.update(dt, time, input, wind, waves, touch.steer);
  const fwd = boat.forward();
  wake.update(boat.position.x - fwd.x * 4.8, boat.position.z - fwd.z * 4.8, boat.state.speed);
  wakeMap.render(renderer, wake, boat.position.x, boat.position.z);
  water.setBoat(boat.position.x, boat.position.z, boat.state.heading, boat.state.speed);
  water.update(time, boat.position.x, boat.position.z);
  rig.update(dt, input, boat);
  environment.follow(boat.object.position);
  terrain.update(boat.position.x, boat.position.z);
  shoreMap.update(boat.position.x, boat.position.z);
  coastLines.update(boat.position.x, boat.position.z);
  harbors.update(dt, time, boat.position.x, boat.position.z);
  traffic.update(dt, boat.position.x, boat.position.z, wind.direction, wind.speed);
  trafficRenderer.update(traffic.vessels, waves, time, dt, boat.position.x, boat.position.z);
  minimap.update(dt, boat.position.x, boat.position.z, boat.state.heading);
  const geo = projection.toGeo(boat.position.x, boat.position.z);
  touchUi.update(boat.helm.wheelAngle, boat.sailUp, rig.mode !== 'deck', seaSound.muted);
  hud.update(boat, wind, {
    lat: geo.lat,
    lon: geo.lon,
    coastDistance: coastline.signedDistance(boat.position.x, boat.position.z, COAST_QUERY_RANGE),
    maxDistance: COAST_QUERY_RANGE,
    grounded: boat.grounded,
    nearestHarbor: harborData.nearestHarbor(boat.position.x, boat.position.z, 50000),
  });

  renderer.render(scene, camera);
  input.endFrame();
});

// Dev-only handle for poking at the scene from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __sail: { scene, camera, renderer, boat, water, waves, rig, wind, coastline, projection, terrain, shoreMap, wake, wakeMap, harbors, harborData, seaSound, traffic, trafficRenderer } });
