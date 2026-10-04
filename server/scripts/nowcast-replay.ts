/**
 * Replay a stored situation. Predictors run on the saved fields, not on live MRMS.
 */
import { replayBundle } from '../lib/precipNowcast/archive';
import { listBundleDirs, readBundle } from '../lib/precipNowcast/caseFile';

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const pointId = arg('--id');
const predictor = arg('--predictor') ?? 'regional-ensemble-1';
const explicit = arg('--dir');
if (!pointId) {
  console.error('Usage: nowcast-replay --id atlanta-30345 [--predictor regional-ensemble-1|regional-motion-1] [--dir path]');
  process.exit(1);
}

const dirs = explicit ? [explicit] : listBundleDirs().filter((dir) => readBundle(dir).bundle.points.some((point) => point.id === pointId));
if (!dirs.length) {
  console.error(`No stored case for ${pointId}`);
  process.exit(1);
}

for (const dir of dirs) {
  const result = replayBundle(dir, pointId, predictor);
  const stored = readBundle(dir).bundle.points.find((point) => point.id === pointId);
  console.log(`${dir}`);
  console.log(`${result.predictorVersion} ${result.pointId} analysis ${result.analysisRateMmHr?.toFixed(2) ?? '—'}`);
  for (const lead of result.leads) {
    const saved = stored?.forecast.minutes.find((minute) => minute.minute === lead.leadMinutes);
    const observed = stored?.verification?.leads.find((row) => row.leadMinutes === lead.leadMinutes);
    console.log(
      `  +${lead.leadMinutes} replay ${lead.expectedRainRateMmHr?.toFixed(2) ?? '—'} stored ${saved?.expectedRainRateMmHr?.toFixed(2) ?? '—'} p90 ${lead.p90MmHr?.toFixed(2) ?? '—'} obs ${observed?.rainRateMmHr?.toFixed(2) ?? '—'}`,
    );
  }
}
