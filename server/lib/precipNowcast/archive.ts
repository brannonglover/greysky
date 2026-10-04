/**
 * Capture one regional situation and replay a predictor on those stored fields.
 * Replay does not download MRMS. It uses the frames written at issue time.
 */
import fs from 'node:fs';
import path from 'node:path';

import { observedTimes } from '../mrms';
import { analyzeEvolution } from './evolution';
import { estimateMotion } from './motion';
import { loadRegionalHistory, type RegionalHistory } from './history';
import { nearestIso, sampleMrmsPoint } from './mrmsPoint';
import { regionalFromHistory } from './regional';
import { prepareMembers, uncertaintyScore, defaultChunkSec } from './ensemble';
import {
  POINT,
  POINT_PREDICTOR_VERSION,
  assemblePoint,
  regionKey,
  sampleMembers,
  type CachedRegion,
} from './point';
import { SCORE_LEADS_MIN } from './thresholds';
import type { BenchmarkCase } from './cases';
import {
  bundleDir,
  readBundle,
  readCase,
  writeBundle,
  type CaseBundle,
  type StoredPoint,
} from './caseFile';
import type { ObservationField } from './field';

export async function captureRegion(args: {
  issuedAtMs: number;
  times: readonly string[];
  points: readonly BenchmarkCase[];
}): Promise<{ dir: string | null; error: string | null; bundle: CaseBundle | null }> {
  const observation = nearestIso(args.times, args.issuedAtMs, 4 * 60_000);
  if (!observation) return { dir: null, error: 'No MRMS frame within 4 minutes', bundle: null };
  const located = regionKey(args.points[0].latitude, args.points[0].longitude, observation);
  const existing = bundleDir(located.key, observation);
  if (fs.existsSync(path.join(existing, 'case.json'))) {
    console.log(`already stored ${existing}`);
    return { dir: existing, error: null, bundle: readCase(existing) };
  }
  const history = await loadRegionalHistory(located.centerLatitude, located.centerLongitude, Date.parse(observation), args.times);
  if (history.frames.length < 2) return { dir: null, error: 'fewer than two usable frames', bundle: null };

  const motionStarted = Date.now();
  const motion = estimateMotion(history.frames);
  const motionMs = Date.now() - motionStarted;
  const evolution = analyzeEvolution(history.frames, motion);
  const latest = history.frames[history.frames.length - 1];
  const members = prepareMembers(latest, motion, evolution, uncertaintyScore(motion, evolution, history), defaultChunkSec());
  const region: CachedRegion = {
    key: located.key,
    centerLatitude: located.centerLatitude,
    centerLongitude: located.centerLongitude,
    observationTime: observation,
    members,
    motionMs,
    evolutionMs: 0,
    buildMs: motionMs,
    estimatedBytes: 0,
  };

  const frames = history.frames.map((field, index) => ({
    validAt: field.validAt,
    file: `frames/${index}.bin`,
    source: field.source,
    geometry: field.geometry,
  }));
  const storedPoints: StoredPoint[] = [];
  for (const point of args.points) {
    const sampled = sampleMembers(region, point.latitude, point.longitude, POINT.defaultRadiusKm);
    const forecast = assemblePoint({
      region,
      latitude: point.latitude,
      longitude: point.longitude,
      radiusKm: POINT.defaultRadiusKm,
      eventThresholdMmHr: POINT.eventThresholdMmHr,
      endingDryMin: POINT.endingDryMin,
      series: sampled.series,
      sampleMs: sampled.sampleMs,
      cache: 'miss',
    });
    const leads = [];
    for (const leadMinutes of [0, ...SCORE_LEADS_MIN]) {
      const iso = nearestIso(args.times, Date.parse(observation) + leadMinutes * 60_000, 4 * 60_000);
      if (!iso) {
        leads.push({ leadMinutes, validAt: null, rainRateMmHr: null, dbz: null });
        continue;
      }
      const sample = await sampleMrmsPoint(iso, point.latitude, point.longitude).catch(() => ({
        rainRateMmHr: null,
        dbz: null,
      }));
      leads.push({ leadMinutes, validAt: iso, rainRateMmHr: sample.rainRateMmHr, dbz: sample.dbz });
    }
    storedPoints.push({
      id: point.id,
      latitude: point.latitude,
      longitude: point.longitude,
      intendedRegime: point.intendedRegime,
      note: point.note,
      memberRates: sampled.series[0]
        ? sampled.series[0].rates.map((_, step) => sampled.series.map((member) => member.rates[step] ?? null))
        : [],
      forecast,
      verification: { source: 'mrms-cref-qcd', leads },
      environment: null,
    });
  }

  const bundle: CaseBundle = {
    schemaVersion: 1,
    observationTime: observation,
    regionKey: located.key,
    centerLatitude: located.centerLatitude,
    centerLongitude: located.centerLongitude,
    predictorVersion: POINT_PREDICTOR_VERSION,
    history: {
      requested: history.requested,
      usable: history.usable,
      failed: history.failed,
      ageSec: history.ageSec,
      gapSec: history.gapSec,
    },
    frames,
    points: storedPoints,
    environmentInventory: null,
  };
  const dir = bundleDir(located.key, observation);
  writeBundle(dir, bundle, history.frames);
  return { dir, error: null, bundle };
}

export function historyFromBundle(bundle: CaseBundle, fields: ObservationField[]): RegionalHistory {
  return {
    requested: bundle.history.requested,
    usable: bundle.history.usable,
    failed: bundle.history.failed,
    ageSec: bundle.history.ageSec,
    gapSec: bundle.history.gapSec,
    downloadBytes: 0,
    downloadMs: 0,
    buildMs: 0,
    frames: fields,
  };
}

export type ReplayResult = {
  predictorVersion: string;
  pointId: string;
  analysisRateMmHr: number | null;
  leads: Array<{ leadMinutes: number; expectedRainRateMmHr: number | null; p90MmHr?: number | null }>;
};

function regionFromHistory(bundle: CaseBundle, fields: ObservationField[]): CachedRegion {
  const history = historyFromBundle(bundle, fields);
  const latest = fields[fields.length - 1];
  const motion = estimateMotion(fields);
  const evolution = analyzeEvolution(fields, motion);
  const members = prepareMembers(latest, motion, evolution, uncertaintyScore(motion, evolution, history), defaultChunkSec());
  return {
    key: bundle.regionKey,
    centerLatitude: bundle.centerLatitude,
    centerLongitude: bundle.centerLongitude,
    observationTime: bundle.observationTime,
    members,
    motionMs: 0,
    evolutionMs: 0,
    buildMs: 0,
    estimatedBytes: 0,
  };
}

/** Run a predictor on the stored fields. This does not read the stored forecast. */
export function replayBundle(dir: string, pointId: string, predictorVersion: string): ReplayResult {
  const { bundle, fields } = readBundle(dir);
  const point = bundle.points.find((item) => item.id === pointId);
  if (!point) throw new Error(`No point ${pointId}`);
  const history = historyFromBundle(bundle, fields);
  const issuedAtMs = Date.parse(bundle.observationTime);
  if (predictorVersion === 'regional-motion-1') {
    const forecast = regionalFromHistory(history, { latitude: point.latitude, longitude: point.longitude, issuedAtMs });
    return {
      predictorVersion,
      pointId,
      analysisRateMmHr: forecast.analysisRateMmHr,
      leads: forecast.leads.map((lead) => ({ leadMinutes: lead.leadMinutes, expectedRainRateMmHr: lead.rainRateMmHr })),
    };
  }
  if (predictorVersion !== 'regional-ensemble-1') throw new Error(`Unknown predictor ${predictorVersion}`);
  const region = regionFromHistory(bundle, fields);
  const sampled = sampleMembers(region, point.latitude, point.longitude, point.forecast.neighborhood.radiusKm);
  const forecast = assemblePoint({
    region,
    latitude: point.latitude,
    longitude: point.longitude,
    radiusKm: point.forecast.neighborhood.radiusKm,
    eventThresholdMmHr: point.forecast.eventThresholdMmHr,
    endingDryMin: point.forecast.ending.dryPersistenceMin,
    series: sampled.series,
    sampleMs: sampled.sampleMs,
    cache: 'miss',
  });
  return {
    predictorVersion,
    pointId,
    analysisRateMmHr: forecast.minutes[0]?.expectedRainRateMmHr ?? null,
    leads: SCORE_LEADS_MIN.map((leadMinutes) => {
      const minute = forecast.minutes.find((row) => row.minute === leadMinutes);
      return {
        leadMinutes,
        expectedRainRateMmHr: minute?.expectedRainRateMmHr ?? null,
        p90MmHr: minute?.p90MmHr ?? null,
      };
    }),
  };
}

export async function captureIssue(issuedAtMs: number, points: readonly BenchmarkCase[]): Promise<string[]> {
  const times = await observedTimes();
  const observation = nearestIso(times, issuedAtMs, 4 * 60_000);
  if (!observation) throw new Error('No MRMS frame within 4 minutes');
  const groups = new Map<string, BenchmarkCase[]>();
  for (const point of points) {
    const located = regionKey(point.latitude, point.longitude, observation);
    const list = groups.get(located.key) ?? [];
    list.push(point);
    groups.set(located.key, list);
  }
  const dirs: string[] = [];
  for (const group of groups.values()) {
    const captured = await captureRegion({ issuedAtMs, times, points: group });
    if (captured.dir) dirs.push(captured.dir);
    else console.log(`skip ${group.map((point) => point.id).join(',')}: ${captured.error}`);
  }
  return dirs;
}

export function bundlePathFor(dir: string): string {
  return path.join(dir, 'case.json');
}
