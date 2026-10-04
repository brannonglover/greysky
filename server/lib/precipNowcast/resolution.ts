/**
 * Lead spacing is chosen on a synthetic moving cell, not on a live storm.
 * The reference is a 1-minute backward trace. A coarser step is acceptable
 * when the interpolated point rate stays within 0.5 mm/hr and the core's
 * arrival shifts by at most 2 minutes.
 */
import { emptyField, paintGaussian, regionGeometry, shiftField } from './field';
import { estimateMotion } from './motion';
import { tracePixel } from './extrapolate';

export const RESOLUTION_RULE = {
  maxRateMaeMmHr: 0.5,
  maxOnsetShiftMin: 2,
  /** Core of the synthetic cell, not the 0.02 mm/hr scoreboard line. */
  onsetMmHr: 6,
  horizonMin: 30,
} as const;

export const LEAD_STEP_CANDIDATES = [5, 2, 1] as const;

export type ResolutionRow = {
  stepMin: number;
  rateMaeMmHr: number;
  onsetShiftMin: number;
  elapsedMs: number;
  heapBytes: number;
};

function series(stepMin: number): { rates: number[]; elapsedMs: number; heapBytes: number } {
  const geometry = regionGeometry(0, 0, 1, 96, 96);
  const first = emptyField('2026-01-01T00:00:00.000Z', geometry, { id: 'synthetic', product: 'resolution' });
  paintGaussian(first, 40, 48, 8, 12);
  const latest = shiftField(first, 3, 0);
  latest.validAt = '2026-01-01T00:02:00.000Z';
  const motion = estimateMotion([first, latest]);
  const x = 58;
  const y = 48;
  const onGrid: Array<number | null> = [];
  for (let lead = 0; lead <= RESOLUTION_RULE.horizonMin; lead += stepMin) {
    onGrid.push(tracePixel(latest, motion, x, y, lead * 60, stepMin * 60).rainRateMmHr);
  }
  const rates: number[] = [];
  for (let minute = 1; minute <= RESOLUTION_RULE.horizonMin; minute += 1) {
    const slot = minute / stepMin;
    const i0 = Math.floor(slot);
    const i1 = Math.min(onGrid.length - 1, i0 + 1);
    const t = slot - i0;
    const left = onGrid[i0];
    const right = onGrid[i1];
    if (left == null || right == null) rates.push(Number.NaN);
    else rates.push(left + (right - left) * t);
  }
  const sweepStarted = Date.now();
  const heapBeforeSweep = process.memoryUsage().heapUsed;
  let sink = 0;
  for (let y = 0; y < latest.geometry.height; y += 1) {
    for (let x = 0; x < latest.geometry.width; x += 1) {
      sink += tracePixel(latest, motion, x, y, RESOLUTION_RULE.horizonMin * 60, stepMin * 60).rainRateMmHr ?? 0;
    }
  }
  const elapsedMs = Date.now() - sweepStarted;
  const heapBytes = Math.max(0, process.memoryUsage().heapUsed - heapBeforeSweep);
  if (sink === Number.NEGATIVE_INFINITY) return { rates, elapsedMs: -1, heapBytes };
  return { rates, elapsedMs, heapBytes };
}

function onsetMinute(rates: readonly number[]): number | null {
  const index = rates.findIndex((rate) => Number.isFinite(rate) && rate >= RESOLUTION_RULE.onsetMmHr);
  return index < 0 ? null : index + 1;
}

export function benchmarkLeadStep(): { chosenMin: number; rows: ResolutionRow[] } {
  const reference = series(1);
  const referenceOnset = onsetMinute(reference.rates);
  const rows: ResolutionRow[] = LEAD_STEP_CANDIDATES.map((stepMin) => {
    const run = stepMin === 1 ? reference : series(stepMin);
    let abs = 0;
    let n = 0;
    for (let i = 0; i < reference.rates.length; i += 1) {
      if (!Number.isFinite(reference.rates[i]) || !Number.isFinite(run.rates[i])) continue;
      abs += Math.abs(reference.rates[i] - run.rates[i]);
      n += 1;
    }
    const onset = onsetMinute(run.rates);
    return {
      stepMin,
      rateMaeMmHr: n ? abs / n : Number.POSITIVE_INFINITY,
      onsetShiftMin: onset == null || referenceOnset == null ? Number.POSITIVE_INFINITY : Math.abs(onset - referenceOnset),
      elapsedMs: run.elapsedMs,
      heapBytes: run.heapBytes,
    };
  });
  const chosen = rows.find(
    (row) => row.rateMaeMmHr <= RESOLUTION_RULE.maxRateMaeMmHr && row.onsetShiftMin <= RESOLUTION_RULE.maxOnsetShiftMin,
  );
  return { chosenMin: chosen?.stepMin ?? 1, rows };
}

let chosenLeadStep: number | null = null;

/** Cheapest stored lead step that stays inside RESOLUTION_RULE on the synthetic cell. */
export function leadStepMin(): number {
  if (chosenLeadStep == null) chosenLeadStep = benchmarkLeadStep().chosenMin;
  return chosenLeadStep;
}
