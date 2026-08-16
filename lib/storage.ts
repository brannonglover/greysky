import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AlertPrefs, SavedLocation, Settings, Units } from './types';

const SETTINGS_KEY = 'umbra.settings';
const LOCATIONS_KEY = 'umbra.locations';
const SELECTED_KEY = 'umbra.selectedLocation';

export const defaultAlerts: AlertPrefs = {
  nextHourPrecip: true,
  severeWeather: true,
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
