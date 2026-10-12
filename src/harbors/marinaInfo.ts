// What a marina house shows: the Wikipedia intro for the poster and the Commons photos for the
// gallery, baked by scripts/bake-marinas.ts into public/data/marinas/<cell>.json (2° cells).
// Only the photo metadata is baked; the thumbnails come from Wikimedia when a village is near and
// are kept in the browser's Cache Storage, so a marina you have visited works offline afterwards.

import type { Harbor } from './harborData';

export interface MarinaPhoto {
  url: string;
  title: string;
  artist: string;
  license: string;
  /** height / width */
  aspect: number;
}

export interface MarinaInfo {
  name: string;
  article?: { title: string; text: string; url: string };
  photos: MarinaPhoto[];
}

interface CellFile {
  attribution: { thumbs: string; width: number };
  marinas: Record<string, { n: string; a?: [string, string]; p: Array<[string, string, string, string, number]> }>;
}

/** The 2° cell a harbour's info is in (same as `cellOf` in scripts/bake-marinas.ts). */
export function marinaCell(lat: number, lon: number): string {
  return `${Math.floor(lat / 2) * 2}_${Math.floor(lon / 2) * 2}`;
}

/** "7/72/Name.JPG" → https://upload.wikimedia.org/…/thumb/7/72/Name.JPG/500px-Name.JPG */
export function thumbUrl(prefix: string, path: string, width: number): string {
  return `${prefix}${path}/${width}px-${path.slice(path.lastIndexOf('/') + 1)}`;
}

/** Turns a cell file entry into what the house shows. */
export function parseMarina(file: CellFile, id: number): MarinaInfo | undefined {
  const e = file.marinas[id];
  if (!e) return undefined;
  const { thumbs, width } = file.attribution;
  return {
    name: e.n,
    article: e.a && { title: e.a[0], text: e.a[1], url: `https://en.wikipedia.org/wiki/${encodeURIComponent(e.a[0].replace(/ /g, '_'))}` },
    photos: e.p.map(([path, title, artist, license, aspect]) => ({ url: thumbUrl(thumbs, path, width), title, artist, license, aspect })),
  };
}

const CACHE = 'marina-gallery-v1';

/**
 * fetch() that keeps successful responses in Cache Storage, so they are there offline too.
 * Cache first for the photos (they never change), network first for our own data (a re-bake shows
 * up at once). Cache Storage needs a secure context (https or localhost); elsewhere it's a plain fetch.
 */
export async function cachedFetch(url: string, networkFirst = false): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => undefined) : undefined;
  if (!networkFirst) {
    const hit = await cache?.match(url);
    if (hit) return hit;
  }
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) await cache?.put(url, res.clone()).catch(() => {}); // quota full: just don't keep it
    return res;
  } catch (err) {
    const hit = networkFirst ? await cache?.match(url) : undefined;
    if (hit) return hit;
    throw err;
  }
}

export class MarinaInfoStore {
  /** null: there is no file for that cell (nothing found there); undefined: couldn't load it */
  private readonly cells = new Map<string, Promise<CellFile | null | undefined>>();
  private readonly photos = new Map<string, Promise<HTMLCanvasElement | undefined>>();

  constructor(private readonly baseUrl: string) {}

  /** The info for a harbour, or undefined if nothing was found for it (or the data can't be loaded). */
  async get(h: Harbor): Promise<MarinaInfo | undefined> {
    const key = marinaCell(h.lat, h.lon);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = cachedFetch(`${this.baseUrl}${key}.json`, true)
        .then((r) => {
          // A missing file is a 404 — or index.html from the dev server's SPA fallback.
          const json = r.headers.get('content-type')?.includes('json');
          return r.ok && json ? (r.json() as Promise<CellFile>) : r.ok || r.status === 404 ? null : undefined;
        })
        .catch(() => undefined);
      this.cells.set(key, cell);
      // Failed (offline before the first visit): try again next time instead of remembering it.
      void cell.then((c) => c === undefined && this.cells.delete(key));
    }
    const file = await cell;
    return file ? parseMarina(file, h.id) : undefined;
  }

  /** Downloads a harbour's photos into the cache without decoding them (while sailing in). */
  async prefetch(h: Harbor): Promise<void> {
    const info = await this.get(h);
    for (const p of info?.photos ?? []) await cachedFetch(p.url).catch(() => undefined);
  }

  /** A photo as a canvas (for a texture), or undefined when it can't be loaded (offline, removed). */
  photo(url: string): Promise<HTMLCanvasElement | undefined> {
    let p = this.photos.get(url);
    if (!p) {
      p = cachedFetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
          bitmap.close();
          return canvas;
        })
        .catch(() => {
          this.photos.delete(url); // retry later (e.g. back online)
          return undefined;
        });
      this.photos.set(url, p);
    }
    return p;
  }

  /** Forgets decoded photos (they stay in Cache Storage). */
  release(url: string): void {
    this.photos.delete(url);
  }
}
