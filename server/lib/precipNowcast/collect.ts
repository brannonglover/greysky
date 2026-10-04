/**
 * Research collector. One scout pass decides which regions are worth a full
 * case. It does not run on a user request, and it does not change the predictor.
 *
 * Rules, fixed before a cycle looks at the radar:
 * - A region is archived for wet rain, a wet/dry boundary, onset, ending,
 *   growth, or weakening.
 * - Onset and ending are kept even if that region was archived in the last
 *   20 minutes. Other reasons wait out that gap so one storm is not copied
 *   every scout.
 * - A fully dry region is kept at most once per 6 hours, as a control.
 * - A failed scout is not dry. A region with a failed point is not a dry control.
 * - Points that share a snapped region are archived together.
 */
import { regionKey } from './point';
import { RAIN_THRESHOLD_MM_HR } from './thresholds';

export const COLLECT = {
  minArchiveGapMin: 20,
  dryControlGapMin: 360,
  wetMmHr: 0.6,
  changeMmHr: 1,
} as const;

export type CollectReason =
  | 'onset'
  | 'ending'
  | 'growing'
  | 'weakening'
  | 'boundary'
  | 'wet'
  | 'dry-control'
  | 'redundant'
  | 'dry-recent'
  | 'missing';

export type CollectDecision = {
  archive: boolean;
  reason: CollectReason;
};

const SNAP_TIME = '2000-01-01T00:00:00.000Z';

export function collectRegionSnap(latitude: number, longitude: number): string {
  const located = regionKey(latitude, longitude, SNAP_TIME);
  return `${located.centerLatitude.toFixed(2)},${located.centerLongitude.toFixed(2)}`;
}

function finite(rates: readonly (number | null)[]): number[] {
  return rates.filter((rate): rate is number => rate != null && Number.isFinite(rate));
}

export function classifyRegion(args: {
  rates: readonly (number | null)[];
  previous: readonly (number | null)[] | null;
  lastArchiveMs: number | null;
  lastDryMs: number | null;
  nowMs: number;
}): CollectDecision {
  const rates = finite(args.rates);
  if (!rates.length) return { archive: false, reason: 'missing' };
  const wet = rates.some((rate) => rate >= COLLECT.wetMmHr);
  const belowWet = rates.some((rate) => rate < COLLECT.wetMmHr);
  const anyEcho = rates.some((rate) => rate > RAIN_THRESHOLD_MM_HR);
  const allDry = args.rates.every((rate) => rate != null && rate <= RAIN_THRESHOLD_MM_HR);
  const previous = args.previous ?? [];
  let onset = false;
  let ending = false;
  let growing = false;
  let weakening = false;
  for (let i = 0; i < args.rates.length; i += 1) {
    const now = args.rates[i];
    const before = previous[i];
    if (now == null || before == null) continue;
    if (before < COLLECT.wetMmHr && now >= COLLECT.wetMmHr) onset = true;
    if (before <= RAIN_THRESHOLD_MM_HR && now > RAIN_THRESHOLD_MM_HR && now < COLLECT.wetMmHr) onset = true;
    if (before >= COLLECT.wetMmHr && now < COLLECT.wetMmHr) ending = true;
    if (now >= COLLECT.wetMmHr && now >= before + COLLECT.changeMmHr) growing = true;
    if (before >= COLLECT.wetMmHr && now <= before - COLLECT.changeMmHr) weakening = true;
  }
  let reason: CollectReason | null = null;
  if (onset) reason = 'onset';
  else if (ending) reason = 'ending';
  else if (growing) reason = 'growing';
  else if (weakening) reason = 'weakening';
  else if (wet && belowWet) reason = 'boundary';
  else if (wet || anyEcho) reason = 'wet';
  else if (allDry) reason = 'dry-control';
  else reason = 'missing';

  const sinceArchive = args.lastArchiveMs == null ? Infinity : args.nowMs - args.lastArchiveMs;
  if (reason !== 'onset' && reason !== 'ending' && sinceArchive < COLLECT.minArchiveGapMin * 60_000 && reason !== 'dry-control') {
    return { archive: false, reason: 'redundant' };
  }
  if (reason === 'dry-control') {
    const sinceDry = args.lastDryMs == null ? Infinity : args.nowMs - args.lastDryMs;
    if (sinceDry < COLLECT.dryControlGapMin * 60_000) return { archive: false, reason: 'dry-recent' };
  }
  if (reason === 'missing') return { archive: false, reason: 'missing' };
  return { archive: true, reason };
}
