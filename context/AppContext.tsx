import * as Location from 'expo-location';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { SavedLocation, Settings, WeatherBundle } from '@/lib/types';
import { syncWeatherNotifications } from '@/lib/notifications';
import {
  defaultSettings,
  loadSavedLocations,
  loadSelectedLocationId,
  loadSettings,
  saveSavedLocations,
  saveSelectedLocationId,
  saveSettings,
} from '@/lib/storage';
import { fetchAlerts, fetchForecast } from '@/lib/weather';

type PermissionState = Location.PermissionStatus | 'undetermined';

type AppState = {
  settings: Settings;
  weather: WeatherBundle | null;
  placeName: string;
  placeSubtitle: string;
  savedLocations: SavedLocation[];
  selectedId: string | 'current';
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  permission: PermissionState;
  lastUpdated: Date | null;
  coords: { latitude: number; longitude: number } | null;
  refresh: (force?: boolean) => Promise<void>;
  requestPermission: () => Promise<void>;
  updateSettings: (patch: Partial<Settings> | ((prev: Settings) => Settings)) => Promise<void>;
  selectCurrentLocation: () => Promise<void>;
  selectSavedLocation: (location: SavedLocation) => Promise<void>;
  addSavedLocation: (location: Omit<SavedLocation, 'id'>) => Promise<void>;
  removeSavedLocation: (id: string) => Promise<void>;
};

const AppContext = createContext<AppState | null>(null);

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function reverseName(latitude: number, longitude: number): Promise<{ name: string; subtitle: string }> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const first = results[0];
    if (!first) return { name: 'Current location', subtitle: '' };
    const name = first.district || first.city || first.subregion || first.name || 'Current location';
    const subtitle = [first.city && first.city !== name ? first.city : null, first.region, first.isoCountryCode]
      .filter(Boolean)
      .join(', ');
    return { name, subtitle };
  } catch {
    return { name: 'Current location', subtitle: '' };
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [weather, setWeather] = useState<WeatherBundle | null>(null);
  const [placeName, setPlaceName] = useState('Locating');
  const [placeSubtitle, setPlaceSubtitle] = useState('');
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string | 'current'>('current');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>(Location.PermissionStatus.UNDETERMINED);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const loadWeatherAt = useCallback(
    async (latitude: number, longitude: number, name: string, subtitle: string, persistId: string | 'current') => {
      setCoords({ latitude, longitude });
      setPlaceName(name);
      setPlaceSubtitle(subtitle);
      const [forecast, alerts] = await Promise.all([
        fetchForecast(latitude, longitude),
        fetchAlerts(latitude, longitude),
      ]);
      const bundle = { ...forecast, alerts };
      setWeather(bundle);
      setLastUpdated(new Date());
      setError(null);
      setSelectedId(persistId);
      await saveSelectedLocationId(persistId);
      const currentSettings = settingsRef.current;
      void syncWeatherNotifications(bundle, currentSettings.alerts, name, currentSettings.units);
    },
    [],
  );

  const loadCurrentGps = useCallback(async () => {
    const latest = await withTimeout(
      Location.getForegroundPermissionsAsync(),
      4000,
      'Location permission timed out.',
    );
    setPermission(latest.status);
    if (latest.status !== Location.PermissionStatus.GRANTED) {
      setError('Location permission is needed for hyperlocal forecasts.');
      return;
    }
    const position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      8000,
      'Could not read your GPS location.',
    );
    const named = await reverseName(position.coords.latitude, position.coords.longitude);
    await loadWeatherAt(position.coords.latitude, position.coords.longitude, named.name, named.subtitle, 'current');
  }, [loadWeatherAt]);

  const refresh = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      else if (!weather) setLoading(true);
      try {
        if (selectedId !== 'current') {
          const saved = savedLocations.find((item) => item.id === selectedId);
          if (saved) {
            await loadWeatherAt(saved.latitude, saved.longitude, saved.name, saved.subtitle ?? '', saved.id);
            return;
          }
        }
        await loadCurrentGps();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load weather.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadCurrentGps, loadWeatherAt, savedLocations, selectedId, weather],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedSettings, storedLocations, storedSelected, perm] = await Promise.all([
        loadSettings(),
        loadSavedLocations(),
        loadSelectedLocationId(),
        withTimeout(
          Location.getForegroundPermissionsAsync(),
          4000,
          'Location permission timed out.',
        ).catch(() => ({ status: Location.PermissionStatus.UNDETERMINED })),
      ]);
      if (cancelled) return;
      setSettings(storedSettings);
      setSavedLocations(storedLocations);
      setSelectedId(storedSelected);
      setPermission(perm.status);

      try {
        if (storedSelected !== 'current') {
          const saved = storedLocations.find((item) => item.id === storedSelected);
          if (saved) {
            await loadWeatherAt(saved.latitude, saved.longitude, saved.name, saved.subtitle ?? '', saved.id);
            return;
          }
        }
        if (perm.status === Location.PermissionStatus.GRANTED) {
          await loadCurrentGps();
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load weather.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCurrentGps, loadWeatherAt]);

  const requestPermission = useCallback(async () => {
    const result = await Location.requestForegroundPermissionsAsync();
    setPermission(result.status);
    if (result.status === Location.PermissionStatus.GRANTED) {
      setRefreshing(true);
      try {
        await loadCurrentGps();
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [loadCurrentGps]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings> | ((prev: Settings) => Settings)) => {
      const next = typeof patch === 'function' ? patch(settings) : { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);
      if (weather) {
        void syncWeatherNotifications(weather, next.alerts, placeName, next.units);
      }
    },
    [placeName, settings, weather],
  );

  const selectCurrentLocation = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadCurrentGps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load weather.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadCurrentGps]);

  const selectSavedLocation = useCallback(
    async (location: SavedLocation) => {
      setLoading(true);
      try {
        await loadWeatherAt(location.latitude, location.longitude, location.name, location.subtitle ?? '', location.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load weather.');
      } finally {
        setLoading(false);
      }
    },
    [loadWeatherAt],
  );

  const addSavedLocation = useCallback(async (location: Omit<SavedLocation, 'id'>) => {
    const next: SavedLocation = { ...location, id: `${location.latitude},${location.longitude}` };
    setSavedLocations((current) => {
      const merged = [next, ...current.filter((item) => item.id !== next.id)].slice(0, 12);
      void saveSavedLocations(merged);
      return merged;
    });
    await selectSavedLocation(next);
  }, [selectSavedLocation]);

  const removeSavedLocation = useCallback(
    async (id: string) => {
      const next = savedLocations.filter((item) => item.id !== id);
      setSavedLocations(next);
      await saveSavedLocations(next);
      if (selectedId === id) {
        await selectCurrentLocation();
      }
    },
    [savedLocations, selectCurrentLocation, selectedId],
  );

  const value = useMemo<AppState>(
    () => ({
      settings,
      weather,
      placeName,
      placeSubtitle,
      savedLocations,
      selectedId,
      loading,
      refreshing,
      error,
      permission,
      lastUpdated,
      coords,
      refresh,
      requestPermission,
      updateSettings,
      selectCurrentLocation,
      selectSavedLocation,
      addSavedLocation,
      removeSavedLocation,
    }),
    [
      addSavedLocation,
      coords,
      error,
      lastUpdated,
      loading,
      permission,
      placeName,
      placeSubtitle,
      refresh,
      refreshing,
      removeSavedLocation,
      requestPermission,
      savedLocations,
      selectCurrentLocation,
      selectSavedLocation,
      selectedId,
      settings,
      updateSettings,
      weather,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used within AppProvider');
  return value;
}
