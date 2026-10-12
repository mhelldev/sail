// Bakes what the marina houses show: for every harbour in public/data/harbors.json the nearest fitting
// English Wikipedia article (intro text, for the poster) and up to six freely licensed Wikimedia Commons
// photos taken nearby (for the gallery). Only the photo *metadata* is baked; the game downloads the
// thumbnails itself when a village is built (and caches them), so it needs no search at runtime.
//
//   1. per harbour: Wikipedia geosearch + Commons geosearch with image info — cached one file per
//      harbour in data/marinas-raw/, so a rerun after a failure (or Ctrl-C) resumes
//   2. intro texts in batches of 20
//   3. write public/data/marinas/<lat>_<lon>.json, one file per 2° cell (see `marinaCell` in
//      src/harbors/marinaInfo.ts), loaded when a harbour in that cell is near
//
// Wikimedia allows ~200 requests/min for clients with an identifying User-Agent; we stay below that,
// so a full bake (~8 500 requests) takes about 45 minutes.
//
// Usage: node scripts/bake-marinas.ts [maxHarbours]

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';

const HARBORS = 'public/data/harbors.json';
const RAW_DIR = 'data/marinas-raw';
const OUT_DIR = 'public/data/marinas';
const USER_AGENT = 'SailGameBake/0.1 (https://github.com/mhelldev/sail) node-fetch';
const MIN_INTERVAL = 330; // ms between requests (~180/min)
const ARTICLE_RADIUS = 10000; // metres (the API's maximum)
const PHOTO_RADIUS = 5000;
const PHOTOS = 6;
const THUMB_WIDTH = 500; // one of Wikimedia's standard thumbnail sizes
const THUMB_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
const MAX_TEXT = 1100; // characters of the intro, cut at a sentence end

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- polite API access ------------------------------------------------------------------------

// Requests start at most every MIN_INTERVAL ms, however many lookups run in parallel (the API is
// slow to answer, so several are in flight at once).
let slot: Promise<unknown> = Promise.resolve();
const nextSlot = () => (slot = slot.then(() => sleep(MIN_INTERVAL)));

async function api(host: string, params: Record<string, string>): Promise<any> {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 1; ; attempt++) {
    await nextSlot();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } }).catch((err: Error) => ({ ok: false, status: 0, headers: new Headers(), text: () => Promise.resolve(err.message) }) as Response);
    if (res.ok) {
      const json = await res.json().catch(() => ({ error: 'connection dropped' })); // ECONNRESET mid-body
      if (!json.error) return json;
      if (attempt >= 5) throw new Error(`${host}: ${JSON.stringify(json.error).slice(0, 300)}`);
    } else if (attempt >= 6 || !(res.status === 0 || res.status === 429 || res.status >= 500)) {
      throw new Error(`${host} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const retry = Number(res.headers.get('retry-after')) || 15 * 2 ** (attempt - 1);
    console.warn(`  ${host} ${res.status || 'error'}, retrying in ${retry} s…`);
    await sleep(retry * 1000);
  }
}

// ---- choosing the article -----------------------------------------------------------------------

/** Words in harbour names that say nothing about the place. */
const GENERIC = new Set(
  `marina marinas harbour harbor harbours port porto puerto puerte porth portu ports hafen häfen haven havn havnen hamn hamnen
  jachthaven yachthafen sportboothafen sportboothaven yacht yachting club nautico náutico nautique nautica nautic sailing segelclub
  fishing fiskehamn fiskerihavn fischereihafen pesquero pesca peschereccio commerciale commercial ferry terminal quay pier
  luka lučica limani λιμάνι λιμένας λιμάνι гавань порт de du des la le les el los las di del della dello the of and a an
  im am an der den das bay baai bassin darsena dársena approdo turistico turístico deportivo sportivo old new new`.split(/\s+/),
);

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function nameTokens(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter((t) => t.length >= 3 && !GENERIC.has(t) && !/^\d+$/.test(t));
}

/** Coordinate types (from {{coord|type:…}}): a town is what the poster is about. */
const TYPE_WEIGHT: Record<string, number> = { city: 3, isle: 1.1, adm3rd: 1.5, adm2nd: 1.2, waterbody: 1, landmark: 0.9 };

type GeoHit = { pageid: number; title: string; dist: number; type: string | null };

function pickArticle(harbourName: string, hits: GeoHit[]): GeoHit | undefined {
  const tokens = nameTokens(harbourName);
  let best: { hit: GeoHit; score: number } | undefined;
  for (const hit of hits) {
    if (/^list of /i.test(hit.title)) continue;
    const title = normalize(hit.title.replace(/,.*$/, '').replace(/\(.*\)/, ''));
    const titleTokens = title.split(' ').filter((t) => t.length >= 3 && !GENERIC.has(t));
    const matched = tokens.filter((t) => titleTokens.includes(t) || (t.length >= 5 && title.includes(t))).length;
    // "Port St Mary" beats "Port St Mary Lifeboat Station": how much of the title is the name.
    const nameShare = matched ? 1 + Math.min(1, matched / Math.max(1, titleTokens.length)) : 0;
    const score = ((TYPE_WEIGHT[hit.type ?? ''] ?? 0.4) * (matched ? 3 * nameShare : 1)) / (1 + hit.dist / 2500);
    if (!best || score > best.score) best = { hit, score };
  }
  // Without a town or a name match, a random building 9 km away isn't worth a poster.
  return best && best.score >= 0.25 ? best.hit : undefined;
}

// ---- choosing the photos ------------------------------------------------------------------------

const FREE_LICENSE = /^(CC BY(-SA)?( \d\.\d)?|CC0|Public domain|PD\b)/i;
const FROM_SPACE = /^(ISS\d|STS-?\d)|view of earth|satellite|sentinel-?\d|landsat/i;
const NOT_A_PHOTO = /\b(map|karte|kaart|carte|mapa|plan|logo|coat of arms|wappen|blason|diagram|chart|scan|document|stamp|ticket|poster|sign|text|inscription|grave|tomb|interior|organ|altar|screenshot|flag)\b/i;

type Photo = [path: string, title: string, artist: string, license: string, aspect: number];

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "Pier - geograph.org.uk - 4613482", "Pier (8524793961)", "Pier - panoramio (3)" → "Pier" */
const cleanTitle = (s: string) =>
  s
    .replace(/_/g, ' ')
    .replace(/\s*-\s*(panoramio|geograph\.org\.uk|Flickr)\b.*$/i, '')
    .replace(/\s*\((geograph )?\d{5,}\)/gi, '')
    .replace(/\s+(IMG|DSC|DSCN|P)[ _]?\d{3,}\b/g, '')
    .trim();

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

function pickPhotos(pages: any[]): Photo[] {
  const candidates = pages
    .filter((p) => p.imageinfo?.[0] && p.index !== undefined)
    .sort((a, b) => a.index - b.index); // nearest first
  const out: Photo[] = [];
  const perArtist = new Map<string, number>();
  const seenBase = new Set<string>();
  for (const p of candidates) {
    const info = p.imageinfo[0];
    const meta = info.extmetadata ?? {};
    const license = stripHtml(meta.LicenseShortName?.value ?? '');
    const file = String(p.title).replace(/^File:/, '');
    if (info.mime !== 'image/jpeg' || info.width < 800 || !info.thumburl) continue;
    const aspect = info.height / info.width;
    if (aspect < 0.45 || aspect > 1.6) continue;
    if (!FREE_LICENSE.test(license) || / NC| ND/.test(license)) continue;
    const name = stripHtml(meta.ObjectName?.value ?? '') || file.replace(/\.[^.]+$/, '');
    if (NOT_A_PHOTO.test(name) || NOT_A_PHOTO.test(file) || FROM_SPACE.test(name)) continue;
    // "Pier (2).jpg", "Pier 3.jpg": one of a series is enough.
    const base = normalize(name).replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    if (seenBase.has(base)) continue;
    // "--Xocolatl 13:55, 6 April 2008 (UTC)" (a wiki signature) → "Xocolatl"
    const artistName = stripHtml(meta.Artist?.value ?? '').replace(/^-+/, '').replace(/\s*\d{1,2}:\d{2},.*?\(UTC\)/, '').trim();
    const artist = clip(artistName || 'unknown', 40);
    if ((perArtist.get(artist) ?? 0) >= 2) continue;
    // https://upload…/thumb/7/72/Name.JPG/500px-Name.JPG?utm… → "7/72/Name.JPG"
    const m = /\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/[^/]+)\//.exec(info.thumburl);
    if (!m) continue;
    seenBase.add(base);
    perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
    out.push([m[1], clip(cleanTitle(name), 60), artist, license, Math.round(aspect * 100) / 100]);
    if (out.length >= PHOTOS) break;
  }
  return out;
}

// ---- 1. per harbour -----------------------------------------------------------------------------

type HarborFile = { harbors: Array<[string, number, number, number, number]> };
const harbors = (JSON.parse(readFileSync(HARBORS, 'utf8')) as HarborFile).harbors;
const limit = Number(process.argv[2]) || harbors.length;
mkdirSync(RAW_DIR, { recursive: true });

type Raw = { name: string; article?: { pageid: number; title: string }; photos: Photo[] };
const count = Math.min(limit, harbors.length);
const raws: Raw[] = new Array(count);
const started = Date.now();
let fetched = 0;
const todo: number[] = [];
for (let id = 0; id < count; id++) {
  const file = `${RAW_DIR}/${id}.json`;
  const cached = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Raw) : undefined;
  if (cached?.name === harbors[id][0]) raws[id] = cached;
  else todo.push(id);
}

async function lookUp(id: number): Promise<void> {
  const [name, lat, lon] = harbors[id];
  const file = `${RAW_DIR}/${id}.json`;
  const coord = `${lat}|${lon}`;
  const geo = await api('en.wikipedia.org', { action: 'query', list: 'geosearch', gscoord: coord, gsradius: String(ARTICLE_RADIUS), gslimit: '50', gsprop: 'type' });
  const article = pickArticle(name, geo.query?.geosearch ?? []);
  const commons = await api('commons.wikimedia.org', {
    action: 'query',
    generator: 'geosearch',
    ggscoord: coord,
    ggsradius: String(PHOTO_RADIUS),
    ggslimit: '60',
    ggsnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName',
  });
  const raw: Raw = { name, article: article && { pageid: article.pageid, title: article.title }, photos: pickPhotos(commons.query?.pages ?? []) };
  writeFileSync(file, JSON.stringify(raw));
  raws[id] = raw;
  if (++fetched % 50 === 0) {
    const perHarbour = (Date.now() - started) / fetched;
    console.log(`${fetched}/${todo.length}  ~${Math.round(((todo.length - fetched) * perHarbour) / 60000)} min left`);
  }
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await lookUp(id);
  }),
);
console.log(`${raws.length} harbours looked up (${fetched} new)`);

// ---- 2. intro texts -----------------------------------------------------------------------------

const TEXT_CACHE = `${RAW_DIR}/texts.json`;
const texts: Record<string, string> = existsSync(TEXT_CACHE) ? JSON.parse(readFileSync(TEXT_CACHE, 'utf8')) : {};
const missing = [...new Set(raws.filter((r) => r.article && !(r.article.pageid in texts)).map((r) => r.article!.pageid))];
for (let i = 0; i < missing.length; i += 20) {
  const batch = missing.slice(i, i + 20);
  const res = await api('en.wikipedia.org', { action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '20', pageids: batch.join('|') });
  for (const p of res.query?.pages ?? []) texts[p.pageid] = shorten(p.extract ?? '');
  for (const id of batch) texts[id] ??= '';
  writeFileSync(TEXT_CACHE, JSON.stringify(texts));
  if ((i / 20) % 20 === 19) console.log(`  texts ${i + 20}/${missing.length}`);
}

/** The first paragraphs up to MAX_TEXT characters, ending at a full sentence. */
function shorten(text: string): string {
  const clean = text
    .replace(/\s*\([^()]*\)/g, (m) => (m.length > 40 ? '' : m)) // long pronunciation/etymology brackets
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (clean.length <= MAX_TEXT) return clean;
  const cut = clean.slice(0, MAX_TEXT);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > MAX_TEXT / 3 ? cut.slice(0, end + 1) : cut.trimEnd() + '…';
}

// ---- 3. write the cells -------------------------------------------------------------------------

/** Same as `marinaCell` in src/harbors/marinaInfo.ts. */
const cellOf = (lat: number, lon: number) => `${Math.floor(lat / 2) * 2}_${Math.floor(lon / 2) * 2}`;

type Entry = { n: string; a?: [title: string, text: string]; p: Photo[] };
const cells = new Map<string, Record<number, Entry>>();
raws.forEach((r, id) => {
  const [, lat, lon] = harbors[id];
  const text = r.article ? texts[r.article.pageid] : '';
  const entry: Entry = { n: r.name, p: r.photos };
  if (r.article && text) entry.a = [r.article.title, text];
  if (!entry.a && !entry.p.length) return;
  const key = cellOf(lat, lon);
  (cells.get(key) ?? cells.set(key, {}).get(key)!)[id] = entry;
});

if (existsSync(OUT_DIR)) for (const f of readdirSync(OUT_DIR)) rmSync(`${OUT_DIR}/${f}`);
mkdirSync(OUT_DIR, { recursive: true });
let bytes = 0;
for (const [key, marinas] of cells) {
  const json = JSON.stringify({
    attribution: { text: 'Wikipedia (CC BY-SA 4.0)', photos: 'Wikimedia Commons, see each photo', thumbs: THUMB_PREFIX, width: THUMB_WIDTH },
    // id (index in harbors.json) → { n: name, a: [article title, intro text], p: [[thumb path, title, artist, licence, height/width]] }
    marinas,
  });
  writeFileSync(`${OUT_DIR}/${key}.json`, json);
  bytes += json.length;
}
const withText = raws.filter((r) => r.article && texts[r.article.pageid]).length;
const photos = raws.reduce((n, r) => n + r.photos.length, 0);
console.log(`${withText} articles, ${photos} photos → ${cells.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${OUT_DIR}/`);
