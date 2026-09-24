import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OutlookNotifyState } from './spc';
import { emptyRefreshState as emptyState, type RefreshSource, type RefreshState } from './wakeSchedule';
import type { AlertPrefs, SavedLocation, Settings, Units } from './types';

export type { OutlookNotifyState };

const SETTINGS_KEY = 'umbra.settings';
const LOCATIONS_KEY = 'umbra.locations';
const SELECTED_KEY = 'umbra.selectedLocation';

export const defaultAlerts: AlertPrefs = {
  nextHourPrecip: true,
  severeWeather: true,
  severeOutlook: true,
  strongStorm: true,
  tropical: true,
  umbrella: true,
  sunscreen: false,
  dailySummary: true,
};

export const defaultSettings: Settings = {
  units: 'us',
  alerts: defaultAlerts,
};

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      units: parsed.units === 'si' ? 'si' : 'us',
      alerts: { ...defaultAlerts, ...(parsed.alerts ?? {}) },
    };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadSavedLocations(): Promise<SavedLocation[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCATIONS_KEY);
    return raw ? (JSON.parse(raw) as SavedLocation[]) : [];
  } catch {
    return [];
  }
}

export async function saveSavedLocations(locations: SavedLocation[]): Promise<void> {
  await AsyncStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
}

export async function loadSelectedLocationId(): Promise<string | 'current'> {
  return (await AsyncStorage.getItem(SELECTED_KEY)) ?? 'current';
}

export async function saveSelectedLocationId(id: string | 'current'): Promise<void> {
  await AsyncStorage.setItem(SELECTED_KEY, id);
}

export function unitsLabel(units: Units): string {
  return units === 'us' ? 'US' : 'Metric';
}

const LAST_PLACE_KEY = 'umbra.lastPlace';
const NOTIFY_STATE_KEY = 'umbra.notifyState';

export type LastPlace = {
  latitude: number;
  longitude: number;
  name: string;
};

/**
 * What the user has already been told about, so a forecast refresh every ten
 * minutes does not re-announce the same storm.
 */
export type TropicalNotifyState = {
  /** Start of the exposure window we last notified about, if there was one. */
  exposureStart: number | null;
  /** Forecast closest approach at that time, kilometres. */
  closestKm: number;
  notifiedAt: number;
};

export type NotifyState = {
  rainNotified: boolean;
  severeIds: string[];
  /** Identity of the forecast-derived storm signal last notified. */
  stormSignalKey: string | null;
  tropical: Record<string, TropicalNotifyState>;
  outlooks: Record<string, OutlookNotifyState>;
};

export async function loadLastPlace(): Promise<LastPlace | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastPlace>;
    if (
      typeof parsed.latitude !== 'number' ||
      typeof parsed.longitude !== 'number' ||
      typeof parsed.name !== 'string'
    ) {
      return null;
    }
    return { latitude: parsed.latitude, longitude: parsed.longitude, name: parsed.name };
  } catch {
    return null;
  }
}

export async function saveLastPlace(place: LastPlace): Promise<void> {
  await AsyncStorage.setItem(LAST_PLACE_KEY, JSON.stringify(place));
}

const emptyNotifyState: NotifyState = {
  rainNotified: false,
  severeIds: [],
  stormSignalKey: null,
  tropical: {},
  outlooks: {},
};

export async function loadNotifyState(): Promise<NotifyState> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFY_STATE_KEY);
    if (!raw) return emptyNotifyState;
    const parsed = JSON.parse(raw) as Partial<NotifyState>;
    return {
      rainNotified: parsed.rainNotified === true,
      severeIds: Array.isArray(parsed.severeIds) ? parsed.severeIds.filter((id) => typeof id === 'string') : [],
      stormSignalKey: typeof parsed.stormSignalKey === 'string' ? parsed.stormSignalKey : null,
      tropical:
        parsed.tropical && typeof parsed.tropical === 'object' ? parsed.tropical : {},
      outlooks:
        parsed.outlooks && typeof parsed.outlooks === 'object' ? parsed.outlooks : {},
    };
  } catch {
    return emptyNotifyState;
  }
}

export async function saveNotifyState(state: NotifyState): Promise<void> {
  await AsyncStorage.setItem(NOTIFY_STATE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Weather cache – lets the background task persist a full forecast so the UI
// can display it instantly on launch / resume instead of waiting for the network.
// ---------------------------------------------------------------------------

const WEATHER_CACHE_KEY = 'umbra.weatherCache';

export type WeatherCache = {
  bundle: import('./types').WeatherBundle;
  placeName: string;
  placeSubtitle: string;
  latitude: number;
  longitude: number;
  selectedId: string | 'current';
  timestamp: number;
};

export async function saveWeatherCache(cache: WeatherCache): Promise<void> {
  await AsyncStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
}

export async function loadWeatherCache(): Promise<WeatherCache | null> {
  try {
    const raw = await AsyncStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeatherCache>;
    if (!parsed.bundle || typeof parsed.timestamp !== 'number') return null;
    return parsed as WeatherCache;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tropical cache – active cyclones change on a six-hourly advisory cycle, so a
// cached copy lets the Storms tab render immediately instead of showing a
// spinner while the service responds.
// ---------------------------------------------------------------------------

const TROPICAL_CACHE_KEY = 'umbra.tropicalCache';

export type TropicalCache = {
  reports: import('./tropical').TropicalReport[];
  latitude: number;
  longitude: number;
  timestamp: number;
};

export async function saveTropicalCache(cache: TropicalCache): Promise<void> {
  await AsyncStorage.setItem(TROPICAL_CACHE_KEY, JSON.stringify(cache));
}

export async function loadTropicalCache(): Promise<TropicalCache | null> {
  try {
    const raw = await AsyncStorage.getItem(TROPICAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TropicalCache>;
    if (!Array.isArray(parsed.reports) || typeof parsed.timestamp !== 'number') return null;
    return parsed as TropicalCache;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Awareness cache – SPC outlooks and the regional sweep, so the Storms tab is
// populated the moment it opens instead of waiting on two slow services. Both
// carry their own validity windows, so a cached copy is filtered on read
// rather than trusted wholesale.
// ---------------------------------------------------------------------------

const AWARENESS_CACHE_KEY = 'umbra.awarenessCache';

export type AwarenessCache = {
  outlooks: import('./spc').DayOutlook[];
  regional: import('./regional').RegionalAlert[];
  latitude: number;
  longitude: number;
  timestamp: number;
};

export async function saveAwarenessCache(cache: AwarenessCache): Promise<void> {
  await AsyncStorage.setItem(AWARENESS_CACHE_KEY, JSON.stringify(cache));
}

export async function loadAwarenessCache(): Promise<AwarenessCache | null> {
  try {
    const raw = await AsyncStorage.getItem(AWARENESS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AwarenessCache>;
    if (typeof parsed.timestamp !== 'number') return null;
    return {
      outlooks: Array.isArray(parsed.outlooks) ? parsed.outlooks : [],
      regional: Array.isArray(parsed.regional) ? parsed.regional : [],
      latitude: typeof parsed.latitude === 'number' ? parsed.latitude : 0,
      longitude: typeof parsed.longitude === 'number' ? parsed.longitude : 0,
      timestamp: parsed.timestamp,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Selected place – resolved from storage alone, so the background refresh can
// target exactly what the UI would show without any React state to read.
// ---------------------------------------------------------------------------

export type TargetPlace = {
  latitude: number;
  longitude: number;
  name: string;
  subtitle: string;
  selectedId: string | 'current';
};

/**
 * The place the app would display if it opened right now: the saved location
 * the user picked, or the last resolved fix when they are on 'current'.
 *
 * The background refresh resolves its target this way so the cache it writes
 * is labelled with the same `selectedId` the UI checks before adopting it —
 * otherwise a background write is either discarded on launch or applied to the
 * wrong header.
 */
export async function resolveSelectedPlace(): Promise<TargetPlace | null> {
  const [selectedId, saved, last] = await Promise.all([
    loadSelectedLocationId(),
    loadSavedLocations(),
    loadLastPlace(),
  ]);

  if (selectedId !== 'current') {
    const match = saved.find((item) => item.id === selectedId);
    if (match) {
      return {
        latitude: match.latitude,
        longitude: match.longitude,
        name: match.name,
        subtitle: match.subtitle ?? '',
        selectedId: match.id,
      };
    }
  }

  if (!last) return null;
  // 'current' keeps no stored subtitle of its own: reverse geocoding happens in
  // the foreground. Carry the last one forward rather than blanking the header.
  const cached = await loadWeatherCache();
  return {
    latitude: last.latitude,
    longitude: last.longitude,
    name: last.name,
    subtitle: cached && cached.selectedId === 'current' ? cached.placeSubtitle : '',
    selectedId: 'current',
  };
}

// ---------------------------------------------------------------------------
// Refresh state – when each source was last *successfully* fetched.
//
// Deliberately separate from the caches themselves. A cache entry records what
// was written; this records what was confirmed. The two diverge whenever a
// fetch fails, and it is the confirmation time that decides when the device
// next needs waking — an app session whose requests all failed must not push
// the next background opportunity further away.
// ---------------------------------------------------------------------------

const REFRESH_STATE_KEY = 'umbra.refreshState';

export type { RefreshSource, RefreshState } from './wakeSchedule';
export { emptyRefreshState } from './wakeSchedule';


function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export async function loadRefreshState(): Promise<RefreshState> {
  try {
    const raw = await AsyncStorage.getItem(REFRESH_STATE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as Partial<Record<keyof RefreshState, unknown>>;
    return {
      forecast: num(parsed.forecast),
      alerts: num(parsed.alerts),
      tropical: num(parsed.tropical),
      outlook: num(parsed.outlook),
      regional: num(parsed.regional),
      lastAttemptAt: num(parsed.lastAttemptAt),
    };
  } catch {
    return emptyState;
  }
}

/**
 * Advances only the sources that actually succeeded.
 *
 * Timestamps move forward and never backward, so a stale concurrent writer
 * cannot undo a fresher confirmation.
 */
export async function recordRefreshSuccess(
  verified: Partial<Record<RefreshSource, number>>,
  attemptedAt: number = Date.now(),
): Promise<RefreshState> {
  const current = await loadRefreshState();
  const next: RefreshState = { ...current, lastAttemptAt: Math.max(current.lastAttemptAt, attemptedAt) };
  for (const [source, at] of Object.entries(verified)) {
    const key = source as RefreshSource;
    if (typeof at === 'number' && at > next[key]) next[key] = at;
  }
  await AsyncStorage.setItem(REFRESH_STATE_KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------------------
// Install identity – a stable id for this installation, used as the primary key
// for the device's server-side wake record.
//
// Deliberately not the push token: Expo tokens rotate, and keying on the token
// would orphan the old record and leave a dead token in the queue forever.
// ---------------------------------------------------------------------------

const INSTALL_ID_KEY = 'umbra.installId';

function randomId(): string {
  // Not security-sensitive — it only has to be unique across installs. Kept
  // dependency-free rather than pulling in a uuid library for one value.
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random()}${random()}`;
}

export async function loadInstallId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const created = randomId();
    await AsyncStorage.setItem(INSTALL_ID_KEY, created);
    return created;
  } catch {
    // Unpersisted fallback: a heartbeat with a fresh id is better than none,
    // and the next launch will try to persist again.
    return randomId();
  }
}
