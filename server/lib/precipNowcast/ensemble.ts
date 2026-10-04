/**
 * One analyzed motion field and one evolution field, perturbed into coherent
 * members. Optical flow is not rerun per member. Pixel noise is not used.
 *
 * Spread widens when vectors disagree, frames are missing, or the evolution
 * signal flips between pairs. The Phase 2 block-quality number is not a probability.
 */
import { pixelOf, sampleField, type ObservationField } from './field';
import { tracePixelSource } from './extrapolate';
import { analyzeEvolution, applyEvolution, EVOLUTION, tendencyAtPixel, type EvolutionAnalysis } from './evolution';
import { estimateMotion, type MotionField, type MotionVector } from './motion';
import type { RegionalHistory } from './history';
import { leadStepMin } from './resolution';
import { RAIN_THRESHOLD_MM_HR, SCORE_LEADS_MIN, type ScoreLeadMin } from './thresholds';

/** Candidate user-noticeable lines. They mirror the light and moderate bands. They are not the scoreboard line. */
export const MEANINGFUL_MM_HR = [0.6, 2.5] as const;

export type MemberFactor = {
  speedScale: number;
  /** Fraction of speed applied perpendicular to the analyzed vector. */
  crossTrack: number;
  tendencyScale: number;
  halfLifeScale: number;
};

export function uncertaintyScore(
  motion: MotionField,
  evolution: EvolutionAnalysis,
  frames: { requested: number; usable: number; failed: number },
): number {
  const count = Math.max(1, motion.vectors.length);
  const solved = motion.vectors.filter((vector) => vector.source === 'solved');
  const thin = 1 - solved.length / count;
  const pairGap = motion.pairsRejected / Math.max(1, motion.pairsUsed + motion.pairsRejected);
  const frameGap = frames.failed / Math.max(1, frames.requested);
  let dirSpread = 0;
  if (solved.length >= 4) {
    const meanEast = solved.reduce((sum, vector) => sum + vector.eastMs, 0) / solved.length;
    const meanNorth = solved.reduce((sum, vector) => sum + vector.northMs, 0) / solved.length;
    const varEast = solved.reduce((sum, vector) => sum + (vector.eastMs - meanEast) ** 2, 0) / solved.length;
    const varNorth = solved.reduce((sum, vector) => sum + (vector.northMs - meanNorth) ** 2, 0) / solved.length;
    const meanSpeed = Math.hypot(meanEast, meanNorth);
    dirSpread = Math.min(1, Math.hypot(Math.sqrt(varEast), Math.sqrt(varNorth)) / (meanSpeed + 2));
  }
  const raw = 0.15 + 0.3 * thin + 0.2 * pairGap + 0.15 * frameGap + 0.3 * dirSpread + 0.25 * Math.min(1, evolution.volatility);
  return Math.max(0.15, Math.min(1, raw));
}

export function memberFactors(uncertainty: number, count: number = EVOLUTION.memberCount): MemberFactor[] {
  const amp = 0.12 + 0.88 * Math.max(0, Math.min(1, uncertainty));
  const factors: MemberFactor[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    factors.push({
      speedScale: 1 + amp * 0.4 * Math.cos(angle),
      crossTrack: amp * 0.45 * Math.sin(angle),
      tendencyScale: 1 + amp * 1.1 * Math.cos(2 * angle + 0.4),
      halfLifeScale: Math.max(0.35, 1 + amp * 0.6 * Math.sin(2 * angle)),
    });
  }
  return factors;
}

export function perturbVelocity(eastMs: number, northMs: number, factor: MemberFactor): { eastMs: number; northMs: number } {
  const speed = Math.hypot(eastMs, northMs);
  if (speed < 1) {
    return {
      eastMs: eastMs + factor.crossTrack * 4,
      northMs: northMs + (factor.speedScale - 1) * 4,
    };
  }
  const along = speed * factor.speedScale;
  const cross = speed * factor.crossTrack;
  const ux = eastMs / speed;
  const uy = northMs / speed;
  return {
    eastMs: ux * along - uy * cross,
    northMs: uy * along + ux * cross,
  };
}

function perturbMotion(motion: MotionField, factor: MemberFactor): MotionField {
  const vectors: MotionVector[] = motion.vectors.map((vector) => {
    if (vector.source === 'unknown' || !Number.isFinite(vector.eastMs)) return vector;
    const next = perturbVelocity(vector.eastMs, vector.northMs, factor);
    return { ...vector, eastMs: next.eastMs, northMs: next.northMs };
  });
  return { ...motion, vectors };
}

function quantile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

export type EnsembleLead = {
  leadMinutes: ScoreLeadMin;
  validAt: string;
  expectedRainRateMmHr: number | null;
  precipProbability: number | null;
  lightProbability: number | null;
  moderateProbability: number | null;
  spreadMmHr: number | null;
  p10MmHr: number | null;
  p90MmHr: number | null;
};

export function ensembleAtPoint(args: {
  field: ObservationField;
  motion: MotionField;
  evolution: EvolutionAnalysis;
  uncertainty: number;
  latitude: number;
  longitude: number;
  issuedAtMs: number;
  chunkSec: number;
  memberCount?: number;
}): { leads: EnsembleLead[]; elapsedMs: number; memberCount: number } {
  const started = Date.now();
  const factors = memberFactors(args.uncertainty, args.memberCount ?? EVOLUTION.memberCount);
  const motions = factors.map((factor) => perturbMotion(args.motion, factor));
  const start = pixelOf(args.field.geometry, args.latitude, args.longitude);
  const leads = SCORE_LEADS_MIN.map((leadMinutes) => {
    const rates: number[] = [];
    for (let i = 0; i < factors.length; i += 1) {
      const traced = tracePixelSource(args.field, motions[i], start.x, start.y, leadMinutes * 60, args.chunkSec);
      if (traced.rainRateMmHr == null) continue;
      const tendency = tendencyAtPixel(args.evolution, traced.x, traced.y) * factors[i].tendencyScale;
      rates.push(applyEvolution(traced.rainRateMmHr, tendency, leadMinutes * 60, EVOLUTION.halfLifeSec * factors[i].halfLifeScale));
    }
    const finite = rates.filter((rate) => Number.isFinite(rate)).sort((a, b) => a - b);
    const mean = finite.length ? finite.reduce((sum, rate) => sum + rate, 0) / finite.length : null;
    const fraction = (threshold: number) => (finite.length ? finite.filter((rate) => rate > threshold).length / finite.length : null);
    const variance = finite.length
      ? finite.reduce((sum, rate) => sum + (rate - (mean ?? 0)) ** 2, 0) / finite.length
      : null;
    return {
      leadMinutes,
      validAt: new Date(args.issuedAtMs + leadMinutes * 60_000).toISOString(),
      expectedRainRateMmHr: mean,
      precipProbability: fraction(RAIN_THRESHOLD_MM_HR),
      lightProbability: fraction(MEANINGFUL_MM_HR[0]),
      moderateProbability: fraction(MEANINGFUL_MM_HR[1]),
      spreadMmHr: variance == null ? null : Math.sqrt(variance),
      p10MmHr: finite.length ? quantile(finite, 0.1) : null,
      p90MmHr: finite.length ? quantile(finite, 0.9) : null,
    };
  });
  return { leads, elapsedMs: Date.now() - started, memberCount: factors.length };
}

export type MemberSet = {
  field: ObservationField;
  evolution: EvolutionAnalysis;
  factors: MemberFactor[];
  motions: MotionField[];
  uncertainty: number;
  chunkSec: number;
};

/** Perturbed motions for one analysis. Callers sample many points from this set. */
export function prepareMembers(
  field: ObservationField,
  motion: MotionField,
  evolution: EvolutionAnalysis,
  uncertainty: number,
  chunkSec: number,
): MemberSet {
  const factors = memberFactors(uncertainty);
  return {
    field,
    evolution,
    factors,
    motions: factors.map((factor) => perturbMotion(motion, factor)),
    uncertainty,
    chunkSec,
  };
}

export function memberEvolvedRate(set: MemberSet, index: number, x: number, y: number, leadSec: number): number | null {
  const traced = tracePixelSource(set.field, set.motions[index], x, y, leadSec, set.chunkSec);
  if (traced.rainRateMmHr == null) return null;
  const tendency = tendencyAtPixel(set.evolution, traced.x, traced.y) * set.factors[index].tendencyScale;
  return applyEvolution(traced.rainRateMmHr, tendency, leadSec, EVOLUTION.halfLifeSec * set.factors[index].halfLifeScale);
}

export function analysisSample(field: ObservationField, latitude: number, longitude: number): number | null {
  const pixel = pixelOf(field.geometry, latitude, longitude);
  return sampleField(field, pixel.x, pixel.y).rainRateMmHr;
}

export function defaultChunkSec(): number {
  return leadStepMin() * 60;
}

function join(values: readonly (number | null)[]): string {
  return values.map((value) => (value == null || !Number.isFinite(value) ? '' : value.toFixed(3))).join(',');
}

export type EnsembleForecast = {
  analysisRateMmHr: number | null;
  analysisValidAt: string;
  leads: EnsembleLead[];
  diagnostics: Record<string, string | number | boolean | null>;
  motion: MotionField | null;
  motionMs: number;
};

/** One optical-flow solve and one evolution pass, then 24 perturbed traces. */
export function ensembleFromHistory(
  history: RegionalHistory,
  args: { latitude: number; longitude: number; issuedAtMs: number },
  prepared?: { motion: MotionField; motionMs: number },
): EnsembleForecast {
  const latest = history.frames[history.frames.length - 1];
  const emptyLeads: EnsembleLead[] = SCORE_LEADS_MIN.map((leadMinutes) => ({
    leadMinutes,
    validAt: new Date(args.issuedAtMs + leadMinutes * 60_000).toISOString(),
    expectedRainRateMmHr: null,
    precipProbability: null,
    lightProbability: null,
    moderateProbability: null,
    spreadMmHr: null,
    p10MmHr: null,
    p90MmHr: null,
  }));
  if (!latest || history.frames.length < 2) {
    return {
      analysisRateMmHr: null,
      analysisValidAt: latest?.validAt ?? new Date(args.issuedAtMs).toISOString(),
      leads: emptyLeads,
      motion: null,
      motionMs: 0,
      diagnostics: { error: 'fewer than two usable frames', memberCount: EVOLUTION.memberCount },
    };
  }
  const motionStarted = Date.now();
  const motion = prepared?.motion ?? estimateMotion(history.frames);
  const motionMs = prepared?.motionMs ?? Date.now() - motionStarted;
  const evolutionStarted = Date.now();
  const evolution = analyzeEvolution(history.frames, motion);
  const evolutionMs = Date.now() - evolutionStarted;
  const uncertainty = uncertaintyScore(motion, evolution, history);
  const pixel = pixelOf(latest.geometry, args.latitude, args.longitude);
  const pointTendency = tendencyAtPixel(evolution, pixel.x, pixel.y) * 60;
  const chunkSec = defaultChunkSec();
  const ensemble = ensembleAtPoint({
    field: latest,
    motion,
    evolution,
    uncertainty,
    latitude: args.latitude,
    longitude: args.longitude,
    issuedAtMs: args.issuedAtMs,
    chunkSec,
  });
  return {
    analysisRateMmHr: analysisSample(latest, args.latitude, args.longitude),
    analysisValidAt: latest.validAt,
    leads: ensemble.leads,
    motion,
    motionMs,
    diagnostics: {
      method: 'coherent-motion-evolution-ensemble',
      memberCount: ensemble.memberCount,
      uncertainty: Number(uncertainty.toFixed(3)),
      halfLifeSec: EVOLUTION.halfLifeSec,
      maxTendencyMmHrPerMin: EVOLUTION.maxTendencyMmHrPerMin,
      maxRateMmHr: EVOLUTION.maxRateMmHr,
      pointTendencyMmHrPerMin: Number(pointTendency.toFixed(3)),
      expansionPerMin: Number(evolution.expansionPerMin.toFixed(4)),
      initiationFraction: Number(evolution.initiationFraction.toFixed(4)),
      disappearanceFraction: Number(evolution.disappearanceFraction.toFixed(4)),
      evolutionVolatility: Number(evolution.volatility.toFixed(3)),
      evolutionPairs: evolution.pairsUsed,
      motionMs,
      evolutionMs,
      ensembleMs: ensemble.elapsedMs,
      leadStepMin: chunkSec / 60,
      lightProb: join(ensemble.leads.map((lead) => lead.lightProbability)),
      moderateProb: join(ensemble.leads.map((lead) => lead.moderateProbability)),
      spread: join(ensemble.leads.map((lead) => lead.spreadMmHr)),
      p10: join(ensemble.leads.map((lead) => lead.p10MmHr)),
      p90: join(ensemble.leads.map((lead) => lead.p90MmHr)),
      heapUsedBytes: process.memoryUsage().heapUsed,
      error: null,
    },
  };
}
