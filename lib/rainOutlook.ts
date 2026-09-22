import { formatHour } from '@/lib/format';
import { bandFromMmHr, bandLabel, DRY_MM_HR, type RainBand } from '@/lib/precip';
import { zonedIsoToMs } from '@/lib/time';
import type { HourPoint, Units } from '@/lib/types';
import { mmToIn } from '@/lib/units';

/** Hours shown on the rain screen. Eight keeps the bars readable at 390pt. */
export const OUTLOOK_HOURS = 8;

export type RainHour = {
  time: string;
  /** Hourly precipitation is already an mm/hr average for that hour. */
  mmHr: number;
  probability: number;
  band: RainBand;
  wet: boolean;
};

export type RainOutlook = {
  hours: RainHour[];
  totalMm: number;
  peak: RainHour | null;
  peakBand: RainBand;
  starts: RainHour | null;
  clears: RainHour | null;
  maxProbability: number;
  wet: boolean;
};

function upcoming(hours: HourPoint[], timezone: string | undefined, count: number): HourPoint[] {
  const floor = Date.now() - 30 * 60_000;
  const future = hours.filter((hour) => {
    const ms = zonedIsoToMs(hour.time, timezone);
    return Number.isFinite(ms) && ms >= floor;
  });
  return (future.length > 0 ? future : hours).slice(0, count);
}

export function rainOutlook(
  hours: HourPoint[],
  timezone?: string,
  count: number = OUTLOOK_HOURS,
): RainOutlook {
  const window: RainHour[] = upcoming(hours, timezone, count).map((hour) => {
    const mmHr = Math.max(0, hour.precipitation);
    const band = bandFromMmHr(mmHr);
    return {
      time: hour.time,
      mmHr,
      probability: Math.max(0, hour.precipitationProbability ?? 0),
      band,
      wet: band !== 'none',
    };
  });

  const totalMm = window.reduce((sum, hour) => sum + hour.mmHr, 0);
  const peak = window.reduce<RainHour | null>(
    (best, hour) => (best == null || hour.mmHr > best.mmHr ? hour : best),
    null,
  );
  const firstWet = window.findIndex((hour) => hour.wet);
  let lastWet = -1;
  window.forEach((hour, index) => {
    if (hour.wet) lastWet = index;
  });

  return {
    hours: window,
    totalMm,
    peak: peak != null && peak.mmHr > DRY_MM_HR ? peak : null,
    peakBand: peak != null ? peak.band : 'none',
    starts: firstWet >= 0 ? window[firstWet] : null,
    clears: lastWet >= 0 ? (window[lastWet + 1] ?? null) : null,
    maxProbability: window.reduce((max, hour) => Math.max(max, hour.probability), 0),
    wet: firstWet >= 0,
  };
}

/** Reads as prose. Keeps lib/nowcast.ts's vocabulary so the two never clash. */
export function rainPhrase(band: RainBand): string {
  switch (band) {
    case 'drizzle':
      return 'Drizzle';
    case 'light':
      return 'Light rain';
    case 'moderate':
      return 'Steady rain';
    case 'heavy':
      return 'Heavy rain';
    case 'storm':
      return 'Storms';
    default:
      return 'No rain';
  }
}

export function rainVerdict(outlook: RainOutlook): string {
  const span = outlook.hours.length;
  if (span === 0) return 'Rain forecast unavailable.';

  if (!outlook.wet) {
    const pct = Math.round(outlook.maxProbability);
    if (pct < 10) return `Dry for the next ${span} hours.`;
    return `Staying dry — under ${Math.ceil(pct / 5) * 5}% for the next ${span} hours.`;
  }

  const peakAt = outlook.peak != null ? formatHour(outlook.peak.time) : null;
  const rainingNow = outlook.hours[0]?.wet ?? false;

  if (!rainingNow && outlook.starts != null) {
    const from = formatHour(outlook.starts.time);
    return peakAt != null && peakAt !== from
      ? `Rain from ${from} — heaviest around ${peakAt}.`
      : `Rain from ${from}.`;
  }

  const phrase = rainPhrase(outlook.peakBand);
  if (outlook.clears != null) return `${phrase}, clearing by ${formatHour(outlook.clears.time)}.`;
  return peakAt != null ? `${phrase}, heaviest around ${peakAt}.` : `${phrase} ahead.`;
}

export function splitPrecip(mm: number, units: Units): { value: string; unit: string } {
  if (units === 'us') {
    const inches = mmToIn(mm);
    const value = inches < 0.005 ? '0' : inches < 0.1 ? inches.toFixed(2) : inches.toFixed(1);
    return { value, unit: 'IN' };
  }
  const value = mm < 0.05 ? '0' : mm < 10 ? mm.toFixed(1) : String(Math.round(mm));
  return { value, unit: 'MM' };
}

export function formatRate(mmHr: number, units: Units): string {
  if (units === 'us') {
    const inches = mmToIn(mmHr);
    return `${inches < 0.1 ? inches.toFixed(2) : inches.toFixed(1)} in/hr`;
  }
  return `${mmHr < 10 ? mmHr.toFixed(1) : Math.round(mmHr)} mm/hr`;
}

export function rateUnitLabel(units: Units): string {
  return units === 'us' ? 'RATE, IN / HR' : 'RATE, MM / HR';
}

export { bandLabel };
