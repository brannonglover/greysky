import { zonedIsoToMs } from './time';
import type { CurrentWeather, DayPoint, HourPoint, WeatherAlert, WeatherBundle } from './types';
import {
  daySummary,
  interpolateMinutely,
  isHeavyRainStormComing as stormIsComing,
  isPrecipComing as precipIsComing,
  nowcastSummary,
} from './nowcast';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const NWS_ALERTS = 'https://api.weather.gov/alerts/active';

type OpenMeteoResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  current: Record<string, number | string>;
  hourly: Record<string, (number | null)[] | string[]>;
  daily: Record<string, (number | null)[] | string[]>;
  minutely_15?: Record<string, (number | null)[] | string[]>;
};

type GeoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
};

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function n(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Prefer the combined precipitation field; fall back to rain+showers+snow when it is missing. */
function amountMm(precipitation: unknown, rain: unknown, showers: unknown, snow: unknown): number {
  return Math.max(n(precipitation), n(rain) + n(showers) + n(snow));
}

export async function fetchForecast(latitude: number, longitude: number): Promise<WeatherBundle> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: 'auto',
    precipitation_unit: 'mm',
    forecast_days: '10',
    forecast_minutely_15: '24',
    past_minutely_15: '1',
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'is_day',
      'precipitation',
      'rain',
      'showers',
      'snowfall',
      'weather_code',
      'cloud_cover',
      'pressure_msl',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'visibility',
    ].join(','),
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'rain',
      'showers',
      'snowfall',
      'weather_code',
      'cloud_cover',
      'visibility',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'uv_index',
      'is_day',
      'pressure_msl',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'apparent_temperature_max',
      'apparent_temperature_min',
      'sunrise',
      'sunset',
      'uv_index_max',
      'precipitation_sum',
      'precipitation_hours',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'wind_direction_10m_dominant',
      'snowfall_sum',
    ].join(','),
    minutely_15: 'precipitation,precipitation_probability,weather_code,rain,snowfall',
  });

  const response = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Forecast failed (${response.status})`);
  }
  const data = (await response.json()) as OpenMeteoResponse;

  const current: CurrentWeather = {
    time: String(data.current.time ?? new Date().toISOString()),
    temperature: n(data.current.temperature_2m),
    apparentTemperature: n(data.current.apparent_temperature),
    humidity: n(data.current.relative_humidity_2m),
    isDay: n(data.current.is_day) === 1,
    precipitation: amountMm(data.current.precipitation, data.current.rain, data.current.showers, data.current.snowfall),
    weatherCode: n(data.current.weather_code),
    cloudCover: n(data.current.cloud_cover),
    pressure: n(data.current.pressure_msl),
    windSpeed: n(data.current.wind_speed_10m),
    windDirection: n(data.current.wind_direction_10m),
    windGusts: n(data.current.wind_gusts_10m),
    visibility: n(data.current.visibility, 10000),
  };

  const hourlyTimes = arr<string>(data.hourly.time);
  const timeZone = data.timezone;
  const now = Date.now() - 30 * 60_000;
  const hourlyStart = Math.max(
    0,
    hourlyTimes.findIndex((t) => zonedIsoToMs(t, timeZone) >= now),
  );

  const hourly: HourPoint[] = hourlyTimes.slice(hourlyStart).map((time, offset) => {
    const i = hourlyStart + offset;
    return {
      time,
      temperature: n(arr<number>(data.hourly.temperature_2m)[i]),
      apparentTemperature: n(arr<number>(data.hourly.apparent_temperature)[i]),
      precipitationProbability: n(arr<number>(data.hourly.precipitation_probability)[i]),
      precipitation: amountMm(
        arr<number>(data.hourly.precipitation)[i],
        arr<number>(data.hourly.rain)[i],
        arr<number>(data.hourly.showers)[i],
        arr<number>(data.hourly.snowfall)[i],
      ),
      weatherCode: n(arr<number>(data.hourly.weather_code)[i]),
      cloudCover: n(arr<number>(data.hourly.cloud_cover)[i]),
      visibility: n(arr<number>(data.hourly.visibility)[i], 10000),
      windSpeed: n(arr<number>(data.hourly.wind_speed_10m)[i]),
      windDirection: n(arr<number>(data.hourly.wind_direction_10m)[i]),
      windGusts: n(arr<number>(data.hourly.wind_gusts_10m)[i]),
      uvIndex: n(arr<number>(data.hourly.uv_index)[i]),
      humidity: n(arr<number>(data.hourly.relative_humidity_2m)[i]),
      dewPoint: n(arr<number>(data.hourly.dew_point_2m)[i]),
      pressure: n(arr<number>(data.hourly.pressure_msl)[i]),
      isDay: n(arr<number>(data.hourly.is_day)[i]) === 1,
    };
  });

  const dailyTimes = arr<string>(data.daily.time);
  const daily: DayPoint[] = dailyTimes.map((date, i) => ({
    date,
    weatherCode: n(arr<number>(data.daily.weather_code)[i]),
    temperatureMax: n(arr<number>(data.daily.temperature_2m_max)[i]),
    temperatureMin: n(arr<number>(data.daily.temperature_2m_min)[i]),
    apparentMax: n(arr<number>(data.daily.apparent_temperature_max)[i]),
    apparentMin: n(arr<number>(data.daily.apparent_temperature_min)[i]),
    sunrise: String(arr<string>(data.daily.sunrise)[i] ?? ''),
    sunset: String(arr<string>(data.daily.sunset)[i] ?? ''),
    uvIndexMax: n(arr<number>(data.daily.uv_index_max)[i]),
    precipitationSum: n(arr<number>(data.daily.precipitation_sum)[i]),
    precipitationHours: n(arr<number>(data.daily.precipitation_hours)[i]),
    precipitationProbabilityMax: n(arr<number>(data.daily.precipitation_probability_max)[i]),
    windSpeedMax: n(arr<number>(data.daily.wind_speed_10m_max)[i]),
    windGustsMax: n(arr<number>(data.daily.wind_gusts_10m_max)[i]),
    windDirection: n(arr<number>(data.daily.wind_direction_10m_dominant)[i]),
    snowfallSum: n(arr<number>(data.daily.snowfall_sum)[i]),
  }));

  const minuteTimes = arr<string>(data.minutely_15?.time);
  const minutePrecip = minuteTimes.map((_, i) =>
    amountMm(
      arr<number | null>(data.minutely_15?.precipitation)[i],
      arr<number | null>(data.minutely_15?.rain)[i],
      0,
      arr<number | null>(data.minutely_15?.snowfall)[i],
    ),
  );
  const minutely = interpolateMinutely(
    minuteTimes,
    minutePrecip,
    arr<number | null>(data.minutely_15?.precipitation_probability),
    arr<number | null>(data.minutely_15?.weather_code),
    arr<number | null>(data.minutely_15?.snowfall),
    timeZone,
  );

  if (minutely.length === 0 && hourly.length > 0) {
    const first = hourly[0];
    const second = hourly[1] ?? hourly[0];
    const to15 = (hour: HourPoint) => {
      if (hour.precipitation >= 0.2) return hour.precipitation / 4;
      if (hour.precipitation > 0 && hour.precipitationProbability >= 40) return hour.precipitation / 4;
      return 0;
    };
    minutely.push(
      ...interpolateMinutely(
        [first.time, second.time],
        [to15(first), to15(second)],
        [first.precipitationProbability, second.precipitationProbability],
        [first.weatherCode, second.weatherCode],
        [0, 0],
        timeZone,
      ),
    );
  }

  return {
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
    current,
    minutely,
    hourly,
    daily,
    nowcastSummary: nowcastSummary(minutely, current.weatherCode),
    daySummary: daySummary(hourly, daily[0]),
    alerts: [],
    // The forecast service knows nothing about alerts. Callers merge a real
    // snapshot in; 0 keeps an un-merged bundle honest rather than letting it
    // claim a confirmed empty alert set.
    alertsVerifiedAt: 0,
  };
}

const INACTIVE_ALERT = /\b(test|exercise|cancelled|canceled|expired)\b/i;
const STORM_NAME = /\b(thunderstorms?|tornadoes?|flash\s*floods?|floods?|hurricanes?|blizzards?)\b/i;
const HAZARD_SIGNAL = /\b(warning|watch|emergency|severe)\b/i;
const NON_STORM_PRODUCT =
  /\b(air quality|special weather statement|beach|freeze|frost|wind chill)\b/i;

function isActiveAlert(ends?: string): boolean {
  if (!ends) return true;
  const end = Date.parse(ends);
  return Number.isNaN(end) || end > Date.now();
}

function alertText(alert: WeatherAlert): string {
  return `${alert.event} ${alert.headline}`.trim();
}

export function isStormAlert(alert: WeatherAlert): boolean {
  const text = alertText(alert);
  if (!text) return false;
  if (!isActiveAlert(alert.ends)) return false;
  if (INACTIVE_ALERT.test(text)) return false;

  const namedStorm = STORM_NAME.test(text);
  if (NON_STORM_PRODUCT.test(text) && !namedStorm) return false;

  // Flood / thunderstorm advisories match STORM_NAME. Ignore AQI / freeze / etc.
  return (
    namedStorm ||
    HAZARD_SIGNAL.test(text) ||
    alert.severity === 'Severe' ||
    alert.severity === 'Extreme'
  );
}

export function isSevereWeatherComing(alerts: WeatherAlert[]): boolean {
  return alerts.some(isStormAlert);
}

const IMMINENT_ALERT = /\b(warning|emergency)\b/i;
const WITHIN_HOUR_MS = 60 * 60_000;

function alertOnsetWithinHour(alert: WeatherAlert): boolean {
  if (!alert.onset) return true;
  const start = Date.parse(alert.onset);
  return Number.isNaN(start) || start <= Date.now() + WITHIN_HOUR_MS;
}

/** Warning / emergency for a storm that is in effect or starts within the hour. */
export function isImminentStormAlert(alerts: WeatherAlert[]): boolean {
  return alerts.some((alert) => isStormAlert(alert) && IMMINENT_ALERT.test(alertText(alert)) && alertOnsetWithinHour(alert));
}

/** True when the hourly card shows the rain/nowcast intensity chart. Alerts are not required. */
export function isPrecipComing(weather: WeatherBundle): boolean {
  return precipIsComing(weather.minutely, weather.hourly);
}

/** Pin radar above the hourly card for a storm warning or heavy rain in the next hour. */
export function shouldPromoteRadarMap(weather: WeatherBundle): boolean {
  if (isImminentStormAlert(weather.alerts)) return true;
  return stormIsComing(
    weather.minutely,
    weather.hourly,
    weather.current.weatherCode,
    weather.current.precipitation,
    weather.timezone,
  );
}

/**
 * Raw NWS alert shape. Shared by the point query and the regional sweep so the
 * two cannot drift into filtering or naming alerts differently.
 */
export type AlertFeature = {
  id: string;
  geometry?: { type: string; coordinates: unknown } | null;
  properties: {
    event?: string;
    headline?: string;
    description?: string;
    severity?: string;
    status?: string;
    messageType?: string;
    onset?: string;
    ends?: string;
    areaDesc?: string;
  };
};

export type AlertResponse = { features?: AlertFeature[] };

/** Drops tests, cancellations and anything already expired. */
export function usableAlertFeatures(json: AlertResponse): AlertFeature[] {
  return (json.features ?? []).filter((feature) => {
    const props = feature.properties;
    if (!props.event?.trim() && !props.headline?.trim()) return false;
    if (props.status && props.status !== 'Actual') return false;
    if (props.messageType === 'Cancel') return false;
    return isActiveAlert(props.ends);
  });
}

export function toWeatherAlert(feature: AlertFeature): WeatherAlert {
  const severity = feature.properties.severity;
  return {
    id: feature.id,
    event: feature.properties.event?.trim() || 'Weather alert',
    headline:
      feature.properties.headline?.trim() || feature.properties.event?.trim() || 'Alert',
    description: feature.properties.description ?? '',
    severity:
      severity === 'Minor' || severity === 'Moderate' || severity === 'Severe' || severity === 'Extreme'
        ? severity
        : 'Unknown',
    onset: feature.properties.onset,
    ends: feature.properties.ends,
  };
}

/**
 * Active NWS alerts for a point.
 *
 * Throws rather than returning an empty list when the service cannot be
 * reached. An empty result has to mean "NWS confirmed there is nothing here";
 * if a network failure could also produce it, a live tornado warning would
 * vanish from the cache the first time the request timed out. Callers decide
 * what to keep on failure — see `nextAlertSnapshot`.
 */
export async function fetchAlerts(latitude: number, longitude: number): Promise<WeatherAlert[]> {
  const response = await fetch(
    `${NWS_ALERTS}?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    {
      headers: {
        Accept: 'application/geo+json, application/json',
        'User-Agent': 'GreySkyWeather/1.1 (com.brannonglover.greysky; expo-app)',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`NWS alerts unavailable (${response.status})`);
  }
  const json = (await response.json()) as AlertResponse;
  return usableAlertFeatures(json).slice(0, 6).map(toWeatherAlert);
}

/**
 * A fetch that may not have been made at all.
 *
 * `skipped` is distinct from `rejected`: nothing went wrong, the data was
 * simply still fresh. Both leave the previous value in place, but only
 * `rejected` means the source is in trouble.
 */
export type Attempt<T> = PromiseSettledResult<T> | { status: 'skipped' };

export type AlertSnapshot = {
  alerts: WeatherAlert[];
  /** When this set was last confirmed against NWS; 0 if it never has been. */
  verifiedAt: number;
};

/**
 * How long an alert set is treated as currently confirmed.
 *
 * Matched to the foreground refresh cadence: inside this window the app has
 * either just fetched or is about to, so the displayed set is as current as
 * the app is capable of being. Past it, the set is still shown — hiding a
 * possible warning is the worse error — but labelled as last-known.
 */
export const ALERT_CONFIRMED_MS = 10 * 60_000;

export type AlertConfidence = 'confirmed' | 'unconfirmed';

export function alertConfidence(verifiedAt: number, now: number = Date.now()): AlertConfidence {
  if (!verifiedAt) return 'unconfirmed';
  return now - verifiedAt <= ALERT_CONFIRMED_MS ? 'confirmed' : 'unconfirmed';
}

/**
 * The alert set to keep after an attempt to refresh it.
 *
 * A rejected fetch is not evidence that the alerts are gone, so the previous
 * set survives with its **original** `verifiedAt` — the age keeps growing, and
 * the UI degrades to last-known rather than silently presenting stale warnings
 * as current. Only a successful fetch may remove an alert, because cancellation
 * cannot be detected from the cached copy: a canceled warning keeps whatever
 * future `ends` time it was issued with.
 */
export function nextAlertSnapshot(
  previous: AlertSnapshot | null,
  result: Attempt<WeatherAlert[]>,
  now: number = Date.now(),
): AlertSnapshot {
  if (result.status === 'fulfilled') {
    return { alerts: result.value, verifiedAt: now };
  }
  return previous ?? { alerts: [], verifiedAt: 0 };
}

export async function searchPlaces(query: string): Promise<GeoResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const params = new URLSearchParams({
    name: trimmed,
    count: '8',
    language: 'en',
    format: 'json',
  });
  const response = await fetch(`${GEOCODE_URL}?${params.toString()}`);
  if (!response.ok) return [];
  const json = (await response.json()) as { results?: GeoResult[] };
  return json.results ?? [];
}
