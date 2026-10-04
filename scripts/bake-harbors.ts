// Bakes real marinas, harbours and lighthouses into public/data/harbors.json, snapped onto
// our coarse Natural Earth coastline. One-off: the game itself never queries anything.
// Data © OpenStreetMap contributors (ODbL), via the Overpass API.
//
//   1. download name + position (CSV, `out center`) per region; each region is cached in
//      data/harbors-raw/ so a rerun after a failure resumes
//   2. snap every entry to the nearest point of public/data/coast.json; drop what is too far
//      inland (lakes, rivers we don't have) and find the seaward direction there
//   3. merge duplicates (a marina mapped as point and area, several pontoons …)
//
// Usage: node scripts/bake-harbors.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const RAW_DIR = 'data/harbors-raw';
const OUT = 'public/data/harbors.json';
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const MAX_SNAP_HARBOR = 3000; // metres from our coast
const MAX_SNAP_LIGHTHOUSE = 1500;
const MERGE_HARBOR = 1000;
const MERGE_LIGHTHOUSE = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 1. download ----------------------------------------------------------------------------

type Raw = { kind: 'marina' | 'harbour' | 'lighthouse'; lat: number; lon: number; name: string };

async function overpass(query: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'sail-game-build/0.1 (one-off data import)' },
      body: 'data=' + encodeURIComponent(query),
    }).catch((err: Error) => ({ ok: false, status: 0, text: () => Promise.resolve(err.message) }) as Response);
    const text = await res.text();
    // CSV has no closing bracket to detect truncation, but a remark line marks server errors.
    if (res.ok && !text.includes('runtime error')) return text;
    const retryable = res.status === 0 || res.status === 429 || res.status >= 500 || res.ok;
    if (attempt >= 6 || !retryable) throw new Error(`Overpass ${res.status}: ${text.slice(0, 300)}`);
    const wait = 30 * 2 ** (attempt - 1);
    console.warn(`  Overpass ${res.status || 'error'}, retrying in ${wait} s…`);
    await sleep(wait * 1000);
  }
}

mkdirSync(RAW_DIR, { recursive: true });
// Same area as coast.json (lon -32…50, lat 27…82), in 9 smaller queries.
const lonSteps = [-32, -5, 15, 50];
const latSteps = [27, 47, 58, 82];
const raw: Raw[] = [];
for (let i = 0; i < lonSteps.length - 1; i++) {
  for (let j = 0; j < latSteps.length - 1; j++) {
    const bbox = `${latSteps[j]},${lonSteps[i]},${latSteps[j + 1]},${lonSteps[i + 1]}`;
    const file = `${RAW_DIR}/${bbox.replaceAll(',', '_')}.tsv`;
    let tsv: string;
    if (existsSync(file)) {
      tsv = readFileSync(file, 'utf8');
    } else {
      console.log(`downloading ${bbox}…`);
      tsv = await overpass(`[out:csv(::lat,::lon,leisure,harbour,man_made,name; false; "\\t")][timeout:300];
        (
          nwr["leisure"="marina"]["name"](${bbox});
          nwr["harbour"]["harbour"!="no"]["name"](${bbox});
          nwr["man_made"="lighthouse"](${bbox});
        );
        out center;`);
      writeFileSync(file, tsv);
      await sleep(5000);
    }
    for (const line of tsv.split('\n')) {
      const [lat, lon, leisure, harbour, manMade, ...nameParts] = line.split('\t');
      if (!lat || !lon) continue;
      const kind = manMade === 'lighthouse' ? 'lighthouse' : leisure === 'marina' ? 'marina' : harbour ? 'harbour' : undefined;
      if (!kind) continue;
      raw.push({ kind, lat: Number(lat), lon: Number(lon), name: nameParts.join('\t').trim() });
    }
  }
}
console.log(`${raw.length} entries downloaded`);

// ---- 2. snap to our coastline ---------------------------------------------------------------

const coast = JSON.parse(readFileSync('public/data/coast.json', 'utf8')) as { lines: number[][] };
const segs: number[] = []; // lon0, lat0, lon1, lat1
for (const l of coast.lines) for (let i = 0; i + 3 < l.length; i += 2) segs.push(l[i], l[i + 1], l[i + 2], l[i + 3]);
const CELL = 0.05; // degrees
const grid = new Map<string, number[]>();
const bands = new Map<number, number[]>();
for (let s = 0; s < segs.length; s += 4) {
  const [x0, y0, x1, y1] = [segs[s], segs[s + 1], segs[s + 2], segs[s + 3]];
  for (let cx = Math.floor(Math.min(x0, x1) / CELL); cx <= Math.floor(Math.max(x0, x1) / CELL); cx++) {
    for (let cy = Math.floor(Math.min(y0, y1) / CELL); cy <= Math.floor(Math.max(y0, y1) / CELL); cy++) {
      const k = `${cx},${cy}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
    }
  }
  if (y0 !== y1) {
    for (let b = Math.floor(Math.min(y0, y1) / CELL); b <= Math.floor(Math.max(y0, y1) / CELL); b++) {
      (bands.get(b) ?? bands.set(b, []).get(b)!).push(s);
    }
  }
}

/** Crossing test (the coastline loops are closed); valid in lon/lat as well as in metres. */
function isLand(lon: number, lat: number): boolean {
  let inside = false;
  for (const s of bands.get(Math.floor(lat / CELL)) ?? []) {
    const [x0, y0, x1, y1] = [segs[s], segs[s + 1], segs[s + 2], segs[s + 3]];
    if (y0 > lat !== y1 > lat && x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0) > lon) inside = !inside;
  }
  return inside;
}

const M_LAT = 111_195; // metres per degree latitude
type Snap = { lon: number; lat: number; dist: number; seaHeading: number; landLon: number; landLat: number };

/** Nearest point on our coast within maxDist metres, with the compass heading towards the sea. */
function snap(lon: number, lat: number, maxDist: number): Snap | undefined {
  const mLon = M_LAT * Math.cos((lat * Math.PI) / 180);
  const r = Math.ceil(maxDist / mLon / CELL) + 1;
  const cx = Math.floor(lon / CELL);
  const cy = Math.floor(lat / CELL);
  let best: { d2: number; px: number; py: number; s: number } | undefined;
  const seen = new Set<number>();
  for (let x = cx - r; x <= cx + r; x++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (const s of grid.get(`${x},${y}`) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        // Work in local metres around the query point.
        const ax = (segs[s] - lon) * mLon;
        const ay = (segs[s + 1] - lat) * M_LAT;
        const dx = (segs[s + 2] - lon) * mLon - ax;
        const dy = (segs[s + 3] - lat) * M_LAT - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const px = ax + dx * t;
        const py = ay + dy * t;
        const d2 = px * px + py * py;
        if (!best || d2 < best.d2) best = { d2, px, py, s };
      }
    }
  }
  if (!best || best.d2 > maxDist * maxDist) return undefined;
  const s = best.s;
  // Perpendicular to the coast segment; whichever side is water is seaward.
  const ex = (segs[s + 2] - segs[s]) * mLon;
  const ey = (segs[s + 3] - segs[s + 1]) * M_LAT;
  const el = Math.hypot(ex, ey) || 1;
  let nx = -ey / el; // east component
  let ny = ex / el; // north component
  const plon = lon + best.px / mLon;
  const plat = lat + best.py / M_LAT;
  const probe = 60; // metres
  if (isLand(plon + (nx * probe) / mLon, plat + (ny * probe) / M_LAT)) [nx, ny] = [-nx, -ny];
  const seaHeading = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360;
  const inland = 40; // metres: where a lighthouse stands
  return {
    lon: plon,
    lat: plat,
    dist: Math.sqrt(best.d2),
    seaHeading,
    landLon: plon - (nx * inland) / mLon,
    landLat: plat - (ny * inland) / M_LAT,
  };
}

type Harbor = { name: string; lon: number; lat: number; seaHeading: number; kind: 'marina' | 'harbour'; dist: number };
type Light = { name: string; lon: number; lat: number; dist: number };
const harbors: Harbor[] = [];
const lights: Light[] = [];
let dropped = 0;
for (const r of raw) {
  const isLight = r.kind === 'lighthouse';
  const s = snap(r.lon, r.lat, isLight ? MAX_SNAP_LIGHTHOUSE : MAX_SNAP_HARBOR);
  if (!s) {
    dropped++;
    continue;
  }
  if (isLight) lights.push({ name: r.name, lon: s.landLon, lat: s.landLat, dist: s.dist });
  else harbors.push({ name: r.name, lon: s.lon, lat: s.lat, seaHeading: s.seaHeading, kind: r.kind as Harbor['kind'], dist: s.dist });
}

// ---- 3. merge duplicates --------------------------------------------------------------------

/** Keeps the first of every cluster closer than `minDist`; candidates sorted so the best comes first. */
function merge<T extends { lon: number; lat: number }>(items: T[], minDist: number): T[] {
  const kept: T[] = [];
  const cells = new Map<string, T[]>();
  const cell = 0.02;
  for (const it of items) {
    const mLon = M_LAT * Math.cos((it.lat * Math.PI) / 180);
    const cx = Math.floor(it.lon / cell);
    const cy = Math.floor(it.lat / cell);
    let clash = false;
    for (let x = cx - 1; x <= cx + 1 && !clash; x++) {
      for (let y = cy - 1; y <= cy + 1 && !clash; y++) {
        for (const k of cells.get(`${x},${y}`) ?? []) {
          if (Math.hypot((k.lon - it.lon) * mLon, (k.lat - it.lat) * M_LAT) < minDist) clash = true;
        }
      }
    }
    if (clash) continue;
    kept.push(it);
    const key = `${cx},${cy}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(it);
  }
  return kept;
}

// Harbours (commercial / fishing) win over marinas at the same spot; then whatever needed the least snapping.
harbors.sort((a, b) => (a.kind === b.kind ? a.dist - b.dist : a.kind === 'harbour' ? -1 : 1));
lights.sort((a, b) => a.dist - b.dist);
const keptHarbors = merge(harbors, MERGE_HARBOR);
const keptLights = merge(lights, MERGE_LIGHTHOUSE);

const r4 = (v: number) => Math.round(v * 1e4) / 1e4; // ~10 m: we snap to a 1 km coastline anyway
writeFileSync(
  OUT,
  JSON.stringify({
    attribution: '© OpenStreetMap contributors (ODbL)',
    // [name, lat, lon, seaward compass heading, 1 = harbour / 0 = marina]
    harbors: keptHarbors.map((h) => [h.name, r4(h.lat), r4(h.lon), Math.round(h.seaHeading), h.kind === 'harbour' ? 1 : 0]),
    // [name, lat, lon]
    lighthouses: keptLights.map((l) => [l.name, r4(l.lat), r4(l.lon)]),
  }),
);
const size = readFileSync(OUT).length;
console.log(
  `${dropped} too far from our coast, ${harbors.length - keptHarbors.length} harbour and ${lights.length - keptLights.length} lighthouse duplicates merged → ` +
    `${keptHarbors.length} harbours/marinas, ${keptLights.length} lighthouses, ${(size / 1024).toFixed(0)} KB → ${OUT}`,
);
