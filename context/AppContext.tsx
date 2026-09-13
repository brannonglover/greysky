import * as Location from 'expo-location';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { syncBackgroundWeatherTask } from '@/lib/backgroundWeather';
import { skyFromWeather, type SkyPalette } from '@/lib/sky';
import type { SavedLocation, Settings, WeatherBundle } from '@/lib/types';
import { alertsEnabled, ensureNotificationSetup, syncWeatherNotifications } from '@/lib/notifications';
import {
  defaultSettings,
  loadSavedLocations,
  loadSelectedLocationId,
  loadSettings,
  loadWeatherCache,
  saveLastPlace,
  saveSavedLocations,
  saveSelectedLocationId,
  saveSettings,
  saveWeatherCache,
} from '@/lib/storage';
import { useOnAppResume } from '@/lib/useOnAppResume';
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
  sky: SkyPalette;
  refresh: (force?: boolean) => Promise<void>;
  requestPermission: () => Promise<void>;
  updateSettings: (patch: Partial<Settings> | ((prev: Settings) => Settings)) => Promise<void>;
  selectCurrentLocation: () => Promise<void>;
  selectSavedLocation: (location: SavedLocation) => Promise<void>;
  addSavedLocation: (location: Omit<SavedLocation, 'id'>) => Promise<void>;
  removeSavedLocation: (id: string) => Promise<void>;
};

const AppContext = createContext<AppState | null>(null);

/** How stale the forecast may get before the foreground timer re-fetches it. */
const AUTO_REFRESH_MS = 10 * 60_000;
/** Returning to the app only re-locates if the data has had time to drift. */
const RESUME_STALE_MS = 2 * 60_000;

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
      // Keep the identity stable when the fix has not moved, so the automatic
      // refresh does not cascade into re-fetches by everything keyed on coords.
      setCoords((prev) =>
        prev && prev.latitude === latitude && prev.longitude === longitude ? prev : { latitude, longitude },
      );
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
      await Promise.all([
        saveLastPlace({ latitude, longitude, name }),
        saveWeatherCache({
          bundle,
          placeName: name,
          placeSubtitle: subtitle,
          latitude,
          longitude,
          selectedId: persistId,
          timestamp: Date.now(),
        }),
      ]);
      const currentSettings = settingsRef.current;
      void (async () => {
        if (alertsEnabled(currentSettings.alerts)) {
          await ensureNotificationSetup();
        }
        await syncWeatherNotifications(bundle, currentSettings.alerts, name, currentSettings.units);
        await syncBackgroundWeatherTask(currentSettings.alerts);
      })();
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

  // Snapshot of everything the automatic refreshes read, so the timer and the
  // resume handler can stay mounted once instead of tearing down on every
  // state change.
  const live = useRef({ loading, refreshing, coords, placeName, placeSubtitle, selectedId, lastUpdated, refresh });
  live.current = { loading, refreshing, coords, placeName, placeSubtitle, selectedId, lastUpdated, refresh };

  const autoRefresh = useCallback(
    async (maxAgeMs: number, relocate: boolean) => {
      const state = live.current;
      if (state.loading || state.refreshing) return;

      // On resume, check whether the background task cached fresher data while
      // the app was suspended.  If so, apply it instantly so the UI is already
      // up-to-date before the network fetch completes.
      if (relocate) {
        try {
          const cached = await loadWeatherCache();
          if (cached && cached.timestamp > (state.lastUpdated?.getTime() ?? 0)) {
            setWeather(cached.bundle);
            setPlaceName(cached.placeName);
            setPlaceSubtitle(cached.placeSubtitle);
            setCoords({ latitude: cached.latitude, longitude: cached.longitude });
            setLastUpdated(new Date(cached.timestamp));
          }
        } catch {
          // Cache read is best-effort.
        }
      }

      if (Date.now() - (state.lastUpdated?.getTime() ?? 0) < maxAgeMs) return;
      try {
        // A resume may follow the user moving, so that path re-reads GPS. The
        // timer keeps the existing fix to avoid waking the radio every tick.
        if (relocate) {
          await state.refresh();
        } else if (state.coords) {
          await loadWeatherAt(
            state.coords.latitude,
            state.coords.longitude,
            state.placeName,
            state.placeSubtitle,
            state.selectedId,
          );
        }
      } catch {
        // Silent: this runs without the user asking, and the visible error
        // state belongs to explicit refreshes.
      }
    },
    [loadWeatherAt],
  );

  useEffect(() => {
    const timer = setInterval(() => void autoRefresh(AUTO_REFRESH_MS, false), 60_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  useOnAppResume(() => void autoRefresh(RESUME_STALE_MS, true));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedSettings, storedLocations, storedSelected, perm, cached] = await Promise.all([
        loadSettings(),
        loadSavedLocations(),
        loadSelectedLocationId(),
        withTimeout(
          Location.getForegroundPermissionsAsync(),
          4000,
          'Location permission timed out.',
        ).catch(() => ({ status: Location.PermissionStatus.UNDETERMINED })),
        loadWeatherCache(),
      ]);
      if (cancelled) return;
      setSettings(storedSettings);
      setSavedLocations(storedLocations);
      setSelectedId(storedSelected);
      setPermission(perm.status);

      // Instantly show cached weather (may have been refreshed by background
      // task) so the user sees content the moment the app opens.
      if (cached && cached.selectedId === storedSelected) {
        setWeather(cached.bundle);
        setPlaceName(cached.placeName);
        setPlaceSubtitle(cached.placeSubtitle);
        setCoords({ latitude: cached.latitude, longitude: cached.longitude });
        setLastUpdated(new Date(cached.timestamp));
        setLoading(false);
      }

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
      void syncBackgroundWeatherTask(next.alerts);
      if (weather) {
        if (alertsEnabled(next.alerts)) {
          await ensureNotificationSetup();
        }
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

  const sky = useMemo(() => skyFromWeather(weather), [weather]);

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
      sky,
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
      sky,
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
