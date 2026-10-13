// Remembers where the boat was between visits. Per-browser convenience only:
// storage can be unavailable (private mode, blocked site data), so every access is guarded.

import type { EconomyState } from '../economy/economy';

const KEY = 'sail.boat.v1';

export interface SavedBoat {
  lat: number;
  lon: number;
  heading: number;
  sailUp: boolean;
  /** litres in the tank (missing in old saves: full) */
  fuel?: number;
}

export function loadBoat(): SavedBoat | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as Partial<SavedBoat>;
    if ([v.lat, v.lon, v.heading].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      const fuel = typeof v.fuel === 'number' && Number.isFinite(v.fuel) ? v.fuel : undefined;
      return { lat: v.lat!, lon: v.lon!, heading: v.heading!, sailUp: v.sailUp !== false, fuel };
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

// ---- The player: money, hunger, thirst, the pantry ----


const PLAYER_KEY = 'sail.player.v1';

export function loadPlayer(): EconomyState | undefined {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    return raw ? (JSON.parse(raw) as EconomyState) : undefined;
  } catch {
    return undefined;
  }
}

export function savePlayer(state: EconomyState): void {
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(state));
  } catch {
    // ignore full or blocked storage
  }
}
