# Sail

Open-world sailing game: three.js + TypeScript + Vite. A re-implementation (not a port) of the Godot
project at `/Users/michael/projects/godot/boat3d`.

## Migration rules

- `godot/boat3d` (and `godot/sailboat`, an older prototype) are **read-only reference**. Never modify them.
- Take ideas, not code: re-design for the web stack instead of translating GDScript line by line.
- Out of scope for now: weather API (wind is random, `src/weather/wind.ts`), harbors, buildings,
  wikidata images, simulated vessels.

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest unit tests (pure logic: sailing, collision, waves, shore map, geo, terrain)
- `npm run typecheck` / `npm run build`
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

## Controls

- Keyboard: ←/→ or A/D steer (moves the helm, which eases back to centre), S sail, T turbo, 1/2/3 camera,
  M map range, R back to start, G tuning panel. Mouse drag orbits, wheel zooms.
- Touch (`core/touchControls.ts`, `ui/touchUi.ts`): one finger drags the helm, two fingers orbit/pinch-zoom,
  tap the minimap to change range, on-screen Sail/View buttons. `body.touch` switches the touch UI on.
- Both keyboard and touch drive `boat/helm.ts`; the rudder and the 3D wheel follow the helm position.

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

## Ideas for later

- Higher-resolution coastline (OSM land polygons) — only `public/data/coast.json` needs to change
- Floating origin for voyages far beyond ~200 km from the start
- Harbors, other vessels, real weather (deliberately out of scope so far)
