// Remembers where the boat was between visits. Per-browser convenience only:
// storage can be unavailable (private mode, blocked site data), so every access is guarded.

const KEY = 'sail.boat.v1';

export interface SavedBoat {
  lat: number;
  lon: number;
  heading: number;
  sailUp: boolean;
}

export function loadBoat(): SavedBoat | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as Partial<SavedBoat>;
    if ([v.lat, v.lon, v.heading].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return { lat: v.lat!, lon: v.lon!, heading: v.heading!, sailUp: v.sailUp !== false };
    }
  } catch {
    // ignore unreadable storage
  }
  return undefined;
}

export function saveBoat(boat: SavedBoat): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(boat));
  } catch {
    // ignore full or blocked storage
  }
}

export function clearSavedBoat(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
