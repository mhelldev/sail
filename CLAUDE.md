# Sail

Open-world sailing game: three.js + TypeScript + Vite. A re-implementation (not a port) of the Godot
project at `/Users/michael/projects/godot/boat3d`.

## Migration rules

- `godot/boat3d` (and `godot/sailboat`, an older prototype) are **read-only reference**. Never modify them.
- Take ideas, not code: re-design for the web stack instead of translating GDScript line by line.
- Out of scope for now: weather API (wind is random, `src/weather/wind.ts`), wikidata images.

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest unit tests (pure logic: sailing, collision, waves, shore map, geo, terrain)
- `npm run typecheck` / `npm run build`
- `npm run harbors` — re-bake `public/data/harbors.json` (committed) from Overpass: named marinas/harbours and
  lighthouses, snapped to our coast. Raw downloads are cached in `data/harbors-raw/` (gitignored); delete it to
  fetch fresh data. The game itself never queries anything.
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
  B back aboard behind the wheel, M chart range, V sound, N night, R back to start, G tuning panel.
- Mouse: moving it looks around at once (no click needed; a cursor resting at the left/right window edge keeps
  turning). The first click also requests pointer lock (browsers require a click), Esc releases it.
  Right button held = zoom (FOV 20°, for reading the instruments).
- Clicking (or tapping) the companionway door opens/closes it; clicking the chart plotter changes its range.
  `WalkMode.clickables` (raycast, ≤ 3.8 m) — add more there.
- Steering: with the wheel under the crosshair (within ~2.6 m) click and drag; the crosshair turns into a ring
  when it can be grabbed. The mouse moves a virtual hand (2.5× gain) that is raycast onto the wheel plane in the
  boat's frame; the angle turned around the axle sets the helm. Let go, the wheel stays put (no self-centering).
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

## Night mode

- `world/night.ts` `NIGHT.value` (0 day … 1 night) is the single source: `Environment.update` eases it over 3 s
  when `environment.night` changes (Tuning → Environment, or N). Default is day.
- The sun sinks to −12° so the Sky shader itself goes dark; stars (Points around the camera), faint moonlight,
  dimmed environment map, night fog colour.
- Lights are additive `Points` with constant screen size (`lightPointsMaterial`), so they stay visible far away:
  vessel/boat navigation lights, harbour lights, quay street lamps, lighthouse lamps. Lighthouse beams brighten.
- Windows glow from the shared building shader (`uNight` uniform): per-window hash, ~55% lit, warm tones.

## The yacht (`src/boat/`)

- `layout.ts` is the single source for the boat's shape (pure): ~12 m hull lines, deckhouse with the cabin below
  (floor just above the waterline, settees, table), companionway (door + sliding hatch, three steps), lowered cockpit
  with benches and the wheel, railing with a gate at the stern, instrument panel position. `boatSurfaces(x, z,
  doorOpen)` returns what can be stood on / bumped into there (with `bottom` for roofs) — the model and the walking
  physics both use it, so change them together through `layout.ts`.
- `model.ts` merges static parts per material (`Parts`), so the boat is ~15 draw calls. The cabin has its own
  slightly emissive materials (no extra light: a point light would cost on every lit fragment in the scene).
  The water shader discards the sea inside the hull's footprint, otherwise it shows through the cabin floor.
- `ui/instrumentPanel.ts` draws chart plotter (`ui/minimap.ts`, now an offscreen chart), wind dial, speed/heading
  and sail trim into one 1024×716 canvas texture, redrawn 5×/s and only while the player is near the boat.

## First person (`src/person/`)

- `personController.ts` is pure: it only asks a `WalkWorld` for surfaces at a point (tops, optional `bottom`,
  boat or not) and the water level. Surfaces higher than a step block (walls, hull sides, railing) unless their
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
