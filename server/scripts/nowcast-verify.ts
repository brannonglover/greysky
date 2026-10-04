/**
 * Verification report for the frozen point nowcast. Prints the archive and
 * writes verify-report.json beside the cases. It does not change a forecast.
 */
import fs from 'node:fs';
import path from 'node:path';

import { casesRoot, listBundleDirs, readCase } from '../lib/precipNowcast/caseFile';
import { exampleFor, pointsFromBundle, REVIEW_EXAMPLES, verifyArchive } from '../lib/precipNowcast/verify';

function num(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function main() {
  const bundles = listBundleDirs().map((dir) => readCase(dir));
  const report = verifyArchive(bundles);
  const points = bundles.flatMap(pointsFromBundle);
  report.examples = REVIEW_EXAMPLES.map((item) => {
    const point = points.find((row) => row.id === item.id && row.observationTime.startsWith(item.hour));
    return point ? exampleFor(point, item.label) : { label: item.label, missing: true };
  });
  console.log(`point-leads ${report.pointLeads}  region-hours ${report.events}  region-days ${report.regionDays}  wet-region-days ${report.wetRegionDays}`);
  console.log('\nleads');
  for (const lead of report.byLead) {
    console.log(
      `  +${lead.leadMinutes} n=${lead.count} events=${lead.events} MAE=${num(lead.mae)} med=${num(lead.medianAbs)} bias=${num(lead.bias)} CRPS=${num(lead.crps)} p10-90=${num(lead.p10p90)} p25-75=${num(lead.p25p75)} wet=${lead.wetCount} wetCover=${num(lead.wetP10p90)} spread=${num(lead.meanSpread)}`,
    );
  }
  console.log('\nthresholds');
  for (const threshold of report.thresholds) {
    const brier = threshold.brier as { score: number | null; reliability: number | null; resolution: number | null; count: number; events?: number };
    const counts = threshold.counts as { hitRate: number | null; missRate: number | null; falseAlarmRate: number | null; correctRejectionRate: number | null; hits: number; misses: number; falseAlarms: number; correctRejections: number };
    console.log(
      `  ${threshold.id} Brier=${num(brier.score)} rel=${num(brier.reliability)} res=${num(brier.resolution)} n=${brier.count} events=${brier.events ?? '—'} hit=${num(counts.hitRate)} miss=${num(counts.missRate)} FA=${num(counts.falseAlarmRate)} CR=${num(counts.correctRejectionRate)} (${counts.hits}/${counts.misses}/${counts.falseAlarms}/${counts.correctRejections})`,
    );
    const bins = threshold.reliability as Array<{ bin: string; count: number; events: number; meanProbability: number | null; observedFrequency: number | null; readable: boolean }>;
    for (const bin of bins) {
      if (!bin.count) continue;
      console.log(`    ${bin.bin} n=${bin.count} events=${bin.events} p=${num(bin.meanProbability)} obs=${num(bin.observedFrequency)} ${bin.readable ? 'readable' : 'suppressed'}`);
    }
  }
  console.log(
    `\nspread on wet leads: low-half error ${num(report.spread.wetLowError)} (n=${report.spread.wetLowCount}) high-half error ${num(report.spread.wetHighError)} (n=${report.spread.wetHighCount}) ranks=${report.spread.ranksError}`,
  );
  console.log('onset', report.onset);
  console.log('ending', report.ending);
  console.log('\nexperimental cutoffs (not selected)');
  for (const cutoff of report.cutoffs) console.log(`  ${cutoff.cutoff} precision=${num(cutoff.precision)} recall=${num(cutoff.recall)} falseShare=${num(cutoff.falseAlarmShare)} n=${cutoff.forecasts} events=${cutoff.events} enough=${cutoff.enough}`);
  console.log('\ngates');
  for (const gate of report.gates) console.log(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id}: need ${gate.need}; have ${gate.have}`);
  console.log('\nexamples');
  for (const example of report.examples) {
    if ('missing' in example) {
      console.log(`  ${example.label}: not in the archive`);
      continue;
    }
    console.log(`  ${example.label}: ${example.phrase} [${example.state}] ${example.verdict}`);
    console.log(`    analysis ${num(example.analysis, 1)} leads ${example.leads} onset ${example.observedOnsetMin} ending ${example.observedEndingMin} conf ${num(example.confidence)} P60 ${num(example.meaningful)} width ${num(example.onsetWidth, 0)}`);
  }
  const file = path.join(casesRoot(), 'verify-report.json');
  fs.writeFileSync(file, JSON.stringify(report));
  console.log(`\nwrote ${file}`);
}

main();
