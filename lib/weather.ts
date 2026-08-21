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

export async function fetchAlerts(latitude: number, longitude: number): Promise<WeatherAlert[]> {
  try {
    const response = await fetch(
      `${NWS_ALERTS}?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`,
      {
        headers: {
          Accept: 'application/geo+json, application/json',
          'User-Agent': 'GreySkyWeather/1.1 (com.brannonglover.greysky; expo-app)',
        },
      },
    );
    if (!response.ok) return [];
    const json = (await response.json()) as {
      features?: {
        id: string;
        properties: {
          event?: string;
          headline?: string;
          description?: string;
          severity?: string;
          status?: string;
          messageType?: string;
          onset?: string;
          ends?: string;
        };
      }[];
    };
    return (json.features ?? [])
      .filter((feature) => {
        const props = feature.properties;
        const event = props.event?.trim();
        const headline = props.headline?.trim();
        if (!event && !headline) return false;
        if (props.status && props.status !== 'Actual') return false;
        if (props.messageType === 'Cancel') return false;
        return isActiveAlert(props.ends);
      })
      .slice(0, 6)
      .map((feature) => {
        const severity = feature.properties.severity;
        return {
          id: feature.id,
          event: feature.properties.event?.trim() || 'Weather alert',
          headline:
            feature.properties.headline?.trim() ||
            feature.properties.event?.trim() ||
            'Alert',
          description: feature.properties.description ?? '',
          severity:
            severity === 'Minor' ||
            severity === 'Moderate' ||
            severity === 'Severe' ||
            severity === 'Extreme'
              ? severity
              : 'Unknown',
          onset: feature.properties.onset,
          ends: feature.properties.ends,
        };
      });
  } catch {
    return [];
  }
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

export type RainFrame = {
  time: number;
  host: string;
  path: string;
};

const RADAR_PAST_SEC = 30 * 60;
const RADAR_FUTURE_SEC = 30 * 60;

type RadarStamp = { time: number; path: string };

export function radarHourWindow(nowSec = Date.now() / 1000): { start: number; end: number } {
  return { start: nowSec - RADAR_PAST_SEC, end: nowSec + RADAR_FUTURE_SEC };
}

/** Observed radar from the last 30 minutes plus nowcast through the next 30 minutes. */
export function selectRadarHourFrames(past: RadarStamp[], nowcast: RadarStamp[], nowSec = Date.now() / 1000): RadarStamp[] {
  const { start, end } = radarHourWindow(nowSec);
  const observed = past.filter((frame) => frame.time >= start && frame.time <= nowSec + 90);
  const future = nowcast.filter((frame) => frame.time > nowSec && frame.time <= end);
  const byTime = new Map<number, RadarStamp>();
  for (const frame of [...observed, ...future]) byTime.set(frame.time, frame);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function radarNowIndex(frames: { time: number }[], nowSec = Date.now() / 1000): number {
  if (frames.length === 0) return 0;
  const observed = frames
    .map((frame, index) => ({ frame, index }))
    .filter((item) => item.frame.time <= nowSec + 90);
  const pool = observed.length ? observed : frames.map((frame, index) => ({ frame, index }));
  return pool.reduce((best, item) => {
    const closer = Math.abs(item.frame.time - nowSec) < Math.abs(frames[best].time - nowSec);
    return closer ? item.index : best;
  }, pool[0].index);
}

export async function fetchRadarFrames(): Promise<RainFrame[]> {
  const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!response.ok) throw new Error('Radar unavailable');
  const json = (await response.json()) as {
    host: string;
    radar: {
      past: RadarStamp[];
      nowcast: RadarStamp[];
    };
  };
  const host = json.host.startsWith('http') ? json.host : `https://${json.host}`;
  return selectRadarHourFrames(json.radar.past ?? [], json.radar.nowcast ?? []).map((frame) => ({
    time: frame.time,
    host,
    path: frame.path,
  }));
}

export function radarTileUrl(frame: RainFrame): string {
  return `${frame.host}${frame.path}/256/{z}/{x}/{y}/8/1_1.png`;
}
