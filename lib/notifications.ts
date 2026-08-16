import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { AlertPrefs, WeatherBundle } from './types';
import { dailyPrecipLikely, rainStartsInMinutes } from './nowcast';
import { formatTemp } from './units';

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

export async function ensureNotificationSetup(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
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

async function cancelKnown(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => Object.values(IDS).includes(item.identifier))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
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

  await cancelKnown();

  if (prefs.nextHourPrecip) {
    const starts = rainStartsInMinutes(weather.minutely);
    if (starts !== null && starts <= 55) {
      const fireIn = Math.max(1, starts - 8);
      await Notifications.scheduleNotificationAsync({
        identifier: IDS.rain,
        content: {
          title: placeName,
          body: weather.nowcastSummary,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: fireIn * 60,
          channelId: Platform.OS === 'android' ? 'weather' : undefined,
        },
      });
    }
  }

  if (prefs.severeWeather && weather.alerts[0]) {
    await Notifications.scheduleNotificationAsync({
      identifier: IDS.severe,
      content: {
        title: weather.alerts[0].event,
        body: weather.alerts[0].headline,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
        channelId: Platform.OS === 'android' ? 'weather' : undefined,
      },
    });
  }

  const today = weather.daily[0];
  const morning = nextMorning(7);

  if (prefs.umbrella && dailyPrecipLikely(today)) {
    await Notifications.scheduleNotificationAsync({
      identifier: IDS.umbrella,
      content: {
        title: 'Umbrella reminder',
        body: `Rain looks likely in ${placeName} today.`,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: morning,
        channelId: Platform.OS === 'android' ? 'weather' : undefined,
      },
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
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: morning,
        channelId: Platform.OS === 'android' ? 'weather' : undefined,
      },
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
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: morning,
        channelId: Platform.OS === 'android' ? 'weather' : undefined,
      },
    });
  }
  } catch {
    // Local notifications are best-effort; forecast should still render.
  }
}
