import {
  alertsEnabled,
  syncOutlookNotifications,
  syncTropicalNotifications,
  syncWeatherNotifications,
} from './notifications';
import { fetchRegionalAlerts } from './regional';
import { fetchSpcOutlook } from './spc';
import {
  loadRefreshState,
  loadSettings,
  loadWeatherCache,
  recordRefreshSuccess,
  resolveSelectedPlace,
  saveAwarenessCache,
  saveTropicalCache,
  saveWeatherCache,
} from './storage';
import { fetchTropicalReports } from './tropical';
import { fetchAlerts, fetchForecast, nextAlertSnapshot, type Attempt } from './weather';
import { shouldAttempt, type RefreshSource, type RefreshState } from './wakeSchedule';

export { nextWakeAfter } from './wakeSchedule';

/**
 * The single refresh implementation.
 *
 * Every way the app can wake — the background task, a silent push, or an
 * explicit call — runs exactly this code. Keeping one implementation is what
 * stops the cache the background writes from drifting out of step with the
 * cache the foreground expects to read, which is a bug this app has already
 * had once.
 */

export type RefreshTrigger = 'background-task' | 'push' | 'manual';

export type SourceOutcome = 'ok' | 'failed' | 'skipped';

export type RefreshOutcome = {
  trigger: RefreshTrigger;
  /** False when every source was skipped, so nothing was fetched. */
  ran: boolean;
  at: number;
  sources: Record<RefreshSource, SourceOutcome>;
  /** Last successful fetch per source, after this run. */
  verified: RefreshState;
};

/**
 * Guards against true concurrency only.
 *
 * Two callers arriving while a refresh is in flight share its result rather
 * than starting a second one. Deciding whether a *completed* refresh should
 * stop the next attempt is deliberately not done here — that is per source,
 * via `shouldAttempt`, so a run that lost one source can retry just that one.
 */
let inFlight: Promise<RefreshOutcome> | null = null;

const SKIPPED = { status: 'skipped' } as const;

/**
 * Fetches a source unless it succeeded moments ago, reporting all three
 * outcomes so the caller can tell "no new data" from "no data".
 */
async function attempt<T>(
  verifiedAt: number,
  now: number,
  fetcher: () => Promise<T>,
): Promise<Attempt<T>> {
  if (!shouldAttempt(verifiedAt, now)) return SKIPPED;
  try {
    return { status: 'fulfilled', value: await fetcher() };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function outcomeOf(result: Attempt<unknown>): SourceOutcome {
  if (result.status === 'fulfilled') return 'ok';
  return result.status === 'skipped' ? 'skipped' : 'failed';
}

function successAt<T>(result: Attempt<T>, now: number): number | undefined {
  return result.status === 'fulfilled' ? now : undefined;
}

async function performRefresh(trigger: RefreshTrigger): Promise<RefreshOutcome> {
  const startedAt = Date.now();
  const [settings, place, state] = await Promise.all([
    loadSettings(),
    resolveSelectedPlace(),
    loadRefreshState(),
  ]);

  if (!place) {
    return {
      trigger,
      ran: false,
      at: startedAt,
      sources: {
        forecast: 'skipped',
        alerts: 'skipped',
        tropical: 'skipped',
        outlook: 'skipped',
        regional: 'skipped',
      },
      verified: state,
    };
  }

  const { latitude, longitude } = place;

  // Every source is fetched regardless of notification settings. What these
  // fill is the cache the UI adopts on launch, so how fresh the app looks
  // cannot depend on whether the user wants to be interrupted.
  //
  // Each is attempted independently: one service being down must not cost the
  // others their cache entry, and a source that just succeeded is skipped so a
  // duplicate wake-up costs nothing.
  const [forecastResult, alertsResult, tropicalResult, outlookResult] = await Promise.all([
    attempt(state.forecast, startedAt, () => fetchForecast(latitude, longitude)),
    attempt(state.alerts, startedAt, () => fetchAlerts(latitude, longitude)),
    attempt(state.tropical, startedAt, () => fetchTropicalReports(latitude, longitude)),
    attempt(state.outlook, startedAt, () => fetchSpcOutlook(latitude, longitude)),
  ]);

  // A failed alerts fetch keeps the last confirmed set rather than writing an
  // empty one, which would read as "the Weather Service says you are clear".
  const previousCache = await loadWeatherCache();
  const samePlace = previousCache?.selectedId === place.selectedId;
  const previousAlerts =
    previousCache && samePlace
      ? { alerts: previousCache.bundle.alerts, verifiedAt: previousCache.bundle.alertsVerifiedAt }
      : null;
  const snapshot = nextAlertSnapshot(previousAlerts, alertsResult, startedAt);

  // The regional sweep drops anything already shown as affecting the user, so
  // it can only run once the local alerts are in hand.
  const regionalResult = await attempt(state.regional, startedAt, () =>
    fetchRegionalAlerts(latitude, longitude, snapshot.alerts.map((alert) => alert.id)),
  );

  const at = Date.now();
  const writes: Promise<unknown>[] = [];

  // Only rewritten when both halves were actually fetched. A skipped source has
  // a fresh cache entry already, and a failed one must not overwrite a good
  // entry with an empty sweep.
  if (outlookResult.status === 'fulfilled' && regionalResult.status === 'fulfilled') {
    writes.push(
      saveAwarenessCache({
        outlooks: outlookResult.value,
        regional: regionalResult.value,
        latitude,
        longitude,
        timestamp: at,
      }),
    );
  }

  // A skipped forecast still lets newly fetched alerts reach the cache: the
  // cached bundle is current by definition, so it is a valid base to merge on.
  const base =
    forecastResult.status === 'fulfilled'
      ? forecastResult.value
      : forecastResult.status === 'skipped' && previousCache && samePlace
        ? previousCache.bundle
        : null;
  const bundle = base
    ? { ...base, alerts: snapshot.alerts, alertsVerifiedAt: snapshot.verifiedAt }
    : null;
  const bundleIsNew =
    forecastResult.status === 'fulfilled' || alertsResult.status === 'fulfilled';

  if (bundle && bundleIsNew) {
    writes.push(
      saveWeatherCache({
        bundle,
        placeName: place.name,
        placeSubtitle: place.subtitle,
        latitude,
        longitude,
        selectedId: place.selectedId,
        timestamp: at,
      }),
    );
    if (alertsEnabled(settings.alerts)) {
      writes.push(syncWeatherNotifications(bundle, settings.alerts, place.name, settings.units));
    }
  }

  if (tropicalResult.status === 'fulfilled') {
    writes.push(
      saveTropicalCache({ reports: tropicalResult.value, latitude, longitude, timestamp: at }),
    );
    if (alertsEnabled(settings.alerts)) {
      writes.push(syncTropicalNotifications(tropicalResult.value, settings.alerts, place.name));
    }
  }

  if (outlookResult.status === 'fulfilled' && alertsEnabled(settings.alerts)) {
    writes.push(syncOutlookNotifications(outlookResult.value, settings.alerts, place.name));
  }

  await Promise.all(writes);

  const results = {
    forecast: forecastResult,
    alerts: alertsResult,
    tropical: tropicalResult,
    outlook: outlookResult,
    regional: regionalResult,
  } satisfies Record<RefreshSource, Attempt<unknown>>;

  const verified = await recordRefreshSuccess(
    {
      forecast: successAt(forecastResult, at),
      alerts: successAt(alertsResult, at),
      tropical: successAt(tropicalResult, at),
      outlook: successAt(outlookResult, at),
      regional: successAt(regionalResult, at),
    },
    startedAt,
  );

  const sources = {
    forecast: outcomeOf(forecastResult),
    alerts: outcomeOf(alertsResult),
    tropical: outcomeOf(tropicalResult),
    outlook: outcomeOf(outlookResult),
    regional: outcomeOf(regionalResult),
  } satisfies Record<RefreshSource, SourceOutcome>;

  return {
    trigger,
    ran: Object.values(results).some((result) => result.status !== 'skipped'),
    at,
    sources,
    verified,
  };
}

/**
 * Refreshes every cache the app reads on launch.
 *
 * Safe to call from anywhere and at any time. Overlapping calls share one
 * network round; a call arriving just after a completed run re-attempts only
 * the sources that did not succeed in it.
 */
export async function runWeatherRefresh(trigger: RefreshTrigger): Promise<RefreshOutcome> {
  if (inFlight) return inFlight;

  inFlight = performRefresh(trigger).finally(() => {
    inFlight = null;
  });

  return inFlight;
}
