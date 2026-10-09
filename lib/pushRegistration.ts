import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { RADAR_API } from './radar/api';
import {
  loadHeartbeatSent,
  loadInstallId,
  loadRefreshState,
  loadWeatherCache,
  saveHeartbeatSent,
} from './storage';
import { isSevereWeatherComing } from './weather';
import { nextWakeAfter, type RefreshSource, type RefreshState } from './wakeSchedule';

/**
 * The device half of the wake queue.
 *
 * Assembles a heartbeat, obtains an Expo push token when possible, and POSTs
 * to `/api/push/register` so the server can silently wake this device when its
 * own `nextWakeAfter` comes due. Failures are swallowed: the background-task
 * and foreground tiers still run without this path.
 */

export type Heartbeat = {
  /** Stable per-install key. Not the push token, which rotates. */
  installId: string;
  platform: 'ios' | 'android' | 'web' | string;
  appVersion: string;
  /**
   * When any source was last successfully confirmed, or 0 if none ever has
   * been. Distinct from "when the app was last open" — a session whose requests
   * all failed does not move this.
   */
  lastRefreshAt: number;
  /** When this device would like its next background wake. */
  nextWakeAfter: number;
};

export type RegistrationPayload = Heartbeat & {
  token: string;
};

const SOURCES: RefreshSource[] = ['forecast', 'alerts', 'tropical', 'outlook', 'regional'];

/** The most recent successful fetch across all sources. */
export function lastRefreshAt(state: RefreshState): number {
  return SOURCES.reduce((latest, source) => Math.max(latest, state[source]), 0);
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/**
 * What this device would report to a wake scheduler right now.
 *
 * Pure apart from reading local storage, so the payload can be inspected and
 * asserted on before any server exists to receive it.
 */
export async function buildHeartbeat(now: number = Date.now()): Promise<Heartbeat> {
  const [installId, state, cache] = await Promise.all([
    loadInstallId(),
    loadRefreshState(),
    loadWeatherCache(),
  ]);
  const stormWatch = cache ? isSevereWeatherComing(cache.bundle.alerts) : false;
  return {
    installId,
    platform: Platform.OS,
    appVersion: appVersion(),
    lastRefreshAt: lastRefreshAt(state),
    nextWakeAfter: nextWakeAfter(state, now, { stormWatch }),
  };
}

/**
 * Whether a heartbeat is worth sending again.
 *
 * Registration must not be per-launch. A user who opens the app six times in an
 * evening should cost one call, so the device re-posts only when its requested
 * wake time has moved materially or the record has aged out.
 */
export const HEARTBEAT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const HEARTBEAT_DRIFT_MS = 30 * 60_000;

export function heartbeatChanged(
  previous: Heartbeat | null,
  next: Heartbeat,
  sentAt: number,
  now: number = Date.now(),
): boolean {
  if (!previous) return true;
  if (previous.installId !== next.installId) return true;
  if (previous.appVersion !== next.appVersion) return true;
  if (now - sentAt >= HEARTBEAT_MAX_AGE_MS) return true;
  return Math.abs(next.nextWakeAfter - previous.nextWakeAfter) >= HEARTBEAT_DRIFT_MS;
}

async function resolvePushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const id = projectId();
  if (!id) return null;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return result.data || null;
  } catch {
    // Offline, simulator, or missing APNs key — retry on a later launch.
    return null;
  }
}

/**
 * Register (or refresh) this install with the wake scheduler.
 *
 * Safe to call from launch, after a refresh, or after notification permission
 * changes. Does nothing on web, when the token cannot be obtained, or when the
 * heartbeat has not moved enough to be worth another POST.
 */
export async function syncPushRegistration(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    const [heartbeat, previous] = await Promise.all([buildHeartbeat(), loadHeartbeatSent()]);
    if (
      previous &&
      !heartbeatChanged(previous.heartbeat, heartbeat, previous.sentAt)
    ) {
      return false;
    }

    const token = await resolvePushToken();
    if (!token) return false;

    const payload: RegistrationPayload = { ...heartbeat, token };
    const response = await fetch(`${RADAR_API}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return false;

    await saveHeartbeatSent({ heartbeat, token, sentAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the scheduler to forget this install (notification opt-out).
 */
export async function unregisterPushRegistration(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const installId = await loadInstallId();
    await fetch(`${RADAR_API}/api/push/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installId }),
    });
    await saveHeartbeatSent(null);
  } catch {
    // Best-effort; receipts will cull a dead token later.
  }
}
