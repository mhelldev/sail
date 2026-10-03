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
- `npm test` — Vitest unit tests (pure logic: sailing model, waves, input)
- `npm run typecheck` / `npm run build`

## Conventions

- 1 world unit = 1 metre. World axes: +X = east, -Z = north, +Y = up.
- Headings and wind are compass degrees clockwise from north; wind direction is where it blows FROM.
- Boat model local axes: forward = -Z, starboard = +X. Positive heel/roll lowers the port side.
- Keep game logic that can be pure (no three.js) in testable modules (`boat/sailing.ts`, `water/waves.ts`).
- `water/waves.ts` (CPU) and the GLSL in `water/water.ts` implement the same Gerstner waves — change both together.

## Roadmap

1. ✅ Setup, sky, light, fog
2. ✅ Open sea: Gerstner waves, procedural boat, sailing mechanics, random wind, cameras, HUD
3. Geo pipeline: preprocess `boat3d/europe.geo.json` into merged land polygons (removing country borders),
   local metric projection, signed distance to coast
4. Terrain: chunks streamed around the boat, heights = coast mask × ridged/domain-warped noise, built in a
   Web Worker
5. Land collision + polish
