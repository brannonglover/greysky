import { categoryRank, outlookHeadline, type CategoryCode, type DayOutlook } from './spc';
import { approximateWhen, type StormSignal } from './stormOutlook';
import { exposureLabel, type TropicalReport } from './tropical';
import type { WeatherAlert } from './types';
import { isStormAlert } from './weather';

/**
 * One ordering for everything that could affect the user, so the Storms tab and
 * the forecast banner never disagree about what matters most.
 *
 * Grey Sky models a threat as a progression, and an item's `stage` says where
 * on it this piece of evidence sits:
 *
 *     outlook  →  forecast  →  watch  →  warning
 *     1–3 days    ~24 hours     hours    immediate
 *
 * Ordering is by expected local impact, never by which service the item came
 * from. Ranking by source would put a hurricane whose wind field arrives
 * tomorrow below a garden-variety thunderstorm purely because one came from
 * NHC and the other from our own forecast read. Source enters only as a
 * tiebreaker between items of equal impact and timing.
 */

export type StormTier = 'active' | 'incoming' | 'tracking';
export type StormSource = 'nws' | 'spc' | 'forecast' | 'tropical' | 'regional';
export type ThreatStage = 'outlook' | 'forecast' | 'watch' | 'warning';

type Base = {
  tier: StormTier;
  stage: ThreatStage;
  key: string;
  impact: number;
  startsAt: number;
};

export type StormItem =
  | (Base & { source: 'nws'; alert: WeatherAlert })
  | (Base & { source: 'regional'; alert: WeatherAlert; state: string; distanceKm: number | null })
  | (Base & { source: 'spc'; outlook: DayOutlook })
  | (Base & { source: 'forecast'; signal: StormSignal })
  | (Base & { source: 'tropical'; report: TropicalReport });

/**
 * `impactScore` values are an internal ordering device, nothing more.
 *
 * They carry no meteorological meaning and must never be surfaced or reasoned
 * about as "how dangerous this is" — they exist only to produce a stable,
 * deterministic order *within* a tier. Nothing outside this module should read
 * them.
 *
 * Because they are just tuning constants, the orderings that actually matter
 * are enforced structurally instead (see `compare`), not left to emerge from
 * the numbers. Concretely: an SPC High Risk scores higher than an NWS warning,
 * so on score alone a High Risk three days out would outrank a Tornado Warning
 * in effect right now. It does not, because tier is compared first and no
 * score can override it. scripts/ranking.test.ts asserts this.
 */
const IMPACT = {
  nwsExtreme: 100,
  nwsSevere: 90,
  nwsWarning: 80,
  nwsModerate: 60,
  nwsWatch: 55,
  nwsMinor: 40,

  hurricaneExposure: 95,
  strongTropicalExposure: 75,
  tropicalStormExposure: 55,

  derivedSevere: 65,
  derivedStrong: 45,
} as const;

/** Ordering weights for SPC categories. See the note above — not a severity scale. */
const SPC_IMPACT: Record<CategoryCode, number> = {
  HIGH: 88,
  MDT: 78,
  ENH: 62,
  SLGT: 48,
  MRGL: 35,
  TSTM: 0,
};

/** A hatched significant area is a meaningful step up within a category. */
const SIGNIFICANT_BONUS = 6;
/** Extended-outlook tropical exposure carries day 4–5 track error. */
const OUTLOOK_PENALTY = 10;
/** Lead-time discount so nearer days sort above further ones. */
const SPC_LEAD_PENALTY: Record<1 | 2 | 3, number> = { 1: 0, 2: 4, 3: 8 };

const WARNING = /\b(warning|emergency)\b/i;
const WATCH = /\bwatch\b/i;

function alertText(alert: WeatherAlert): string {
  return `${alert.event} ${alert.headline}`;
}

/** Watches and warnings are different stages, and read differently to a user. */
export function alertStage(alert: WeatherAlert): ThreatStage {
  if (WARNING.test(alertText(alert))) return 'warning';
  if (WATCH.test(alertText(alert))) return 'watch';
  // Advisories and statements are official but carry no watch/warning wording;
  // treat them as the lower of the two official stages.
  return 'watch';
}

function alertImpact(alert: WeatherAlert): number {
  if (alert.severity === 'Extreme') return IMPACT.nwsExtreme;
  if (alert.severity === 'Severe') return IMPACT.nwsSevere;
  const text = alertText(alert);
  if (WARNING.test(text)) return IMPACT.nwsWarning;
  if (WATCH.test(text)) return IMPACT.nwsWatch;
  if (alert.severity === 'Moderate') return IMPACT.nwsModerate;
  return IMPACT.nwsMinor;
}

function signalImpact(signal: StormSignal): number {
  return signal.severity === 'severe' ? IMPACT.derivedSevere : IMPACT.derivedStrong;
}

export function outlookImpact(outlook: DayOutlook): number {
  const base = outlook.categorical ? SPC_IMPACT[outlook.categorical.code] : SPC_IMPACT.SLGT;
  const significant =
    outlook.tornado?.significant || outlook.wind?.significant || outlook.hail?.significant;
  return Math.max(0, base + (significant ? SIGNIFICANT_BONUS : 0) - SPC_LEAD_PENALTY[outlook.day]);
}

function tropicalImpact(report: TropicalReport): number | null {
  const exposure = report.threat.exposure;
  if (!exposure) return null;
  const base =
    exposure.strength === 'hurricane'
      ? IMPACT.hurricaneExposure
      : exposure.strength === 'strong-ts'
        ? IMPACT.strongTropicalExposure
        : IMPACT.tropicalStormExposure;
  return exposure.fromOutlook ? base - OUTLOOK_PENALTY : base;
}

/** Official information settles ties; it never overturns a real impact gap. */
const SOURCE_TIEBREAK: Record<StormSource, number> = {
  nws: 0,
  spc: 1,
  tropical: 2,
  forecast: 3,
  regional: 4,
};

const TIER_ORDER: Record<StormTier, number> = { active: 0, incoming: 1, tracking: 2 };

function alertStart(alert: WeatherAlert): number {
  const onset = alert.onset ? Date.parse(alert.onset) : Number.NaN;
  return Number.isFinite(onset) ? onset : Date.now();
}

function inEffect(alert: WeatherAlert): boolean {
  const onset = alert.onset ? Date.parse(alert.onset) : Number.NaN;
  return !Number.isFinite(onset) || onset <= Date.now();
}

/**
 * The comparator. Tier is decided first and unconditionally, which is what
 * guarantees an official warning affecting the user outranks every outlook and
 * forecast regardless of any score.
 */
function compare(a: StormItem, b: StormItem): number {
  if (a.tier !== b.tier) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  if (a.impact !== b.impact) return b.impact - a.impact;
  if (a.startsAt !== b.startsAt) return a.startsAt - b.startsAt;
  return SOURCE_TIEBREAK[a.source] - SOURCE_TIEBREAK[b.source];
}

export type RankInput = {
  alerts: WeatherAlert[];
  signals: StormSignal[];
  tropical: TropicalReport[];
  outlooks?: DayOutlook[];
  regional?: { alert: WeatherAlert; state: string; distanceKm: number | null }[];
};

export function rankStormItems({
  alerts,
  signals,
  tropical,
  outlooks = [],
  regional = [],
}: RankInput): StormItem[] {
  const items: StormItem[] = [];

  for (const alert of alerts) {
    if (!isStormAlert(alert)) continue;
    const stage = alertStage(alert);
    items.push({
      // A watch that has not started yet is something coming, not something
      // happening; one already in effect belongs at the top of the screen.
      tier: inEffect(alert) ? 'active' : 'incoming',
      stage,
      source: 'nws',
      key: `nws:${alert.id}`,
      impact: alertImpact(alert),
      startsAt: alertStart(alert),
      alert,
    });
  }

  for (const outlook of outlooks) {
    items.push({
      tier: 'incoming',
      stage: 'outlook',
      source: 'spc',
      key: `spc:${outlook.day}:${outlook.validFrom}`,
      impact: outlookImpact(outlook),
      startsAt: outlook.validFrom,
      outlook,
    });
  }

  for (const signal of signals) {
    items.push({
      tier: 'incoming',
      stage: 'forecast',
      source: 'forecast',
      key: `forecast:${signal.kind}:${signal.startsAt}`,
      impact: signalImpact(signal),
      startsAt: signal.startsAt,
      signal,
    });
  }

  for (const report of tropical) {
    const impact = tropicalImpact(report);
    items.push({
      tier: impact === null ? 'tracking' : 'incoming',
      stage: impact === null ? 'outlook' : 'forecast',
      source: 'tropical',
      key: `tropical:${report.storm.id}`,
      // A system with no forecast exposure still sorts among its peers by how
      // strong it is, so the tracking list leads with the most serious storm.
      impact: impact ?? report.storm.maxWindKt / 10,
      startsAt: report.threat.exposure?.startsAt ?? Number.MAX_SAFE_INTEGER,
      report,
    });
  }

  // Regional alerts are awareness, never alarm. They are pinned to `tracking`
  // unconditionally — being in the same state as a storm says nothing about
  // whether it threatens this user, so no severity can promote one.
  for (const entry of regional) {
    items.push({
      tier: 'tracking',
      stage: alertStage(entry.alert),
      source: 'regional',
      key: `regional:${entry.alert.id}`,
      impact: alertImpact(entry.alert),
      startsAt: alertStart(entry.alert),
      alert: entry.alert,
      state: entry.state,
      distanceKm: entry.distanceKm,
    });
  }

  return items.sort(compare);
}

/** Whether anything at all is worth showing, for the calm-day empty state. */
export function hasAnyStormItems(items: StormItem[]): boolean {
  return items.length > 0;
}

/**
 * Short label for the forecast-screen banner. Derived and outlook items keep
 * their hedged wording here too, so the pill can never read as an official
 * product.
 */
export function stormItemLabel(item: StormItem): string {
  switch (item.source) {
    case 'nws':
    case 'regional':
      return item.alert.event;
    case 'spc':
      return outlookHeadline(item.outlook);
    case 'forecast':
      return item.signal.headline;
    case 'tropical': {
      const exposure = item.report.threat.exposure;
      if (!exposure) return item.report.storm.name;
      return `${item.report.storm.name}: ${exposureLabel(exposure.strength).toLowerCase()} ${approximateWhen(exposure.startsAt)}`;
    }
  }
}

/** Re-exported so the ranking tests can build outlook items without guessing. */
export { categoryRank };
