import { PRECIP_LIKELY_PCT } from '@/lib/nowcast';
import { zonedIsoToMs } from '@/lib/time';
import type { MinutePoint, WeatherBundle } from '@/lib/types';
import { isSnowCode } from '@/lib/wmo';

export type RainLevel = 0 | 1 | 2 | 3;

export type SkyPalette = {
  gradient: readonly [string, string, string, string];
  locations: readonly [number, number, number, number];
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
  text: '#EEF2F8',
  textSecondary: 'rgba(238, 242, 248, 0.86)',
  textTertiary: 'rgba(147, 163, 190, 0.9)',
  accent: '#FF9166',
  onAccent: '#0B1120',
  surface: 'rgba(8, 12, 22, 0.28)',
  surfaceRaised: 'rgba(6, 9, 17, 0.4)',
  divider: 'rgba(255, 255, 255, 0.1)',
  overlay: 'rgba(6, 9, 17, 0.4)',
  precip: '#4FC3E8',
  precipFill: 'rgba(79, 195, 232, 0.16)',
  precipHeavy: '#4FC3E8',
} as const;

const SKIES: Record<Condition, Record<Phase, readonly [string, string, string, string]>> = {
  clear: {
    day: ['#2C6FA8', '#4C8FC4', '#E9A671', '#FFC98B'],
    dawn: ['#8A3E36', '#C46A48', '#E9A671', '#FFC98B'],
    dusk: ['#1B2749', '#3A3A68', '#A04838', '#E9A671'],
    night: ['#060A16', '#0E1730', '#1B2749', '#2B3A67'],
  },
  partly: {
    day: ['#2A5E92', '#4A7EAC', '#D49A70', '#E8B888'],
    dawn: ['#8A4A40', '#B45C42', '#D49A70', '#E8B888'],
    dusk: ['#1E2438', '#5A3A50', '#8A4038', '#D49A70'],
    night: ['#0B1220', '#172544', '#1C2A40', '#2A3850'],
  },
  cloudy: {
    day: ['#3B4A6B', '#566487', '#7C889F', '#97A2B6'],
    dawn: ['#5A4A4A', '#6A5A58', '#7C889F', '#97A2B6'],
    dusk: ['#2A3038', '#3A4048', '#4A5058', '#7C889F'],
    night: ['#1A222C', '#2A3440', '#3A4450', '#4A5460'],
  },
  fog: {
    day: ['#3E444C', '#4E524C', '#6A6E66', '#8A8C80'],
    dawn: ['#5A4A44', '#5A5248', '#6A6E66', '#8A8C80'],
    dusk: ['#323438', '#3A383C', '#424040', '#5A564E'],
    night: ['#24262C', '#363840', '#4A4844', '#5A564E'],
  },
  drizzle: {
    day: ['#2A3E4C', '#3A5260', '#4A5E6A', '#5A7280'],
    dawn: ['#4A444C', '#4A5460', '#3A4A56', '#5A7280'],
    dusk: ['#1E2C38', '#2A3844', '#334450', '#4A5E6A'],
    night: ['#1C2830', '#2A3A44', '#3C4E58', '#4A5E6A'],
  },
  rain: {
    day: ['#1B2740', '#2A3B5C', '#2E5570', '#386E86'],
    dawn: ['#2A3B5C', '#3A4E58', '#2E5570', '#386E86'],
    dusk: ['#152028', '#1E2C38', '#2A3A44', '#2E5570'],
    night: ['#101820', '#1C2C34', '#243440', '#2E5570'],
  },
  heavy: {
    day: ['#182C38', '#2A4250', '#35505C', '#3A5864'],
    dawn: ['#2E3C44', '#344850', '#2A4048', '#35505C'],
    dusk: ['#162430', '#243440', '#2A3038', '#35505C'],
    night: ['#101820', '#1C2C34', '#2A4048', '#35505C'],
  },
  storm: {
    day: ['#1A1C30', '#2A2840', '#323848', '#3A4458'],
    dawn: ['#2E2438', '#3A3248', '#2A3044', '#323848'],
    dusk: ['#161428', '#221E34', '#282430', '#323848'],
    night: ['#12101C', '#221E32', '#2E2A40', '#323848'],
  },
  snow: {
    day: ['#2A4254', '#3A5468', '#4A6274', '#6A8494'],
    dawn: ['#3A4654', '#4A5664', '#3A4A58', '#6A8494'],
    dusk: ['#2A3848', '#3A4A58', '#3A4854', '#4A6274'],
    night: ['#1A2834', '#2C3E4C', '#3E5464', '#4A6274'],
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
  const fallingNow = precipitation >= 1 || (minutes[0]?.precipitationMm ?? 0) >= 0.25;
  const likelySoon = minutes.some((point) => point.probability >= PRECIP_LIKELY_PCT);
  if (!fallingNow && !likelySoon) return 0;
  if (code >= 95 || code === 65 || code === 82) return 3;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || precipitation >= 2.5) return 2;
  return 1;
}

export const idleSky: SkyPalette = {
  ...INK,
  gradient: ['#2C6FA8', '#4C8FC4', '#E9A671', '#FFC98B'],
  locations: [0, 0.32, 0.75, 1],
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
    locations: [0, 0.32, 0.75, 1],
    rain: rainLevel(weather.current.weatherCode, weather.current.precipitation, weather.minutely),
  };
}
