import { requireOptionalNativeModule } from 'expo-modules-core';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { alertsEnabled, syncWeatherNotifications } from './notifications';
import { loadLastPlace, loadSettings } from './storage';
import type { AlertPrefs } from './types';
import { fetchAlerts, fetchForecast } from './weather';

export const BACKGROUND_WEATHER_TASK = 'grey-sky-weather-check';

const BackgroundTaskResult = {
  Success: 1,
  Failed: 2,
} as const;

type BackgroundTaskModule = typeof import('expo-background-task');

function loadBackgroundTask(): BackgroundTaskModule | null {
  if (Platform.OS === 'web') return null;
  if (!requireOptionalNativeModule('ExpoBackgroundTask')) return null;
  try {
    return require('expo-background-task') as BackgroundTaskModule;
  } catch {
    return null;
  }
}

const BackgroundTask = loadBackgroundTask();

if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKGROUND_WEATHER_TASK, async () => {
    try {
      const settings = await loadSettings();
      if (!alertsEnabled(settings.alerts)) {
        return BackgroundTaskResult.Success;
      }
      const place = await loadLastPlace();
      if (!place) return BackgroundTaskResult.Success;
      const [forecast, alerts] = await Promise.all([
        fetchForecast(place.latitude, place.longitude),
        fetchAlerts(place.latitude, place.longitude),
      ]);
      await syncWeatherNotifications(
        { ...forecast, alerts },
        settings.alerts,
        place.name,
        settings.units,
      );
      return BackgroundTaskResult.Success;
    } catch {
      return BackgroundTaskResult.Failed;
    }
  });
}

export async function syncBackgroundWeatherTask(prefs: AlertPrefs): Promise<void> {
  if (Platform.OS === 'web' || !BackgroundTask) return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_WEATHER_TASK);
    if (!alertsEnabled(prefs)) {
      if (registered) await BackgroundTask.unregisterTaskAsync(BACKGROUND_WEATHER_TASK);
      return;
    }
    if (!registered) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_WEATHER_TASK, {
        minimumInterval: 15,
      });
    }
  } catch {
    // Background refresh is best-effort; foreground alerts still work.
  }
}
