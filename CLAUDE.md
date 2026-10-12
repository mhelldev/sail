# Sail

Open-world sailing game: three.js + TypeScript + Vite. A re-implementation (not a port) of the Godot
project at `/Users/michael/projects/godot/boat3d`.

## Migration rules

- `godot/boat3d` (and `godot/sailboat`, an older prototype) are **read-only reference**. Never modify them.
- Take ideas, not code: re-design for the web stack instead of translating GDScript line by line.
- Out of scope for now: weather API (wind is random, `src/weather/wind.ts`).

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest unit tests (pure logic: sailing, collision, waves, shore map, geo, terrain)
- `npm run typecheck` / `npm run build`
- `npm run harbors` — re-bake `public/data/harbors.json` (committed) from Overpass: named marinas/harbours and
  lighthouses, snapped to our coast. Raw downloads are cached in `data/harbors-raw/` (gitignored); delete it to
  fetch fresh data. The game itself never queries anything (except the marina gallery photos, below).
- `npm run marinas` — re-bake `public/data/marinas/` (committed) for the marina houses: per harbour the nearest
  fitting English Wikipedia article (intro text) and up to 6 freely licensed Commons photos (metadata only).
  ~45 min for all harbours (Wikimedia allows ~200 requests/min with an identifying User-Agent); per-harbour
  results are cached in `data/marinas-raw/`, so it resumes. Run it after `npm run harbors` (ids = indices).
- `npm run geo` — regenerate `public/data/coast.json` from `boat3d/europe.geo.json` (read-only input)

## Conventions

- 1 world unit = 1 metre. World axes: +X = east, -Z = north, +Y = up.
- Headings and wind are compass degrees clockwise from north; wind direction is where it blows FROM.
- Boat model local axes: forward = -Z, starboard = +X. Positive heel/roll lowers the port side.
- Keep game logic that can be pure (no three.js) in testable modules (`boat/sailing.ts`, `water/waves.ts`).
- Geo data is stored as lon/lat and projected at load time with `geo/projection.ts` around the fixed
  start point (equirectangular; fine within ~200 km, revisit with a floating origin for long voyages).
- The renderer uses a reversed depth buffer (log depth fallback): without it the water and the seabed
  z-fight a few km away. Keep it when touching renderer setup.
- Vertex colours and shader colour constants are linear: pick colours in sRGB and convert
  (`srgbToLinear` in terrain, `pow(c, 2.2)` in GLSL), otherwise everything renders washed out.
- `water/waves.ts` (CPU) and the GLSL in `water/water.ts` implement the same Gerstner waves — change both together.

## Performance

- Keep per-pixel water work O(1): the wake is drawn into a top-down texture (`water/wakeMap.ts`) instead of
  looping over trail segments per pixel — the loop version cost ~2/3 of the frame.
- `core/performance.ts`: 60 fps cap, pixel ratio ≤ 1.5 on touch devices (≤ 2 elsewhere), adaptive
  resolution. The FPS readout at the top shows fps, frame time and the current pixel ratio.
- To measure GPU cost of a change: stop the loop, render N frames each followed by a 1-pixel
  `gl.readPixels` (forces the GPU to finish) and compare with features toggled.

## Controls

First person only (no chase/deck/top cameras); the player starts behind the wheel. There is no HTML HUD
any more apart from the crosshair and the key help line: the instruments are a screen on the boat.

- Keyboard: arrows/WASD walk, Shift run, Space jump (or climb out of the water), E sail up/down, T turbo,
  B back aboard behind the wheel, M chart range, V sound, N night, F binoculars, R back to start, G tuning panel.
- Mouse: moving it looks around at once (no click needed; a cursor resting at the left/right window edge keeps
  turning). The first click also requests pointer lock (browsers require a click), Esc releases it.
  Right button held = zoom (FOV 20°, for reading the instruments).
- F (or the touch button) raises the binoculars, F/Esc lowers them: 10× (FOV ≈ 6°), finer mouse look, a slight
  hand sway, no grabbing/clicking. Overlay in `Hud.setBinoculars`: SVG mask with two blurred overlapping circles,
  a reticle and the compass bearing of the view (`WalkMode.bearing`).
- Clicking (or tapping) the companionway door opens/closes it; clicking the chart plotter changes its range.
  The marina house doors work the same way (`MarinaHouses` adds/removes their clickables as houses are built).
  `WalkMode.clickables` (raycast, ≤ 3.8 m) — add more there; `WalkMode.draggables` for things moved by dragging
  (the throttle lever). Small targets get invisible, larger hit meshes (`MeshBasicMaterial({ visible: false })`).
- Engine (`boat/engine.ts`, pure + tested): panel on the starboard cockpit wall right of the wheel — click the key
  (ON: oil/battery lights), click START (cranks ~1 s; only in neutral), key OFF stops it. Throttle/gear lever just
  forward of it: drag up = ahead, down = astern, released near upright it snaps to neutral. Burns fuel (60 L, ~20 min
  flat out, game time), dies when dry and won't start again; refuel at a fuel berth (below) or R. Fuel is saved. In `stepSailing` the motor
  adds to the sails ahead (~6.6 kn alone), fights them astern, blows water past the rudder (steering at low speed),
  and going astern the bow swings the other way. Gauges: `ui/engineDisplay.ts` (canvas, only redrawn when near).
- Sails trim themselves (`sailTrim` at the best sheet for the wind). Pointing closer than ~32° to the wind they luff:
  they visibly flap (and are heard flapping), lose drive and the boat stands up. The instrument screen says so.
- Fuel berths: every village pier head has a pump (`Village.fuel`, parts fuelPump/fuelPanel/fuelPost/fuelSign).
  The pumps are instanced, so one invisible click target (`pumpTarget` in main.ts) follows the nearest pump; it can
  be clicked from 9 m (`Clickable.reach`). `boat/refuel.ts` (pure, tested): alongside (≤ 15 m, ≤ 0.6 m/s), key OFF,
  4 L/s until full; drifting off or turning the key stops it. Messages via `Hud.notify`.
- Wildlife: `world/gulls.ts` — one InstancedMesh (≤ 5, deliberately few): one around the boat, two per nearby harbour
  (circling over the basin, some floating on the water out to sea); the wing beat is in the vertex shader (per-gull
  phase + flap amount: glide / flap / folded). `world/seals.ts` — colonies on low beaches near the waterline, placed
  per 500 m cell from a hash (same spots every time), searched once per cell, heads lift now and then. Both ~0.04 ms.
- `audio/ambience.ts`, all synthesized (no constant wind/rigging sound — removed on request): sail slaps while luffing, halyard "tinks" within ~350 m of a harbour, gull calls
  (saw glide through a formant filter, panned to the gull's side). Tuning → Sound → "wind, gulls, rigging".
- Sounds share one AudioContext (`audio/audioHub.ts`, created on the first gesture). `audio/engineSound.ts`: the
  ignition recording plays when the key goes ON, START fades it into the engine loop (made seamless by cross-fading
  its tail into its head), louder and slightly higher with the throttle, quieter with distance. Files in
  `public/sounds/` as AAC .m4a (this ffmpeg has no Vorbis encoder; AAC decodes in all target browsers).
  `audio/doorSound.ts`: door.mp3 holds opening (start) and closing (end); each click plays its part, the close
  delayed so the slam lands when the door animation shuts.
- Marine VHF (channel 16), always on: set in the cabin (aft wall, port of the steps) and a remote unit with speaker
  on the port cockpit wall; click either to switch off/on. `radio/vhf.ts` (pure, tested) decides who speaks, run at
  2 Hz: coast guard weather (first after ~45 s, then every ~10 min, and when wind turns > 35° or changes ≥ 2 Bft),
  big ships on a collision course (CPA < 300 m within 7 min) call the yacht once, marina chatter within 6 km of a
  harbour, shore warnings, radio checks. ≥ 25 s between conversations. Vessels get deterministic names from
  their id. `audio/vhfSound.ts` speaks via the browser's speech synthesis (needs a prior user gesture; one voice
  per station, British for the coast guard). `radioVoices` skips macOS novelty voices (some sing!) and robotic
  Eloquence voices — names are localized, so the block list has German names too — and prefers natural ones;
  messages wait until the voice list is loaded (otherwise the browser's default, e.g. German, voice reads them),
  with squelch click, fluttering band-passed static and random crackle under the voice and a "kshh" tail at the end
  (speech synthesis can't be routed through Web Audio, so the noise is layered around it; Tuning → VHF static), with squelch clicks and band-passed static; out of earshot of the
  boat (60 m) transmissions are missed. Fully offline.
- Radio language: English by default, German optional (Tuning → Sound → VHF language). The brain
  decides *what happens* (facts); `Phrasebook`s in `radio/vhf.ts` say it per language (German uses real German
  radio phrases: Kommen/Ende, rechtsdrehend, Steuerbordbug…). Voices are picked for the same language.
- Steering: with the wheel under the crosshair (within ~2.6 m) click and drag; the crosshair turns into a ring
  when it can be grabbed. The mouse moves a virtual hand (2.5× gain) that is raycast onto the wheel plane in the
  boat's frame; the angle turned around the axle sets the helm. Let go, the wheel stays put (no self-centering).
  Like on a real wheel, the king spoke (red wrap + knob) is on top when the rudder is centred, and the instrument
  screen has a rudder angle indicator (±35° nominal, `RUDDER_MAX_DEG`; redrawn faster while the wheel turns).
- Touch: a virtual game pad (`ui/touchUi.ts` draws it, `person/walkMode.ts` handles the drags). Walking stick
  bottom left (it moves to wherever the thumb lands on the left half; full deflection runs; its resting spot
  always walks, even with the wheel's rim behind it), round Jump button bottom right (fires on touch-down),
  Sail/Aboard/Sound above it. Elsewhere a finger on the wheel turns it, right half = look, tap door/plotter.
  `body.touch` switches the touch UI on.
- `boat/helm.ts` still supports self-centering key steering (used by tests); the game only grips it by hand.

## Roadmap

1. ✅ Setup, sky, light, fog
2. ✅ Open sea: Gerstner waves, procedural boat, sailing mechanics, random wind, cameras, HUD
3. ✅ Geo pipeline: `scripts/preprocess-geo.ts` keeps only coastline edges (shared country-border edges
   cancel out; the source lists France twice, so duplicate rings are skipped). `geo/coastline.ts` answers
   land/water (ray crossing parity) and signed distance to coast; `sampleGrid` does a whole chunk at once.
   Minimap + coastline debug lines (C) + HUD position/coast distance.
4. ✅ Terrain: 2 km chunks within 11 km of the boat (LOD 64/32/16 cells, skirts hide LOD cracks), built by a
   worker pool (`terrain/terrain.worker.ts`). `terrain/height.ts` is a pure function of world position +
   signed coast distance: seabed → shore bank → beach → coastal falloff → hills + ridged, domain-warped
   mountains, with a large-scale "mountainousness" region mask. Tunable live in the GUI (G → Terrain).
5. ✅ Land collision + polish: `boat/collision.ts` (hull probes against the coast's signed distance: block,
   slide along the shore, depenetrate after turning, spawn in open water). `water/shoreMap.ts`: worker-built
   distance-to-coast texture around the boat → waves calm in the shallows (same damping on CPU via
   `shoreDamping`), turquoise shallows and surf foam. Boat position/heading/sail saved in localStorage
   (`core/save.ts`, R resets to start).

## Harbours, villages, lighthouses (`src/harbors/`)

- `harborData.ts`: baked list in world space + coarse grid. Entries were snapped to the Natural Earth coast at bake
  time (≤ 3 km, else dropped) with a seaward direction from the coastline; duplicates within 1 km merged.
- `village.ts`: pure, deterministic generator per harbour (pier, pontoons, moored boats, breakwaters with red/green
  lights, quay houses, streets, church, windmill, trees). Returns parts + water obstacles; tested on a fake coast.
- `harborRenderer.ts`: one `InstancedMesh` per part type for all villages within 8 km (dropped beyond 10 km),
  built one village per ~80 ms; buffers are only rewritten when the set changes. Windows are drawn by the
  building shader. Lighthouse beams/mill sails are the only per-frame updates. Measured GPU cost ≈ 0.2 ms.
- Terrain is flattened around villages/lighthouses (`terrain/flatten.ts`) in both workers and main thread;
  `groundFor()` in `main.ts` is the main-thread copy of the worker's ground for placing houses.
- Boat collision uses `max(coast distance, harbour obstacle distance)`.
- Marina houses (the harbour office at the root of every pier, `village.ts` → `Village.marinaHouse`): from afar a
  plain windowed box ('marinaHouse' part); within 350 m `marinaHouses.ts` swaps in `marinaHouseModel.ts` — name
  board over the door (lit at night), a door you click open (door.mp3, like the cabin), stone plinth and steps (the
  rendered terrain near the shore can be a metre lower than the village's ground), and inside a small gallery: six
  framed photos with museum labels (title, photographer, licence) and a poster with the Wikipedia intro and its
  attribution. Layout and walk surfaces in `marinaHouse.ts` (pure, tested; floor/ceiling/door like `boatSurfaces`;
  terrain is ignored inside the footprint). Interior materials are unlit (MeshBasic + baked shading).
- Gallery data (`marinaInfo.ts`): `public/data/marinas/<lat>_<lon>.json` per 2° cell, loaded when a house is near.
  Thumbnails (500 px) come from upload.wikimedia.org (CORS ok) and are prefetched within 3 km, kept in Cache
  Storage (`marina-gallery-v1`; needs https/localhost) so visited marinas work offline. Missing photos (nothing
  found, offline) become procedural seascape paintings; no article → a short welcome text.
- Supermarket (`Village.shop`, on the other side of the pier root, also facing the sea): from afar a 'shop' box
  with a low roof; within 350 m `MarinaHouses` (which handles both buildings, keyed `${harbourId}:office|shop`)
  swaps in `shopModel.ts` — shop windows under striped awnings, a glass door (click, door.mp3), a lit
  "SUPERMARKET" board, and inside fruit and vegetables in crates, a bread rack, a pallet of water packs, shelves of
  groceries, a checkout. Layout, furniture boxes and walk surfaces in `shop.ts` (pure, tested). All furniture and
  goods are one vertex-coloured unlit mesh (~130k vertices), written straight into typed arrays (per-item
  geometries took ~50 ms), shared by every shop and pre-built while the browser is idle.
- GPU timing is noisy (clock changes): compare with/without by alternating several batches and using medians.

## Generated traffic (`src/traffic/`)

- No real AIS data, no models: everything is generated. `trafficManager.ts` keeps ~10 yachts, 6 motorboats,
  2 ferries and 3 cargo ships around the player (scaled by the Traffic density slider), tied to the real harbour
  data: yachts/motorboats leave marinas (out and back, or marina to marina), ferries shuttle between two harbours,
  ships pass offshore entering/leaving at 15 km (inside the fog). Arrived boats wait, then go home once you're away.
- Routes: `waterPath.ts` A* on the coastline's land mask (dilated per vessel size), pulled tight into straight legs.
- `vessel.ts`: pure movement (turn-rate limited steering, slowing for turns and arrival). Yachts use the player's
  polar/boom/heel functions and motor with sails down closer than 42° to the wind instead of tacking.
- `vesselDesigns.ts`: procedural looks per type/variant (sloop, classic, ketch, catamaran; speedboat, cruiser,
  trawler; ferry; container ship, tanker, bulk carrier) as shapes in the vessel frame (+Z bow, +X port).
- `trafficRenderer.ts`: one InstancedMesh per shape type; per frame vessel pose (waves, heel) × part placement.
  Vessels are solid for the player (oriented boxes in `boat.landDistance`). Measured: ~0.1 ms CPU, no visible GPU cost.

## Night and weather (`src/world/environment.ts`, `src/weather/`)

- The sky box, stars and fog dome are re-centred on the camera every frame (a sky box left at the origin loses
  its far side behind the far plane once you are ~30 km out).
- Day by default; night mode (Tuning → Environment, or N) fades in over 3 s: `NIGHT.value` (0 day … 1 night) is the
  single source for shaders and lights. The sky shader only knows day and black, so at night the sun sinks just
  below the horizon (−1.2°, afterglow) and a dome around the camera (`fogDome`) fades in deep blue; stars on top.
- `Weather` (pure, tested): clouds, rain, fog, gusts 0 … 1 drifting towards a type (clear, cloudy, rain, fog — only
  in light wind — storm — only in strong wind); auto changes every 4–10 min, or fixed from Tuning. Effects: sky
  cloud cover/density/turbidity, dimmer and flatter light, fog distance = visibility (the dome turns grey), wind
  factor in storms, gust events in `Wind`, rain streaks around the camera (`world/rain.ts`, all in the vertex
  shader, one draw call), drops running down the cabin windows (`rainyGlass`), rain hiss / drumming on the cabin
  roof (ambience), rougher water, barometer, and the VHF weather report (rain, gusts, visibility/fog). The
  reflected sky (PMREM, 128 px) is re-baked every ≥ 4 s when night or clouds changed.
- Lights at night: additive `Points` with constant screen size (`lightPointsMaterial`): navigation lights, harbour
  lights, street lamps, lighthouses; windows glow from the building shader (`uNight`).

## The yacht (`src/boat/`)

- `layout.ts` is the single source for the boat's shape (pure): ~12 m hull lines, deckhouse with the cabin below
  (floor just above the waterline, settees, table), windows (sides and front), companionway (door + sliding hatch,
  three steps), lowered cockpit with side benches and the wheel, with ~1.6 m of free floor behind the wheel, railing with a gate at the stern, instrument panel position. `boatSurfaces(x, z,
  doorOpen)` returns what can be stood on / bumped into there (with `bottom` for roofs) — the model and the walking
  physics both use it, so change them together through `layout.ts`.
- `cabinProps.ts`: what's lying around below deck — chart (canvas texture with course and compass rose), dividers,
  pencil, coffee mugs, a letter, lunch, fruit bowl, bookshelves (books share one vertex-coloured material), radio,
  plant, ship in a bottle, binoculars, lantern, rug, a clock showing the real time and a barometer following the
  wind (both small canvases redrawn once a second), and a lifebuoy on the stern rail. Deterministic (seeded).
- `model.ts` merges static parts per material (`parts.ts`; `Parts.wall` cuts window openings), so the boat stays
  at a few dozen draw calls. Window panes are one transparent mesh that casts no shadow. The cabin has its own
  slightly emissive materials (no extra light: a point light would cost on every lit fragment in the scene).
  The water shader discards the sea inside the hull's footprint, otherwise it shows through the cabin floor.
- `ui/instrumentPanel.ts` draws chart plotter (`ui/minimap.ts`, now an offscreen chart), wind dial, speed/heading
  and sail trim into one 1024×716 canvas texture, redrawn 5×/s and only while the player is near the boat.

## First person (`src/person/`)

- `personController.ts` is pure: it only asks a `WalkWorld` for surfaces at a point (tops, optional `bottom`,
  boat or not) and the water level. Slopes up to `maxSlope` (1.1) can be walked up; ledges > 5 cm need a jump,
  so stairs you should walk up are modelled as ramps (see the marina house steps). Surfaces higher than a step block (walls, hull sides, railing) unless their
  bottom is above the head (roofs); jumping bumps the head on them. The body has a 0.25 m radius so the camera
  (near plane 0.1) stays off walls. Jump ~1.1 m: enough for the railing and the cabin roof.
  Water below the feet → swimming; Space while swimming climbs onto something within reach in front.
- `walkMode.ts` builds the world: terrain height straight from the rendered chunk triangles
  (`TerrainManager.heightAt`), village walk boxes (`HarborRenderer.surfacesAt`: pier, pontoons, breakwater
  crest, buildings), the boat via its matrix (`boatSurfaces` in `boat/layout.ts`).
- The boat is a moving platform: while standing on it (or airborne after leaving it) the person is carried
  with the boat's matrix delta, so jumps on deck land on deck. The boat sails on with the helm where it was left.
- Water, terrain, shore map, harbours and traffic are centred on the player (`walk.position`), not the boat,
  so walking ashore or swimming away keeps the world built around you. Minimap and HUD still show the boat.

## Ideas for later

- Higher-resolution coastline (OSM land polygons) — only `public/data/coast.json` needs to change
- Floating origin for voyages far beyond ~200 km from the start
- Harbors, other vessels, real weather (deliberately out of scope so far)
