import { intensityFromHourlyMm } from './precip';
import { wallHour, zonedIsoToMs } from './time';
import type { DayPoint, HourPoint, MinutePoint } from './types';
import { isPrecipCode, isSnowCode, labelForCode } from './wmo';

/** 15-min total that counts as wet (~0.2 mm/hr). Low enough for storm onset, not dry-day noise. */
const WET_MM = 0.05;
/** Show the nowcast / notify when rain is expected, not only after it is already heavy. */
export const PRECIP_LIKELY_PCT = 40;
/** Hourly card precip graph: same chance threshold as HourlyTimeline. */
export const PRECIP_CHART_CHANCE = 30;
/** Trace of measurable rain on the Dark Sky intensity scale (HourlyTimeline). */
const PRECIP_CHART_INTENSITY = 0.04;
const PRECIP_CHART_HOURS = 12;

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function intensityWord(mmPerHour: number, snow: boolean): string {
  const noun = snow ? 'snow' : 'rain';
  if (mmPerHour < 0.6) return snow ? 'Flurries' : 'Drizzle';
  if (mmPerHour < 2.5) return `Light ${noun}`;
  if (mmPerHour < 7.5) return snow ? 'Snow' : 'Rain';
  return `Heavy ${noun}`;
}

function lowercaseIntensity(word: string): string {
  return word.charAt(0).toLowerCase() + word.slice(1);
}

export function interpolateMinutely(
  times: string[],
  precipitation: (number | null)[],
  probability: (number | null)[],
  weatherCode: (number | null)[],
  snowfall: (number | null)[],
  timeZone?: string,
): MinutePoint[] {
  if (!times.length) return [];

  const now = Date.now();
  let start = 0;
  for (let i = 0; i < times.length; i += 1) {
    if (zonedIsoToMs(times[i], timeZone) <= now) start = i;
  }

  const points = times.slice(start).map((time, offset) => {
    const i = start + offset;
    return {
      t: zonedIsoToMs(time, timeZone),
      precipitationMm: num(precipitation[i]),
      probability: num(probability[i]),
      isSnow: isSnowCode(num(weatherCode[i])) || num(snowfall[i]) > 0,
    };
  });

  if (points.length === 0) return [];

  const origin = points[0].t;
  const minutes: MinutePoint[] = [];

  for (let m = 0; m < 60; m += 1) {
    const target = origin + m * 60_000;
    let left = points[0];
    let right = points[points.length - 1];
    for (let i = 0; i < points.length - 1; i += 1) {
      if (target >= points[i].t && target <= points[i + 1].t) {
        left = points[i];
        right = points[i + 1];
        break;
      }
    }
    const span = Math.max(1, right.t - left.t);
    const t = Math.min(1, Math.max(0, (target - left.t) / span));
    const smooth = t * t * (3 - 2 * t);
    minutes.push({
      minute: m,
      precipitationMm: left.precipitationMm + (right.precipitationMm - left.precipitationMm) * smooth,
      probability: left.probability + (right.probability - left.probability) * smooth,
      isSnow: smooth < 0.5 ? left.isSnow : right.isSnow,
    });
  }

  return minutes;
}

export function nowcastHasPrecip(minutes: MinutePoint[]): boolean {
  return minutes.some((p) => p.precipitationMm >= WET_MM || p.probability >= PRECIP_LIKELY_PCT);
}

function hoursShowPrecipChart(hours: HourPoint[]): boolean {
  return hours.slice(0, PRECIP_CHART_HOURS).some(
    (hour) =>
      intensityFromHourlyMm(hour.precipitation) > PRECIP_CHART_INTENSITY ||
      hour.precipitationProbability >= PRECIP_CHART_CHANCE ||
      isPrecipCode(hour.weatherCode),
  );
}

/** Same signal as the hourly-card rain/nowcast graph. Clear days stay false. */
export function isPrecipComing(minutes: MinutePoint[] | undefined, hours: HourPoint[]): boolean {
  return (minutes != null && nowcastHasPrecip(minutes)) || hoursShowPrecipChart(hours);
}

function precipNoun(minutes: MinutePoint[], fallbackSnow: boolean): 'snow' | 'rain' {
  const wet = minutes.filter((p) => p.precipitationMm >= WET_MM || p.probability >= PRECIP_LIKELY_PCT);
  if (wet.length === 0) return fallbackSnow ? 'snow' : 'rain';
  const snowy = wet.filter((p) => p.isSnow).length > wet.length / 2;
  return snowy ? 'snow' : 'rain';
}

export function nowcastSummary(minutes: MinutePoint[], currentCode: number): string {
  if (minutes.length === 0) {
    return `${labelForCode(currentCode)} for the hour.`;
  }

  const wet = minutes.map((p) => p.precipitationMm >= WET_MM);
  const currentlyWet = wet[0];
  const snowy = minutes.filter((p) => p.precipitationMm >= WET_MM && p.isSnow).length >
    minutes.filter((p) => p.precipitationMm >= WET_MM && !p.isSnow).length;
  const peak = Math.max(...minutes.map((p) => p.precipitationMm));
  const peakHourly = peak * 4;
  const kind = intensityWord(peakHourly, snowy);

  const firstWet = wet.findIndex(Boolean);
  const firstDry = currentlyWet ? wet.findIndex((v) => !v) : -1;
  const wetCount = wet.filter(Boolean).length;

  if (!currentlyWet && firstWet === -1) {
    if (isPrecipCode(currentCode)) return `${labelForCode(currentCode)} ending now.`;
    const firstLikely = minutes.findIndex((p) => p.probability >= PRECIP_LIKELY_PCT);
    if (firstLikely >= 0) {
      const noun = precipNoun(minutes, minutes[firstLikely]?.isSnow ?? false);
      const label = noun === 'snow' ? 'Snow' : 'Rain';
      return firstLikely <= 5 ? `${label} possible this hour.` : `${label} possible in ${firstLikely} min.`;
    }
    return `${labelForCode(currentCode)} for the hour.`;
  }

  if (!currentlyWet && firstWet >= 0) {
    const mins = firstWet === 0 ? 1 : firstWet;
    return `${kind} starting in ${mins} min.`;
  }

  if (currentlyWet && firstDry > 0 && firstDry < 55) {
    const later = wet.slice(firstDry).findIndex(Boolean);
    if (later === -1) {
      return `${kind} stopping in ${firstDry} min.`;
    }
  }

  if (wetCount >= 50) {
    return `${kind} throughout the hour.`;
  }

  if (currentlyWet) {
    return `${kind} for the next hour.`;
  }

  return `${labelForCode(currentCode)} for the hour.`;
}

export function daySummary(hours: HourPoint[], day: DayPoint | undefined): string {
  if (!day) return 'Forecast unavailable.';

  const todayHours = hours.slice(0, 24);
  const precipHours = todayHours.filter((h) => h.precipitation >= 0.2 || h.precipitationProbability >= 45);
  const morning = precipHours.filter((h) => wallHour(h.time) < 12).length;
  const afternoon = precipHours.filter((h) => {
    const hr = wallHour(h.time);
    return hr >= 12 && hr < 18;
  }).length;
  const evening = precipHours.filter((h) => wallHour(h.time) >= 18).length;
  const snow = day.snowfallSum > 0.4;
  const precipWord = snow ? 'snow' : 'rain';

  let sky = labelForCode(day.weatherCode);
  if (day.weatherCode <= 1) sky = 'Clear';
  else if (day.weatherCode === 2) sky = 'Partly cloudy';
  else if (day.weatherCode === 3) sky = 'Overcast';

  if (precipHours.length === 0) {
    return `${sky} throughout the day.`;
  }

  const parts: string[] = [];
  if (morning) parts.push('morning');
  if (afternoon) parts.push('afternoon');
  if (evening) parts.push('evening');

  if (parts.length === 3) {
    return `Possible ${lowercaseIntensity(intensityWord(day.precipitationSum, snow))} throughout the day.`;
  }
  if (parts.length === 1) {
    return `Possible ${precipWord} in the ${parts[0]}.`;
  }
  if (parts.length === 2) {
    return `Possible ${precipWord} in the ${parts[0]} and ${parts[1]}.`;
  }
  return `${sky} throughout the day.`;
}

export function rainStartsInMinutes(minutes: MinutePoint[]): number | null {
  if (minutes.length === 0) return null;
  const alreadyRaining = (minutes[0]?.precipitationMm ?? 0) >= WET_MM;
  if (alreadyRaining) return null;
  const idx = minutes.findIndex((p) => p.precipitationMm >= WET_MM || p.probability >= PRECIP_LIKELY_PCT);
  return idx >= 0 ? Math.max(1, idx) : null;
}

export function rainStopsInMinutes(minutes: MinutePoint[]): number | null {
  const currentlyWet = (minutes[0]?.precipitationMm ?? 0) >= WET_MM;
  if (!currentlyWet) return null;
  const idx = minutes.findIndex((p) => p.precipitationMm < WET_MM);
  return idx >= 0 ? idx : null;
}

export function dailyPrecipLikely(day: DayPoint | undefined): boolean {
  if (!day) return false;
  return day.precipitationSum >= 1 || day.precipitationProbabilityMax >= 50;
}
