/**
 * Acceptance criteria, fixed before any live storm is scored.
 *
 * Pure translation: |center tendency| < 0.4 mm/hr per minute and |expansion| < 0.05 per minute.
 * Uniform intensification: center tendency > 1 mm/hr per minute, and the Phase 2 motion tolerance still holds.
 * Weakening: center tendency < -1 mm/hr per minute.
 * Expansion and contraction: relative wet-area change beyond 0.15 per minute, with the core
 * tendency staying under 1 mm/hr per minute when the peak itself does not change.
 * Initiation: initiation fraction > 0.005 and no solved vector faster than 8 m/s.
 * Disappearance: disappearance fraction > 0.005 and a negative center tendency.
 * Missing pixels: they do not raise disappearance above the intact translation case.
 * Noise of ±8%: |center tendency| < 1.5 mm/hr per minute, and the +60 minute addition stays under 4 mm/hr.
 * Bounded forecast: a tendency at the configured cap is still below the rate ceiling at +60,
 * and the gain from +10 to +60 is smaller than the gain from 0 to +10.
 */
import { CELL_EMPTY, CELL_MISSING, emptyField, paintGaussian, regionGeometry, scaleValues, shiftField } from '../lib/precipNowcast/field';
import { ensembleAtPoint, memberFactors, perturbVelocity, uncertaintyScore } from '../lib/precipNowcast/ensemble';
import { analyzeEvolution, applyEvolution, EVOLUTION, tendencyAtPixel } from '../lib/precipNowcast/evolution';
import { compareVelocity, estimateMotion, medianNear } from '../lib/precipNowcast/motion';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const DT = 120;

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
  if (!ok) failures += 1;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function geometry() {
  return regionGeometry(0, 0, 1, 96, 96);
}

function dry(at: string) {
  const field = emptyField(at, geometry(), { id: 'synthetic', product: 'evolution' });
  field.state.fill(CELL_EMPTY);
  return field;
}

function blob(at: string, cx: number, cy: number, sigma: number, peak: number) {
  const field = dry(at);
  paintGaussian(field, cx, cy, sigma, peak);
  return field;
}

function perMinute(fieldPair: readonly [ReturnType<typeof dry>, ReturnType<typeof dry>], x: number, y: number) {
  const motion = estimateMotion(fieldPair);
  const evolution = analyzeEvolution(fieldPair, motion);
  return { motion, evolution, tendency: tendencyAtPixel(evolution, x, y) * 60 };
}

{
  const first = blob(iso(T0), 48, 48, 8, 12);
  const second = shiftField(first, 3, 0);
  second.validAt = iso(T0 + DT * 1000);
  const { motion, evolution, tendency } = perMinute([first, second], 51, 48);
  const est = medianNear(motion, 51, 48, 18);
  const truth = { eastMs: (3 * first.geometry.metersPerPixelX) / DT, northMs: 0 };
  const speedOk = est != null && compareVelocity(est, truth).speedErrorMs <= Math.max(1.5, 0.3 * truth.eastMs);
  check('translation keeps motion', speedOk, est ? `${est.eastMs.toFixed(2)} vs ${truth.eastMs.toFixed(2)}` : 'none');
  check('translation evolution is neutral', Math.abs(tendency) < 0.4, `${tendency.toFixed(3)} mm/hr per min`);
  check('translation does not expand', Math.abs(evolution.expansionPerMin) < 0.05, `${evolution.expansionPerMin.toFixed(3)} /min`);
}

{
  const first = blob(iso(T0), 48, 48, 8, 12);
  const moved = shiftField(first, 3, 0);
  const second = scaleValues(moved, 1.8);
  second.validAt = iso(T0 + DT * 1000);
  const { motion, tendency } = perMinute([first, second], 51, 48);
  const est = medianNear(motion, 51, 48, 18);
  const truthEast = (3 * first.geometry.metersPerPixelX) / DT;
  const speedOk = est != null && Math.abs(est.eastMs - truthEast) <= Math.max(1.5, 0.3 * truthEast);
  check('intensifying field keeps its motion', speedOk, est ? est.eastMs.toFixed(2) : 'none');
  check(
    'uniform intensification is positive',
    tendency > 1 && tendency <= EVOLUTION.maxTendencyMmHrPerMin + 1e-4,
    `${tendency.toFixed(2)} mm/hr per min`,
  );
}

{
  const first = blob(iso(T0), 48, 48, 8, 12);
  const moved = shiftField(first, 3, 0);
  const second = scaleValues(moved, 0.5);
  second.validAt = iso(T0 + DT * 1000);
  const { tendency } = perMinute([first, second], 51, 48);
  check('weakening is negative', tendency < -1, `${tendency.toFixed(2)} mm/hr per min`);
}

{
  const first = blob(iso(T0), 40, 48, 6, 12);
  const second = blob(iso(T0 + DT * 1000), 43, 48, 10, 12);
  const { evolution, tendency } = perMinute([first, second], 43, 48);
  check('expansion is separate from translation', evolution.expansionPerMin > 0.15, `${evolution.expansionPerMin.toFixed(3)} /min`);
  check('a wider footprint is not core intensification', Math.abs(tendency) < 1, `${tendency.toFixed(2)} mm/hr per min`);
}

{
  const first = blob(iso(T0), 40, 48, 10, 12);
  const second = blob(iso(T0 + DT * 1000), 43, 48, 6, 12);
  const { evolution } = perMinute([first, second], 43, 48);
  check('contraction is detected', evolution.expansionPerMin < -0.15, `${evolution.expansionPerMin.toFixed(3)} /min`);
}

{
  const first = dry(iso(T0));
  const second = blob(iso(T0 + DT * 1000), 48, 48, 8, 12);
  const { motion, evolution } = perMinute([first, second], 48, 48);
  const fastest = motion.vectors
    .filter((vector) => vector.source === 'solved')
    .reduce((max, vector) => Math.max(max, Math.hypot(vector.eastMs, vector.northMs)), 0);
  check('new rain is an initiation residual', evolution.initiationFraction > 0.005, `${evolution.initiationFraction.toFixed(4)}`);
  check('initiation is not extreme motion', fastest < 8, `${fastest.toFixed(2)} m/s`);
}

{
  const first = blob(iso(T0), 48, 48, 8, 12);
  const second = dry(iso(T0 + DT * 1000));
  const { evolution, tendency } = perMinute([first, second], 48, 48);
  check('disappearance is detected', evolution.disappearanceFraction > 0.005, `${evolution.disappearanceFraction.toFixed(4)}`);
  check('disappearance tendency is negative', tendency < 0, `${tendency.toFixed(2)} mm/hr per min`);
}

{
  const first = blob(iso(T0), 48, 48, 8, 12);
  const intact = shiftField(first, 3, 0);
  intact.validAt = iso(T0 + DT * 1000);
  const holed = shiftField(first, 3, 0);
  holed.validAt = intact.validAt;
  for (let y = 10; y < 25; y += 1) {
    for (let x = 10; x < 25; x += 1) {
      const index = y * holed.geometry.width + x;
      holed.state[index] = CELL_MISSING;
      holed.rainRateMmHr[index] = Number.NaN;
    }
  }
  const plain = perMinute([first, intact], 51, 48);
  const gapped = perMinute([first, holed], 51, 48);
  check(
    'missing pixels are not decay',
    gapped.evolution.disappearanceFraction <= plain.evolution.disappearanceFraction + 0.002,
    `gapped ${gapped.evolution.disappearanceFraction.toFixed(4)} intact ${plain.evolution.disappearanceFraction.toFixed(4)}`,
  );
}

{
  const first = blob(iso(T0), 48, 48, 8, 12);
  const second = shiftField(first, 3, 0);
  second.validAt = iso(T0 + DT * 1000);
  let seed = 7;
  for (let i = 0; i < second.state.length; i += 1) {
    if (second.state[i] !== 2) continue;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const factor = 0.92 + (seed % 17) / 100;
    second.rainRateMmHr[i] *= factor;
  }
  const { tendency } = perMinute([first, second], 51, 48);
  const added = Math.abs(applyEvolution(12, tendency / 60, 60 * 60) - 12);
  check('noise does not become a strong tendency', Math.abs(tendency) < 1.5, `${tendency.toFixed(2)} mm/hr per min`);
  check('noise does not forecast a large +60 change', added < 4, `${added.toFixed(2)} mm/hr`);
}

{
  const cap = EVOLUTION.maxTendencyMmHrPerMin / 60;
  const early = applyEvolution(2, cap, 10 * 60);
  const late = applyEvolution(2, cap, 60 * 60);
  check('capped growth stays under the rate ceiling', late < EVOLUTION.maxRateMmHr, `${late.toFixed(2)} mm/hr`);
  check('later growth is smaller than the first ten minutes', late - early < early - 2, `+10 ${early.toFixed(2)} +60 ${late.toFixed(2)}`);
}

{
  const factors = memberFactors(0.8, 24);
  const samples = factors.map((factor) => perturbVelocity(10, 0, factor));
  const northSpread = samples.reduce((sum, sample) => sum + sample.northMs ** 2, 0) / samples.length;
  check('motion spread is not only along the vector', northSpread > 1, `north variance ${northSpread.toFixed(2)}`);
  const calm = memberFactors(0.15, 24).map((factor) => perturbVelocity(10, 0, factor));
  const calmSpread = calm.reduce((sum, sample) => sum + sample.northMs ** 2, 0) / calm.length;
  check('a confident field has a narrower cross-track spread', calmSpread < northSpread, `${calmSpread.toFixed(2)} vs ${northSpread.toFixed(2)}`);
}

{
  const first = blob(iso(T0), 40, 48, 8, 12);
  const second = shiftField(first, 3, 0);
  second.validAt = iso(T0 + DT * 1000);
  const motion = estimateMotion([first, second]);
  const evolution = analyzeEvolution([first, second], motion);
  const low = uncertaintyScore(motion, evolution, { requested: 2, usable: 2, failed: 0 });
  const gappy = uncertaintyScore(motion, { ...evolution, volatility: 2.5 }, { requested: 8, usable: 3, failed: 5 });
  check('gaps and volatile evolution widen uncertainty', gappy > low + 0.15, `low ${low.toFixed(2)} gappy ${gappy.toFixed(2)}`);
  const point = {
    latitude: -0.005,
    longitude: 44 / 96 - 0.5,
    issuedAtMs: T0 + DT * 1000,
    chunkSec: 120,
    field: second,
    motion,
    evolution,
  };
  const narrow = ensembleAtPoint({ ...point, uncertainty: 0.15 });
  const wide = ensembleAtPoint({ ...point, uncertainty: 0.95 });
  const narrowSpread = narrow.leads[0].spreadMmHr ?? 0;
  const wideSpread = wide.leads[0].spreadMmHr ?? 0;
  check(
    'ensemble spread follows the uncertainty',
    wideSpread > narrowSpread + 0.3 && wideSpread > 0.5,
    `+10 narrow ${narrowSpread.toFixed(3)} wide ${wideSpread.toFixed(3)}`,
  );
  check('members agree on one analysis', narrow.memberCount === 24 && wide.elapsedMs < 2000, `${narrow.memberCount} members in ${wide.elapsedMs} ms`);
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log('synthetic evolution ok');
