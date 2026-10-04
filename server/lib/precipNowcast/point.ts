/**
 * Point nowcast. One regional ensemble is built per snapped region and
 * observation time, then sampled for many coordinates.
 *
 * Neighborhood radius is the footprint of the coordinate, not a second motion
 * ensemble. Member perturbations already move the field.
 *
 * `confidence` is predictability of that analysis. It is not the chance of rain.
 * `probability` is the share of members whose neighborhood rate meets a threshold.
 */
import { metersPerDegreeLon, pixelOf } from './field';
import { loadRegionalHistory } from './history';
import { estimateMotion } from './motion';
import { analyzeEvolution } from './evolution';
import { defaultChunkSec, memberEvolvedRate, prepareMembers, uncertaintyScore, type MemberSet } from './ensemble';
import { RAIN_THRESHOLD_MM_HR, SCORE_LEADS_MIN } from './thresholds';

export const POINT_SCHEMA_VERSION = 1 as const;
export const POINT_PREDICTOR_VERSION = 'regional-ensemble-1' as const;

export const POINT = {
  /** Provisional. One source pixel is about 2 km. Not chosen to fit one storm. */
  defaultRadiusKm: 2,
  /** Provisional event line for onset and ending. Not a user-facing copy cutoff. */
  eventThresholdMmHr: 0.6,
  nativeStepMin: 2,
  horizonMin: 60,
  /** Two native steps. One 2-minute crossing is not an onset. */
  onsetPersistMin: 4,
  /** A dry spell this long ends the rain. 6 and 10 are compared in tests; 8 is the default. */
  endingDryMin: 8,
  /** Scoring convention only. Not a wording threshold. */
  decisionProbability: 0.5,
  /** Longitude tiles. Latitude uses a full degree so a metro is not split by a half-degree edge. */
  regionSnapLonDeg: 0.5,
  regionSnapLatDeg: 1,
  maxRegions: 3,
} as const;

/** Trace uses a strict greater-than, matching the scoreboard. Band floors use greater-or-equal. */
export const POINT_THRESHOLDS = [
  { id: 'trace', mmHr: 0.02 },
  { id: 'light', mmHr: 0.6 },
  { id: 'moderate', mmHr: 2.5 },
  { id: 'heavy', mmHr: 7.5 },
] as const;

export type ThresholdId = (typeof POINT_THRESHOLDS)[number]['id'];

const HORIZON_MARKS = [10, 20, 30, 45, 60] as const;

export function rateMeets(rate: number, thresholdMmHr: number): boolean {
  if (thresholdMmHr <= RAIN_THRESHOLD_MM_HR + 1e-9) return rate > RAIN_THRESHOLD_MM_HR;
  return rate >= thresholdMmHr;
}

export type KernelSample = {
  latitude: number;
  longitude: number;
  distanceKm: number;
  weight: number;
};

/** Gaussian kernel. Sigma is half the radius, so the rim is down-weighted, not ignored. */
export function neighborhoodKernel(latitude: number, longitude: number, radiusKm: number): KernelSample[] {
  if (!(radiusKm > 0)) {
    return [{ latitude, longitude, distanceKm: 0, weight: 1 }];
  }
  const sigmaM = (radiusKm * 1000) / 2;
  const raw: Array<{ latitude: number; longitude: number; distanceKm: number; weight: number }> = [];
  const push = (eastM: number, northM: number) => {
    const distanceM = Math.hypot(eastM, northM);
    const latitudeOff = latitude + northM / 110_540;
    const longitudeOff = longitude + eastM / metersPerDegreeLon(latitude);
    raw.push({
      latitude: latitudeOff,
      longitude: longitudeOff,
      distanceKm: distanceM / 1000,
      weight: Math.exp(-(distanceM * distanceM) / (2 * sigmaM * sigmaM)),
    });
  };
  push(0, 0);
  for (const ring of [0.5, 1]) {
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const reach = radiusKm * 1000 * ring;
      push(Math.cos(angle) * reach, Math.sin(angle) * reach);
    }
  }
  const sum = raw.reduce((total, sample) => total + sample.weight, 0);
  return raw.map((sample) => ({ ...sample, weight: sample.weight / sum }));
}

export type MemberSeries = {
  /** Native steps, index 0 at the observation. Null is missing, not dry. */
  rates: Array<number | null>;
};

export function onsetMinute(
  rates: readonly (number | null)[],
  stepMin: number,
  thresholdMmHr: number,
  persistMin: number,
): number | 'now' | null {
  const need = Math.max(1, Math.round(persistMin / stepMin));
  const wet = (index: number) => {
    const rate = rates[index];
    return rate != null && rateMeets(rate, thresholdMmHr);
  };
  if (wet(0)) {
    let held = true;
    for (let i = 0; i < need; i += 1) if (!wet(i)) held = false;
    if (held) return 'now';
  }
  for (let start = 1; start + need <= rates.length; start += 1) {
    if (rates[start - 1] == null || wet(start - 1)) continue;
    let held = true;
    for (let k = 0; k < need; k += 1) if (!wet(start + k)) held = false;
    if (held) return start * stepMin;
  }
  return null;
}

export function endingMinute(
  rates: readonly (number | null)[],
  stepMin: number,
  thresholdMmHr: number,
  dryMin: number,
  onset: number | 'now' | null,
): number | null {
  if (onset == null) return null;
  const need = Math.max(1, Math.round(dryMin / stepMin));
  const startAt = onset === 'now' ? 1 : Math.round(onset / stepMin) + 1;
  const dry = (index: number) => {
    const rate = rates[index];
    return rate != null && !rateMeets(rate, thresholdMmHr);
  };
  for (let start = startAt; start + need <= rates.length; start += 1) {
    let held = true;
    for (let k = 0; k < need; k += 1) if (!dry(start + k)) held = false;
    if (held) return start * stepMin;
  }
  return null;
}

type StepSummary = {
  minute: number;
  expectedRainRateMmHr: number | null;
  p10MmHr: number | null;
  p25MmHr: number | null;
  p50MmHr: number | null;
  p75MmHr: number | null;
  p90MmHr: number | null;
  probability: Record<ThresholdId, number | null>;
};

function quantile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

function summarizeStep(minute: number, rates: readonly (number | null)[]): StepSummary {
  const finite = rates.filter((rate): rate is number => rate != null && Number.isFinite(rate)).sort((a, b) => a - b);
  const probability = {} as Record<ThresholdId, number | null>;
  for (const threshold of POINT_THRESHOLDS) {
    probability[threshold.id] = finite.length
      ? finite.filter((rate) => rateMeets(rate, threshold.mmHr)).length / finite.length
      : null;
  }
  return {
    minute,
    expectedRainRateMmHr: finite.length ? finite.reduce((sum, rate) => sum + rate, 0) / finite.length : null,
    p10MmHr: finite.length ? quantile(finite, 0.1) : null,
    p25MmHr: finite.length ? quantile(finite, 0.25) : null,
    p50MmHr: finite.length ? quantile(finite, 0.5) : null,
    p75MmHr: finite.length ? quantile(finite, 0.75) : null,
    p90MmHr: finite.length ? quantile(finite, 0.9) : null,
    probability,
  };
}

export type Distribution = {
  thresholdMmHr: number;
  probability: number | null;
  p10Minutes: number | null;
  p50Minutes: number | null;
  p90Minutes: number | null;
  withinMinutes: Record<'10' | '20' | '30' | '45' | '60', number | null>;
};

function percentileTimes(minutes: readonly number[]): { p10: number | null; p50: number | null; p90: number | null } {
  if (minutes.length < 3) return { p10: null, p50: null, p90: null };
  const sorted = [...minutes].sort((a, b) => a - b);
  return { p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
}

export function eventDistributions(
  series: readonly MemberSeries[],
  thresholdMmHr: number,
  endingDryMin: number,
): { onset: Distribution & { persistenceMin: number; alreadyRainingProbability: number | null }; ending: Distribution & { dryPersistenceMin: number; supported: boolean } } {
  const step = POINT.nativeStepMin;
  const onsets: Array<number | 'now' | null> = series.map((member) =>
    onsetMinute(member.rates, step, thresholdMmHr, POINT.onsetPersistMin),
  );
  const considered = onsets.length;
  const already = onsets.filter((value) => value === 'now').length;
  const future = onsets.filter((value): value is number => typeof value === 'number');
  const begunBy = (mark: number) =>
    considered ? onsets.filter((value) => value === 'now' || (typeof value === 'number' && value <= mark)).length / considered : null;
  const onsetTimes = percentileTimes(future);
  const endings = onsets.map((onset, index) => endingMinute(series[index].rates, step, thresholdMmHr, endingDryMin, onset));
  const eligible = onsets.filter((onset) => onset != null).length;
  const ended = endings.filter((value): value is number => value != null);
  const endingTimes = percentileTimes(ended);
  const within = (marks: readonly number[], values: readonly (number | 'now' | null)[], mode: 'begun' | 'ended') => {
    const out = {} as Record<'10' | '20' | '30' | '45' | '60', number | null>;
    for (const mark of marks) {
      const key = String(mark) as '10' | '20' | '30' | '45' | '60';
      if (mode === 'begun') out[key] = begunBy(mark);
      else out[key] = eligible ? values.filter((value) => typeof value === 'number' && value <= mark).length / eligible : null;
    }
    return out;
  };
  return {
    onset: {
      thresholdMmHr,
      persistenceMin: POINT.onsetPersistMin,
      probability: considered ? future.length / considered : null,
      alreadyRainingProbability: considered ? already / considered : null,
      p10Minutes: onsetTimes.p10,
      p50Minutes: onsetTimes.p50,
      p90Minutes: onsetTimes.p90,
      withinMinutes: within(HORIZON_MARKS, onsets, 'begun'),
    },
    ending: {
      thresholdMmHr,
      dryPersistenceMin: endingDryMin,
      supported: eligible > 0,
      probability: eligible ? ended.length / eligible : null,
      p10Minutes: endingTimes.p10,
      p50Minutes: endingTimes.p50,
      p90Minutes: endingTimes.p90,
      withinMinutes: within(HORIZON_MARKS, endings, 'ended'),
    },
  };
}

export type PointMinute = StepSummary & { interpolated: boolean };

function interpolate(steps: readonly StepSummary[]): PointMinute[] {
  const out: PointMinute[] = [];
  for (let minute = 0; minute <= POINT.horizonMin; minute += 1) {
    const slot = minute / POINT.nativeStepMin;
    const i0 = Math.floor(slot);
    const i1 = Math.min(steps.length - 1, i0 + 1);
    const t = slot - i0;
    const left = steps[i0];
    const right = steps[i1];
    const mix = (a: number | null, b: number | null) => (a == null || b == null ? null : a + (b - a) * t);
    const probability = {} as Record<ThresholdId, number | null>;
    for (const threshold of POINT_THRESHOLDS) {
      const blended = mix(left.probability[threshold.id], right.probability[threshold.id]);
      probability[threshold.id] = blended == null ? null : Math.round(blended * 100) / 100;
    }
    const native = t === 0;
    out.push({
      minute,
      interpolated: !native,
      expectedRainRateMmHr: native ? left.expectedRainRateMmHr : mix(left.expectedRainRateMmHr, right.expectedRainRateMmHr),
      p10MmHr: native ? left.p10MmHr : mix(left.p10MmHr, right.p10MmHr),
      p25MmHr: native ? left.p25MmHr : mix(left.p25MmHr, right.p25MmHr),
      p50MmHr: native ? left.p50MmHr : mix(left.p50MmHr, right.p50MmHr),
      p75MmHr: native ? left.p75MmHr : mix(left.p75MmHr, right.p75MmHr),
      p90MmHr: native ? left.p90MmHr : mix(left.p90MmHr, right.p90MmHr),
      probability: native ? left.probability : probability,
    });
  }
  return out;
}

export type CachedRegion = {
  key: string;
  centerLatitude: number;
  centerLongitude: number;
  observationTime: string;
  members: MemberSet;
  motionMs: number;
  evolutionMs: number;
  buildMs: number;
  estimatedBytes: number;
};

const regions = new Map<string, CachedRegion>();

export function regionKey(latitude: number, longitude: number, observationTime: string): { key: string; centerLatitude: number; centerLongitude: number } {
  const centerLatitude = Math.round(latitude / POINT.regionSnapLatDeg) * POINT.regionSnapLatDeg;
  const centerLongitude = Math.round(longitude / POINT.regionSnapLonDeg) * POINT.regionSnapLonDeg;
  return {
    key: `${centerLatitude.toFixed(2)},${centerLongitude.toFixed(2)}|${observationTime}|${POINT_PREDICTOR_VERSION}`,
    centerLatitude,
    centerLongitude,
  };
}

export function clearRegionCache(): void {
  regions.clear();
}

export function regionCacheBytes(): number {
  let total = 0;
  for (const region of regions.values()) total += region.estimatedBytes;
  return total;
}

function estimateBytes(members: MemberSet): number {
  const field = members.field.rainRateMmHr.byteLength + members.field.state.byteLength;
  const evolution = members.evolution.tendencyMmHrPerSec.byteLength + members.evolution.support.byteLength;
  const motion = members.motions.reduce((sum, item) => sum + item.vectors.length * 80, 0);
  return field + evolution + motion;
}

export async function getRegion(
  latitude: number,
  longitude: number,
  issuedAtMs: number,
  times: readonly string[],
): Promise<{ region: CachedRegion | null; cache: 'hit' | 'miss'; error: string | null }> {
  const observation = times
    .map((iso) => ({ iso, dist: Math.abs(Date.parse(iso) - issuedAtMs) }))
    .filter((entry) => Number.isFinite(entry.dist))
    .sort((a, b) => a.dist - b.dist)[0];
  if (!observation || observation.dist > 4 * 60_000) return { region: null, cache: 'miss', error: 'No MRMS frame within 4 minutes' };
  const located = regionKey(latitude, longitude, observation.iso);
  const cached = regions.get(located.key);
  if (cached) {
    regions.delete(located.key);
    regions.set(located.key, cached);
    return { region: cached, cache: 'hit', error: null };
  }
  const started = Date.now();
  const history = await loadRegionalHistory(located.centerLatitude, located.centerLongitude, Date.parse(observation.iso), times);
  const latest = history.frames[history.frames.length - 1];
  if (!latest || history.frames.length < 2) return { region: null, cache: 'miss', error: 'fewer than two usable frames' };
  const motionStarted = Date.now();
  const motion = estimateMotion(history.frames);
  const motionMs = Date.now() - motionStarted;
  const evolutionStarted = Date.now();
  const evolution = analyzeEvolution(history.frames, motion);
  const evolutionMs = Date.now() - evolutionStarted;
  const uncertainty = uncertaintyScore(motion, evolution, history);
  const members = prepareMembers(latest, motion, evolution, uncertainty, defaultChunkSec());
  const region: CachedRegion = {
    key: located.key,
    centerLatitude: located.centerLatitude,
    centerLongitude: located.centerLongitude,
    observationTime: observation.iso,
    members,
    motionMs,
    evolutionMs,
    buildMs: Date.now() - started,
    estimatedBytes: estimateBytes(members),
  };
  regions.set(located.key, region);
  while (regions.size > POINT.maxRegions) {
    const oldest = regions.keys().next().value;
    if (oldest === undefined) break;
    regions.delete(oldest);
  }
  return { region, cache: 'miss', error: null };
}

export function sampleMembers(region: CachedRegion, latitude: number, longitude: number, radiusKm: number): { series: MemberSeries[]; sampleMs: number } {
  const started = Date.now();
  const kernel = neighborhoodKernel(latitude, longitude, radiusKm);
  const pixels = kernel.map((sample) => ({
    ...pixelOf(region.members.field.geometry, sample.latitude, sample.longitude),
    weight: sample.weight,
  }));
  const count = region.members.factors.length;
  const steps = POINT.horizonMin / POINT.nativeStepMin + 1;
  const series: MemberSeries[] = [];
  for (let member = 0; member < count; member += 1) {
    const rates: Array<number | null> = [];
    for (let step = 0; step < steps; step += 1) {
      const leadSec = step * POINT.nativeStepMin * 60;
      let weighted = 0;
      let weight = 0;
      for (const pixel of pixels) {
        const rate = memberEvolvedRate(region.members, member, pixel.x, pixel.y, leadSec);
        if (rate == null) continue;
        weighted += rate * pixel.weight;
        weight += pixel.weight;
      }
      rates.push(weight >= 0.5 ? weighted / weight : null);
    }
    series.push({ rates });
  }
  return { series, sampleMs: Date.now() - started };
}

export type PointNowcast = {
  schemaVersion: typeof POINT_SCHEMA_VERSION;
  generatedAt: string;
  observationTime: string;
  predictorVersion: typeof POINT_PREDICTOR_VERSION;
  latitude: number;
  longitude: number;
  /** Predictability of the regional analysis. Not a precipitation probability. */
  confidence: number | null;
  eventThresholdMmHr: number;
  neighborhood: { radiusKm: number; kernel: 'gaussian' | 'exact-cell'; sigmaKm: number | null };
  nativeStepMin: number;
  minutes: PointMinute[];
  /** Onset and ending for the selected event threshold. The same distributions for every band are in `thresholds`. */
  onset: ReturnType<typeof eventDistributions>['onset'];
  ending: ReturnType<typeof eventDistributions>['ending'];
  thresholds: Record<ThresholdId, ReturnType<typeof eventDistributions> & { mmHr: number }>;
  diagnostics: Record<string, string | number | boolean | null>;
};

export function assemblePoint(args: {
  region: CachedRegion;
  latitude: number;
  longitude: number;
  radiusKm: number;
  eventThresholdMmHr: number;
  endingDryMin: number;
  series: MemberSeries[];
  sampleMs: number;
  cache: 'hit' | 'miss';
}): PointNowcast {
  const steps = POINT.horizonMin / POINT.nativeStepMin + 1;
  const native: StepSummary[] = [];
  for (let step = 0; step < steps; step += 1) {
    native.push(summarizeStep(step * POINT.nativeStepMin, args.series.map((member) => member.rates[step] ?? null)));
  }
  const events = eventDistributions(args.series, args.eventThresholdMmHr, args.endingDryMin);
  const thresholds = {} as PointNowcast['thresholds'];
  for (const threshold of POINT_THRESHOLDS) {
    thresholds[threshold.id] = { mmHr: threshold.mmHr, ...eventDistributions(args.series, threshold.mmHr, args.endingDryMin) };
  }
  return {
    schemaVersion: POINT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    observationTime: args.region.observationTime,
    predictorVersion: POINT_PREDICTOR_VERSION,
    latitude: args.latitude,
    longitude: args.longitude,
    confidence: Number((1 - args.region.members.uncertainty).toFixed(3)),
    eventThresholdMmHr: args.eventThresholdMmHr,
    neighborhood: {
      radiusKm: args.radiusKm,
      kernel: args.radiusKm > 0 ? 'gaussian' : 'exact-cell',
      sigmaKm: args.radiusKm > 0 ? args.radiusKm / 2 : null,
    },
    nativeStepMin: POINT.nativeStepMin,
    minutes: interpolate(native),
    onset: events.onset,
    ending: events.ending,
    thresholds,
    diagnostics: {
      regionKey: args.region.key,
      cache: args.cache,
      memberCount: args.series.length,
      radiusKm: args.radiusKm,
      sampleMs: args.sampleMs,
      regionBuildMs: args.region.buildMs,
      motionMs: args.region.motionMs,
      evolutionMs: args.region.evolutionMs,
      ensembleMs: args.sampleMs,
      estimatedRegionBytes: args.region.estimatedBytes,
      cacheBytes: regionCacheBytes(),
      uncertainty: Number(args.region.members.uncertainty.toFixed(3)),
      confidenceMeaning: 'one minus analysis uncertainty; not a rain probability',
    },
  };
}

export async function pointNowcast(args: {
  latitude: number;
  longitude: number;
  issuedAtMs: number;
  times: readonly string[];
  radiusKm?: number;
  eventThresholdMmHr?: number;
  endingDryMin?: number;
}): Promise<PointNowcast | { error: string }> {
  const loaded = await getRegion(args.latitude, args.longitude, args.issuedAtMs, args.times);
  if (!loaded.region) return { error: loaded.error ?? 'Region unavailable' };
  const radiusKm = args.radiusKm ?? POINT.defaultRadiusKm;
  const sampled = sampleMembers(loaded.region, args.latitude, args.longitude, radiusKm);
  return assemblePoint({
    region: loaded.region,
    latitude: args.latitude,
    longitude: args.longitude,
    radiusKm,
    eventThresholdMmHr: args.eventThresholdMmHr ?? POINT.eventThresholdMmHr,
    endingDryMin: args.endingDryMin ?? POINT.endingDryMin,
    series: sampled.series,
    sampleMs: sampled.sampleMs,
    cache: loaded.cache,
  });
}

export type PointScore = {
  thresholdMmHr: number;
  leads: Array<{
    leadMinutes: number;
    probability: number | null;
    outcome: 0 | 1 | null;
    brier: number | null;
    hit: number;
    falseAlarm: number;
    miss: number;
    correctRejection: number;
    expectedMmHr: number | null;
    observedMmHr: number | null;
    absError: number | null;
    insideP10P90: boolean | null;
    insideP25P75: boolean | null;
  }>;
};

/** Event skill uses probability at the decision line. Rate error uses the mean. */
export function scorePointMinutes(
  minutes: readonly PointMinute[],
  observations: readonly { leadMinutes: number; rainRateMmHr: number | null }[],
  threshold: { id: ThresholdId; mmHr: number },
): PointScore {
  const leads = SCORE_LEADS_MIN.map((leadMinutes) => {
    const minute = minutes.find((row) => row.minute === leadMinutes);
    const observed = observations.find((row) => row.leadMinutes === leadMinutes)?.rainRateMmHr ?? null;
    const probability = minute?.probability[threshold.id] ?? null;
    const expected = minute?.expectedRainRateMmHr ?? null;
    if (probability == null || observed == null || minute == null) {
      return {
        leadMinutes,
        probability,
        outcome: null,
        brier: null,
        hit: 0,
        falseAlarm: 0,
        miss: 0,
        correctRejection: 0,
        expectedMmHr: expected,
        observedMmHr: observed,
        absError: expected == null || observed == null ? null : Math.abs(expected - observed),
        insideP10P90: null,
        insideP25P75: null,
      };
    }
    const outcome: 0 | 1 = rateMeets(observed, threshold.mmHr) ? 1 : 0;
    const predicted = probability >= POINT.decisionProbability ? 1 : 0;
    const inside =
      minute.p10MmHr != null && minute.p90MmHr != null ? observed >= minute.p10MmHr && observed <= minute.p90MmHr : null;
    const inner =
      minute.p25MmHr != null && minute.p75MmHr != null ? observed >= minute.p25MmHr && observed <= minute.p75MmHr : null;
    return {
      leadMinutes,
      probability,
      outcome,
      brier: (probability - outcome) ** 2,
      hit: predicted === 1 && outcome === 1 ? 1 : 0,
      falseAlarm: predicted === 1 && outcome === 0 ? 1 : 0,
      miss: predicted === 0 && outcome === 1 ? 1 : 0,
      correctRejection: predicted === 0 && outcome === 0 ? 1 : 0,
      expectedMmHr: expected,
      observedMmHr: observed,
      absError: expected == null ? null : Math.abs(expected - observed),
      insideP10P90: inside,
      insideP25P75: inner,
    };
  });
  return { thresholdMmHr: threshold.mmHr, leads };
}
