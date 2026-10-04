/**
 * Collector rules, shadow states, and production gates.
 * The gates are the precommitted numbers. A zero sample fails them.
 */
import { classifyRegion } from '../lib/precipNowcast/collect';
import { decide, type ShadowDecision } from '../lib/precipNowcast/decision';
import { gradeProduction } from '../lib/precipNowcast/gates';
import type { PointNowcast } from '../lib/precipNowcast/point';
import { eventId } from '../lib/precipNowcast/verify';

function check(name: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

const now = Date.parse('2026-10-04T18:00:00.000Z');
const base = { previous: null, lastArchiveMs: null, lastDryMs: null, nowMs: now };

check('a wet point beside a dry point is a boundary', classifyRegion({ ...base, rates: [8, 0] }).reason === 'boundary');
check('trace without a wet neighbor is still kept', classifyRegion({ ...base, rates: [0.2] }).reason === 'wet');
check(
  'a dry-to-wet change is an onset even just after an archive',
  classifyRegion({ ...base, rates: [2], previous: [0], lastArchiveMs: now - 5 * 60_000 }).reason === 'onset',
);
check(
  'the same wet region is not copied inside 20 minutes',
  classifyRegion({ ...base, rates: [2], previous: [2], lastArchiveMs: now - 5 * 60_000 }).reason === 'redundant',
);
check(
  'a dry region waits 6 hours',
  classifyRegion({ ...base, rates: [0, 0], lastDryMs: now - 60 * 60_000 }).reason === 'dry-recent',
);
check('a failed scout is not stored as dry', classifyRegion({ ...base, rates: [null, null] }).reason === 'missing');

function forecast(onset: Partial<PointNowcast['onset']>, ending?: Partial<PointNowcast['ending']>, confidence = 0.8): PointNowcast {
  const within = { '10': 0, '20': 0, '30': 0, '45': 0, '60': 0 } as PointNowcast['onset']['withinMinutes'];
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-04T12:00:00.000Z',
    observationTime: '2026-10-04T12:00:00.000Z',
    predictorVersion: 'regional-ensemble-1',
    latitude: 0,
    longitude: 0,
    confidence,
    eventThresholdMmHr: 0.6,
    neighborhood: { radiusKm: 2, kernel: 'gaussian', sigmaKm: 1 },
    nativeStepMin: 2,
    minutes: [],
    onset: {
      thresholdMmHr: 0.6,
      persistenceMin: 4,
      probability: 0,
      alreadyRainingProbability: 0,
      p10Minutes: null,
      p50Minutes: null,
      p90Minutes: null,
      withinMinutes: within,
      ...onset,
    },
    ending: {
      thresholdMmHr: 0.6,
      dryPersistenceMin: 8,
      supported: false,
      probability: null,
      p10Minutes: null,
      p50Minutes: null,
      p90Minutes: null,
      withinMinutes: { '10': null, '20': null, '30': null, '45': null, '60': null },
      ...ending,
    },
    thresholds: {} as PointNowcast['thresholds'],
    diagnostics: {},
  };
}

function state(decision: ShadowDecision): string {
  return decision.selectedState;
}

check('no meaningful-rain probability stays dry', state(decide(forecast({ withinMinutes: { '10': 0, '20': 0, '30': 0, '45': 0, '60': 0 } }))) === 'DRY');
check(
  'a likely event with a wide onset is not given a minute',
  state(decide(forecast({ withinMinutes: { '10': 0.8, '20': 0.8, '30': 0.8, '45': 0.8, '60': 0.8 }, p10Minutes: 5, p50Minutes: 20, p90Minutes: 50 }))) === 'TIMING_UNCERTAIN',
);
check(
  'a likely event with a narrow soon onset can name a time',
  state(decide(forecast({ withinMinutes: { '10': 0.8, '20': 0.9, '30': 0.9, '45': 0.9, '60': 0.9 }, p10Minutes: 12, p50Minutes: 15, p90Minutes: 20 }))) === 'RAIN_IMMINENT',
);
check(
  'low confidence blocks a specific minute',
  state(decide(forecast({ withinMinutes: { '10': 0.8, '20': 0.9, '30': 0.9, '45': 0.9, '60': 0.9 }, p10Minutes: 12, p50Minutes: 15, p90Minutes: 20 }, undefined, 0.2))) === 'TIMING_UNCERTAIN',
);
check(
  'rain already there stays a raining state when ending is unsupported',
  state(decide(forecast({ alreadyRainingProbability: 0.9, withinMinutes: { '10': 1, '20': 1, '30': 1, '45': 1, '60': 1 } }))) === 'RAINING',
);

check('one region-hour is one event', eventId('34.00,-84.50|2026-10-04T12:46:40.000Z|regional-ensemble-1', '2026-10-04T12:46:40.000Z') === eventId('34.00,-84.50|2026-10-04T12:50:00.000Z|regional-ensemble-1', '2026-10-04T12:50:00.000Z'));
check('the next hour is another event', eventId('34.00,-84.50|2026-10-04T12:46:40.000Z|regional-ensemble-1', '2026-10-04T12:46:40.000Z') !== eventId('34.00,-84.50|2026-10-04T14:00:42.000Z|regional-ensemble-1', '2026-10-04T14:00:42.000Z'));

const grades = gradeProduction({
  wetEvents: 0,
  onsetEvents: 0,
  endingEvents: 0,
  readableLightBins: 0,
  wetCoverage: null,
  likelyFalseAlarmRate: null,
  likelyForecasts: 0,
  likelyEvents: 0,
  onsetMaeMin: null,
  onsetTimedEvents: 0,
});
check('an empty archive fails every production gate', grades.every((gate) => !gate.pass));

if (process.exitCode) process.exit(process.exitCode);
console.log('verify tests passed');
