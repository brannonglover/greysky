/**
 * Hindcast the scoreboard and print it.
 * Writes schema-1 JSONL under server/.nowcast-out. Not a production store.
 *
 *   npm run nowcast:baseline
 *   npm run nowcast:baseline -- --issue 2026-10-04T12:12:41.000Z
 *   npm run nowcast:baseline -- --expand
 *   npm run nowcast:baseline -- --append
 *
 * --expand scores the extra cities on their own and does not mix them into
 * the six-case table. --append adds a run to the existing JSONL.
 */
import { join } from 'node:path';

import { runBaseline, writeBaselineFiles, type BaselineRun } from '../lib/precipNowcast/baseline';
import { BENCHMARK_CASES, EXPANDED_CASES } from '../lib/precipNowcast/cases';
import { MEANINGFUL_MM_HR } from '../lib/precipNowcast/ensemble';
import type { PredictionRecord } from '../lib/precipNowcast/records';
import { formatScorecards, scoreRecords } from '../lib/precipNowcast/score';

const ATLANTA_ISSUE = '2026-10-04T12:12:41.000Z';

function flag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function printRun(label: string, run: BaselineRun): void {
  const observed = run.observations.filter((row) => row.leadMinutes === 0);
  console.log(`\n${label}`);
  console.log(`issue ${run.issuedAt}`);
  console.log('analysis MRMS mm/hr (null = sample failed)');
  for (const row of observed) {
    console.log(`  ${row.caseId.padEnd(16)} ${row.rainRateMmHr == null ? 'missing' : row.rainRateMmHr.toFixed(2)}`);
  }
  console.log('');
  console.log(formatScorecards(run.scorecards));
  const regional = run.predictions.filter((row) => row.predictorId === 'regional-motion');
  if (regional.length) {
    console.log('regional-motion timing');
    for (const row of regional) {
      const d = row.diagnostics;
      console.log(
        `  ${row.caseId.padEnd(16)} frames ${d.framesUsable ?? '?'}/${d.framesRequested ?? '?'}  ` +
          `dl ${d.downloadBytes ?? '?'} B / ${d.downloadMs ?? '?'} ms  build ${d.fieldBuildMs ?? '?'} ms  ` +
          `motion ${d.motionMs ?? '?'} ms  extrap ${d.extrapolateMs ?? '?'} ms  heap ${d.heapUsedBytes ?? '?'}  ` +
          `pairs ${d.pairsUsed ?? '?'}/${d.pairsRejected ?? '?'} rej  step ${d.leadStepMin ?? '?'} min  ` +
          `gap ${d.maxGapSec ?? '?'} s`,
      );
    }
  }
  const ensemble = run.predictions.filter((row) => row.predictorId === 'regional-ensemble');
  if (ensemble.length) {
    console.log('regional-ensemble timing');
    for (const row of ensemble) {
      const d = row.diagnostics;
      console.log(
        `  ${row.caseId.padEnd(16)} evolution ${d.evolutionMs ?? '?'} ms  members ${d.ensembleMs ?? '?'} ms  ` +
          `uncertainty ${d.uncertainty ?? '?'}  tendency ${d.pointTendencyMmHrPerMin ?? '?'} mm/hr/min  ` +
          `expansion ${d.expansionPerMin ?? '?'} /min  spread ${d.spread ?? '?'}  p10 ${d.p10 ?? '?'}  p90 ${d.p90 ?? '?'}`,
      );
    }
    printMeaningful(run, ensemble);
  }
}

function probabilitiesFrom(diagnostic: string | number | boolean | null | undefined): number[] {
  return String(diagnostic ?? '')
    .split(',')
    .map((part) => (part === '' ? Number.NaN : Number(part)));
}

function printMeaningful(run: BaselineRun, ensemble: readonly PredictionRecord[]): void {
  for (const [index, threshold] of MEANINGFUL_MM_HR.entries()) {
    const key = index === 0 ? 'lightProb' : 'moderateProb';
    const rewritten = run.predictions.map((prediction) => {
      if (prediction.predictorId !== 'regional-ensemble') {
        return {
          ...prediction,
          leads: prediction.leads.map((lead) => ({ ...lead, precipProbability: null })),
        };
      }
      const probs = probabilitiesFrom(ensemble.find((row) => row.caseId === prediction.caseId)?.diagnostics[key]);
      return {
        ...prediction,
        leads: prediction.leads.map((lead, leadIndex) => ({
          ...lead,
          precipProbability: Number.isFinite(probs[leadIndex]) ? probs[leadIndex] : null,
        })),
      };
    });
    console.log(`\nmeaningful rain, threshold ${threshold} mm/hr`);
    console.log('Hits use the expected rate. Brier is blank except for the ensemble, which stores that threshold.');
    console.log(formatScorecards(scoreRecords(rewritten, run.observations, threshold)));
  }
}

async function main(): Promise<void> {
  const issueArg = flag('--issue');
  const expand = process.argv.includes('--expand');
  const append = process.argv.includes('--append');
  const dir = join(__dirname, '..', '.nowcast-out');

  if (!issueArg && !expand) {
    const atlanta = BENCHMARK_CASES.find((entry) => entry.id === 'atlanta-30345');
    if (atlanta) {
      try {
        const replay = await runBaseline({
          cases: [atlanta],
          issuedAtMs: Date.parse(ATLANTA_ISSUE),
        });
        printRun('Atlanta 30345 replay', replay);
        writeBaselineFiles(join(dir, 'atlanta-replay'), replay);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`Atlanta 30345 replay skipped: ${message}`);
        console.log(`${ATLANTA_ISSUE} is not in the current MRMS window. Phase 1 numbers stand. Nothing was fabricated.`);
      }
    }
  }

  const cases = expand ? EXPANDED_CASES : BENCHMARK_CASES;
  const run = await runBaseline({
    cases,
    issuedAtMs: issueArg ? Date.parse(issueArg) : undefined,
  });
  printRun(expand ? 'Expanded cases' : 'Six-case scoreboard', run);
  const outDir = expand ? join(dir, 'expanded') : dir;
  writeBaselineFiles(outDir, run, { append });
  console.log(`wrote ${outDir}`);
  console.log('Local JSONL only. The map and the forecast wording are unchanged.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
