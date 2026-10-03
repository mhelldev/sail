import * as THREE from 'three';
import GUI from 'lil-gui';
import { Boat } from './boat/boat';
import { SAILING } from './boat/sailing';
import { CameraRig } from './camera/cameraRig';
import { Input } from './core/input';
import { CoastLines } from './geo/coastLines';
import { Coastline, type CoastData } from './geo/coastline';
import { LocalProjection } from './geo/projection';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
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
const coastData = (await fetch('/data/coast.json').then((r) => r.json())) as CoastData;
const coastline = Coastline.fromData(coastData, projection);
loading.remove();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 50000);

const environment = new Environment(scene, renderer);
const input = new Input();
const wind = new Wind();
const waves = createWaveField(wind.direction);
const water = new Water(waves);
scene.add(water.mesh);

// Start on a beam reach so the boat gets going right away.
const boat = new Boat((wind.direction + 90) % 360);
scene.add(boat.object);

const coastLines = new CoastLines(coastline);
scene.add(coastLines.object);

const rig = new CameraRig(camera, renderer.domElement);
const hud = new Hud(app);
const minimap = new Minimap(app, coastline);

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
const boatFolder = gui.addFolder('Boat');
boatFolder.add(SAILING, 'maxSpeed', 2, 40, 0.5);
boatFolder.add(SAILING, 'turnRate', 0.05, 1.5, 0.01);
boatFolder.add(SAILING, 'maxHeel', 0, 40, 1);
const debugFolder = gui.addFolder('Debug');
debugFolder.add(coastLines.object, 'visible').name('coastline lines (C)').listen();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  const time = timer.getElapsed();

  if (input.wasPressed('KeyG')) gui.show((guiVisible = !guiVisible));
  if (input.wasPressed('KeyC')) coastLines.object.visible = !coastLines.object.visible;
  if (input.wasPressed('KeyM')) minimap.zoom();

  wind.update(time);
  // Sea state follows the wind: calm below ~3 m/s, fully developed around 15 m/s.
  const seaState = THREE.MathUtils.clamp(wind.speed / 15, 0.15, 1);
  waves.amplitude += (waveTuning.scale * seaState - waves.amplitude) * (1 - Math.exp(-0.2 * dt));
  boat.update(dt, time, input, wind, waves);
  water.update(time, boat.position.x, boat.position.z);
  rig.update(dt, input, boat);
  environment.follow(boat.object.position);
  coastLines.update(boat.position.x, boat.position.z);
  minimap.update(dt, boat.position.x, boat.position.z, boat.state.heading);
  const geo = projection.toGeo(boat.position.x, boat.position.z);
  hud.update(boat, wind, {
    lat: geo.lat,
    lon: geo.lon,
    coastDistance: coastline.signedDistance(boat.position.x, boat.position.z, COAST_QUERY_RANGE),
    maxDistance: COAST_QUERY_RANGE,
  });

  renderer.render(scene, camera);
  input.endFrame();
});

// Dev-only handle for poking at the scene from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __sail: { scene, camera, renderer, boat, water, waves, rig, wind, coastline, projection } });
