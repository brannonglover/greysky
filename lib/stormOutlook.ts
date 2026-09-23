import { precipIsLikely } from './nowcast';
import { wallHour, zonedIsoToMs } from './time';
import type { HourPoint, Units, WeatherBundle } from './types';
import { formatPrecip, formatWind } from './units';
import { isHeavyRainOrStormCode, isThunderstormCode } from './wmo';

/**
 * Grey Sky's own read of the hourly forecast, for storms the National Weather
 * Service has not issued a product on.
 *
 * Everything here is inference from a model, not an official warning, and the
 * vocabulary is constrained to keep that obvious: headlines always say
 * "possible", and the words "warning" and "watch" are never used. Timing is
 * hedged to the resolution the hourly forecast actually has — an hourly model
 * cannot justify "storms at 4:15", so the copy says "around 4 PM".
 */

export type StormSignalKind = 'thunderstorm' | 'wind' | 'rain';
export type StormSignalSeverity = 'strong' | 'severe';

export type StormSignal = {
  kind: StormSignalKind;
  severity: StormSignalSeverity;
  /** Epoch ms of the first qualifying hour. Approximate by nature. */
  startsAt: number;
  /** The same hour as a wall-clock stamp, so timing reads in the forecast's zone. */
  startsAtIso: string;
  endsAt: number;
  hours: number;
  headline: string;
  peakGustKmh: number;
  peakRainMm: number;
};

/** Gusts strong enough to move furniture and bring down small branches. */
const STRONG_GUST_KMH = 60;
/** Gusts into the damaging range — the band NWS would consider warning on. */
const SEVERE_GUST_KMH = 85;
/** Matches the HEAVY band used by the nowcast summary and precip chart. */
const HEAVY_MM_HR = 7.5;

const HORIZON_HOURS = 24;

type Qualified = {
  hour: HourPoint;
  time: number;
  kind: StormSignalKind;
  severity: StormSignalSeverity;
};

function qualify(hour: HourPoint, time: number): Qualified | null {
  const likely = precipIsLikely(hour.precipitationProbability, hour.precipitation);

  if (isThunderstormCode(hour.weatherCode) && likely) {
    return {
      hour,
      time,
      kind: 'thunderstorm',
      severity: hour.windGusts >= SEVERE_GUST_KMH || hour.precipitation >= HEAVY_MM_HR ? 'severe' : 'strong',
    };
  }

  if (hour.windGusts >= STRONG_GUST_KMH) {
    return {
      hour,
      time,
      kind: 'wind',
      severity: hour.windGusts >= SEVERE_GUST_KMH ? 'severe' : 'strong',
    };
  }

  if ((hour.precipitation >= HEAVY_MM_HR || isHeavyRainOrStormCode(hour.weatherCode)) && likely) {
    return {
      hour,
      time,
      kind: 'rain',
      severity: hour.precipitation >= HEAVY_MM_HR * 2 ? 'severe' : 'strong',
    };
  }

  return null;
}

const HEADLINES: Record<StormSignalKind, Record<StormSignalSeverity, string>> = {
  thunderstorm: { strong: 'Storms possible', severe: 'Strong storms possible' },
  wind: { strong: 'Strong winds possible', severe: 'Damaging winds possible' },
  rain: { strong: 'Heavy rain possible', severe: 'Very heavy rain possible' },
};

const SEVERITY_RANK: Record<StormSignalSeverity, number> = { strong: 0, severe: 1 };

/**
 * Contiguous runs of qualifying hours, collapsed into one signal each. Without
 * the grouping a six-hour squall line would produce six separate alerts.
 */
export function forecastStormSignals(
  weather: WeatherBundle,
  horizonHours = HORIZON_HOURS,
): StormSignal[] {
  const now = Date.now();
  const cutoff = now + horizonHours * 3_600_000;

  const qualified = weather.hourly
    .map((hour) => ({ hour, time: zonedIsoToMs(hour.time, weather.timezone) }))
    .filter(({ time }) => Number.isFinite(time) && time >= now - 3_600_000 && time <= cutoff)
    .map(({ hour, time }) => qualify(hour, time))
    .filter((entry): entry is Qualified => entry !== null);

  const signals: StormSignal[] = [];
  let run: Qualified[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const kind = run[0].kind;
    const severity = run.reduce<StormSignalSeverity>(
      (worst, entry) => (SEVERITY_RANK[entry.severity] > SEVERITY_RANK[worst] ? entry.severity : worst),
      'strong',
    );
    signals.push({
      kind,
      severity,
      startsAt: run[0].time,
      startsAtIso: run[0].hour.time,
      endsAt: run[run.length - 1].time + 3_600_000,
      hours: run.length,
      headline: HEADLINES[kind][severity],
      peakGustKmh: Math.max(...run.map((entry) => entry.hour.windGusts)),
      peakRainMm: Math.max(...run.map((entry) => entry.hour.precipitation)),
    });
    run = [];
  };

  for (const entry of qualified) {
    const previous = run[run.length - 1];
    const contiguous = previous && entry.kind === previous.kind && entry.time - previous.time <= 2 * 3_600_000;
    if (!contiguous) flush();
    run.push(entry);
  }
  flush();

  return signals.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.startsAt - b.startsAt);
}

/**
 * Timing phrased to the precision an hourly forecast can support.
 *
 * Anything nearer than a couple of hours is "within the next few hours"; a
 * clock hour is only quoted once it is far enough out that rounding to the hour
 * is honest, and beyond half a day it degrades to a part of the day.
 */
export function approximateWhen(startsAt: number, isoHint?: string): string {
  const deltaHours = (startsAt - Date.now()) / 3_600_000;
  if (deltaHours <= 0.5) return 'now';
  if (deltaHours < 2) return 'within the next hour or two';
  if (deltaHours < 3) return 'in the next few hours';

  const hour = isoHint ? wallHour(isoHint) : new Date(startsAt).getHours();

  // Near enough that rounding to the clock hour is honest.
  if (deltaHours <= 8) {
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `around ${display} ${hour < 12 ? 'AM' : 'PM'}`;
  }

  // Beyond that the hour itself sits inside the model's own timing error, so
  // name the part of the day rather than pretending to a clock time.
  const prefix = deltaHours >= 14 ? 'tomorrow' : 'this';
  if (hour < 5) return prefix === 'tomorrow' ? 'late tomorrow night' : 'tonight';
  if (hour < 12) return `${prefix} morning`;
  if (hour < 17) return `${prefix} afternoon`;
  if (hour < 21) return `${prefix} evening`;
  return prefix === 'tomorrow' ? 'tomorrow night' : 'tonight';
}

/** One line of supporting numbers, honouring the user's unit preference. */
export function signalDetail(signal: StormSignal, units: Units): string {
  const parts: string[] = [];
  if (signal.peakGustKmh >= STRONG_GUST_KMH) {
    parts.push(`gusts to ${formatWind(signal.peakGustKmh, units)}`);
  }
  if (signal.peakRainMm >= 1) {
    parts.push(`up to ${formatPrecip(signal.peakRainMm, units)} an hour`);
  }
  if (signal.hours > 1) {
    parts.push(`about ${signal.hours} hours`);
  }
  return parts.join(' · ');
}

/**
 * Stable identity for a signal, so a notification fires once per event rather
 * than again on every forecast refresh that still sees the same storm.
 */
export function signalKey(signal: StormSignal): string {
  return `${signal.kind}:${signal.severity}:${Math.round(signal.startsAt / 3_600_000)}`;
}
