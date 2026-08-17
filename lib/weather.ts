import { zonedIsoToMs } from './time';
import type { CurrentWeather, DayPoint, HourPoint, WeatherAlert, WeatherBundle } from './types';
import { daySummary, interpolateMinutely, nowcastSummary } from './nowcast';

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

export async function fetchForecast(latitude: number, longitude: number): Promise<WeatherBundle> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: 'auto',
    forecast_days: '8',
    forecast_minutely_15: '8',
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
    precipitation: n(data.current.precipitation),
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

  const hourly: HourPoint[] = hourlyTimes.slice(hourlyStart, hourlyStart + 48).map((time, offset) => {
    const i = hourlyStart + offset;
    return {
      time,
      temperature: n(arr<number>(data.hourly.temperature_2m)[i]),
      apparentTemperature: n(arr<number>(data.hourly.apparent_temperature)[i]),
      precipitationProbability: n(arr<number>(data.hourly.precipitation_probability)[i]),
      precipitation: n(arr<number>(data.hourly.precipitation)[i]),
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

  const minutely = interpolateMinutely(
    arr<string>(data.minutely_15?.time),
    arr<number | null>(data.minutely_15?.precipitation),
    arr<number | null>(data.minutely_15?.precipitation_probability),
    arr<number | null>(data.minutely_15?.weather_code),
    arr<number | null>(data.minutely_15?.snowfall),
    timeZone,
  );

  if (minutely.length === 0 && hourly.length > 0) {
    const first = hourly[0];
    const second = hourly[1] ?? hourly[0];
    minutely.push(
      ...interpolateMinutely(
        [first.time, second.time],
        [first.precipitation / 4, second.precipitation / 4],
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

export async function fetchAlerts(latitude: number, longitude: number): Promise<WeatherAlert[]> {
  try {
    const response = await fetch(
      `${NWS_ALERTS}?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`,
      {
        headers: {
          Accept: 'application/geo+json',
          'User-Agent': 'GreySkyWeather/1.0 (local-expo-app)',
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
          onset?: string;
          ends?: string;
        };
      }[];
    };
    return (json.features ?? []).slice(0, 6).map((feature) => {
      const severity = feature.properties.severity;
      return {
        id: feature.id,
        event: feature.properties.event ?? 'Weather alert',
        headline: feature.properties.headline ?? feature.properties.event ?? 'Alert',
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

export async function fetchRadarFrames(): Promise<RainFrame[]> {
  const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!response.ok) throw new Error('Radar unavailable');
  const json = (await response.json()) as {
    host: string;
    radar: {
      past: { time: number; path: string }[];
      nowcast: { time: number; path: string }[];
    };
  };
  const host = json.host.startsWith('http') ? json.host : `https://${json.host}`;
  return [...json.radar.past.slice(-8), ...json.radar.nowcast].map((frame) => ({
    time: frame.time,
    host,
    path: frame.path,
  }));
}

export function radarTileUrl(frame: RainFrame): string {
  return `${frame.host}${frame.path}/256/{z}/{x}/{y}/8/1_1.png`;
}
