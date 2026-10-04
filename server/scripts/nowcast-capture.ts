/**
 * Save a regional MRMS situation, the point forecast, and HRRR environment samples.
 * Verification is filled when those frames are still in the rolling archive.
 */
import fs from 'node:fs';
import path from 'node:path';

import { BENCHMARK_CASES, EXPANDED_CASES } from '../lib/precipNowcast/cases';
import { captureIssue } from '../lib/precipNowcast/archive';
import { readBundle, writeBundle } from '../lib/precipNowcast/caseFile';
import { listBundleDirs } from '../lib/precipNowcast/caseFile';
import { inventoryFromCosts, sampleConvergence, sampleEnvironment } from '../lib/precipNowcast/environment';

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const issue = arg('--issue') ?? '2026-10-04T12:46:40.000Z';
  const issuedAtMs = Date.parse(issue);
  if (!Number.isFinite(issuedAtMs)) throw new Error('Bad --issue');
  const points = [...BENCHMARK_CASES, ...EXPANDED_CASES];
  const dirs = arg('--env-only') != null || process.argv.includes('--env-only') ? listBundleDirs() : await captureIssue(issuedAtMs, points);
  if (!process.argv.includes('--env-only')) console.log(`capturing ${points.length} points at ${issue}`);
  console.log(`regions ${dirs.length}`);
  let costsPrinted = false;
  for (const dir of dirs) {
    const { bundle, fields } = readBundle(dir);
    for (const point of bundle.points) {
      const at = Date.parse(bundle.observationTime);
      const sampled = await sampleEnvironment({ latitude: point.latitude, longitude: point.longitude, issuedAtMs: at });
      const wind = await sampleConvergence({ latitude: point.latitude, longitude: point.longitude, issuedAtMs: at });
      point.environment = sampled.values;
      if (wind) {
        point.environment.push({
          id: 'convergence-10m',
          variable: 'UGRD+VGRD',
          level: '10 m above ground',
          product: 'wrfsfc',
          validAt: sampled.validAt,
          units: '1/s',
          point: wind.convergencePerSec,
          nearbyMean: null,
          nearbyMax: null,
          radiusKm: 6,
        });
        if (!costsPrinted) console.log(`  convergence-10m bytes=${wind.bytes} ms=${wind.ms}`);
      }
      if (!costsPrinted) {
        console.log(`HRRR run ${sampled.run} valid ${sampled.validAt} error=${sampled.error ?? 'none'}`);
        for (const cost of sampled.costs) console.log(`  ${cost.id} fetched=${cost.fetched} bytes=${cost.bytes ?? '—'} ms=${cost.ms}`);
        bundle.environmentInventory = inventoryFromCosts(sampled.costs);
        costsPrinted = true;
      }
      const cape = sampled.values.find((value) => value.id === 'cape-surface');
      const cin = sampled.values.find((value) => value.id === 'cin-surface');
      const pwat = sampled.values.find((value) => value.id === 'pwat');
      const refc = sampled.values.find((value) => value.id === 'refc-at-issue');
      console.log(
        `${point.id} obs0=${point.verification?.leads[0]?.rainRateMmHr ?? '—'} CAPE=${cape?.point?.toFixed(0) ?? '—'} CIN=${cin?.point?.toFixed(0) ?? '—'} PWAT=${pwat?.point?.toFixed(1) ?? '—'} REFCissue=${refc?.point?.toFixed(1) ?? '—'}`,
      );
    }
    if (!bundle.environmentInventory && dirs.length) {
      bundle.environmentInventory = inventoryFromCosts([]);
    }
    writeBundle(dir, bundle, fields);
    const stat = fs.statSync(path.join(dir, 'case.json'));
    const frameBytes = bundle.frames.reduce((sum, frame) => sum + fs.statSync(path.join(dir, frame.file)).size, 0);
    console.log(`wrote ${dir} case.json ${stat.size} B fields ${frameBytes} B`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
