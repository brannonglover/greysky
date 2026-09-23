import { RADAR_API } from '@/lib/radar/api';

/**
 * Severe-weather outlooks from NOAA's Storm Prediction Center.
 *
 * This is the earliest stage of Grey Sky's threat progression — SPC places an
 * area under a severe-weather risk one to three days out, long before any
 * watch or warning exists, and often before the hourly forecast is confidently
 * showing anything at the user's location.
 *
 * An outlook is authoritative but it is *not* a warning, and the UI has to say
 * so. It is a risk assessment for an area over a multi-hour window, not a
 * statement that severe weather will occur at this address.
 *
 * All polygon work happens in the service; the client only ever sees its own
 * resolved risk.
 */

export const CATEGORIES = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'] as const;
export type CategoryCode = (typeof CATEGORIES)[number];

export type HazardRisk = {
  /** Fractional probability within 25 miles of a point, e.g. 0.15. */
  probability: number;
  /** Inside SPC's hatched area — significant severe of that hazard. */
  significant: boolean;
};

export type DayOutlook = {
  day: 1 | 2 | 3;
  issued: number;
  validFrom: number;
  validTo: number;
  categorical: { code: CategoryCode; label: string } | null;
  tornado: HazardRisk | null;
  wind: HazardRisk | null;
  hail: HazardRisk | null;
  anySevere: HazardRisk | null;
};

export function categoryRank(code: CategoryCode): number {
  return CATEGORIES.indexOf(code);
}

/** TSTM is ordinary thunder; the service already filters it out. */
export function isSevereCategory(code: CategoryCode): boolean {
  return categoryRank(code) >= categoryRank('MRGL');
}

/**
 * SPC's own categorical colours, so anyone who has seen an SPC map reads the
 * risk level instantly. Taken from the `fill` values in their GeoJSON.
 */
export const CATEGORY_COLORS: Record<CategoryCode, string> = {
  TSTM: '#C1E9C1',
  MRGL: '#66A366',
  SLGT: '#FFE066',
  ENH: '#FFA366',
  MDT: '#E06666',
  HIGH: '#EE99EE',
};

/** Short name for the chip, e.g. "ENHANCED". */
export function categoryName(code: CategoryCode): string {
  switch (code) {
    case 'HIGH':
      return 'High';
    case 'MDT':
      return 'Moderate';
    case 'ENH':
      return 'Enhanced';
    case 'SLGT':
      return 'Slight';
    case 'MRGL':
      return 'Marginal';
    default:
      return 'Thunderstorms';
  }
}

/**
 * Which day the outlook covers, in the user's own terms. SPC windows start at
 * 12Z, so the calendar day of `validFrom` is what the user thinks of as the
 * risk day.
 */
export function outlookDayName(outlook: DayOutlook): string {
  const start = new Date(outlook.validFrom);
  const today = new Date();
  const dayDiff = Math.round(
    (Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000,
  );
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'tomorrow';
  return start.toLocaleDateString('en-US', { weekday: 'long' });
}

/** "Severe weather possible Thursday" */
export function outlookHeadline(outlook: DayOutlook): string {
  const when = outlookDayName(outlook);
  return when === 'today' ? 'Severe weather possible today' : `Severe weather possible ${when}`;
}

/**
 * Which hazards SPC is actually calling for, so the copy names them rather
 * than leaving the user to interpret a risk category.
 */
export function hazardSentence(outlook: DayOutlook): string {
  const hazards: string[] = [];
  if (outlook.wind) hazards.push(outlook.wind.significant ? 'destructive winds' : 'damaging winds');
  if (outlook.tornado) hazards.push(outlook.tornado.significant ? 'strong tornadoes' : 'tornadoes');
  if (outlook.hail) hazards.push(outlook.hail.significant ? 'very large hail' : 'large hail');

  if (hazards.length === 0) {
    return outlook.anySevere
      ? 'Severe thunderstorms are possible.'
      : 'Severe thunderstorms are possible in your area.';
  }
  if (hazards.length === 1) return `${sentenceCase(hazards[0])} are possible.`;
  const last = hazards.pop() as string;
  return `${sentenceCase(hazards.join(', '))} and ${last} are possible.`;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Your area is in an Enhanced Risk for severe thunderstorms." */
export function riskSentence(outlook: DayOutlook): string {
  if (!outlook.categorical) {
    return 'SPC indicates a severe-thunderstorm risk in your area.';
  }
  const name = categoryName(outlook.categorical.code);
  const article = name === 'Enhanced' ? 'an' : 'a';
  return `Your area is in ${article} ${name} Risk for severe thunderstorms.`;
}

export function formatProbability(risk: HazardRisk): string {
  return `${Math.round(risk.probability * 100)}%`;
}

/**
 * Outlooks covering this location. Returns an empty list on failure, matching
 * fetchAlerts — an outlook outage must degrade the Storms tab, never break it,
 * and must never be mistaken for "no risk".
 */
export async function fetchSpcOutlook(latitude: number, longitude: number): Promise<DayOutlook[]> {
  try {
    const response = await fetch(
      `${RADAR_API}/api/spc/outlook?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`,
    );
    if (!response.ok) return [];
    const json = (await response.json()) as { days?: DayOutlook[] };
    return json.days ?? [];
  } catch {
    return [];
  }
}

/**
 * Identity for notification dedupe: one record per risk period.
 *
 * Keyed on the end of the validity window rather than the day number, because
 * the day number is relative to now — Thursday's risk is day 2 today and day 1
 * tomorrow, and keying on that would re-announce the same outlook every
 * morning. SPC windows always close at 12Z the following day, so `validTo` is
 * stable for a given risk period.
 */
export function outlookKey(outlook: DayOutlook): string {
  return `spc:${outlook.validTo}`;
}

/**
 * Whether an outlook is worth telling the user about at all. General
 * thunderstorms are not severe weather, so an outlook has to carry either a
 * severe category or an actual hazard probability.
 */
export function isMeaningfulOutlook(outlook: DayOutlook): boolean {
  if (outlook.categorical && isSevereCategory(outlook.categorical.code)) return true;
  return Boolean(outlook.tornado || outlook.wind || outlook.hail || outlook.anySevere);
}

// ---------------------------------------------------------------------------
// Notification state machine
// ---------------------------------------------------------------------------

/** The SPC risk last announced for a given risk period. */
export type OutlookNotifyState = {
  category: string;
  validTo: number;
  notifiedAt: number;
};

/**
 * Which outlook, if any, to announce — and the record to carry forward.
 *
 * Kept pure and separate from scheduling so the transitions can be tested
 * directly; getting this wrong means either spamming the user five times a day
 * or silently swallowing the first Enhanced Risk of the season.
 */
export function decideOutlookNotification(
  outlooks: DayOutlook[],
  previous: Record<string, OutlookNotifyState>,
  now: number,
): { announce: DayOutlook | null; next: Record<string, OutlookNotifyState> } {
  // Drop risk periods that have passed so the record cannot grow forever.
  const next: Record<string, OutlookNotifyState> = {};
  for (const [key, entry] of Object.entries(previous)) {
    if (entry.validTo > now) next[key] = entry;
  }

  let announce: DayOutlook | null = null;

  for (const outlook of outlooks) {
    if (!isMeaningfulOutlook(outlook)) continue;
    const key = outlookKey(outlook);
    const code = outlook.categorical?.code ?? 'SLGT';
    const seen = next[key];
    const isNew = seen === undefined;
    const upgraded =
      seen !== undefined && categoryRank(code) > categoryRank(seen.category as typeof code);

    if (isNew || upgraded) {
      // Lead with the nearest risk period when several qualify at once.
      if (!announce || outlook.validFrom < announce.validFrom) announce = outlook;
    }

    // Always record the current level, including on a downgrade, so that a
    // later climb back up reads as an upgrade and announces again.
    next[key] = { category: code, validTo: outlook.validTo, notifiedAt: now };
  }

  return { announce, next };
}

