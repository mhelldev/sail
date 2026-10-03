// Converts a Natural Earth style country GeoJSON into coastline polylines.
//
// Country polygons share their borders exactly, so every border edge appears twice
// (once per country, in opposite directions). Dropping those pairs leaves only the
// real coastline, which still forms closed loops around each landmass.
//
// Usage: node scripts/preprocess-geo.ts [input.geo.json] [output.json]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const input = process.argv[2] ?? '/Users/michael/projects/godot/boat3d/europe.geo.json';
const output = process.argv[3] ?? 'public/data/coast.json';

// Keep Europe and its seas; drop overseas territories and the far side of Russia.
const BOUNDS = { minLon: -32, minLat: 27, maxLon: 50, maxLat: 82 };
const DECIMALS = 5; // ~1 m

type Pt = [number, number];
type Geometry = { type: 'Polygon'; coordinates: Pt[][] } | { type: 'MultiPolygon'; coordinates: Pt[][][] };

const geo = JSON.parse(readFileSync(input, 'utf8')) as { features: { geometry: Geometry }[] };

const round = (v: number) => Number(v.toFixed(DECIMALS));
const ptKey = (p: Pt) => `${p[0]},${p[1]}`;

function ringInBounds(ring: Pt[]): boolean {
  return ring.some(
    ([lon, lat]) => lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat,
  );
}

// Count every undirected edge. Some features are duplicated in the source (France
// appears twice), so identical rings are only counted once.
const edges = new Map<string, { a: Pt; b: Pt; count: number }>();
const seenRings = new Set<string>();
let inputEdges = 0;
let duplicateRings = 0;
for (const { geometry } of geo.features) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const rawRing of polygon) {
      if (!ringInBounds(rawRing)) continue;
      const ring = rawRing.map(([lon, lat]) => [round(lon), round(lat)] as Pt);
      const ringKey = ring.map(ptKey).join(';');
      if (seenRings.has(ringKey)) {
        duplicateRings++;
        continue;
      }
      seenRings.add(ringKey);
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        const ka = ptKey(a);
        const kb = ptKey(b);
        if (ka === kb) continue;
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = edges.get(key);
        if (e) e.count++;
        else edges.set(key, { a, b, count: 1 });
        inputEdges++;
      }
    }
  }
}

const coastEdges = [...edges.values()].filter((e) => e.count === 1);

// Every loop must be closed for the inside/outside crossing test at runtime.
const degree = new Map<string, number>();
for (const e of coastEdges) for (const p of [e.a, e.b]) degree.set(ptKey(p), (degree.get(ptKey(p)) ?? 0) + 1);
const loose = [...degree].filter(([, d]) => d % 2 === 1).map(([k]) => k);
if (loose.length) console.warn(`warning: ${loose.length} loose coastline ends, e.g. ${loose.slice(0, 3).join('  ')}`);

// Chain edges into polylines so each vertex is stored (roughly) once.
const byPoint = new Map<string, number[]>();
coastEdges.forEach((e, i) => {
  for (const p of [e.a, e.b]) {
    const k = ptKey(p);
    const list = byPoint.get(k);
    if (list) list.push(i);
    else byPoint.set(k, [i]);
  }
});
const used = new Uint8Array(coastEdges.length);
const lines: number[][] = [];
for (let i = 0; i < coastEdges.length; i++) {
  if (used[i]) continue;
  used[i] = 1;
  const pts: Pt[] = [coastEdges[i].a, coastEdges[i].b];
  for (;;) {
    const tail = pts[pts.length - 1];
    const next = byPoint.get(ptKey(tail))?.find((j) => !used[j]);
    if (next === undefined) break;
    used[next] = 1;
    const e = coastEdges[next];
    pts.push(ptKey(e.a) === ptKey(tail) ? e.b : e.a);
  }
  lines.push(pts.flat());
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ source: input.split('/').pop(), bounds: BOUNDS, lines }));

const points = lines.reduce((n, l) => n + l.length / 2, 0);
console.log(
  `${duplicateRings} duplicate rings skipped, ${inputEdges} edges in, ${edges.size - coastEdges.length} shared border edges removed, ` +
    `${coastEdges.length} coastline edges → ${lines.length} polylines, ${points} points → ${output}`,
);
