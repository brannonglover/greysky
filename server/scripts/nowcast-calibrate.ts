/**
 * Calibration over stored cases. Small bins are marked unreadable.
 */
import { listBundleDirs, readBundle } from '../lib/precipNowcast/caseFile';
import { calibrate, type CalLead } from '../lib/precipNowcast/calibration';
import { SCORE_LEADS_MIN } from '../lib/precipNowcast/thresholds';

function num(value: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

const rows: CalLead[] = [];
for (const dir of listBundleDirs()) {
  const { bundle } = readBundle(dir);
  for (const point of bundle.points) {
    for (const leadMinutes of SCORE_LEADS_MIN) {
      const minute = point.forecast.minutes.find((row) => row.minute === leadMinutes);
      const observed = point.verification?.leads.find((row) => row.leadMinutes === leadMinutes);
      if (!minute || !observed) continue;
      const step = leadMinutes / 2;
      rows.push({
        leadMinutes,
        observedMmHr: observed.rainRateMmHr,
        expectedMmHr: minute.expectedRainRateMmHr,
        p10: minute.p10MmHr,
        p25: minute.p25MmHr,
        p75: minute.p75MmHr,
        p90: minute.p90MmHr,
        probability: minute.probability,
        members: point.memberRates[step] ?? null,
        regime: point.intendedRegime,
      });
    }
  }
}

const report = calibrate(rows);
console.log(`samples ${report.sampleCount} tooSmall ${report.tooSmall}`);
for (const lead of report.byLead) {
  console.log(
    `+${lead.leadMinutes} n=${lead.count} p10-p90 ${lead.p10p90}/${lead.count} p25-p75 ${lead.p25p75}/${lead.count} mae ${num(lead.mae)} spread ${num(lead.meanSpread)} crps ${num(lead.meanCrps)} lightBrier ${num(lead.brier.light.score, 3)} nLight ${lead.brier.light.count}`,
  );
}
const readable = report.reliability.filter((bin) => bin.readable);
console.log(`reliability bins with n>=8: ${readable.length} of ${report.reliability.length}`);
for (const bin of report.reliability.filter((item) => item.threshold === 'light' || item.threshold === 'trace')) {
  console.log(`  ${bin.threshold} ${bin.bin} n=${bin.count} p=${num(bin.meanProbability)} obs=${num(bin.observedFrequency)} readable=${bin.readable}`);
}
