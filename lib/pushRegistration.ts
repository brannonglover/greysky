import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { loadInstallId, loadRefreshState } from './storage';
import { nextWakeAfter, type RefreshSource, type RefreshState } from './wakeSchedule';

/**
 * The device half of the wake queue.
 *
 * **Transport is deliberately absent.** Everything here is local: it assembles
 * what the device would tell a scheduler and computes when it wants waking, but
 * sends nothing. Two things have to exist before it can:
 *
 *   - an APNs push key on the EAS project, without which
 *     `getExpoPushTokenAsync` fails and there is no token to register
 *   - a `/api/push/register` endpoint with somewhere to store the record
 *
 * Neither is assumed here. `buildHeartbeat` is the seam: when the endpoint
 * exists, posting its output is the whole client change.
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

const SOURCES: RefreshSource[] = ['forecast', 'alerts', 'tropical', 'outlook', 'regional'];

/** The most recent successful fetch across all sources. */
export function lastRefreshAt(state: RefreshState): number {
  return SOURCES.reduce((latest, source) => Math.max(latest, state[source]), 0);
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

/**
 * What this device would report to a wake scheduler right now.
 *
 * Pure apart from reading local storage, so the payload can be inspected and
 * asserted on before any server exists to receive it.
 */
export async function buildHeartbeat(now: number = Date.now()): Promise<Heartbeat> {
  const [installId, state] = await Promise.all([loadInstallId(), loadRefreshState()]);
  return {
    installId,
    platform: Platform.OS,
    appVersion: appVersion(),
    lastRefreshAt: lastRefreshAt(state),
    nextWakeAfter: nextWakeAfter(state, now),
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
