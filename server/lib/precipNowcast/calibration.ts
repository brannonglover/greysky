/**
 * Ensemble calibration on stored point cases.
 * Counts are always returned. A small bin is not a reliability diagram.
 */
import { POINT_THRESHOLDS, rateMeets, type ThresholdId } from './point';
import { SCORE_LEADS_MIN } from './thresholds';

export type CalLead = {
  leadMinutes: number;
  observedMmHr: number | null;
  expectedMmHr: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  probability: Partial<Record<ThresholdId, number | null>>;
  members: Array<number | null> | null;
  regime: string | null;
};

const BINS = [0, 0.2, 0.4, 0.6, 0.8, 1];

export function crps(members: readonly number[], observed: number): number | null {
  const xs = members.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const n = xs.length;
  if (!n || !Number.isFinite(observed)) return null;
  let absolute = 0;
  let pair = 0;
  for (let i = 0; i < n; i += 1) {
    absolute += Math.abs(xs[i] - observed);
    pair += (2 * i - n + 1) * xs[i];
  }
  return absolute / n - pair / (n * n);
}

export type CalibrationReport = {
  sampleCount: number;
  wetLeadCount: number;
  tooSmall: boolean;
  byLead: Array<{
    leadMinutes: number;
    count: number;
    p10p90: number;
    p25p75: number;
    mae: number | null;
    meanSpread: number | null;
    meanCrps: number | null;
    brier: Record<ThresholdId, { score: number | null; count: number }>;
  }>;
  reliability: Array<{
    threshold: ThresholdId;
    bin: string;
    count: number;
    meanProbability: number | null;
    observedFrequency: number | null;
    readable: boolean;
  }>;
  spreadError: Array<{ spread: number; absError: number; leadMinutes: number }>;
};

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calibrate(rows: readonly CalLead[]): CalibrationReport {
  const comparable = rows.filter((row) => row.observedMmHr != null && row.expectedMmHr != null);
  const byLead = SCORE_LEADS_MIN.map((leadMinutes) => {
    const leads = comparable.filter((row) => row.leadMinutes === leadMinutes);
    const covered = leads.filter((row) => row.p10 != null && row.p90 != null && row.observedMmHr! >= row.p10 && row.observedMmHr! <= row.p90);
    const inner = leads.filter((row) => row.p25 != null && row.p75 != null && row.observedMmHr! >= row.p25 && row.observedMmHr! <= row.p75);
    const errors = leads.map((row) => Math.abs(row.expectedMmHr! - row.observedMmHr!));
    const spreads = leads
      .filter((row) => row.p10 != null && row.p90 != null)
      .map((row) => row.p90! - row.p10!);
    const crpsValues = leads
      .map((row) => (row.members ? crps(row.members.filter((value): value is number => value != null), row.observedMmHr!) : null))
      .filter((value): value is number => value != null);
    const brier = {} as CalibrationReport['byLead'][number]['brier'];
    for (const threshold of POINT_THRESHOLDS) {
      const scored = leads.filter((row) => row.probability[threshold.id] != null);
      const total = scored.reduce((sum, row) => {
        const outcome = rateMeets(row.observedMmHr!, threshold.mmHr) ? 1 : 0;
        return sum + (row.probability[threshold.id]! - outcome) ** 2;
      }, 0);
      brier[threshold.id] = { score: scored.length ? total / scored.length : null, count: scored.length };
    }
    return {
      leadMinutes,
      count: leads.length,
      p10p90: covered.length,
      p25p75: inner.length,
      mae: mean(errors),
      meanSpread: mean(spreads),
      meanCrps: mean(crpsValues),
      brier,
    };
  });

  const reliability: CalibrationReport['reliability'] = [];
  for (const threshold of POINT_THRESHOLDS) {
    for (let i = 0; i < BINS.length - 1; i += 1) {
      const lo = BINS[i];
      const hi = BINS[i + 1];
      const binRows = comparable.filter((row) => {
        const probability = row.probability[threshold.id];
        if (probability == null) return false;
        return i === BINS.length - 2 ? probability >= lo && probability <= hi : probability >= lo && probability < hi;
      });
      const probs = binRows.map((row) => row.probability[threshold.id]!);
      const hits = binRows.filter((row) => rateMeets(row.observedMmHr!, threshold.mmHr)).length;
      reliability.push({
        threshold: threshold.id,
        bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
        count: binRows.length,
        meanProbability: mean(probs),
        observedFrequency: binRows.length ? hits / binRows.length : null,
        readable: binRows.length >= 8,
      });
    }
  }

  const spreadError = comparable
    .filter((row) => row.p10 != null && row.p90 != null)
    .map((row) => ({
      spread: row.p90! - row.p10!,
      absError: Math.abs(row.expectedMmHr! - row.observedMmHr!),
      leadMinutes: row.leadMinutes,
    }));

  const wetLeadCount = comparable.filter((row) => row.observedMmHr != null && row.observedMmHr >= 0.6).length;
  return {
    sampleCount: comparable.length,
    wetLeadCount,
    tooSmall: comparable.length < 30 || wetLeadCount < 20,
    byLead,
    reliability,
    spreadError,
  };
}
