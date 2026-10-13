import * as THREE from 'three';
import GUI from 'lil-gui';
import { Ambience } from './audio/ambience';
import { DoorSound } from './audio/doorSound';
import { EngineSound } from './audio/engineSound';
import { VhfSound } from './audio/vhfSound';
import { VhfBrain, type RadioLanguage } from './radio/vhf';
import { VhfDisplay } from './ui/vhfDisplay';
import { SeaSound } from './audio/seaSound';
import { Boat } from './boat/boat';
import { Refuelling, type RefuelProblem } from './boat/refuel';
import { SAILING } from './boat/sailing';
import { Input } from './core/input';
import { PerformanceGovernor } from './core/performance';
import { clearSavedBoat, loadBoat, loadPlayer, saveBoat, savePlayer } from './core/save';
import { ECONOMY, Economy, euros, PRODUCTS, type ProductId } from './economy/economy';
import { Pantry } from './boat/pantry';
import { CoastLines } from './geo/coastLines';
import { Coastline, type CoastData } from './geo/coastline';
import { HarborData } from './harbors/harborData';
import { HarborRenderer } from './harbors/harborRenderer';
import { MarinaHouses } from './harbors/marinaHouses';
import { MarinaInfoStore } from './harbors/marinaInfo';
import { WalkMode } from './person/walkMode';
import { TrafficManager } from './traffic/trafficManager';
import { TrafficRenderer } from './traffic/trafficRenderer';
import type { Ground } from './harbors/village';
import { FlattenSites } from './terrain/flatten';
import { LocalProjection } from './geo/projection';
import { createTerrainSampler, DEFAULT_TERRAIN, type TerrainParams } from './terrain/height';
import { TerrainManager } from './terrain/terrainManager';
import { FpsCounter } from './ui/fps';
import { Hud } from './ui/hud';
import { EngineDisplay } from './ui/engineDisplay';
import { InstrumentPanel } from './ui/instrumentPanel';
import { Minimap } from './ui/minimap';
import { TouchUi } from './ui/touchUi';
import { ShoreMap } from './water/shoreMap';
import { WakeTrail } from './water/wake';
import { WakeMap } from './water/wakeMap';
import { Water } from './water/water';
import { createWaveField } from './water/waves';
import { Wind } from './weather/wind';
import { Environment } from './world/environment';
import { NIGHT } from './world/night';
import { Rain, rainyGlass } from './world/rain';
import { Weather, type WeatherMode } from './weather/weather';
import { Gulls } from './world/gulls';
import { Seals } from './world/seals';
import { CABIN } from './boat/layout';

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
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 50000);

const environment = new Environment(scene, renderer);
const input = new Input();
const wind = new Wind();
// The weather (changes by itself, or set in Tuning).
const weather = new Weather();
const rain = new Rain();
scene.add(rain.mesh);

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
// Wildlife: gulls over the harbours and around the boat, seals on the beaches.
const gulls = new Gulls();
scene.add(gulls.mesh);
const seals = new Seals(groundFor(terrainParams));
scene.add(seals.group);
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
  boat.helm.position = 0;
  boat.sailUp = true;

  // Back at the start: engine off, lever in neutral, tank full.
  if (boat.engine.ignition) boat.engine.toggleKey();
  boat.engine.setLever(0);
  boat.engine.refuel();
  boat.placeInWater();
}

const saved = loadBoat();
if (saved) {
  const p = projection.toWorld(saved.lon, saved.lat);
  boat.position.set(p.x, 0, p.z);
  boat.state = { ...boat.state, heading: saved.heading };
  boat.sailUp = saved.sailUp;
  if (saved.fuel !== undefined) boat.engine.fuel = saved.fuel;
  boat.placeInWater();
} else {
  resetBoat();
}

// Money, hunger, thirst and the food on board (saved like the boat).
const economy = new Economy();
const savedPlayer = loadPlayer();
if (savedPlayer) economy.state = savedPlayer;

const persist = () => {
  const g = projection.toGeo(boat.position.x, boat.position.z);
  saveBoat({ lat: g.lat, lon: g.lon, heading: boat.state.heading, sailUp: boat.sailUp, fuel: boat.engine.fuel });
  savePlayer(economy.state);
};
window.setInterval(persist, 5000);
window.addEventListener('pagehide', persist);

const coastLines = new CoastLines(coastline);
coastLines.object.visible = false;
scene.add(coastLines.object);

// First person only: the player starts behind the wheel.
const walk = new WalkMode(camera, renderer.domElement, boat, waves, terrain, harbors, {
  surfacesAt: (x, z) => marinaHouses.surfacesAt(x, z),
  coversGround: (x, z) => marinaHouses.coversGround(x, z),
});
walk.enter();
// Marina houses: walk in through the door (same sound as the cabin door), a gallery of photos of the
// place and a poster about it inside (baked by scripts/bake-marinas.ts, photos fetched when near).
const marinaHouses = new MarinaHouses(
  harbors,
  new MarinaInfoStore(`${import.meta.env.BASE_URL}data/marinas/`),
  walk.clickables,
  (opening) => doorSound.play(opening, seaSound.muted),
  () => walk.person,
  (product) => buy(product),
);
scene.add(marinaHouses.group);
walk.clickables.push(
  {
    object: boat.model.door,
    onClick: () => {
      boat.model.doorOpen = !boat.model.doorOpen;
      doorSound.play(boat.model.doorOpen, seaSound.muted);
    },
  },
  { object: boat.model.panel, onClick: () => minimap.zoom() },
  // Engine: key ON/OFF, START (only with the key on and the lever in neutral).
  { object: boat.model.key, onClick: () => boat.engine.toggleKey() },
  { object: boat.model.startButton, onClick: () => boat.engine.pressStart() },
  { object: boat.model.vhf, onClick: () => vhfSound.togglePower() },
  { object: boat.model.vhfRemote, onClick: () => vhfSound.togglePower() },
);
// The pantry shelf in the cabin: what was bought ashore lies there; click it to eat or drink it.
const pantry = new Pantry(boat.model.tilt);
boat.model.interior.push(pantry.material);
pantry.show(economy.pantry);
pantry.targets.forEach((target, slot) =>
  walk.clickables.push({
    object: target,
    onClick: () => {
      const id = economy.consume(slot);
      if (!id) return;
      pantry.show(economy.pantry);
      const p = PRODUCTS[id];
      const drinking = p.drink > p.food;
      hud.notify(drinking ? `You drink the ${p.name.toLowerCase()}` : `You eat the ${p.name.toLowerCase()}`, 2);
      if (drinking) ambience.drink();
      else ambience.eat();
    },
  }),
);
/** A product in a supermarket was clicked: pay, and it goes into the pantry on the boat. */
function buy(id: ProductId): void {
  const p = PRODUCTS[id];
  const result = economy.buy(id);
  if (result === 'ok') {
    pantry.show(economy.pantry);
    hud.notify(`${p.name} — ${euros(p.price)}. It's in the pantry on your boat.`);
    ambience.till();
  } else if (result === 'no money') {
    hud.notify(`Not enough money for ${p.name.toLowerCase()} (${euros(p.price)})`);
  } else {
    hud.notify('The pantry on your boat is full — eat something first');
  }
}

// Throttle/gear lever: drag up (push forward) for ahead, down for astern; let go near upright and
// it clicks into neutral.
walk.draggables.push({
  object: boat.model.lever,
  onDrag: (dy) => boat.engine.setLever(boat.engine.lever - dy * 0.006),
  onRelease: () => {
    if (boat.engine.inNeutral) boat.engine.setLever(0);
  },
});
// Fuel berth: the pump at the nearest pier head gets an invisible click target (the pumps themselves
// are instanced). Click it alongside, stopped, with the engine off.
const refuelling = new Refuelling();
const pumpTarget = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.9, 1.2).translate(0, 0.95, 0), new THREE.MeshBasicMaterial({ visible: false }));
pumpTarget.visible = false;
scene.add(pumpTarget);
// The fuel price on a board on top of the nearest pump (the pumps are instanced, so one board follows).
const priceBoard = createPriceBoard();
priceBoard.visible = false;
scene.add(priceBoard);
const REFUEL_NOTES: Record<RefuelProblem, string> = {
  'too far': 'Bring the boat alongside the fuel berth first',
  moving: 'Stop the boat alongside first',
  'engine running': 'Switch the engine off before refuelling',
  full: 'The tank is full',
};
const berth = () => {
  const d = Math.hypot(boat.position.x - pumpTarget.position.x, boat.position.z - pumpTarget.position.z);
  return { distance: d, speed: boat.state.speed };
};
walk.clickables.push({
  object: pumpTarget,
  reach: 9, // the hose reaches across from the cockpit
  onClick: () => {
    if (!refuelling.active && economy.money < 0.01) {
      hud.notify(`No money for fuel (${euros(ECONOMY.fuelPrice)} per litre)`);
      return;
    }
    const was = refuelling.active;
    const problem = refuelling.toggle(boat.engine, berth());
    hud.notify(problem ? REFUEL_NOTES[problem] : was ? 'Refuelling stopped' : 'Refuelling…');
  },
});
const glassRain = { value: 0 };
const glassTime = { value: 0 };
rainyGlass(boat.model.windowGlass, glassRain, glassTime);
const engineDisplay = new EngineDisplay();
boat.model.engineScreen.material = engineDisplay.material;
const hud = new Hud(app);
const minimap = new Minimap(coastline, harborData, () => traffic.vessels, 600);
// The instruments (chart plotter, wind, log) are a screen on the boat, next to the companionway door.
const instruments = new InstrumentPanel(minimap);
boat.model.panel.material = instruments.material;
const fps = new FpsCounter(app);
const touchUi = new TouchUi(app, input);
const BASE = import.meta.env.BASE_URL;
const seaSound = new SeaSound({ ogg: `${BASE}sounds/sealoop.ogg`, m4a: `${BASE}sounds/sealoop.m4a` });
const ambience = new Ambience();
const doorSound = new DoorSound(`${BASE}sounds/door.mp3`);
// Marine VHF on channel 16: always on (click the set or the cockpit unit to switch it off).
const vhfBrain = new VhfBrain();
const vhfSound = new VhfSound();
const vhfDisplay = new VhfDisplay();
// Radio language: English, like international marine radio (German available in Tuning → Sound).
const radio = { language: 'en' as RadioLanguage };
const setRadioLanguage = (lang: RadioLanguage) => {
  vhfBrain.language = lang;
  vhfSound.language = lang;
};
setRadioLanguage(radio.language);
for (const screen of boat.model.vhfScreens) screen.material = vhfDisplay.material;
const engineSound = new EngineSound({ ignition: `${BASE}sounds/ignition.m4a`, engine: `${BASE}sounds/engine.m4a` });

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
  seals.setGround(groundFor({ ...terrainParams }));
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
const playerFolder = gui.addFolder('Player');
playerFolder.add(economy, 'money', 0, 2000, 0.01).name('money €').listen();
playerFolder.add(economy, 'hunger', 0, 100, 1).name('food (100 = full)').listen();
playerFolder.add(economy, 'thirst', 0, 100, 1).name('drink (100 = full)').listen();
playerFolder
  .add(
    {
      'start over': () => {
        economy.state = new Economy().state;
        pantry.show(economy.pantry);
      },
    },
    'start over',
  )
  .name('reset money, food and pantry');
const environmentFolder = gui.addFolder('Environment');
environmentFolder.add(environment, 'night').name('night (N)').listen();
environmentFolder
  .add(weather, 'mode', ['auto', 'clear', 'cloudy', 'rain', 'fog', 'storm'] satisfies WeatherMode[])
  .name('weather');
const soundFolder = gui.addFolder('Sound');
soundFolder.add(seaSound, 'volume', 0, 2, 0.05).name('sea volume');
soundFolder.add(ambience, 'volume', 0, 2, 0.05).name('wind, gulls, rigging');
soundFolder.add(engineSound, 'volume', 0, 2, 0.05).name('engine volume');
soundFolder.add(vhfSound, 'volume', 0, 2, 0.05).name('VHF volume');
soundFolder.add(vhfSound, 'staticLevel', 0, 2, 0.05).name('VHF static');
soundFolder.add(radio, 'language', { Deutsch: 'de', English: 'en' }).name('VHF language').onChange(setRadioLanguage);
soundFolder.add(seaSound, 'muted').name('muted (V)').listen();
const debugFolder = gui.addFolder('Debug');
debugFolder.add(coastLines.object, 'visible').name('coastline lines (C)').listen();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
function frame(timestamp: number): void {
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
  if (input.wasPressed('KeyN')) environment.night = !environment.night;
  if (input.wasPressed('KeyE')) boat.sailUp = !boat.sailUp;
  // F: binoculars up / down (Esc also puts them down).
  if (input.wasPressed('KeyF')) walk.binoculars = !walk.binoculars;
  if (input.wasPressed('Escape')) walk.binoculars = false;
  if (input.wasPressed('KeyT')) boat.turbo = !boat.turbo;
  if (input.wasPressed('KeyR')) {
    clearSavedBoat();
    resetBoat();
    walk.enter();
  }

  weather.update(dt, wind.speed);
  wind.gustiness = weather.state.gusts;
  wind.weatherFactor = weather.windFactor;
  wind.update(time);
  // Sea state follows the wind: calm below ~3 m/s, fully developed around 15 m/s.
  const seaState = THREE.MathUtils.clamp(wind.speed / 15, 0.15, 1);
  waves.amplitude += (waveTuning.scale * seaState - waves.amplitude) * (1 - Math.exp(-0.2 * dt));
  seaSound.update(seaState, camera.position.y);
  boat.update(dt, time, wind, waves, walk.steer);
  // B: back aboard, behind the wheel (after a swim or a walk ashore). After the boat update, so
  // the person lands on this frame's deck.
  if (input.wasPressed('KeyB')) walk.enter();
  const fwd = boat.forward();
  wake.update(boat.position.x - fwd.x * 5.8, boat.position.z - fwd.z * 5.8, Math.abs(boat.state.speed));
  wakeMap.render(renderer, wake, boat.position.x, boat.position.z);
  water.setBoat(boat.position.x, boat.position.z, boat.state.heading, boat.state.speed);
  walk.update(dt, time, input);
  updateNeeds(dt);
  hud.setHand(walk.holding ? 'grip' : walk.canGrab ? 'open' : 'none');
  hud.setBinoculars(walk.binoculars, walk.bearing);
  // The world is built around the player, who may have walked or swum away from the boat.
  const me = walk.position;
  water.update(time, me.x, me.z);
  environment.update(dt, camera, {
    weather: weather.state,
    visibility: weather.visibility,
    time,
    wind: { direction: wind.direction, speed: wind.speed },
  });
  // Rain: falling around you, roughening the water, running down the cabin windows.
  const windTo = THREE.MathUtils.degToRad(wind.direction + 180);
  rain.update(time, camera, weather.state.rain, Math.sin(windTo) * wind.speed, -Math.cos(windTo) * wind.speed, NIGHT.value);
  water.rain = weather.state.rain;
  glassRain.value = weather.state.rain;
  glassTime.value = time;
  boat.model.barometer = wind.speed + weather.state.rain * 8;
  environment.follow(me);
  terrain.update(me.x, me.z);
  shoreMap.update(me.x, me.z);
  coastLines.update(me.x, me.z);
  harbors.update(dt, time, me.x, me.z);
  marinaHouses.update(dt, me.x, me.z, NIGHT.value);
  traffic.update(dt, me.x, me.z, wind.direction, wind.speed);
  trafficRenderer.update(traffic.vessels, waves, time, dt, me.x, me.z);
  const geo = projection.toGeo(boat.position.x, boat.position.z);
  touchUi.update(boat.sailUp, seaSound.muted, walk.stick);
  instruments.update(
    dt,
    boat,
    wind,
    () => ({
      lat: geo.lat,
      lon: geo.lon,
      coastDistance: coastline.signedDistance(boat.position.x, boat.position.z, COAST_QUERY_RANGE),
      maxDistance: COAST_QUERY_RANGE,
      grounded: boat.grounded,
      nearestHarbor: harborData.nearestHarbor(boat.position.x, boat.position.z, 50000),
    }),
    camera.position.distanceTo(boat.position) < 60,
  );
  engineDisplay.update(dt, boat.engine, camera.position.distanceTo(boat.position) < 30);
  engineSound.update(boat.engine, camera.position.distanceTo(boat.object.position), seaSound.muted);
  updateVhf(dt);
  updateFuelBerth(dt);
  updateWildlife(dt, time);


  renderer.render(scene, camera);
  input.endFrame();
}
renderer.setAnimationLoop(frame);

/** Hunger and thirst grow with time; the HUD shows them and the money, and warns when it gets low. */
let weakness = 0;
let warned = { hunger: 2, thirst: 2 }; // 2 = fine, 1 = told "low", 0 = told "empty"
function updateNeeds(dt: number): void {
  economy.update(dt);
  walk.exhausted = economy.starving;
  // At zero the view closes in over about a minute (more with both empty); it clears when you've eaten.
  const both = economy.hunger <= 0 && economy.thirst <= 0;
  const target = economy.starving ? (both ? 1 : 0.7) : 0;
  weakness = target > weakness ? Math.min(target, weakness + dt / 60) : Math.max(target, weakness - dt / 4);
  hud.setWeakness(weakness);
  hud.setStatus(euros(economy.money), economy.hunger, economy.thirst, ECONOMY.low);
  for (const [key, value, low, empty] of [
    ['hunger', economy.hunger, "You're getting hungry — there's food in the village supermarkets", "You're starving: too weak to run. Eat something!"],
    ['thirst', economy.thirst, "You're getting thirsty — buy something to drink", "You're parched: too weak to run. Drink something!"],
  ] as const) {
    const level = value <= 0 ? 0 : value <= ECONOMY.low ? 1 : 2;
    if (level < warned[key]) hud.notify(level === 0 ? empty : low, 5);
    warned = { ...warned, [key]: level };
  }
}

/** Gulls, seals and the sounds around the boat: wind in the rigging, flapping sails, halyards, gull calls. */
const local = new THREE.Vector3();
const toGull = new THREE.Vector3();
const camRight = new THREE.Vector3();
function updateWildlife(dt: number, time: number): void {
  const me = walk.position;
  const anchors = harborData.harbors
    .near(me.x, me.z, 2500)
    .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))
    .slice(0, 3);
  gulls.update(dt, time, boat.position, anchors, waves);
  seals.update(time, me.x, me.z);

  // In the cabin? (person in the boat's frame: within the deckhouse, below the roof)
  local.copy(me);
  boat.model.tilt.worldToLocal(local);
  const inside = Math.abs(local.x) < CABIN.halfWidth && local.z > CABIN.front && local.z < CABIN.back && local.y < CABIN.roofBottom;
  const nearest = harborData.nearestHarbor(me.x, me.z, 2000);
  ambience.update({
    windSpeed: wind.speed,
    boatDistance: camera.position.distanceTo(boat.object.position),
    inside,
    luff: boat.sailUp ? Math.max(boat.state.luffMain, boat.state.luffJib) : 0,
    harbourDistance: nearest?.distance ?? Infinity,
    rain: weather.state.rain,
    muted: seaSound.muted,
  });
  // Now and then a gull nearby calls; it's heard from where it is.
  const near = gulls.near(me.x, me.z, 220);
  if (near.length && Math.random() < dt * 0.06) {
    const g = near[Math.floor(Math.random() * near.length)];
    toGull.set(g.x - camera.position.x, g.y - camera.position.y, g.z - camera.position.z);
    const d = toGull.length();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    ambience.gullCall(toGull.normalize().dot(camRight), (inside ? 0.3 : 1) / (1 + d / 45));
  }
}

let fuelBill = 0; // euros paid for the current fill

/** "DIESEL € 1.95 /L" on both faces, base at y = 0, faces along local ±Z (out to sea and to the shore). */
function createPriceBoard(): THREE.Group {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 144;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 256, 144);
  g.fillStyle = '#1c1c1c';
  g.fillRect(8, 8, 240, 128);
  g.fillStyle = '#f2c230';
  g.textAlign = 'center';
  g.font = `800 34px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  g.fillText('DIESEL', 128, 48);
  g.fillStyle = '#ff9d2e';
  g.font = `700 50px 'Courier New', monospace`;
  g.fillText(ECONOMY.fuelPrice.toFixed(2), 112, 110);
  g.font = `700 22px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  g.fillText('€/L', 210, 108);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: texture });
  const group = new THREE.Group();
  const w = 0.7;
  const h = 0.4;
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: 0x2b2f33 })));
  group.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.04).translate(0, 0.3 + h / 2, 0), new THREE.MeshStandardMaterial({ color: 0x2b2f33 })));
  for (const side of [1, -1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face);
    plane.position.set(0, 0.3 + h / 2, side * 0.021);
    if (side < 0) plane.rotation.y = Math.PI;
    group.add(plane);
  }
  return group;
}

/** Moves the pump's click target to the nearest pier head and runs the refuelling (and the bill). */
function updateFuelBerth(dt: number): void {
  const pump = harbors.nearestFuelPump(walk.position.x, walk.position.z, 60);
  pumpTarget.visible = !!pump;
  if (pump) pumpTarget.position.set(pump.x, pump.y, pump.z);
  const board = harbors.nearestFuelPump(walk.position.x, walk.position.z, 400);
  priceBoard.visible = !!board;
  if (board) {
    priceBoard.position.set(board.x, board.y + 1.5, board.z);
    priceBoard.rotation.y = board.rotY;
  }
  if (!refuelling.active) return;
  const before = boat.engine.fuel;
  const result = refuelling.update(dt, boat.engine, berth());
  // Pay for what flowed in; when the money runs out, so does the diesel.
  const litres = boat.engine.fuel - before;
  const paid = economy.pay(litres * ECONOMY.fuelPrice);
  fuelBill += paid;
  if (paid < litres * ECONOMY.fuelPrice - 1e-6) {
    boat.engine.fuel = before + paid / ECONOMY.fuelPrice;
    refuelling.active = false;
    hud.notify(`Out of money — ${Math.round(boat.engine.fuel)} L in the tank (paid ${euros(fuelBill)})`);
    fuelBill = 0;
    return;
  }
  if (result === 'done') hud.notify(`Tank full — ${Math.round(boat.engine.fuel)} L, paid ${euros(fuelBill)}`);
  else if (result) hud.notify(`Refuelling stopped: ${REFUEL_NOTES[result as RefuelProblem].toLowerCase()} (paid ${euros(fuelBill)})`);
  else hud.notify(`Refuelling… ${Math.round(boat.engine.fuel)} L · ${euros(fuelBill)}`, 1);
  if (result) fuelBill = 0;
}

/** The VHF listens to what happens around the boat; the brain decides who speaks (twice a second). */
let vhfThink = 0;
function updateVhf(dt: number): void {
  vhfThink += dt;
  if (vhfThink >= 0.5) {
    const near = harborData.nearestHarbor(boat.position.x, boat.position.z, 8000);
    const said = vhfBrain.update(vhfThink, {
      wind: { direction: wind.direction, speed: wind.speed },
      boat: { x: boat.position.x, z: boat.position.z, heading: boat.state.heading, speed: Math.abs(boat.state.speed), sailUp: boat.sailUp, grounded: boat.grounded },
      coastDistance: coastline.signedDistance(boat.position.x, boat.position.z, 500),
      harbor: near && { name: near.harbor.name, distance: near.distance, isHarbour: near.harbor.isHarbour },
      vessels: traffic.vessels,
      weather: { ...weather.state, visibility: weather.visibility },
    });
    vhfThink = 0;
    if (said.length && vhfSound.power) vhfSound.receive(said);
  }
  vhfSound.update(camera.position.distanceTo(boat.object.position), seaSound.muted);
  vhfDisplay.update(vhfSound.power, vhfSound.receiving);
}

// Dev-only handle for poking at the scene from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __sail: { scene, camera, renderer, boat, water, waves, wind, coastline, projection, terrain, shoreMap, wake, wakeMap, harbors, harborData, marinaHouses, seaSound, engineSound, gulls, seals, ambience, vhfBrain, vhfSound, traffic, trafficRenderer, economy, pantry, environment, weather, walk, input, frame } });
