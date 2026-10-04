/**
 * Phase 1 scoreboard tests. No network. The live hindcast is nowcast-baseline.ts.
 */
import { DRY_MM_HR } from '../../lib/precip';
import { colorForDbz } from '../lib/palette';
import { advectedSourcePoint, paintedSource, sampleAdvectedDbz } from '../lib/precipNowcast/advectionSample';
import { seriesEvents } from '../lib/precipNowcast/events';
import { predictionFromRates } from '../lib/precipNowcast/predict';
import { parseRecordLine, serializeRecord, type ObservationRecord, type PredictionRecord } from '../lib/precipNowcast/records';
import { scoreRecords } from '../lib/precipNowcast/score';
import { RAIN_THRESHOLD_MM_HR, SCORE_LEADS_MIN } from '../lib/precipNowcast/thresholds';

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
  if (!ok) failures += 1;
}

const ISSUED = '2026-10-04T12:00:00.000Z';
const LEADS = SCORE_LEADS_MIN;

function validAt(lead: number): string {
  return new Date(Date.parse(ISSUED) + lead * 60_000).toISOString();
}

function observe(caseId: string, leadMinutes: number, rate: number | null): ObservationRecord {
  return {
    schemaVersion: 1,
    recordType: 'observation',
    source: 'mrms-cref-qcd',
    caseId,
    issuedAt: ISSUED,
    leadMinutes,
    validAt: leadMinutes === 0 ? ISSUED : validAt(leadMinutes),
    latitude: 0,
    longitude: 0,
    dbz: null,
    rainRateMmHr: rate,
  };
}

function predict(caseId: string, analysis: number | null, rates: Array<number | null>, probability?: Array<number | null>): PredictionRecord {
  return predictionFromRates({
    predictorId: 'persistence',
    issuedAt: ISSUED,
    latitude: 0,
    longitude: 0,
    caseId,
    intendedRegime: 'dry',
    analysisValidAt: ISSUED,
    analysisRateMmHr: analysis,
    leads: LEADS.map((leadMinutes, index) => ({
      leadMinutes,
      validAt: validAt(leadMinutes),
      rateMmHr: rates[index] ?? null,
      ...(probability ? { precipProbability: probability[index] ?? null } : {}),
    })),
    diagnostics: {},
  });
}

check('threshold matches lib/precip.ts', RAIN_THRESHOLD_MM_HR === DRY_MM_HR, `${RAIN_THRESHOLD_MM_HR} vs ${DRY_MM_HR}`);

const trace = seriesEvents(0.02, LEADS.map((leadMinutes) => ({ leadMinutes, rateMmHr: 0.02 })), RAIN_THRESHOLD_MM_HR);
check('0.02 mm/hr is not rain', trace.onset.applicable && trace.onset.minutes == null, JSON.stringify(trace.onset));

const wetTrace = seriesEvents(0, [{ leadMinutes: 10, rateMmHr: 0.03 }, ...LEADS.slice(1).map((leadMinutes) => ({ leadMinutes, rateMmHr: 0 }))], RAIN_THRESHOLD_MM_HR);
check('0.03 mm/hr is rain', wetTrace.onset.minutes === 10, JSON.stringify(wetTrace.onset));

const gap = seriesEvents(
  5,
  [
    { leadMinutes: 10, rateMmHr: 4 },
    { leadMinutes: 20, rateMmHr: 0 },
    { leadMinutes: 30, rateMmHr: 3 },
    { leadMinutes: 45, rateMmHr: 0 },
    { leadMinutes: 60, rateMmHr: 0 },
  ],
  RAIN_THRESHOLD_MM_HR,
);
check('a dry gap does not end the rain', gap.ending.minutes === 45, JSON.stringify(gap.ending));

const steadyEnd = seriesEvents(
  5,
  LEADS.map((leadMinutes) => ({ leadMinutes, rateMmHr: leadMinutes >= 20 ? 0 : 4 })),
  RAIN_THRESHOLD_MM_HR,
);
check('ending is the first lead that stays dry', steadyEnd.ending.minutes === 20, JSON.stringify(steadyEnd.ending));

const missing = seriesEvents(0, [{ leadMinutes: 10, rateMmHr: null }, ...LEADS.slice(1).map((leadMinutes) => ({ leadMinutes, rateMmHr: 0 }))], RAIN_THRESHOLD_MM_HR);
check('a missing lead is not dry', missing.onset.applicable === false, JSON.stringify(missing.onset));

const hit = predict('wet', 2, [2, 2, 2, 2, 2]);
const hitObs = [0, ...LEADS].map((lead) => observe('wet', lead, 2));
const hitCard = scoreRecords([hit], hitObs)[0];
check(
  'steady rain is five hits and Brier 0',
  hitCard.leads.every((lead) => lead.hits === 1 && lead.falseAlarms === 0 && lead.misses === 0 && lead.brierScore === 0),
  JSON.stringify(hitCard.leads[0]),
);

const miss = predict('cell', 0, [0, 0, 0, 0, 0]);
const missObs = [observe('cell', 0, 0), ...LEADS.map((lead) => observe('cell', lead, 3))];
const missCard = scoreRecords([miss], missObs)[0];
check(
  'dry forecast against rain is five misses',
  missCard.leads.every((lead) => lead.misses === 1 && lead.hits === 0),
  `misses ${missCard.leads.map((lead) => lead.misses).join(',')}`,
);
check(
  'missed onset is unmatched, not a fake minute',
  missCard.onset.unmatchedObserved === 1 && missCard.onset.matched === 0,
  JSON.stringify(missCard.onset),
);

const alarm = predict('false', 0, [2, 2, 2, 2, 2]);
const alarmObs = [0, ...LEADS].map((lead) => observe('false', lead, 0));
const alarmCard = scoreRecords([alarm], alarmObs)[0];
check(
  'rain forecast against dry is five false alarms',
  alarmCard.leads.every((lead) => lead.falseAlarms === 1 && lead.correctRejections === 0),
  `FA ${alarmCard.leads.map((lead) => lead.falseAlarms).join(',')}`,
);

const hole = predict('hole', 1, [1, null, 1, 1, 1]);
const holeObs = [0, ...LEADS].map((lead) => observe('hole', lead, 1));
const holeCard = scoreRecords([hole], holeObs)[0];
const hole20 = holeCard.leads.find((lead) => lead.leadMinutes === 20);
check(
  'null rate is unscored, not a miss',
  hole20?.sampleCount === 1 && hole20.scoredCount === 0 && hole20.misses === 0,
  JSON.stringify(hole20),
);

const soft = predict('p', 0, [0, 0, 0, 0, 0], [0.25, 0.25, 0.25, 0.25, 0.25]);
const softObs = [observe('p', 0, 0), observe('p', 10, 0), ...LEADS.slice(1).map((lead) => observe('p', lead, 4))];
const softCard = scoreRecords([soft], softObs)[0];
const brier10 = softCard.leads.find((lead) => lead.leadMinutes === 10)?.brierScore ?? -1;
const brier20 = softCard.leads.find((lead) => lead.leadMinutes === 20)?.brierScore ?? -1;
check('Brier uses the stored probability', Math.abs(brier10 - 0.0625) < 1e-9 && Math.abs(brier20 - 0.5625) < 1e-9, `${brier10} ${brier20}`);

const early = predict('time', 0, [0, 4, 4, 4, 4]);
const earlyObs = [
  observe('time', 0, 0),
  observe('time', 10, 0),
  observe('time', 20, 0),
  observe('time', 30, 4),
  observe('time', 45, 4),
  observe('time', 60, 4),
];
const earlyCard = scoreRecords([early], earlyObs)[0];
check('onset error is the lead difference', earlyCard.onset.matched === 1 && earlyCard.onset.maeMinutes === 10, JSON.stringify(earlyCard.onset));

const endedPred = predict('end', 4, [4, 0, 0, 0, 0]);
const endedObs = [observe('end', 0, 4), ...LEADS.map((lead) => observe('end', lead, lead >= 30 ? 0 : 4))];
const endedCard = scoreRecords([endedPred], endedObs)[0];
check('ending error is the lead difference', endedCard.ending.matched === 1 && endedCard.ending.maeMinutes === 10, JSON.stringify(endedCard.ending));

const zero = predict('zero', 0, [0, 0, 0, 0, 0]);
check('a stored zero is dry, not missing', zero.leads[0].expectedRainRateMmHr === 0 && zero.leads[0].precipProbability === 0, JSON.stringify(zero.leads[0]));

const parsed = parseRecordLine(serializeRecord(zero));
check('schema 1 round-trips', parsed.recordType === 'prediction' && parsed.schemaVersion === 1, parsed.recordType);

let rejected = false;
try {
  parseRecordLine(JSON.stringify({ schemaVersion: 2, recordType: 'prediction' }));
} catch {
  rejected = true;
}
check('schema 2 is rejected', rejected, String(rejected));

const shifted = advectedSourcePoint(100_000, 50_000, 1_000, -250, 10);
check(
  'advection looks upstream of the motion',
  shifted.mx === 90_000 && shifted.my === 52_500,
  `${shifted.mx}, ${shifted.my}`,
);

const color = colorForDbz(45);
if (!color) {
  check('uniform echo samples back as 45 dBZ', false, 'palette has no 45 dBZ color');
} else {
  const field = paintedSource(33.85, -84.29, [color[0], color[1], color[2], color[3]]);
  const sampled = sampleAdvectedDbz(field, 33.85, -84.29, 0, 0, 0);
  check('uniform echo samples back as 45 dBZ', sampled != null && Math.abs(sampled - 45) < 0.01, String(sampled));
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log('nowcast scoreboard ok');
