/**
 * Research collection. Not part of a user request and not a production cron.
 * One cycle scouts and, when the rules say so, archives a region.
 * `--loop` repeats every 10 minutes. Ctrl-C stops it.
 * Each cycle fills verifying leads on cases whose future frames now exist.
 */
import fs from 'node:fs';
import path from 'node:path';

import { captureIssue, replayBundle } from '../lib/precipNowcast/archive';
import { BENCHMARK_CASES, EXPANDED_CASES, type BenchmarkCase } from '../lib/precipNowcast/cases';
import { casesRoot, listBundleDirs, readCase } from '../lib/precipNowcast/caseFile';
import { POINT_PREDICTOR_VERSION } from '../lib/precipNowcast/point';
import { fillOpenVerification } from '../lib/precipNowcast/verifyFill';
import { COLLECT, classifyRegion, collectRegionSnap } from '../lib/precipNowcast/collect';
import { observedTimes } from '../lib/mrms';
import { sampleMrmsPoint } from '../lib/precipNowcast/mrmsPoint';
import { RAIN_THRESHOLD_MM_HR } from '../lib/precipNowcast/thresholds';

const POINTS: readonly BenchmarkCase[] = [...BENCHMARK_CASES, ...EXPANDED_CASES];
const STATE_FILE = () => path.join(casesRoot(), 'collector-state.json');

type State = {
  schemaVersion: 1;
  points: Record<string, { rate: number | null; at: string }>;
  regions: Record<string, { lastArchiveMs: number; lastReason: string; lastDryMs: number | null }>;
};

/** The archive already is the collector's memory. A fresh state file does not treat yesterday's dry controls as unseen. */
function seedFromArchive(state: State) {
  for (const dir of listBundleDirs()) {
    const bundle = readCase(dir);
    const snap = `${bundle.centerLatitude.toFixed(2)},${bundle.centerLongitude.toFixed(2)}`;
    const at = Date.parse(bundle.observationTime);
    if (!Number.isFinite(at)) continue;
    const prior = state.regions[snap];
    const rates = bundle.points.map((point) => point.verification?.leads.find((lead) => lead.leadMinutes === 0)?.rainRateMmHr ?? null);
    const allDry = rates.length > 0 && rates.every((rate) => rate != null && rate <= RAIN_THRESHOLD_MM_HR);
    state.regions[snap] = {
      lastArchiveMs: Math.max(prior?.lastArchiveMs ?? 0, at),
      lastReason: (prior?.lastArchiveMs ?? 0) > at ? prior!.lastReason : 'archive',
      lastDryMs: allDry ? Math.max(prior?.lastDryMs ?? 0, at) : prior?.lastDryMs ?? null,
    };
    for (const point of bundle.points) {
      const existing = state.points[point.id];
      if (existing && Date.parse(existing.at) > at) continue;
      const rate = point.verification?.leads.find((lead) => lead.leadMinutes === 0)?.rainRateMmHr ?? null;
      state.points[point.id] = { rate, at: bundle.observationTime };
    }
  }
}

function loadState(): State {
  const file = STATE_FILE();
  if (!fs.existsSync(file)) return { schemaVersion: 1, points: {}, regions: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8')) as State;
}

function saveState(state: State) {
  fs.mkdirSync(casesRoot(), { recursive: true });
  fs.writeFileSync(STATE_FILE(), JSON.stringify(state));
}

function replayOne() {
  const dirs = listBundleDirs();
  if (!dirs.length) return;
  const bundle = readCase(dirs[0]);
  const pointId = bundle.points[0]?.id;
  if (!pointId || bundle.predictorVersion !== POINT_PREDICTOR_VERSION) {
    throw new Error(`archive predictor ${bundle.predictorVersion}`);
  }
  const result = replayBundle(dirs[0], pointId, POINT_PREDICTOR_VERSION);
  console.log(`replay ${result.predictorVersion} ${pointId} @ ${bundle.observationTime}`);
}

async function cycle() {
  const state = loadState();
  if (!Object.keys(state.regions).length) seedFromArchive(state);
  const times = await observedTimes();
  const latest = times[times.length - 1];
  if (!latest) throw new Error('No MRMS time');
  const nowMs = Date.parse(latest);
  const filled = await fillOpenVerification(times, nowMs);
  if (filled.leads) console.log(`filled ${filled.leads} verifying lead(s) on ${filled.bundles} case(s)`);
  const scouts = [];
  for (const point of POINTS) {
    const sample = await sampleMrmsPoint(latest, point.latitude, point.longitude);
    scouts.push({ ...point, rate: sample.rainRateMmHr, snap: collectRegionSnap(point.latitude, point.longitude) });
  }
  const groups = new Map<string, typeof scouts>();
  for (const scout of scouts) {
    const list = groups.get(scout.snap) ?? [];
    list.push(scout);
    groups.set(scout.snap, list);
  }
  const selected: Array<{ snap: string; group: typeof scouts; reason: string; priorDry: number | null }> = [];
  for (const [snap, group] of groups) {
    const prior = state.regions[snap];
    const decision = classifyRegion({
      rates: group.map((point) => point.rate),
      previous: group.map((point) => state.points[point.id]?.rate ?? null),
      lastArchiveMs: prior?.lastArchiveMs ?? null,
      lastDryMs: prior?.lastDryMs ?? null,
      nowMs,
    });
    console.log(`${snap} ${decision.reason} ${group.map((point) => `${point.id}=${point.rate == null ? '—' : point.rate.toFixed(2)}`).join(' ')}`);
    if (!decision.archive) continue;
    selected.push({ snap, group, reason: decision.reason, priorDry: prior?.lastDryMs ?? null });
  }
  for (const scout of scouts) state.points[scout.id] = { rate: scout.rate, at: latest };
  if (!selected.length) {
    saveState(state);
    console.log('no region selected');
    return;
  }
  const dirs = await captureIssue(nowMs, selected.flatMap((item) => item.group));
  for (const item of selected) {
    state.regions[item.snap] = {
      lastArchiveMs: nowMs,
      lastReason: item.reason,
      lastDryMs: item.reason === 'dry-control' ? nowMs : item.priorDry,
    };
  }
  saveState(state);
  console.log(`archived ${dirs.length} region(s); gap ${COLLECT.minArchiveGapMin} min, dry control ${COLLECT.dryControlGapMin} min`);
}

async function main() {
  const loop = process.argv.includes('--loop');
  const intervalMin = Number(process.argv.find((arg) => arg.startsWith('--every='))?.slice('--every='.length) ?? COLLECT.scoutIntervalMin);
  if (loop) {
    try {
      replayOne();
    } catch (error) {
      console.error(error);
    }
  }
  do {
    try {
      await cycle();
    } catch (error) {
      console.error(error);
      if (!loop) throw error;
    }
    if (!loop) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMin * 60_000));
  } while (loop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
