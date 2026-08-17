import { intensityFromMm } from '@/lib/precip';
import { zonedIsoToMs } from '@/lib/time';
import type { MinutePoint, WeatherBundle } from '@/lib/types';
import { isSnowCode } from '@/lib/wmo';

export type RainLevel = 0 | 1 | 2 | 3;

export type SkyPalette = {
  gradient: readonly [string, string, string];
  locations: readonly [number, number, number];
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  onAccent: string;
  surface: string;
  surfaceRaised: string;
  divider: string;
  overlay: string;
  precip: string;
  precipFill: string;
  precipHeavy: string;
  rain: RainLevel;
};

type Condition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'heavy' | 'storm' | 'snow';
type Phase = 'night' | 'dawn' | 'day' | 'dusk';

const INK = {
  text: '#F4F0E6',
  textSecondary: 'rgba(244, 240, 230, 0.86)',
  textTertiary: 'rgba(244, 240, 230, 0.7)',
  accent: '#E8C9A0',
  onAccent: '#1C1915',
  surface: 'rgba(8, 14, 22, 0.38)',
  surfaceRaised: 'rgba(8, 14, 22, 0.5)',
  divider: 'rgba(255, 255, 255, 0.22)',
  overlay: 'rgba(12, 16, 24, 0.4)',
  precip: '#8EC5E0',
  precipFill: 'rgba(142, 197, 224, 0.42)',
  precipHeavy: '#D2EAF6',
} as const;

const SKIES: Record<Condition, Record<Phase, readonly [string, string, string]>> = {
  clear: {
    day: ['#1A4E86', '#2F74A8', '#3A6B78'],
    dawn: ['#8A3E36', '#B45C42', '#3A4E72'],
    dusk: ['#A04838', '#6A3A58', '#1E2438'],
    night: ['#0B1220', '#172544', '#243056'],
  },
  partly: {
    day: ['#1E4A70', '#3A6A88', '#4A6570'],
    dawn: ['#8A4A40', '#A06050', '#3A5068'],
    dusk: ['#8A4038', '#5A3A50', '#222838'],
    night: ['#101828', '#1C2A40', '#2A3850'],
  },
  cloudy: {
    day: ['#3A4A58', '#4E5E6A', '#5A6268'],
    dawn: ['#5A4A4A', '#6A5A58', '#3A4A58'],
    dusk: ['#4A4048', '#3A4048', '#2A3038'],
    night: ['#1A222C', '#2A3440', '#3A4450'],
  },
  fog: {
    day: ['#3E444C', '#4E524C', '#5A564E'],
    dawn: ['#5A4A44', '#5A5248', '#3E464C'],
    dusk: ['#3A383C', '#424040', '#323438'],
    night: ['#24262C', '#363840', '#4A4844'],
  },
  drizzle: {
    day: ['#2A3E4C', '#3A5260', '#4A5E6A'],
    dawn: ['#4A444C', '#4A5460', '#3A4A56'],
    dusk: ['#2A3844', '#334450', '#2A343C'],
    night: ['#1C2830', '#2A3A44', '#3C4E58'],
  },
  rain: {
    day: ['#1E3442', '#2E4A58', '#3A5864'],
    dawn: ['#3A444C', '#3A4E58', '#2E444E'],
    dusk: ['#1E2C38', '#2A3A44', '#32343C'],
    night: ['#152028', '#243440', '#334850'],
  },
  heavy: {
    day: ['#182C38', '#2A4250', '#35505C'],
    dawn: ['#2E3C44', '#344850', '#2A4048'],
    dusk: ['#162430', '#243440', '#2A3038'],
    night: ['#101820', '#1C2C34', '#2A4048'],
  },
  storm: {
    day: ['#1A1C30', '#2A2840', '#323848'],
    dawn: ['#2E2438', '#3A3248', '#2A3044'],
    dusk: ['#161428', '#221E34', '#282430'],
    night: ['#12101C', '#221E32', '#2E2A40'],
  },
  snow: {
    day: ['#2A4254', '#3A5468', '#4A6274'],
    dawn: ['#3A4654', '#4A5664', '#3A4A58'],
    dusk: ['#2A3848', '#3A4A58', '#3A4854'],
    night: ['#1A2834', '#2C3E4C', '#3E5464'],
  },
};

function conditionFromCode(code: number): Condition {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (isSnowCode(code)) return 'snow';
  if (code >= 95) return 'storm';
  if (code === 65 || code === 82) return 'heavy';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 51 && code <= 57) return 'drizzle';
  return 'partly';
}

function sunPhase(
  nowIso: string,
  sunrise: string | undefined,
  sunset: string | undefined,
  timeZone: string | undefined,
  isDay: boolean,
): Phase {
  if (!sunrise || !sunset) return isDay ? 'day' : 'night';
  const now = zonedIsoToMs(nowIso, timeZone);
  const rise = zonedIsoToMs(sunrise, timeZone);
  const set = zonedIsoToMs(sunset, timeZone);
  if (!Number.isFinite(now) || !Number.isFinite(rise) || !Number.isFinite(set)) {
    return isDay ? 'day' : 'night';
  }
  const dawnWindow = 50 * 60 * 1000;
  const afterRise = 35 * 60 * 1000;
  const beforeSet = 40 * 60 * 1000;
  const afterSet = 50 * 60 * 1000;
  if (now >= rise - dawnWindow && now <= rise + afterRise) return 'dawn';
  if (now >= set - beforeSet && now <= set + afterSet) return 'dusk';
  if (now >= rise && now < set) return 'day';
  return 'night';
}

function rainLevel(code: number, precipitation: number, minutes: MinutePoint[]): RainLevel {
  if (isSnowCode(code)) return 0;
  const soon = minutes.slice(0, 8).some((point) => intensityFromMm(point.precipitationMm) > 0.08);
  const falling = precipitation > 0.05 || soon;
  if (code >= 95) return 3;
  if (code === 65 || code === 82) return 3;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || (falling && code >= 61)) return 2;
  if ((code >= 51 && code <= 57) || falling) return 1;
  return 0;
}

export const idleSky: SkyPalette = {
  ...INK,
  gradient: ['#2A3A48', '#3E5360', '#5A6A74'],
  locations: [0, 0.42, 1],
  rain: 0,
};

export function skyFromWeather(weather: WeatherBundle | null): SkyPalette {
  if (!weather) return idleSky;
  const today = weather.daily[0];
  const condition = conditionFromCode(weather.current.weatherCode);
  const phase = sunPhase(
    weather.current.time,
    today?.sunrise,
    today?.sunset,
    weather.timezone,
    weather.current.isDay,
  );
  return {
    ...INK,
    gradient: SKIES[condition][phase],
    locations: [0, 0.38, 1],
    rain: rainLevel(weather.current.weatherCode, weather.current.precipitation, weather.minutely),
  };
}
