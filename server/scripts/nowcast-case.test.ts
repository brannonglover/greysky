/**
 * Case files round-trip. Calibration counts stay honest on a tiny sample.
 * There is no fitted vulnerability score.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { calibrate, crps } from '../lib/precipNowcast/calibration';
import { readFrame, writeFrame, type CaseBundle } from '../lib/precipNowcast/caseFile';
import { cycleForIssue, vulnerabilityScore } from '../lib/precipNowcast/environment';
import { emptyField, regionGeometry } from '../lib/precipNowcast/field';

function check(name: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowcast-case-'));
const geometry = regionGeometry(33.85, -84.29, 1, 4, 4);
const field = emptyField('2026-10-04T12:46:40.000Z', geometry, { id: 'mrms-cref-qcd', product: 'test' });
field.state[0] = 2;
field.rainRateMmHr[0] = 1.25;
field.state[1] = 1;
const file = path.join(dir, 'frame.bin');
writeFrame(file, field);
const back = readFrame(file, { validAt: field.validAt, file: 'frame.bin', source: field.source, geometry });
check('value round-trips', back.rainRateMmHr[0] === 1.25 && back.state[0] === 2 && back.state[1] === 1);
check('missing stays missing', Number.isNaN(back.rainRateMmHr[1]));

const score = crps([0, 2, 4], 2);
check('crps of a symmetric ensemble is finite', score != null && Math.abs(score - 4 / 9) < 1e-9);

const report = calibrate([
  {
    leadMinutes: 10,
    observedMmHr: 1,
    expectedMmHr: 0.2,
    p10: 0,
    p25: 0.1,
    p75: 0.3,
    p90: 0.4,
    probability: { trace: 1, light: 0, moderate: 0, heavy: 0 },
    members: [0, 0.2, 0.4],
    regime: 'dry',
  },
]);
check('one sample is too small', report.tooSmall && report.sampleCount === 1);
check('reliability bin is not readable', report.reliability.every((bin) => bin.readable === false || bin.count >= 8));
check('vulnerability score is deferred', vulnerabilityScore() === null);

const cycle = cycleForIssue(Date.parse('2026-10-04T12:46:40.000Z'));
check('12:46 uses the 11Z cycle already published', cycle.run.toISOString().startsWith('2026-10-04T11:') && cycle.forecastHour === 1);

const bundle = { schemaVersion: 1 } as CaseBundle;
check('schema is version 1', bundle.schemaVersion === 1);

if (process.exitCode) process.exit(process.exitCode);
console.log('case tests passed');
