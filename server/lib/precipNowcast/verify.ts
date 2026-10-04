/**
 * Scores stored point nowcasts. It does not refit the predictor.
 * A region-hour is one event. Points inside it are not independent samples.
 * A region-day is reported as well, because adjacent hours of one storm are still one storm.
 */
import type { CaseBundle, StoredPoint } from './caseFile';
import { crps } from './calibration';
import { decide, DECISION, CANDIDATE_CUTOFFS, type ShadowDecision } from './decision';
import { gradeProduction, PRODUCTION_GATES, type GateResult } from './gates';
import { POINT, POINT_THRESHOLDS, rateMeets, type PointNowcast, type ThresholdId } from './point';
import { SCORE_LEADS_MIN } from './thresholds';

export function eventId(regionKey: string, observationTime: string): string {
  return `${regionKey.split('|')[0]}|${observationTime.slice(0, 13)}`;
}

export function regionDay(regionKey: string, observationTime: string): string {
  return `${regionKey.split('|')[0]}|${observationTime.slice(0, 10)}`;
}

type LeadRow = {
  eventId: string;
  dayId: string;
  leadMinutes: number;
  observed: number;
  expected: number;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  probability: Partial<Record<ThresholdId, number | null>>;
  members: number[] | null;
  regime: string | null;
};

export type ArchivePoint = {
  id: string;
  observationTime: string;
  eventId: string;
  dayId: string;
  regionKey: string;
  regime: string | null;
  analysisMmHr: number | null;
  decision: ShadowDecision | null;
  observedOnsetMin: number | 'already' | null;
  observedEndingMin: number | null;
  leads: Array<{ leadMinutes: number; rainRateMmHr: number | null }>;
  /** Largest |forecast − observed| on a lead that actually reached 0.6 mm/hr. */
  maxWetAbsError: number | null;
  leadsComplete: boolean;
};

function membersAt(point: StoredPoint, leadMinutes: number): number[] | null {
  if (leadMinutes % POINT.nativeStepMin !== 0) return null;
  const step = leadMinutes / POINT.nativeStepMin;
  const column = point.memberRates[step];
  if (!column) return null;
  return column.filter((value): value is number => value != null && Number.isFinite(value));
}

function minuteOf(forecast: PointNowcast, leadMinutes: number) {
  return forecast.minutes.find((row) => row.minute === leadMinutes) ?? null;
}

export function pointsFromBundle(bundle: CaseBundle): ArchivePoint[] {
  const event = eventId(bundle.regionKey, bundle.observationTime);
  const day = regionDay(bundle.regionKey, bundle.observationTime);
  return bundle.points.map((point) => {
    const analysis = point.verification?.leads.find((lead) => lead.leadMinutes === 0)?.rainRateMmHr ?? null;
    const leads = SCORE_LEADS_MIN.map((leadMinutes) => ({
      leadMinutes,
      rainRateMmHr: point.verification?.leads.find((lead) => lead.leadMinutes === leadMinutes)?.rainRateMmHr ?? null,
    }));
    let maxWetAbsError: number | null = null;
    for (const lead of leads) {
      const expected = point.forecast?.minutes.find((minute) => minute.minute === lead.leadMinutes)?.expectedRainRateMmHr ?? null;
      if (lead.rainRateMmHr == null || expected == null || lead.rainRateMmHr < POINT.eventThresholdMmHr) continue;
      const error = Math.abs(expected - lead.rainRateMmHr);
      if (maxWetAbsError == null || error > maxWetAbsError) maxWetAbsError = error;
    }
    return {
      id: point.id,
      observationTime: bundle.observationTime,
      eventId: event,
      dayId: day,
      regionKey: bundle.regionKey,
      regime: point.intendedRegime,
      analysisMmHr: analysis,
      decision: point.forecast ? decide(point.forecast) : null,
      observedOnsetMin: observedOnset(analysis, leads),
      observedEndingMin: observedEnding(analysis, leads),
      leads,
      maxWetAbsError,
      leadsComplete: leads.every((lead) => lead.rainRateMmHr != null),
    };
  });
}

function observedOnset(
  analysis: number | null,
  leads: readonly { leadMinutes: number; rainRateMmHr: number | null }[],
): number | 'already' | null {
  if (analysis == null) return null;
  if (analysis >= POINT.eventThresholdMmHr) return 'already';
  for (const lead of leads) {
    if (lead.rainRateMmHr != null && lead.rainRateMmHr >= POINT.eventThresholdMmHr) return lead.leadMinutes;
  }
  return null;
}

/** Two verifying leads below 0.6. The leads are 10–15 minutes apart, so this is the 8-minute rule at the resolution we stored. */
function observedEnding(
  analysis: number | null,
  leads: readonly { leadMinutes: number; rainRateMmHr: number | null }[],
): number | null {
  if (analysis == null || analysis < POINT.eventThresholdMmHr) return null;
  for (let i = 0; i < leads.length - 1; i += 1) {
    const current = leads[i].rainRateMmHr;
    const next = leads[i + 1].rainRateMmHr;
    if (current == null || next == null) continue;
    if (current < POINT.eventThresholdMmHr && next < POINT.eventThresholdMmHr) return leads[i].leadMinutes;
  }
  return null;
}

function leadRows(bundles: readonly CaseBundle[]): LeadRow[] {
  const rows: LeadRow[] = [];
  for (const bundle of bundles) {
    for (const point of bundle.points) {
      const id = eventId(bundle.regionKey, bundle.observationTime);
      const day = regionDay(bundle.regionKey, bundle.observationTime);
      for (const leadMinutes of SCORE_LEADS_MIN) {
        const observed = point.verification?.leads.find((lead) => lead.leadMinutes === leadMinutes)?.rainRateMmHr;
        const minute = minuteOf(point.forecast, leadMinutes);
        if (observed == null || minute?.expectedRainRateMmHr == null) continue;
        rows.push({
          eventId: id,
          dayId: day,
          leadMinutes,
          observed,
          expected: minute.expectedRainRateMmHr,
          p10: minute.p10MmHr,
          p25: minute.p25MmHr,
          p75: minute.p75MmHr,
          p90: minute.p90MmHr,
          probability: minute.probability,
          members: membersAt(point, leadMinutes),
          regime: point.intendedRegime,
        });
      }
    }
  }
  return rows;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function unique(values: string[]): number {
  return new Set(values).size;
}

const BINS = [0, 0.2, 0.4, 0.6, 0.8, 1];

function reliability(rows: LeadRow[], threshold: ThresholdId) {
  const spec = POINT_THRESHOLDS.find((item) => item.id === threshold)!;
  return BINS.slice(0, -1).map((lo, index) => {
    const hi = BINS[index + 1];
    const bin = rows.filter((row) => {
      const probability = row.probability[threshold];
      if (probability == null) return false;
      return index === BINS.length - 2 ? probability >= lo && probability <= hi : probability >= lo && probability < hi;
    });
    const hits = bin.filter((row) => rateMeets(row.observed, spec.mmHr)).length;
    const events = unique(bin.map((row) => row.eventId));
    return {
      bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
      count: bin.length,
      events,
      meanProbability: mean(bin.map((row) => row.probability[threshold]!)),
      observedFrequency: bin.length ? hits / bin.length : null,
      readable: bin.length >= PRODUCTION_GATES.reliabilityPointLeads && events >= PRODUCTION_GATES.reliabilityEvents,
    };
  });
}

function contingency(rows: LeadRow[], threshold: ThresholdId) {
  const spec = POINT_THRESHOLDS.find((item) => item.id === threshold)!;
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  let correctRejections = 0;
  for (const row of rows) {
    const probability = row.probability[threshold];
    if (probability == null) continue;
    const yes = probability >= POINT.decisionProbability;
    const occurred = rateMeets(row.observed, spec.mmHr);
    if (yes && occurred) hits += 1;
    else if (!yes && occurred) misses += 1;
    else if (yes && !occurred) falseAlarms += 1;
    else correctRejections += 1;
  }
  const events = hits + misses;
  const none = falseAlarms + correctRejections;
  return {
    hits,
    misses,
    falseAlarms,
    correctRejections,
    hitRate: events ? hits / events : null,
    missRate: events ? misses / events : null,
    falseAlarmRate: none ? falseAlarms / none : null,
    correctRejectionRate: none ? correctRejections / none : null,
  };
}

function brierOf(rows: LeadRow[], threshold: ThresholdId) {
  const spec = POINT_THRESHOLDS.find((item) => item.id === threshold)!;
  const scored = rows.filter((row) => row.probability[threshold] != null);
  if (!scored.length) return { score: null, reliability: null, resolution: null, uncertainty: null, count: 0 };
  const outcomes = scored.map((row) => (rateMeets(row.observed, spec.mmHr) ? 1 : 0));
  const base = outcomes.reduce<number>((sum, value) => sum + value, 0) / outcomes.length;
  const score = scored.reduce((sum, row, index) => sum + (row.probability[threshold]! - outcomes[index]) ** 2, 0) / scored.length;
  let reliabilityPart = 0;
  let resolutionPart = 0;
  for (let index = 0; index < BINS.length - 1; index += 1) {
    const lo = BINS[index];
    const hi = BINS[index + 1];
    const bin = scored.filter((row) => {
      const probability = row.probability[threshold]!;
      return index === BINS.length - 2 ? probability >= lo && probability <= hi : probability >= lo && probability < hi;
    });
    if (!bin.length) continue;
    const freq = bin.filter((row) => rateMeets(row.observed, spec.mmHr)).length / bin.length;
    const forecast = bin.reduce((sum, row) => sum + row.probability[threshold]!, 0) / bin.length;
    const weight = bin.length / scored.length;
    reliabilityPart += weight * (forecast - freq) ** 2;
    resolutionPart += weight * (freq - base) ** 2;
  }
  return {
    score,
    reliability: reliabilityPart,
    resolution: resolutionPart,
    uncertainty: base * (1 - base),
    count: scored.length,
    events: unique(scored.map((row) => row.eventId)),
  };
}

export type VerifyReport = {
  pointLeads: number;
  events: number;
  regionDays: number;
  wetRegionDays: number;
  gates: GateResult[];
  byLead: Array<Record<string, number | string | null>>;
  thresholds: Array<Record<string, unknown>>;
  spread: { wetLowError: number | null; wetHighError: number | null; wetLowCount: number; wetHighCount: number; ranksError: boolean | null };
  onset: Record<string, number | null>;
  ending: Record<string, number | null>;
  cutoffs: Array<{
    cutoff: number;
    forecasts: number;
    events: number;
    precision: number | null;
    recall: number | null;
    falseAlarmShare: number | null;
    enough: boolean;
  }>;
  examples: Array<Record<string, unknown>>;
};

function coverage(rows: LeadRow[], inner: boolean): number | null {
  const ready = rows.filter((row) => (inner ? row.p25 != null && row.p75 != null : row.p10 != null && row.p90 != null));
  if (!ready.length) return null;
  const hit = ready.filter((row) => (inner ? row.observed >= row.p25! && row.observed <= row.p75! : row.observed >= row.p10! && row.observed <= row.p90!));
  return hit.length / ready.length;
}

export function verifyArchive(bundles: readonly CaseBundle[]): VerifyReport {
  const points = bundles.flatMap(pointsFromBundle);
  const rows = leadRows(bundles);
  const wet = rows.filter((row) => row.observed >= POINT.eventThresholdMmHr);
  const byLead = SCORE_LEADS_MIN.map((leadMinutes) => {
    const leads = rows.filter((row) => row.leadMinutes === leadMinutes);
    const errors = leads.map((row) => Math.abs(row.expected - row.observed));
    const bias = leads.map((row) => row.expected - row.observed);
    const spreads = leads.filter((row) => row.p10 != null && row.p90 != null).map((row) => row.p90! - row.p10!);
    const crpsValues = leads
      .map((row) => (row.members ? crps(row.members, row.observed) : null))
      .filter((value): value is number => value != null);
    const wetLeads = leads.filter((row) => row.observed >= POINT.eventThresholdMmHr);
    return {
      leadMinutes,
      count: leads.length,
      events: unique(leads.map((row) => row.eventId)),
      mae: mean(errors),
      medianAbs: median(errors),
      bias: mean(bias),
      crps: mean(crpsValues),
      p10p90: coverage(leads, false),
      p25p75: coverage(leads, true),
      wetCount: wetLeads.length,
      wetP10p90: coverage(wetLeads, false),
      meanSpread: mean(spreads),
    };
  });

  const thresholds = POINT_THRESHOLDS.map((threshold) => ({
    id: threshold.id,
    mmHr: threshold.mmHr,
    brier: brierOf(rows, threshold.id),
    counts: contingency(rows, threshold.id),
    reliability: reliability(rows, threshold.id),
  }));

  const lightBins = thresholds.find((item) => item.id === 'light')?.reliability ?? [];
  const readableLightBins = lightBins.filter((bin) => bin.readable && bin.bin !== '0.0-0.2').length;

  const spreads = wet.filter((row) => row.p10 != null && row.p90 != null).map((row) => ({ ...row, spread: row.p90! - row.p10! }));
  const mid = median(spreads.map((row) => row.spread));
  const low = mid == null ? [] : spreads.filter((row) => row.spread <= mid);
  const high = mid == null ? [] : spreads.filter((row) => row.spread > mid);
  const wetLowError = mean(low.map((row) => Math.abs(row.expected - row.observed)));
  const wetHighError = mean(high.map((row) => Math.abs(row.expected - row.observed)));

  const onsetPoints = points.filter((point) => point.observedOnsetMin !== 'already' && point.analysisMmHr != null);
  const onsetEvents = onsetPoints.filter((point) => typeof point.observedOnsetMin === 'number');
  const onsetEventIds = unique(onsetEvents.map((point) => point.eventId));
  const timed = onsetEvents.filter((point) => point.decision?.onsetP50Minutes != null);
  const onsetErrors = timed.map((point) => point.decision!.onsetP50Minutes! - (point.observedOnsetMin as number));
  const missed = onsetEvents.filter((point) => (point.decision?.meaningfulRainProbability ?? 1) < POINT.decisionProbability);
  const falseOnset = onsetPoints.filter(
    (point) => point.observedOnsetMin == null && point.leads.every((lead) => lead.rainRateMmHr != null) && (point.decision?.meaningfulRainProbability ?? 0) >= POINT.decisionProbability,
  );

  const raining = points.filter((point) => point.analysisMmHr != null && point.analysisMmHr >= POINT.eventThresholdMmHr && point.leads.some((lead) => lead.rainRateMmHr != null));
  const endings = raining.filter((point) => point.observedEndingMin != null);
  const endingTimed = endings.filter((point) => point.decision?.endingP50Minutes != null);
  const endingErrors = endingTimed.map((point) => point.decision!.endingP50Minutes! - point.observedEndingMin!);
  const stillWet = raining.filter((point) => point.leads.every((lead) => lead.rainRateMmHr != null && lead.rainRateMmHr >= POINT.eventThresholdMmHr));
  const falseEnding = stillWet.filter((point) => (point.decision?.endingP50Minutes != null ? (forecastEndingLikely(point)) : false));
  const missedEnding = endings.filter((point) => !forecastEndingLikely(point));

  const likely = points.filter((point) => (point.decision?.meaningfulRainProbability ?? 0) >= DECISION.likelyAt && point.leads.every((lead) => lead.rainRateMmHr != null));
  const likelyWrong = likely.filter((point) => point.analysisMmHr != null && point.analysisMmHr < POINT.eventThresholdMmHr && point.leads.every((lead) => (lead.rainRateMmHr ?? 0) < POINT.eventThresholdMmHr));

  const cutoffs = CANDIDATE_CUTOFFS.map((cutoff) => {
    const called = points.filter((point) => (point.decision?.meaningfulRainProbability ?? -1) >= cutoff && point.analysisMmHr != null && point.leads.every((lead) => lead.rainRateMmHr != null));
    const happened = (point: ArchivePoint) =>
      (point.analysisMmHr ?? 0) >= POINT.eventThresholdMmHr || point.leads.some((lead) => (lead.rainRateMmHr ?? 0) >= POINT.eventThresholdMmHr);
    const hits = called.filter(happened).length;
    const eligible = points.filter((point) => point.analysisMmHr != null && point.leads.every((lead) => lead.rainRateMmHr != null));
    const actual = eligible.filter(happened);
    const recalled = actual.filter((point) => (point.decision?.meaningfulRainProbability ?? -1) >= cutoff).length;
    return {
      cutoff,
      forecasts: called.length,
      events: unique(called.map((point) => point.eventId)),
      precision: called.length ? hits / called.length : null,
      recall: actual.length ? recalled / actual.length : null,
      falseAlarmShare: called.length ? (called.length - hits) / called.length : null,
      enough: called.length >= PRODUCTION_GATES.likelyForecasts && unique(called.map((point) => point.eventId)) >= PRODUCTION_GATES.likelyEvents,
    };
  });

  const gates = gradeProduction({
    wetEvents: unique(wet.map((row) => row.eventId)),
    onsetEvents: onsetEventIds,
    endingEvents: unique(endings.map((point) => point.eventId)),
    readableLightBins,
    wetCoverage: coverage(wet, false),
    likelyFalseAlarmRate: likely.length ? likelyWrong.length / likely.length : null,
    likelyForecasts: likely.length,
    likelyEvents: unique(likely.map((point) => point.eventId)),
    onsetMaeMin: mean(onsetErrors.map((value) => Math.abs(value))),
    onsetTimedEvents: unique(timed.map((point) => point.eventId)),
  });

  const wetDays = unique(wet.map((row) => row.dayId));
  return {
    pointLeads: rows.length,
    events: unique(rows.map((row) => row.eventId)),
    regionDays: unique(rows.map((row) => row.dayId)),
    wetRegionDays: wetDays,
    gates,
    byLead,
    thresholds,
    spread: {
      wetLowError,
      wetHighError,
      wetLowCount: low.length,
      wetHighCount: high.length,
      ranksError: wetLowError != null && wetHighError != null && low.length >= 8 && high.length >= 8 ? wetHighError > wetLowError : null,
    },
    onset: {
      candidates: onsetPoints.length,
      events: onsetEventIds,
      missed: missed.length,
      falseOnset: falseOnset.length,
      timingMae: mean(onsetErrors.map((value) => Math.abs(value))),
      timingBias: mean(onsetErrors),
      timed: timed.length,
    },
    ending: {
      raining: raining.length,
      events: unique(endings.map((point) => point.eventId)),
      missed: missedEnding.length,
      falseEnding: falseEnding.length,
      timingMae: mean(endingErrors.map((value) => Math.abs(value))),
      timingBias: mean(endingErrors),
      timed: endingTimed.length,
    },
    cutoffs,
    examples: [],
  };
}

function forecastEndingLikely(point: ArchivePoint): boolean {
  return (point.decision?.selectedState === 'ENDING_LIKELY' || point.decision?.selectedState === 'ENDING_POSSIBLE');
}

export function exampleFor(point: ArchivePoint, label: string): Record<string, unknown> {
  const happened = point.leads.map((lead) => `${lead.leadMinutes}:${lead.rainRateMmHr == null ? '—' : lead.rainRateMmHr.toFixed(1)}`).join(' ');
  const state = point.decision?.selectedState ?? 'none';
  let verdict = 'not scored';
  if (state === 'DRY') {
    const stayed = point.analysisMmHr != null && point.analysisMmHr < POINT.eventThresholdMmHr && point.leads.every((lead) => lead.rainRateMmHr != null && lead.rainRateMmHr < POINT.eventThresholdMmHr);
    verdict = stayed ? 'dry statement held' : 'dry statement failed';
  } else if (state === 'RAINING' || state === 'ENDING_POSSIBLE' || state === 'ENDING_LIKELY') {
    verdict = point.analysisMmHr != null && point.analysisMmHr >= POINT.eventThresholdMmHr ? 'rain was already at the point' : 'rain was not established';
  } else if (point.observedOnsetMin === 'already' || (point.analysisMmHr ?? 0) >= POINT.eventThresholdMmHr) {
    verdict = 'already raining; this is not an onset call';
  } else if (typeof point.observedOnsetMin === 'number') {
    verdict = 'rain did develop';
  } else if (point.leads.every((lead) => lead.rainRateMmHr != null)) {
    verdict = 'rain did not develop';
  }
  return {
    label,
    id: point.id,
    at: point.observationTime,
    eventId: point.eventId,
    state,
    phrase: point.decision?.experimentalPhrase ?? null,
    rule: point.decision?.rule ?? null,
    confidence: point.decision?.confidence ?? null,
    meaningful: point.decision?.meaningfulRainProbability ?? null,
    onsetWidth: point.decision?.onsetWidthMinutes ?? null,
    endingWidth: point.decision?.endingWidthMinutes ?? null,
    analysis: point.analysisMmHr,
    leads: happened,
    observedOnsetMin: point.observedOnsetMin,
    observedEndingMin: point.observedEndingMin,
    verdict,
  };
}

/** Future leads only. A null rate is missing, including after the source window has moved on. It is not a dry observation. */
export type VerificationState = 'pending' | 'partial' | 'verified';

export function verificationState(bundle: CaseBundle): VerificationState {
  let numeric = 0;
  let missing = 0;
  for (const point of bundle.points) {
    for (const leadMinutes of SCORE_LEADS_MIN) {
      const rate = point.verification?.leads.find((lead) => lead.leadMinutes === leadMinutes)?.rainRateMmHr;
      if (rate == null || !Number.isFinite(rate)) missing += 1;
      else numeric += 1;
    }
  }
  if (missing === 0 && numeric > 0) return 'verified';
  if (numeric === 0) return 'pending';
  return 'partial';
}

const RAIN_CALLS = new Set(['RAIN_POSSIBLE', 'RAIN_LIKELY', 'RAIN_IMMINENT', 'TIMING_UNCERTAIN']);
const ENDING_CALLS = new Set(['ENDING_POSSIBLE', 'ENDING_LIKELY']);

function stayedBelowMeaningful(point: ArchivePoint): boolean {
  return point.leadsComplete && point.analysisMmHr != null && point.analysisMmHr < POINT.eventThresholdMmHr && point.leads.every((lead) => (lead.rainRateMmHr ?? 0) < POINT.eventThresholdMmHr);
}

/** One stored case per outcome, including the misses. Pending truth is not labeled correct. */
export function representativeExamples(points: readonly ArchivePoint[]): Array<Record<string, unknown>> {
  const complete = points.filter((point) => point.leadsComplete);
  const choices: Array<{ kind: string; point: ArchivePoint | undefined }> = [
    { kind: 'correct-dry', point: complete.find((point) => point.decision?.selectedState === 'DRY' && stayedBelowMeaningful(point)) },
    {
      kind: 'correct-continuation',
      point: complete.find(
        (point) =>
          point.decision?.selectedState === 'RAINING' &&
          (point.analysisMmHr ?? 0) >= POINT.eventThresholdMmHr &&
          point.observedEndingMin == null &&
          point.leads.some((lead) => (lead.rainRateMmHr ?? 0) >= POINT.eventThresholdMmHr),
      ),
    },
    { kind: 'correct-onset', point: complete.find((point) => typeof point.observedOnsetMin === 'number' && RAIN_CALLS.has(point.decision?.selectedState ?? '')) },
    { kind: 'missed-onset', point: complete.find((point) => typeof point.observedOnsetMin === 'number' && !RAIN_CALLS.has(point.decision?.selectedState ?? '')) },
    { kind: 'correct-ending', point: complete.find((point) => point.observedEndingMin != null && ENDING_CALLS.has(point.decision?.selectedState ?? '')) },
    { kind: 'missed-ending', point: complete.find((point) => point.observedEndingMin != null && !ENDING_CALLS.has(point.decision?.selectedState ?? '')) },
    { kind: 'false-alarm', point: complete.find((point) => RAIN_CALLS.has(point.decision?.selectedState ?? '') && stayedBelowMeaningful(point)) },
    { kind: 'timing-uncertain', point: complete.find((point) => point.decision?.selectedState === 'TIMING_UNCERTAIN') },
    { kind: 'large-intensity-miss', point: complete.find((point) => (point.maxWetAbsError ?? 0) >= 10) },
  ];
  return choices.map(({ kind, point }) => (point ? { kind, ...exampleFor(point, kind) } : { kind, missing: true }));
}

export const REVIEW_EXAMPLES: ReadonlyArray<{ id: string; hour: string; label: string }> = [
  { id: 'atlanta-30345', hour: '2026-10-04T12', label: 'Atlanta growth' },
  { id: 'marietta', hour: '2026-10-04T12', label: 'Marietta growth' },
  { id: 'atlanta-downtown', hour: '2026-10-04T12', label: 'Downtown false trace' },
  { id: 'atlanta-30345', hour: '2026-10-04T14', label: '14:00 Atlanta, rain staying light' },
  { id: 'marietta', hour: '2026-10-04T14', label: '14:00 Marietta weakening' },
  { id: 'atlanta-downtown', hour: '2026-10-04T14', label: '14:00 downtown' },
  { id: 'marietta', hour: '2026-10-04T20', label: '20:00 Marietta onset' },
  { id: 'atlanta-downtown', hour: '2026-10-04T20', label: '20:00 downtown growth' },
  { id: 'atlanta-30345', hour: '2026-10-04T20', label: '20:00 Atlanta already heavy' },
  { id: 'miami', hour: '2026-10-04T12', label: 'Miami dry, unstable' },
  { id: 'phoenix', hour: '2026-10-04T12', label: 'Phoenix dry, stable' },
];
