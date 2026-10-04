/**
 * Acceptance tolerances, fixed before any real-weather score.
 *
 * Speed error may be 30% of the truth or 1.5 m/s, whichever is larger.
 * Direction error may be 25° when the truth is faster than 2 m/s.
 * Two separated motions must stay at least 40° apart.
 * A sub-pixel displacement must be recovered within 0.2 source pixels.
 * Stationary echo must stay under 1.5 m/s and must be a solved vector, not a fallback zero.
 */
import { CELL_EMPTY, CELL_MISSING, CELL_VALUE, emptyField, paintGaussian, regionGeometry, scaleValues, shiftField } from '../lib/precipNowcast/field';
import { compareVelocity, estimateMotion, medianNear, MOTION } from '../lib/precipNowcast/motion';
import { tracePixel } from '../lib/precipNowcast/extrapolate';
import { benchmarkLeadStep, RESOLUTION_RULE } from '../lib/precipNowcast/resolution';

const SPEED_FRACTION = 0.3;
const SPEED_FLOOR_MS = 1.5;
const DIR_DEG = 25;
const SUBPIXEL_PX = 0.2;

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
  if (!ok) failures += 1;
}

function geometry() {
  return regionGeometry(0, 0, 1, 96, 96);
}

function fieldAt(iso: string) {
  const field = emptyField(iso, geometry(), { id: 'synthetic', product: 'test' });
  return field;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function truthFromPixels(dxPx: number, dySouthPx: number, dtSec: number) {
  const metres =  geometry().metersPerPixelX;
  return { eastMs: (dxPx * metres) / dtSec, northMs: (-dySouthPx * metres) / dtSec };
}

function within(est: { eastMs: number; northMs: number }, truth: { eastMs: number; northMs: number }): boolean {
  const error = compareVelocity(est, truth);
  const truthSpeed = Math.hypot(truth.eastMs, truth.northMs);
  const speedOk = error.speedErrorMs <= Math.max(SPEED_FLOOR_MS, SPEED_FRACTION * truthSpeed);
  const dirOk = error.directionErrorDeg == null || error.directionErrorDeg <= DIR_DEG;
  return speedOk && dirOk;
}

function report(label: string, est: { eastMs: number; northMs: number; source: string; quality: number }, truth: { eastMs: number; northMs: number }): void {
  const error = compareVelocity(est, truth);
  const ok = within(est, truth);
  check(
    label,
    ok,
    `truth ${truth.eastMs.toFixed(2)},${truth.northMs.toFixed(2)} est ${est.eastMs.toFixed(2)},${est.northMs.toFixed(2)} ` +
      `speedErr ${error.speedErrorMs.toFixed(2)} dir ${error.directionErrorDeg == null ? 'n/a' : error.directionErrorDeg.toFixed(1)} ` +
      `source ${est.source} q ${est.quality.toFixed(2)}`,
  );
}

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const DT = 120;

function pair(dx: number, dySouth: number, dtSec = DT) {
  const first = fieldAt(iso(T0));
  paintGaussian(first, 48, 48, 8, 12);
  const second = shiftField(first, dx, dySouth);
  second.validAt = iso(T0 + dtSec * 1000);
  return { first, second, truth: truthFromPixels(dx, dySouth, dtSec) };
}

for (const [name, dx, dy] of [
  ['east', 3, 0],
  ['north', 0, -3],
  ['southwest', -2, 2],
  ['fast east', 4, 1],
] as const) {
  const { first, second, truth } = pair(dx, dy);
  const motion = estimateMotion([first, second]);
  const est = medianNear(motion, 48 + dx, 48 + dy, 18);
  if (!est) check(`translation ${name}`, false, 'no solved vector');
  else report(`translation ${name}`, est, truth);
}

{
  const wide = emptyField(iso(T0), regionGeometry(0, 0, 1, 128, 80), { id: 'synthetic', product: 'test' });
  paintGaussian(wide, 32, 40, 7, 14);
  paintGaussian(wide, 96, 40, 7, 10);
  // Shift each blob independently by rewriting from two translated copies.
  const ne = shiftField(wide, 2, -2);
  const se = shiftField(wide, 2, 2);
  const mixed = emptyField(iso(T0 + DT * 1000), wide.geometry, wide.source);
  mixed.state.set(wide.state);
  mixed.rainRateMmHr.set(wide.rainRateMmHr);
  for (let i = 0; i < mixed.state.length; i += 1) {
    const x = i % wide.geometry.width;
    if (x < 64) {
      mixed.state[i] = ne.state[i];
      mixed.rainRateMmHr[i] = ne.rainRateMmHr[i];
    } else {
      mixed.state[i] = se.state[i];
      mixed.rainRateMmHr[i] = se.rainRateMmHr[i];
    }
  }
  const motion = estimateMotion([wide, mixed]);
  const left = medianNear(motion, 34, 38, 16);
  const right = medianNear(motion, 98, 42, 16);
  const truthLeft = truthFromPixels(2, -2, DT);
  const truthRight = truthFromPixels(2, 2, DT);
  if (!left || !right) check('two motions', false, `left ${Boolean(left)} right ${Boolean(right)}`);
  else {
    report('two motions northeast', left, truthLeft);
    report('two motions southeast', right, truthRight);
    const error = compareVelocity(left, right);
    check('two motions stay apart', (error.directionErrorDeg ?? 0) >= 40, `separation ${error.directionErrorDeg}`);
  }
}

{
  const { first } = pair(0, 0);
  const second = shiftField(first, 0, 0);
  second.validAt = iso(T0 + DT * 1000);
  const motion = estimateMotion([first, second]);
  const est = medianNear(motion, 48, 48, 16);
  if (!est) check('stationary', false, 'no solved vector');
  else {
    const speed = Math.hypot(est.eastMs, est.northMs);
    check('stationary stays solved and near zero', est.source === 'solved' && speed <= SPEED_FLOOR_MS, `speed ${speed.toFixed(2)} source ${est.source} q ${est.quality.toFixed(2)}`);
  }
}

{
  const { first, second, truth } = pair(3, 0);
  const grown = scaleValues(second, 1.8);
  grown.validAt = second.validAt;
  const motion = estimateMotion([first, grown]);
  const est = medianNear(motion, 51, 48, 18);
  if (!est) check('growth does not wreck motion', false, 'no solved vector');
  else report('growth does not wreck motion', est, truth);
}

{
  const first = fieldAt(iso(T0));
  paintGaussian(first, 48, 48, 8, 12);
  const hole = 40 * 96 + 30;
  first.state[hole] = CELL_MISSING;
  first.rainRateMmHr[hole] = Number.NaN;
  const second = shiftField(first, 3, 0);
  second.validAt = iso(T0 + DT * 1000);
  check('a missing cell is not stored as 0', !Number.isFinite(first.rainRateMmHr[hole]) && first.state[hole] === CELL_MISSING, String(first.rainRateMmHr[hole]));
  const motion = estimateMotion([first, second]);
  const est = medianNear(motion, 51, 48, 18);
  if (!est) check('motion around a hole', false, 'no solved vector');
  else report('motion around a hole', est, truthFromPixels(3, 0, DT));
}

{
  const slow = pair(2, 0, 60);
  const longDt = pair(8, 0, 240);
  const a = estimateMotion([slow.first, slow.second]);
  const b = estimateMotion([longDt.first, longDt.second]);
  const estA = medianNear(a, 50, 48, 18);
  const estB = medianNear(b, 56, 48, 18);
  if (!estA || !estB) check('irregular dt stays in m/s', false, `a ${Boolean(estA)} b ${Boolean(estB)} rejected ${a.pairsRejected}/${b.pairsRejected}`);
  else {
    report('short dt', estA, slow.truth);
    report('long dt', estB, longDt.truth);
    const gap = Math.abs(estA.eastMs - estB.eastMs);
    check('same physical speed across dt', gap <= Math.max(SPEED_FLOOR_MS, SPEED_FRACTION * slow.truth.eastMs), `gap ${gap.toFixed(2)}`);
  }
  const tooFar = pair(3, 0, MOTION.maxPairSec + 30);
  const rejected = estimateMotion([tooFar.first, tooFar.second]);
  check('a long gap is rejected, not zeroed', rejected.pairsUsed === 0 && rejected.pairsRejected === 1, `used ${rejected.pairsUsed} rejected ${rejected.pairsRejected}`);
}

{
  const { first, truth } = pair(3, 0);
  const noisy = shiftField(first, 3, 0);
  noisy.validAt = iso(T0 + DT * 1000);
  let seed = 17;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < noisy.rainRateMmHr.length; i += 1) {
    if (noisy.state[i] !== 2) continue;
    noisy.rainRateMmHr[i] *= 0.9 + rand() * 0.2;
  }
  const motion = estimateMotion([first, noisy]);
  const est = medianNear(motion, 51, 48, 18);
  if (!est) check('noise does not invent an extreme vector', false, 'no solved vector');
  else {
    report('noise', est, truth);
    const ratio = Math.hypot(est.eastMs, est.northMs) / Math.max(1, Math.hypot(truth.eastMs, truth.northMs));
    check('noise stays under 3x truth speed', ratio < 3, `ratio ${ratio.toFixed(2)}`);
  }
}

{
  const dx = 0.4;
  const dt = 90;
  const { first, second, truth } = pair(dx, 0, dt);
  const motion = estimateMotion([first, second]);
  const est = medianNear(motion, 48 + dx, 48, 18);
  const px = est ? (est.eastMs * dt) / first.geometry.metersPerPixelX : Number.NaN;
  check(
    'subpixel eastward displacement',
    est != null && Math.abs(px - dx) <= SUBPIXEL_PX && within(est, truth),
    est ? `recovered ${px.toFixed(3)} px vs ${dx} truth ${truth.eastMs.toFixed(2)} est ${est.eastMs.toFixed(2)}` : 'no vector',
  );
}

{
  const { first, second } = pair(3, 0);
  const motion = estimateMotion([first, second]);
  const corner = motion.vectors.find((vector, index) => {
    const cx = (index % motion.columns) * MOTION.stepPx + MOTION.blockPx / 2;
    const cy = Math.floor(index / motion.columns) * MOTION.stepPx + MOTION.blockPx / 2;
    return Math.hypot(cx - 12, cy - 12) < 6;
  });
  check(
    'empty corner borrows motion instead of storing zero',
    corner != null && corner.source !== 'solved' && corner.source !== 'unknown' && corner.eastMs > 20,
    corner ? `${corner.eastMs.toFixed(1)} source ${corner.source}` : 'none',
  );
}

{
  const { first, second } = pair(3, 0);
  const motion = estimateMotion([first, second]);
  const ahead = tracePixel(second, motion, 52.5, 48, 60, 60);
  const behind = tracePixel(second, motion, 30, 48, 120, 60);
  check('extrapolation follows the blob', (ahead.rainRateMmHr ?? 0) > 5, `ahead ${ahead.rainRateMmHr}`);
  check('extrapolation leaves the old center', (behind.rainRateMmHr ?? 99) < 0.5, `behind ${behind.rainRateMmHr}`);
}

{
  const dry = fieldAt(iso(T0));
  dry.state.fill(CELL_EMPTY);
  const later = fieldAt(iso(T0 + DT * 1000));
  later.state.fill(CELL_EMPTY);
  const motion = estimateMotion([dry, later]);
  const trace = tracePixel(later, motion, 48, 48, 600, 120);
  check('an empty field stays empty without inventing wind', trace.rainRateMmHr === 0, `rate ${trace.rainRateMmHr}`);
}

{
  const flat = fieldAt(iso(T0));
  flat.state.fill(CELL_VALUE);
  flat.rainRateMmHr.fill(4);
  const later = fieldAt(iso(T0 + DT * 1000));
  later.state.fill(CELL_VALUE);
  later.rainRateMmHr.fill(4);
  const motion = estimateMotion([flat, later]);
  const trace = tracePixel(later, motion, 48, 48, 600, 120);
  const solved = motion.vectors.some((vector) => vector.source === 'solved');
  check('featureless rain is not stored as a zero wind', !solved && trace.rainRateMmHr == null, `solved ${solved} rate ${trace.rainRateMmHr}`);
}

const resolution = benchmarkLeadStep();
console.log('lead-step benchmark (vs 1 min)');
for (const row of resolution.rows) {
  console.log(
    `  ${row.stepMin} min  rateMae ${row.rateMaeMmHr.toFixed(3)}  onsetShift ${row.onsetShiftMin}  field30 ${row.elapsedMs} ms  heap ${row.heapBytes}`,
  );
}
check(
  'a lead step is chosen inside the resolution rule',
  resolution.rows.some(
    (row) =>
      row.stepMin === resolution.chosenMin &&
      row.rateMaeMmHr <= RESOLUTION_RULE.maxRateMaeMmHr &&
      row.onsetShiftMin <= RESOLUTION_RULE.maxOnsetShiftMin,
  ),
  `chose ${resolution.chosenMin}`,
);
console.log(`lead step ${resolution.chosenMin} min`);

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log('synthetic motion ok');
