import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { AlertPrefs, Units, WeatherBundle } from './types';
import { dailyPrecipLikely, rainStartsInMinutes } from './nowcast';
import { approximateWhen, forecastStormSignals, signalDetail, signalKey } from './stormOutlook';
import { loadNotifyState, saveNotifyState, type TropicalNotifyState } from './storage';
import {
  decideOutlookNotification,
  hazardSentence,
  outlookHeadline,
  riskSentence,
  type DayOutlook,
} from './spc';
import { exposureLabel, type TropicalReport } from './tropical';
import { formatTemp } from './units';
import { isSevereWeatherComing } from './weather';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

const IDS = {
  rain: 'umbra-rain',
  severe: 'umbra-severe',
  outlook: 'umbra-outlook',
  strongStorm: 'umbra-strong-storm',
  tropical: 'umbra-tropical',
  umbrella: 'umbra-umbrella',
  sunscreen: 'umbra-sunscreen',
  daily: 'umbra-daily',
};

export function alertsEnabled(prefs: AlertPrefs): boolean {
  return (
    prefs.nextHourPrecip ||
    prefs.severeWeather ||
    prefs.severeOutlook ||
    prefs.strongStorm ||
    prefs.tropical ||
    prefs.umbrella ||
    prefs.sunscreen ||
    prefs.dailySummary
  );
}

export async function ensureNotificationSetup(options?: { prompt?: boolean }): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted && options?.prompt !== false) {
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    granted = requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }
  if (granted && Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('weather', {
      name: 'Weather',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 80, 180],
      lightColor: '#5AA7FF',
    });
    await Notifications.setNotificationChannelAsync('severe', {
      name: 'Severe Weather Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 120, 250, 120, 250],
      lightColor: '#FF3B30',
      bypassDnd: true,
    });
  }
  return granted;
}

async function cancelId(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered or never scheduled.
  }
}

function intervalTrigger(seconds: number): Notifications.NotificationTriggerInput {
  const trigger: Notifications.NotificationTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: Math.max(1, Math.round(seconds)),
    repeats: false,
  };
  if (Platform.OS === 'android') {
    return { ...trigger, channelId: 'weather' };
  }
  return trigger;
}

/**
 * High-priority delivery for storms worth interrupting for. Official alerts
 * and tropical exposure both earn it; derived signals do not, which is part of
 * keeping the two clearly separate.
 */
function urgentTrigger(seconds = 1): Notifications.NotificationTriggerInput {
  if (Platform.OS === 'android') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.round(seconds)),
      repeats: false,
      channelId: 'severe',
    };
  }
  return intervalTrigger(seconds);
}

function nextMorning(hour = 7): Date {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

export async function syncWeatherNotifications(
  weather: WeatherBundle,
  prefs: AlertPrefs,
  placeName: string,
  units: 'us' | 'si',
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const allowed = await Notifications.getPermissionsAsync();
    const granted =
      allowed.granted || allowed.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted) return;

    const state = await loadNotifyState();
    let rainNotified = state.rainNotified;
    let severeIds = state.severeIds;
    let stormSignalKey = state.stormSignalKey;

    if (prefs.nextHourPrecip) {
      const starts = rainStartsInMinutes(weather.minutely);
      const expecting = starts !== null && starts <= 55;
      if (expecting && !rainNotified) {
        const seconds = starts <= 12 ? 1 : Math.max(60, (starts - 8) * 60);
        await Notifications.scheduleNotificationAsync({
          identifier: IDS.rain,
          content: {
            title: placeName,
            body: weather.nowcastSummary,
            sound: true,
          },
          trigger: intervalTrigger(seconds),
        });
        rainNotified = true;
      } else if (!expecting) {
        await cancelId(IDS.rain);
        rainNotified = false;
      }
    } else {
      await cancelId(IDS.rain);
      rainNotified = false;
    }

    if (prefs.severeWeather) {
      const incoming = weather.alerts.filter((alert) => isSevereWeatherComing([alert]));
      const fresh = incoming.filter((alert) => !severeIds.includes(alert.id));
      if (fresh.length > 0) {
        const top = fresh[0];
        await Notifications.scheduleNotificationAsync({
          identifier: IDS.severe,
          content: {
            // The exact NWS event name, verbatim — this is an official product
            // and must read as one.
            title: top.event,
            body: fresh.length > 1 ? `${top.headline} · +${fresh.length - 1} more` : top.headline,
            sound: true,
            ...(Platform.OS === 'ios' ? { interruptionLevel: 'timeSensitive' } : {}),
          },
          trigger: urgentTrigger(),
        });
      }
      const activeIds = incoming.map((alert) => alert.id);
      severeIds = [...new Set([...severeIds.filter((id) => activeIds.includes(id)), ...activeIds])];
    } else {
      await cancelId(IDS.severe);
      severeIds = [];
    }

    // Grey Sky's own read of the forecast. Deliberately worded so it can never
    // be mistaken for the official alert above: no event name, no "warning" or
    // "watch", and timing hedged to what an hourly model can actually support.
    if (prefs.strongStorm) {
      const [signal] = forecastStormSignals(weather);
      if (!signal) {
        await cancelId(IDS.strongStorm);
        stormSignalKey = null;
      } else if (signalKey(signal) !== stormSignalKey) {
        const detail = signalDetail(signal, units);
        const when = approximateWhen(signal.startsAt, signal.startsAtIso);
        await Notifications.scheduleNotificationAsync({
          identifier: IDS.strongStorm,
          content: {
            title: signal.headline,
            body: detail
              ? `${placeName} — ${when}. ${detail[0].toUpperCase()}${detail.slice(1)}.`
              : `${placeName} — ${when}.`,
            sound: true,
          },
          trigger: intervalTrigger(1),
        });
        stormSignalKey = signalKey(signal);
      }
    } else {
      await cancelId(IDS.strongStorm);
      stormSignalKey = null;
    }

    await Promise.all([cancelId(IDS.umbrella), cancelId(IDS.sunscreen), cancelId(IDS.daily)]);

    const today = weather.daily[0];
    const morning = nextMorning(7);
    const morningTrigger: Notifications.NotificationTriggerInput =
      Platform.OS === 'android'
        ? {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: morning,
            channelId: 'weather',
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: morning,
          };

    if (prefs.umbrella && dailyPrecipLikely(today)) {
      await Notifications.scheduleNotificationAsync({
        identifier: IDS.umbrella,
        content: {
          title: 'Umbrella reminder',
          body: `Rain looks likely in ${placeName} today.`,
          sound: true,
        },
        trigger: morningTrigger,
      });
    }

    if (prefs.sunscreen && (today?.uvIndexMax ?? 0) >= 6) {
      await Notifications.scheduleNotificationAsync({
        identifier: IDS.sunscreen,
        content: {
          title: 'Sunscreen reminder',
          body: `UV reaches ${Math.round(today.uvIndexMax)} today in ${placeName}.`,
          sound: true,
        },
        trigger: morningTrigger,
      });
    }

    if (prefs.dailySummary && today) {
      await Notifications.scheduleNotificationAsync({
        identifier: IDS.daily,
        content: {
          title: `${placeName}: ${formatTemp(today.temperatureMax, units)} / ${formatTemp(today.temperatureMin, units)}`,
          body: weather.daySummary,
          sound: false,
        },
        trigger: morningTrigger,
      });
    }

    await saveNotifyState({ ...state, rainNotified, severeIds, stormSignalKey });
  } catch {
    // Local notifications are best-effort; forecast should still render.
  }
}

// ---------------------------------------------------------------------------
// Tropical cyclones
// ---------------------------------------------------------------------------

/** A closest approach nearer than this is worth re-announcing. */
const TROPICAL_CONCERN_KM = 400;
/** How much nearer the forecast must move before it counts as news. */
const CLOSER_FRACTION = 0.75;
/** How much earlier an exposure window must shift before it counts as news. */
const EARLIER_MS = 6 * 60 * 60_000;

function tropicalBody(report: TropicalReport, placeName: string): string {
  const { exposure, closest } = report.threat;
  if (exposure) {
    const when = approximateWhen(exposure.startsAt);
    const caveat = exposure.fromOutlook ? ' Track still uncertain this far out.' : '';
    return `${exposureLabel(exposure.strength)} possible in ${placeName} ${when}.${caveat}`;
  }
  const km = Math.round(closest?.distanceKm ?? report.threat.distanceKm);
  return `Forecast to pass about ${km} km from ${placeName}.`;
}

/**
 * Whether this storm's threat to the user has meaningfully changed since the
 * last time we said anything about it.
 *
 * The bar is deliberately high. A hurricane can stay active for a fortnight,
 * and a notification on every advisory cycle would train the user to ignore
 * exactly the alerts that matter most. Only a wind field newly reaching them,
 * a window moving materially sooner, or a materially closer forecast pass
 * counts — never the mere existence of a storm.
 */
function tropicalChange(
  report: TropicalReport,
  previous: TropicalNotifyState | undefined,
): boolean {
  const { exposure, closest } = report.threat;
  const closestKm = closest?.distanceKm ?? report.threat.distanceKm;

  if (!previous) {
    // First sighting is only news if it actually threatens this location.
    return exposure !== null || closestKm <= TROPICAL_CONCERN_KM;
  }

  if (exposure && previous.exposureStart === null) return true;
  if (exposure && previous.exposureStart !== null && exposure.startsAt <= previous.exposureStart - EARLIER_MS) {
    return true;
  }
  if (closestKm <= TROPICAL_CONCERN_KM && closestKm <= previous.closestKm * CLOSER_FRACTION) return true;

  return false;
}

/**
 * Tropical alerts, kept separate from the forecast sync because the storm
 * service is fetched on its own schedule and must never delay the forecast.
 *
 * A local NWS hurricane or tropical storm watch/warning is deliberately not
 * handled here — that is an official product and already goes out through the
 * severe-weather path, so routing it here too would double-notify.
 */
export async function syncTropicalNotifications(
  reports: TropicalReport[],
  prefs: AlertPrefs,
  placeName: string,
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    if (!prefs.tropical) {
      await cancelId(IDS.tropical);
      const state = await loadNotifyState();
      if (Object.keys(state.tropical).length > 0) {
        await saveNotifyState({ ...state, tropical: {} });
      }
      return;
    }

    const allowed = await Notifications.getPermissionsAsync();
    const granted =
      allowed.granted || allowed.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted) return;

    const state = await loadNotifyState();
    const next: Record<string, TropicalNotifyState> = {};
    const newsworthy: TropicalReport[] = [];

    for (const report of reports) {
      const previous = state.tropical[report.storm.id];
      const closestKm = report.threat.closest?.distanceKm ?? report.threat.distanceKm;
      const changed = tropicalChange(report, previous);

      if (changed) newsworthy.push(report);

      // Carry the previous record forward when nothing changed, so a storm
      // that drifts slowly never accumulates its way into a notification.
      next[report.storm.id] = changed
        ? {
            exposureStart: report.threat.exposure?.startsAt ?? null,
            closestKm,
            notifiedAt: Date.now(),
          }
        : (previous ?? { exposureStart: null, closestKm, notifiedAt: 0 });
    }

    if (newsworthy.length > 0) {
      // Lead with whatever actually reaches the user, not whatever is biggest.
      const top =
        newsworthy.find((report) => report.threat.exposure !== null) ?? newsworthy[0];
      await Notifications.scheduleNotificationAsync({
        identifier: IDS.tropical,
        content: {
          title: `${top.storm.name}`,
          body: tropicalBody(top, placeName),
          sound: true,
          ...(Platform.OS === 'ios' && top.threat.exposure
            ? { interruptionLevel: 'timeSensitive' as const }
            : {}),
        },
        trigger: top.threat.exposure ? urgentTrigger() : intervalTrigger(1),
      });
    }

    await saveNotifyState({ ...state, tropical: next });
  } catch {
    // Tropical alerts are best-effort; the Storms tab still renders.
  }
}

// ---------------------------------------------------------------------------
// SPC outlooks
// ---------------------------------------------------------------------------

/**
 * The earliest stage of the progression, and the one most at risk of becoming
 * noise: SPC reissues the day-1 outlook five times a day, and a risk period
 * stays in view for three days before it arrives.
 *
 * So the rule is driven by change, not by presence:
 *
 *   new meaningful outlook  →  notify once
 *   material upgrade        →  notify again
 *   unchanged reissue       →  silent
 *   downgrade               →  silent, but remember the new level
 *
 * The first sighting deliberately counts as news. An Enhanced Risk appearing
 * for Thursday is exactly what the user wants to hear about, and a rule that
 * only fired on an *increase* would never announce it.
 */
export async function syncOutlookNotifications(
  outlooks: DayOutlook[],
  prefs: AlertPrefs,
  placeName: string,
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    if (!prefs.severeOutlook) {
      await cancelId(IDS.outlook);
      const state = await loadNotifyState();
      if (Object.keys(state.outlooks).length > 0) {
        await saveNotifyState({ ...state, outlooks: {} });
      }
      return;
    }

    const allowed = await Notifications.getPermissionsAsync();
    const granted =
      allowed.granted || allowed.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted) return;

    const state = await loadNotifyState();
    const { announce, next } = decideOutlookNotification(outlooks, state.outlooks, Date.now());

    if (announce) {
      await Notifications.scheduleNotificationAsync({
        identifier: IDS.outlook,
        content: {
          // Hedged, and never the words "warning" or "watch" — this is a risk
          // assessment from SPC, not an official product for this location.
          title: outlookHeadline(announce),
          body: `${riskSentence(announce)} ${hazardSentence(announce)} — ${placeName}`,
          sound: true,
        },
        // Days out. Worth knowing, never worth breaking through a focus mode.
        trigger: intervalTrigger(1),
      });
    }

    await saveNotifyState({ ...state, outlooks: next });
  } catch {
    // Outlook alerts are best-effort; the Storms tab still renders them.
  }
}
