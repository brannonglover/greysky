/**
 * Feature rows for stored cases. No weights are fitted.
 * Outcomes keep the continuous rate and add a research label.
 */
import fs from 'node:fs';
import path from 'node:path';

import { historyFromBundle } from '../lib/precipNowcast/archive';
import { listBundleDirs, readBundle } from '../lib/precipNowcast/caseFile';
import { estimateMotion } from '../lib/precipNowcast/motion';
import { probeMrmsProducts } from '../lib/precipNowcast/mrmsProducts';
import { classifyOutcome, precursorFeatures } from '../lib/precipNowcast/precursor';
import { SCORE_LEADS_MIN } from '../lib/precipNowcast/thresholds';

function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function env(point: { environment: Array<{ id: string; point: number | null }> | null }, id: string): number | null {
  return point.environment?.find((item) => item.id === id)?.point ?? null;
}

async function main() {
  for (const dir of listBundleDirs()) {
    const { bundle, fields } = readBundle(dir);
    const history = historyFromBundle(bundle, fields);
    const started = Date.now();
    const motion = estimateMotion(history.frames);
    const motionMs = Date.now() - started;
    const heap = process.memoryUsage().heapUsed;
    const regionRows = [];
    console.log(`region ${bundle.regionKey} motion ${motionMs} ms heap ${Math.round(heap / 1_048_576)} MB`);
    for (const point of bundle.points) {
      const features = precursorFeatures(fields, motion, point.latitude, point.longitude);
      const analysis = point.verification?.leads.find((lead) => lead.leadMinutes === 0)?.rainRateMmHr ?? null;
      const outcomes = SCORE_LEADS_MIN.map((leadMinutes) => {
        const later = point.verification?.leads.find((lead) => lead.leadMinutes === leadMinutes)?.rainRateMmHr ?? null;
        return { leadMinutes, rainRateMmHr: later, label: classifyOutcome(analysis, later) };
      });
      const row = {
        observationTime: bundle.observationTime,
        id: point.id,
        intendedRegime: point.intendedRegime,
        motionMs,
        heapUsedBytes: heap,
        cape: env(point, 'cape-surface'),
        cin: env(point, 'cin-surface'),
        pwat: env(point, 'pwat'),
        features,
        analysisMmHr: analysis,
        outcomes,
      };
      regionRows.push(row);
      console.log(
        `${point.id} @ ${bundle.observationTime.slice(11, 16)} spd=${num(features.speedMs, 1)} nearSpd=${num(features.nearbyMedianSpeedMs, 1)} solved=${num(features.nearbySolvedFraction)} trace20=${num(features.traceCoverage20)} dTrace=${num(features.traceCoverageTendencyPerMin, 3)} light20=${num(features.lightCoverage20)} corrT=${num(features.corridorTraceCoverage)} corrI=${num(features.corridorInitiationFraction)} circI=${num(features.circleInitiationFraction)} new=${features.latestNewCells20} pers=${num(features.persistentInitiationFraction)} near=${num(features.nearestPersistentKm, 1)} grow=${num(features.existingGrowthFraction)} weak=${num(features.weakEchoPersistence)} tend=${num(features.pointResidualMmHrPerMin, 2)} ms=${features.ms}`,
      );
      console.log(`  outcomes ${outcomes.map((item) => `+${item.leadMinutes}:${item.label}/${num(item.rainRateMmHr)}`).join(' ')}`);
    }
    fs.writeFileSync(path.join(dir, 'precursors.json'), JSON.stringify({ motionMs, rows: regionRows }));
  }
  console.log('\nMRMS product probe');
  const products = await probeMrmsProducts().catch((error: unknown) => {
    console.log(error instanceof Error ? error.message : 'probe failed');
    return [];
  });
  for (const product of products) {
    console.log(`  ${product.id} listed=${product.listed} bytes=${product.bytes ?? '—'} ${product.note}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
