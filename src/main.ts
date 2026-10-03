import * as THREE from 'three';
import GUI from 'lil-gui';
import { Boat } from './boat/boat';
import { SAILING } from './boat/sailing';
import { CameraRig } from './camera/cameraRig';
import { Input } from './core/input';
import { Hud } from './ui/hud';
import { Water } from './water/water';
import { createWaveField } from './water/waves';
import { Wind } from './weather/wind';
import { Environment } from './world/environment';

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

const rig = new CameraRig(camera, renderer.domElement);
const hud = new Hud(app);

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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;

  if (input.wasPressed('KeyG')) gui.show((guiVisible = !guiVisible));

  wind.update(time);
  // Sea state follows the wind: calm below ~3 m/s, fully developed around 15 m/s.
  const seaState = THREE.MathUtils.clamp(wind.speed / 15, 0.15, 1);
  waves.amplitude += (waveTuning.scale * seaState - waves.amplitude) * (1 - Math.exp(-0.2 * dt));
  boat.update(dt, time, input, wind, waves);
  water.update(time, boat.position.x, boat.position.z);
  rig.update(dt, input, boat);
  environment.follow(boat.object.position);
  hud.update(boat, wind);

  renderer.render(scene, camera);
  input.endFrame();
});
