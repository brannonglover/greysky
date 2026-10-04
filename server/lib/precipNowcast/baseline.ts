import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { observedTimes, selectObserved } from '../mrms';
import { nowcastFrames, sourceFor, type NowcastFrame, type SourceImage } from '../nowcast';
import { MIN_DBZ } from '../palette';
import { dbzToRainRate } from '../reflectivity';
import { sampleAdvectedDbz } from './advectionSample';
import { BENCHMARK_CASES, type BenchmarkCase } from './cases';
import { hrrrLeadRates } from './hrrrPoint';
import { nearestIso, sampleMrmsPoint, type PointRate } from './mrmsPoint';
import { openMeteoLeads } from './openMeteo';
import { predictionFromRates, type LeadInput } from './predict';
import { ensembleFromHistory } from './ensemble';
import { loadRegionalHistory } from './history';
import { regionalFromHistory } from './regional';
import {
  SCHEMA_VERSION,
  serializeRecord,
  type ObservationRecord,
  type PredictionRecord,
  type Scorecard,
} from './records';
import { scoreRecords } from './score';
import { SCORE_LEADS_MIN } from './thresholds';

const OBS_TOLERANCE_MS = 4 * 60_000;
const FRAME_TOLERANCE_SEC = 4 * 60;
const ISSUE_LOOKBACK_MS = 70 * 60_000;

export type BaselineRun = {
  issuedAt: string;
  predictions: PredictionRecord[];
  observations: ObservationRecord[];
  scorecards: Scorecard[];
};

function advectedRate(dbz: number | null): number | null {
  if (dbz == null) return null;
  if (dbz < MIN_DBZ) return 0;
  return dbzToRainRate(dbz);
}

function closestFrame(frames: readonly NowcastFrame[], targetSec: number): NowcastFrame | null {
  let best: NowcastFrame | null = null;
  let bestDist = Infinity;
  for (const frame of frames) {
    const dist = Math.abs(frame.time - targetSec);
    if (dist < bestDist) {
      best = frame;
      bestDist = dist;
    }
  }
  if (!best || bestDist > FRAME_TOLERANCE_SEC) return null;
  return best;
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/**
 * Hindcast persistence, global advection, regional motion, HRRR, and Open-Meteo
 * at one shared MRMS issue time, late enough that +60 minutes is already observed.
 * Does not change the map.
 */
export async function runBaseline(options?: {
  cases?: readonly BenchmarkCase[];
  issuedAtMs?: number;
  nowMs?: number;
}): Promise<BaselineRun> {
  const cases = options?.cases ?? BENCHMARK_CASES;
  const nowMs = options?.nowMs ?? Date.now();
  const requestedMs = options?.issuedAtMs ?? nowMs - ISSUE_LOOKBACK_MS;
  const times = await observedTimes();
  const issuedAt = nearestIso(times, requestedMs, OBS_TOLERANCE_MS);
  if (!issuedAt) throw new Error('No MRMS frame within 4 minutes of the issue time');
  const issueMs = Date.parse(issuedAt);

  const slots = [0, ...SCORE_LEADS_MIN].map((leadMinutes) => {
    const targetMs = issueMs + leadMinutes * 60_000;
    return { leadMinutes, iso: nearestIso(times, targetMs, OBS_TOLERANCE_MS), targetMs };
  });

  const observations: ObservationRecord[] = [];
  const jobs = cases.flatMap((benchmark) =>
    slots.map((slot) => ({ benchmark, slot })),
  );
  await mapPool(jobs, 4, async ({ benchmark, slot }) => {
    const sample: PointRate = slot.iso
      ? await sampleMrmsPoint(slot.iso, benchmark.latitude, benchmark.longitude).catch(() => ({
          rainRateMmHr: null,
          dbz: null,
        }))
      : { rainRateMmHr: null, dbz: null };
    observations.push({
      schemaVersion: SCHEMA_VERSION,
      recordType: 'observation',
      source: 'mrms-cref-qcd',
      caseId: benchmark.id,
      issuedAt,
      leadMinutes: slot.leadMinutes,
      validAt: slot.iso ?? new Date(slot.targetMs).toISOString(),
      latitude: benchmark.latitude,
      longitude: benchmark.longitude,
      dbz: sample.dbz,
      rainRateMmHr: sample.rainRateMmHr,
    });
  });

  const past = selectObserved(
    times.filter((time) => Date.parse(time) <= issueMs),
    50,
    5,
    issueMs,
  );
  let frames: NowcastFrame[] = [];
  let advectionError: string | null = null;
  try {
    frames = await nowcastFrames(past, 70, issueMs);
  } catch (error) {
    advectionError = error instanceof Error ? error.message : 'Advection failed';
  }
  const anchor = frames[0]?.isoTime ?? past.at(-1)?.isoTime ?? null;
  let source: SourceImage | null = null;
  if (anchor && !advectionError) {
    try {
      source = await sourceFor(anchor);
    } catch (error) {
      advectionError = error instanceof Error ? error.message : 'MRMS image failed';
    }
  }

  const predictions: PredictionRecord[] = [];
  for (const benchmark of cases) {
    const analysis = observations.find((row) => row.caseId === benchmark.id && row.leadMinutes === 0);
    const analysisRate = analysis?.rainRateMmHr ?? null;
    const leadTargets = SCORE_LEADS_MIN.map((leadMinutes) => ({
      leadMinutes,
      validAt: new Date(issueMs + leadMinutes * 60_000).toISOString(),
    }));

    predictions.push(
      predictionFromRates({
        predictorId: 'persistence',
        issuedAt,
        latitude: benchmark.latitude,
        longitude: benchmark.longitude,
        caseId: benchmark.id,
        intendedRegime: benchmark.intendedRegime,
        analysisValidAt: issuedAt,
        analysisRateMmHr: analysisRate,
        leads: leadTargets.map((lead) => ({ ...lead, rateMmHr: analysisRate })),
        diagnostics: { method: 'hold-analysis-rate' },
      }),
    );

    const advected: LeadInput[] = leadTargets.map((lead) => {
      if (!source || advectionError) return { ...lead, rateMmHr: null };
      const frame = closestFrame(frames, Math.round((issueMs + lead.leadMinutes * 60_000) / 1000));
      if (!frame) return { ...lead, rateMmHr: null };
      const dbz = sampleAdvectedDbz(source, benchmark.latitude, benchmark.longitude, frame.u, frame.v, frame.leadMin);
      return { ...lead, rateMmHr: advectedRate(dbz) };
    });
    const motion = frames[0];
    predictions.push(
      predictionFromRates({
        predictorId: 'mrms-advection',
        issuedAt,
        latitude: benchmark.latitude,
        longitude: benchmark.longitude,
        caseId: benchmark.id,
        intendedRegime: benchmark.intendedRegime,
        analysisValidAt: issuedAt,
        analysisRateMmHr: analysisRate,
        leads: advected,
        diagnostics: {
          method: 'global-shift-bilinear-dbz',
          anchor,
          u: motion?.u ?? null,
          v: motion?.v ?? null,
          error: advectionError,
        },
      }),
    );

    const history = await loadRegionalHistory(benchmark.latitude, benchmark.longitude, issueMs, times).catch(() => null);
    const ensemble = history
      ? ensembleFromHistory(history, {
          latitude: benchmark.latitude,
          longitude: benchmark.longitude,
          issuedAtMs: issueMs,
        })
      : null;
    const regional = history
      ? regionalFromHistory(
          history,
          { latitude: benchmark.latitude, longitude: benchmark.longitude, issuedAtMs: issueMs },
          ensemble?.motion ? { motion: ensemble.motion, motionMs: ensemble.motionMs } : undefined,
        )
      : {
          analysisRateMmHr: null as number | null,
          analysisValidAt: issuedAt,
          leads: leadTargets.map((lead) => ({
            leadMinutes: lead.leadMinutes,
            validAt: lead.validAt,
            rainRateMmHr: null as number | null,
          })),
          diagnostics: { error: 'Regional history failed' },
        };
    predictions.push(
      predictionFromRates({
        predictorId: 'regional-motion',
        issuedAt,
        latitude: benchmark.latitude,
        longitude: benchmark.longitude,
        caseId: benchmark.id,
        intendedRegime: benchmark.intendedRegime,
        analysisValidAt: regional.analysisValidAt,
        analysisRateMmHr: regional.analysisRateMmHr,
        leads: regional.leads.map((lead) => ({
          leadMinutes: lead.leadMinutes,
          validAt: lead.validAt,
          rateMmHr: lead.rainRateMmHr,
        })),
        diagnostics: regional.diagnostics,
      }),
    );

    const ensembleLeads = ensemble?.leads ?? leadTargets.map((lead) => ({
      leadMinutes: lead.leadMinutes,
      validAt: lead.validAt,
      expectedRainRateMmHr: null as number | null,
      precipProbability: null as number | null,
    }));
    predictions.push(
      predictionFromRates({
        predictorId: 'regional-ensemble',
        issuedAt,
        latitude: benchmark.latitude,
        longitude: benchmark.longitude,
        caseId: benchmark.id,
        intendedRegime: benchmark.intendedRegime,
        analysisValidAt: ensemble?.analysisValidAt ?? issuedAt,
        analysisRateMmHr: ensemble?.analysisRateMmHr ?? null,
        leads: ensembleLeads.map((lead) => ({
          leadMinutes: lead.leadMinutes,
          validAt: lead.validAt,
          rateMmHr: lead.expectedRainRateMmHr,
          precipProbability: lead.precipProbability,
        })),
        diagnostics: ensemble?.diagnostics ?? { error: 'Regional history failed' },
      }),
    );

    const hrrr = await hrrrLeadRates({
      latitude: benchmark.latitude,
      longitude: benchmark.longitude,
      issuedAtMs: issueMs,
      leads: SCORE_LEADS_MIN,
    }).catch((error: unknown) => ({
      analysisRateMmHr: null as number | null,
      leads: leadTargets.map((lead) => ({ ...lead, rainRateMmHr: null as number | null })),
      diagnostics: { error: error instanceof Error ? error.message : 'HRRR failed' },
    }));
    predictions.push(
      predictionFromRates({
        predictorId: 'hrrr',
        issuedAt,
        latitude: benchmark.latitude,
        longitude: benchmark.longitude,
        caseId: benchmark.id,
        intendedRegime: benchmark.intendedRegime,
        analysisValidAt: issuedAt,
        analysisRateMmHr: hrrr.analysisRateMmHr,
        leads: hrrr.leads.map((lead) => ({
          leadMinutes: lead.leadMinutes as LeadInput['leadMinutes'],
          validAt: lead.validAt,
          rateMmHr: lead.rainRateMmHr,
        })),
        diagnostics: hrrr.diagnostics,
      }),
    );

    const meteo = await openMeteoLeads({
      latitude: benchmark.latitude,
      longitude: benchmark.longitude,
      issuedAtMs: issueMs,
      leads: SCORE_LEADS_MIN,
    });
    predictions.push(
      predictionFromRates({
        predictorId: 'open-meteo',
        issuedAt,
        latitude: benchmark.latitude,
        longitude: benchmark.longitude,
        caseId: benchmark.id,
        intendedRegime: benchmark.intendedRegime,
        analysisValidAt: new Date(issueMs).toISOString().slice(0, 13) + ':00',
        analysisRateMmHr: meteo.analysisRateMmHr,
        leads: meteo.leads.map((lead) => ({
          leadMinutes: lead.leadMinutes as LeadInput['leadMinutes'],
          validAt: lead.validAt,
          rateMmHr: lead.rainRateMmHr,
          precipProbability: lead.precipProbability,
        })),
        diagnostics: meteo.diagnostics,
      }),
    );
  }

  const scorecards = scoreRecords(predictions, observations);
  return { issuedAt, predictions, observations, scorecards };
}

export function writeBaselineFiles(dir: string, run: BaselineRun, options?: { append?: boolean }): void {
  mkdirSync(dir, { recursive: true });
  const dump = (name: string, rows: readonly (PredictionRecord | ObservationRecord | Scorecard)[]) => {
    const body = rows.map((row) => serializeRecord(row)).join('\n');
    const file = join(dir, name);
    const text = rows.length ? `${body}\n` : '';
    if (options?.append) appendFileSync(file, text);
    else writeFileSync(file, text);
  };
  dump('predictions.jsonl', run.predictions);
  dump('observations.jsonl', run.observations);
  dump('scorecards.jsonl', run.scorecards);
}
