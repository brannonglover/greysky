/**
 * When this device next needs waking.
 *
 * Deliberately free of native imports so it can be exercised directly in
 * node — the scheduling policy is the part most likely to regress silently,
 * because a wrong answer looks like nothing at all until data goes stale.
 */

export type RefreshSource = 'forecast' | 'alerts' | 'tropical' | 'outlook' | 'regional';

/** Epoch millis of the last successful fetch per source; 0 means never. */
export type RefreshState = Record<RefreshSource, number> & {
  /** Last time a refresh was attempted at all, successful or not. */
  lastAttemptAt: number;
};

export const emptyRefreshState: RefreshState = {
  forecast: 0,
  alerts: 0,
  tropical: 0,
  outlook: 0,
  regional: 0,
  lastAttemptAt: 0,
};

/**
 * How long after a successful fetch each source wants another look.
 *
 * These are **wake cadences, not freshness ideals**, and the difference
 * matters. The UI would prefer the minute nowcast under half an hour old, but
 * Apple's guidance is not to send more than two or three background pushes an
 * hour, and exceeding it gets the whole app throttled rather than the extra
 * message dropped. Waking on the ideal would mean roughly seventy wakes a day.
 *
 * So these are set to what the push budget can actually sustain — around a
 * dozen wakes a day — and the gap between ideal and achievable is covered by
 * the other two tiers: opportunistic background-task runs land in between, and
 * the foreground refresh is the guarantee whenever the user actually looks.
 *
 * Splitting per source is what lets failure pull the next wake *closer*: a
 * source that failed keeps its old timestamp, so its due time falls into the
 * past and the device is rescheduled at the retry floor below.
 */
export const WAKE_AFTER_MS: Record<RefreshSource, number> = {
  forecast: 2 * 60 * 60_000,
  alerts: 2 * 60 * 60_000,
  regional: 3 * 60 * 60_000,
  // SPC reissues day 1 five times a day; NHC advisories run six-hourly.
  outlook: 6 * 60 * 60_000,
  tropical: 6 * 60 * 60_000,
};

/**
 * How recently a source must have **succeeded** for a second wake to skip it.
 *
 * A silent push and a background task can land seconds apart for the same
 * opportunity, and re-fetching everything twice wastes the device's battery
 * and the upstream's capacity. But this is decided per source, never per run:
 * a source that failed has a stale timestamp, so a duplicate wake retries it
 * immediately. Treating "a refresh happened recently" as a reason to skip
 * everything would suppress recovery from exactly the partial failures that
 * most need another attempt.
 */
export const DUPLICATE_WAKE_MS = 90_000;

/**
 * Whether this source is worth fetching again right now.
 *
 * Reads only the last *successful* fetch, so a source that just failed always
 * returns true — the failure is the reason to try again, not a reason to wait.
 */
export function shouldAttempt(verifiedAt: number, now: number = Date.now()): boolean {
  if (verifiedAt === 0) return true;
  return now - verifiedAt >= DUPLICATE_WAKE_MS;
}

/**
 * The retry floor. Only binds when something failed or has never been
 * confirmed — a healthy device is never due this soon — so it sets how fast we
 * retry after an outage, not the normal cadence.
 */
export const MIN_WAKE_GAP_MS = 20 * 60_000;
/** Nor later than this, so a quiet device still checks in. */
export const MAX_WAKE_GAP_MS = 8 * 60 * 60_000;

/**
 * When this device should next be woken, derived from the last **successful**
 * fetch of each source rather than from when the app was last open.
 *
 * `lastAttemptAt` is deliberately not consulted. A foreground session whose
 * requests all failed does not postpone anything: the source timestamps did
 * not move, so the due time does not either. Opening the app is not evidence
 * that its data got refreshed.
 */
export function nextWakeAfter(state: RefreshState, now: number = Date.now()): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const source of Object.keys(WAKE_AFTER_MS) as RefreshSource[]) {
    const verifiedAt = state[source];
    // Never confirmed: due immediately, subject to the floor below.
    earliest = Math.min(earliest, verifiedAt === 0 ? now : verifiedAt + WAKE_AFTER_MS[source]);
  }
  if (!Number.isFinite(earliest)) earliest = now;
  return Math.min(Math.max(earliest, now + MIN_WAKE_GAP_MS), now + MAX_WAKE_GAP_MS);
}
