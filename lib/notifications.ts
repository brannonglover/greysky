import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { AlertPrefs, WeatherBundle } from './types';
import { dailyPrecipLikely, rainStartsInMinutes } from './nowcast';
import { loadNotifyState, saveNotifyState } from './storage';
import { formatTemp } from './units';
import { isSevereWeatherComing } from './weather';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
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
  umbrella: 'umbra-umbrella',
  sunscreen: 'umbra-sunscreen',
  daily: 'umbra-daily',
};

export function alertsEnabled(prefs: AlertPrefs): boolean {
  return prefs.nextHourPrecip || prefs.severeWeather || prefs.umbrella || prefs.sunscreen || prefs.dailySummary;
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
            title: top.event,
            body: fresh.length > 1 ? `${top.headline} · +${fresh.length - 1} more` : top.headline,
            sound: true,
          },
          trigger: intervalTrigger(1),
        });
      }
      const activeIds = incoming.map((alert) => alert.id);
      severeIds = [...new Set([...severeIds.filter((id) => activeIds.includes(id)), ...activeIds])];
    } else {
      await cancelId(IDS.severe);
      severeIds = [];
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

    await saveNotifyState({ rainNotified, severeIds });
  } catch {
    // Local notifications are best-effort; forecast should still render.
  }
}
