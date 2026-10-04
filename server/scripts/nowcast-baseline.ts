/**
 * Hindcast the current predictors and print the scoreboard.
 * Writes schema-1 JSONL under server/.nowcast-out. Not a production store.
 *
 *   npm run nowcast:baseline
 */
import { join } from 'node:path';

import { runBaseline, writeBaselineFiles } from '../lib/precipNowcast/baseline';
import { formatScorecards } from '../lib/precipNowcast/score';

async function main(): Promise<void> {
  const run = await runBaseline();
  const dir = join(__dirname, '..', '.nowcast-out');
  writeBaselineFiles(dir, run);
  const observed = run.observations.filter((row) => row.leadMinutes === 0);
  console.log(`issue ${run.issuedAt}`);
  console.log('analysis MRMS mm/hr (null = sample failed)');
  for (const row of observed) {
    console.log(`  ${row.caseId.padEnd(16)} ${row.rainRateMmHr == null ? 'missing' : row.rainRateMmHr.toFixed(2)}`);
  }
  console.log('');
  console.log(formatScorecards(run.scorecards));
  console.log(`wrote ${dir}`);
  console.log('One issue time and six points. This is a baseline, not a skill claim.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
