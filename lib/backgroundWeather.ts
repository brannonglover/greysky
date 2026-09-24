import { requireOptionalNativeModule } from 'expo-modules-core';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { runWeatherRefresh } from './refreshWeatherCaches';

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
  // Defined at module scope, and this module is imported for its side effects
  // from app/_layout.tsx: on a headless launch the OS dispatches to the task
  // before any component renders, so it has to already exist.
  TaskManager.defineTask(BACKGROUND_WEATHER_TASK, async () => {
    try {
      const outcome = await runWeatherRefresh('background-task');
      // Only an outright forecast failure is worth reporting as one. A skipped
      // forecast means it was already fresh, which is a successful outcome for
      // this run even though it fetched nothing.
      return outcome.sources.forecast === 'failed'
        ? BackgroundTaskResult.Failed
        : BackgroundTaskResult.Success;
    } catch {
      return BackgroundTaskResult.Failed;
    }
  });
}

/**
 * Keeps the background refresh registered.
 *
 * Registration is unconditional: the task warms the cache the UI reads on
 * launch, which every user benefits from, not just the ones who opted into
 * notifications. The refresh itself decides whether to notify.
 *
 * This tier stays even once silent push lands. It is the only one that still
 * works when APNs, Expo's push service, or our own scheduler is unavailable.
 * Scheduling remains the system's call either way: iOS treats the 15-minute
 * floor as a request and runs the task when battery, network and usage
 * patterns suit it, and a force-quit app does not run at all.
 */
export async function syncBackgroundWeatherTask(): Promise<void> {
  if (Platform.OS === 'web' || !BackgroundTask) return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_WEATHER_TASK)) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_WEATHER_TASK, {
      minimumInterval: 15,
    });
  } catch {
    // Background refresh is best-effort; the foreground paths still work.
  }
}
