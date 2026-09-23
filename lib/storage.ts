import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OutlookNotifyState } from './spc';
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
