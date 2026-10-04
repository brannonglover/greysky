/**
 * Point-product rules that do not need radar.
 * Onset needs two native steps. A one-step dry gap is not an ending.
 * A missing rate is not dry. The event uses member probability, not the mean.
 */
import {
  POINT,
  POINT_THRESHOLDS,
  assemblePoint,
  endingMinute,
  eventDistributions,
  neighborhoodKernel,
  onsetMinute,
  rateMeets,
  regionKey,
  type CachedRegion,
  type MemberSeries,
} from '../lib/precipNowcast/point';

function check(name: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

const kernel = neighborhoodKernel(33.85, -84.29, 5);
const center = kernel[0];
const rim = kernel[kernel.length - 1];
check('kernel has a center and a rim', kernel.length === 17 && center.distanceKm === 0 && rim.distanceKm > 4);
check('closer rain weighs more', center.weight > rim.weight);
check(
  'weights sum to one',
  Math.abs(kernel.reduce((sum, sample) => sum + sample.weight, 0) - 1) < 1e-9,
);
check('exact cell is one sample', neighborhoodKernel(33.85, -84.29, 0).length === 1);

const step = POINT.nativeStepMin;
const spike = [0, 5, 0, 0, 5, 5, 5];
check('a one-step spike is not onset', onsetMinute(spike, step, 0.6, 4) === 8);
check('trace uses greater-than', rateMeets(0.02, 0.02) === false && rateMeets(0.021, 0.02));
check('light uses the band floor', rateMeets(0.6, 0.6) && !rateMeets(0.59, 0.6));

const wetThenGap = [5, 5, 5, 5, 0, 5, 5, 0, 0, 0, 0];
check('already raining when the first two steps stay wet', onsetMinute(wetThenGap, step, 0.6, 4) === 'now');
check('one dry step does not end the rain', endingMinute(wetThenGap, step, 0.6, 8, 'now') === 14);
check('a missing stretch is not an ending', endingMinute([5, 5, null, null, null, null], step, 0.6, 8, 'now') === null);

const threeDry = [5, 5, 0, 0, 0];
check('six dry minutes can end', endingMinute(threeDry, step, 0.6, 6, 'now') === 4);
check('eight dry minutes cannot end that spell', endingMinute(threeDry, step, 0.6, 8, 'now') === null);
check('ten dry minutes cannot end that spell', endingMinute(threeDry, step, 0.6, 10, 'now') === null);

const heavy: MemberSeries[] = Array.from({ length: 16 }, () => ({ rates: [3, 3, 3] }));
const dry: MemberSeries[] = Array.from({ length: 8 }, () => ({ rates: [0, 0, 0] }));
const mixed = [...heavy, ...dry];
const mean = mixed.reduce((sum, member) => sum + (member.rates[0] ?? 0), 0) / mixed.length;
const events = eventDistributions(mixed, 2.5, 8);
check('mean stays under moderate while most members are wet', mean < 2.5 && (events.onset.alreadyRainingProbability ?? 0) > 0.6);

const snapped = regionKey(33.8513, -84.287, '2026-10-04T12:46:40.000Z');
const nearby = regionKey(33.9526, -84.5499, '2026-10-04T12:46:40.000Z');
const downtown = regionKey(33.749, -84.388, '2026-10-04T12:46:40.000Z');
check('metro points share a region key', snapped.key === nearby.key && snapped.key === downtown.key);

const region = {
  key: snapped.key,
  centerLatitude: snapped.centerLatitude,
  centerLongitude: snapped.centerLongitude,
  observationTime: '2026-10-04T12:46:40.000Z',
  members: { uncertainty: 0.67 },
  motionMs: 1,
  evolutionMs: 1,
  buildMs: 1,
  estimatedBytes: 10,
} as CachedRegion;
const product = assemblePoint({
  region,
  latitude: 33.85,
  longitude: -84.29,
  radiusKm: 2,
  eventThresholdMmHr: POINT.eventThresholdMmHr,
  endingDryMin: POINT.endingDryMin,
  series: mixed.map((member) => ({ rates: Array.from({ length: 31 }, () => member.rates[0]) })),
  sampleMs: 4,
  cache: 'hit',
});
check('confidence is not the rain probability', product.confidence === 0.33 && product.minutes[0].probability.moderate !== product.confidence);
check('odd minutes are interpolated and rounded', product.minutes[1].interpolated && product.minutes[1].probability.moderate === 0.67);
check('native probability keeps the member fraction', Math.abs((product.minutes[0].probability.moderate ?? 0) - 16 / 24) < 1e-9);
check(
  'thresholds stay the Grey Sky bands',
  POINT_THRESHOLDS.map((item) => item.mmHr).join(',') === '0.02,0.6,2.5,7.5',
);

if (process.exitCode) process.exit(process.exitCode);
console.log('point tests passed');
