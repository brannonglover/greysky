/**
 * Deterministic regional nowcast. One velocity field, one backward trace.
 * No ensemble and no growth or decay.
 */
import { pixelOf, sampleField } from './field';
import { loadRegionalHistory, type HistoryStats } from './history';
import { estimateMotion } from './motion';
import { tracePoint } from './extrapolate';
import { leadStepMin } from './resolution';
import { SCORE_LEADS_MIN, type ScoreLeadMin } from './thresholds';

export type RegionalLead = {
  leadMinutes: ScoreLeadMin;
  validAt: string;
  rainRateMmHr: number | null;
};

export type RegionalForecast = {
  analysisRateMmHr: number | null;
  analysisValidAt: string;
  leads: RegionalLead[];
  diagnostics: Record<string, string | number | boolean | null>;
};

function historyDiagnostics(stats: HistoryStats, extra: Record<string, string | number | boolean | null>) {
  const ages = stats.ageSec;
  const gaps = stats.gapSec;
  return {
    method: 'regional-block-lucas-kanade',
    framesRequested: stats.requested,
    framesUsable: stats.usable,
    framesFailed: stats.failed,
    oldestAgeSec: ages.length ? Math.round(ages[0]) : null,
    newestAgeSec: ages.length ? Math.round(ages[ages.length - 1]) : null,
    maxGapSec: gaps.length ? Math.round(Math.max(...gaps)) : null,
    downloadBytes: stats.downloadBytes,
    downloadMs: stats.downloadMs,
    fieldBuildMs: stats.buildMs,
    ...extra,
  };
}

export async function regionalForecast(args: {
  latitude: number;
  longitude: number;
  issuedAtMs: number;
  times: readonly string[];
}): Promise<RegionalForecast> {
  const history = await loadRegionalHistory(args.latitude, args.longitude, args.issuedAtMs, args.times);
  const latest = history.frames[history.frames.length - 1];
  const stepMin = leadStepMin();
  const emptyLeads = SCORE_LEADS_MIN.map((leadMinutes) => ({
    leadMinutes,
    validAt: new Date(args.issuedAtMs + leadMinutes * 60_000).toISOString(),
    rainRateMmHr: null as number | null,
  }));
  if (!latest || history.frames.length < 2) {
    return {
      analysisRateMmHr: null,
      analysisValidAt: latest?.validAt ?? new Date(args.issuedAtMs).toISOString(),
      leads: emptyLeads,
      diagnostics: historyDiagnostics(history, {
        error: 'fewer than two usable frames',
        leadStepMin: stepMin,
        motionMs: 0,
        extrapolateMs: 0,
        heapUsedBytes: process.memoryUsage().heapUsed,
      }),
    };
  }

  const motionStarted = Date.now();
  const motion = estimateMotion(history.frames);
  const motionMs = Date.now() - motionStarted;
  const solved = motion.vectors.filter((vector) => vector.source === 'solved').length;
  const unknown = motion.vectors.filter((vector) => vector.source === 'unknown').length;

  const pixel = pixelOf(latest.geometry, args.latitude, args.longitude);
  const analysis = sampleField(latest, pixel.x, pixel.y);

  const traceStarted = Date.now();
  const leads = SCORE_LEADS_MIN.map((leadMinutes) => {
    const trace = tracePoint(latest, motion, args.latitude, args.longitude, leadMinutes * 60, stepMin * 60);
    return {
      leadMinutes,
      validAt: new Date(args.issuedAtMs + leadMinutes * 60_000).toISOString(),
      rainRateMmHr: trace.rainRateMmHr,
    };
  });
  const extrapolateMs = Date.now() - traceStarted;

  return {
    analysisRateMmHr: analysis.rainRateMmHr,
    analysisValidAt: latest.validAt,
    leads,
    diagnostics: historyDiagnostics(history, {
      pairsUsed: motion.pairsUsed,
      pairsRejected: motion.pairsRejected,
      pairDtSec: motion.pairDtSec.map((dt) => Math.round(dt)).join(','),
      vectorsSolved: solved,
      vectorsUnknown: unknown,
      leadStepMin: stepMin,
      motionMs,
      extrapolateMs,
      heapUsedBytes: process.memoryUsage().heapUsed,
      error: null,
    }),
  };
}
