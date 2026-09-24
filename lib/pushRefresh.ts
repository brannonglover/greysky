import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { runWeatherRefresh } from './refreshWeatherCaches';

export const BACKGROUND_NOTIFICATION_TASK = 'grey-sky-push-refresh';

/**
 * Refreshes the caches when a silent push says the device is due.
 *
 * The push carries no weather content — only the instruction to refresh — so
 * this handler runs the same `runWeatherRefresh` as every other wake path. It
 * is deliberately not a second refresh implementation: the device fetches its
 * own exact-point data, and nothing the server sends can end up on screen.
 *
 * iOS gives no guarantee any of this happens. Apple throttles background
 * pushes, delivers them at its own convenience, and delivers none at all once
 * the user force-quits the app. That is why this is one of three tiers rather
 * than the mechanism: `expo-background-task` runs the same refresh
 * opportunistically, and the foreground refresh remains the guarantee.
 */

/** The payload shape the server sends. Anything else is ignored. */
type RefreshPayload = {
  kind: 'refresh';
  at?: number;
};

function isRefreshPayload(data: unknown): data is RefreshPayload {
  if (!data || typeof data !== 'object') return false;
  // The push may arrive wrapped by the notification envelope or flattened,
  // depending on platform, so look in both places rather than assuming one.
  const record = data as Record<string, unknown>;
  const direct = record.kind;
  const nested = (record.data as Record<string, unknown> | undefined)?.kind;
  return direct === 'refresh' || nested === 'refresh';
}

if (Platform.OS !== 'web') {
  // Module scope, and this module is imported for its side effects from
  // app/_layout.tsx: on a headless launch the OS dispatches to the task before
  // any component renders, so it has to already exist.
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    BACKGROUND_NOTIFICATION_TASK,
    async ({ data, error }) => {
      if (error) return;
      // A tap on a visible notification also routes here on Android. Those
      // carry an actionIdentifier and are not refresh instructions.
      if (data && typeof data === 'object' && 'actionIdentifier' in data) return;
      if (!isRefreshPayload(data)) return;
      try {
        await runWeatherRefresh('push');
      } catch {
        // The background task and the next foreground open both still apply.
      }
    },
  );
}

/**
 * Registers the push-refresh task.
 *
 * Separate from `registerForPushNotificationsAsync`: defining and registering
 * the task costs nothing and needs no permission or token, so it is safe to do
 * on every launch. Whether the device can actually *receive* a silent push is a
 * different question, answered by the registration flow once an APNs key
 * exists for the project.
 */
export async function syncPushRefreshTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK)) return;
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  } catch {
    // Best-effort, exactly like the background task.
  }
}
