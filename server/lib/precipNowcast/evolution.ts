/**
 * Motion-compensated evolution.
 *
 * Previous frames are aligned with the newer frame through the Phase 2
 * velocity field. The residual is rain that appeared, intensified, weakened,
 * or vanished after that alignment. Translation alone leaves a residual near
 * zero. Missing samples are skipped and are never counted as decay.
 *
 * A block's tendency is clamped, then forgotten with a half-life, so a short
 * noisy trend cannot run away. These limits are not fitted to any one storm.
 */
import { CELL_MISSING, CELL_VALUE, sampleField, type ObservationField } from './field';
import { MOTION, vectorAtPixel, type MotionField } from './motion';
import { RAIN_THRESHOLD_MM_HR } from './thresholds';

export const EVOLUTION = {
  /** How fast an observed tendency is forgotten. Twelve minutes. */
  halfLifeSec: 12 * 60,
  /**
   * Largest rain-rate change retained from the history, in mm/hr per minute.
   * The forecast then applies that change with `halfLifeSec`, so the added
   * rain approaches (this value) / 60 * halfLifeSec, about 36 mm/hr, and stops.
   */
  maxTendencyMmHrPerMin: 3,
  /** Hard ceiling. Above the storm band (25 mm/hr) and above the tendency asymptote. */
  maxRateMmHr: 75,
  /** Newer frame pairs count more. An 8-minute-old pair has about 37% of the newest weight. */
  pairMemorySec: 8 * 60,
  memberCount: 24,
} as const;

export type EvolutionAnalysis = {
  columns: number;
  rows: number;
  /** Millimetres per hour per second. Zero where the block had no comparable samples. */
  tendencyMmHrPerSec: Float32Array;
  support: Uint16Array;
  meanTendencyMmHrPerMin: number;
  peakTendencyMmHrPerMin: number;
  /** Relative wet-area change per minute after alignment. Positive means expansion. */
  expansionPerMin: number;
  initiationFraction: number;
  disappearanceFraction: number;
  pairsUsed: number;
  pairsRejected: number;
  /** Pair-to-pair disagreement of the mean tendency. Zero is a steady signal. */
  volatility: number;
};

function blockAt(x: number, y: number, columns: number, rows: number): number | null {
  const col = Math.round((x - MOTION.blockPx / 2) / MOTION.stepPx);
  const row = Math.round((y - MOTION.blockPx / 2) / MOTION.stepPx);
  if (col < 0 || row < 0 || col >= columns || row >= rows) return null;
  return row * columns + col;
}

function alignedRate(
  older: ObservationField,
  motion: MotionField,
  x: number,
  y: number,
  dtSec: number,
): number | null {
  const velocity = vectorAtPixel(motion, x, y);
  if (velocity) {
    const sx = x - (velocity.eastMs * dtSec) / older.geometry.metersPerPixelX;
    const sy = y - (-velocity.northMs * dtSec) / older.geometry.metersPerPixelY;
    return sampleField(older, sx, sy).rainRateMmHr;
  }
  const stayed = sampleField(older, x, y);
  if (stayed.rainRateMmHr == null || stayed.echoWeight >= 0.05) return null;
  return 0;
}

export function analyzeEvolution(frames: readonly ObservationField[], motion: MotionField): EvolutionAnalysis {
  const latest = frames[frames.length - 1];
  const columns = motion.columns;
  const rows = motion.rows;
  const blocks = Math.max(0, columns * rows);
  const residualW = new Float64Array(blocks);
  const timeW = new Float64Array(blocks);
  const support = new Uint16Array(blocks);
  let wetObs = 0;
  let wetAdv = 0;
  let initiated = 0;
  let disappeared = 0;
  let comparable = 0;
  let pairsUsed = 0;
  let pairsRejected = 0;
  let durationWeight = 0;
  let durationSum = 0;
  const pairMeans: number[] = [];
  const latestMs = latest ? Date.parse(latest.validAt) : 0;

  for (let i = 1; i < frames.length; i += 1) {
    const older = frames[i - 1];
    const newer = frames[i];
    const dtSec = (Date.parse(newer.validAt) - Date.parse(older.validAt)) / 1000;
    if (!Number.isFinite(dtSec) || dtSec < MOTION.minPairSec || dtSec > MOTION.maxPairSec) {
      pairsRejected += 1;
      continue;
    }
    const ageSec = Math.max(0, (latestMs - Date.parse(newer.validAt)) / 1000);
    const weight = Math.exp(-ageSec / EVOLUTION.pairMemorySec);
    durationWeight += weight;
    durationSum += weight * dtSec;
    let pairResidual = 0;
    let pairN = 0;
    const { width, height } = newer.geometry;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (newer.state[index] === CELL_MISSING) continue;
        const observed = newer.state[index] === CELL_VALUE ? newer.rainRateMmHr[index] : 0;
        let advected = alignedRate(older, motion, x, y, dtSec);
        if (advected == null && observed <= RAIN_THRESHOLD_MM_HR) {
          const stayed = sampleField(older, x, y);
          if (stayed.rainRateMmHr != null && stayed.echoWeight >= 0.05) advected = stayed.rainRateMmHr;
        }
        if (advected == null || !Number.isFinite(observed)) continue;
        const residual = observed - advected;
        const block = blockAt(x, y, columns, rows);
        if (block != null) {
          residualW[block] += weight * residual;
          timeW[block] += weight * dtSec;
          support[block] += 1;
        }
        pairResidual += residual;
        pairN += 1;
        comparable += weight;
        const obsWet = observed > RAIN_THRESHOLD_MM_HR;
        const advWet = advected > RAIN_THRESHOLD_MM_HR;
        if (obsWet) wetObs += weight;
        if (advWet) wetAdv += weight;
        if (obsWet && !advWet) initiated += weight;
        if (!obsWet && advWet) disappeared += weight;
      }
    }
    pairsUsed += 1;
    if (pairN > 0) pairMeans.push((pairResidual / pairN / dtSec) * 60);
  }

  const tendency = new Float32Array(blocks);
  const cap = EVOLUTION.maxTendencyMmHrPerMin / 60;
  const supported: number[] = [];
  for (let i = 0; i < blocks; i += 1) {
    if (!(timeW[i] > 0) || support[i] === 0) continue;
    const perSec = Math.max(-cap, Math.min(cap, residualW[i] / timeW[i]));
    tendency[i] = perSec;
    supported.push(perSec * 60);
  }
  supported.sort((a, b) => a - b);
  const meanTendencyMmHrPerMin = supported.length
    ? supported.reduce((sum, value) => sum + value, 0) / supported.length
    : 0;
  const peakTendencyMmHrPerMin = supported.length ? supported[supported.length - 1] : 0;
  const meanDtMin = durationWeight > 0 ? durationSum / durationWeight / 60 : 2;
  const expansionPerMin = wetAdv > 0 ? (wetObs - wetAdv) / wetAdv / meanDtMin : 0;
  let volatility = pairMeans.length < 2 ? 0.25 : 0;
  if (pairMeans.length >= 2) {
    const mean = pairMeans.reduce((sum, value) => sum + value, 0) / pairMeans.length;
    const variance = pairMeans.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pairMeans.length;
    volatility = Math.sqrt(variance) / (Math.abs(mean) + 0.5);
  }

  return {
    columns,
    rows,
    tendencyMmHrPerSec: tendency,
    support,
    meanTendencyMmHrPerMin,
    peakTendencyMmHrPerMin,
    expansionPerMin: Number.isFinite(expansionPerMin) ? expansionPerMin : 0,
    initiationFraction: comparable > 0 ? initiated / comparable : 0,
    disappearanceFraction: comparable > 0 ? disappeared / comparable : 0,
    pairsUsed,
    pairsRejected,
    volatility,
  };
}

export function tendencyAtPixel(evolution: EvolutionAnalysis, x: number, y: number): number {
  if (!evolution.columns || !evolution.tendencyMmHrPerSec.length) return 0;
  const col = (x - MOTION.blockPx / 2) / MOTION.stepPx;
  const row = (y - MOTION.blockPx / 2) / MOTION.stepPx;
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const tx = col - x0;
  const ty = row - y0;
  let value = 0;
  let weight = 0;
  const corners = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ] as const;
  for (const [cx, cy, w] of corners) {
    if (w <= 0 || cx < 0 || cy < 0 || cx >= evolution.columns || cy >= evolution.rows) continue;
    const index = cy * evolution.columns + cx;
    if (evolution.support[index] === 0) continue;
    value += evolution.tendencyMmHrPerSec[index] * w;
    weight += w;
  }
  return weight > 0 ? value / weight : 0;
}

/** Advected rate plus a tendency that forgets itself. Never exceeds the configured ceiling. */
export function applyEvolution(rateMmHr: number, tendencyMmHrPerSec: number, leadSec: number, halfLifeSec = EVOLUTION.halfLifeSec): number {
  const tau = Math.max(60, halfLifeSec);
  const added = tendencyMmHrPerSec * tau * (1 - Math.exp(-Math.max(0, leadSec) / tau));
  const next = rateMmHr + added;
  if (next <= 0) return 0;
  if (next >= EVOLUTION.maxRateMmHr) return EVOLUTION.maxRateMmHr;
  return next;
}
