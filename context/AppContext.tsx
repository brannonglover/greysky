import * as Location from 'expo-location';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { syncBackgroundWeatherTask } from '@/lib/backgroundWeather';
import { syncPushRefreshTask } from '@/lib/pushRefresh';
import { skyFromWeather, type SkyPalette } from '@/lib/sky';
import type { SavedLocation, Settings, WeatherBundle } from '@/lib/types';
import {
  alertsEnabled,
  ensureNotificationSetup,
  syncOutlookNotifications,
  syncTropicalNotifications,
  syncWeatherNotifications,
} from '@/lib/notifications';
import { fetchRegionalAlerts, type RegionalAlert } from '@/lib/regional';
import { fetchSpcOutlook, type DayOutlook } from '@/lib/spc';
import {
  defaultSettings,
  loadAwarenessCache,
  loadSavedLocations,
  loadSelectedLocationId,
  loadSettings,
  loadTropicalCache,
  loadWeatherCache,
  recordRefreshSuccess,
  saveAwarenessCache,
  saveLastPlace,
  saveSavedLocations,
  saveSelectedLocationId,
  saveSettings,
  saveTropicalCache,
  saveWeatherCache,
  type AwarenessCache,
} from '@/lib/storage';
import { fetchTropicalReports, type TropicalReport } from '@/lib/tropical';
import { useOnAppResume } from '@/lib/useOnAppResume';
import {
  fetchAlerts,
  fetchForecast,
  nextAlertSnapshot,
  type AlertSnapshot,
} from '@/lib/weather';

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
  /**
   * Whether an attempt to confirm the alert set has finished this session,
   * successfully or not. Separates a cold start from an outage: until this is
   * true and nothing has ever been confirmed, the app is still checking.
   */
  alertsAttempted: boolean;
  coords: { latitude: number; longitude: number } | null;
  sky: SkyPalette;
  /** Active tropical cyclones with this location's exposure resolved. */
  tropical: TropicalReport[];
  tropicalLoading: boolean;
  refreshTropical: () => Promise<void>;
  /** SPC severe-weather outlooks covering this location, 1–3 days out. */
  outlooks: DayOutlook[];
  /** Significant alerts around the region. Awareness only — never notified. */
  regional: RegionalAlert[];
  refreshAwareness: () => Promise<void>;
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
/** NHC issues advisories every six hours, so polling harder buys nothing. */
const TROPICAL_REFRESH_MS = 30 * 60_000;
/** SPC reissues day 1 five times a day; regional alerts move faster. */
const AWARENESS_REFRESH_MS = 10 * 60_000;
/** A cached awareness sweep only describes the area it was taken in. */
const AWARENESS_CACHE_RADIUS_DEG = 0.5;

/**
 * Filters a cached awareness sweep against the validity windows the sources
 * publish themselves, so warming the Storms tab from cache can never present
 * an outlook or a warning that has already expired as if it were current.
 */
function liveAwareness(cache: AwarenessCache, now: number = Date.now()) {
  return {
    outlooks: cache.outlooks.filter((day) => day.validTo > now),
    regional: cache.regional.filter((item) => {
      const ends = item.alert.ends ? Date.parse(item.alert.ends) : Number.NaN;
      return Number.isNaN(ends) || ends > now;
    }),
  };
}

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
  const [alertsAttempted, setAlertsAttempted] = useState(false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [tropical, setTropical] = useState<TropicalReport[]>([]);
  const [tropicalLoading, setTropicalLoading] = useState(false);
  const [outlooks, setOutlooks] = useState<DayOutlook[]>([]);
  const [regional, setRegional] = useState<RegionalAlert[]>([]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The last alert set NWS actually confirmed, so a failed refresh can keep it
  // rather than writing an empty one. Keyed by place: alerts belonging to the
  // location the user just left must never carry over to the new one.
  const alertSnapshot = useRef<{ selectedId: string | 'current'; snapshot: AlertSnapshot } | null>(
    null,
  );

  const loadWeatherAt = useCallback(
    async (latitude: number, longitude: number, name: string, subtitle: string, persistId: string | 'current') => {
      // Keep the identity stable when the fix has not moved, so the automatic
      // refresh does not cascade into re-fetches by everything keyed on coords.
      setCoords((prev) =>
        prev && prev.latitude === latitude && prev.longitude === longitude ? prev : { latitude, longitude },
      );
      setPlaceName(name);
      setPlaceSubtitle(subtitle);
      // Settled rather than all: NWS being unreachable must not cost the user
      // their forecast, and must not be recorded as "no alerts here".
      const [forecastResult, alertsResult] = await Promise.allSettled([
        fetchForecast(latitude, longitude),
        fetchAlerts(latitude, longitude),
      ]);
      // Resolved either way, so the app is no longer merely "checking".
      setAlertsAttempted(true);
      if (forecastResult.status === 'rejected') throw forecastResult.reason;

      const previous =
        alertSnapshot.current?.selectedId === persistId ? alertSnapshot.current.snapshot : null;
      const snapshot = nextAlertSnapshot(previous, alertsResult);
      alertSnapshot.current = { selectedId: persistId, snapshot };

      const bundle = {
        ...forecastResult.value,
        alerts: snapshot.alerts,
        alertsVerifiedAt: snapshot.verifiedAt,
      };
      // Only what actually succeeded is recorded. Opening the app is not
      // evidence that its data refreshed, so a session whose alert fetch failed
      // must not push the next background wake further out.
      void recordRefreshSuccess({
        forecast: Date.now(),
        alerts: alertsResult.status === 'fulfilled' ? Date.now() : undefined,
      });
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
        // Permission or GPS failures never reach NWS, but the user has still
        // been told everything the app knows — leaving them on "checking"
        // forever would be its own kind of dishonesty.
        setAlertsAttempted(true);
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
  const live = useRef({
    loading, refreshing, coords, placeName, placeSubtitle, selectedId, lastUpdated, refresh,
    alertIds: [] as string[],
  });
  live.current = {
    loading, refreshing, coords, placeName, placeSubtitle, selectedId, lastUpdated, refresh,
    // So the regional sweep can drop anything already shown as affecting the user.
    alertIds: weather?.alerts.map((alert) => alert.id) ?? [],
  };

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
          // Only adopt a cache written for the place that is currently
          // selected — the background refresh may have run while a different
          // location was showing.
          if (
            cached &&
            cached.selectedId === state.selectedId &&
            cached.timestamp > (state.lastUpdated?.getTime() ?? 0)
          ) {
            setWeather(cached.bundle);
            alertSnapshot.current = {
              selectedId: cached.selectedId,
              snapshot: {
                alerts: cached.bundle.alerts,
                verifiedAt: cached.bundle.alertsVerifiedAt,
              },
            };
            setPlaceName(cached.placeName);
            setPlaceSubtitle(cached.placeSubtitle);
            setCoords((prev) =>
              prev && prev.latitude === cached.latitude && prev.longitude === cached.longitude
                ? prev
                : { latitude: cached.latitude, longitude: cached.longitude },
            );
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

  // Tropical systems are fetched on their own schedule rather than inside
  // loadWeatherAt. NHC advisories move on a six-hourly cycle, and a slow
  // response must never hold up the forecast the whole app is built around.
  const tropicalRequest = useRef(0);

  const refreshTropical = useCallback(async () => {
    const point = live.current.coords;
    if (!point) return;
    const id = ++tropicalRequest.current;
    setTropicalLoading(true);
    try {
      const reports = await fetchTropicalReports(point.latitude, point.longitude);
      if (id !== tropicalRequest.current) return;
      void recordRefreshSuccess({ tropical: Date.now() });
      setTropical(reports);
      await saveTropicalCache({
        reports,
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: Date.now(),
      });
      const currentSettings = settingsRef.current;
      await syncTropicalNotifications(reports, currentSettings.alerts, live.current.placeName);
    } catch {
      // The Storms tab falls back to alerts and forecast signals.
    } finally {
      if (id === tropicalRequest.current) setTropicalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;

    // Show the cached copy first so the tab has content the moment it opens,
    // but only when it was taken near enough that its exposure maths still holds.
    void (async () => {
      const cached = await loadTropicalCache();
      if (cancelled || !cached) return;
      const moved =
        Math.abs(cached.latitude - coords.latitude) > 1 ||
        Math.abs(cached.longitude - coords.longitude) > 1;
      if (!moved && Date.now() - cached.timestamp < 6 * 60 * 60_000) {
        setTropical(cached.reports);
      }
    })();

    void refreshTropical();
    const timer = setInterval(() => void refreshTropical(), TROPICAL_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [coords, refreshTropical]);

  useOnAppResume(() => void refreshTropical());

  // SPC outlooks and the regional sweep ride alongside the tropical fetch —
  // independent of the forecast, and independent of each other, so one slow or
  // unavailable source never costs the others.
  const awarenessRequest = useRef(0);
  /** When the awareness data now on screen was taken, so a cache read can tell
   * whether it would be going backwards. */
  const awarenessAt = useRef(0);

  const refreshAwareness = useCallback(async () => {
    const point = live.current.coords;
    if (!point) return;
    const id = ++awarenessRequest.current;

    const localAlertIds = live.current.alertIds;
    const [outlookResult, regionalResult] = await Promise.allSettled([
      fetchSpcOutlook(point.latitude, point.longitude),
      fetchRegionalAlerts(point.latitude, point.longitude, localAlertIds),
    ]);
    if (id !== awarenessRequest.current) return;
    awarenessAt.current = Date.now();
    void recordRefreshSuccess({
      outlook: outlookResult.status === 'fulfilled' ? Date.now() : undefined,
      regional: regionalResult.status === 'fulfilled' ? Date.now() : undefined,
    });

    if (outlookResult.status === 'fulfilled') {
      setOutlooks(outlookResult.value);
      const currentSettings = settingsRef.current;
      await syncOutlookNotifications(
        outlookResult.value,
        currentSettings.alerts,
        live.current.placeName,
      );
    }
    if (regionalResult.status === 'fulfilled') {
      setRegional(regionalResult.value);
    }

    // Cached only when the whole sweep succeeded: writing a half-empty sweep
    // would drop the good half of whatever the last full one stored.
    if (outlookResult.status === 'fulfilled' && regionalResult.status === 'fulfilled') {
      await saveAwarenessCache({
        outlooks: outlookResult.value,
        regional: regionalResult.value,
        latitude: point.latitude,
        longitude: point.longitude,
        timestamp: Date.now(),
      });
    }
  }, []);

  /**
   * Shows the last sweep the background refresh (or a previous session) stored,
   * so the Storms tab has content before the network answers.
   */
  const hydrateAwareness = useCallback(async () => {
    const point = live.current.coords;
    if (!point) return;
    try {
      const cached = await loadAwarenessCache();
      // Never go backwards: a sweep may have landed while this read was out.
      if (!cached || cached.timestamp <= awarenessAt.current) return;
      const moved =
        Math.abs(cached.latitude - point.latitude) > AWARENESS_CACHE_RADIUS_DEG ||
        Math.abs(cached.longitude - point.longitude) > AWARENESS_CACHE_RADIUS_DEG;
      if (moved) return;
      const fresh = liveAwareness(cached);
      if (fresh.outlooks.length) setOutlooks(fresh.outlooks);
      if (fresh.regional.length) setRegional(fresh.regional);
      awarenessAt.current = cached.timestamp;
    } catch {
      // Cache read is best-effort; the sweep below is the real source.
    }
  }, []);

  useEffect(() => {
    if (!coords) return;
    void (async () => {
      await hydrateAwareness();
      await refreshAwareness();
    })();
    const timer = setInterval(() => void refreshAwareness(), AWARENESS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [coords, hydrateAwareness, refreshAwareness]);

  useOnAppResume(() => {
    void (async () => {
      await hydrateAwareness();
      await refreshAwareness();
    })();
  });

  useEffect(() => {
    let cancelled = false;
    // Both wake paths are registered on every launch, independent of settings
    // and of whether the first fetch succeeds: they fill the cache read just
    // below, so the next launch has content before the network is touched.
    // Registering the push task needs no permission and no token — whether a
    // silent push can actually be delivered is a separate question.
    void syncBackgroundWeatherTask();
    void syncPushRefreshTask();
    (async () => {
      const [storedSettings, storedLocations, storedSelected, perm, cached, cachedAwareness] = await Promise.all([
        loadSettings(),
        loadSavedLocations(),
        loadSelectedLocationId(),
        withTimeout(
          Location.getForegroundPermissionsAsync(),
          4000,
          'Location permission timed out.',
        ).catch(() => ({ status: Location.PermissionStatus.UNDETERMINED })),
        loadWeatherCache(),
        loadAwarenessCache(),
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
        alertSnapshot.current = {
          selectedId: cached.selectedId,
          snapshot: {
            alerts: cached.bundle.alerts,
            verifiedAt: cached.bundle.alertsVerifiedAt,
          },
        };
        setPlaceName(cached.placeName);
        setPlaceSubtitle(cached.placeSubtitle);
        setCoords({ latitude: cached.latitude, longitude: cached.longitude });
        setLastUpdated(new Date(cached.timestamp));
        setLoading(false);

        // The Storms tab is warmed from the same launch, so it is populated if
        // the user opens it before the first sweep of this session lands.
        if (cachedAwareness) {
          const moved =
            Math.abs(cachedAwareness.latitude - cached.latitude) > AWARENESS_CACHE_RADIUS_DEG ||
            Math.abs(cachedAwareness.longitude - cached.longitude) > AWARENESS_CACHE_RADIUS_DEG;
          if (!moved) {
            const fresh = liveAwareness(cachedAwareness);
            if (fresh.outlooks.length) setOutlooks(fresh.outlooks);
            if (fresh.regional.length) setRegional(fresh.regional);
            awarenessAt.current = cachedAwareness.timestamp;
          }
        }
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
      alertsAttempted,
      coords,
      sky,
      tropical,
      tropicalLoading,
      refreshTropical,
      outlooks,
      regional,
      refreshAwareness,
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
      alertsAttempted,
      coords,
      error,
      lastUpdated,
      loading,
      permission,
      placeName,
      placeSubtitle,
      refresh,
      refreshing,
      outlooks,
      refreshAwareness,
      refreshTropical,
      regional,
      removeSavedLocation,
      requestPermission,
      savedLocations,
      selectCurrentLocation,
      selectSavedLocation,
      selectedId,
      settings,
      sky,
      tropical,
      tropicalLoading,
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
