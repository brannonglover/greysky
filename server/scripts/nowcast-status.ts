/**
 * Archive composition and production-gate progress.
 * Offline. A null verifying lead is missing, not dry.
 */
import { listBundleDirs, readCase } from '../lib/precipNowcast/caseFile';
import { PRODUCTION_GATES } from '../lib/precipNowcast/gates';
import { POINT } from '../lib/precipNowcast/point';
import { RAIN_THRESHOLD_MM_HR } from '../lib/precipNowcast/thresholds';
import { pointsFromBundle, representativeExamples, verificationState, verifyArchive } from '../lib/precipNowcast/verify';

function num(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function main() {
  const bundles = listBundleDirs().map((dir) => readCase(dir));
  const states = { pending: 0, partial: 0, verified: 0 };
  for (const bundle of bundles) states[verificationState(bundle)] += 1;
  const report = verifyArchive(bundles);
  const points = bundles.flatMap(pointsFromBundle);
  const hours = new Map<string, { wet: boolean; onset: boolean; ending: boolean; dry: boolean; pending: boolean; regime: string }>();
  for (const point of points) {
    const row = hours.get(point.eventId) ?? { wet: false, onset: false, ending: false, dry: true, pending: false, regime: point.regime ?? 'unlabeled' };
    const rates = [point.analysisMmHr, ...point.leads.map((lead) => lead.rainRateMmHr)].filter((rate): rate is number => rate != null);
    if (!point.leadsComplete || point.analysisMmHr == null) row.pending = true;
    if (rates.some((rate) => rate >= POINT.eventThresholdMmHr)) row.wet = true;
    if (typeof point.observedOnsetMin === 'number') row.onset = true;
    if (point.observedEndingMin != null) row.ending = true;
    if (rates.some((rate) => rate > RAIN_THRESHOLD_MM_HR)) row.dry = false;
    if (!rates.length) row.dry = false;
    hours.set(point.eventId, row);
  }
  const hourRows = [...hours.values()];
  const regimes = new Map<string, number>();
  for (const point of points) regimes.set(point.regime ?? 'unlabeled', (regimes.get(point.regime ?? 'unlabeled') ?? 0) + 1);
  const verifiedShare = bundles.length ? states.verified / bundles.length : 0;
  const dryHours = hourRows.filter((row) => row.dry && !row.wet).length;
  const wetHours = hourRows.filter((row) => row.wet).length;

  console.log(`cases ${bundles.length}  verified ${states.verified}  partial ${states.partial}  pending ${states.pending}`);
  console.log(`point-leads ${report.pointLeads}  region-hours ${report.events}  region-days ${report.regionDays}`);
  console.log(`wet region-hours ${wetHours}  independent wet storms ${report.wetRegionDays}  (hours of one region-day are one storm)`);
  console.log(`onset events ${report.onset.events}  ending events ${report.ending.events}  dry region-hours ${dryHours}`);
  console.log(`archive mix  wet-hours ${wetHours}  dry-hours ${dryHours}  verified-share ${num(verifiedShare)}`);
  console.log('intended labels ' + [...regimes.entries()].map(([name, count]) => `${name}=${count}`).join(' '));
  console.log('\ngates');
  for (const gate of report.gates) console.log(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id}: ${gate.have} / ${gate.need}`);
  const open = report.gates.filter((gate) => !gate.pass).length;
  const coverage = report.gates.find((gate) => gate.id === 'wet-coverage');
  console.log(open ? `\n${open} of ${report.gates.length} gates still open. Wet p10–p90 coverage is ${coverage?.have ?? 'none'} and is not being adjusted.` : '\nall gates populated');
  console.log(`frozen targets: wet-hours ${PRODUCTION_GATES.independentWetEvents}, onsets ${PRODUCTION_GATES.independentOnsetEvents}, endings ${PRODUCTION_GATES.independentEndingEvents}, wet p10-p90 ${PRODUCTION_GATES.wetP10P90Coverage}`);
  console.log('\nexamples');
  for (const example of representativeExamples(points)) {
    if ('missing' in example && example.missing) {
      console.log(`  ${example.kind}: none yet`);
      continue;
    }
    console.log(`  ${example.kind}: ${example.id} ${example.at} “${example.phrase}” ${example.verdict}`);
  }
}

main();
